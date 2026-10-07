# proxy-terminal

Chat UI (left: raw API terminal, right: chats) for OpenRouter with a per-chat API key and proxy country.

## Run

    node server.js            # http://127.0.0.1:3000

or in a container:

    docker build -t proxy-terminal . && docker run --rm -p 3000:3000 proxy-terminal

The browser talks only to `/api/chat`; `server.js` relays the streamed response to OpenRouter.
If the chat has a proxy country, the request goes through the HTTP proxy listed for it in `proxies.json`
(`"host:port"` or `"user:pass@host:port"`, empty = direct).

## Model

One model is used (`this.models[0]` in `script.js`), with no automatic fallback.

## Not included

Integration with `cline-auto` is not implemented: it is an interactive Windows PTY wrapper around the Cline CLI,
not a request/response service, so it cannot be driven through this API.
