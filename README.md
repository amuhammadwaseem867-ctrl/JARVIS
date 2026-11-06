# JARVIS

A personal AI assistant powered by Claude, or by a free model (Groq, Gemini or
Ollama) if you don't have Claude API credit.

This repo holds JARVIS's **brain**: the reasoning layer that every
other part (voice, UI, smart-home hooks) talks to. You give it text, it thinks
with Claude, runs any tools it needs, remembers things, and gives text back.

## Quick start

```bash
pip install -e ".[dev]"
export ANTHROPIC_API_KEY=sk-ant-...   # from https://platform.claude.com
python -m jarvis                       # or just: jarvis
```

No Claude credit? Use a free model instead, see [Free models](#free-models).

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

## HUD (visual interface)

```bash
python -m jarvis --hud              # opens http://127.0.0.1:8765 in your browser
```

An Iron-Man-style screen for JARVIS that runs on your own computer:

- **Comms** on the left: the conversation, with formatting, picking up where
  you left off (it reads the same `~/.jarvis` memory as the terminal).
- **The robot** in the middle is a 3D humanoid that acts out what JARVIS is
  doing: it breathes and follows your mouse when standing by, leans in and
  turns amber when listening, puts a hand to its chin with its halo spinning
  while thinking, and moves its mouth lights and hands while speaking. It
  powers down when JARVIS is offline. If your browser can't do 3D (no
  WebGL), you get the animated arc-reactor core instead.
- **Systems** on the right: every tool JARVIS runs, live, with its input and
  result (web searches, weather, apps, files...). Click a long result to expand it.
- **Type** in the bar at the bottom, or press the **mic** (or Ctrl+Space) and
  speak. Saying "Jarvis" first is optional here.
- **Speak replies** reads answers out loud.
- Risky actions (overwriting or deleting a file, opening an untrusted app)
  pop up an **Authorization required** card. Nothing happens unless you press
  Yes; no answer in two minutes counts as no.

