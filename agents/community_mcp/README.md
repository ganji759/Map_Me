# Community MCP Server

Read-only MCP server that lets the Hodari ADK agents use community data
(profiles, shared pins, reviews, taste aggregates) as tools — instead of
calling the client's HTTP APIs — with a hard privacy boundary.

## Run

From `agents/` (same venv as the ADK server):

```powershell
# Env (PowerShell) — reuses the same Mongo URI as the rest of the stack
$env:MONGODB_URI = "<your atlas URI>"      # or MDB_MCP_CONNECTION_STRING
$env:MONGODB_DATABASE = "hodari"           # optional, default hodari
$env:COMMUNITY_MCP_PORT = "3200"           # optional, default 3200

# Preferred: the project venv
.venv\Scripts\python.exe -m community_mcp.server
# or, first-time / no venv:
py -3.12 -m community_mcp.server
```

Serves streamable-http MCP at `http://localhost:3200/mcp`
(`COMMUNITY_MCP_HOST` to change the bind address).

## Wiring into the agent

The orchestrator picks the toolset up only when opted in — set either of
these before starting the ADK server (see `agents/.env.example`):

```
COMMUNITY_MCP_URL=http://localhost:3200/mcp   # explicit URL, or
COMMUNITY_MCP_ENABLED=1                       # use the default localhost URL
```

When neither is set (or toolset init fails) the agent starts normally
without community tools — a downed community server never breaks startup.

## Tools exposed (all read-only)

| Tool | Returns |
|---|---|
| `get_user_profile(handle_or_user_id)` | handle, name, bio, home_country, budget_tier, dietary, stats (pin/review counts); location only if the user shares it |
| `search_users(query)` | up to 20 discoverable users matching a handle/name prefix |
| `list_user_pins(user_id)` | that user's shared pins (place name, coords, note) |
| `list_place_reviews(place_id)` | community reviews: rating, text, author handle |
| `get_taste_profile(user_id)` | top categories from pins+reviews (joined via the `places` collection), avg rating given, 5 most recent reviews |

## Privacy boundary (non-negotiable)

- **No tool reads the `messages` or `conversations` collections.** Private
  chats are E2E-encrypted client-side; even ciphertext and conversation
  metadata are off-limits to agents. `DENYLISTED_COLLECTIONS` in `server.py`
  is enforced in the `_coll()` collection accessor (raises `PermissionError`)
  and asserted by `agents/tests/test_community_mcp.py` against every
  registered tool.
- **User field allowlist.** `email`, `password_hash`, tokens, and `pubkey`
  are never returned. `location` is returned only when `share_location` is
  true. Non-discoverable users are invisible to all tools.
- Input ids are validated as plain short strings (`_as_id`) before touching
  any Mongo filter.

## Tests

```powershell
cd agents
.venv\Scripts\python.exe -m pytest tests/test_community_mcp.py -q
```
