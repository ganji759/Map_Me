"""
MongoDB tools for Hodari agents.

All Atlas operations go through the MongoDB MCP HTTP server
(MONGODB_MCP_URL, default http://localhost:3100/mcp) — not a direct driver
connection. This satisfies the MongoDB prize-track partner-integration
requirement: every read/write to hodari.interactions is routed through MCP.
"""

import json
import logging
import os
import re
import threading
import time
import uuid
from typing import Any, Optional

import requests
from google.adk.tools import ToolContext

logger = logging.getLogger(__name__)

MDB_MCP_URL = os.getenv("MONGODB_MCP_URL", "http://localhost:3100/mcp")
HODARI_DB = os.getenv("MONGODB_DATABASE", "hodari")

_session_id: Optional[str] = None


# ── MCP session & transport ──────────────────────────────────────────────────

def _init_session() -> str:
    resp = requests.post(
        MDB_MCP_URL,
        json={
            "jsonrpc": "2.0",
            "id": 0,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "hodari-agents", "version": "1.0"},
            },
        },
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        },
        timeout=10,
    )
    resp.raise_for_status()
    sid = resp.headers.get("mcp-session-id")
    if not sid:
        raise RuntimeError("MCP server did not return a session ID")
    return sid


def _record_substep(name: str, started: float) -> None:
    if os.getenv("HODARI_PROFILING", "1").lower() in ("0", "false", "no"):
        return
    try:
        from ..telemetry import record_substep

        record_substep(name, time.perf_counter() - started)
    except Exception:
        pass


def _mcp_tool(tool_name: str, arguments: dict) -> dict:
    """Call a MongoDB MCP tool; auto-renews the session on expiry (once)."""
    global _session_id
    started = time.perf_counter()
    if not _session_id:
        _session_id = _init_session()

    def _post(sid: str) -> requests.Response:
        return requests.post(
            MDB_MCP_URL,
            json={
                "jsonrpc": "2.0",
                "id": str(uuid.uuid4()),
                "method": "tools/call",
                "params": {"name": tool_name, "arguments": arguments},
            },
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
                "mcp-session-id": sid,
            },
            timeout=30,
        )

    resp = _post(_session_id)
    resp.raise_for_status()

    # Parse SSE line(s): "data: {...}"
    for line in resp.text.splitlines():
        if not line.startswith("data: "):
            continue
        payload = json.loads(line[6:])

        # Session expired — renew once and retry
        if payload.get("error", {}).get("code") == -32003:
            _session_id = _init_session()
            resp = _post(_session_id)
            resp.raise_for_status()
            for line2 in resp.text.splitlines():
                if line2.startswith("data: "):
                    payload = json.loads(line2[6:])
                    break

        if "error" in payload:
            raise RuntimeError(f"MCP error calling '{tool_name}': {payload['error']}")
        _record_substep(f"mongo_mcp:{tool_name}", started)
        return payload.get("result", {})

    raise RuntimeError(f"No response data from MCP tool '{tool_name}'")


def _parse_docs(result: dict) -> list[dict]:
    """Extract document list from an MCP tool result."""
    # insert-many / update-many return structuredContent
    sc = result.get("structuredContent") or {}
    if isinstance(sc, list):
        return sc
    if "documents" in sc:
        return sc["documents"]

    # find / aggregate embed results inside untrusted-user-data blocks.
    # The warning text itself mentions the tag names, so the first regex match
    # captures " and " — not valid JSON. Use findall and try every match.
    for item in result.get("content", []):
        text = item.get("text", "")
        for block in re.findall(
            r"<untrusted-user-data-[^>]+>(.*?)</untrusted-user-data-[^>]+>",
            text,
            re.DOTALL,
        ):
            try:
                parsed = json.loads(block.strip())
                if isinstance(parsed, list):
                    return parsed
            except json.JSONDecodeError:
                pass

    return []


# ── Embedding (Vertex AI — still Python-side, no driver involved) ────────────

