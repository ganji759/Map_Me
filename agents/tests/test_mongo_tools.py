"""
Tests for the Phase 2 MongoDB tools.

  load_user_profile        — reads the user document through the MCP server
  save_preference          — embeds the interaction and upserts it
  find_similar_preferences — Atlas Vector Search over the user's history

All MongoDB access goes through the MongoDB MCP server, so the seam these
tests stub is `mongo_tools._mcp_tool`, not a driver client.
"""
import pytest
from unittest.mock import MagicMock
import hodari.tools.mongo_tools as mt


FAKE_EMBEDDING = [0.1] * 768


# ── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def reset_session():
    """The module caches an MCP session id — clear it between tests."""
    mt._session_id = None
    yield
    mt._session_id = None


def make_ctx(user_id: str = "test_user_42") -> MagicMock:
    """Return a minimal ADK ToolContext mock.

    `_user_id` reads `tool_context.session.user_id` first and falls back to the
    older `invocation_context` path, so set both.
    """
    ctx = MagicMock()
    ctx.session.user_id = user_id
    ctx.invocation_context.session.user_id = user_id
    ctx.state = {}
    return ctx


class NoSessionCtx:
    """A context that exposes no session at all, so `_user_id` must fall back."""

    def __init__(self):
        self.state = {}

    def __getattr__(self, name):
        raise AttributeError(name)


def mcp_result(docs: list[dict]) -> dict:
    """Build an MCP tool result in the `structuredContent` shape."""
    return {"structuredContent": {"documents": docs}}


def patch_embed(monkeypatch) -> MagicMock:
    """Stub the Vertex AI embedding REST call (ADC auth) to return FAKE_EMBEDDING."""
    mock_creds = MagicMock()
    mock_creds.token = "fake-bearer-token"
    monkeypatch.setattr("google.auth.default", lambda scopes=None: (mock_creds, "fake-project"))
    monkeypatch.setattr("google.auth.transport.requests.Request", MagicMock)

    mock_post = MagicMock()
    mock_post.return_value.raise_for_status = MagicMock()
    mock_post.return_value.json.return_value = {
        "predictions": [{"embeddings": {"values": FAKE_EMBEDDING}}]
    }
    monkeypatch.setattr("hodari.tools.mongo_tools.requests.post", mock_post)
    return mock_post


def patch_mcp(monkeypatch, result: dict | None = None) -> MagicMock:
    """Stub `_mcp_tool` and return the mock so callers can assert on it."""
    mock_tool = MagicMock(return_value=result if result is not None else {})
    monkeypatch.setattr("hodari.tools.mongo_tools._mcp_tool", mock_tool)
    return mock_tool


def embed_text(mock_post: MagicMock) -> str:
    """Read back the text that was sent to the embedding endpoint."""
    return mock_post.call_args.kwargs["json"]["instances"][0]["content"]


# ── _parse_docs ───────────────────────────────────────────────────────────────

class TestParseDocs:
    def test_reads_structured_content_documents(self):
        assert mt._parse_docs(mcp_result([{"a": 1}])) == [{"a": 1}]

    def test_reads_a_bare_structured_content_list(self):
        assert mt._parse_docs({"structuredContent": [{"a": 1}]}) == [{"a": 1}]

    def test_reads_documents_wrapped_in_untrusted_data_tags(self):
        result = {
            "content": [
                {
                    "text": (
                        "Warning about <untrusted-user-data-x> and "
                        "</untrusted-user-data-x> tags.\n"
                        '<untrusted-user-data-abc123>[{"place_id": "p1"}]'
                        "</untrusted-user-data-abc123>"
                    )
                }
            ]
        }
        assert mt._parse_docs(result) == [{"place_id": "p1"}]

    def test_returns_empty_list_when_there_is_nothing_to_parse(self):
        assert mt._parse_docs({}) == []


# ── load_user_profile ─────────────────────────────────────────────────────────

