"""Talk to JARVIS in the terminal: ``python -m jarvis``."""

from __future__ import annotations

import sys

import anthropic

from .brain import Brain, ToolCall

HELP = "Commands: /reset (new conversation), /facts (show memory), /quit"


def main() -> int:
    def show_tool(call: ToolCall) -> None:
        mark = "!" if call.is_error else "·"
        print(f"  {mark} {call.name}({call.input}) -> {call.result[:120]}")

    brain = Brain(on_tool_call=show_tool)
    print(f"JARVIS online ({brain.config.model}). {HELP}")

    while True:
        try:
            text = input("\nyou > ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return 0
        if not text:
            continue
        if text in ("/quit", "/exit"):
            return 0
        if text == "/reset":
            brain.reset()
            print("Conversation cleared.")
            continue
        if text == "/facts":
            print(brain.facts.search("") or "No facts saved yet.")
            continue

        try:
            reply = brain.think(text)
        except anthropic.AuthenticationError:
            print("No valid API key. Set ANTHROPIC_API_KEY and try again.", file=sys.stderr)
            return 1
        except anthropic.RateLimitError:
            print("jarvis > I'm being rate limited. Give me a moment and try again.")
            continue
        except anthropic.APIConnectionError:
            print("jarvis > I can't reach the network right now.")
            continue
        except anthropic.APIStatusError as exc:
            print(f"jarvis > The API returned an error ({exc.status_code}): {exc.message}")
            continue
        print(f"jarvis > {reply.text}")


if __name__ == "__main__":
    sys.exit(main())
