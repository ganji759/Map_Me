# Performance Optimization Plan for Hodari

## Goal

Reduce planning latency and improve perceived responsiveness. Long-term target: under 60s wall-clock for typical queries; under 30s only after architectural LLM reductions (Phase C).

**Do not optimize blindly.** Profile first, then fix what the trace proves is slow.

---

## Baseline (measured 2026-06-06)

**Query:** vegetarian lunch near Camp Nou, Barcelona, ~2 hours, ~$60 budget.

| Component | Time | Notes |
|---|---:|---|
| **Total wall time** | **230 s** | Single `/run` against local ADK |
| Gemini API (`generateContent`) | ~148 s (64%) | **13 calls** across orchestrator + pipeline |
| Mongo MCP + embeddings | ~44 s | `load_user_profile`, vector lookups, `save_preference` ×3 |
| Maps MCP | ~18 s | `search_places` ×5, `lookup_weather`, `compute_routes` ×2 |
| MCP handshakes / gaps | ~20 s | Session setup between toolsets |

### Gemini call breakdown

| Agent | LLM rounds | ~Duration |
|---|---:|---:|
| Orchestrator | 4 | ~43 s |
| Planner | 1 | ~8 s |
| Explorer | 4 | ~56 s (one call: 29 s) |
| Itinerary | 4 | ~41 s |

### Pipeline black box

`hodari_pipeline` (AgentTool) blocks for **~147 s**. Inner sub-agent events do not stream to the client today.

### Myths eliminated by this trace

- Not primarily a Maps problem (~18 s)
- Not primarily a Mongo problem (~44 s, much of it embeddings)
- Not a Cloud Run or GPU problem (API-bound Gemini waits)
- Sequential Planner → Explorer → Itinerary is **not** the bottleneck (dependencies are real; Explorer already parallelizes some `search_places` calls)

### Real bottleneck

> Cumulative cost of many LLM-mediated steps and embedding-assisted auxiliary operations on the critical path.

The question is not “can we parallelize agents?” but **“does each step require an LLM?”**

---

## Revised roadmap

### Phase A — Fast wins (days)

Highest value per engineering hour. Implement before building a full token profiler (cleaner measurements after obvious waste is removed).

#### A1. Stream progress events (Priority 1 — UX)

**Problem:** User sees ~147 s of silence while `hodari_pipeline` runs inside `AgentTool`.

**Target UX (even if wall-clock stays ~230 s):**

```
✓ Loading profile
✓ Planning your trip
✓ Searching nearby places
✓ Evaluating candidates
✓ Building your itinerary
✓ Calculating routes
✓ Preparing recommendations
```

**Files:**

- `agents/hodari/agent.py` — emit progress from pipeline wrapper or sub-agent callbacks
- `client/lib/stream.ts` — parse progress events (extend `AGENT_LABELS` / `StreamChunk`)
- `client/lib/types.ts` — progress chunk type if needed
- `client/components/ChatPanel.tsx` — render step list during planning

**Note:** With `AgentTool`, inner `planner_agent` / `explorer_agent` / `itinerary_agent` events may not reach SSE unless the pipeline wrapper forwards them or a custom tool emits heartbeat events.

#### A2. Skip vector search for unseeded cities (Priority 2 — evidence-backed)

**Problem:** Trace showed `find_places_by_vector` for Barcelona → `_embed()` + Mongo aggregate → **0 results** (~8.5 s wasted) before Maps search anyway.

**Fix:** Before `_embed()` in `find_places_by_vector`, check canonical city against seeded host cities (`_CITY_ALIASES` / `places_data.py`). Return `[]` immediately if not seeded.

**Files:**

- `agents/hodari/tools/places_tools.py`

**Optional:** Same early-exit for `find_similar_preferences` when user has no interaction history (new user).

#### A3. Move preference saves off the critical path (Priority 3 — perceived latency)

**Problem:** Orchestrator STEP 5 blocks the final reply on `save_preference` × stops (~25 s). Each call runs `_embed()` + MCP `update-many`.

**Preferred flow:**

```
Generate itinerary → Present answer → Background: save preferences
```

**Files:**

- `agents/hodari/agent.py` — remove STEP 5 from blocking instruction; note saves happen async
- `agents/hodari/tools/mongo_tools.py` — optional `save_preferences_batch(stops)` tool

#### A4. Batch embeddings where possible

When saves remain synchronous (fallback), batch multiple stop embeds or defer embedding to a background job. Reduces per-stop ~8.5 s overhead.

**Files:**

- `agents/hodari/tools/mongo_tools.py`

---

### Phase B — Observability (days)

Build **after Phase A** so profiles reflect a cleaner baseline.

| Item | Purpose |
|---|---|
| Per-agent token accounting | Input/output/thought tokens per Gemini call |
| Per-call latency breakdown | Which call is the 29 s Explorer round? |
| Thought-token tracking | Orchestrator thought tokens grew 120 → 623 on tool turns |
| Tool-call timing | Separate embed vs MCP vs Maps per invocation |

**Output format:**

