# Plan: 40–50 specialist agents under JARVIS

Status: **Phase 1 built** (agent files, registry, supervisor, `/agents`,
`/agent`, `/status`, 8 starter agents). Phases 2-5 are still plans. Written for how JARVIS actually runs today:
one Windows PC, slow internet, and free-tier API keys (Groq, Cerebras, Gemini,
OpenRouter, Mistral) that each have per-minute and per-day limits.

## 1. The short version

- **Don't run 50 agents at once.** On free keys that guarantees rate-limit
  errors within a minute, and 50 Python processes on one PC wastes RAM for
  nothing. Instead, an agent is a small **config file** (a prompt, a short list
  of tools, a model size), not a running program. It costs nothing until it is
  used.
- **JARVIS stays the only one you talk to.** It becomes an *orchestrator*: it
  reads your request, picks one specialist (or a short chain of two or three),
  runs it, and answers you. Specialists never talk to you directly.
- **One shared "budget" guards every API call.** Every agent's request goes
  through a single queue that knows each free provider's limits and spends them
  carefully, so JARVIS slows down a little under load instead of crashing.
- **A supervisor catches every failure.** A broken agent, a timeout or a dead
  provider gives you a short apology and a fallback answer. It never takes the
  whole of JARVIS down.

What this buys you: 40–50 specialists that are each better at their job than one
general assistant, while JARVIS still feels like one assistant and stays up.

## 2. Being honest about free tiers

Free limits change often, so treat these as rough orders of magnitude and check
each console. The numbers will live in a config file, not in code.

| Provider | Roughly per minute | Roughly per day | Good for |
|---|---|---|---|
| Groq | ~30 requests, but only a few thousand **tokens** on big models | ~1,000+ requests | Fast replies, the router |
| Cerebras | ~30 requests | ~1M tokens | Heavy reasoning (gpt-oss-120b) |
| Gemini (Flash) | ~10–15 requests | a few hundred requests | Long documents, summaries |
| OpenRouter `:free` | ~20 requests | ~50 requests (1,000 with $10 credit) | Last-resort backup |
| Mistral | ~1 request/second | monthly token cap | Backup, short tasks |

What that means in practice:

- **Tokens per minute are the real wall, not requests.** Today every call sends
  the full system prompt plus *all ~20 tool definitions*. With 50 agents' tools
  in one prompt, a single "hi" could use most of Groq's per-minute token budget.
  So each specialist must carry **only its own 3–6 tools** and a short prompt.
- **All providers together sustain roughly 60–100 model calls a minute and a few
  thousand a day.** A single request to JARVIS often needs 2–4 calls (route, think,
  use a tool, answer). That is plenty for one person talking to JARVIS, but **not**
  for many agents chatting with each other in the background.
- **Background agents must be rare and cheap.** A "check my email every minute"
  agent alone would burn the daily budget. Background jobs run on a timer of
  15+ minutes, use the smallest model, and pause when you are actively talking.
- **Ollama is the safety net.** A small local model (e.g. a 3–8B model) has no
  rate limits. It is slow on a normal PC but good for routing, short summaries,
  and keeping JARVIS working when the internet is bad or every key is used up.

## 3. Architecture

```
            you (text / voice / HUD / phone)
                         │
                   ┌─────▼──────┐
                   │   JARVIS   │  orchestrator: talks to you, owns memory
                   └─────┬──────┘
                         │ 1. route
                   ┌─────▼──────┐
                   │   Router   │  rules first, tiny model only if unsure
                   └─────┬──────┘
                         │ 2. pick 1 (sometimes 2–3) specialists
     ┌───────────┬───────┴─────┬───────────────┐
     ▼           ▼             ▼               ▼
 Weather     Coder        Researcher   ...  (40–50 agent configs, loaded lazily)
     │           │             │
     └───────────┴──────┬──────┘
                        │ every model call
                 ┌──────▼───────┐
                 │  Supervisor  │  timeouts, retries, crash isolation
                 └──────┬───────┘
                 ┌──────▼───────┐
                 │ Budget queue │  per-provider token + request buckets
                 └──────┬───────┘
          Groq · Cerebras · Gemini · OpenRouter · Mistral · Ollama
```

### 3.1 Agents are config files (registry + lazy loading)

