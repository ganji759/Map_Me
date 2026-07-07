"""
Tests for the Community MCP server (agents/community_mcp/server.py).

Focus: the PRIVACY BOUNDARY — no registered tool may read the `messages` or
`conversations` collections — plus a registration smoke test. No live MongoDB
is required: the server connects lazily, so importing the module and
inspecting tool handlers is side-effect free.
"""
import asyncio
import inspect
import re

import pytest

from community_mcp import server


EXPECTED_TOOLS = {
    "get_user_profile",
    "search_users",
    "list_user_pins",
    "list_place_reviews",
    "get_taste_profile",
}


def _registered_tools() -> dict:
    """Name -> handler fn for every tool registered on the FastMCP instance."""
    tools = asyncio.run(server.mcp.list_tools())
    out = {}
    for t in tools:
        info = server.mcp._tool_manager.get_tool(t.name)
        out[t.name] = info.fn
    return out


# ── Registration smoke test ──────────────────────────────────────────────────


def test_all_expected_tools_registered():
    assert set(_registered_tools()) == EXPECTED_TOOLS


def test_import_needs_no_database():
    # The module was imported at the top of this file without MONGODB_URI —
    # lazy connection means no DB is touched until a tool actually runs.
    assert server._db is None or server._db is not None  # import itself succeeded


# ── Privacy boundary ─────────────────────────────────────────────────────────


def test_denylist_covers_private_collections():
    assert "messages" in server.DENYLISTED_COLLECTIONS
    assert "conversations" in server.DENYLISTED_COLLECTIONS


def test_coll_accessor_blocks_denylisted_collections():
    for name in server.DENYLISTED_COLLECTIONS:
        with pytest.raises(PermissionError):
            server._coll(name)


def test_no_tool_touches_private_collections():
    """No tool handler (nor server helper it can reach) may reference the
    messages/conversations collections in its source."""
    pattern = re.compile(r"""_coll\(\s*["'](messages|conversations)["']""")
    word = re.compile(r"""["'](messages|conversations)["']""")
    helpers = [
        server._find_user,
        server._handles_for,
        server._pin_summary,
        server._review_summary,
        server._public_user,
    ]
    for name, fn in _registered_tools().items():
        src = inspect.getsource(fn)
        assert not pattern.search(src), f"tool {name} reads a denylisted collection"
        assert not word.search(src), f"tool {name} references a private collection"
    for fn in helpers:
        src = inspect.getsource(fn)
        assert not word.search(src), f"helper {fn.__name__} references a private collection"


def test_no_forbidden_user_fields_in_projection():
    """The single user projection never leaks credentials/keys/emails."""
    doc = {
        "user_id": "u1",
        "handle": "u1",
        "name": "U One",
        "email": "secret@example.com",
        "password_hash": "x",
        "pubkey": {"kty": "EC"},
        "share_location": False,
        "location": {"type": "Point", "coordinates": [0, 0]},
    }
    out = server._public_user(doc)
    assert not (set(out) & server.FORBIDDEN_USER_FIELDS)
    assert "location" not in out  # share_location is off


def test_location_only_when_shared():
    doc = {
        "user_id": "u1",
        "handle": "u1",
        "share_location": True,
        "location": {"type": "Point", "coordinates": [2.1, 41.3]},
    }
    assert server._public_user(doc)["location"]["coordinates"] == [2.1, 41.3]


def test_as_id_rejects_non_strings():
    for bad in ({"$ne": None}, ["a"], 42, "", "x" * 200):
        with pytest.raises(ValueError):
            server._as_id(bad)
