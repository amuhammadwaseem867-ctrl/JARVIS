"""Hook the existing voice code (``jarvis.voice``) up to the HUD.

The HUD answers requests on worker threads, but text-to-speech engines
(SAPI5 on Windows especially) want to be created and used on one thread.
``SpeechThread`` gives the ``Mouth`` a thread of its own.
"""

from __future__ import annotations

import importlib.util
import queue
import threading
from typing import Any, Callable

VOICE_INSTALL = 'pip install -e ".[voice]"'


class SpeechThread:
    """Runs a ``Mouth`` on a dedicated thread; ``say`` blocks until spoken."""

    def __init__(self, make_mouth: Callable[[], Any]):
        self._jobs: queue.Queue = queue.Queue()
        ready = threading.Event()
        self._error: Exception | None = None

        def run() -> None:
            try:
                try:  # Windows: SAPI5 needs COM set up on this thread.
                    import pythoncom  # type: ignore

                    pythoncom.CoInitialize()
                except ImportError:
                    pass
                mouth = make_mouth()
            except Exception as exc:
                self._error = exc
                ready.set()
                return
            ready.set()
            while True:
                text, done = self._jobs.get()
                if text is None:
                    return
                try:
                    mouth.say(text)
                finally:
                    done.set()

        threading.Thread(target=run, name="jarvis-hud-speech", daemon=True).start()
        ready.wait()
        if self._error:
            raise self._error

    def say(self, text: str) -> None:
        done = threading.Event()
        self._jobs.put((text, done))
        done.wait()

    def close(self) -> None:
        self._jobs.put((None, None))


def load_voice() -> dict[str, Any]:
    """Whatever voice support this computer has, as HudApp keyword arguments."""
    from ..voice.config import VoiceConfig
    from ..voice.wake import WakeWord

    config = VoiceConfig.from_env()
    problems = []

    mouth = None
    if importlib.util.find_spec("pyttsx3") is None:
        problems.append("spoken replies are off (pyttsx3 not installed)")
    else:
        try:
            from ..voice.mouth import Mouth

            mouth = SpeechThread(lambda: Mouth(config))
        except Exception as exc:  # e.g. no speech engine (espeak) on Linux
            problems.append(f"spoken replies are off ({exc})")

    transcriber_factory = None
    if all(importlib.util.find_spec(m) for m in ("faster_whisper", "numpy")):
        def transcriber_factory(status: Callable[[str], None]) -> Any:
            from ..voice.ears import Transcriber

            return Transcriber(config, on_status=status)

    ears_factory = None
    missing = [m for m in ("faster_whisper", "sounddevice", "numpy")
               if importlib.util.find_spec(m) is None]
    if missing:
        problems.append(f"the mic is off ({', '.join(missing)} not installed)")
    else:
        def ears_factory(status: Callable[[str], None]) -> Any:
            from ..voice.ears import Ears

            return Ears(config, on_status=status)

    error = None
    if problems:
        error = "Voice: " + "; ".join(problems) + f". Install with: {VOICE_INSTALL}"
    return {
        "mouth": mouth,
        "ears_factory": ears_factory,
        "wake": WakeWord(config.wake_aliases),
        "voice_error": error,
        "transcriber_factory": transcriber_factory,
    }
