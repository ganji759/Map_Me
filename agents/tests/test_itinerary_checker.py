"""Tests for the itinerary stop-count validator (1-stop-itinerary bug fix)."""
import json

from hodari.sub_agents.itinerary import validate_itinerary


def _candidates(n):
    return json.dumps([
        {"place_id": f"ChIJ{i}", "name": f"Place {i}", "address": "X",
         "coordinates": {"lat": 0.0, "lng": 0.0}}
        for i in range(n)
    ])


def _itinerary(place_ids):
    return json.dumps({
        "stops": [{"place_id": pid, "name": pid, "rationale": "fits"} for pid in place_ids],
        "voice_summary": "ok",
    })


def test_two_stops_passes():
    assert validate_itinerary(_itinerary(["ChIJ0", "ChIJ1"]), _candidates(5)) is None


def test_one_stop_with_many_candidates_fails():
    fb = validate_itinerary(_itinerary(["ChIJ0"]), _candidates(6))
    assert fb is not None and "2-3" in fb


def test_one_stop_with_one_candidate_passes():
    assert validate_itinerary(_itinerary(["ChIJ0"]), _candidates(1)) is None


def test_duplicated_stop_counts_as_one():
    fb = validate_itinerary(_itinerary(["ChIJ0", "ChIJ0"]), _candidates(5))
    assert fb is not None


def test_invalid_json_fails():
    assert validate_itinerary("not json at all", _candidates(5)) is not None


def test_empty_stops_fails():
    assert validate_itinerary(json.dumps({"stops": [], "voice_summary": ""}), _candidates(5)) is not None


def test_markdown_fenced_json_is_parsed():
    raw = "```json\n" + _itinerary(["ChIJ0", "ChIJ1"]) + "\n```"
    assert validate_itinerary(raw, _candidates(5)) is None


def test_dict_inputs_accepted():
    itin = {"stops": [{"place_id": "a"}, {"place_id": "b"}], "voice_summary": "x"}
    cands = [{"place_id": "a"}, {"place_id": "b"}, {"place_id": "c"}]
    assert validate_itinerary(itin, cands) is None


def test_missing_candidates_tolerates_one_stop():
    assert validate_itinerary(_itinerary(["ChIJ0"]), None) is None
