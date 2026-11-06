"""Web search and page reading.

Both run on Anthropic's servers (the API's web search and web fetch tools), so
there is nothing to install and no extra API key. Claude decides when to
search, reads the results, and cites what it found. Web search is billed per
search on your Anthropic account; ``JARVIS_MAX_WEB_SEARCHES`` caps how many it
may run for one request.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from ..tools import ToolRegistry

if TYPE_CHECKING:
    from . import SkillsConfig

WEB_SEARCH = "web_search_20260209"
WEB_FETCH = "web_fetch_20260209"


def register(registry: ToolRegistry, config: "SkillsConfig") -> None:
    registry.add_server_tool(
        {"type": WEB_SEARCH, "name": "web_search", "max_uses": config.max_web_searches}
    )
    # Fetch only reads URLs that already appear in the conversation (from
    # the user or from search results), so it can't wander off on its own.
    registry.add_server_tool(
        {"type": WEB_FETCH, "name": "web_fetch", "max_uses": 5, "max_content_tokens": 20000}
    )
