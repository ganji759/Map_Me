# Hodari — Security Hardening Plan

Status: **in progress** · Owner: engineering · Last updated: 2026-06-13

This document is the source of truth for hardening Hodari now that it is in
production. It lists what is already in place, the concrete vulnerabilities
found by auditing the live code paths, and a prioritized fix plan with an
implementation checklist. Work top-down: **P0 → P1 → P2**.

---

## 1. Current security posture (what is already in place)

- **Secrets in Google Secret Manager** — `MONGODB_URI`, Maps keys, etc. are
  injected as secret references in the Cloud Run YAMLs, not baked into images.
- **TLS everywhere** — Cloud Run terminates HTTPS; no plaintext traffic.
- **No direct DB driver** — all MongoDB access is routed through the MongoDB MCP
  sidecar on `localhost:3100`, which is not exposed publicly.
- **Prompt-injection framing** — MCP wraps query results in
  `<untrusted-user-data>` tags so the agent treats DB/place content as data.
- **Login input validation** — `/api/auth/login` regex-validates the email and
  `String()`-coerces inputs.
- **Process isolation + autoscaling caps** — Cloud Run isolates containers;
  frontend `maxScale: 3` bounds blast radius.
- **An in-memory token-bucket rate limiter exists** (`client/lib/rateLimit.ts`)
  but is **currently unused** — wiring it up is part of P1.

---

## 2. Vulnerabilities found (audited against live code)

### P0 — Critical (fix immediately)

**V1. No real authentication.** `POST /api/auth/login` takes only name + email
and returns/creates a user. No password, OTP, or token. Anyone who knows an
email can sign in as that person; `user_id` is a predictable slug of the name
and is stored in `localStorage`.

**V2. Broken access control / IDOR.** The client passes `userId` to the server,
which trusts it with no authorization:
- `GET /api/saved?userId=X` → returns **any** user's saved places.
- `GET /api/session?userId=X&sessionId=Y` → returns **any** user's agent session
  state (plan, candidates, itinerary).
- `POST /api/feedback`, `POST /api/saved`, `POST /api/chat` → write under any
  `userId` supplied in the body.

**V3. NoSQL operator injection.** Body routes destructure `userId` / `placeId`
straight from `await req.json()` with no string coercion and build Mongo filters
from them. A payload like `{"userId": {"$ne": null}}` matches across all users
(data exfiltration via `/api/saved`, cross-user writes via `/api/feedback`).

**V4. Public agent endpoint.** `hodari-agent` is `allUsers` + `ingress: all`
(confirmed). Anyone on the internet can call `/run_sse` directly and burn
Gemini + Maps quota → cost-based denial of service.

### P1 — High

**V5. No rate limiting.** `/api/chat`, `/api/auth/login`, `/api/voice` and the
photo proxies have no throttle, enabling abuse and cost amplification. (A
limiter module exists but is not wired in.)

