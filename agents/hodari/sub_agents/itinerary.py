import json
import logging
import os
from typing import Any, AsyncGenerator

from google.adk.agents import LlmAgent, LoopAgent
from google.adk.agents.base_agent import BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events import Event, EventActions
from google.genai import types

from ..tools.maps_mcp import create_maps_toolset

logger = logging.getLogger(__name__)

ITINERARY_INSTRUCTION = """You are the Itinerary builder for Hodari, a tourist AI assistant for the 2026 FIFA World Cup.

The user's plan and candidate places are in context (session state keys: "plan", "candidates").

STEPS:
1. Call lookup_weather for the city in the plan to get current conditions.
   - If it's raining or cold (<15°C), prefer indoor venues and note it.
   - If it's hot (>28°C), prefer shaded or air-conditioned places.
   - Mention weather briefly in the voice_summary only if it affects the picks.

2. STOP COUNT IS A HARD REQUIREMENT: the itinerary MUST contain 2 or 3 stops whenever the
   candidate list has 2 or more distinct places. Returning a single stop in that case is a
   FAILURE, even if only one candidate is a perfect fit. Rank candidates by how well each fits
   the plan (budget, dietary, time) and take the top 2-3 scorers; a partial fit is acceptable
   and expected for the 2nd and 3rd stops. Every stop MUST be a different place: never repeat
   the same place_id or venue, and never pad by duplicating a place. Only when the candidate
   list contains just 1 distinct place may you return a single stop.
   Build the itinerary from the candidates you are given. Do NOT search for new places; only if
   the candidate list is completely empty may you call search_places once to find a single venue.

3. For each consecutive stop pair, call compute_routes (origin = previous stop, destination = next stop, travel_mode = WALK).
   Extract from the response: distance, duration, and the encoded polyline string.
   If a compute_routes call fails or returns nothing, KEEP BOTH STOPS anyway: set that stop's
   travel_from_prev distance and duration to your best estimate from the coordinates and
   encoded_polyline to null. NEVER drop a stop because its route could not be computed.

4. Order stops to minimise walking distance using the compute_routes results.

5. Write one short rationale sentence per stop (why it fits the plan).

6. Write a 2-sentence voice-friendly summary, friendly, spoken-English style.

In all rationale and voice_summary text, never use em dashes (the "—" character).
Use commas, periods, or parentheses instead.

Return ONLY this compact JSON (no markdown, no extra keys):
{"stops":[{"place_id":"string","name":"string","address":"string","coordinates":{"lat":0.0,"lng":0.0},"arrival_time":"14:00","duration_at_stop":"45 min","travel_from_prev":{"distance":"0.4 km","duration":"5 min","encoded_polyline":"encoded_polyline_string_or_null"},"rationale":"string"}],"total_duration":"2h 30min","total_distance":"1.2 km","voice_summary":"string"}
"""

itinerary_agent = LlmAgent(
    model=os.getenv("GEMINI_MODEL", "gemini-2.0-flash"),
    name="itinerary_agent",
    description="Builds a weather-aware 2-3 stop itinerary from candidate places.",
    instruction=ITINERARY_INSTRUCTION,
    # search_places is included as a safety net: the model occasionally tries to
    # call it (it sees the Explorer's earlier calls in shared context), and a
    # newer ADK turns an unknown tool call into a fatal error. Having it declared
    # makes that call harmless instead of crashing the pipeline.
    tools=[create_maps_toolset(tools=["search_places", "lookup_weather", "compute_routes"])],
    output_key="itinerary",
)


def _parse_json(raw: Any) -> Any:
    if isinstance(raw, str):
        text = raw.strip()
        if text.startswith("```"):
            text = text.strip("`")
            if text.startswith("json"):
                text = text[4:]
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return None
    return raw


def _distinct_ids(items: list[dict[str, Any]]) -> set[str]:
    return {
        str(it.get("place_id") or it.get("name") or "").strip().lower()
        for it in items
        if isinstance(it, dict) and (it.get("place_id") or it.get("name"))
    }


def validate_itinerary(itinerary_raw: Any, candidates_raw: Any) -> str | None:
    """Return corrective feedback for the itinerary agent, or None if the itinerary is acceptable."""
    itinerary = _parse_json(itinerary_raw)
    stops = itinerary.get("stops") if isinstance(itinerary, dict) else None
    if not isinstance(stops, list) or not stops:
        return (
            "Your previous output was not valid itinerary JSON with a non-empty \"stops\" array. "
            "Re-read the candidates in context and return ONLY the compact itinerary JSON, "
            "with 2-3 distinct stops."
        )

    candidates = _parse_json(candidates_raw)
    if not isinstance(candidates, list):
        candidates = []
    n_candidates = len(_distinct_ids(candidates))
    n_stops = len(_distinct_ids([s for s in stops if isinstance(s, dict)]))

    if n_stops >= 2 or n_candidates < 2:
        return None
    return (
        f"Your previous itinerary had only {n_stops} distinct stop, but the candidate list "
        f"contains {n_candidates} distinct places. That violates the hard requirement of 2-3 "
        "stops. Rebuild the itinerary now with 2-3 DIFFERENT places from the candidates "
        "(partial fits are fine for the extra stops). If compute_routes fails for a leg, keep "
        "the stop and set encoded_polyline to null. Return ONLY the compact itinerary JSON."
    )


class ItineraryChecker(BaseAgent):
    """Escalates (exits the retry loop) when the itinerary has enough distinct stops;
    otherwise feeds corrective text back so the next loop iteration can fix it."""

    async def _run_async_impl(self, ctx: InvocationContext) -> AsyncGenerator[Event, None]:
        feedback = validate_itinerary(
            ctx.session.state.get("itinerary"),
            ctx.session.state.get("candidates"),
        )
        if feedback is None:
            yield Event(
                author=self.name,
                invocation_id=ctx.invocation_id,
                actions=EventActions(escalate=True),
            )
            return
        logger.warning("Itinerary rejected, retrying: %s", feedback[:160])
        yield Event(
            author=self.name,
            invocation_id=ctx.invocation_id,
            content=types.Content(role="user", parts=[types.Part(text=feedback)]),
        )


# One retry: iteration 1 builds, checker validates; on failure iteration 2 sees the
# corrective feedback and rebuilds, then the loop ends regardless.
itinerary_loop = LoopAgent(
    name="itinerary_loop",
    description="Builds a weather-aware 2-3 stop itinerary, retrying once if too few stops.",
    sub_agents=[itinerary_agent, ItineraryChecker(name="itinerary_checker")],
    max_iterations=2,
)
