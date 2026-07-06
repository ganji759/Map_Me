"""
remote_pipeline.py
------------------
Builds a production LlmAgent whose three pipeline steps (Planner, Explorer,
Itinerary) are dispatched as HTTP calls to independent Cloud Run services
instead of running in-process.

Each helper follows the ADK HTTP API contract:
  POST {service}/apps/{app}/users/{uid}/sessions/{sid}   -> create session
  POST {service}/run                                      -> execute agent

The Pydantic contracts (Plan / CandidateSet / Itinerary) still gate the data
that flows between agents; here they are validated after crossing the wire.
Each remote call is attempted once, and on a malformed / failed response it is
retried exactly once before falling back to a graceful error string, mirroring
the in-process "one retry, then graceful error" behaviour.

Service-to-service auth is config-driven (HODARI_SERVICE_AUTH):
  * "iam" (default on Cloud Run) — attach a Google-signed OIDC ID token whose
    audience is the target service URL. This is the Google-recommended pattern
    for private (IAM-authenticated) Cloud Run services.
  * "none" — no Authorization header (local dev, or services deployed with
    --allow-unauthenticated).
"""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from typing import Any, Callable

import requests
from google.adk.agents import LlmAgent

logger = logging.getLogger(__name__)

_TIMEOUT = 120  # seconds per remote call
_USER_ID = "prod_user"


# ── Service-to-service auth (Cloud Run IAM / OIDC ID tokens) ───────────────────

def _auth_mode() -> str:
    """'iam' or 'none'. Defaults to 'iam' when running on Cloud Run, else 'none'."""
    default = "iam" if os.getenv("K_SERVICE") else "none"
    return os.getenv("HODARI_SERVICE_AUTH", default).strip().lower()


# audience -> (token, expiry_epoch). ID tokens are valid ~1h; refresh a bit early.
_TOKEN_CACHE: dict[str, tuple[str, float]] = {}


def _id_token(audience: str) -> str | None:
    """Fetch a Google-signed OIDC ID token for *audience* (the target service URL).

    Uses Application Default Credentials, so it works with the runtime service
    account on Cloud Run without any key material. Returns None (and logs) if a
    token cannot be minted, so callers can degrade gracefully.
    """
    cached = _TOKEN_CACHE.get(audience)
    if cached and cached[1] - 60 > time.time():
        return cached[0]
    try:
        from google.auth.transport.requests import Request as GoogleAuthRequest
        from google.oauth2 import id_token as google_id_token

        token = google_id_token.fetch_id_token(GoogleAuthRequest(), audience)
        # fetch_id_token doesn't expose the expiry; assume the standard 1h TTL.
        _TOKEN_CACHE[audience] = (token, time.time() + 3600)
        return token
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not mint ID token for %s: %s", audience, exc)
        return None


def _auth_headers(service_url: str) -> dict[str, str]:
    if _auth_mode() != "iam":
        return {}
    # The audience for a Cloud Run OIDC token is the service's base URL.
    audience = service_url.rstrip("/")
    token = _id_token(audience)
    return {"Authorization": f"Bearer {token}"} if token else {}


# ── Low-level ADK HTTP helpers ────────────────────────────────────────────────

def _ensure_session(service_url: str, app_name: str, session_id: str) -> None:
    """Create an ADK session on the remote service (idempotent — 409 is OK)."""
    url = f"{service_url.rstrip('/')}/apps/{app_name}/users/{_USER_ID}/sessions/{session_id}"
    resp = requests.post(
        url, json={}, timeout=_TIMEOUT, headers=_auth_headers(service_url)
    )
    if resp.status_code not in (200, 201, 409):
        resp.raise_for_status()


def _run_once(
    service_url: str,
    app_name: str,
    session_id: str,
    message: str,
    agent_author: str,
) -> str:
    """One POST /run round-trip; return the target author's text (or last text)."""
    payload: dict[str, Any] = {
        "app_name": app_name,
        "user_id": _USER_ID,
        "session_id": session_id,
        "new_message": {"role": "user", "parts": [{"text": message}]},
        "streaming": False,
    }
    resp = requests.post(
        f"{service_url.rstrip('/')}/run",
        json=payload,
        timeout=_TIMEOUT,
        headers=_auth_headers(service_url),
    )
    resp.raise_for_status()

    events: list[dict] = resp.json()

    for event in reversed(events):
        if event.get("author") == agent_author:
            parts = (
                event.get("content", {}).get("parts", [])
                or event.get("message", {}).get("parts", [])
            )
            texts = [p["text"] for p in parts if isinstance(p, dict) and "text" in p]
            if texts:
                return "\n".join(texts)

    for event in reversed(events):
        parts = (
            event.get("content", {}).get("parts", [])
            or event.get("message", {}).get("parts", [])
        )
        texts = [p["text"] for p in parts if isinstance(p, dict) and "text" in p]
        if texts:
            return "\n".join(texts)

    return ""


