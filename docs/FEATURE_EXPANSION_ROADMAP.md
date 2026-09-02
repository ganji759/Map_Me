# Hodari — Expansion Feature Roadmap (from founder chat, 2026-07-06)

Expanding Hodari beyond a World Cup stadium-finder into a general AI+Map
discovery/search product with a social layer and an ad-based revenue model.

Ordered **low priority → high priority**. Each entry lists why it came up, the
build effort, whether it fits the current 4-agent architecture (`CLAUDE.md`:
"four agents; keep it at four"), and what Claude Code resourcing to use.

Status legend: ☐ planned · ◐ in progress · ☑ shipped

---

## P4 (low) — Beta tester feedback loop  ☐

**What:** In-app feedback widget (thumbs up/down + free-text on any agent
response or place card) writing to a new `feedback` Mongo collection; simple
`/admin/feedback` page to read it back.
**Effort:** S. **Architecture fit:** clean — new tool + collection, no agent count change.
**Claude Code allocation:** 1 general-purpose subagent, single session. Reuses
existing `save_preference`-style write pattern in `tools/mongo_tools.py`.

---

## P3 — Video-based place discovery (TikTok/YouTube surfacing)  ☐

**What:** When Explorer returns a candidate place, attach 1–2 relevant short-form
video links (YouTube Shorts/TikTok oEmbed or web search restricted to those
domains) so the place card shows a video preview, not just text+photos.
**Effort:** M. **Risk:** no official TikTok search API without a business
partnership; realistic path is YouTube Data API (has a free quota) for v1, TikTok
deferred. **Architecture fit:** additive tool on Explorer (`web_search`-style
call), doesn't add an agent.
**Claude Code allocation:** 1 subagent scoped to `agents/hodari/tools/` +
`sub_agents/explorer.py`, plus a client card-UI subagent for the video embed.
Isolate in a worktree since it touches both backend and frontend.

---

## P2 — Ads / "featured placement" monetization  ☐

**What:** A `sponsored` flag + tier on `places` documents; Explorer ranking
boosts sponsored places *only when they still match* the user's stated
constraints (never override relevance — a mismatch erodes trust fast); place
cards get a subtle "Featured" badge for disclosure/compliance.
**Effort:** M–L (ranking logic + a merchant-facing "claim this listing" flow +
billing hook). **Architecture fit:** extends Explorer ranking + billing; no new
agent needed, but is a second revenue lane alongside the credit-pack model —
worth a product decision on priority vs. subscription revenue before building.
**Claude Code allocation:** 2-phase — (1) 1 subagent for ranking/schema change
in `tools/discovery.py`; (2) separate subagent for a merchant self-serve page
under `client/app/merchant/`, once ranking is proven not to hurt relevance.

---

## P1 — Scope expansion: general place search, not just World Cup  ☐
**From chat:** "My idea is not only [about the] World Cup. It must be for every
search using AI and the Map... my very first idea was any places, but I framed
it to World Cup to see if it can be something I can do."
**What:** Decouple the product framing from the tournament: generalize
`world_cup_venues`/fixture-anchored planning (Phase 4 in `CAPABILITIES_ROADMAP.md`)
into an optional mode rather than the default frame; rewrite landing copy from
"World Cup companion" to "AI place discovery" with World Cup as a launch
vertical, not the whole product.
**Effort:** M (mostly copy/positioning + making fixture-awareness conditional,
not a rewrite of the agent pipeline — the search/itinerary core already works
for any place). **Architecture fit:** clean, since Explorer/Itinerary never
hard-required World Cup data; it was always additive context.
**Claude Code allocation:** 1 subagent for landing/copy (`client/app/page.tsx`,
`components/landing/`), 1 subagent for making `agent.py`'s World Cup framing
conditional. Do this **before** P0 below — the community feature reads
differently framed as "a city" vs. "a stadium."

---

## P0 (high) — Community layer: connected users, shared pins, chat  ☐
**From chat:** "Integrate a user/community chat plus on the map, so that two or
more people that are connected can pin locations, exchange reviews, chat and
even more." This is the idea Salomon called "crazy" and is the biggest strategic
bet in the conversation — it's what turns Hodari from a solo search tool into a
network product (and the strongest answer to Salomon's "would I pay for this
given free alternatives" objection — search engines are commoditized, a social
graph isn't).
**What, phased:**
1. **Connections** — friend/follow model on top of existing `users` collection.
2. **Shared pins** — a place saved by user A can be shared to a connection;
   shows on the recipient's map with attribution.
3. **Reviews between connections** — lightweight review/comment on a shared pin
   (not a public Yelp-style review system yet — start closed-network).
4. **Presence-lite chat** — text chat scoped to a shared pin/itinerary, not a
   general DM inbox (keeps scope bounded).
**Effort:** L+ (largest item here — new collections `connections`, `shared_pins`,
`messages`; realtime or polling delivery; new UI surfaces for map + chat).
**Architecture fit:** ⚠️ **this is the one item that stresses "four agents; keep
it at four."** None of this needs an LLM agent — it's CRUD + realtime, not
reasoning — so it should be built as **plain Next.js API routes + MongoDB**,
sitting *beside* the 4-agent pipeline, not as a 5th agent. Flag this explicitly
before starting so it isn't accidentally scoped as agent work.
**Claude Code allocation:** this is the one item worth a dedicated multi-session
build, not a single subagent call:
- 1 subagent for data model + API routes (`connections`, `shared_pins`, `messages`)
- 1 subagent for map UI (pin sharing, presence indicators) — builds on existing
  `PlaceStack.tsx` / `MapView.tsx` patterns from the map_control work
- 1 subagent for chat UI — reuse the existing chat panel's streaming patterns
  where possible instead of a new component from scratch
- Recommend running these as a **worktree-isolated `general-purpose` fan-out**
  (they touch disjoint files) once the data model subagent lands first, since
  the UI work depends on the schema.

---

## Sequencing note
Business-wise, P0 (community) is the differentiator and P1 (scope expansion) is
what makes P0 make sense — do P1 first since it's cheap and reframes everything
downstream. P4–P2 can run in parallel with either since they touch different
files (feedback widget, video cards, ads ranking). Don't start P0 until the
"5th agent vs. plain CRUD" architecture question above is confirmed.
