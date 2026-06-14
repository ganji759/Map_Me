"""Direct Maps Grounding Lite MCP client for imperative Python tools."""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Optional

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

logger = logging.getLogger(__name__)

MAPS_MCP_URL = os.getenv("MAPS_GROUNDING_MCP_URL", "https://mapstools.googleapis.com/mcp")


def _api_key() -> str:
    key = os.environ.get("GOOGLE_MAPS_API_KEY")
    if not key:
        raise RuntimeError("GOOGLE_MAPS_API_KEY is not set")
    return key


def _parse_tool_payload(raw: Any) -> Any:
    if isinstance(raw, dict):
        content = raw.get("content") or []
        texts: list[str] = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                texts.append(item.get("text", ""))
        combined = "\n".join(t for t in texts if t).strip()
        if not combined:
            return raw
        try:
            return json.loads(combined)
        except json.JSONDecodeError:
            blocks = re.findall(r"\{[^{}]*\}", combined)
            if blocks:
                try:
                    return [json.loads(b) for b in blocks]
                except json.JSONDecodeError:
                    pass
            return combined
    return raw


async def call_maps_tool_async(tool_name: str, arguments: dict[str, Any]) -> Any:
    """Invoke a Maps Grounding Lite MCP tool via the official MCP HTTP transport."""
    headers = {"X-Goog-Api-Key": _api_key()}
    async with httpx.AsyncClient(headers=headers, timeout=60.0) as http_client:
        async with streamable_http_client(MAPS_MCP_URL, http_client=http_client) as (
            read,
            write,
            _get_session_id,
        ):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.call_tool(tool_name, arguments)
                payload = result.model_dump(exclude_none=True, mode="json")
                return _parse_tool_payload(payload)


def call_maps_tool(tool_name: str, arguments: dict[str, Any]) -> Any:
    """Synchronous wrapper for scripts/tests outside an event loop."""
    import asyncio

    return asyncio.run(call_maps_tool_async(tool_name, arguments))


async def search_places_async(
    text_query: str, location_bias: Optional[str] = None
) -> list[dict[str, Any]]:
    """Run one search_places call and return a normalized list of place dicts."""
    args: dict[str, Any] = {"text_query": text_query}
    if location_bias:
        args["location_bias"] = location_bias

    raw = await call_maps_tool_async("search_places", args)
    places = _extract_places(raw)
    logger.info(
        "maps_client.search_places returned %d places for %r", len(places), text_query
    )
    return places


def search_places(text_query: str, location_bias: Optional[str] = None) -> list[dict[str, Any]]:
    """Sync search_places for unit tests and scripts."""
    import asyncio

    return asyncio.run(search_places_async(text_query, location_bias))


def _extract_places(raw: Any) -> list[dict[str, Any]]:
    if isinstance(raw, list):
        return [_normalize_place(p) for p in raw if isinstance(p, dict)]
    if isinstance(raw, dict):
        for key in ("places", "results", "candidates"):
            items = raw.get(key)
            if isinstance(items, list):
                return [_normalize_place(p) for p in items if isinstance(p, dict)]
        if raw.get("place_id") or raw.get("id") or raw.get("name"):
            return [_normalize_place(raw)]
    return []


def _name_from_attribution(place: dict[str, Any]) -> str:
    attribution = place.get("attribution") or {}
    title = attribution.get("title") or ""
    if title.endswith(" - Google Maps"):
        return title[: -len(" - Google Maps")].strip()
    return title or place.get("name") or place.get("displayName") or ""


def _normalize_place(place: dict[str, Any]) -> dict[str, Any]:
    coords = place.get("coordinates") or place.get("location") or {}
    if "lat" not in coords and "latitude" in coords:
        coords = {"lat": coords.get("latitude"), "lng": coords.get("longitude")}

    place_ref = place.get("place_id") or place.get("id") or place.get("place") or ""
    if isinstance(place_ref, str) and place_ref.startswith("places/"):
        place_ref = place_ref.split("/", 1)[-1]

    links = place.get("googleMapsLinks") or {}
    rating = place.get("rating")
    if rating is None and isinstance(place.get("ratings"), dict):
        rating = place["ratings"].get("score")

    # Opening hours (best effort — present only when Grounding Lite returns them).
    open_now: Optional[bool] = None
    for hk in ("currentOpeningHours", "regularOpeningHours", "opening_hours"):
        hours = place.get(hk)
        if isinstance(hours, dict):
            val = hours.get("openNow")
            if val is None:
                val = hours.get("open_now")
            if isinstance(val, bool):
                open_now = val
                break
    if open_now is None and isinstance(place.get("open_now"), bool):
        open_now = place.get("open_now")

    return {
        "place_id": place_ref,
        "name": _name_from_attribution(place),
        "address": place.get("address") or place.get("formattedAddress") or "",
        "coordinates": {
            "lat": float(coords.get("lat") or 0.0),
            "lng": float(coords.get("lng") or 0.0),
        },
        "categories": place.get("categories") or place.get("types") or [],
        "rating": rating,
        "price_level": place.get("price_level") or place.get("priceLevel"),
        "summary": (
            place.get("summary")
            or place.get("generativeSummary")
            or place.get("description")
            or ""
        ),
        "maps_url": (
            place.get("maps_url")
            or place.get("googleMapsUri")
            or links.get("placeUrl")
            or (place.get("attribution") or {}).get("url")
        ),
        "website": (
            place.get("website")
            or place.get("websiteUri")
            or place.get("websiteURI")
        ),
        "open_now": open_now,
        "personalization_score": 0.0,
    }
