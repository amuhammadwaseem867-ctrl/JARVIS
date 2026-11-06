"""Shared helper for front ends (terminal, voice, HUD): ask the brain, turn API
errors into something JARVIS can say."""

from __future__ import annotations

import logging

from . import providers
from .brain import Brain

FREE_HINT = (
    "To use a free model instead, get a Groq key at https://console.groq.com/keys "
    "and set GROQ_API_KEY (see the README)."
)


log = logging.getLogger("jarvis.chat")


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
        if reply is not None:
            return reply
        # Anything else is a bug somewhere inside JARVIS. Log it and keep
        # running: one bad request must never shut JARVIS down.
        log.exception("unexpected error while answering %r", text)
        return f"Something went wrong inside me ({type(exc).__name__}: {exc}). I'm still running, so try again."



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


AGENT_COMMANDS_HELP = "/agents (list specialists), /agent NAME TASK (ask one), /status (health)"


def agent_command(brain: Brain, text: str) -> str | None:
    """Handle ``/agents``, ``/agent NAME TASK`` and ``/status``.

    Returns the text to show, or None if ``text`` isn't one of these commands.
    """
    parts = text.strip().split(maxsplit=2)
    if not parts:
        return None
    cmd = parts[0].lower()
    if cmd == "/agents":
        lines = [f"{len(brain.agents)} agents:"]
        for spec in brain.agents.all():
            missing = [t for t in spec.tools if t not in brain.agent_tools(spec)]
            note = f"  (tools switched off: {', '.join(missing)})" if missing else ""
            lines.append(f"  {spec.name:<16} {spec.description}{note}")
        for path, error in brain.agents.errors:
            lines.append(f"  ! {path.name}: {error}")
        return "\n".join(lines)
    if cmd == "/agent":
        if len(parts) < 3:
            return "Usage: /agent NAME TASK, e.g. /agent translator say good morning in Urdu"
        result = brain.run_agent(parts[1], parts[2])
        if result.ok:
            return f"[{result.agent}] {result.text}"
        return f"The {result.agent} agent couldn't do that: {result.error}"
    if cmd == "/status":
        s = brain.status()
        lines = [
            f"Model: {s['provider']}: {s['model']}",
            f"Tools: {s['tools']}   Agents: {s['agents']} "
            f"(in memory: {', '.join(s['agents_loaded']) or 'none'})",
        ]
        for problem in s["agent_file_errors"]:
            lines.append(f"Broken agent file: {problem}")
        for job, h in s["jobs"].items():
            err = f", last error: {h['last_error']}" if h["last_error"] else ""
            lines.append(f"  {job:<22} {h['state']}, {h['runs']} runs, {h['failed']} failed{err}")
        if not s["jobs"]:
            lines.append("No agents have run yet.")
        return "\n".join(lines)
    return None