Each agent is one small Markdown file in `jarvis/agents/builtin/` (or the
user's `~/.jarvis/agents/`), e.g. `weather.md`:

```markdown
---
name: weather
description: Current weather and forecasts for any city.
keywords: weather, rain, temperature, forecast, mausam, barish
tools: get_weather, get_current_time
tier: small          # small | medium | large
max_rounds: 3        # tool-call rounds before it must answer
timeout: 30
---
You are JARVIS's weather specialist. ...
```

The header-plus-prompt layout is the same one used by popular agent
collections, so outside agents can be imported later (unknown header keys are
ignored). Python's standard library is enough to read it (no TOML needed on
Python 3.10). The **registry** reads only the
`name`, `description` and `keywords` of every agent at startup (a few KB). The
prompt and tools are loaded the first time that agent is needed and kept in a
small cache (the last ~10 used). This is why 50 agents cost almost nothing at
startup.

Code changes this needs:

- `ToolRegistry.schemas(only=[...])` so an agent sends only its own tools.
- `Brain` gains a `run_agent(agent, task)` that runs the existing tool loop with
  that agent's prompt, tools, model tier and round limit.
- Agents never write to your conversation history directly. JARVIS gets a short
  result back and decides what to say.

### 3.2 Routing: rules first, model only when needed

Every model call costs budget, so routing tries the free options first:

1. **Keyword / pattern match** against each agent's `keywords` (English and Roman
   Urdu). "barish hogi kal?" → `weather`. No API call at all.
2. **Embedding or simple scoring** against agent descriptions if no keyword
   matches (can run locally, no API).
3. **Tiny model call** (smallest Groq model, or local Ollama) only if still
   unsure: "Which of these 8 candidate agents fits? Answer with one name."
   Only the top candidates are shown, not all 50.
