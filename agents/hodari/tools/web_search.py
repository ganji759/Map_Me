"""Web search tool — Gemini's Google Search grounding, exposed as an AgentTool.

`google_search` is a built-in Gemini tool and cannot be mixed directly with the
orchestrator's other function tools, so ADK provides GoogleSearchAgentTool: a
sub-agent that ONLY does google_search, wrapped as a callable tool. Grounding
runs through Vertex AI (ADC) — no separate search API key, which suits the
org's no-API-key policy.

Used only for TIME-SENSITIVE facts (events, festivals, transit disruptions,
news, today's hours/prices) — grounded place discovery still goes through the
Maps pipeline.
"""

from __future__ import annotations

import os

from google.adk.agents import LlmAgent
from google.adk.tools import google_search
from google.adk.tools.google_search_agent_tool import GoogleSearchAgentTool

_SEARCH_INSTRUCTION = """You are Hodari's web-search specialist. Use the google_search tool to
find CURRENT, factual information from the live web, then answer the query directly.

Rules:
- Always call google_search; never answer time-sensitive questions from memory.
- Return a concise, factual summary (a few sentences or short bullet points), not an essay.
- Include concrete specifics when available: dates, times, prices, line/route names, place names.
- Briefly name your sources (e.g. "per RATP", "per the festival's site"). Do NOT paste raw URLs.
- If the search finds nothing relevant, say so plainly instead of guessing.
- Never invent events, schedules, or prices.
"""


def create_web_search_tool() -> GoogleSearchAgentTool:
    """Build the web_search AgentTool the orchestrator can call."""
    model = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")
    search_agent = LlmAgent(
        name="web_search",
        model=model,
        description=(
            "Search the LIVE web for time-sensitive facts the Maps pipeline can't give: "
            "events, festivals, concerts, transit disruptions/strikes, news, public holidays, "
            "and today's opening hours or current prices. Input: a natural-language query. "
            "Do NOT use for general place discovery (use the planning pipeline for that)."
        ),
        instruction=_SEARCH_INSTRUCTION,
        tools=[google_search],
    )
    return GoogleSearchAgentTool(search_agent)
