"""JARVIS's HUD: a local, Iron-Man-style web interface.

Run it with ``python -m jarvis --hud``. It serves a page on
http://127.0.0.1:8765 showing the conversation, what JARVIS is doing
(listening, thinking, speaking), and every tool it runs. Type or press the mic.

Only the standard library is used for the server, so the HUD works without
extra packages. The mic and spoken replies need the voice extras
(``pip install -e ".[voice]"``) and run on this computer, exactly like
``--voice`` mode.
"""

from .app import EventBus, HudApp, history_of
from .server import HudServer, serve

__all__ = ["EventBus", "HudApp", "HudServer", "history_of", "serve"]
