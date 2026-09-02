# Hodari — UI Overhaul Sprint (2 days)

**Owner / Engineer:** Pacifique.
**Goal:** A heavy, deliberate UI upgrade across login, saved preferences, the two AI interaction modes (chat + voice), a new community page, and a compact in-chat map layout — **without touching the backend** and **without AI slop**.

> Read this whole file before you write a single line of code. If anything is unclear, comment on the GitHub issue for your stream and tag the Engineer. Do not guess on backend behavior.

---

## 0. TL;DR — who owns what

| # | Person | Stream | Primary deliverable |
|---|--------|--------|---------------------|
| **P1** | **Pacifique · @ganji759** | **Lead + AI-agent owner** | Design-system foundation, the **AI agent** (`agents/hodari/`: new tools/agent-actions, intent routing, community recommender, agent-side caching), secrets, shared contracts, reviews every PR. **Not** everyone's backend — each stream below is full-stack. |
| **P2** | **@Christian83995** | **Auth & Onboarding** | Login page (Google / GitHub / Email) + Auth.js + onboarding — UI **and** backend |
| **P3** | **@shaka-cmd** | **Saved Preferences & Analytics** | Saved page: places, photos, analytics, reminder UI the agent can drive — UI **and** backend |
| **P4** | **@Jocos12** | **Conversational UX** | Chat + Voice redesign with motion, voice latency captions, **compact map + place-detail layout** — UI **and** its API routes |
| **P5** | **@bienvenu123** | **Community & Social** | Community page + backend: presence map (opt-in/private), search, connections, profile status |

