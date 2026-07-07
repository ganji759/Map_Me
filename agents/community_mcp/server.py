"""
Community MCP server — read-only community data tools for the Hodari agents.

Exposes profiles, shared pins, reviews, and an aggregated "taste profile" over
streamable-http (default http://localhost:3200/mcp) so the ADK agents can use
community signals for personalized recommendations without touching raw HTTP
APIs or the client session model.

════════════════════════════════════════════════════════════════════════════
PRIVACY BOUNDARY (hard, by design — do not relax):

1. This server has NO tool that reads the `messages` or `conversations`
   collections. Private chats are end-to-end encrypted client-side and are
   opaque to the platform; the agents must never see even the ciphertext or
   conversation metadata (membership, timing). The denylist below is enforced
   at the collection-accessor level (`_coll` raises) and asserted by
   tests/test_community_mcp.py against every registered tool.

2. User documents are only ever surfaced through an explicit allowlist
   projection. `email`, `password_hash`, tokens, and `pubkey` are NEVER
   returned. `location` is returned only when the user has `share_location`
   set to true. Non-discoverable users are invisible to search and profile
   lookups.
════════════════════════════════════════════════════════════════════════════

Run (from agents/, with the venv python):
    py -3.12 -m community_mcp.server
Env:
    MONGODB_URI / MDB_MCP_CONNECTION_STRING — Mongo connection string (required)
    MONGODB_DATABASE   — db name (default: hodari)
    COMMUNITY_MCP_PORT — listen port (default: 3200)
    COMMUNITY_MCP_HOST — bind host (default: 127.0.0.1)
"""
from __future__ import annotations

import os
import re
from typing import Any

from mcp.server.fastmcp import FastMCP

# ── Privacy denylist ─────────────────────────────────────────────────────────
# Collections this server must NEVER read. Enforced in _coll(); asserted by
# tests/test_community_mcp.py for every registered tool handler.
DENYLISTED_COLLECTIONS: frozenset[str] = frozenset({"messages", "conversations"})

# User fields that must never leave this server, under any tool.
FORBIDDEN_USER_FIELDS: frozenset[str] = frozenset(
    {"email", "password_hash", "pubkey", "tokens", "session_tokens", "_id"}
)

# ── Mongo (lazy — import of this module must not require a live DB) ─────────

_db = None


def _database():
    """Lazily connect to MongoDB. Raises a clear error if no URI is set."""
    global _db
    if _db is None:
        from pymongo import MongoClient

        uri = os.getenv("MONGODB_URI") or os.getenv("MDB_MCP_CONNECTION_STRING")
        if not uri:
            raise RuntimeError(
                "Community MCP: set MONGODB_URI or MDB_MCP_CONNECTION_STRING"
            )
        client = MongoClient(uri, serverSelectionTimeoutMS=8000)
        _db = client[os.getenv("MONGODB_DATABASE", "hodari")]
    return _db


def _coll(name: str):
    """Guarded collection accessor — the single door to the database.

    Raises PermissionError for denylisted collections so no future tool can
    accidentally read private conversation data.
    """
    if name in DENYLISTED_COLLECTIONS:
        raise PermissionError(
            f"Community MCP privacy boundary: collection '{name}' is denylisted"
        )
    return _database()[name]


# ── Helpers ──────────────────────────────────────────────────────────────────


def _as_id(value: Any) -> str:
    """NoSQL-injection guard: user-supplied ids must be plain short strings."""
    if not isinstance(value, str):
        raise ValueError("expected a string id")
    value = value.strip()
    if not value or len(value) > 128:
        raise ValueError("invalid id")
    return value


def _public_user(doc: dict) -> dict:
    """Allowlist projection of a user document — the ONLY user shape returned.

    Never includes email/password_hash/tokens/pubkey. Location only when the
    user has opted into share_location.
    """
    out = {
        "user_id": doc.get("user_id"),
        "handle": doc.get("handle"),
        "name": doc.get("name"),
        "bio": doc.get("bio", ""),
        "avatar_emoji": doc.get("avatar_emoji"),
        "home_country": doc.get("home_country"),
        "budget_tier": doc.get("budget_tier", "moderate"),
        "dietary": doc.get("dietary", []),
    }
    if doc.get("share_location") is True and doc.get("location"):
        out["location"] = doc["location"]
    assert not (set(out) & FORBIDDEN_USER_FIELDS)
    return out


def _is_discoverable(doc: dict) -> bool:
    # discoverable defaults to true; only an explicit false hides the user.
    return doc.get("discoverable") is not False


def _find_user(handle_or_user_id: str) -> dict | None:
    key = _as_id(handle_or_user_id)
    users = _coll("users")
    return users.find_one({"user_id": key}) or users.find_one({"handle": key.lower()})


def _pin_summary(pin: dict) -> dict:
    place = pin.get("place") or {}
    return {
        "pin_id": pin.get("pin_id"),
        "place_id": place.get("place_id"),
        "place_name": place.get("name"),
        "lat": place.get("lat"),
        "lng": place.get("lng"),
        "address": place.get("address"),
        "note": pin.get("note", ""),
        "created_at": pin.get("created_at"),
    }


