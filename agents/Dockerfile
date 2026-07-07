# ── Stage 1: dependency builder ───────────────────────────────────────────────
FROM python:3.12-slim AS builder

# System packages needed for cryptography / google-auth wheels
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libssl-dev \
        libffi-dev \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt


# ── Stage 2: runtime image ────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

# Runtime system libraries for google-auth / cryptography
RUN apt-get update && apt-get install -y --no-install-recommends \
        libssl3 \
        libffi8 \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy pip-installed packages from builder
COPY --from=builder /install /usr/local

# The ADK expects to find the agent packages as importable Python packages
# relative to the working directory.  We set WORKDIR to /app/agents so that
# both `hodari` and `services/*` are directly importable.
WORKDIR /app/agents

# Copy only the two package trees the services need
COPY hodari/ hodari/
COPY services/ services/

# Default port (Cloud Run injects PORT at runtime; this is the fallback)
ENV PORT=8080

# Which service this container represents.  Set per Cloud Run service in the
# YAML (planner | explorer | itinerary | orchestrator).
# Each container serves exactly one agent; Cloud Run scales them independently.
ENV AGENT_SERVICE=orchestrator

# Use sh -c so ${AGENT_SERVICE} and ${PORT} expand at container start time.
# Passing services/${AGENT_SERVICE} tells ADK to load that specific package's
# root_agent (e.g. services/planner/__init__.py). ADK sees a single-agent dir,
# so the exposed ADK app name is the leaf folder (planner | explorer | itinerary
# | orchestrator) — which is exactly what the orchestrator's HTTP client targets.
# AGENT_SERVICE=hodari is the MVP monolith and lives at the top level (hodari/),
# not under services/, so fall back to that path when services/${AGENT_SERVICE}
# doesn't exist in the image.
CMD ["sh", "-c", "if [ -d \"services/${AGENT_SERVICE}\" ]; then adk api_server services/${AGENT_SERVICE} --port ${PORT} --host 0.0.0.0; else adk api_server ${AGENT_SERVICE} --port ${PORT} --host 0.0.0.0; fi"]