def _embed(text: str) -> list[float]:
    """768-dim embedding via Vertex AI text-embedding-004 (ADC auth)."""
    import google.auth
    import google.auth.transport.requests as _tr

    started = time.perf_counter()
    creds, detected_project = google.auth.default(
        scopes=["https://www.googleapis.com/auth/cloud-platform"]
    )
    creds.refresh(_tr.Request())

    project = os.environ.get("GOOGLE_CLOUD_PROJECT") or detected_project
    location = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1")
    if location == "global":
        location = "us-central1"

    url = (
        f"https://{location}-aiplatform.googleapis.com/v1"
        f"/projects/{project}/locations/{location}"
        f"/publishers/google/models/text-embedding-004:predict"
    )
    resp = requests.post(
        url,
        headers={"Authorization": f"Bearer {creds.token}", "Content-Type": "application/json"},
        json={"instances": [{"content": text, "task_type": "RETRIEVAL_QUERY"}]},
        timeout=10,
    )
    resp.raise_for_status()
    _record_substep("vertex_embed:text-embedding-004", started)
    return resp.json()["predictions"][0]["embeddings"]["values"]


# ── ADK tool helpers ─────────────────────────────────────────────────────────

def _user_id(tool_context: ToolContext) -> str:
    """Resolve the end-user id for the current invocation.

    ADK exposes the live session via the public `session` property
    (`tool_context.session.user_id`). Older builds nested it under
    `invocation_context`; try both, then any value stashed in state, before
    giving up. Returning the right id is critical: it is the partition key for
    saved places and personalization, so a wrong default silently writes every
    user's data under "anonymous".
    """
    for getter in (
        lambda: tool_context.session.user_id,
        lambda: tool_context.invocation_context.session.user_id,
        lambda: tool_context._invocation_context.session.user_id,
    ):
        try:
            uid = getter()
            if uid:
                return uid
        except AttributeError:
            continue
        except Exception:
            continue
    try:
        return tool_context.state.get("_user_id", "anonymous")
    except Exception:
        return "anonymous"


# ── Public tools ─────────────────────────────────────────────────────────────

def load_user_profile(tool_context: ToolContext) -> dict:
    """Load the current user's profile from MongoDB via MCP.

    Call at the start of every planning request to personalise the itinerary.
    Returns dietary restrictions, budget tier, accessibility needs, and language.
    Returns a minimal dict if no profile exists yet (new user).
    """
    uid = _user_id(tool_context)
    try:
        result = _mcp_tool("find", {
            "database": HODARI_DB,
            "collection": "users",
            "filter": {"user_id": uid},
            "limit": 1,
        })
        docs = _parse_docs(result)
        if docs:
            doc = {k: v for k, v in docs[0].items() if k != "_id"}
            tool_context.state["user_profile"] = doc
            return doc
        profile = {"user_id": uid, "new_user": True}
        tool_context.state["user_profile"] = profile
        return profile
    except Exception as exc:
        logger.warning("load_user_profile failed: %s", exc)
        return {}


def _city_from_address(address: str) -> str:
    """Best-effort city extraction from a Google-style address string."""
    parts = [p.strip() for p in address.split(",") if p.strip()]
    if len(parts) >= 2:
        return parts[-2]
    return parts[-1] if parts else ""


def _persist_preference_sync(
    user_id: str,
    place_id: str,
    place_name: str,
    city: str,
    action: str,
) -> None:
    """Write one interaction record (embedding + MCP upsert). Blocking."""
    embedding = _embed(f"{place_name} {city} {action}")
    _mcp_tool("update-many", {
        "database": HODARI_DB,
        "collection": "interactions",
        "filter": {"user_id": user_id, "place_id": place_id},
        "update": {
            "$set": {
                "place_name": place_name,
                "city": city,
                "action": action,
                "embedding": embedding,
            }
        },
        "upsert": True,
    })


def _upsert_interaction(user_id: str, place_id: str, fields: dict[str, Any]) -> None:
    """Upsert one interaction record. Blocking, but no Vertex/embedding call —
    so a user-facing save never fails just because embeddings are slow/down."""
    _mcp_tool("update-many", {
        "database": HODARI_DB,
        "collection": "interactions",
        "filter": {"user_id": user_id, "place_id": place_id},
        "update": {"$set": {"user_id": user_id, "place_id": place_id, **fields}},
        "upsert": True,
    })