The mic and spoken replies use the same local Whisper and text-to-speech as
voice mode, so they need `pip install -e ".[voice]"`. Without it the HUD still
works for typing, and tells you what's missing. The HUD itself needs no extra
packages, and works offline: the robot is drawn in code with
[three.js](https://threejs.org) (MIT licence), which ships inside JARVIS
(`jarvis/hud/static/three.module.min.js`), so nothing is downloaded.

| Option | What it does |
|---|---|
| `--port 9000` | Serve on another port |
| `--no-browser` | Don't open a browser tab (go to the printed address yourself) |

**Privacy.** The server only listens on 127.0.0.1, so nothing else on your
network can reach it. Every request needs a secret token that is created each
time you start the HUD, and requests that don't come from this computer's own
address are refused, so other websites open in your browser can't send JARVIS
commands. Terminal and voice mode are unchanged.

## Use your phone as the microphone

No mic on your computer? Your phone can be JARVIS's microphone (and speaker)
over your home Wi-Fi. JARVIS still runs on the computer; the phone is just a
remote with a mic.

**One-time setup** (on the computer):

```bash
pip install -e ".[voice,phone]"
```

**Every time:**

1. On the computer run `python -m jarvis --phone`. The HUD opens, and the
   terminal prints a QR code, an address like `https://192.168.1.20:8766/`
   and a 6-digit code. (The HUD's **Connect phone** button shows them too.)
2. Put the phone on the **same Wi-Fi** and scan the QR code with its camera.
   Or open the address in the phone's browser and type the code.
3. The phone warns *"Your connection is not private"*. That's expected: the
   certificate was made on your computer, not bought from a company. Tap
   **Advanced > Proceed** (Chrome) or **Show Details > visit this website**
   (Safari). You only do this once per computer.
4. Tap the **mic**, allow microphone access, and talk. It stops by itself when
   you pause, or tap the mic again. JARVIS answers on the screen and out loud
   on the phone.

The phone stays paired for 30 days, so next time just open the same address
(bookmark it or "Add to Home screen").

Good to know:

- **Windows asks to allow Python on the network** the first time. Tick
  **Private networks** and allow it, or the phone can't connect.
- The phone records; the computer turns the speech into text with Whisper
  (`[voice]` extras), so nothing is sent anywhere except your question to
  Claude, as usual.
- **Speak on this phone** reads replies on the phone. **Speak on computer**
  reads them on the computer's speakers instead (or as well).
- Typing on the phone works too, and risky actions ask on the phone.
- If the phone can't open the page, check both are on the same Wi-Fi (not a
  guest network) and the computer's address is right. On a computer with
  several networks you can set it: `JARVIS_LAN_IP=192.168.1.20`.

**Privacy.** Phone mode serves the HUD on your local network over HTTPS. A
device must pair first with the code or QR code shown on your computer; after
5 wrong codes, typing codes is switched off until you restart JARVIS. Paired
phones get a long random key, stored on the computer only as a hash
(`~/.jarvis/phone/devices.json`). To unpair every phone:
`python -m jarvis --forget-phones`. Without `--phone`, nothing is reachable
from the network.

| Option | What it does |
|---|---|
| `--phone-port 9001` | Port the phone connects to (default 8766) |
| `--no-browser` | Don't open the HUD on the computer |

**Can't the phone reach it from outside the house?** Not in this version: it's
Wi-Fi only on purpose, since JARVIS can open apps and change files on your
computer. (JARVIS can't run on Vercel or similar hosting either: it has to run
on your computer to control it.)

## Skills

Out of the box JARVIS can do more than talk:

| Skill | Try saying | How it works |
|---|---|---|
| Web search | "What happened in the cricket today?" | With Claude: Anthropic's own web search and page reader (billed per search on your Anthropic account). With a free model: DuckDuckGo, no key |
| Weather | "Do I need an umbrella tomorrow?" | [Open-Meteo](https://open-meteo.com), free, no key |
| Websites | "Open YouTube and search for lofi music" | Your default browser |
| Apps | "Open Spotify", "open the calculator" | The normal way your OS launches programs |
| System | "How much battery do I have?", "volume to 30" | AppleScript on Mac, `pactl`/`amixer` on Linux, the volume keys on Windows |
| Files | "What's in my Downloads?", "find my invoice PDFs", "save this as notes.txt" | Only inside your home folder (or `JARVIS_FILES_ROOT`) |

```
you > delete old-notes.txt from my Documents
  ? Delete Documents/old-notes.txt to the Recycle Bin? [y/N] y
  · delete_file({'path': 'Documents/old-notes.txt'}) -> Deleted Documents/old-notes.txt (it's in the Recycle Bin).
jarvis > Done, it's in the Recycle Bin if you change your mind.
```

**Safety.** Anything that's hard to undo asks you first, in the terminal or out
loud in voice mode: overwriting, moving or deleting a file, and opening a
program that isn't on the trusted list (common ones like Chrome, Spotify and
the calculator are). Only a clear "yes" goes ahead. File tools can't reach
outside your files folder, apps open by name only (no paths or arguments), and
websites must be `http`/`https`. When JARVIS is used from code with no way to
ask, risky actions are simply declined.

For battery and memory info and deleting to the Recycle Bin instead of
permanently, install the extras: `pip install -e ".[skills]"`.

### Skill settings

| Variable | Default | Meaning |
|---|---|---|
| `JARVIS_SKILLS` | `web,weather,apps,system,files` | Which skills are on. `none` turns them all off |
| `JARVIS_HOME_LOCATION` | | Your city, used when you ask for the weather without saying where |
| `JARVIS_UNITS` | `metric` | `imperial` for °F and mph |
| `JARVIS_TRUSTED_APPS` | | Extra apps that open without asking, comma separated |
| `JARVIS_FILES_ROOT` | your home folder | The only folder the file tools can touch |
| `JARVIS_MAX_WEB_SEARCHES` | `5` | Most web searches per request |

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

For anything risky, call `brain.tools.ask_user("Unlock the front door?")`
inside the tool: it asks the user and stops the tool unless they say yes.
Pass `Brain(confirm=my_yes_no_function)` to choose how the question is asked.

## Free models

The Claude API is paid. JARVIS can also think with free models, with all the
same tools (time, calculator, memory, weather, apps, files, web search):

| Provider | Free key from | Key variable | Default model |
|---|---|---|---|
| **Groq** (recommended) | [console.groq.com/keys](https://console.groq.com/keys), no card | `GROQ_API_KEY` | `openai/gpt-oss-120b` |
| Google Gemini | [aistudio.google.com/apikey](https://aistudio.google.com/apikey), no card | `GEMINI_API_KEY` | `gemini-2.5-flash` |
| OpenRouter | [openrouter.ai/keys](https://openrouter.ai/keys), no card | `OPENROUTER_API_KEY` | `openrouter/free` (picks a free model that can use tools) |
| Mistral | [console.mistral.ai/api-keys](https://console.mistral.ai/api-keys), free "Experiment" plan (needs a phone number) | `MISTRAL_API_KEY` | `mistral-small-latest` |
| Cerebras | [cloud.cerebras.ai](https://cloud.cerebras.ai): not really free any more, a one-time $5 trial that needs a card | `CEREBRAS_API_KEY` | `gpt-oss-120b` |
| Ollama | Nothing: runs on your own computer ([ollama.com](https://ollama.com)) | | `llama3.1` |

Nothing extra to install: JARVIS talks to them with Python's standard library.

On Windows (PowerShell):

```powershell
setx GROQ_API_KEY "gsk_your_key_here"    # saves it; open a NEW PowerShell window after this
python -m jarvis                          # or --hud, --phone, --voice as usual
```

On Mac/Linux: `export GROQ_API_KEY=gsk_...` then `python -m jarvis`.

JARVIS picks the provider by itself: `JARVIS_PROVIDER` if you set it, otherwise
the first key it finds in the order of the table (Groq, Gemini, OpenRouter,
Mistral, Cerebras), then `ANTHROPIC_API_KEY`. To choose for one run:
`python -m jarvis --provider cerebras` (or `groq`, `gemini`, `openrouter`,
`mistral`, `claude`, `ollama`), and `--model <name>` for a different model,
e.g. `--model openai/gpt-oss-20b` on Groq (faster, a bit less clever). To change one provider's model for
good: `setx JARVIS_GROQ_MODEL "openai/gpt-oss-20b"` (same for
`JARVIS_CEREBRAS_MODEL`, `JARVIS_GEMINI_MODEL`, ...).

**Auto-switch.** Set keys for more than one free provider and JARVIS uses the
others as backups: when the main one hits its rate limit or fails, it asks the
next one and keeps going, and leaves the tired one alone for a minute. The
startup line shows the order, e.g. `groq: openai/gpt-oss-120b; backup:
gemini, openrouter`. `JARVIS_FALLBACK` changes it: `auto` (default, every free
provider with a key), a list like `cerebras,gemini`, or `none`. Claude never
switches to another service by itself.

Good to know:

- **Web search** on free models uses DuckDuckGo (no key) and JARVIS reads
  pages itself, instead of Anthropic's built-in search. It won't open
  addresses on your own computer or home network.
- **Free tiers have per-minute limits.** With one key, if you ask a lot
  quickly, JARVIS says it hit the limit; wait a minute. With two or more keys
  it just switches.
- Free models are less careful than Claude at choosing tools. Risky actions
  still always ask you first.
- You can switch providers any time; the conversation and memory carry over.

## How it works

```
 user text ──► Brain.think()
                 │
                 ├─► the model (Claude, Groq, Gemini or Ollama) ◄── system prompt + tools + history
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
| `jarvis/skills/` | Real-world skills: `web.py`, `weather.py`, `apps.py`, `system.py`, `files.py` |
| `jarvis/providers.py` | Talks to the chosen model: Claude, or Groq / Gemini / Ollama (translates messages and tool calls) |
| `jarvis/config.py` | Settings and JARVIS's personality (system prompt) |
| `jarvis/chat.py` | Asks the brain and turns API errors into something JARVIS can say |
| `jarvis/voice/` | Voice mode: `ears.py` (mic + Whisper), `mouth.py` (TTS), `wake.py` (wake word), `session.py` (the listen, think, speak loop) |
| `jarvis/hud/` | The HUD: `app.py` (runs requests, publishes live events), `server.py` (local web server), `voice.py` (hooks up the mic and TTS), `static/` (the page; `robot.js` is the 3D robot) |
| `jarvis/__main__.py` | Command line: text chat, `--voice`, `--speak`, `--hud` |

Memory lives in `~/.jarvis/` (`conversation.json` and `facts.json`), so JARVIS
picks up where it left off after a restart.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `JARVIS_PROVIDER` | first key found | `groq`, `cerebras`, `gemini`, `openrouter`, `mistral`, `claude` or `ollama` (see [Free models](#free-models)) |
| `GROQ_API_KEY` / `CEREBRAS_API_KEY` / `GEMINI_API_KEY` / `OPENROUTER_API_KEY` / `MISTRAL_API_KEY` / `ANTHROPIC_API_KEY` | | API key for that provider (one is needed, except for Ollama) |
| `JARVIS_FALLBACK` | `auto` | Backup providers when the main free one hits its limit: `auto`, a list like `cerebras,gemini`, or `none` |
| `JARVIS_<PROVIDER>_MODEL` | | Model for one provider, e.g. `JARVIS_GROQ_MODEL` |
| `JARVIS_MODEL` | the provider's default | Model to use |
| `JARVIS_EFFORT` | `medium` | How hard Claude thinks: `low`, `medium`, `high`, `xhigh`, `max` (Claude only) |
| `JARVIS_MAX_TOKENS` | `16000` (Claude), `4096` (free) | Max length of one response |
| `JARVIS_MAX_TOOL_ROUNDS` | `20` | Safety cap on tool calls per message |
| `JARVIS_OLLAMA_URL` | `http://localhost:11434/v1` | Where Ollama runs (also `JARVIS_GROQ_URL`, `JARVIS_GEMINI_URL`) |
| `JARVIS_FALLBACKS` | `1` | If Claude declines a request, retry on Anthropic's recommended fallback model. Set `0` to turn off |
| `JARVIS_SYSTEM_PROMPT_FILE` | | Path to a file that replaces the default personality |
| `JARVIS_DATA_DIR` | `~/.jarvis` | Where memory is saved |

## Tests

```bash
pytest
```

The tests use a fake Claude client, a fake HTTP layer for the free models, and fake ears and mouth, so they run without
an API key, a microphone or the voice packages. Skill tests swap out the
network, app launching and volume calls, so running them changes nothing on
your computer.