> Streams are assigned (issues #4–#7). Each owner builds their stream **full-stack** (frontend + backend). Only AI-agent changes (`agents/hodari/`) and secrets route to @ganji759 — see §1 and §6.

**Timeline:** 2 working days. Day 1 = foundation + build. Day 2 = build + integrate + polish + reports. Checkpoints in §9.

**Repos (important):** The team's integration hub is the **upstream** `Jocos12/Tourist-AI-Agent-` (public) — that's where issues, the board, and `main` live, and where every PR lands. `ganji759/Map_Me` is **Pacifique's personal fork** (a working copy), *not* where the team collaborates. **Do all sprint work against the upstream.** Frontend lives in `client/` (Next.js 15 App Router, React 18, TypeScript, Tailwind 3.4).

---

## 1. Hard rules (non-negotiable)

1. **Own your task full-stack — except the AI agent.** Build the frontend *and* the backend your feature needs (Next.js API routes, server code, your feature's DB reads/writes). The **one carve-out** is the **AI agent**: the Python ADK code in `agents/hodari/` (agents, tools, `map_control`-style actions, intent routing, prompts, the recommender). If your task needs the agent to do something new — or needs a **secret** only the Engineer holds → label it `needs-agent`, assign **@ganji759**, agree the contract, and build your side against a **mock** until it lands. **Don't edit `agents/hodari/` yourself.**
2. **No vibe coding.** Every piece of work follows: **GitHub issue → branch → small PR → review by Engineer → merge** — all on the upstream `Jocos12/Tourist-AI-Agent-`. No pushing straight to `main`. No 1,500-line PRs. If you can't describe what a PR does in two sentences, split it.
3. **No AI slop.** See §3 for the explicit quality bar. Generic purple-gradient hero + emoji-as-icons + lorem ipsum + three different button styles = rejected in review.
4. **Every person ships two docs per stream:** `STATUS.md` (what is done, how to run it, what's left) and `REPORT.md` (limitations, what you'd do better with more time, risks). Templates + location in §10. These are graded the same as the code.
5. **Design once, reuse everywhere.** Build on the shared design system (§4). Do not invent a fourth card style.
6. **Coordinate on agent behavior, shared contracts, and secrets — not on ordinary backend.** What the AI agent returns, the data shape passed between agent and UI, and any credential the Engineer provisions: agree these with @ganji759 first. Your own feature's API and database are yours to design and build.

---

## 2. What we are building (plain English)

1. **Login page** — three ways in: **Google, GitHub, Email.**
2. **Saved Preferences page** — when a user saves a place, the AI agent can save it, attach a **calendar entry or reminder**, and manipulate those later. The page shows: saved restaurants, the list, **photos**, **analytics**, comments. (We must decide the right data source for photos/analytics — Maps API vs. anything else — see §6 / P3.)
3. **Caching to cut token cost** — if not already done. Token/LLM caching lives in the **AI agent**, so it's the Engineer's (P1) — see #8. Separately, each stream adds its own client/server read-caching for repeat fetches (photos, saved lists).
4. **Two AI modes, upgraded** — **Chat mode** and **Voice mode**, each dynamic with tasteful after-effects. Voice mode has real latency, so the screen must **show the voice (waveform) and the live text as the AI speaks** — never a frozen screen.
5. **Community page** — users opt in to appear on a map as "active"; can flip to **private / not visible**; can be **searched by name**, **connect**, and **chat**. A profile status can carry **restaurants visited + analytics + an experience comment**. **You build the page and its backend** (presence, connections, profiles, privacy). The one piece that's the Engineer's is the **AI recommender** (agent code) that later suggests aligned places using only non-private info.
6. **Compact map in chat** — we do **not** want the full map on screen every time. Default chat (both modes) shows a **small map box** plus a **small place-details box with pictures** beside/below it. The **full map** is triggered only when it matters. Spec + wireframes in §8.

---

## 3. The "No AI slop" bar (read twice)

A change is **slop** and will be sent back if it has any of these:

- More than **one** type scale or more than **two** font families.
- Inconsistent spacing — use the **4/8px scale** from the design tokens, not random `13px`, `17px`.
- **Emoji used as UI icons.** Use a real icon set (lucide-react, see §4).
- A giant generic gradient hero, glassmorphism-everywhere, or "✨ AI-powered" filler copy.
- Placeholder lorem ipsum left in a PR.
- Missing **states**: every list/data view needs **loading, empty, and error** states. No spinners-forever.
- Motion that's gratuitous (everything bouncing) **or** motion with no `prefers-reduced-motion` fallback.
- Inaccessible: no visible focus ring, contrast below WCAG AA, clickable `<div>`s instead of buttons, no `aria-label` on icon buttons.
- Not responsive: breaks at 360px wide (phone) or 1440px (laptop).

A change is **good** when: it uses the shared primitives, has all three data states, animates with purpose and a reduced-motion fallback, is keyboard-navigable, and looks intentional at 360px and 1440px. **When in doubt, copy a pattern from Linear, Vercel, Arc, or Google Maps — not from a random dribbble shot.**

---

## 4. Design system foundation (Day 0, shared — led by P1)

Before feature work, we lock a tiny design system so five people don't ship five visual languages. **P1 creates `feat/design-system` first; everyone branches off it.**

**Add these dev deps (frontend only):**
- `framer-motion` — motion (we currently have **none**; chat/voice "after effects" need it).
- `lucide-react` — icons (no emoji icons).
- (Optional) `@tanstack/react-query` or SWR — client caching of reads.

**Deliverables in `feat/design-system`:**
- `client/lib/design/tokens.ts` (or Tailwind theme extension): color, spacing (4/8 scale), radius, shadow, type scale, z-index, motion durations/easings.
- `client/components/ui/` primitives: `Button`, `Card`, `Input`, `Select`, `Modal`, `Sheet` (slide-over), `Toast`, `Avatar`, `Badge`, `Tabs`, `Skeleton`. Each with loading/disabled states.
- `client/components/ui/motion.ts` — shared variants (fade/slide/scale) **with a `prefers-reduced-motion` guard**.
- A `/_kitchen-sink` dev-only page rendering every primitive, so reviewers can eyeball consistency.

**Existing UI to reuse (do not rebuild from scratch):** `ChatPanel.tsx`, `MapView.tsx`, `PlaceDetailsPanel.tsx`, `PlaceStack.tsx`, `ItineraryStack.tsx`, `VoiceButton.tsx`, `VoiceOrb.tsx`, `CollapsedReply.tsx`, `ModelSwitcher.tsx`. Refactor them onto the new primitives; don't fork them.

> Everyone: **rebase onto `feat/design-system` once it merges** before pushing feature PRs. This avoids the worst merge conflicts (shared components/CSS).

---

## 5. Git workflow — and resources if you're new to it

All sprint work happens on the **upstream** repo `Jocos12/Tourist-AI-Agent-`, where you all have write access. Branch off `main`, PR back into `main`, get it reviewed, merge. We work like a team, not five people emailing zips.

**One-time remote setup**
- If you cloned the upstream directly (most of you), your `origin` already points at `Jocos12/Tourist-AI-Agent-` — nothing to do.
- If you work from a personal fork (Pacifique), add the upstream as a remote so branches go to the shared repo:
  ```
  git remote add upstream https://github.com/Jocos12/Tourist-AI-Agent-.git
  git fetch upstream
  ```

**The flow (assuming `origin` = the upstream)**
```
git checkout main && git pull
git checkout -b feat/<stream>-<short-desc>     # e.g. feat/auth-login-page
# ...work, commit small...
git push -u origin feat/auth-login-page
# open a PR on GitHub: base = Jocos12/Tourist-AI-Agent- : main  ->  request review from Pacifique
# address review comments -> reviewer merges -> delete the branch
```
Working from a fork instead? Push to `upstream` (not `origin`) and open the PR from your fork's branch into `Jocos12/Tourist-AI-Agent-:main`.

**Conventions**
- Branch names: `feat/<stream>-<thing>`, `fix/<thing>`, `chore/<thing>`. Stream prefixes: `auth`, `saved`, `chat`, `voice`, `community`, `ds` (design system).
- Commits: short imperative subject ("Add Google login button + Auth.js route"). Commit often; keep each commit coherent.
- PRs: **< ~400 lines** where possible. Title says what + why. Link the issue (`Closes #12`). Add a screenshot or screen-recording of the UI for every PR.
- **Never** force-push to `main`. **Never** merge your own PR — the Engineer reviews and merges.
- Pull `main` daily and rebase your branch to avoid drift.

**If you don't know GitHub yet — do these first (≈1 hour, do them, don't skim):**
- ▶ **GitHub Skills (interactive, best):** https://skills.github.com — do "Introduction to GitHub", "Resolve merge conflicts", "Review pull requests", "Communicate using Markdown".
- 📄 Create an issue: https://docs.github.com/en/issues/tracking-your-work-with-issues/creating-an-issue
- 📄 Create a branch: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-branches-in-your-repository/creating-and-deleting-branches-within-your-repository
- 📄 Open a pull request: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/creating-a-pull-request
- 📄 Resolve a merge conflict (command line): https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/addressing-merge-conflicts/resolving-a-merge-conflict-using-the-command-line
- ▶ Video crash course (YouTube): **freeCodeCamp — "Git and GitHub for Beginners – Crash Course"** (search that title if the link moves). Also the **GitHub** channel's "GitHub Flow" explainer.

**Merge conflicts, the short version:** pull `main` often. When Git marks a conflict, open the file, find the `<<<<<<<`/`=======`/`>>>>>>>` markers, keep the correct combined result, delete the markers, `git add` the file, then `git commit`. When in doubt, ask in the team channel before forcing anything — losing someone's work to a bad conflict resolution is the one unforgivable mistake.

---

## 6. What's yours vs. what's the AI agent's (read carefully)

You own your stream **full-stack**. Only two things route to the Engineer (@ganji759): **(a)** changes to the **AI agent** (`agents/hodari/`), and **(b)** **secrets** the Engineer provisions. Label those `needs-agent` and build against a mock until they land. Everything else below you build yourself.

- **Photos for saved places — P3 builds.** Use **Google Places API → Place Photos** (we're already on Google Maps Platform; `search_places` returns photo refs). You write the fetch/route — just get the **API key** from the Engineer (`needs-agent`: secret). **No web-scraping of Google Maps** (violates Maps Platform ToS; fragile; legal/cost risk).
- **Analytics on a saved place — P3 builds.** First-party only: derive from the user's `interactions` (liked/visited/saved/skipped counts, price mix, cuisine mix, timeline) + place metadata (rating, review count, price level). You build the aggregation; loop in the Engineer only if the **agent** must surface it.
- **Token-cost caching — Engineer.** Lives in the agent (Gemini context/prompt caching + a response cache for repeated `LIST_DISCOVERY`) → #8. Your own client/server read-caching is yours and does not reduce token cost by itself.
- **Auth providers — P2 builds.** You build the Auth.js backend + routes + session. From the Engineer (`needs-agent`: secret): **OAuth client IDs/secrets + callback URLs**, and sign-off on the `users` schema the agent reads. (Org bans plain API keys — OAuth creds are different, but still Engineer-provisioned.)
- **Community data — P5 builds; recommender — Engineer.** You build the community backend (presence, connections, profile status, privacy flags + APIs). The **AI recommender** is agent code → Engineer; expose **only public** fields to it and agree that contract.

---

## 7. Workstreams

Each stream below has: **scope**, **acceptance criteria**, **files**, **backend asks**, **priority order** (ship P0 first if time runs out), and **out of scope**.

### P1 — Lead / AI-agent owner (Pacifique · @ganji759)

You are **not** everyone's backend. You own the design-system, the **AI agent**, secrets, and review. Each other stream is full-stack on its own task.

**Scope**
- Day-0 (on the **upstream** `Jocos12/Tourist-AI-Agent-`): create `feat/design-system` (§4); ask the repo owner **@Jocos12** to protect `main` and add you as co-admin/maintainer; create the **GitHub Project board**.
- Own the **AI agent** work other streams depend on: new tools / `map_control`-style agent-actions (e.g. the reminder actions for P3), intent routing, **agent-side token-cost caching** (#8), and the **community recommender** (#7's agent half).
- Provision **secrets** (OAuth creds, Maps/Places key) and keep shared contracts in `client/lib/types.ts` authoritative.
- Answer `needs-agent` issues fast and review **every** PR.

**Acceptance**
- Design-system merged by end of Day-0 morning; `needs-agent` issues answered within a few hours (you're the bottleneck for agent work — stay responsive); board live.

**Out of scope:** the other streams' own frontend/backend — they build those; you review.

---

### P2 — Auth & Onboarding

**Scope**
- A real **login page** with three options: **Continue with Google**, **Continue with GitHub**, **Continue with email** (email = magic-link or email+password — confirm with Engineer which).
- Add **Auth.js (NextAuth v5)** scaffolding in `client/`: `app/login/page.tsx`, `app/(auth)/...`, an `auth.ts` config, route handlers, and a session provider in `app/layout.tsx`.
- Onboarding shell after first login (collect home country, languages, dietary, budget, accessibility — these map to the existing `users` profile fields; **confirm field names with Engineer**, don't invent).
- A header/avatar menu with sign-out, reused across all pages.

**Acceptance**
- All three buttons render and trigger the correct Auth.js flow (Google/GitHub may be stubbed with placeholder client IDs until the Engineer provides real ones — document that clearly).
- Loading/error states on every auth action (e.g., "GitHub is taking a moment…", "That email isn't valid").
- Keyboard + screen-reader accessible; works at 360px.
- Looks like a real product login (reference: Linear / Vercel login), **not** a centered form with a purple gradient.

**Files:** new `client/app/login/`, `client/auth.ts` (or `client/lib/auth.ts`), `client/app/layout.tsx` (session provider), shared `ui/Button`, `ui/Input`.

**You build the auth backend** (Auth.js config, routes, session). **From the Engineer (`needs-agent`):** OAuth client IDs/secrets + callback URLs (secret), and sign-off on the `users` schema the agent reads. Email strategy (magic-link vs password) is your call — flag it only if it affects the agent.

**Priority:** P0 email + page shell & layout → P1 Google → P1 GitHub → P2 onboarding form.

**Out of scope:** payments, multi-language (explicitly out per MVP scope), password reset flows beyond a stub.

---

### P3 — Saved Preferences & Analytics

**Scope**
- `app/saved/page.tsx`: the user's **saved places** as cards — photo, name, rating, price, cuisine, the user's own comment.
- **List + detail**: a list/grid of saved restaurants and a detail view (reuse/extend `PlaceDetailsPanel.tsx`) with a **photo gallery**.
- **Analytics** panel: simple, honest charts from first-party data (visits over time, price mix, cuisine mix, liked vs skipped). Use a tiny chart lib or hand-rolled SVG — no 200KB dashboard kit.
- **Calendar / reminder UI**: from a saved place, the user (or the agent) can attach a **planned visit (date/time)** or a **reminder**. Build the UI + a clean client-side contract so the **agent can create/edit/cancel** these (the agent manipulates them via the existing tool-action channel — coordinate the action shape with the Engineer, mirror how `map_control` actions flow through session state).
- All reads go through a client cache (react-query/SWR) to avoid refetch on every navigation.

**Acceptance**
- Saved list has loading/empty ("You haven't saved anything yet — ask Hodari to save a spot")/error states.
- Photo gallery is keyboard-navigable and lazy-loads images.
- Calendar/reminder entries render in a clear agenda view; creating/editing one is obvious; the data shape is documented for the agent to drive.
- Analytics never shows a fake number — if data is missing, the chart shows an empty state, not random bars.

**Files:** new `client/app/saved/`, extend `PlaceDetailsPanel.tsx`, new `ui/` cards/gallery/calendar; client cache layer.

**You build the saved-page backend** (storage, photo fetch, analytics aggregation per §6). **From the Engineer (`needs-agent`):** the Places **API key** (secret), and the **agent action schema** so Hodari can create/edit/cancel reminders (this part touches `agents/hodari/`).

**Priority:** P0 saved list + cards + photo → P1 detail gallery → P1 calendar/reminder UI → P2 analytics charts.

**Out of scope:** real calendar sync (Google Calendar) — explicitly out per MVP; build the in-app reminder UI only.

---

### P4 — Conversational UX (Chat + Voice + compact map)

**Scope**
- Redesign **Chat mode**: streaming message bubbles, the progress-event ticks the backend now streams ("✓ Searching nearby places…"), typing/skeleton states, smooth autoscroll, a polished composer. Reuse `ChatPanel.tsx`, `stream.ts`, `CollapsedReply.tsx`.
- Redesign **Voice mode**: a dynamic **waveform/orb** that reacts to mic + TTS (extend `VoiceOrb.tsx`/`VoiceButton.tsx`), and — critical — because **voice has latency**, show **live captions / streaming text of what the AI is saying while it speaks**, plus a clear "listening / thinking / speaking" state machine. The user must never stare at a dead screen.
- A clean **toggle between Chat and Voice** with a motion transition (framer-motion, reduced-motion fallback).
- Build the **compact map layout** (full spec + wireframes in §8): default chat shows a **small map box** + a **small place-details box with photos**, and a control to **expand to full map** and back. It must consume the **existing** agent map actions (`client/lib/mapActions.ts`, `client/lib/mapIntents.ts`, the `map_actions` session state from the backend `map_control` tool) — don't reinvent the map control channel.

**Acceptance**
- Voice mode shows: mic level while listening, a "thinking" state, and **word-by-word (or chunked) captions** while speaking, with the matching place pin/detail surfacing. Latency is masked, never hidden behind a frozen UI.
- Chat and Voice share one layout; switching modes animates, respects reduced-motion, and never loses the conversation.
- Compact map and full map both work; expand/collapse is one obvious control; the agent's `focus_place`/`route`/`open_map` actions still drive whichever map is visible.
- 360px: chat is usable, mini-map collapses gracefully (e.g., to a thumbnail strip).

**Files:** `ChatPanel.tsx`, `VoiceOrb.tsx`, `VoiceButton.tsx`, `MapView.tsx` (compact variant), `PlaceDetailsPanel.tsx`, `app/page.tsx` (layout), `lib/stream.ts`, `lib/mapActions.ts`/`mapIntents.ts` (consume only).

**You own the chat/voice UI and the Next API routes it calls** (`app/api/voice/*`). **Coordinate with the Engineer (`needs-agent`):** whether voice can **stream text chunks** for captions (may need a Gemini/agent-side change) and the Gemini **credentials**. Don't touch `agents/hodari/`.

**Priority:** P0 compact map + place-detail layout (this is the headline ask) → P1 voice live-captions + state machine → P1 chat polish/motion → P2 mode-switch transition.

**Out of scope:** changing what the agent says or how it routes (backend). New voices/models (backend).

---

### P5 — Community & Social

**Scope**
- `app/community/page.tsx`: a **map of active users** who opted in, with a prominent **visibility toggle** (Active & visible / Private / Invisible). Default to **private** — privacy is opt-in, not opt-out.
- **Search users by name**, view a profile, **connect**, and a **chat shell** (UI only; wiring is Engineer's).
- **Profile status**: a user can attach **restaurants visited + their analytics + an experience comment** to their public profile (reuse P3's place cards + analytics components — coordinate so you share, not duplicate).
- Clear, legible **privacy model in the UI**: a visible indicator of what's public vs private on the profile, and a settings panel. The AI recommender will only ever use the public fields — make "public" unmistakable in the UI.

**Acceptance**
- Presence map respects the visibility toggle in the UI (mocked state is fine): flipping to Private removes you from the map immediately.
- Search has empty/no-results/error states; connecting shows pending/connected states.
- Profile clearly separates **public** (recommendable) vs **private** (never used) info.
- Reuses design-system primitives and P3's card/analytics components.

**Files:** new `client/app/community/`, a `MapView` presence variant (coordinate with P4 on the shared map component), shared profile/card components, mock `client/lib/community.ts` contract.

**You build the community backend** (presence, connections, profile status, privacy storage + APIs). **From the Engineer (`needs-agent`):** the **AI recommender** is agent code — expose only **public** fields to it and agree that contract.

**Priority:** P0 page shell + visibility toggle + privacy model UI → P1 presence map → P1 search + profile → P2 connect/chat shell.

**Out of scope:** the **AI recommender** (agent code — Engineer). Real-time presence + DM delivery are yours if time allows; otherwise mock them and ship the UI + privacy model.

---

## 8. Compact map layout spec (referenced by P4, consumed by P5)

We don't want the full map dominating every screen. Two states:

**Default chat view (both modes)** — chat is the hero; map is a small contextual rail:

```
┌─────────────────────────────────────────────────────────┐
│  Hodari            [Chat | Voice]            ◷  ⛶ avatar  │
├──────────────────────────────────────┬──────────────────┤
│                                       │  ┌────────────┐  │
│   chat thread / voice captions        │  │  mini map  │  │  <- small map box
│   ▸ ✓ Searching nearby places…        │  │  📍 📍 📍   │  │     (tap ⛶ to expand)
│   ▸ "Here are 3 spots near Camp Nou"  │  └────────────┘  │
│                                       │  ┌────────────┐  │
│                                       │  │ place card │  │  <- place details + photos
│                                       │  │ 🖼 ★4.6 €€ │  │
│                                       │  └────────────┘  │
├──────────────────────────────────────┴──────────────────┤
│  [ message Hodari…                        ]   🎙  ➤       │
└─────────────────────────────────────────────────────────┘
```

**Full map view (triggered)** — only when the map matters (user taps expand, or an agent action like `open_map`/`route` requests it):

```
┌─────────────────────────────────────────────────────────┐
│  ⛶ collapse        full map + route + all pins           │
│  ████████████████████████████████████████████████████   │
│  ██  🗺  route polyline, all candidates, controls   ██   │
│  ████████████████████████████████████████████████████   │
│  ┌───────────── chat / place strip docked ────────────┐  │
└─────────────────────────────────────────────────────────┘
```

Rules:
- Default = compact. Full map is **opt-in** via an obvious expand control **or** an agent action.
- The mini-map and full-map are the **same component** in two sizes — not two implementations.
- Both honor the agent's existing actions (`focus_place`, `keep_only`, `route`, `clear_route`, `open_map`, `close_map`) from `map_control`. Wire to `lib/mapActions.ts`; don't fork the channel.
- On phone (360px): mini-map collapses to a thumbnail/peek that expands on tap.

---

## 9. Two-day timeline & checkpoints

**Day 1**
- **AM — Kickoff (30 min, all):** walk this doc, assign names, agree contracts. P1 ships `feat/design-system` + board + issues. Newcomers do the GitHub Skills modules (§5).
- **Midday:** everyone branches off `feat/design-system`, files any `needs-agent` issues (agent changes or secrets) so P1 can unblock in parallel, starts P0 scope.
- **EOD sync (15 min):** demo P0 progress, push first `STATUS.md`, flag blockers.

**Day 2**
- **AM:** finish P0, start P1 scope, open PRs early for review (don't hoard a huge PR for the end).
- **Midday integration:** merge order — design-system (already in) → auth shell → page routes → chat/voice + map → saved → community. Rebase, resolve conflicts (§5).
- **PM — polish (2–3h):** states, motion, responsive, accessibility pass against §3.
- **EOD:** final `STATUS.md` + `REPORT.md` per stream; demo; Engineer merges what passes review.

**If you fall behind:** ship your **P0** clean rather than P0–P2 half-broken. A polished login + compact-map layout beats five unfinished pages.

---

## 10. Required deliverables per person — STATUS.md & REPORT.md

Put them in `docs/ui-sprint/<your-name>/STATUS.md` and `docs/ui-sprint/<your-name>/REPORT.md`, committed on your branch.

**`STATUS.md` template**
```markdown
# <Stream> — Status (<your name>)
_Updated: <date time>_

## Done
- <feature> — <where it lives> — <PR #>

## In progress
- <feature> — <% / what's left>

## How to run / see it
- Branch: <branch>  ·  Route: <e.g. /login>
- Steps: <how a reviewer sees it locally>

## Blocked on
- <needs-agent issue #> — waiting on Engineer for <thing>
```

**`REPORT.md` template**
```markdown
# <Stream> — Report (<your name>)

## What I built & why it's shaped this way
<2–4 sentences, real reasoning>

## Limitations / known gaps
- <honest list — what's mocked, what's fragile, what's not accessible yet>

## What I'd do better with more time
- <concrete improvements, ranked>

## Decisions I need the Engineer to confirm
- <open questions>
```

Honesty scores higher than spin. "The voice captions are mocked because the speak route doesn't stream text yet — issue #19" is a great report line.

---

## 11. GitHub issues (filed on the upstream)

Live on `Jocos12/Tourist-AI-Agent-` and **assigned**: #4 @Christian83995 · #5 @shaka-cmd · #6 @Jocos12 · #7 @bienvenu123. #3 (design-system) and #8 (agent-side caching) are yours. Each feature owner is full-stack; only `needs-agent` items come to you.

- **[#9 — EPIC](https://github.com/Jocos12/Tourist-AI-Agent-/issues/9)** — sprint overview, global rules, checklist
- **[#3 — Design-system](https://github.com/Jocos12/Tourist-AI-Agent-/issues/3)** — P0, blocks everything — @ganji759
- **[#4 — Auth & onboarding](https://github.com/Jocos12/Tourist-AI-Agent-/issues/4)** — login Google/GitHub/Email + Auth.js
- **[#5 — Saved preferences](https://github.com/Jocos12/Tourist-AI-Agent-/issues/5)** — places, photos, analytics, reminders
- **[#6 — Chat + Voice + compact map](https://github.com/Jocos12/Tourist-AI-Agent-/issues/6)** — both modes + the compact map layout (§8)
- **[#7 — Community & social](https://github.com/Jocos12/Tourist-AI-Agent-/issues/7)** — presence map, search, connections, profile
- **[#8 — Token-cost caching](https://github.com/Jocos12/Tourist-AI-Agent-/issues/8)** — backend only — @ganji759

Labels: `ui-sprint`, `frontend`, `needs-agent` (touches the AI agent or needs a secret → @ganji759). Still owner-only (ask **@Jocos12**): protect `main` + make you co-admin — you have write, not admin.

---

## 12. Open questions for the Engineer (answer Day-1 AM)

1. Email login: magic-link or email+password?
2. Where do user sessions/records persist — and what are the exact `users` profile field names?
3. Photo source: confirm Place Photos via the existing Maps key, or another source? (No scraping.)
4. Reminder/calendar + saved-place data contract, and the **agent action schema** to create/edit/cancel reminders (mirror `map_control`?).
5. Does `/api/voice/speak` stream text chunks for captions, or one-shot? Can it?
6. Community data contract (presence, connections, profile status, privacy) — and confirmation the recommender uses **only** public fields.

---

_Build small, build real, ask before touching the backend, and write the two reports. Two days. Let's make it look like a product, not a demo._
