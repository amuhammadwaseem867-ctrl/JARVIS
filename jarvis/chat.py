"""Shared helper for front ends (terminal, voice): ask the brain, turn API
errors into something JARVIS can say."""

from __future__ import annotations

import anthropic

from .brain import Brain


class FatalError(Exception):
    """An error that retrying won't fix, such as a missing API key."""


def ask(brain: Brain, text: str) -> str:
    """Return JARVIS's answer to ``text``. Raises FatalError for a bad API key."""
    try:
        return brain.think(text).text
    except anthropic.AuthenticationError as exc:
        raise FatalError("No valid API key. Set ANTHROPIC_API_KEY and try again.") from exc
    except anthropic.RateLimitError:
        return "I'm being rate limited. Give me a moment and try again."
    except anthropic.APIConnectionError:
        return "I can't reach the network right now."
    except anthropic.APIStatusError as exc:
        return f"The API returned an error ({exc.status_code}): {exc.message}"
