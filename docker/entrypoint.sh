#!/bin/bash
# Env: API_KEY (required), MODEL (required by cline auth), BASE_URL (Cloudflare Worker .../api/v1, optional)
cline auth -p openrouter -k "$API_KEY" -m "${MODEL:-cohere/north-mini-code:free}" >/tmp/auth.log 2>&1 || cat /tmp/auth.log
if [ -n "$BASE_URL" ]; then
  # `cline auth -b` only accepts OpenAI providers, so point the OpenRouter provider at the worker in its settings file
  node -e '
    const fs = require("fs"), f = process.env.HOME + "/.cline/data/settings/providers.json";
    const d = JSON.parse(fs.readFileSync(f, "utf8"));
    d.providers.openrouter.settings.baseUrl = process.env.BASE_URL;
    fs.writeFileSync(f, JSON.stringify(d, null, 2));'
fi
unset API_KEY
export OPENROUTER_BASE="${BASE_URL:-}"
tmux new-session -d -s main -x 200 -y 50 'cline-auto -i -P openrouter; echo; echo "[cline exited]"; exec bash'
exec ttyd -W -p 7681 -t fontSize=14 -t 'theme={"background":"#1e1e1e"}' tmux attach -t main
