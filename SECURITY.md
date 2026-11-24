# Ultron: security review and changes

Reviewed: `arvindcodex/Maya` (app name "AIRA AI Assistant"), commit `59518f6`, 12 Nov 2026.
The original code was read in full before anything was run. It was never executed with real credentials.

## Findings in the original

| # | Severity | Finding | Fix in Ultron |
|---|----------|---------|--------------------|
| 1 | Critical | **The voice AI could run any shell command.** `controlSystem` exposed `run_shell` (`subprocess.run(shell=True)`) directly to Gemini. Anything the model reads (a web page, news item, file, screen text) could inject "run this command". | `run_shell` removed. Replaced by 7 read-only, argument-free presets run without a shell. |
| 2 | Critical | **Backend open to the whole network, no auth.** Express listened on `0.0.0.0:3000` with no token. Anyone on the same Wi-Fi could call `/api/system/python` and run commands. | Binds to `127.0.0.1`. Every `/api` call needs a random per-launch token, a local `Host` header and no foreign `Origin`. |
| 3 | Critical | **DNS rebinding / drive-by from any website.** No Host or Origin checks, so a malicious page could reach the local API. | Host allowlist, Origin and `Sec-Fetch-Site` checks, token (tested). |
| 4 | High | **Gemini key handed to the browser.** `/api/config` returned the raw key, `/api/core` returned saved keys, and `vite.config.ts` compiled the key into the JavaScript bundle. | Keys never leave the server. The browser gets a 30-minute, single-use Gemini Live token. Saved keys are shown masked (`••••1234`). |
| 5 | High | **AppleScript injection.** `type_text`, `hotkey` and `notify` built AppleScript by string concatenation with incomplete escaping, so crafted text could reach `do shell script`. | All values passed as `argv`, never spliced into script source. Keys validated against an allowlist. |
| 6 | High | **No human in the loop.** The AI could type, click, read the clipboard, screenshot, write files and run an autonomous screen agent without asking. | Server-enforced approval: risky actions need a one-time grant (60 s, single use, bound to the exact action hash) created only when you click Approve. |
| 7 | High | **Screen agent followed whatever was on screen.** Screenshots went to the planner with no instruction hierarchy, and it could open any app or link. | Goal approved up front, screen text marked untrusted, action allowlist, no links, `ask_user` escape, Stop endpoint, one task at a time. |
| 8 | High | **Files: full home folder access**, including `~/.ssh`, keychains and `.env` files, with write access. | Confined to `~/UltronWorkspace` (configurable, never home itself). Symlink escape and sensitive names blocked. Reads and writes need approval. |
| 9 | High | **`.env` packaged inside the app** (`extraResources`), so a built `.app` shipped your API key to anyone you gave it to. | Removed. Packaged builds read `.env` only from the per-user data folder. |
| 10 | Medium | **Electron hardening gaps:** no sandbox, `webviewTag` with no attach checks, any URL passed to `shell.openExternal`, IPC accepted from any frame, mic/camera auto-granted to any page, `sh -c` for install. | `sandbox: true`, navigation lock, webview allowlist with preload stripped, http(s)-only external links, IPC sender checks, permissions only for the Ultron window, `fs.cp` instead of shell. |
| 11 | Medium | **Prompt injection through tools.** News, files and tool results were fed to the model as trusted text. | Security rules appended to every persona prompt; tool results labelled as untrusted data. |
| 12 | Medium | **`openWebsite` accepted any URL** (including `javascript:`), opened via `window.open` with opener access. | http(s) only, credentials in URLs rejected, `noopener,noreferrer`, approval required. |
| 13 | Medium | **WhatsApp could message the wrong person.** Contact lookup used `includes`, so "Ali" matched "Alisha". No confirmation before sending. | Exact match only, ambiguity returns an error, every send needs approval and is audited. |
| 14 | Medium | **WhatsApp uses Baileys**, an unofficial client that can get numbers banned. Pairing codes were printed to logs. | Off by default (`ULTRON_ENABLE_WHATSAPP=1` to opt in). Codes no longer logged. |
| 15 | Medium | **Vulnerable dependencies:** 33 advisories (1 critical, 15 high) incl. `proxy-addr`, `body-parser`, `vite`, `ws`. A `cva@0.0.0` placeholder package and unused `three`/`@react-three/*`. | Upgraded; runtime `npm audit --omit=dev` reports **0**. Unused and placeholder packages removed, `shadcn` CLI replaced by a vendored CSS file. |
| 16 | Low | **Fabricated results:** fake "synthetic" news returned as success; accepted calls given a made-up 03:45 duration. | Honest errors; unknown durations left empty. |
| 17 | Low | Data file and folder world-readable; no audit trail; stack traces returned to the browser. | `0600`/`0700` permissions, atomic writes, JSON audit log (typed text redacted), generic error messages, CSP and security headers. |

## Remaining risks (be aware)

* Approving an action means it runs. Read the dialog; it shows exactly what will be typed, clicked or sent.
* Screenshots, camera frames and voice are sent to Google Gemini. That is how the product works.
* macOS Accessibility and Screen Recording permissions are powerful. Grant them only to the Ultron app.
* Dev-only build tools (`electron-builder`, `tsx`) still carry 7 moderate/low advisories that do not ship in the app.
* The ephemeral-token voice connection, Electron shell and macOS automation could not be exercised in the review environment (Linux, no Gemini key). Server, policy, agent and UI flows are covered by automated tests.

## Tests

`npm test` runs 15 server tests (token, Host/Origin, key masking, approvals, file permissions, audit log, bundle has no keys) and 10 system-agent tests (no shell, path escape, symlink escape, URL and hotkey injection).
