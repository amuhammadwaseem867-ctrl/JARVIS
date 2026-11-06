"""Find the wake word in a transcript and pull out the command after it."""

from __future__ import annotations

import re

_LEAD_INS = {"hey", "hi", "ok", "okay", "yo", "hello", "oi"}
_WORD = re.compile(r"[\w']+")


class WakeWord:
    def __init__(self, aliases: list[str]):
        self.aliases = {a.lower() for a in aliases}

    def match(self, transcript: str) -> str | None:
        """Return the command if the wake word was said, else None.

        "Hey Jarvis, what time is it?" -> "what time is it?"
        "What's the weather, Jarvis?"   -> "What's the weather?"
        "Jarvis."                       -> ""  (woken up, no command yet)
        "What's the weather?"           -> None
        """
        words = list(_WORD.finditer(transcript))
        for i, m in enumerate(words):
            word = m.group().lower()
            if word.endswith("'s"):  # "Jarvis's" / "Jarvis' "
                word = word[:-2]
            if word.rstrip("'") in self.aliases:
                start = m.start()
                # Swallow a lead-in like "hey" / "ok" just before the wake word.
                if i > 0 and words[i - 1].group().lower() in _LEAD_INS:
                    start = words[i - 1].start()
                before = transcript[:start]
                after = transcript[m.end():]
                return _tidy(before + " " + after)
        return None

    def strip(self, transcript: str) -> str:
        """Remove the wake word if present, otherwise return the text as is."""
        command = self.match(transcript)
        return transcript.strip() if command is None else command


def _tidy(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    # Drop punctuation left dangling where the wake word was.
    text = re.sub(r"^[\s,.;:!-]+", "", text)
    text = re.sub(r"\s*,\s*([?.!])", r"\1", text)
    text = re.sub(r"[\s,;:-]+$", "", text)
    return text if re.search(r"\w", text) else ""
