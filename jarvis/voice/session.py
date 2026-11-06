"""The voice loop: wait for "Jarvis", hear the request, think, speak.

::

    idle ──"Jarvis, <request>"──► think ──► speak ──► follow-up window
     ▲            │                                        │
     │       "Jarvis" alone ──► "Yes?" ──► hear request ───┘
     └──────────── silence for follow_up_seconds ◄─────────┘

In push-to-talk mode there is no wake word: press Enter, then speak.
"""

from __future__ import annotations

import re
from typing import Callable, Protocol

from ..chat import ask
from .config import VoiceConfig
from .wake import WakeWord

VOICE_PROMPT = """

Your replies are read aloud by text-to-speech. Talk in plain spoken sentences: \
no markdown, bullet lists, tables, code blocks, URLs or emoji. Keep answers to a \
sentence or two unless the user asks for more."""

_GOODBYES = re.compile(
    r"^(?:goodbye|good bye|bye|stop listening|go to sleep|shut down|that's all|"
    r"that is all|exit|quit)\W*$",
    re.I,
)


_YES = re.compile(
    r"^(?:yes|yeah|yep|yup|sure|ok|okay|do it|go ahead|please do|confirm|affirmative|"
    r"correct|of course|absolutely)\b",
    re.I,
)
_NO = re.compile(r"\b(?:no|nope|not|don't|do not|cancel|stop|wait|never)\b", re.I)


class Ears(Protocol):
    def listen(self, timeout: float | None = None) -> str | None: ...
    def flush(self) -> None: ...


class Mouth(Protocol):
    def say(self, text: str) -> None: ...


class VoiceSession:
    def __init__(
        self,
        brain,
        ears: Ears,
        mouth: Mouth,
        config: VoiceConfig | None = None,
        push_to_talk: bool = False,
        show: Callable[[str], None] = print,
        wait_for_key: Callable[[], None] = lambda: input(),
    ):
        self.brain = brain
        self.ears = ears
        self.mouth = mouth
        self.config = config or VoiceConfig()
        self.push_to_talk = push_to_talk
        self.show = show
        self.wait_for_key = wait_for_key
        self.wake = WakeWord(self.config.wake_aliases)

    def speak(self, text: str) -> None:
        self.show(f"jarvis > {text}")
        self.mouth.say(text)
        self.ears.flush()  # don't let JARVIS hear itself

    def confirm(self, question: str) -> bool:
        """Ask a yes/no question out loud. Only a clear yes counts."""
        self.speak(f"{question} Say yes or no.")
        heard = self.ears.listen(timeout=8)
        if heard:
            self.show(f"you    > {heard}")
        answer = self.wake.strip(heard or "").strip()
        return bool(_YES.match(answer)) and not _NO.search(answer)

    def handle(self, request: str) -> bool:
        """Answer one request. Returns False when the user said goodbye."""
        if not request.strip():
            return True
        self.show(f"you    > {request}")
        if _GOODBYES.match(request.strip()):
            self.speak("Goodbye.")
            return False
        self.speak(ask(self.brain, request))
        return True

    def run(self) -> None:
        if self.push_to_talk:
            self._run_push_to_talk()
        else:
            self._run_wake_word()

    def _run_push_to_talk(self) -> None:
        self.show("Press Enter, then speak. Say 'goodbye' or press Ctrl+C to stop.")
        while True:
            self.wait_for_key()
            self.ears.flush()
            self.show("(listening...)")
            heard = self.ears.listen(timeout=8)
            if heard and not self.handle(self.wake.strip(heard)):
                return

    def _run_wake_word(self) -> None:
        name = self.config.wake_word.title()
        self.show(f"Say '{name}' followed by your request. Say 'goodbye' or press Ctrl+C to stop.")
        while True:
            heard = self.ears.listen()
            if heard is None:
                continue
            request = self.wake.match(heard)
            if request is None:
                continue  # talk that wasn't meant for JARVIS
            if not request:
                self.speak("Yes?")
                request = self.ears.listen(timeout=8)
                if not request:
                    continue
                request = self.wake.strip(request)
            if not self.handle(request):
                return
            # Conversation mode: follow-ups don't need the wake word.
            while self.config.follow_up_seconds > 0:
                heard = self.ears.listen(timeout=self.config.follow_up_seconds)
                if not heard:
                    break
                if not self.handle(self.wake.strip(heard)):
                    return
