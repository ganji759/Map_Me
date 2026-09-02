# Contributing to Hodari

Thanks for your interest in Hodari. This guide tells you how to set up the
project, what we expect in a change, and how to get it merged.

By contributing you agree that your work is licensed under the
[Apache License 2.0](./LICENSE).

---

## Ways to help

- **Report a bug.** Open an issue with the bug template. Include the steps, the
  expected result, and the actual result.
- **Suggest a feature.** Open an issue with the feature template first. Agree on
  the approach before you write code.
- **Improve the docs.** Small doc fixes need no prior issue. Send the pull
  request.
- **Fix an open issue.** Comment on the issue first so two people do not do the
  same work.

---

## Set up a development environment

You need Node.js 20 or later, Python 3.12, and a MongoDB Atlas cluster.

Read [README.md](./README.md) for the full setup. The short version:

```bash
# 1. MongoDB MCP server (keep this running in its own terminal)
MDB_MCP_CONNECTION_STRING="<your atlas uri>" \
  npx mongodb-mcp-server --transport http --httpPort=3100

# 2. Agent runtime
cd agents
python3.12 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env               # then fill in your keys
.venv/bin/adk api_server hodari    # http://localhost:8000

# 3. Frontend
cd client
npm install
cp .env.local.example .env.local   # then fill in your keys
npm run dev                        # http://localhost:3000
```

You need your own API keys. See the environment variable table in the README.
Never put real keys in a file that git tracks.

---

## Before you open a pull request

Run these and make sure they pass:

```bash
cd client && npm run lint && npm run build
cd agents && source .venv/bin/activate && python -m pytest
```

Add a test for any behaviour you change in `agents/`. Tests live in
`agents/tests/`.

---

## Code style

- **Match the file you are editing.** Follow its naming, its comment density,
  and its structure.
- **Python:** 4-space indent, type hints on public functions, Pydantic models
  for anything that crosses an agent boundary.
- **TypeScript:** strict mode, no `any` unless you write a comment that explains
  it. Components go in `client/components/`.
- **Keep the agent count at four.** Each new agent adds latency between agents.
  Add a tool to an existing agent instead.
- **Never log a secret,** a full connection string, or raw user content.

`.editorconfig` sets the indent and the line endings. Most editors read it
automatically.

---

## Commit messages

One idea per commit. Write the subject line as a command, with no full stop, and
keep it to 72 characters or fewer.

```
fix: stop the map from resetting when the chat panel resizes

The resize handler rebuilt the map instance on every drag frame. It now
only recomputes the bounds. This keeps the loaded itinerary on screen.
```

Use these prefixes: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`.

---

## Pull requests

1. Fork the repository and make a branch from `main`.
2. Make your change. Keep it to one topic.
3. Run the lint, the build, and the tests.
4. Fill in the pull request template. Say what changed and why.
5. Add a screenshot or a short clip for any user interface change.

A maintainer reviews the pull request. Expect a first reply within a week.

---

## Project layout

| Path | What it holds |
|---|---|
| `agents/hodari/` | The four agents, their tools, and their schemas |
| `agents/tests/` | Python tests |
| `client/app/` | Next.js routes and API handlers |
| `client/components/` | React components |
| `infra/` | Cloud Run service templates |
| `docs/` | Architecture, billing, security, and roadmap notes |

---

## Security

Do not open a public issue for a security problem. Read
[SECURITY.md](./SECURITY.md) instead.
