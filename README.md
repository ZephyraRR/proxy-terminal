# proxy-terminal

Chat UI where every chat is its own sandbox. You send a message, a **new Docker container** starts with its own
**cline-auto** (your auto-model-picking, auto-retrying wrapper around Cline), the terminal opens on the left and
your message is typed into it. Follow-ups go into the same Cline. Your other Cline windows are never touched.

```
browser ─ localhost:3100 ─> server.js ─ docker run ─> container (one per chat)
   │                                                   ├ cline auth (this chat's key, model)
   └ iframe localhost:<port> ─ ttyd ─ tmux ────────────┴ cline-auto -i -P openrouter ─> Cloudflare Worker ─> openrouter.ai
```

## Daily use

Double-click **`start.bat`**. It starts Docker Desktop if needed, copies your `cline-auto` scripts into the image,
builds it (cached after the first time), starts the server and opens http://127.0.0.1:3100.

## One-time setup: two API keys, two Cloudflare Workers

1. Run **`deploy-workers.bat`** (first time it opens a browser for `wrangler login`). It deploys
   `proxy-terminal-1` and `proxy-terminal-2` from `worker/worker.js` and shows their URLs
   (`https://proxy-terminal-N.<your-subdomain>.workers.dev`).
2. Copy `config.local.example.json` to **`config.local.json`** (git-ignored) and fill in a *profile* per account:
   the OpenRouter key and its Worker URL **with `/api/v1` appended**.
3. In the UI each chat has a profile dropdown. Chat on "Account 1" always uses key 1 through Worker 1, "Account 2"
   key 2 through Worker 2. A key typed in the chat's key field overrides the profile's.

## What runs in the container

`docker/cline_auto_linux.py` is a thin Linux launcher: it imports **your unchanged `cline_auto.py`** (Watcher,
"Continue" after network errors, rate-limit waits, free-model picking at start, model switch + session resume) and only
supplies the PTY layer that is Windows-specific there (winpty). `cline_models.py` is patched at build time so its
catalog and probe requests also go through the Worker (`OPENROUTER_BASE`) instead of straight to openrouter.ai.
`cline auth -b` accepts base URLs only for OpenAI providers, so the entrypoint writes the Worker URL into the
OpenRouter provider's `baseUrl` in Cline's settings.

The server also has a small safety net of its own: it closes Cline's "Open ClinePass" modal, and retypes a message
until it shows up (Cline's TUI drops keys while it starts).

## Tests

`test/run-tests.sh` runs the whole chain locally with a fake OpenRouter (`test/fake-openrouter.js`) and the real
`worker/worker.js` under `wrangler dev` (two instances, one per account): parallel chats with different keys and
Workers, no cross-over, cline-auto startup model pick, follow-up messages, network-error recovery with an automatic
`Continue`, model-disappears switch + resume, Done/Delete cleanup.

## Notes

- The terminal port is published on `127.0.0.1` only; the key is passed to the container as an env var and kept in
  `state.json` / `config.local.json`, both git-ignored.
- Worker option `PROXY_TOKEN` (secret) exists but Cline cannot send that header, so it is not wired up.
- `docker/cline-tools/` is a copy of your own scripts made by `start.bat`; it is git-ignored.
