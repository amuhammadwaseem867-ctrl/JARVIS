# Ultron

Your personal command intelligence: real-time voice, camera awareness, memory, skills, personas and approved macOS desktop control. Works with a Gemini key, and in local mode without one. Nothing risky happens without your approval, and your keys never leave your own machine.

Built on **AIRA AI Assistant** by Arvind Kumar ([arvindcodex/Maya](https://github.com/arvindcodex/Maya), Apache 2.0).

See [SECURITY.md](SECURITY.md) for the full list of fixes.

## What is different

* **Local only.** The backend listens on `127.0.0.1` and every request needs a private per-launch token.
* **You approve risky actions** (unless you turn on Full Control mode). Typing, clicking, clipboard, screenshots, file changes, links, WhatsApp messages and screen control each show an approval dialog. Approvals are single use.
* **No shell access for the AI by default.** Only read-only presets, unless Full Control mode is on (date, uptime, disk usage, OS version, battery, Wi-Fi name, top processes).
* **Files stay in `~/UltronWorkspace`.**
* **Keys stay on the server.** The browser receives a short-lived, single-use voice token.
* **Audit log** of every action at `<data folder>/data/audit.log`.

## Full Control mode

Set `ULTRON_FULL_CONTROL=1` in `.env` (it is on in `.env.example`). Ultron can then run any shell command, open Terminal, use every shortcut and read or change any file in your home folder, with no approval prompts. A red "Full control on" badge stays on screen while it is active, every action is written to the audit log, and Ultron refuses to start in this mode if `ULTRON_HOST` exposes it to other devices.

Risk you accept: text Ultron reads (web pages, messages, files, the screen) could try to trick it into running harmful commands. Remove the line to return to approval mode.

## Local mode (no API key)

Ultron starts even without a Gemini key. Press Connect and it runs locally:

* **Built-in commands**, in English and Roman Urdu: "what's the time", "aaj ki date", "open WhatsApp", "chrome kholo", "volume 40", "mute", "battery", "disk space", "Wi-Fi".
* **Free conversation** through [Ollama](https://ollama.com) on your own computer: install it, run `ollama pull llama3.2`, and Ultron uses it automatically. Nothing leaves your machine.
* **Voice**: speech input uses the browser's recognition where available (Chrome, Edge, Safari); replies are spoken with your system voices. Typing always works.

The local model only writes text. It is never given control of your computer; commands still go through the approval rules. Camera vision and the screen agent need a Gemini key.

| Variable | Default | Purpose |
|---|---|---|
| `ULTRON_OLLAMA_MODEL` | `llama3.2` | Preferred local model |
| `ULTRON_OLLAMA_URL` | `http://127.0.0.1:11434` | Must stay on this computer |

## Wake word and auto-start

Say **"Ultron"** and it switches itself on, no code, no Start button. "Ultron, open WhatsApp" wakes it and runs the command; "Hey Ultron" wakes it and waits for you.

* **Desktop app**: install the free offline speech engine once with `python3 -m pip install faster-whisper sounddevice numpy`. Ultron then starts hidden at login (tray icon), listens in the background and opens itself when called. Speech is transcribed on your computer. `Cmd/Ctrl + Shift + U` also opens it. Turn auto-start off in the tray menu or with `ULTRON_AUTOSTART=0`.
* **Browser tab**: while Ultron is idle, Chrome, Edge and Safari listen for "Ultron" with their built-in speech recognition, no install needed.

## Phone (iPhone and Android)

With `ULTRON_PHONE=1` (on in `.env.example`), use Ultron from your phone's browser, microphone included, while it is on the same Wi-Fi as your computer:

1. On the computer, press **Connect phone** (bottom left).
2. Scan the QR code with the phone camera, or open the shown address and type the 6-digit code.
3. The first time, the phone warns about the certificate, because it is made by your own computer. Tap **Show details, visit this website** (iPhone) or **Advanced, proceed** (Android).
4. Optional: Share, **Add to Home Screen** for an app icon.

A phone stays paired for 30 days. **Unpair all** in the same panel signs every phone out. Codes are single use, expire after 10 minutes and are burnt after 5 wrong tries. Phone settings can only be changed on the computer.

## Requirements

* macOS for desktop control (the web UI and voice work anywhere)
* Node.js 22 or newer, Python 3.10 or newer
* Optional: a Gemini API key from Google AI Studio (for live voice, camera vision and screen control)

## Run it

```bash
npm install
cp .env.example .env        # then put your key in GEMINI_API_KEY
npm run dev
```

The terminal prints a private link such as `http://localhost:3000/#token=…`. Open that link. Do not share it; anyone with it can use Ultron while it runs.

Desktop app (macOS):

```bash
npm run electron:build:mac
```

For the packaged app, put your `.env` in `~/Library/Application Support/ultron/` or enter the key in Settings. It is never bundled into the app.

### Windows

Chat, voice, Gemini, the wake word and phone mode work on Windows. Opening apps, volume and other computer control are macOS only for now. Python is called `python` on Windows; set `ULTRON_PYTHON` in `.env` if yours has another name. If Ultron says a port is busy, it is already running in another window: close that window first.

## Settings

| Variable | Default | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | none | Your Gemini key (server side only) |
| `ULTRON_WORKSPACE` | `~/UltronWorkspace` | The only folder the AI can read or write |
| `ULTRON_ENABLE_WHATSAPP` | off | Set to `1` to enable the unofficial WhatsApp bridge (can get numbers banned) |
| `ULTRON_HOST` | `127.0.0.1` | Change only if you understand the risk |
| `PORT` | `3000` | Backend port |

## Tests

```bash
npm run build && npm test
```

## Licence and credit

Apache License 2.0. Original work © Arvind Kumar. Modifications are listed in [NOTICE](NOTICE). The original README is preserved in [README.upstream.md](README.upstream.md).