4. If nothing fits, the **general** agent (today's JARVIS) handles it.

Multi-step requests ("research X and email me a summary") become a short plan of
at most 3 steps. Steps run one after another and pass small text results along.
No agent-to-agent chatting loops.

### 3.3 Model tiers and model choice

Agents ask for a *size*, not a provider:

| Tier | Used for | First choice → backups |
|---|---|---|
| small | routing, weather, timers, quick facts | Groq small model → Ollama |
| medium | most agents | Groq 70B → Cerebras → Mistral |
| large | coding, research, planning, long docs | Cerebras gpt-oss-120b → Gemini → OpenRouter |

This builds on the `FallbackProvider` auto-switch already in the repo (PR #9):
the budget queue just tells it which providers still have room *before* it tries
them, instead of finding out from a 429 error.

### 3.4 Concurrency limits

- **At most 2 model calls in flight at once** (configurable, default 2). With
  slow internet more parallel calls only make each one slower and use limits
  faster.
- **Foreground first.** Your live request always jumps ahead of background jobs.
  Background jobs are paused while you are talking or JARVIS is speaking.
- **Agents run as tasks in one process**, not as separate processes. Local tools
  that could hang (opening apps, reading big files, web pages) run in a small
  thread pool with a timeout, so one stuck tool cannot freeze JARVIS.
- **Hard caps per request:** max 3 agents per request, max rounds per agent,
  max total model calls per request (e.g. 8). If a cap is hit, JARVIS answers
  with what it has.

### 3.5 The budget queue (rate-limit budgeting)

One object, shared by every agent, that every model call must pass through:

- For each provider it keeps **token buckets** for requests/minute,
  tokens/minute and requests/day, filled from `limits.toml`.
- Before a call it **estimates tokens** (prompt length ÷ 4 + expected output) and
  picks the first provider in the tier's list that has room. If none has room, it
  either **waits** (if the wait is a few seconds) or **drops to a smaller tier /
  Ollama** (if it is longer).
- When a provider returns 429 it reads the `retry-after` / reset headers and marks
  that provider "resting" for exactly that long (today it is a flat 60 s).
- **Daily counters are saved to disk** (`~/.jarvis/budget.json`) so restarting
  JARVIS doesn't make it forget it already used today's quota.
- The HUD shows a small "fuel gauge" per provider so you can see when keys are
  running low.

### 3.6 Caching (saves budget and makes slow internet feel fast)

| Cache | What | Lifetime |
|---|---|---|
| Route cache | request pattern → chosen agent | days |
| Tool result cache | weather, web search, web pages, exchange rates | 10 min – 1 day per tool |
| Answer cache | exact repeated questions with no time-sensitive tools | 1 hour |
| Prompt cache | Claude and some providers cache a fixed prompt prefix, so agent prompts keep a stable start | provider-managed |

Stored in one SQLite file (`~/.jarvis/cache.db`), standard library only, no new
dependency. Time and "right now" questions are never cached.

### 3.7 Supervision and crash recovery ("it doesn't shut down")

- **Every agent run is wrapped**: timeout, catch every exception, log it, and give
  JARVIS a clean "the weather agent failed: …" result. JARVIS then answers itself
  or tries the general agent. The main loop never sees a raw exception.
- **Circuit breaker per agent and per provider:** 3 failures in 5 minutes → that
  agent/provider is switched off for 10 minutes and the router skips it.
- **Retries with backoff and jitter** for network errors only (slow internet),
  at most 2 retries, never for "declined" or bad-input errors.
- **Checkpoints:** conversation and fact memory already roll back on failure
  (`memory.checkpoint()`). Long multi-step tasks also save their step results so
  they can resume after a restart.
- **Watchdog launcher:** a tiny `jarvis-supervisor` script starts JARVIS and
  restarts it within a few seconds if the process ever dies (e.g. an audio driver
  crash), with a limit so it doesn't loop forever. Optional Windows Task
  Scheduler entry to start it at login.
- **Health check:** `/health` on the HUD server and a `/status` command show which
  agents and providers are up, resting or broken.
- **Memory hygiene:** history is trimmed/summarised past a size limit so long
  sessions don't grow until requests fail.

### 3.8 Shared memory between agents

- **Long-term facts** (`FactStore`) stay owned by JARVIS. Agents may *read* the
  facts relevant to them (the router passes a filtered handful, not all of them)
  and *propose* new facts; JARVIS saves them.
- **Short-term "blackboard"** per request: a small dict where a step can leave
  results for the next step (e.g. researcher → writer). Thrown away after the
  request.
- **Agent notes**: each agent can keep a small private note file (e.g. the
  finance agent's monthly budget) under `~/.jarvis/agents/<name>/`.
- Agents never get the full conversation, only a short task description plus the
  last few relevant turns. That keeps prompts small (budget) and focused (quality).

### 3.9 Safety

- An agent can only call the tools listed in its config.
- Risky tools still go through `ToolRegistry.ask_user()`; background agents can
  never approve risky actions (they get "declined" automatically).
- Agents that send messages or emails, spend money or delete files always ask
  you first.

## 4. Suggested agents (46), grouped by area

"Tier" is the model size. ★ = build in the first wave. ⏱ = can also run in the
background on a slow timer. Agents marked *needs integration* require a new tool
or account login (e.g. Gmail, Google Calendar) that JARVIS doesn't have yet.

**Core (always present)**

| # | Agent | Does | Tier |
|---|---|---|---|
| 1 | general ★ | Today's JARVIS; catch-all when no specialist fits | medium |
| 2 | router ★ | Picks the agent(s) for a request | small |
| 3 | planner ★ | Splits a big request into ≤3 steps | medium |
| 4 | memory-keeper ★ | Saves, recalls, cleans up facts about you | small |
| 5 | summariser ★ | Shortens long text, tool results, history | small |

**Daily life**

| # | Agent | Does | Tier |
|---|---|---|---|
| 6 | weather ★ | Weather, rain alerts | small |
| 7 | time-and-date ★ | Time zones, countdowns, date maths | small |
| 8 | reminders ★⏱ | Reminders and alarms (local, no API) | small |
| 9 | calendar ⏱ | Events, free slots (*needs integration*) | medium |
| 10 | todo ★ | To-do lists stored locally | small |
| 11 | prayer-times ⏱ | Namaz times for your city, reminders | small |
| 12 | news ⏱ | Morning headlines on topics you pick | medium |
| 13 | morning-briefing ⏱ | Weather + agenda + news in one spoken summary | medium |
| 14 | translator ★ | English ↔ Urdu / Roman Urdu and others | medium |
| 15 | unit-converter | Units, currency (cached rates) | small |

**Computer control (Windows)**

| # | Agent | Does | Tier |
|---|---|---|---|
| 16 | app-launcher ★ | Open/close apps and sites | small |
| 17 | system-monitor ★⏱ | CPU, RAM, disk, battery; warn when low | small |
| 18 | file-manager ★ | Find, read, move, tidy files (asks before risky ones) | medium |
| 19 | downloads-cleaner | Sorts the Downloads folder by type | small |
| 20 | clipboard | Summarise/translate/rewrite what you copied | small |
| 21 | screenshot-reader | Reads text from a screenshot (OCR) | medium |
| 22 | media-control | Volume, play/pause, next track | small |
| 23 | network-doctor ⏱ | Checks internet speed/ping, explains outages | small |

**Knowledge and research**

| # | Agent | Does | Tier |
|---|---|---|---|
| 24 | web-researcher ★ | Searches, reads pages, cites sources | large |
| 25 | fact-checker | Double-checks a claim against sources | medium |
| 26 | explainer | Explains a topic simply, at your level | medium |
| 27 | document-reader | Q&A over a PDF/Word file on your PC | large |
| 28 | youtube-summariser | Summarises a video from its transcript | medium |
| 29 | wikipedia | Quick encyclopedia lookups (cached) | small |

**Work and productivity**

| # | Agent | Does | Tier |
|---|---|---|---|
| 30 | writer ★ | Drafts messages, posts, letters | medium |
| 31 | email | Reads/drafts email, never sends without asking (*needs integration*) | medium |
| 32 | notes | Quick notes, searchable later | small |
| 33 | meeting-notes | Turns a transcript into notes and actions | medium |
| 34 | spreadsheet | Reads/makes simple Excel/CSV files | medium |
| 35 | presentation-helper | Outlines slides from a topic | medium |

**Coding and tech**

| # | Agent | Does | Tier |
|---|---|---|---|
| 36 | coder ★ | Writes and explains code | large |
| 37 | debugger | Reads an error/traceback, suggests a fix | large |
| 38 | git-helper | Explains/runs safe git commands (asks first) | medium |
| 39 | jarvis-doctor ★ | Checks JARVIS's own health, keys, budget, logs | small |

**Learning, money, health, fun**

| # | Agent | Does | Tier |
|---|---|---|---|
| 40 | tutor | Teaches a subject step by step, quizzes you | medium |
| 41 | english-coach | Corrects grammar, improves speaking | medium |
| 42 | finance-tracker | Logs expenses locally, monthly summary | small |
| 43 | calculator ★ | Maths, percentages (local tool, no API) | small |
| 44 | health-and-fitness ⏱ | Water/workout reminders, simple plans | small |
| 45 | recipes | Recipes from what's in your kitchen | medium |
| 46 | entertainment | Jokes, stories, games, movie suggestions | small |

That is 46. Easy additions later: smart-home, WhatsApp, shopping/price-watch,
travel, cricket scores, Islamic Q&A, Quran recitation, job search.

Note on overlap: some of these (calculator, time-and-date, unit-converter) are
simple enough that they should just be **tools that the general agent uses**,
not full agents, and they will be built that way. They are listed so the
"family" is complete and routable by name.

## 5. Build in phases

Each phase is one pull request that leaves JARVIS working.

| Phase | What | Result you notice |
|---|---|---|
| **1. Foundation** | Agent config format, registry with lazy loading, `run_agent`, per-agent tool lists, supervisor (timeouts, error isolation), `/status` | Nothing changes in behaviour, but JARVIS can't crash from a tool or agent error |
| **2. Budget + cache** | Budget queue with per-provider buckets and saved daily counters, `retry-after` handling, SQLite cache, model tiers, Ollama as last resort | Far fewer "rate limit" errors; repeated questions are instant |
| **3. Router + first 12 agents** | Keyword + tiny-model router, the ★ agents | JARVIS says which specialist answered; better answers for coding/research/translation |
| **4. Background + watchdog** | Slow-timer background jobs, pause-while-talking, watchdog launcher, HUD fuel gauge | Reminders, morning briefing; JARVIS restarts itself if it ever dies |
| **5. The rest** | Remaining agents, a few at a time, plus integrations (calendar, email) as you want them | Full 40–50 family |

## 6. Numbers to tune (defaults)

| Setting | Default | Why |
|---|---|---|
| Max model calls in flight | 2 | slow internet, small per-minute limits |
| Max agents per request | 3 | keeps a request to a few calls |
| Max model calls per request | 8 | hard stop on loops |
| Agent timeout | 30 s (large tier 60 s) | slow internet |
| Background interval | ≥15 min | daily budgets |
| Circuit breaker | 3 failures / 5 min → off 10 min | stops hammering a broken thing |
| Loaded-agent cache | 10 | low RAM use |