class TestLoadUserProfile:
    def test_returns_existing_profile(self, monkeypatch):
        doc = {"_id": "abc", "user_id": "test_user_42", "budget_tier": "mid"}
        patch_mcp(monkeypatch, mcp_result([doc]))
        ctx = make_ctx()

        profile = mt.load_user_profile(ctx)

        assert profile == {"user_id": "test_user_42", "budget_tier": "mid"}
        assert "_id" not in profile

    def test_queries_the_users_collection_by_user_id(self, monkeypatch):
        mock_tool = patch_mcp(monkeypatch, mcp_result([{"user_id": "test_user_42"}]))

        mt.load_user_profile(make_ctx())

        tool_name, args = mock_tool.call_args.args
        assert tool_name == "find"
        assert args["collection"] == "users"
        assert args["filter"] == {"user_id": "test_user_42"}
        assert args["limit"] == 1

    def test_caches_profile_in_session_state(self, monkeypatch):
        doc = {"user_id": "test_user_42", "budget_tier": "mid"}
        patch_mcp(monkeypatch, mcp_result([doc]))
        ctx = make_ctx()

        mt.load_user_profile(ctx)

        assert ctx.state["user_profile"] == doc

    def test_returns_new_user_flag_when_not_found(self, monkeypatch):
        patch_mcp(monkeypatch, mcp_result([]))
        ctx = make_ctx()

        profile = mt.load_user_profile(ctx)

        assert profile == {"user_id": "test_user_42", "new_user": True}
        assert ctx.state["user_profile"] == profile

    def test_returns_empty_dict_on_mcp_exception(self, monkeypatch):
        mock_tool = patch_mcp(monkeypatch)
        mock_tool.side_effect = RuntimeError("MCP down")

        assert mt.load_user_profile(make_ctx()) == {}

    def test_falls_back_to_anonymous_when_context_lacks_session(self, monkeypatch):
        mock_tool = patch_mcp(monkeypatch, mcp_result([]))

        profile = mt.load_user_profile(NoSessionCtx())

        assert profile["user_id"] == "anonymous"
        assert mock_tool.call_args.args[1]["filter"] == {"user_id": "anonymous"}


# ── save_preference ───────────────────────────────────────────────────────────

class TestSavePreference:
    def test_saves_interaction_with_upsert(self, monkeypatch):
        patch_embed(monkeypatch)
        mock_tool = patch_mcp(monkeypatch)

        msg = mt.save_preference("p1", "Alive Restaurant", "Barcelona", "liked", make_ctx())

        tool_name, args = mock_tool.call_args.args
        assert tool_name == "update-many"
        assert args["collection"] == "interactions"
        assert args["upsert"] is True
        assert msg == "Saved: liked → Alive Restaurant (Barcelona)"

    def test_embeds_place_name_city_action(self, monkeypatch):
        mock_post = patch_embed(monkeypatch)
        patch_mcp(monkeypatch)

        mt.save_preference("p1", "Alive Restaurant", "Barcelona", "liked", make_ctx())

        assert embed_text(mock_post) == "Alive Restaurant Barcelona liked"

    def test_stores_embedding_in_set(self, monkeypatch):
        patch_embed(monkeypatch)
        mock_tool = patch_mcp(monkeypatch)

        mt.save_preference("p1", "Alive Restaurant", "Barcelona", "liked", make_ctx())

        update = mock_tool.call_args.args[1]["update"]["$set"]
        assert update["embedding"] == FAKE_EMBEDDING
        assert update["place_name"] == "Alive Restaurant"
        assert update["city"] == "Barcelona"
        assert update["action"] == "liked"

    def test_upsert_filter_uses_user_id_and_place_id(self, monkeypatch):
        patch_embed(monkeypatch)
        mock_tool = patch_mcp(monkeypatch)

        mt.save_preference("p1", "Alive Restaurant", "Barcelona", "liked", make_ctx())

        assert mock_tool.call_args.args[1]["filter"] == {
            "user_id": "test_user_42",
            "place_id": "p1",
        }

    @pytest.mark.parametrize(
        "action", ["liked", "disliked", "visited", "skipped", "recommended"]
    )
    def test_accepts_all_valid_actions(self, monkeypatch, action):
        patch_embed(monkeypatch)
        mock_tool = patch_mcp(monkeypatch)

        msg = mt.save_preference("p1", "Alive Restaurant", "Barcelona", action, make_ctx())

        assert mock_tool.call_args.args[1]["update"]["$set"]["action"] == action
        assert msg.startswith(f"Saved: {action}")

    def test_returns_noncritical_message_on_embed_failure(self, monkeypatch):
        mock_creds = MagicMock()
        mock_creds.token = "fake-bearer-token"
        monkeypatch.setattr("google.auth.default", lambda scopes=None: (mock_creds, "fake"))
        monkeypatch.setattr("google.auth.transport.requests.Request", MagicMock)
        monkeypatch.setattr(
            "hodari.tools.mongo_tools.requests.post",
            MagicMock(side_effect=RuntimeError("Vertex down")),
        )
        patch_mcp(monkeypatch)

        msg = mt.save_preference("p1", "Alive Restaurant", "Barcelona", "liked", make_ctx())

        assert msg == "Preference not saved (non-critical)."

    def test_returns_noncritical_message_on_mcp_failure(self, monkeypatch):
        patch_embed(monkeypatch)
        mock_tool = patch_mcp(monkeypatch)
        mock_tool.side_effect = RuntimeError("MCP down")

        msg = mt.save_preference("p1", "Alive Restaurant", "Barcelona", "liked", make_ctx())

        assert msg == "Preference not saved (non-critical)."


