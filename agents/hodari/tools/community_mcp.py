"""
Toolset factory for the Community MCP server (agents/community_mcp/server.py).

Mirrors maps_mcp.py: a McpToolset over streamable-http. The community server
exposes READ-ONLY tools (get_user_profile, search_users, list_user_pins,
list_place_reviews, get_taste_profile) and — by design — has no access to
private conversations or messages.
"""
import os

from google.adk.tools.mcp_tool.mcp_toolset import McpToolset
from google.adk.tools.mcp_tool.mcp_session_manager import StreamableHTTPConnectionParams

DEFAULT_COMMUNITY_MCP_URL = "http://localhost:3200/mcp"


def community_mcp_enabled() -> bool:
    """Community tools are opt-in: on only when COMMUNITY_MCP_URL is set or
    COMMUNITY_MCP_ENABLED is truthy."""
    if os.getenv("COMMUNITY_MCP_URL"):
        return True
    return os.getenv("COMMUNITY_MCP_ENABLED", "").lower() in ("1", "true", "yes")


def create_community_toolset(tools: list[str] | None = None) -> McpToolset:
    """
    Returns a McpToolset connected to the Community MCP server.

    Available tools: get_user_profile, search_users, list_user_pins,
    list_place_reviews, get_taste_profile.
    Pass `tools` to restrict which ones the agent can use.
    """
    params = StreamableHTTPConnectionParams(
        url=os.getenv("COMMUNITY_MCP_URL", DEFAULT_COMMUNITY_MCP_URL),
    )
    if tools:
        return McpToolset(connection_params=params, tool_filter=tools)
    return McpToolset(connection_params=params)
