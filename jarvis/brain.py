"""The JARVIS brain: an AI model (Claude, or a free one) in an agent loop with memory and tools.

Typical use from the rest of the app::

    from jarvis import Brain

    brain = Brain()                      # reads settings from the environment
    reply = brain.think("What time is it in Tokyo?")
    print(reply.text)

Each call to ``think`` is one user turn. Inside it the brain may call Claude
several times: whenever Claude asks for a tool, the brain runs it, hands the
result back, and lets Claude continue until it has a final answer.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Callable

from .agents import BUILTIN_DIR, AgentFileError, AgentRegistry, AgentSpec
from .config import BrainConfig
from .memory import ConversationMemory, FactStore
from .supervisor import Supervisor
from .providers import make_provider
from .skills import SkillsConfig, register_skills
from .tools import Confirmer, ToolRegistry, register_builtin_tools

log = logging.getLogger("jarvis.brain")


@dataclass
class ToolCall:
    name: str
    input: dict[str, Any]
    result: str
    is_error: bool


@dataclass
class Reply:
    """What the brain says back for one user turn."""

    text: str
    tool_calls: list[ToolCall] = field(default_factory=list)
    stop_reason: str | None = None
    # Model that actually answered (differs from the configured one if a
    # fallback model stepped in after a refusal).
    model: str | None = None
    refused: bool = False


@dataclass
class AgentResult:
    """What a specialist agent hands back to JARVIS."""

    agent: str
    ok: bool
    text: str
    tool_calls: list[ToolCall] = field(default_factory=list)
    error: str = ""
    seconds: float = 0.0


AGENT_FOOTER = """

