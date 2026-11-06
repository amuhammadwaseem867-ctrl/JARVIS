"""Talk to JARVIS: ``python -m jarvis`` (text), ``--voice``, or ``--hud`` (web HUD)."""

from __future__ import annotations

import argparse
import os
import sys

from .brain import Brain, ToolCall
from .chat import AGENT_COMMANDS_HELP, FatalError, agent_command, ask
from .providers import PROVIDERS

HELP = (
    "Commands: /reset (new conversation), /facts (show memory), "
    + AGENT_COMMANDS_HELP
    + ", /quit"
)


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
    mode.add_argument(
        "--hud", action="store_true", help="open the HUD: a local web interface in your browser"
    )
    p.add_argument(
        "--push-to-talk",
        action="store_true",
        help="with --voice: press Enter before speaking instead of using the wake word",
    )
    p.add_argument("--port", type=int, default=8765, help="with --hud: port to serve on")
    p.add_argument(
        "--no-browser", action="store_true", help="with --hud: don't open a browser tab"
    )
    p.add_argument(
        "--phone",
        action="store_true",
        help="HUD + use your phone (same Wi-Fi) as JARVIS's microphone and speaker",
    )
    p.add_argument(
        "--phone-port", type=int, default=8766, help="with --phone: port the phone connects to"
    )
    p.add_argument(
        "--forget-phones", action="store_true", help="unpair every phone paired with --phone, then exit"
    )
    p.add_argument(
        "--provider",
        choices=PROVIDERS,
        help="which AI to use (default: JARVIS_PROVIDER, else the first API key found: "
        "GROQ_API_KEY, GEMINI_API_KEY, ANTHROPIC_API_KEY)",
    )
    p.add_argument("--model", help="model name for the chosen provider (default: its usual one)")
    p.add_argument("--list-voices", action="store_true", help="list text-to-speech voices and exit")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.provider:
        os.environ["JARVIS_PROVIDER"] = args.provider
    if args.model:
        os.environ["JARVIS_MODEL"] = args.model
    try:
        if args.list_voices:
            from .voice.config import VoiceConfig
            from .voice.mouth import Mouth

            print("\n".join(Mouth(VoiceConfig.from_env()).voices()))
            return 0
        if args.forget_phones:
            return forget_phones()
        if args.phone:
            return run_hud(
                port=args.port, open_browser=not args.no_browser, phone_port=args.phone_port
            )
        if args.voice:
            return run_voice(push_to_talk=args.push_to_talk)
        if args.hud:
            return run_hud(port=args.port, open_browser=not args.no_browser)
        return run_text(speak=args.speak)
    except FatalError as exc:
        print(exc, file=sys.stderr)
        return 1
    except RuntimeError as exc:  # missing voice packages, no microphone, ...
        print(exc, file=sys.stderr)
        return 1


def _label(brain: Brain) -> str:
    provider = getattr(brain.config, "provider", "")
    return f"{provider}: {brain.config.model}" if provider else brain.config.model


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
    print(f"JARVIS online ({_label(brain)}). {HELP}")

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
        if text.startswith("/"):
            shown = agent_command(brain, text)
            if shown is not None:
                print(shown)
                if mouth and text.lower().startswith("/agent "):
                    mouth.say(shown)
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
    print(f"JARVIS online ({_label(brain)}), voice mode.")
    session = VoiceSession(brain, ears, mouth, config, push_to_talk=push_to_talk)
    brain.tools.confirm = session.confirm  # ask out loud before risky actions
    try:
        session.run()
    except (KeyboardInterrupt, EOFError):
        print()
    finally:
        ears.close()
    return 0


def run_hud(port: int = 8765, open_browser: bool = True, phone_port: int | None = None) -> int:
    from .hud import HudApp, serve
    from .hud.voice import VOICE_INSTALL, load_voice

    voice = load_voice()
    if phone_port is not None:
        if voice["transcriber_factory"] is None:
            print(
                "The phone's mic needs speech recognition on this computer. "
                f"Install it with:  {VOICE_INSTALL}  (typing from the phone works without it)"
            )
        # A computer without a mic is expected here; only mention real problems.
        voice["voice_error"] = None if voice["transcriber_factory"] else voice["voice_error"]
    elif voice["voice_error"]:
        print(voice["voice_error"])
    brain = Brain()
    app = HudApp(brain, **voice)
    return serve(
        app,
        port=port,
        open_browser=open_browser,
        phone_port=phone_port,
        data_dir=brain.config.data_dir,
    )


def forget_phones() -> int:
    from .config import BrainConfig
    from .hud.phone import Pairing

    n = Pairing(BrainConfig.from_env().data_dir / "phone").forget_all()
    print(f"Unpaired {n} phone{'s' if n != 1 else ''}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