**V6. Browser Maps key exposure.** `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is shipped
to every visitor (unavoidable for Maps JS) and must be restricted by HTTP
referrer + API in the GCP console, or it will be scraped and abused.

**V7. Over-privileged DB credential.** The MCP connection string can
`find/update/delete/drop` everything. A compromised route or SSRF into
`localhost:3100` could drop collections.

### P2 — Defense in depth

**V8. Atlas network allowlist.** Confirm the cluster is not open to
`0.0.0.0/0`; restrict to Cloud Run egress so a leaked URI is not game-over.

**V9. Security headers / CSP.** Add HSTS, `X-Content-Type-Options`,
`X-Frame-Options`/frame-ancestors, and a Content-Security-Policy.

**V10. Photo proxy SSRF surface.** `/api/place-photo?url=` should allow only
Google Places photo hosts (no arbitrary URL fetch).

**V11. Structured audit logging** for auth + writes (who, what, when).

---

## 3. Fix plan

### P0.1 — Server-authoritative identity (closes V1 partially, V2 fully)
- On successful login, set a **signed, httpOnly, Secure, SameSite=Lax cookie**
  (`hodari_session`) containing `{ user_id, email, iat }`, HMAC-signed with a
  server secret `HODARI_SESSION_SECRET` (new Secret Manager secret).
- Add `client/lib/session.ts` with `signSession()`, `verifySession()`,
  `getSessionUser(req)`.
- Every data route derives `user_id` from the cookie and **ignores any
  client-supplied `userId`**. No cookie → `401`.
- Client: stop sending `userId`; rely on the cookie (`credentials: 'same-origin'`).
  Handle `401` by redirecting to `/login`.
- Note: this makes identity tamper-proof but login is still email-only —
  password/OTP/OAuth is tracked as **P0.4** below.

### P0.2 — NoSQL injection coercion (closes V3)
- Add `asId(x)` helper: returns a safe `string` or throws on non-string /
  oversized input. Apply to `user_id`, `place_id`, `session_id` before any
  Mongo filter, in **all** routes.

### P0.3 — Lock the agent service (closes V4)
- `gcloud run services update hodari-agent --no-allow-unauthenticated --ingress=internal`
- Grant the frontend service account `roles/run.invoker` on `hodari-agent`.
- Frontend mints a Google-signed **ID token** (metadata server) for the agent
  audience and sends it as `Authorization: Bearer` on `/run_sse` + session calls.

### P0.4 — Real authentication (product decision)
Upgrade email-only login to one of: email magic-link / OTP, or Google OAuth via
Identity Platform. Until then, P0.1 limits damage to "must know the email", and
sessions are not forgeable.

### P1.1 — Wire up rate limiting (V5)
Apply `rateLimit()` keyed by client IP (`x-forwarded-for`) to `/api/chat`,
`/api/auth/login`, `/api/voice`, `/api/place-photo(s)`. Return `429` +
`Retry-After`. Document the per-instance caveat (move to Redis if scaling out).

### P1.2 — Restrict API keys (V6) — console/gcloud
Referrer-lock the browser Maps key to the production origin + `localhost`;
restrict to Maps JS + needed APIs. Keep the server key separate and
application-restricted.

### P1.3 — Least-privilege DB user (V7)
Create an Atlas DB user scoped to the `hodari` DB with `readWrite` only (no
`dbAdmin`, no `dropDatabase`). Point `MONGODB_URI` at it.

### P2 — V8–V11 as capacity allows.

---

## 4. Implementation checklist

- [x] P0.2 `asId()` coercion helper + apply to saved / feedback / chat / session
- [x] P0.1 `lib/session.ts` (HMAC sign/verify) + `HODARI_SESSION_SECRET` secret
- [x] P0.1 set cookie on login; routes derive user from cookie (param = legacy fallback)
- [x] P1.1 wire `rateLimit()` into chat + login routes (IP-keyed, 429 + Retry-After)
- [ ] P0.1b **enforce** the cookie: drop the param fallback once all clients have a
      cookie; have the client stop sending `userId` and handle `401` → `/login`
- [ ] P0.3 agent `--no-allow-unauthenticated` + `ingress=internal` + ID-token calls
- [ ] P1.1b extend rate limiting to `/api/voice` and the photo proxies
- [ ] P1.2 referrer-lock the browser Maps key (console)
- [ ] P1.3 least-privilege Atlas DB user
- [ ] P0.4 magic-link / OAuth login (scoped separately)
- [ ] P2 security headers / CSP, photo-proxy host allowlist, Atlas allowlist, audit logs

---

## 5. Progress log

- 2026-06-13: Audit complete; document created.
- 2026-06-13: **Shipped first hardening increment.**
  - P0.2 done: `asId()` coercion blocks NoSQL operator injection on every
    user-supplied id across `saved`, `feedback`, `chat`, `session`.
  - P0.1 done: `lib/session.ts` issues an HMAC-signed httpOnly session cookie on
    login (`HODARI_SESSION_SECRET` created in Secret Manager, wired into the
    frontend Cloud Run service). Data routes now derive `user_id` from the cookie
    and ignore the client value when a cookie is present; the `userId` param
    remains only as a validated legacy fallback (full enforcement = P0.1b).
  - Also URL-encoded the user/session ids interpolated into the ADK URL
    (path-injection fix) and wired IP-keyed rate limiting into chat + login.
  - **Next:** P0.3 (lock the public agent endpoint) — highest remaining risk.
