"""Speech-to-text: listen on the microphone and transcribe with Whisper.

Uses ``sounddevice`` for the microphone and ``faster-whisper`` for
transcription, which runs fully offline once the model is downloaded
(the first run fetches it, about 150 MB for base.en).
"""

from __future__ import annotations

import logging
import math
import queue
import time
from collections import deque
from dataclasses import dataclass, field

from .config import VoiceConfig

log = logging.getLogger("jarvis.voice")

FRAME_SECONDS = 0.03  # 30 ms audio frames


def missing_voice_deps(error: ImportError) -> RuntimeError:
    return RuntimeError(
        f"Voice mode needs extra packages ({error.name} is missing). "
        'Install them with:  pip install -e ".[voice]"'
    )


@dataclass
class Segmenter:
    """Cuts a stream of audio frames into utterances using loudness.

    Feed it one frame at a time with its loudness (RMS, 0..1). It returns the
    frames of a whole utterance once the speaker has been quiet for
    ``silence_frames`` frames, and None otherwise. This is pure Python so it
    can be tested without a microphone.
    """

    threshold: float
    silence_frames: int
    max_frames: int
    min_speech_frames: int = 6  # ignore clicks shorter than ~180 ms
    preroll_frames: int = 10  # keep ~300 ms before speech starts
    _pre: deque = field(default_factory=deque, init=False)
    _frames: list = field(default_factory=list, init=False)
    _speech: int = field(default=0, init=False)
    _quiet: int = field(default=0, init=False)

    def __post_init__(self) -> None:
        self._pre = deque(maxlen=self.preroll_frames)

    @property
    def in_speech(self) -> bool:
        return bool(self._frames)

    def reset(self) -> None:
        self._pre.clear()
        self._frames, self._speech, self._quiet = [], 0, 0

    def feed(self, frame: bytes, level: float) -> list | None:
        loud = level >= self.threshold
        if not self._frames:
            if not loud:
                self._pre.append(frame)
                return None
            self._frames = list(self._pre)
            self._pre.clear()

        self._frames.append(frame)
        if loud:
            self._speech += 1
            self._quiet = 0
        else:
            self._quiet += 1

        if self._quiet >= self.silence_frames or len(self._frames) >= self.max_frames:
            frames, speech = self._frames, self._speech
            self.reset()
            if speech >= self.min_speech_frames:
                return frames
        return None


class Ears:
    """Microphone + Whisper. ``listen()`` returns what was said, as text."""

    def __init__(self, config: VoiceConfig, on_status=None):
        try:
            import numpy as np
            import sounddevice as sd
            from faster_whisper import WhisperModel
        except ImportError as exc:
            raise missing_voice_deps(exc) from exc

        self.np, self.sd = np, sd
        self.config = config
        self.on_status = on_status or (lambda msg: None)
        self.frame_len = int(config.sample_rate * FRAME_SECONDS)
        self._queue: queue.Queue[bytes] = queue.Queue()

        self.on_status(f"Loading speech model '{config.whisper_model}'...")
        compute = "int8" if config.whisper_device in ("auto", "cpu") else "default"
        self.model = WhisperModel(
            config.whisper_model, device=config.whisper_device, compute_type=compute
        )

        device = config.input_device
        if device is not None and device.isdigit():
            device = int(device)
        self.stream = sd.RawInputStream(
            samplerate=config.sample_rate,
            channels=1,
            dtype="int16",
            blocksize=self.frame_len,
            device=device,
            callback=self._on_audio,
        )
        self.stream.start()

        threshold = config.energy_threshold or self._calibrate()
        self.segmenter = Segmenter(
            threshold=threshold,
            silence_frames=max(1, round(config.silence_seconds / FRAME_SECONDS)),
            max_frames=round(config.max_utterance_seconds / FRAME_SECONDS),
        )

    def _on_audio(self, data, frames, time_info, status) -> None:
        self._queue.put(bytes(data))

    def _level(self, frame: bytes) -> float:
        samples = self.np.frombuffer(frame, dtype=self.np.int16).astype(self.np.float32)
        if samples.size == 0:
            return 0.0
        return float(math.sqrt(float(self.np.mean(samples * samples)))) / 32768.0

    def _calibrate(self, seconds: float = 1.0) -> float:
        """Measure room noise and set the speech threshold a bit above it."""
        self.on_status("Calibrating microphone, stay quiet for a second...")
        levels = []
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            try:
                levels.append(self._level(self._queue.get(timeout=0.5)))
            except queue.Empty:
                break
        noise = sorted(levels)[len(levels) // 2] if levels else 0.0
        threshold = max(0.01, noise * 3.0)
        log.info("noise level %.4f -> speech threshold %.4f", noise, threshold)
        return threshold

    def flush(self) -> None:
        """Drop audio heard so far (e.g. JARVIS's own voice while it spoke)."""
        while True:
            try:
                self._queue.get_nowait()
            except queue.Empty:
                break
        self.segmenter.reset()

    def listen(self, timeout: float | None = None) -> str | None:
        """Wait for one utterance and return its text.

        ``timeout`` is how long to wait for speech to *start*; returns None if
        nobody spoke in that time. None waits forever.
        """
        self.flush()
        deadline = None if timeout is None else time.monotonic() + timeout
        while True:
            if deadline and not self.segmenter.in_speech and time.monotonic() > deadline:
                return None
            try:
                frame = self._queue.get(timeout=0.2)
            except queue.Empty:
                continue
            frames = self.segmenter.feed(frame, self._level(frame))
            if frames is None:
                continue
            text = self.transcribe(b"".join(frames))
            if text:
                return text

    def transcribe(self, pcm: bytes) -> str:
        audio = self.np.frombuffer(pcm, dtype=self.np.int16).astype(self.np.float32) / 32768.0
        segments, _ = self.model.transcribe(
            audio,
            language=self.config.language or None,
            beam_size=1,
            # Nudges Whisper to spell the wake word the way we expect.
            initial_prompt=f"{self.config.wake_word.title()}, ",
            condition_on_previous_text=False,
        )
        text = " ".join(s.text.strip() for s in segments).strip()
        # Whisper's usual hallucinations on silence or noise.
        if text.lower().strip(" .!") in {"", "you", "thank you", "thanks for watching", "bye"}:
            return ""
        return text

    def close(self) -> None:
        self.stream.stop()
        self.stream.close()
