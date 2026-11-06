# JARVIS

A personal AI assistant powered by Claude.

This repo currently holds JARVIS's **brain**: the reasoning layer that every
other part (voice, UI, smart-home hooks) talks to. You give it text, it thinks
with Claude, runs any tools it needs, remembers things, and gives text back.

## Quick start

```bash
pip install -e ".[dev]"
export ANTHROPIC_API_KEY=sk-ant-...   # from https://platform.claude.com
python -m jarvis                       # or just: jarvis
```

```
you > what's 17% of 2,340?
  · calculate({'expression': '0.17*2340'}) -> 397.8
jarvis > That's 397.80.

you > remember that my gym is on Tuesdays and Fridays
  · remember({'key': 'gym days', 'value': 'Tuesdays and Fridays'}) -> Saved 'gym days'.
jarvis > Noted, I'll remember your gym days.
```

Terminal commands: `/reset` starts a new conversation, `/facts` shows long-term
memory, `/quit` exits.

## Voice mode

Voice is optional. Text chat works without any of this.

```bash
pip install -e ".[voice]"
python -m jarvis --voice            # say "Jarvis, ..." and it answers out loud
```

```
Loading speech model 'base.en'...
Calibrating microphone, stay quiet for a second...
JARVIS online (claude-opus-5-5), voice mode.
Say 'Jarvis' followed by your request. Say 'goodbye' or press Ctrl+C to stop.
you    > what time is it in Karachi?
  · get_current_time({'timezone': 'Asia/Karachi'}) -> Friday 06 November 2026, 20:14:05 PKT (UTC+0500)
jarvis > It's 8:14 in the evening in Karachi.
you    > and in London?                    <- follow-up, no wake word needed
jarvis > It's 3:14 in the afternoon in London.
```

How it talks to you:

- **Wake word.** Say "Jarvis" with your request ("Hey Jarvis, what's 15% of
  80?" or "What's the date, Jarvis?"). Say just "Jarvis" and it answers
  "Yes?" and waits for the request. Anything said without the wake word is ignored.
- **Follow-ups.** After it answers, you have 6 seconds to ask a follow-up
  without saying "Jarvis" again. Then it goes back to waiting for the wake word.
- **Stop.** Say "goodbye" (or "stop listening"), or press Ctrl+C.

Other modes:

| Command | What it does |
|---|---|
| `python -m jarvis --voice --push-to-talk` | No wake word: press Enter, then speak. Good in a noisy room |
| `python -m jarvis --speak` | Type as usual; JARVIS reads its replies aloud. No microphone needed |
| `python -m jarvis --list-voices` | Lists the voices you can pick with `JARVIS_VOICE` |

Under the hood, everything runs on your computer except Claude itself:

- **Ears:** [faster-whisper](https://github.com/SYSTRAN/faster-whisper) turns
  speech into text offline. The first run downloads the model (about 150 MB for
  `base.en`). Loudness detection decides when you've finished a sentence.
- **Mouth:** [pyttsx3](https://github.com/nateshmbhat/pyttsx3) speaks with the
  voices built into your OS (Windows SAPI5, macOS, or espeak on Linux). Markdown,
  code and links are cleaned out before speaking, and in voice mode Claude is
  told its answers will be spoken, so it keeps them short and plain.

On Linux, install the audio system packages first:
`sudo apt install libportaudio2 espeak-ng`.

### Voice settings

| Variable | Default | Meaning |
|---|---|---|
| `JARVIS_WAKE_WORD` | `jarvis` | The word that wakes it up |
| `JARVIS_FOLLOW_UP_SECONDS` | `6` | How long it waits for a follow-up without the wake word. `0` turns this off |
| `JARVIS_WHISPER_MODEL` | `base.en` | `tiny.en` is faster, `small.en` or `medium.en` hear better |
| `JARVIS_WHISPER_DEVICE` | `auto` | `cpu`, `cuda`, or `auto` |
| `JARVIS_LANGUAGE` | `en` | Language you speak (use a non-`.en` model for other languages) |
| `JARVIS_VOICE` | | Part of a voice name, e.g. `David`, `Daniel`, `Zira` (see `--list-voices`) |
| `JARVIS_VOICE_RATE` | `185` | Speaking speed in words per minute |
| `JARVIS_MIC` | system default | Microphone index or name |
| `JARVIS_SILENCE_SECONDS` | `0.8` | How long a pause ends your sentence |
| `JARVIS_ENERGY_THRESHOLD` | auto | How loud counts as speech (0 to 1). Raise it if background noise wakes it |

## Using the brain from code

```python
from jarvis import Brain

brain = Brain()
reply = brain.think("What time is it in Karachi?")
print(reply.text)          # the answer
print(reply.tool_calls)    # which tools ran, with inputs and results
```

### Adding a new skill

Any function can become a tool Claude can call:

```python
@brain.tools.tool(
    description="Turn a smart light on or off.",
    parameters={
        "room": {"type": "string", "description": "Which room"},
        "on": {"type": "boolean"},
    },
)
def set_light(room: str, on: bool) -> str:
    # talk to your smart-home API here
    return f"Light in {room} is now {'on' if on else 'off'}."
```

Return a string or any JSON-able value. Raise an exception to report a
failure; Claude sees the error and can explain it or try something else.

## How it works

```
 user text ──► Brain.think()
                 │
                 ├─► Claude (claude-opus-5-5) ◄── system prompt + tools + history
                 │        │
                 │   wants a tool? ──yes──► ToolRegistry.run() ──► result back to Claude
                 │        │                                         (loops until done)
                 │        no
                 ▼
              Reply(text, tool_calls)
```

| File | What it does |
|---|---|
| `jarvis/brain.py` | The agent loop: calls Claude, runs tools, handles refusals and errors |
| `jarvis/memory.py` | Short-term memory (conversation history) and long-term memory (facts) |
| `jarvis/tools.py` | Tool registry plus built-ins: time, calculator, remember / recall / forget |
| `jarvis/config.py` | Settings and JARVIS's personality (system prompt) |
| `jarvis/chat.py` | Asks the brain and turns API errors into something JARVIS can say |
| `jarvis/voice/` | Voice mode: `ears.py` (mic + Whisper), `mouth.py` (TTS), `wake.py` (wake word), `session.py` (the listen, think, speak loop) |
| `jarvis/__main__.py` | Command line: text chat, `--voice`, `--speak` |

Memory lives in `~/.jarvis/` (`conversation.json` and `facts.json`), so JARVIS
picks up where it left off after a restart.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | (required) | Your Claude API key |
| `JARVIS_MODEL` | `claude-opus-5-5` | Claude model to use |
| `JARVIS_EFFORT` | `medium` | How hard Claude thinks: `low`, `medium`, `high`, `xhigh`, `max` |
| `JARVIS_MAX_TOKENS` | `16000` | Max length of one response |
| `JARVIS_MAX_TOOL_ROUNDS` | `20` | Safety cap on tool calls per message |
| `JARVIS_FALLBACKS` | `1` | If Claude declines a request, retry on Anthropic's recommended fallback model. Set `0` to turn off |
| `JARVIS_SYSTEM_PROMPT_FILE` | | Path to a file that replaces the default personality |
| `JARVIS_DATA_DIR` | `~/.jarvis` | Where memory is saved |

## Tests

```bash
pytest
```

The tests use a fake Claude client and fake ears and mouth, so they run without
an API key, a microphone or the voice packages.
