"""Voice settings, read from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _floats(name: str, default: float) -> float:
    return float(os.environ.get(name, default))


@dataclass
class VoiceConfig:
    # Wake word. Whisper sometimes hears "Jarvis" as one of the aliases.
    wake_word: str = "jarvis"
    wake_aliases: list[str] = field(
        default_factory=lambda: ["jarvis", "jarvis'", "jervis", "javis", "jarvas", "jarves"]
    )
    # After JARVIS answers, keep listening this many seconds for a follow-up
    # without needing the wake word again. 0 turns follow-ups off.
    follow_up_seconds: float = 6.0

    # Speech-to-text (faster-whisper). tiny.en / base.en / small.en / medium.en ...
    # Bigger is more accurate but slower. base.en is a good start on a laptop.
    whisper_model: str = "base.en"
    language: str = "en"
    # "auto" uses a GPU if one is available.
    whisper_device: str = "auto"

    # Microphone and speech detection.
    sample_rate: int = 16000
    # Seconds of silence that end a sentence.
    silence_seconds: float = 0.8
    # Longest single utterance, in seconds.
    max_utterance_seconds: float = 15.0
    # Minimum loudness counted as speech. 0 = calibrate from room noise at start.
    energy_threshold: float = 0.0
    # Microphone device index or name; None = system default.
    input_device: str | None = None

    # Text-to-speech (pyttsx3: SAPI5 on Windows, NSSpeech on macOS, espeak on Linux).
    # Part of a voice name to pick, e.g. "David", "Daniel", "Zira". Empty = default.
    voice: str = ""
    # Words per minute. 0 = the system default.
    rate: int = 185

    @classmethod
    def from_env(cls) -> "VoiceConfig":
        cfg = cls()
        wake = os.environ.get("JARVIS_WAKE_WORD")
        if wake:
            cfg.wake_word = wake.strip().lower()
            cfg.wake_aliases = [cfg.wake_word]
        cfg.follow_up_seconds = _floats("JARVIS_FOLLOW_UP_SECONDS", cfg.follow_up_seconds)
        cfg.whisper_model = os.environ.get("JARVIS_WHISPER_MODEL", cfg.whisper_model)
        cfg.language = os.environ.get("JARVIS_LANGUAGE", cfg.language)
        cfg.whisper_device = os.environ.get("JARVIS_WHISPER_DEVICE", cfg.whisper_device)
        cfg.silence_seconds = _floats("JARVIS_SILENCE_SECONDS", cfg.silence_seconds)
        cfg.energy_threshold = _floats("JARVIS_ENERGY_THRESHOLD", cfg.energy_threshold)
        cfg.input_device = os.environ.get("JARVIS_MIC") or None
        cfg.voice = os.environ.get("JARVIS_VOICE", cfg.voice)
        cfg.rate = int(os.environ.get("JARVIS_VOICE_RATE", cfg.rate))
        return cfg
