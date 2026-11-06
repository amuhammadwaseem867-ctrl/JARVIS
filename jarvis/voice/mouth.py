"""Text-to-speech with pyttsx3: offline, uses the voices built into your OS."""

from __future__ import annotations

from .config import VoiceConfig
from .ears import missing_voice_deps
from .text import for_speech


class Mouth:
    def __init__(self, config: VoiceConfig):
        try:
            import pyttsx3
        except ImportError as exc:
            raise missing_voice_deps(exc) from exc

        self.engine = pyttsx3.init()
        if config.rate:
            self.engine.setProperty("rate", config.rate)
        if config.voice:
            wanted = config.voice.lower()
            for v in self.engine.getProperty("voices"):
                if wanted in (v.name or "").lower() or wanted in (v.id or "").lower():
                    self.engine.setProperty("voice", v.id)
                    break

    def voices(self) -> list[str]:
        return [v.name for v in self.engine.getProperty("voices")]

    def say(self, text: str) -> None:
        """Speak ``text`` and return when finished."""
        spoken = for_speech(text)
        if spoken:
            self.engine.say(spoken)
            self.engine.runAndWait()
