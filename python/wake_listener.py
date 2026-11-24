#!/usr/bin/env python3
"""
Silvia wake listener: say "Silvia" and the assistant switches itself on.

Runs in the background (started by the Silvia backend when ULTRON_WAKE=1),
listens to the microphone, transcribes speech on this computer with
faster-whisper (no internet, no API key), and when it hears the wake word it
tells the backend, which starts Silvia in every open window.

Optional install:  python3 -m pip install faster-whisper sounddevice numpy

"Silvia, open WhatsApp"   -> wakes Silvia and sends "open WhatsApp"
"Hey Silvia"              -> wakes Silvia, waits for you to speak
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.request

ALIASES = {"silvia", "sylvia", "silviya", "salvia", "selvia", "silva", "ultron", "ultran", "altron", "ultra-on", "ultraon", "ultrun", "aultron", "wakeup", "wake-up"}
SPLIT_ALIASES = [("sil", "via"), ("syl", "via"), ("ultra", "on"), ("all", "tron"), ("ul", "tron"), ("ult", "ron"), ("wake", "up")]
# "Silvia, wake up" only wakes it; the words "wake up" are not sent as a command.
WAKE_UP_ONLY = re.compile(r"^(?:please\s+)?wake[\s-]?up(?:\s+please)?[\s.!]*$", re.I)
LEAD_INS = {"hey", "hi", "ok", "okay", "yo", "hello", "oi", "suno", "sun"}
WORD = re.compile(r"[\w']+")


def match_wake(transcript: str) -> str | None:
    """Return the command after the wake word, "" if only woken, None if not said.

    Adapted from the original JARVIS wake-word matcher.
    """
    words = list(WORD.finditer(transcript))
    lowered = [w.group().lower().rstrip("'") for w in words]
    for i, word in enumerate(lowered):
        if word.endswith("'s"):
            word = word[:-2]
        span = None
        if word in ALIASES:
            span = (i, i)
        elif i + 1 < len(lowered) and (word, lowered[i + 1]) in SPLIT_ALIASES:
            span = (i, i + 1)
        if span is None:
            continue
        start = words[span[0]].start()
        if span[0] > 0 and lowered[span[0] - 1] in LEAD_INS:
            start = words[span[0] - 1].start()
        rest = _tidy(transcript[:start] + " " + transcript[words[span[1]].end():])
        return "" if WAKE_UP_ONLY.match(rest) else rest
    return None


def _tidy(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"^[\s,.;:!-]+", "", text)
    text = re.sub(r"\s*,\s*([?.!])", r"\1", text)
    text = re.sub(r"[\s,;:-]+$", "", text)
    return text if re.search(r"\w", text) else ""


def notify(command: str) -> None:
    url = os.environ.get("ULTRON_URL", "http://127.0.0.1:3000").rstrip("/") + "/api/wake"
    req = urllib.request.Request(
        url,
        data=json.dumps({"command": command, "source": "voice"}).encode(),
        headers={
            "Content-Type": "application/json",
            "X-Ultron-Token": os.environ.get("ULTRON_SESSION_TOKEN", ""),
        },
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=5).read()
    except Exception as exc:  # backend restarting; keep listening
        print(f"wake: could not reach Silvia ({exc})", file=sys.stderr)


def listen() -> None:
    try:
        import numpy as np
        import sounddevice as sd
        from faster_whisper import WhisperModel
    except ImportError:
        print("wake: optional packages missing. Install with: python3 -m pip install faster-whisper sounddevice numpy",
              file=sys.stderr)
        sys.exit(3)

    rate = 16000
    block = int(rate * 0.1)  # 100 ms
    model_name = os.environ.get("ULTRON_WAKE_MODEL", "base")
    print(f"wake: loading speech model '{model_name}' (first run downloads it once)", file=sys.stderr)
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    threshold = float(os.environ.get("ULTRON_WAKE_SENSITIVITY", "0.012"))
    print("wake: listening for \"Silvia\"", file=sys.stderr)

    speech: list = []
    silent_blocks = 0
    with sd.InputStream(samplerate=rate, channels=1, dtype="float32", blocksize=block) as stream:
        while True:
            chunk, _ = stream.read(block)
            chunk = chunk[:, 0]
            loud = float(np.sqrt(np.mean(chunk * chunk))) > threshold
            if loud:
                speech.append(chunk)
                silent_blocks = 0
            elif speech:
                speech.append(chunk)
                silent_blocks += 1
            # End of an utterance: 0.7 s of quiet, or 8 s total.
            if speech and (silent_blocks >= 7 or len(speech) >= 80):
                audio = np.concatenate(speech)
                speech, silent_blocks = [], 0
                if len(audio) < rate * 0.4:
                    continue
                segments, _info = model.transcribe(audio, beam_size=1, vad_filter=True,
                                                   initial_prompt="Silvia, wake up.")
                text = " ".join(s.text for s in segments).strip()
                command = match_wake(text) if text else None
                if command is not None:
                    print(f"wake: heard wake word; command={command!r}", file=sys.stderr)
                    notify(command)
                    time.sleep(0.3)


if __name__ == "__main__":
    listen()
