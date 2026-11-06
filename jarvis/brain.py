"""The JARVIS brain: Claude in an agent loop with memory and tools.

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

import anthropic

from .config import BrainConfig
from .memory import ConversationMemory, FactStore
from .skills import SkillsConfig, register_skills
from .tools import Confirmer, ToolRegistry, register_builtin_tools

log = logging.getLogger("jarvis.brain")

FALLBACK_BETA = "server-side-fallback-2026-07-01"


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
            client: an ``anthropic.Anthropic`` client (injectable for tests).
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
        self.client = client or anthropic.Anthropic()
        self.on_tool_call = on_tool_call

        self.memory = ConversationMemory(self.config.conversation_path if persist else None)
        self.facts = FactStore(self.config.facts_path if persist else None)
        self.tools = ToolRegistry(confirm=confirm)
        register_builtin_tools(self.tools, self.facts)
        register_skills(self.tools, skills or SkillsConfig.from_env())

    # ------------------------------------------------------------------ API

    def think(self, user_input: str) -> Reply:
        """Handle one user message and return JARVIS's reply."""
        checkpoint = self.memory.checkpoint()
        self.memory.add_user(user_input)
        tool_calls: list[ToolCall] = []

        try:
            for _ in range(self.config.max_tool_rounds):
                response = self._call_claude()

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

    def reset(self) -> None:
        """Forget the current conversation (long-term facts are kept)."""
        self.memory.clear()

    # ------------------------------------------------------------ internals

    def _call_claude(self) -> Any:
        params: dict[str, Any] = {
            "model": self.config.model,
            "max_tokens": self.config.max_tokens,
            "system": self.config.system_prompt,
            "messages": self.memory.messages,
            "tools": self.tools.schemas(),
            "output_config": {"effort": self.config.effort},
            # Caches the system prompt, tools and history between calls.
            "cache_control": {"type": "ephemeral"},
        }
        if self.config.use_fallbacks:
            return self.client.beta.messages.create(
                betas=[FALLBACK_BETA], fallbacks="default", **params
            )
        return self.client.messages.create(**params)


def _text_of(content: list[Any]) -> str:
    return "\n".join(b.text for b in content if b.type == "text").strip()
