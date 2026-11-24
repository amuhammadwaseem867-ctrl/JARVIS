# Maya Secure

A hardened fork of **AIRA AI Assistant** by Arvind Kumar ([arvindcodex/Maya](https://github.com/arvindcodex/Maya), Apache 2.0).
Same features: real-time Gemini Live voice, 3D hologram UI, camera mood awareness, memory, skills, personas and macOS desktop control. The difference is that nothing risky happens without your approval, and your keys never leave your machine's backend.

See [SECURITY.md](SECURITY.md) for the full list of fixes.

## What is different

* **Local only.** The backend listens on `127.0.0.1` and every request needs a private per-launch token.
* **You approve risky actions.** Typing, clicking, clipboard, screenshots, file changes, links, WhatsApp messages and screen control each show an approval dialog. Approvals are single use.
* **No shell access for the AI.** Only read-only presets (date, uptime, disk usage, OS version, battery, Wi-Fi name, top processes).
* **Files stay in `~/MayaWorkspace`.**
* **Keys stay on the server.** The browser receives a short-lived, single-use voice token.
* **Audit log** of every action at `<data folder>/data/audit.log`.

## Requirements

* macOS for desktop control (the web UI and voice work anywhere)
* Node.js 22 or newer, Python 3.10 or newer
* A Gemini API key from Google AI Studio

## Run it

```bash
npm install
cp .env.example .env        # then put your key in GEMINI_API_KEY
npm run dev
```

The terminal prints a private link such as `http://localhost:3000/#token=…`. Open that link. Do not share it; anyone with it can use Maya while it runs.

Desktop app (macOS):

```bash
npm run electron:build:mac
```

For the packaged app, put your `.env` in `~/Library/Application Support/maya-secure/` or enter the key in Settings. It is never bundled into the app.

## Settings

| Variable | Default | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | none | Your Gemini key (server side only) |
| `MAYA_WORKSPACE` | `~/MayaWorkspace` | The only folder the AI can read or write |
| `MAYA_ENABLE_WHATSAPP` | off | Set to `1` to enable the unofficial WhatsApp bridge (can get numbers banned) |
| `MAYA_HOST` | `127.0.0.1` | Change only if you understand the risk |
| `PORT` | `3000` | Backend port |

## Tests

```bash
npm run build && npm test
```

## Licence and credit

Apache License 2.0. Original work © Arvind Kumar. Modifications are listed in [NOTICE](NOTICE). The original README is preserved in [README.upstream.md](README.upstream.md).
