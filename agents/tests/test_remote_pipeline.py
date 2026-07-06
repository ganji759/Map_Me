"""Unit tests for the orchestrator's remote (HTTP fan-out) pipeline dispatch."""
import json
from unittest.mock import MagicMock

import pytest

import services.orchestrator.remote_pipeline as rp


# ── Helpers ────────────────────────────────────────────────────────────────────

def _events(author: str, text: str):
    """Shape an ADK /run response: a list of event dicts."""
    return [{"author": author, "content": {"parts": [{"text": text}]}}]


def _resp(json_body, status=200):
    r = MagicMock()
    r.status_code = status
    r.json.return_value = json_body
    r.raise_for_status.return_value = None
    return r


VALID_PLAN = json.dumps({
    "goal": "lunch near the stadium",
    "constraints": {"current_location": "Camp Nou"},
    "subtasks": [{"description": "find vegetarian lunch", "priority": 1}],
})

VALID_CANDIDATES = json.dumps([
    {"place_id": "p1", "name": "A", "address": "x", "coordinates": {"lat": 1.0, "lng": 2.0}},
    {"place_id": "p2", "name": "B", "address": "y", "coordinates": {"lat": 1.0, "lng": 2.0}},
])

VALID_ITINERARY = json.dumps({
    "stops": [
        {"place_id": "p1", "name": "A"},
        {"place_id": "p2", "name": "B"},
    ],
    "voice_summary": "A nice afternoon.",
})


@pytest.fixture(autouse=True)
def _no_auth(monkeypatch):
    # Force auth off so no ID token is minted during tests.
    monkeypatch.setenv("HODARI_SERVICE_AUTH", "none")
    rp._TOKEN_CACHE.clear()


# ── Validators ─────────────────────────────────────────────────────────────────

def test_valid_plan_accepts_good_json():
    assert rp._valid_plan(VALID_PLAN) is True


def test_valid_plan_rejects_garbage():
    assert rp._valid_plan("not json") is False
    assert rp._valid_plan(json.dumps({"missing": "goal"})) is False


def test_valid_candidates_accepts_array_and_strips_fences():
    assert rp._valid_candidates(VALID_CANDIDATES) is True
    assert rp._valid_candidates("```json\n" + VALID_CANDIDATES + "\n```") is True


def test_itinerary_validator_needs_two_stops_when_two_candidates():
    v = rp._make_itinerary_validator(VALID_CANDIDATES)
    assert v(VALID_ITINERARY) is True
    one_stop = json.dumps({"stops": [{"place_id": "p1", "name": "A"}], "voice_summary": "x"})
    assert v(one_stop) is False


# ── Auth header wiring ──────────────────────────────────────────────────────────

def test_auth_headers_empty_when_disabled(monkeypatch):
    monkeypatch.setenv("HODARI_SERVICE_AUTH", "none")
    assert rp._auth_headers("https://svc.run.app") == {}


def test_auth_headers_attaches_bearer_when_iam(monkeypatch):
    monkeypatch.setenv("HODARI_SERVICE_AUTH", "iam")
    monkeypatch.setattr(rp, "_id_token", lambda aud: "tok-" + aud)
    headers = rp._auth_headers("https://svc.run.app/")
    assert headers == {"Authorization": "Bearer tok-https://svc.run.app"}


# ── call_planner / call_explorer / call_itinerary happy paths ───────────────────

def test_call_planner_returns_plan(monkeypatch):
    posts = []

    def fake_post(url, json=None, timeout=None, headers=None):
        posts.append(url)
        if url.endswith("/run"):
            return _resp(_events("planner_agent", VALID_PLAN))
        return _resp({}, status=200)  # session create

    monkeypatch.setattr(rp.requests, "post", fake_post)
    planner, _, _ = rp._make_tools("http://p", "http://e", "http://i")
    out = planner("find lunch near Camp Nou")
    assert json.loads(out)["goal"] == "lunch near the stadium"
    assert any(u.endswith("/run") for u in posts)


def test_call_explorer_returns_candidates(monkeypatch):
    def fake_post(url, json=None, timeout=None, headers=None):
        if url.endswith("/run"):
            return _resp(_events("explorer_agent", VALID_CANDIDATES))
        return _resp({})

    monkeypatch.setattr(rp.requests, "post", fake_post)
    _, explorer, _ = rp._make_tools("http://p", "http://e", "http://i")
    out = explorer(VALID_PLAN)
    assert isinstance(json.loads(out), list)


# ── one-retry-then-graceful-error behaviour ─────────────────────────────────────

def test_planner_retries_once_then_succeeds(monkeypatch):
    calls = {"run": 0}

    def fake_post(url, json=None, timeout=None, headers=None):
        if url.endswith("/run"):
            calls["run"] += 1
            body = "garbage" if calls["run"] == 1 else VALID_PLAN
            return _resp(_events("planner_agent", body))
        return _resp({})

    monkeypatch.setattr(rp.requests, "post", fake_post)
    planner, _, _ = rp._make_tools("http://p", "http://e", "http://i")
    out = planner("x")
    assert calls["run"] == 2                    # retried exactly once
    assert json.loads(out)["goal"]              # second attempt validated


def test_planner_transport_error_twice_returns_graceful(monkeypatch):
    def fake_post(url, json=None, timeout=None, headers=None):
        raise rp.requests.RequestException("boom")

    monkeypatch.setattr(rp.requests, "post", fake_post)
    planner, _, _ = rp._make_tools("http://p", "http://e", "http://i")
    out = planner("x")
    assert out.startswith("Error calling planner")


def test_planner_passthrough_after_two_malformed(monkeypatch):
    def fake_post(url, json=None, timeout=None, headers=None):
        if url.endswith("/run"):
            return _resp(_events("planner_agent", "still garbage"))
        return _resp({})

    monkeypatch.setattr(rp.requests, "post", fake_post)
    planner, _, _ = rp._make_tools("http://p", "http://e", "http://i")
    out = planner("x")
    # Graceful: returns best-effort text, not an exception.
    assert out == "still garbage"


def test_run_once_prefers_target_author(monkeypatch):
    events = [
        {"author": "planner_agent", "content": {"parts": [{"text": "PLAN"}]}},
        {"author": "some_tool", "content": {"parts": [{"text": "noise"}]}},
    ]

    def fake_post(url, json=None, timeout=None, headers=None):
        return _resp(events)

    monkeypatch.setattr(rp.requests, "post", fake_post)
    text = rp._run_once("http://p", "planner", "sid", "msg", "planner_agent")
    assert text == "PLAN"
