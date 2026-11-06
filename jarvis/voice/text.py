"""Turn Claude's written answer into something that sounds right out loud."""

from __future__ import annotations

import re

_CODE_BLOCK = re.compile(r"```.*?```", re.S)
_INLINE_CODE = re.compile(r"`([^`]*)`")
_LINK = re.compile(r"\[([^\]]+)\]\([^)]+\)")
_URL = re.compile(r"https?://\S+")
_HEADING = re.compile(r"^\s{0,3}#{1,6}\s*", re.M)
_BULLET = re.compile(r"^\s*(?:[-*+•]|\d+[.)])\s+", re.M)
_EMPHASIS = re.compile(r"(\*\*|__|\*|_|~~)(?=\S)(.+?)(?<=\S)\1")
_TABLE_RULE = re.compile(r"^\s*\|?[\s:|-]+\|[\s:|-]*$", re.M)
_EMOJI = re.compile("[\U0001F300-\U0001FAFF☀-➿️]")


def for_speech(text: str) -> str:
    """Strip markdown, code, links and emoji so TTS reads only the words."""
    text = _CODE_BLOCK.sub(" (I've put the code on screen.) ", text)
    text = _INLINE_CODE.sub(r"\1", text)
    text = _LINK.sub(r"\1", text)
    text = _URL.sub("the link on screen", text)
    text = _TABLE_RULE.sub("", text)
    text = _HEADING.sub("", text)
    text = _BULLET.sub("", text)
    text = _EMPHASIS.sub(r"\2", text)
    text = _EMOJI.sub("", text)
    text = text.replace("|", ", ")
    # Line breaks become pauses; make sure each line ends like a sentence.
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    lines = [ln if ln[-1] in ".!?:;,)" else ln + "." for ln in lines]
    return re.sub(r"\s+", " ", " ".join(lines)).strip()
