import os
import sys

# Make the agents/ directory importable as the package root (hodari lives here)
sys.path.insert(0, os.path.dirname(__file__))

# Importing hodari builds the agent tree, and building the Maps toolset reads
# GOOGLE_MAPS_API_KEY. Tests never call the Maps MCP server, so give the
# variable a placeholder when the environment does not set one. This keeps the
# suite runnable on a fresh clone with no .env file, and in CI.
os.environ.setdefault("GOOGLE_MAPS_API_KEY", "test-placeholder-key")
