"""Tests for voice mode. No microphone, speakers or audio packages needed."""

from __future__ import annotations

from types import SimpleNamespace as NS

import pytest

from jarvis.voice import VoiceConfig, VoiceSession, WakeWord, for_speech
from jarvis.voice.ears import Segmenter

wake = WakeWord(VoiceConfig().wake_aliases)


@pytest.mark.parametrize(
    "heard, command",
    [
        ("Jarvis, what time is it?", "what time is it?"),
        ("Hey Jarvis, what time is it?", "what time is it?"),
        ("OK, Jarvis. Set a reminder.", "Set a reminder."),
        ("What's 17% of 2,340, Jarvis?", "What's 17% of 2,340?"),
        ("Jervis turn on the lights", "turn on the lights"),
        ("Jarvis.", ""),
        ("Hey Jarvis!", ""),
        ("What's for dinner?", None),
        ("I was talking to Jarvis's sister", "I was talking to sister"),
    ],
)
def test_wake_word(heard, command):
    assert wake.match(heard) == command


def test_wake_strip_keeps_plain_text():
    assert wake.strip("and tomorrow?") == "and tomorrow?"
    assert wake.strip("Jarvis, and tomorrow?") == "and tomorrow?"


def test_custom_wake_word(monkeypatch):
    monkeypatch.setenv("JARVIS_WAKE_WORD", "Friday")
    cfg = VoiceConfig.from_env()
    assert WakeWord(cfg.wake_aliases).match("Friday, lights off") == "lights off"
    assert WakeWord(cfg.wake_aliases).match("Jarvis, lights off") is None


def test_for_speech_strips_markdown():
    md = (
        "## Plan\n"
        "Here is **the** plan:\n"
        "- Buy `milk`\n"
        "1. See [the docs](https://example.com) 😀\n"
        "```python\nprint('hi')\n```"
    )
    assert for_speech(md) == (
        "Plan. Here is the plan: Buy milk. See the docs. (I've put the code on screen.)"
    )


def test_for_speech_url():
    assert for_speech("Go to https://x.org/a now") == "Go to the link on screen now."


def test_segmenter_cuts_on_silence():
    seg = Segmenter(threshold=0.1, silence_frames=3, max_frames=100, min_speech_frames=2,
                    preroll_frames=2)
    levels = [0, 0, 0, 0.5, 0.6, 0.5, 0, 0, 0]
    out = [seg.feed(f"f{i}".encode(), lvl) for i, lvl in enumerate(levels)]
    assert out[:-1] == [None] * 8
    # 2 frames of pre-roll + 3 speech + 3 silence
    assert out[-1] == [b"f1", b"f2", b"f3", b"f4", b"f5", b"f6", b"f7", b"f8"]


def test_segmenter_ignores_clicks():
    seg = Segmenter(threshold=0.1, silence_frames=2, max_frames=100, min_speech_frames=3)
    out = [seg.feed(b"x", lvl) for lvl in [0.9, 0, 0]]
    assert out == [None, None, None]
    assert not seg.in_speech


def test_segmenter_max_length():
    seg = Segmenter(threshold=0.1, silence_frames=50, max_frames=5, min_speech_frames=1)
    out = [seg.feed(b"x", 0.9) for _ in range(5)]
    assert out[-1] == [b"x"] * 5


class FakeEars:
    def __init__(self, *heard):
        self.heard = list(heard)
        self.timeouts = []

    def listen(self, timeout=None):
        self.timeouts.append(timeout)
        if not self.heard:
            raise KeyboardInterrupt  # end of script
        return self.heard.pop(0)

    def flush(self):
        pass


class FakeMouth:
    def __init__(self):
        self.said = []

    def say(self, text):
        self.said.append(text)


class FakeBrain:
    def __init__(self):
        self.asked = []

    def think(self, text):
        self.asked.append(text)
        return NS(text=f"answer to {text}")


def run(*heard, push_to_talk=False, follow_up=6.0):
    brain, ears, mouth = FakeBrain(), FakeEars(*heard), FakeMouth()
    cfg = VoiceConfig(follow_up_seconds=follow_up)
    session = VoiceSession(brain, ears, mouth, cfg, push_to_talk=push_to_talk,
                           show=lambda s: None, wait_for_key=lambda: None)
    try:
        session.run()
    except KeyboardInterrupt:
        pass
    return brain, ears, mouth


def test_ignores_speech_without_wake_word():
    brain, _, mouth = run("nice weather today", "Jarvis what time is it")
    assert brain.asked == ["what time is it"]
    assert mouth.said == ["answer to what time is it"]


def test_wake_word_alone_then_request():
    brain, ears, mouth = run("Jarvis", "what's the date")
    assert mouth.said[0] == "Yes?"
    assert ears.timeouts[1] == 8
    assert brain.asked == ["what's the date"]


def test_follow_up_without_wake_word_then_back_to_idle():
    brain, ears, _ = run("Jarvis, weather in Lahore", "and tomorrow?", None, "and Sunday?")
    # "and Sunday?" comes after the follow-up window closed, so it's ignored.
    assert brain.asked == ["weather in Lahore", "and tomorrow?"]
    assert ears.timeouts[1:3] == [6.0, 6.0]


def test_follow_ups_off():
    brain, _, _ = run("Jarvis, hi", "and tomorrow?", follow_up=0)
    assert brain.asked == ["hi"]


def test_goodbye_ends_session():
    brain, _, mouth = run("Jarvis, goodbye", "Jarvis, still there?")
    assert brain.asked == []
    assert mouth.said == ["Goodbye."]


def test_push_to_talk_needs_no_wake_word():
    brain, _, _ = run("what time is it", None, "Jarvis, thanks", push_to_talk=True)
    assert brain.asked == ["what time is it", "thanks"]


def test_text_mode_cli_still_works(monkeypatch, capsys):
    """`python -m jarvis` without flags is the same text chat as before."""
    import jarvis.__main__ as cli

    brain = FakeBrain()
    brain.config = NS(model="fake-model")
    monkeypatch.setattr(cli, "Brain", lambda **kw: brain)
    inputs = iter(["hello", "/quit"])
    monkeypatch.setattr("builtins.input", lambda prompt="": next(inputs))
    assert cli.main([]) == 0
    assert "jarvis > answer to hello" in capsys.readouterr().out


def test_voice_mode_without_packages(monkeypatch, capsys):
    import builtins

    import jarvis.__main__ as cli

    real_import = builtins.__import__

    def no_pyttsx3(name, *a, **kw):
        if name == "pyttsx3":
            raise ImportError("no", name="pyttsx3")
        return real_import(name, *a, **kw)

    monkeypatch.setattr(builtins, "__import__", no_pyttsx3)
    monkeypatch.setattr(cli, "Brain", lambda **kw: NS(config=NS(system_prompt="")))
    assert cli.main(["--voice"]) == 1
    assert 'pip install -e ".[voice]"' in capsys.readouterr().err
