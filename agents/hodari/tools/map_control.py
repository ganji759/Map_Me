"""Map UI control — structured actions the Next.js client executes."""

from __future__ import annotations

import json
import logging
from typing import Any

from google.adk.tools import ToolContext

logger = logging.getLogger(__name__)

VALID_OPS = frozenset({
    "hide_user_location",
    "show_user_location",
    "open_map",
    "close_map",
    "expand_map",
    "compact_map",
    "chat_only",
    "clear_route",
    "focus_place",
    "keep_only",
    "route",
    "suppress_gps_context",
    "highlight_place",
    "circle_place",
    "clear_annotations",
})


def _valid_action(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    op = raw.get("op")
    if op not in VALID_OPS:
        return None
    return dict(raw)


def map_control(
    actions: list[dict[str, Any]],
    tool_context: ToolContext,
) -> str:
    """Control the in-app map UI. Call when the user wants map behavior changed.

    Use this instead of telling the user to tap buttons. Does NOT search for new
    places (use hodari_pipeline for that).

    Args:
        actions: List of action objects. Supported ops:
            hide_user_location — hide the blue GPS dot; stop routing from GPS.
            show_user_location — show the GPS dot again.
            open_map — open the compact map panel beside chat (map + place list).
            compact_map — same as open_map (compact side panel, not full screen).
            expand_map — full-screen map with resizable chat overlay on the left.
            chat_only — hide the map and show chat only (same as close_map).
            close_map — hide the map panel entirely.
            clear_route — remove any route line on the map.
            focus_place — zoom map to a place (place_index 0-based and/or place_name).
            keep_only — show a single pin (place_index and/or place_name).
            route — draw a route. Fields:
                from: "user" or "landmark"
                landmark: required when from is "landmark" (e.g. "Musée du Louvre, Paris")
                to_place_index or to_place_name: destination from current candidates/itinerary
                mode: "WALK", "DRIVE", "TRANSIT", or "BICYCLE" (default WALK).
                    Use TRANSIT for "by metro/train/bus/public transport".
            highlight_place — mark a place with a distinct colored pin (keeps the
                other pins as they are). Fields: place_index or place_name, and
                color (one of: green, red, blue, purple, black, yellow, pink).
                Works for a place from an EARLIER search too (e.g. mark the
                restaurant green while the current hotels stay orange).
            circle_place — draw a colored highlight circle around a place. Fields:
                place_index or place_name, color (optional), radius_m (optional,
                default 350). Also colors that pin to match.
            clear_annotations — remove all highlight colors and circles.
            suppress_gps_context — stop attaching the user's GPS to later messages
                (use when they browse another city, e.g. Paris while GPS is elsewhere).
        tool_context: Injected by ADK.

    Returns:
        JSON confirmation for the model.
    """
    normalized: list[dict[str, Any]] = []
    for item in actions or []:
        action = _valid_action(item)
        if action:
            normalized.append(action)

    if not normalized:
        return json.dumps({"ok": False, "error": "No valid map actions"})

    payload = json.dumps(normalized, ensure_ascii=False)
    tool_context.state["map_actions"] = payload

    if any(a.get("op") == "suppress_gps_context" for a in normalized):
        tool_context.state["suppress_gps_context"] = "1"
    if any(a.get("op") == "show_user_location" for a in normalized):
        tool_context.state["suppress_gps_context"] = ""

    logger.info("map_control: %s", payload[:200])
    return json.dumps({"ok": True, "actions": normalized}, ensure_ascii=False)
