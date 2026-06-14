# QA Session — Paris places (live app)

Date: 2026-06-14
Target: https://hodari-frontend-377773225771.us-central1.run.app/chat
Query under test: "Find me three restaurants in Paris"

Workflow: drive with Playwright → screenshot → user reports what's wrong / what to change →
log here → apply ALL changes in one batch at the end.

## Findings

<!-- Each finding: what the user saw, the screenshot ref, and the decision (change / keep). -->

### Finding 1 — Place results: kill the right-side list, keep ONLY the in-chat gallery (with images)
_Reported by user while viewing a hotels query (live app)._

Observed:
- Results appear TWICE: once in the chat (inline gallery under the AI reply) AND again on the
  right side, below the compact map (the sliding place cards / list). User wants ONE, not two.
- The in-chat gallery shows **"No photo"** — images aren't loading there, even though the
  right-side cards DO show images.

Wanted (the single source of results = the in-chat gallery under the AI answer):
1. **Remove the right-side results entirely** (the place list / sliding cards below the map).
   Keep ONLY the small/compact map on the right. ("remove the tabs from the right… just keep the map.")
2. **Move the images + place boxes into the chat**, under the AI response — the in-chat gallery
   must show the **same images** that the right-side cards were showing (fix the "No photo").
   Likely cause: right-side `places` state gets photo enrichment re-applied, but `msg.places`
   (what the inline gallery renders) does not — so wire the enriched photos into the message's
   places too.
3. **Make the in-chat gallery scroll** when there are more than ~2–3 rows. **Preferred: vertical
   scroll (up↕down)** with a capped max-height; left→right horizontal is an acceptable fallback,
   but vertical is the preference.

Decision: **CHANGE.** (batched — not yet applied)

---

### Finding 2 — Full map markers: (a) duplicate marker bug, (b) marker click should open a small action bubble, not the full details box
_Reported by user on the expanded/full map._

**2a — Two markers stacked on the selected place.** On the full map there are two marker styles:
the dynamic/cinematic one (glow + bounce) for the active/highlighted place, and the plain fixed
ones. When you click a different marker (e.g. were on #1, click #4), #4 correctly becomes the
dynamic glow marker — BUT the original plain marker for #4 is **still rendered underneath**, so
you see TWO markers at that spot. Should be exactly ONE: the plain marker must be hidden/replaced
for the active (and any highlighted) place so the glow marker is the only one there.

**2b — Marker click currently slams open the full details panel** (the big photo box) every time,
which is annoying to keep closing. Wanted instead:
- Click a marker → just focus/go to it AND show a **small bubble / popup (InfoWindow-style)**
  anchored on the marker — NOT the full restaurant panel.
- The bubble is compact: place name + a row of **action icons**, e.g.:
  - **Full details** (THIS is what opens the full restaurant page / images / lightbox)
  - **Save / bookmark**
  - **Route** (from my location to there)
  - **Website** and/or **Open in Maps**
- So the full details panel only appears when the user taps "Full details" in the bubble — not on
  every marker click.

Decision: **CHANGE.** (batched — not yet applied)

### Finding 3 — Full map: clicking a result card should focus/highlight its MARKER, not open full details
_Reported by user in full-map mode (chat on the left)._

In full-map mode, clicking a restaurant (its image/card in the chat / inline gallery) currently
opens the full restaurant details/images panel. Instead: clicking a result should just **move the
map / highlight that place's marker**. E.g. marker is on #1, click result #4 → map highlights
marker #4 (and per Finding 2b, its bubble can appear). Do NOT pop the full image panel on card
click — the full details come from the marker bubble's "Full details" action.

Note: in COMPACT mode the inline gallery card → details panel is fine; this behavior change is
specifically for **full-map** mode (card click = focus marker, not open panel).

Decision: **CHANGE.** (batched — not yet applied)

### Finding 4 — Voice mode: live transcription + dedicated UI + no delay before my message appears
_Reported by user using voice mode._

Today voice mode just shows "Listening…" in the text composer; the user can't see the words they
are speaking, and when a voice message is sent it only appears in the chat after a ~4s delay.

Wanted:
- A proper **voice-mode UI** (not the plain text composer) where the user **sees their spoken
  text live** as they talk (like Claude / other voice assistants), while still in voice mode and
  the AI still listening, then the AI replies/speaks back.
- **Echo the user's message into the chat immediately** (optimistic) — no ~4s delay. Any
  background processing (final transcript cleanup, send to agent) can happen after, but the
  message bubble should appear right away.
- "UI design and the backend also if possible."

Decision: **CHANGE.** (batched — not yet applied; UI + backend.)

---

## Changes to make (batched)

- [x] Remove right-side `PlaceListPanel` (results below the compact map); keep only the map there.
      → removed both panels; map now fills the side aside (`flex-1`).
- [x] Make the in-chat `InlinePlaceGallery` the single results surface, with images working
      (carry enriched photos onto `msg.places`). → photo-cache now mirrored onto message places.
- [x] Make `InlinePlaceGallery` vertically scrollable (max-height + overflow-y) past ~2–3 rows.
      → `max-h-[58vh] overflow-y-auto` past 4 cards.
- [x] Full map: render only ONE marker for the active/highlighted place — `AnnotationMarkers`
      now skips any marker sitting on top of a place marker (coord dedupe).
- [x] Full map: marker click opens a small action bubble (name + Full details/Save/Route/
      Website/Maps) via `InfoWindow` + `PlaceBubble`; `handleMarkerClick` no longer opens the panel.
- [x] Full map: clicking a result card focuses/highlights its marker (`handleGalleryCardClick`);
      compact-mode card→details unchanged.
- [x] Voice mode: live transcription — voice mode now uses the browser recognizer
      (`preferBrowserStt`) which streams interim words; floating `VoiceOrb` shows them.
- [x] Voice mode: instant echo — browser STT `stop()` resolves immediately (no ~4s Gemini
      round-trip), so the spoken message hits the chat right away.

_All implemented; tsc + production build green. Not yet deployed._

## Do NOT change

- Keep the compact/small map on the right (only the place LIST/cards below it get removed).
