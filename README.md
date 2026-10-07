# proxy-terminal

Chat UI where every chat is its own sandbox: you send a message, a **new Docker container** starts with its own
Cline (own state, own `cline auth` with that chat's OpenRouter key), the terminal opens on the left, and your
message is typed into it. Follow-up messages are typed into the same Cline. Other Cline windows on your machine
are never touched.

```
browser ── localhost:3100 ──> server.js ── docker run ──> container per chat
   │                                                       ├ cline auth -p openrouter -k <chat key>
   └ iframe localhost:<random port> ── ttyd ── tmux ───────┴ cline -i   ──> Cloudflare Worker ──> openrouter.ai
```

## Setup

1. Build the image (once): `docker build -t proxy-terminal-cline docker`
2. Deploy the proxy (optional, but this is the "proxy" part): `cd worker && npx wrangler deploy`
   then put `https://<name>.<account>.workers.dev/api/v1` into `config.json` under `workers`
   (`Default`, or one entry per country/Worker you want in the dropdown). Empty = direct to OpenRouter.
3. `node server.js` and open http://127.0.0.1:3100

Per chat you set the API key, the proxy entry and (optionally) the model. `config.json` has the default model,
used because `cline auth` requires one.

## Behaviour

- Container lifecycle: starts on the first message, removed on **Done** or delete. Files Cline creates live in
  `workspaces/<chat id>` on the host.
- Like `cline-auto`: if Cline sits on a "Network error" with an unchanged screen, the server types `Continue`.
- Containers publish their terminal only on `127.0.0.1`. The API key is passed to the container as an env var
  and stored in `state.json` (git-ignored) on your machine.
- `cline auth -b` only accepts OpenAI providers, so the entrypoint writes the Worker URL into the OpenRouter
  provider's `baseUrl` in Cline's settings.
- The Worker is a plain reverse proxy to openrouter.ai; set a `PROXY_TOKEN` secret if you want to lock it down
  (then Cline would also need to send that header, which is not wired up yet).
