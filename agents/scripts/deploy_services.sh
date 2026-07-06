#!/usr/bin/env bash
#
# deploy_services.sh — deploy Hodari's four agents as independent Cloud Run
# services from ONE shared container image (Dockerfile selects the agent at
# runtime via AGENT_SERVICE).
#
# This script is DOCUMENTATION + TOOLING. Review it before running. It performs
# real `gcloud run deploy` calls, so run it yourself once you have deploy
# credentials (`gcloud auth login` + `gcloud config set project ...`).
#
# Order matters: the three leaf agents (planner, explorer, itinerary) are
# deployed first as PRIVATE (IAM-only) services; their URLs are then injected
# into the orchestrator, which is the only public entrypoint. The orchestrator's
# runtime service account is granted roles/run.invoker on each leaf so it can
# mint OIDC ID tokens and call them (HODARI_SERVICE_AUTH=iam).
#
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?set PROJECT_ID}"
REGION="${REGION:-us-central1}"
REPO="${REPO:-hodari}"
IMAGE="${IMAGE:-${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/agent:latest}"

# Runtime service account shared by all four services (create it once):
#   gcloud iam service-accounts create hodari-agents --project "$PROJECT_ID"
SA="${SA:-hodari-agents@${PROJECT_ID}.iam.gserviceaccount.com}"

# Secrets / env the agents need (Gemini via Vertex, Maps key, Mongo). These are
# passed through unchanged from the single-service setup. Prefer Secret Manager:
#   --set-secrets=GOOGLE_MAPS_API_KEY=hodari-maps-key:latest,MONGODB_URI=hodari-mongo-uri:latest
COMMON_ENV="GOOGLE_GENAI_USE_VERTEXAI=TRUE,GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=global,GEMINI_MODEL=${GEMINI_MODEL:-gemini-3.5-flash}"

# 0) Build + push the shared image (or use agents/cloudbuild.yaml):
#    gcloud builds submit --tag "$IMAGE" .

deploy_leaf () {
  local name="$1"        # planner | explorer | itinerary
  gcloud run deploy "hodari-${name}" \
    --image "$IMAGE" \
    --project "$PROJECT_ID" --region "$REGION" \
    --service-account "$SA" \
    --no-allow-unauthenticated \
    --set-env-vars "AGENT_SERVICE=${name},HODARI_SERVICE_AUTH=iam,${COMMON_ENV}" \
    --port 8080 --format 'value(status.url)'
}

echo "Deploying leaf services (private, IAM-only)…"
PLANNER_URL="$(deploy_leaf planner)"
EXPLORER_URL="$(deploy_leaf explorer)"
ITINERARY_URL="$(deploy_leaf itinerary)"

echo "  planner   -> $PLANNER_URL"
echo "  explorer  -> $EXPLORER_URL"
echo "  itinerary -> $ITINERARY_URL"

echo "Granting the orchestrator SA permission to invoke each leaf…"
for name in planner explorer itinerary; do
  gcloud run services add-iam-policy-binding "hodari-${name}" \
    --project "$PROJECT_ID" --region "$REGION" \
    --member "serviceAccount:${SA}" \
    --role roles/run.invoker
done

echo "Deploying orchestrator (public entrypoint)…"
gcloud run deploy hodari-orchestrator \
  --image "$IMAGE" \
  --project "$PROJECT_ID" --region "$REGION" \
  --service-account "$SA" \
  --allow-unauthenticated \
  --set-env-vars "AGENT_SERVICE=orchestrator,HODARI_SERVICE_AUTH=iam,PLANNER_SERVICE_URL=${PLANNER_URL},EXPLORER_SERVICE_URL=${EXPLORER_URL},ITINERARY_SERVICE_URL=${ITINERARY_URL},${COMMON_ENV}" \
  --port 8080

echo "Done. Point the client CHAT/agent base URL at the orchestrator service."