def _embed_interaction_async(user_id: str, place_id: str, text: str) -> None:
    """Compute the embedding and attach it in the background (best effort)."""
    def _run() -> None:
        try:
            embedding = _embed(text)
            _upsert_interaction(user_id, place_id, {"embedding": embedding})
        except Exception as exc:
            logger.info("Background embedding failed for %s: %s", place_id, exc)

    threading.Thread(target=_run, name="hodari-embed", daemon=True).start()


def enqueue_preference_saves(user_id: str, stops: list[dict[str, Any]]) -> int:
    """Persist itinerary stop recommendations in a background thread.

    Returns the number of stops queued. Non-blocking for the caller.
    """
    if not stops:
        return 0

    work = []
    for stop in stops:
        place_id = stop.get("place_id")
        place_name = stop.get("name")
        if not place_id or not place_name:
            continue
        city = stop.get("city") or _city_from_address(stop.get("address", ""))
        work.append((place_id, place_name, city))

    if not work:
        return 0

    def _run() -> None:
        for place_id, place_name, city in work:
            try:
                _persist_preference_sync(
                    user_id, place_id, place_name, city, "recommended"
                )
            except Exception as exc:
                logger.warning(
                    "Background save_preference failed for %s: %s", place_name, exc
                )

    threading.Thread(
        target=_run,
        name="hodari-save-preferences",
        daemon=True,
    ).start()
    logger.info("Queued %d preference saves for user %s", len(work), user_id)
    return len(work)


def parse_itinerary_stops(raw: Any) -> list[dict[str, Any]]:
    """Extract stops from session-state itinerary (JSON string or dict)."""
    if raw is None:
        return []
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
        stops = data.get("stops") if isinstance(data, dict) else None
        return stops if isinstance(stops, list) else []
    except (json.JSONDecodeError, AttributeError, TypeError):
        return []


def save_preference(
    place_id: str,
    place_name: str,
    city: str,
    action: str,
    tool_context: ToolContext,
) -> str:
    """Record a user interaction with a place to power future personalisation.

    Args:
        place_id:   Google Place ID of the place.
        place_name: Human-readable name (e.g. "Alive Restaurant").
        city:       City of the place (e.g. "Barcelona").
        action:     One of: recommended, liked, visited, skipped, disliked.
        tool_context: Injected by ADK.

    Writes to Atlas via the MongoDB MCP server — no direct driver call.
    """
    uid = _user_id(tool_context)
    try:
        _persist_preference_sync(uid, place_id, place_name, city, action)
        return f"Saved: {action} → {place_name} ({city})"
    except Exception as exc:
        logger.warning("save_preference failed: %s", exc)
        return "Preference not saved (non-critical)."


def _resolve_place(
    tool_context: ToolContext,
    place_name: str,
    place_id: str,
) -> tuple[str, str, str]:
    """Resolve a place_id / name / city from the current session results.

    Looks in the candidates the pipeline last produced (and any itinerary
    stops) so the user can say "save Carmine's" or "save the first one" and we
    persist the same Google Place ID the map and Saved page use. Falls back to
    whatever the caller passed when there is no match.
    """
    items: list[dict[str, Any]] = []
    raw = tool_context.state.get("candidates") or ""
    try:
        parsed = json.loads(raw) if isinstance(raw, str) else raw
        if isinstance(parsed, list):
            items = parsed
    except (json.JSONDecodeError, TypeError):
        items = []
    items = items + parse_itinerary_stops(tool_context.state.get("itinerary"))

    name_l = (place_name or "").strip().lower()
    for it in items:
        pid = it.get("place_id") or ""
        nm = it.get("name") or it.get("place_name") or ""
        city = it.get("city") or _city_from_address(it.get("address", ""))
        if place_id and pid == place_id:
            return pid, nm or place_name, city
        if name_l and (name_l in nm.lower() or nm.lower() in name_l):
            return pid, nm, city
    return place_id or "", place_name or "", ""