# ── find_similar_preferences ──────────────────────────────────────────────────

def vector_stage(mock_tool: MagicMock) -> dict:
    """Pull the $vectorSearch stage out of the pipeline that was sent."""
    pipeline = mock_tool.call_args.args[1]["pipeline"]
    return pipeline[0]["$vectorSearch"]


class TestFindSimilarPreferences:
    def test_returns_vector_search_results(self, monkeypatch):
        patch_embed(monkeypatch)
        hits = [{"place_id": "p1", "place_name": "Alive", "score": 0.9}]
        patch_mcp(monkeypatch, mcp_result(hits))

        assert mt.find_similar_preferences("tapas", make_ctx()) == hits

    def test_pipeline_uses_vectorsearch_stage(self, monkeypatch):
        patch_embed(monkeypatch)
        mock_tool = patch_mcp(monkeypatch, mcp_result([]))

        mt.find_similar_preferences("tapas", make_ctx())

        tool_name, args = mock_tool.call_args.args
        assert tool_name == "aggregate"
        assert args["collection"] == "interactions"
        assert vector_stage(mock_tool)["index"] == "interactions_embedding"
        assert vector_stage(mock_tool)["path"] == "embedding"

    def test_pipeline_filters_by_user_id(self, monkeypatch):
        patch_embed(monkeypatch)
        mock_tool = patch_mcp(monkeypatch, mcp_result([]))

        mt.find_similar_preferences("tapas", make_ctx())

        assert vector_stage(mock_tool)["filter"] == {"user_id": {"$eq": "test_user_42"}}

    def test_pipeline_sends_query_embedding(self, monkeypatch):
        mock_post = patch_embed(monkeypatch)
        mock_tool = patch_mcp(monkeypatch, mcp_result([]))

        mt.find_similar_preferences("vegetarian tapas", make_ctx())

        assert embed_text(mock_post) == "vegetarian tapas"
        assert vector_stage(mock_tool)["queryVector"] == FAKE_EMBEDDING

    def test_respects_limit_parameter(self, monkeypatch):
        patch_embed(monkeypatch)
        mock_tool = patch_mcp(monkeypatch, mcp_result([]))

        mt.find_similar_preferences("tapas", make_ctx(), limit=3)

        stage = vector_stage(mock_tool)
        assert stage["limit"] == 3
        assert stage["numCandidates"] == 18

    def test_returns_empty_list_when_index_not_configured(self, monkeypatch):
        patch_embed(monkeypatch)
        mock_tool = patch_mcp(monkeypatch)
        mock_tool.side_effect = RuntimeError("index not found")

        assert mt.find_similar_preferences("tapas", make_ctx()) == []

    def test_returns_empty_list_on_embed_failure(self, monkeypatch):
        mock_creds = MagicMock()
        mock_creds.token = "fake-bearer-token"
        monkeypatch.setattr("google.auth.default", lambda scopes=None: (mock_creds, "fake"))
        monkeypatch.setattr("google.auth.transport.requests.Request", MagicMock)
        monkeypatch.setattr(
            "hodari.tools.mongo_tools.requests.post",
            MagicMock(side_effect=RuntimeError("Vertex down")),
        )
        patch_mcp(monkeypatch)

        assert mt.find_similar_preferences("tapas", make_ctx()) == []

    def test_skips_the_search_for_a_new_user(self, monkeypatch):
        patch_embed(monkeypatch)
        mock_tool = patch_mcp(monkeypatch, mcp_result([]))
        ctx = make_ctx()
        ctx.state["user_profile"] = {"user_id": "test_user_42", "new_user": True}

        assert mt.find_similar_preferences("tapas", ctx) == []
        mock_tool.assert_not_called()
