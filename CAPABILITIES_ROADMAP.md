# Hodari — Agent Capabilities Roadmap

Status legend: ☐ planned · ◐ in progress · ☑ shipped
Ordered **easiest to ship → hardest**. Build top-down; deploy each phase.

Context: Hodari is a 4-agent World Cup 2026 tourist guide. Today the agent can
search places, build itineraries, route (walk/drive), save places, control the
map (focus/keep-only/route), and annotate the map (colored pins + circles).
These phases extend that toward a genuinely useful match-day companion.

---

## Phase 1 — Weather-aware suggestions  ☐
**Why:** Tourists plan around rain/heat; trivial to add — the capability already exists.
**How:** The Maps Grounding Lite MCP already exposes `lookup_weather`
(`agents/hodari/tools/maps_mcp.py`). Give the orchestrator a `lookup_weather`
toolset and instruct it to check weather when the user asks, or when planning an
outdoor day, and to suggest indoor alternatives / reorder stops accordingly.
**Files:** `agents/hodari/agent.py` (tool + instruction).
**Effort:** XS.

## Phase 2 — "Open now" / opening-hours awareness  ☐
**Why:** Don't recommend closed venues; warn "closes at 21:00".
**How:** `search_places` already returns hours/`open_now`. Carry them through the
discovery ranking (`tools/discovery.py`), surface in candidates, and instruct the
presenter to flag open/closed and de-prioritise closed places for the stated time.
**Files:** `tools/discovery.py`, `sub_agents/explorer.py`, `agent.py`, client place card.
**Effort:** S.

## Phase 3 — Hard dietary & accessibility filters  ☐
**Why:** Halal/vegetarian/wheelchair are requirements, not hints.
**How:** Profile already stores `dietary` + `accessibility`. Make Planner encode
them as hard constraints and Explorer filter (not just boost) on them; presenter
states how each pick meets them.
**Files:** `sub_agents/planner.py`, `sub_agents/explorer.py`, `tools/discovery.py`.
**Effort:** S–M.

## Phase 4 — Match-schedule awareness  ☐  ← biggest differentiator
**Why:** It's a World Cup app; everything should anchor to fixtures (team, venue,
date, kickoff) and host cities/stadiums.
**How:** Curated table of the 16 host cities + stadiums (known, static). A
`lookup_fixtures` tool that answers by team/city/date — backed by the curated
venues plus `web_search` for live fixtures once the schedule firms up. Instruct
the agent to anchor plans to match day (arrive-by, pre/post-match meal near venue).
**Files:** new `tools/fixtures.py` (+ venue data), `agent.py`, Explorer location bias.
**Effort:** M.

## Phase 5 — Transit / public-transport directions to stadiums  ☐
**Why:** On match day people take the metro/train, not a car. Routing is WALK/DRIVE only.
**How:** Add a TRANSIT travel mode. Grounding Lite `compute_routes` may not do
transit, so use the Google Directions API (transit mode) in the client route
layer (mirrors `OriginToPlaceRoute` in `MapView.tsx`); add a `transit` option to
the `route` map action and the agent instruction.
**Files:** `components/MapView.tsx`, `lib/routing.ts`, `lib/mapActions.ts`,
`tools/map_control.py`, `agent.py`. Needs Directions API enabled on the key.
**Effort:** M–L.

## Phase 6 — Deeper taste personalization  ☐
**Why:** `find_similar_preferences` (vector) exists but is shallow; saves are now
reliable, so the signal is good.
**How:** Surface "because you liked X" rationale; rerank candidates by the user's
saved/liked history more aggressively; let the agent reference the saved list.
**Files:** `sub_agents/explorer.py`, `tools/mongo_tools.py`, presenter instruction.
**Effort:** M.

## Phase 7 — Map clustering + "walk radius from the stadium"  ☐
**Why:** Builds on the new annotation layer; clearer dense maps + match-day radius.
**How:** Marker clustering for many pins; a one-call "circle N-minute walk around
venue" annotation.
**Files:** `components/MapView.tsx`, `lib/mapActions.ts`, `tools/map_control.py`.
**Effort:** M.

## Phase 8 — Multi-day trip planning → saved calendar  ☐
**Why:** Real trips span the tournament (e.g. a September visit), not one afternoon.
**How:** Agent builds a day-by-day plan and writes dated entries to the existing
`/saved` calendar (reminders with `visit_date`). Surface as a multi-day view.
**Files:** `tools/mongo_tools.py` (write reminders), `agent.py`, `app/saved/page.tsx`.
**Effort:** L.

## Phase 9 — (Deferred / product decision) Booking + export  ☐
Booking/reservation deep-links, add-to-calendar (.ics), shareable itinerary link.
Marked out-of-MVP in `CLAUDE.md`; revisit as a real "Phase 2" once the above land.
**Effort:** L+.

---

## Progress log
- 2026-06-13: Roadmap created. Building Phase 1 (weather) first.
