"""JARVIS's voice: ears (speech-to-text), mouth (text-to-speech), and the
loop that ties them to the brain.

Voice is optional. Install it with ``pip install -e ".[voice]"`` and run
``python -m jarvis --voice``. The modules here only import the audio
libraries when they are actually used, so text chat keeps working without them.
"""

from .config import VoiceConfig
from .session import VoiceSession
from .text import for_speech
from .wake import WakeWord

__all__ = ["VoiceConfig", "VoiceSession", "WakeWord", "for_speech"]
