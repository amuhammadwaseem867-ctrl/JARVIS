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
| `jarvis/__main__.py` | Terminal chat |

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

The tests use a fake Claude client, so they run without an API key.