def _call_remote(
    service_url: str,
    app_name: str,
    session_prefix: str,
    message: str,
    agent_author: str,
    validator: Callable[[str], bool],
    label: str,
) -> tuple[str, bool]:
    """
    Run a remote agent with one-retry-then-graceful-error semantics.

    Returns (text, ok). `ok` is False when both attempts failed to produce a
    schema-valid response; `text` is then the best raw output we got (or an
    "Error calling …" string if the transport itself failed twice).
    """
    last_text = ""
    for attempt in (1, 2):
        session_id = f"{session_prefix}-{uuid.uuid4().hex}"
        try:
            _ensure_session(service_url, app_name, session_id)
            last_text = _run_once(
                service_url, app_name, session_id, message, agent_author
            )
        except Exception as exc:  # noqa: BLE001 — transport/HTTP failure
            logger.warning("%s attempt %d failed: %s", label, attempt, exc)
            last_text = f"Error calling {label}: {exc}"
            continue
        if validator(last_text):
            logger.debug("%s ok on attempt %d (%d chars)", label, attempt, len(last_text))
            return last_text, True
        logger.warning("%s attempt %d returned malformed output; retrying", label, attempt)

    return last_text, False


# ── Schema validators (Pydantic contracts across the wire) ─────────────────────

def _strip_fences(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = t.strip("`")
        if t.startswith("json"):
            t = t[4:]
    return t.strip()


def _valid_plan(text: str) -> bool:
    from hodari.schemas.contracts import Plan  # local import: keep top-level clean

    try:
        Plan.model_validate(json.loads(_strip_fences(text)))
        return True
    except Exception:  # noqa: BLE001
        return False


def _valid_candidates(text: str) -> bool:
    """Explorer returns a JSON array of places; validate as a CandidateSet."""
    from hodari.schemas.contracts import CandidateSet

    try:
        data = json.loads(_strip_fences(text))
        if isinstance(data, list):
            data = {"places": data}
        CandidateSet.model_validate(data)
        return True
    except Exception:  # noqa: BLE001
        return False


def _make_itinerary_validator(candidates_json: str) -> Callable[[str], bool]:
    """The itinerary agent emits a flat, compact JSON shape (not the nested
    Pydantic `Itinerary`), so reuse the project's own tolerant checker: a result
    is acceptable when it has enough distinct stops for the candidate count."""
    from hodari.sub_agents.itinerary import validate_itinerary

    def _valid(text: str) -> bool:
        try:
            return validate_itinerary(_strip_fences(text), candidates_json) is None
        except Exception:  # noqa: BLE001
            return False

    return _valid


# ── Tool factory ──────────────────────────────────────────────────────────────

def _make_tools(planner_url: str, explorer_url: str, itinerary_url: str):
    """
    Return three plain Python functions (ADK FunctionTools) that call the
    remote services. Each call gets a fresh session ID so there is no
    cross-request state leakage.
    """

    def call_planner(user_request: str) -> str:
        """Call the remote Planner service with the user's request.

        Returns a Plan JSON string describing the goal, constraints, and
        ordered subtasks. Pass the result directly to call_explorer.

        Args:
            user_request: The original user message exactly as received.
        """
        text, ok = _call_remote(
            planner_url, "planner", "planner", user_request,
            "planner_agent", _valid_plan, "planner",
        )
        if text.startswith("Error calling"):
            return text
        if not ok:
            logger.warning("planner returned unvalidated Plan; passing through best effort")
        return text or '{"error": "planner returned empty response"}'

    def call_explorer(plan_json: str) -> str:
        """Call the remote Explorer service with the plan produced by call_planner.

        Searches Google Maps and personalises results against the user's
        interaction history. Returns a CandidateSet JSON array (5-10 places).

        Args:
            plan_json: The raw JSON string returned by call_planner.
        """
        text, ok = _call_remote(
            explorer_url, "explorer", "explorer", plan_json,
            "explorer_agent", _valid_candidates, "explorer",
        )
        if text.startswith("Error calling"):
            return text
        if not ok:
            logger.warning("explorer returned unvalidated CandidateSet; passing through best effort")
        return text or "[]"

    def call_itinerary(plan_json: str, candidates_json: str) -> str:
        """Call the remote Itinerary service to build a routed itinerary.

        Combines the plan and candidate places, calls compute_routes between
        stops, and returns a weather-aware 2-3 stop Itinerary JSON string.

        Args:
            plan_json:       The raw JSON string returned by call_planner.
            candidates_json: The raw JSON string returned by call_explorer.
        """
        message = f"PLAN:\n{plan_json}\n\nCANDIDATES:\n{candidates_json}"
        text, ok = _call_remote(
            itinerary_url, "itinerary", "itinerary", message,
            "itinerary_agent", _make_itinerary_validator(candidates_json),
            "itinerary",
        )
        if text.startswith("Error calling"):
            return text
        if not ok:
            logger.warning("itinerary returned too few stops after retry; passing through best effort")
        return text or '{"error": "itinerary returned empty response"}'

    return call_planner, call_explorer, call_itinerary


# ── Public builder ──────────────────────────────────────────────────────────────

def build_remote_orchestrator(
    planner_url: str,
    explorer_url: str,
    itinerary_url: str,
) -> LlmAgent:
    """
    Return a production LlmAgent that fans out to three Cloud Run services.
    """
    # Import mongo tools here to keep top-level import clean
    sys_path_root = os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    )
    import sys
    if sys_path_root not in sys.path:
        sys.path.insert(0, sys_path_root)

    from hodari.tools.mongo_tools import load_user_profile, save_preference  # noqa: E402

    call_planner, call_explorer, call_itinerary = _make_tools(
        planner_url, explorer_url, itinerary_url
    )

    REMOTE_ORCHESTRATOR_INSTRUCTION = """You are Hodari, a friendly tourist AI assistant for the 2026 FIFA World Cup.
You help football fans find great places and build feasible itineraries before, between, and after matches.

CRITICAL: Always respond in natural, friendly language. NEVER output raw JSON or code blocks.
CRITICAL: Never use em dashes (the "—" character) in your replies. Use commas, periods, or
parentheses instead. This applies to every message you send the user.

═══ PLANNING FLOW ═══

When the user asks to plan activities or find places:

STEP 1 — Load profile (always first):
  Call load_user_profile() — no arguments needed.
  This returns the user's dietary restrictions, budget, and accessibility needs.
  Silently use this to shape the subsequent steps (do not quote it back to the user).

STEP 2 — Plan:
  Call call_planner with the user's original request as-is.
  This returns a Plan JSON string (goal, constraints, subtasks).

STEP 3 — Explore:
  Call call_explorer with the Plan JSON string from STEP 2.
  This returns a CandidateSet JSON array of 5-10 personalised places.

STEP 4 — Build itinerary:
  Call call_itinerary with two arguments:
    plan_json       = the Plan JSON string from STEP 2
    candidates_json = the CandidateSet JSON string from STEP 3
  This returns an Itinerary JSON string with stops, routes, and a voice summary.

STEP 5 — Present the itinerary:
  Format the result as a friendly message. Example:

  Here's your afternoon near Camp Nou 🗺️

  1. **Alive Restaurant** (2:00 PM · 45 min)
     Great vegan tapas, 0.4 km from Camp Nou. ~5 min walk.

  2. **FC Barcelona Museum** (3:00 PM · 1 hr)
     Immerse yourself in Barça history right before the game. 0.7 km · ~7 min walk.

  Total: ~2 h 30 min · 1.1 km
  *A vegetarian-friendly afternoon with culture and great food near the stadium.*

  Use **bold** for place names, include arrival time, duration, and short walking info.
  End with the voice_summary as a friendly italic closing line.

STEP 6 — Save preferences (always after presenting):
  For each stop in the itinerary, call save_preference with:
    place_id   = the stop's place_id
    place_name = the stop's name
    city       = the city (extract from the address)
    action     = "recommended"
  This builds the user's taste profile for future personalisation.

═══ ERROR HANDLING ═══

If any step returns an error string (starts with "Error calling"):
  Tell the user there was a temporary issue and ask them to try again.
  Do NOT expose raw error messages or stack traces.

═══ OTHER REQUESTS ═══

For simple follow-up questions ("what are the opening hours?", "is it expensive?"):
  Answer directly without re-running the pipeline.

For refinements ("cheaper option", "only 2 hours", "add one more stop"):
  Re-run from STEP 1.

Keep answers concise — users are on mobile near a stadium.
"""

    return LlmAgent(
        model=os.getenv("GEMINI_MODEL", "gemini-2.0-flash"),
        name="hodari",
        description="Hodari — tourist AI assistant for the 2026 FIFA World Cup (remote pipeline)",
        instruction=REMOTE_ORCHESTRATOR_INSTRUCTION,
        tools=[
            load_user_profile,
            save_preference,
            call_planner,
            call_explorer,
            call_itinerary,
        ],
    )