def save_place(
    place_name: str,
    tool_context: ToolContext,
    place_id: str = "",
    city: str = "",
) -> str:
    """Save (bookmark) a place to the user's Saved Places list.

    Call this whenever the user asks to save, bookmark, or keep a place from the
    results you just showed (e.g. "save Carmine's", "bookmark the first one",
    "add that to my saved places"). The place then appears on the in-app Saved
    Places page. Never tell the user a place was saved unless this tool returned
    success.

    Args:
        place_name: Name of the place to save, as shown to the user.
        place_id:   Google Place ID if known (optional; resolved from results otherwise).
        city:       City of the place (optional; resolved from results otherwise).
        tool_context: Injected by ADK.
    """
    uid = _user_id(tool_context)
    pid, name, resolved_city = _resolve_place(tool_context, place_name, place_id)
    city = city or resolved_city
    if not pid:
        return (
            f"I couldn't find {place_name or 'that place'} in the current results to save. "
            "Ask me to find some places first, then I can save one for you."
        )
    try:
        # Reliable write first (no embedding dependency), then embed in the
        # background for personalization — so the save itself never fails on a
        # slow/unavailable Vertex embedding call.
        _upsert_interaction(uid, pid, {"place_name": name or place_name, "city": city, "action": "saved"})
        _embed_interaction_async(uid, pid, f"{name or place_name} {city} saved")
        return f"Saved {name or place_name} to your Saved Places."
    except Exception as exc:
        logger.warning("save_place failed: %s", exc)
        return "I couldn't save that just now. Please try again in a moment."


def list_saved_places(tool_context: ToolContext) -> list[dict]:
    """List the places the user has saved (their Saved Places page contents).

    Call this when the user asks what they've saved, what's on their list, or
    what they planned to visit. Returns place names, cities, and any planned
    visit date. Returns an empty list if they have saved nothing yet.

    Args:
        tool_context: Injected by ADK.
    """
    uid = _user_id(tool_context)
    try:
        result = _mcp_tool("find", {
            "database": HODARI_DB,
            "collection": "interactions",
            "filter": {"user_id": uid, "action": {"$in": ["saved", "reminder"]}},
            "limit": 50,
        })
        docs = _parse_docs(result)
        seen: set[str] = set()
        out: list[dict] = []
        for d in docs:
            pid = d.get("place_id") or d.get("place_name")
            if pid in seen:
                continue
            seen.add(pid)
            out.append({
                "place_name": d.get("place_name", ""),
                "city": d.get("city", ""),
                "visit_date": d.get("visit_date"),
            })
        return out
    except Exception as exc:
        logger.info("list_saved_places failed: %s", exc)
        return []


def find_similar_preferences(
    query: str,
    tool_context: ToolContext,
    limit: int = 5,
) -> list[dict]:
    """Find places from the user's past interactions most similar to the current request.

    Use BEFORE searching for new places to bias results toward the user's taste.
    Returns an empty list if the user has no history or the vector index is not ready.

    Args:
        query: What the user is looking for (e.g. "vegetarian tapas near Camp Nou").
        limit: Maximum results to return (default 5).
        tool_context: Injected by ADK.
    """
    uid = _user_id(tool_context)
    profile = tool_context.state.get("user_profile") or {}
    if profile.get("new_user"):
        logger.info("find_similar_preferences skipped: new user has no history")
        return []

    try:
        q_embedding = _embed(query)
        pipeline = [
            {
                "$vectorSearch": {
                    "index": "interactions_embedding",
                    "path": "embedding",
                    "queryVector": q_embedding,
                    "numCandidates": limit * 6,
                    "limit": limit,
                    "filter": {"user_id": {"$eq": uid}},
                }
            },
            {
                "$project": {
                    "_id": 0,
                    "place_id": 1,
                    "place_name": 1,
                    "city": 1,
                    "action": 1,
                    "score": {"$meta": "vectorSearchScore"},
                }
            },
        ]
        result = _mcp_tool("aggregate", {
            "database": HODARI_DB,
            "collection": "interactions",
            "pipeline": pipeline,
        })
        return _parse_docs(result)
    except Exception as exc:
        logger.info("find_similar_preferences returned empty (index not ready?): %s", exc)
        return []
