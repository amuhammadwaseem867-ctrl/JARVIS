"""Talk to JARVIS: ``python -m jarvis`` (text) or ``python -m jarvis --voice``."""

from __future__ import annotations

import argparse
import sys

from .brain import Brain, ToolCall
from .chat import FatalError, ask

HELP = "Commands: /reset (new conversation), /facts (show memory), /quit"


def show_tool(call: ToolCall) -> None:
    mark = "!" if call.is_error else "·"
    print(f"  {mark} {call.name}({call.input}) -> {call.result[:120]}")


def confirm_typed(question: str) -> bool:
    """Ask a yes/no question in the terminal before a risky action."""
    try:
        answer = input(f"  ? {question} [y/N] ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        print()
        return False
    return answer in ("y", "yes")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="jarvis", description="Talk to JARVIS.")
    mode = p.add_mutually_exclusive_group()
    mode.add_argument(
        "--voice", action="store_true", help="voice mode: say 'Jarvis' and talk, it talks back"
    )
    mode.add_argument(
        "--speak", action="store_true", help="type as usual, but JARVIS reads its replies aloud"
    )
    p.add_argument(
        "--push-to-talk",
        action="store_true",
        help="with --voice: press Enter before speaking instead of using the wake word",
    )
    p.add_argument("--list-voices", action="store_true", help="list text-to-speech voices and exit")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.list_voices:
            from .voice.config import VoiceConfig
            from .voice.mouth import Mouth

            print("\n".join(Mouth(VoiceConfig.from_env()).voices()))
            return 0
        if args.voice:
            return run_voice(push_to_talk=args.push_to_talk)
        return run_text(speak=args.speak)
    except FatalError as exc:
        print(exc, file=sys.stderr)
        return 1
    except RuntimeError as exc:  # missing voice packages, no microphone, ...
        print(exc, file=sys.stderr)
        return 1


def _voice_brain() -> Brain:
    from .voice.session import VOICE_PROMPT

    brain = Brain(on_tool_call=show_tool, confirm=confirm_typed)
    brain.config.system_prompt += VOICE_PROMPT
    return brain


def run_text(speak: bool = False) -> int:
    mouth = None
    if speak:
        from .voice.config import VoiceConfig
        from .voice.mouth import Mouth

        mouth = Mouth(VoiceConfig.from_env())
        brain = _voice_brain()
    else:
        brain = Brain(on_tool_call=show_tool, confirm=confirm_typed)
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

        answer = ask(brain, text)
        print(f"jarvis > {answer}")
        if mouth:
            mouth.say(answer)


def run_voice(push_to_talk: bool = False) -> int:
    from .voice.config import VoiceConfig
    from .voice.ears import Ears
    from .voice.mouth import Mouth
    from .voice.session import VoiceSession

    config = VoiceConfig.from_env()
    brain = _voice_brain()
    mouth = Mouth(config)
    ears = Ears(config, on_status=print)
    print(f"JARVIS online ({brain.config.model}), voice mode.")
    session = VoiceSession(brain, ears, mouth, config, push_to_talk=push_to_talk)
    brain.tools.confirm = session.confirm  # ask out loud before risky actions
    try:
        session.run()
    except (KeyboardInterrupt, EOFError):
        print()
    finally:
        ears.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