| Gemini call | Agent | Input tokens | Output tokens | Thought tokens | Duration |
|---|---|---:|---:|---:|---:|
| #1 | Orchestrator | 1,432 | 12 | 120 | 8.1 s |
| … | … | … | … | … | … |

Pipeline-internal calls require instrumentation inside `hodari_pipeline` (not visible in top-level `/run` events today).

---

### Phase C — Architecture (weeks)

Reduce LLM involvement for deterministic work. This is how 13 calls → 4–5 calls becomes realistic (~60–90 s, not prompt tweaks).

#### C1. List-vs-itinerary router — **implemented**

**Evidence (2026-06-06 trace):** *"locate 4 restaurants near the World Cup first-match stadium"* ran Planner → Explorer → Itinerary → Weather → 7 routes → 9 itinerary LLM rounds (~94 s itinerary LLM alone, 192 s wall).

**Fix:** `classify_intent()` in `agents/hodari/intent.py` routes before `hodari_pipeline`:

| Intent | Path | Skips |
|---|---|---|
| `LIST_DISCOVERY` | `discover_places()` — one Maps search + Python rank | Planner, Explorer, Itinerary, routes, weather |
| `ITINERARY_PLANNING` | Full `SequentialAgent` pipeline (unchanged) | — |

**Telemetry:** `intent_type` logged on every request (`HODARI intent_type=…` + profile summary line).

**Files:** `intent.py`, `tools/discovery.py`, `tools/maps_client.py`, `tools/pipeline_tool.py`, `telemetry.py`, orchestrator instructions in `agent.py`.

**Benchmark (run after ADK restart):**

| Query | Expected intent | Expected LLM calls |
|---|---|---|
| A: *Find 4 restaurants near Camp Nou* | `LIST_DISCOVERY` | ~2–4 (orchestrator only) |
| B: *Plan a 3-hour lunch itinerary near Camp Nou* | `ITINERARY_PLANNING` | ~13–15 (full pipeline) |

#### C2+ — remaining architecture items

| Item | Approach | Status |
|---|---|---|
| Slim tool payloads before reinjection | Truncate Maps/route JSON in ADK tool responses | Not started |
| Dedupe vector lookups per run | Cache `find_similar_preferences` in session state | Not started |
| Deterministic rank/filter (itinerary path) | Python over Explorer candidates | Partial (fast path only) |
| Route assembly | `compute_routes` results + sorting in code | Not started |
| Structured plan | One `generate_content` with `Plan` schema | Not started |

**Not the first move:** collapsing all agents into one prompt without replacing ADK tool loops.

---

### Phase D — Later wins (when justified)

| Item | When |
|---|---|
| Cache `search_places` / `compute_routes` | Repeat queries, production traffic |
| Seed additional cities in `places` | When users query outside World Cup host cities |
| Redis / distributed cache | Production deployment, not local dev |
| Pre-compute common query embeddings | Analytics show repeat patterns |

---

## Deprioritized (trace did not support as primary levers)

1. **Parallelize Planner + Explorer** — wrong bottleneck; dependencies are real
2. **Cloud Run GPUs** — Gemini runs on Vertex; local GPU idle during API waits
3. **Redis-first caching** — helps repeats, not cold Barcelona queries
4. **Maps MCP batching alone** — only ~18 s in baseline trace

---

## Expected impact (realistic)

| Phase | Wall-clock | Perceived |
|---|---|---|
| Baseline | ~230 s | ~230 s (silence) |
| Phase A only | ~195–210 s | **Much better** (streaming + ~25 s saves off path + ~8 s skip vector) |
| Phase A + C | ~60–90 s | Good with streaming |
| Phase A + C + D | ~30–60 s | Production-grade for complex plans |

Phase A alone will **not** hit a 30 s wall-clock target. Phase C is required.

---

## Files by phase

**Phase A**

1. `agents/hodari/tools/places_tools.py`
2. `agents/hodari/agent.py`
3. `agents/hodari/tools/mongo_tools.py`
4. `client/lib/stream.ts`
5. `client/lib/types.ts`
6. `client/components/ChatPanel.tsx`

**Phase B**

7. New `agents/hodari/telemetry.py` (or ADK callback hooks)

**Phase C**

8. `agents/hodari/intent.py` — list vs itinerary classifier
9. `agents/hodari/tools/discovery.py` — fast LIST_DISCOVERY path
10. `agents/hodari/tools/maps_client.py` — direct Maps MCP for discovery
11. `agents/hodari/tools/pipeline_tool.py` — routing entry point
12. `agents/hodari/sub_agents/*.py` — slim or replace (itinerary path)

**Phase D**

10. `agents/hodari/tools/cache.py`
11. `agents/hodari/tools/maps_mcp.py`

---

## Testing

1. Re-run baseline probe (`/run` + ADK logs) after each phase
2. Compare: total time, Gemini call count, perceived steps in UI
3. Test unseeded city (Barcelona) and seeded city (Dallas) for vector skip
4. Verify preferences still persist after background saves

---

## Raw probe artifacts

- Events: `%TEMP%/hodari_probe_<session>.json`
- ADK server logs: `Sending out request` / `VECTOR_SEARCH` / Maps MCP lines
- Session state keys: `plan`, `candidates`, `itinerary`