def _review_summary(review: dict, handle_by_id: dict[str, str] | None = None) -> dict:
    author_id = review.get("author_id")
    return {
        "review_id": review.get("review_id"),
        "place_id": review.get("place_id"),
        "rating": review.get("rating"),
        "text": review.get("text", ""),
        "author_handle": (handle_by_id or {}).get(author_id),
        "created_at": review.get("created_at"),
    }


def _handles_for(author_ids: list[str]) -> dict[str, str]:
    if not author_ids:
        return {}
    cursor = _coll("users").find(
        {"user_id": {"$in": author_ids}}, {"user_id": 1, "handle": 1}
    )
    return {d["user_id"]: d.get("handle") for d in cursor}


# ── MCP server + tools ───────────────────────────────────────────────────────

mcp = FastMCP(
    "hodari-community",
    instructions=(
        "Read-only Hodari community data: public profiles, shared pins, place "
        "reviews, and aggregated taste profiles. Private conversations and "
        "messages are NOT accessible through this server, by design."
    ),
    host=os.getenv("COMMUNITY_MCP_HOST", "127.0.0.1"),
    port=int(os.getenv("COMMUNITY_MCP_PORT", "3200")),
)


@mcp.tool()
def get_user_profile(handle_or_user_id: str) -> dict:
    """Public community profile for a user, by handle or user_id.

    Returns handle, name, bio, home_country, budget_tier, dietary preferences,
    and stats (shared-pin count, review count). Location is included only when
    the user shares it. Returns {"found": false} for unknown or
    non-discoverable users.
    """
    doc = _find_user(handle_or_user_id)
    if not doc or not _is_discoverable(doc):
        return {"found": False}
    user_id = doc.get("user_id")
    profile = _public_user(doc)
    profile["stats"] = {
        "pin_count": _coll("shared_pins").count_documents({"owner_id": user_id}),
        "review_count": _coll("pin_reviews").count_documents({"author_id": user_id}),
    }
    return {"found": True, "profile": profile}


@mcp.tool()
def search_users(query: str) -> dict:
    """Search discoverable community users by handle or name prefix.

    Returns at most 20 public profiles (same field policy as
    get_user_profile — never emails, keys, or unshared locations).
    """
    q = _as_id(query)
    prefix = re.compile("^" + re.escape(q), re.IGNORECASE)
    cursor = (
        _coll("users")
        .find(
            {
                "discoverable": {"$ne": False},
                "$or": [{"handle": prefix}, {"name": prefix}],
            }
        )
        .limit(20)
    )
    return {"users": [_public_user(d) for d in cursor]}


@mcp.tool()
def list_user_pins(user_id: str) -> dict:
    """Shared pins owned by a user: place name, coordinates, and note.

    Only pins from discoverable users are returned.
    """
    uid = _as_id(user_id)
    owner = _coll("users").find_one({"user_id": uid})
    if not owner or not _is_discoverable(owner):
        return {"pins": []}
    cursor = (
        _coll("shared_pins").find({"owner_id": uid}).sort("created_at", -1).limit(50)
    )
    return {"pins": [_pin_summary(p) for p in cursor]}


@mcp.tool()
def list_place_reviews(place_id: str) -> dict:
    """Community reviews for a Google place_id: rating, text, author handle."""
    pid = _as_id(place_id)
    reviews = list(
        _coll("pin_reviews").find({"place_id": pid}).sort("created_at", -1).limit(50)
    )
    handles = _handles_for([r.get("author_id") for r in reviews if r.get("author_id")])
    return {"reviews": [_review_summary(r, handles) for r in reviews]}


@mcp.tool()
def get_taste_profile(user_id: str) -> dict:
    """Aggregated taste signals for AI recommendations.

    Returns the user's top place categories (derived from the places they
    pinned and reviewed), the average rating they give, and their 5 most
    recent reviews. Empty aggregates for unknown or non-discoverable users.
    """
    uid = _as_id(user_id)
    owner = _coll("users").find_one({"user_id": uid})
    if not owner or not _is_discoverable(owner):
        return {"found": False}

    pins = list(_coll("shared_pins").find({"owner_id": uid}).limit(200))
    reviews = list(
        _coll("pin_reviews").find({"author_id": uid}).sort("created_at", -1).limit(200)
    )

    ratings = [r["rating"] for r in reviews if isinstance(r.get("rating"), (int, float))]
    avg_rating = round(sum(ratings) / len(ratings), 2) if ratings else None

    # Top categories: join the touched place_ids against the places collection
    # (which carries `categories`). Best-effort — [] when places are not cached.
    place_ids = {(p.get("place") or {}).get("place_id") for p in pins}
    place_ids |= {r.get("place_id") for r in reviews}
    place_ids.discard(None)
    counts: dict[str, int] = {}
    if place_ids:
        for place in _coll("places").find(
            {"place_id": {"$in": sorted(place_ids)}}, {"categories": 1}
        ):
            for cat in place.get("categories") or []:
                if isinstance(cat, str):
                    counts[cat] = counts.get(cat, 0) + 1
    top_categories = [
        c for c, _ in sorted(counts.items(), key=lambda kv: -kv[1])[:8]
    ]

    return {
        "found": True,
        "user_id": uid,
        "handle": owner.get("handle"),
        "top_categories": top_categories,
        "avg_rating_given": avg_rating,
        "pin_count": len(pins),
        "review_count": len(reviews),
        "recent_reviews": [_review_summary(r) for r in reviews[:5]],
    }


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
