# Billing & Metering

Hodari meters the chat pipeline (each run spends real Gemini + Maps tokens) and
sells one-time **credit packs** through Stripe. Identity and quota are enforced
**server-side** at `/api/chat` — the client is never trusted.

## The entitlement ladder

| Tier | Who | Free allowance | Then |
|---|---|---|---|
| **Guest** | not logged in | `HODARI_GUEST_FREE` (default **3**) generations, metered by IP | **login wall** |
| **Member** | Google sign-in | `HODARI_FREE_DAILY` (default **5**) generations / day | **paywall** |
| **Paid** | bought credits | daily free **then** purchased credits | buy more |

Members spend their daily free allotment first, then credits. Guests are metered
by **IP** (not a cookie) so clearing cookies / incognito doesn't reset the
trial — at the cost that visitors behind one NAT share the guest pool. The trial
is just a teaser; signing in (free) gives each person their own quota.

Tune the limits without a code change via env: `HODARI_GUEST_FREE`,
`HODARI_FREE_DAILY`.

## Credit packs

Defined in `client/lib/billing.ts` → `PACKS`. The **credit amount** each pack
grants is authoritative there (never trusted from the client). The **price**
lives in Stripe and is referenced by env:

| Pack | Credits | Price env |
|---|---|---|
| `starter` | 25 | `STRIPE_PRICE_STARTER` |
| `explorer` | 75 | `STRIPE_PRICE_EXPLORER` |
| `tournament` | 200 | `STRIPE_PRICE_TOURNAMENT` |

## Data model (MongoDB)

- `users` doc gains: `credits` (int), `free_used` (int today), `free_day`
  (`YYYY-MM-DD` UTC). All default to 0 / unset.
- `usage` — guest counters: `{ key: "guest:<ip>", count, kind: "guest", created_at }`.
- `billing_events` — applied Stripe event ids (idempotency, prevents double-credit).

## Request flow

```
POST /api/chat
  rate-limit (per IP)  →  identity (cookie = member, else guest by IP)
  →  consume()  ── gate? ──►  401 {gate:"login"}  /  402 {gate:"paywall"}
  →  mint Google ID token, call agent  ── unreachable? ──►  refund()
  →  stream SSE  (+ X-Hodari-Free-Remaining / X-Hodari-Credits headers)
```

`consume()` **fails open** if Mongo/MCP is down (allows the run rather than block
paying users during a blip); the per-IP rate limiter still caps abuse.

## Routes

- `POST /api/billing/checkout` — creates a Stripe Checkout Session (requires login).
- `POST /api/billing/webhook` — **the only trusted "paid" signal**; verifies the
  signature, grants credits idempotently.
- `GET  /api/billing/me` — entitlement snapshot for the UI (quota pill / paywall).

The UI: `client/components/Paywall.tsx`, opened by `LandingPage` when a chat run
throws `ChatGateError`.

---

## Turn payments on (Stripe)

1. **Create products + prices** in the Stripe Dashboard (one Price per pack,
   one-time). Copy each `price_…` id.
2. **Get keys:** Developers → API keys → Secret key (`sk_live_…` / `sk_test_…`).
3. **Create the webhook:** Developers → Webhooks → add endpoint
   `https://<frontend-url>/api/billing/webhook`, event `checkout.session.completed`.
   Copy its signing secret (`whsec_…`).
4. **Store secrets** in Secret Manager:
   ```bash
   printf '%s' 'sk_live_…'  | gcloud secrets create STRIPE_SECRET_KEY     --data-file=- --project mapsme-498314
   printf '%s' 'whsec_…'    | gcloud secrets create STRIPE_WEBHOOK_SECRET --data-file=- --project mapsme-498314
   # grant the runtime SA read access
   for S in STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET; do
     gcloud secrets add-iam-policy-binding $S \
       --member=serviceAccount:hodari-agent@mapsme-498314.iam.gserviceaccount.com \
       --role=roles/secretmanager.secretAccessor --project mapsme-498314
   done
   ```
5. **Edit `infra/cloudrun-frontend.yaml`:** put the real `price_…` ids into
   `STRIPE_PRICE_*`, and **uncomment** the `STRIPE_SECRET_KEY` /
   `STRIPE_WEBHOOK_SECRET` blocks.
6. **Deploy** (same flow as always):
   ```bash
   gcloud builds submit --config client/cloudbuild.yaml --project mapsme-498314 client/
   # bump the image digest in infra/cloudrun-frontend.yaml, then:
   gcloud run services replace infra/cloudrun-frontend.yaml --region us-central1 --project mapsme-498314
   ```

Until step 5, the free tier works and the paywall politely says payments aren't
enabled yet.

---

## Lock the agent endpoint (P0.3 — ✅ SHIPPED 2026-07-03)

> **Status: done.** `hodari-agent` no longer accepts `allUsers`; invoker is
> restricted to `hodari-agent@mapsme-498314.iam.gserviceaccount.com` (the
> frontend's SA). Verified 2026-07-03: anonymous `GET /` and `POST /run_sse`
> both return **403**, while a guest chat through `/api/chat` still streams.
> The steps below are kept for reference / rollback.

Metering at the frontend is worthless while `hodari-agent` accepts `allUsers`:
anyone can `curl` the agent URL directly and skip the paywall. The frontend now
mints a Google ID token (`lib/gcpAuth.ts`) and sends it on every agent call, so
you can lock the agent to the frontend's service account.

**Both services already run as `hodari-agent@mapsme-498314.iam.gserviceaccount.com`**,
so grant that SA invoker and drop public access. Do it in this order (no downtime):

```bash
# 1. The token-sending frontend is already deployed (AGENT_AUDIENCE set). Verify
#    AGENT_AUDIENCE matches the agent URL exactly.

# 2. Allow the frontend SA to invoke the agent:
gcloud run services add-iam-policy-binding hodari-agent \
  --member=serviceAccount:hodari-agent@mapsme-498314.iam.gserviceaccount.com \
  --role=roles/run.invoker --region us-central1 --project mapsme-498314

# 3. Remove public access:
gcloud run services remove-iam-policy-binding hodari-agent \
  --member=allUsers --role=roles/run.invoker \
  --region us-central1 --project mapsme-498314

# 4. (optional, stronger) restrict ingress to internal + load balancer:
# gcloud run services update hodari-agent --ingress internal-and-cloud-load-balancing \
#   --region us-central1 --project mapsme-498314
```

Test a chat after step 3. If it 403s, the token audience is wrong — `AGENT_AUDIENCE`
must equal the agent's run.app URL. Roll back by re-adding `allUsers` (step 3 in
reverse) while you debug.

> Locally (no metadata server) `idTokenFor` returns null and no auth header is
> sent — exactly right against an unauthenticated local ADK server.
