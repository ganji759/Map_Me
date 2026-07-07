# Lightweight sidecar image for the community MCP server. Deliberately
# separate from the main hodari/ agent image (agents/Dockerfile) — this
# service only needs `mcp` + `pymongo`, not the full ADK/Vertex stack, so
# keeping it standalone avoids bloating cold-start time and image size for
# both containers.
#
# Build from the `agents/` directory (same context as the main agent image):
#   docker build -f community_mcp/Dockerfile -t community-mcp .
FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir "mcp>=1.0.0" "pymongo>=4.6.0"

COPY community_mcp/ community_mcp/

# Cloud Run sidecars share a network namespace with the main container, so
# binding loopback here is reachable at localhost:3200 from hodari-agent —
# mirrors the existing mongodb-mcp sidecar. No public port is exposed.
ENV COMMUNITY_MCP_HOST=127.0.0.1
ENV COMMUNITY_MCP_PORT=3200

CMD ["python", "-m", "community_mcp.server"]