You are one of JARVIS's specialist agents. JARVIS gives you one task and passes \
your answer on to the user, so answer the task directly and completely in plain \
language. Use only the tools you have been given. If you can't do the task, say \
so in one sentence."""


class Brain:
    def __init__(
        self,
        config: BrainConfig | None = None,
        client: Any | None = None,
        persist: bool = True,
        on_tool_call: Callable[[ToolCall], None] | None = None,
        skills: SkillsConfig | None = None,
        confirm: Confirmer | None = None,
    ):
        """
        Args:
            config: settings; defaults to ``BrainConfig.from_env()``.
            client: an ``anthropic.Anthropic`` client (injectable for tests;
                only used when the provider is Claude).
            persist: save conversation and facts under ``config.data_dir``.
            on_tool_call: optional callback fired after each tool runs, so a
                UI or voice layer can show "checking the time..." etc.
            skills: which real-world skills to load; defaults to
                ``SkillsConfig.from_env()`` (all of them unless ``JARVIS_SKILLS``
                says otherwise).
            confirm: asks the user a yes/no question before a risky action.
                Without one, risky actions are always declined. Can also be
                set later as ``brain.tools.confirm``.
        """
        self.config = config or BrainConfig.from_env()
        self.provider = make_provider(self.config, client)
        # The Anthropic client when the provider is Claude, else None.
        self.client = getattr(self.provider, "client", None)
        self.on_tool_call = on_tool_call

        self.memory = ConversationMemory(self.config.conversation_path if persist else None)
        self.facts = FactStore(self.config.facts_path if persist else None)
        self.tools = ToolRegistry(confirm=confirm)
        register_builtin_tools(self.tools, self.facts)
        register_skills(
            self.tools,
            skills or SkillsConfig.from_env(),
            # Anthropic runs web search itself; other providers use JARVIS's own.
            server_web=self.config.provider == "claude",
        )
        # Specialist agents: built-in ones plus the user's own in ~/.jarvis/agents.
        self.agents = AgentRegistry([BUILTIN_DIR, self.config.data_dir / "agents"])
        self.supervisor = Supervisor()

    # ------------------------------------------------------------------ API

    def think(self, user_input: str) -> Reply:
        """Handle one user message and return JARVIS's reply."""
        checkpoint = self.memory.checkpoint()
        self.memory.add_user(user_input)
        tool_calls: list[ToolCall] = []

        try:
            for _ in range(self.config.max_tool_rounds):
                response = self._call_model()

                if response.stop_reason == "refusal":
                    # Drop this turn so the declined request isn't replayed.
                    self.memory.rollback(checkpoint)
                    return Reply(
                        text="I'm afraid I can't help with that one.",
                        tool_calls=tool_calls,
                        stop_reason="refusal",
                        model=getattr(response, "model", None),
                        refused=True,
                    )

                self.memory.add_assistant(response.content)
                for block in response.content:
                    if block.type == "server_tool_use":
                        # Web search / fetch: Anthropic already ran it.
                        call = ToolCall(block.name, block.input, "(run by Anthropic)", False)
                        tool_calls.append(call)
                        if self.on_tool_call:
                            self.on_tool_call(call)
                tool_uses = [b for b in response.content if b.type == "tool_use"]

                if response.stop_reason == "pause_turn":
                    continue
                if not tool_uses:
                    self.memory.save()
                    return Reply(
                        text=_text_of(response.content),
                        tool_calls=tool_calls,
                        stop_reason=response.stop_reason,
                        model=getattr(response, "model", None),
                    )

                results = []
                for block in tool_uses:
                    if response.stop_reason == "max_tokens":
                        # The call may have been cut off mid-input; don't run it.
                        result, is_error = "Output was cut off before this call finished.", True
                    else:
                        result, is_error = self.tools.run(block.name, block.input)
                    call = ToolCall(block.name, block.input, result, is_error)
                    tool_calls.append(call)
                    log.info("tool %s(%s) -> %s", block.name, block.input, result[:200])
                    if self.on_tool_call:
                        self.on_tool_call(call)
                    results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": result,
                            "is_error": is_error,
                        }
                    )
                # All results go back together in one user message.
                self.memory.add_user(results)

            self.memory.save()
            return Reply(
                text="I got stuck in a loop of tool calls, so I stopped. Could you rephrase?",
                tool_calls=tool_calls,
                stop_reason="max_tool_rounds",
            )
        except Exception:
            # Leave history as it was before this turn so the next one works.
            self.memory.rollback(checkpoint)
            raise

    def run_agent(self, name: str, task: str) -> AgentResult:
        """Give ``task`` to one specialist agent and return its answer.

        Never raises: a missing agent, a crash, a timeout or an API error all
        come back as ``AgentResult(ok=False)`` with the reason, and an agent
        that keeps failing is switched off for a while by the supervisor.
        The agent works in its own scratch conversation, so nothing it does
        is added to JARVIS's conversation history.
        """
        name = name.strip().lower()
        try:
            spec = self.agents.get(name)
        except KeyError:
            return AgentResult(name, False, "", error=f"there's no agent called '{name}'")
        except (AgentFileError, OSError) as exc:
            return AgentResult(name, False, "", error=f"its file is broken: {exc}")

        tool_calls: list[ToolCall] = []
        outcome = self.supervisor.run(
            f"agent:{name}",
            lambda: self._agent_loop(spec, task, tool_calls),
            timeout=spec.timeout,
            paused=lambda: self.tools.waiting_on_user > 0,
        )
        if outcome.ok:
            return AgentResult(name, True, outcome.value, tool_calls, seconds=outcome.seconds)
        log.warning("agent %s failed: %s", name, outcome.error)
        return AgentResult(name, False, "", tool_calls, outcome.error, outcome.seconds)

    def agent_tools(self, spec: AgentSpec) -> list[str]:
        """The agent's tools that are actually switched on right now."""
        available = set(self.tools.names())
        return [t for t in spec.tools if t in available]

    def status(self) -> dict[str, Any]:
        """A snapshot of JARVIS's health, for ``/status`` and the HUD."""
        return {
            "provider": self.config.provider,
            "model": self.config.model,
            "tools": len(self.tools.names()),
            "agents": len(self.agents),
            "agents_loaded": self.agents.loaded(),
            "agent_file_errors": [f"{p.name}: {e}" for p, e in self.agents.errors],
            "jobs": self.supervisor.status(),
        }

    def reset(self) -> None:
        """Forget the current conversation (long-term facts are kept)."""
        self.memory.clear()

    # ------------------------------------------------------------ internals

    def _agent_loop(self, spec: AgentSpec, task: str, tool_calls: list[ToolCall]) -> str:
        allowed = self.agent_tools(spec)
        schemas = self.tools.schemas(only=allowed)
        system = spec.prompt + AGENT_FOOTER
        scratch = ConversationMemory(None)
        scratch.add_user(task)
        for _ in range(spec.max_rounds):
            response = self.provider.create(system, scratch.messages, schemas)
            if response.stop_reason == "refusal":
                return "I'm afraid I can't help with that one."
            scratch.add_assistant(response.content)
            tool_uses = [b for b in response.content if b.type == "tool_use"]
            if response.stop_reason == "pause_turn":
                continue
            if not tool_uses:
                return _text_of(response.content)
            results = []
            for block in tool_uses:
                if response.stop_reason == "max_tokens":
                    result, is_error = "Output was cut off before this call finished.", True
                else:
                    result, is_error = self.tools.run(block.name, block.input, allowed=allowed)
                call = ToolCall(block.name, block.input, result, is_error)
                tool_calls.append(call)
                log.info("agent %s: tool %s -> %s", spec.name, block.name, result[:200])
                if self.on_tool_call:
                    try:
                        self.on_tool_call(call)
                    except Exception:  # a display glitch mustn't stop the agent
                        log.exception("on_tool_call failed")
                results.append(
                    {"type": "tool_result", "tool_use_id": block.id, "content": result, "is_error": is_error}
                )
            scratch.add_user(results)
        raise RuntimeError(f"didn't finish within {spec.max_rounds} rounds of tool use")

    def _call_model(self) -> Any:
        return self.provider.create(
            self.config.system_prompt, self.memory.messages, self.tools.schemas()
        )


def _text_of(content: list[Any]) -> str:
    return "\n".join(b.text for b in content if b.type == "text").strip()
