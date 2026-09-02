# Infrastructure

Cloud Run service definitions for the Hodari agent and the Hodari frontend.

## Why there are `.example` files

The real service configs hold values that are specific to one deployment: your
Google Cloud project id, your container image digests, and your staff email
allowlist. Git does not track them.

The `.example` files are the templates. They are safe to publish.

## First-time setup

```bash
cp infra/cloudrun-agent.example.yaml    infra/cloudrun-agent.yaml
cp infra/cloudrun-frontend.example.yaml infra/cloudrun-frontend.yaml
```

Then replace every placeholder in your two new files:

| Placeholder | Replace with |
|---|---|
| `YOUR_GCP_PROJECT_ID` | Your Google Cloud project id, for example `hodari-prod` |
| `YOUR_PROJECT_NUMBER` | Your Google Cloud project number, the digits in a Cloud Run URL |
| `REPLACE_WITH_YOUR_IMAGE_DIGEST` | The `sha256:...` digest that Cloud Build prints |
| `you@example.com` | The staff emails that skip usage metering, separated by commas |
| `price_REPLACE_ME_*` | Your Stripe price ids, if you enable the credit packs |

## Secrets

The templates never hold a secret value. They hold Secret Manager references.
Create each secret before your first deploy:

```bash
printf '%s' '<value>' | gcloud secrets create MONGODB_URI \
  --data-file=- --project YOUR_GCP_PROJECT_ID
```

Required secrets:

| Secret | Used by |
|---|---|
| `MONGODB_URI` | Agent and frontend, through the MongoDB MCP sidecar |
| `GOOGLE_MAPS_API_KEY` | Agent, for the Maps Grounding Lite MCP server |
| `GOOGLE_MAPS_SERVER_KEY` | Frontend, for the Places and Directions API routes |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Frontend, for the Maps JavaScript API |
| `HODARI_SESSION_SECRET` | Frontend, to sign session cookies |
| `GOOGLE_OAUTH_CLIENT_ID` | Frontend, for Google sign-in |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Frontend, for Google sign-in |
| `STRIPE_SECRET_KEY` | Frontend, only if you enable billing |
| `STRIPE_WEBHOOK_SECRET` | Frontend, only if you enable billing |

Give the runtime service account the `roles/secretmanager.secretAccessor` role
on each secret.

## Deploy

```bash
gcloud builds submit --config client/cloudbuild.yaml --project YOUR_GCP_PROJECT_ID client/
gcloud builds submit --config agents/cloudbuild.yaml --project YOUR_GCP_PROJECT_ID agents/

# Pin the new digests in your infra/cloudrun-*.yaml, then:
gcloud run services replace infra/cloudrun-frontend.yaml \
  --region us-central1 --project YOUR_GCP_PROJECT_ID
gcloud run services replace infra/cloudrun-agent.yaml \
  --region us-central1 --project YOUR_GCP_PROJECT_ID
```

## Before you go to production

Read [../docs/SECURITY_HARDENING.md](../docs/SECURITY_HARDENING.md). The most
important rule: the agent service must not accept `allUsers`. Give only the
frontend service account the `roles/run.invoker` role on the agent service.
