"""Shared helper for front ends (terminal, voice, HUD): ask the brain, turn API
errors into something JARVIS can say."""

from __future__ import annotations

from . import providers
from .brain import Brain

FREE_HINT = (
    "To use a free model instead, get a Groq key at https://console.groq.com/keys "
    "and set GROQ_API_KEY (see the README)."
)


class FatalError(Exception):
    """An error that retrying won't fix, such as a missing API key."""


def ask(brain: Brain, text: str) -> str:
    """Return JARVIS's answer to ``text``. Raises FatalError for a bad API key."""
    try:
        return brain.think(text).text
    except providers.AuthError as exc:
        name = exc.provider
        var = providers.KEY_VARS.get(name, ("API key",))[0]
        raise FatalError(
            f"{name.title()} didn't accept the API key ({exc.message}). "
            f"Check {var} (get one at {providers.KEY_PAGES.get(name, '')})."
        ) from exc
    except providers.RateLimited:
        return "I've hit the free tier's rate limit. Give me a minute and try again."
    except providers.ConnectionFailed as exc:
        return exc.message
    except providers.ProviderError as exc:
        return f"The {exc.provider} API returned an error ({exc.status}): {exc.message}"
    except Exception as exc:
        reply = _anthropic_error(exc)
        if reply is None:
            raise
        return reply


def _anthropic_error(exc: Exception) -> str | None:
    try:
        import anthropic
    except ImportError:  # pragma: no cover
        return None
    if isinstance(exc, anthropic.AuthenticationError):
        raise FatalError(
            "No valid API key. Set ANTHROPIC_API_KEY and try again. " + FREE_HINT
        ) from exc
    if isinstance(exc, anthropic.RateLimitError):
        return "I'm being rate limited. Give me a moment and try again."
    if isinstance(exc, anthropic.APIConnectionError):
        return "I can't reach the network right now."
    if isinstance(exc, anthropic.APIStatusError):
        if "credit balance" in str(exc.message).lower():
            raise FatalError(
                "Your Anthropic credit balance is too low to use Claude. " + FREE_HINT
            ) from exc
        return f"The API returned an error ({exc.status_code}): {exc.message}"
    return None
