#!/bin/bash
# End-to-end test with everything real except OpenRouter itself (replaced by test/fake-openrouter.js) and the
# Cloudflare edge (wrangler dev runs the real worker/worker.js locally, one instance per account).
# Chain per chat: server.js -> Docker container (ttyd/tmux/cline-auto/cline) -> Worker -> fake OpenRouter.
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."
PASS=0; FAIL=0
ok()    { echo "  PASS: $1"; PASS=$((PASS+1)); }
bad()   { echo "  FAIL: $1"; FAIL=$((FAIL+1)); }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }
api()   { curl -s -X "$1" "localhost:3111$2" ${3:+-d "$3"}; }
fake()  { python test/check.py "$@"; }
wait_until() { local t=$1; shift; for i in $(seq 1 $((t/2))); do eval "$@" && return 0; sleep 2; done; return 1; }
screen() { docker exec proxy-terminal-$1 tmux capture-pane -p -t main -S -300; }
send()  { api POST "/api/chats/$1/message" "{\"text\":\"$2\"}" >/dev/null; }
nproc() { docker exec proxy-terminal-$1 sh -c 'for p in /proc/[0-9]*; do tr "\000" " " < $p/cmdline 2>/dev/null; echo; done' | grep -ac "python3 /opt/cline-auto/cline_auto_linux.py"; }
clog()  { docker exec proxy-terminal-$1 cat /home/dev/.cline-auto/log.txt 2>/dev/null; }

cleanup() {
  kill $(cat /tmp/pt-pids 2>/dev/null) 2>/dev/null
  # on Windows `kill` does not reach wrangler's workerd children (and wrangler respawns them): stop them by name
  powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.CommandLine -match 'wrangler|workerd|fake-openrouter' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }" >/dev/null 2>&1
  docker rm -f proxy-terminal-1 proxy-terminal-2 >/dev/null 2>&1
  rm -f state.json
  if [ -f /tmp/config.local.bak ]; then mv /tmp/config.local.bak config.local.json; else rm -f config.local.json; fi
}
trap cleanup EXIT
[ -f config.local.json ] && cp config.local.json /tmp/config.local.bak
rm -f state.json /tmp/pt-pids

echo "== start fake OpenRouter + 2 workers + server"
node test/fake-openrouter.js > /tmp/fake.out 2>&1 & echo $! >> /tmp/pt-pids
(cd worker && npx --yes wrangler dev --ip 0.0.0.0 --port 8787 --inspector-port 9331 --var UPSTREAM:http://127.0.0.1:9999 --var WORKER_NAME:one > /tmp/w1.log 2>&1 & echo $! >> /tmp/pt-pids)
(cd worker && npx --yes wrangler dev --ip 0.0.0.0 --port 8788 --inspector-port 9332 --var UPSTREAM:http://127.0.0.1:9999 --var WORKER_NAME:two > /tmp/w2.log 2>&1 & echo $! >> /tmp/pt-pids)
cat > config.local.json <<'JSON'
{ "profiles": [
  { "name": "Account 1", "apiKey": "sk-or-test-AAA", "worker": "http://host.docker.internal:8787/api/v1" },
  { "name": "Account 2", "apiKey": "sk-or-test-BBB", "worker": "http://host.docker.internal:8788/api/v1" } ] }
JSON
wait_until 120 'grep -q "Ready on" /tmp/w1.log && grep -q "Ready on" /tmp/w2.log' || { echo "workers did not start"; exit 1; }
PORT=3111 node server.js > /tmp/srv.log 2>&1 & echo $! >> /tmp/pt-pids
sleep 3
check "worker 1 reaches fake upstream" '[ "$(curl -s localhost:8787/api/v1/models | grep -c strong-coder)" -ge 1 ]'
check "worker 2 reaches fake upstream" '[ "$(curl -s localhost:8788/api/v1/models | grep -c strong-coder)" -ge 1 ]'
check "UI served" 'curl -s localhost:3111/ | grep -q "Proxy Terminal"'
check "profiles listed" 'api GET /api/chats | grep -q "Account 2"'

echo "== chat 1 (Account 1) and chat 2 (Account 2) in parallel"
api POST /api/chats >/dev/null; api POST /api/chats >/dev/null
api PUT /api/chats/1/settings '{"profile":"Account 1"}' >/dev/null
api PUT /api/chats/2/settings '{"profile":"Account 2"}' >/dev/null
send 1 "hello from chat one"; send 2 "hello from chat two"
wait_until 300 '[ "$(fake count sk-or-test-AAA one "" 1)" -ge 1 ] && [ "$(fake count sk-or-test-BBB two "" 1)" -ge 1 ]'
check "chat 1: streamed request with key AAA via worker one" '[ "$(fake count sk-or-test-AAA one "" 1)" -ge 1 ]'
check "chat 2: streamed request with key BBB via worker two" '[ "$(fake count sk-or-test-BBB two "" 1)" -ge 1 ]'
check "no cross-over: AAA never via worker two" '[ "$(fake count sk-or-test-AAA two "" -)" -eq 0 ]'
check "no cross-over: BBB never via worker one" '[ "$(fake count sk-or-test-BBB one "" -)" -eq 0 ]'
check "cline-auto fetched model list through the worker (AAA, worker one)" '[ "$(fake url sk-or-test-AAA one /api/v1/chat/completions)" -ge 1 ] && grep -q "\"url\":\"/api/v1/models\"" test/fake.log'
check "cline-auto picked the best model at startup" '[ "$(fake models sk-or-test-AAA | cut -d" " -f1)" = "fake/strong-coder:free" ]'
check "container 1 runs the cline-auto wrapper" '[ "$(nproc 1)" -ge 1 ]'
check "container 2 runs the cline-auto wrapper" '[ "$(nproc 2)" -ge 1 ]'
wait_until 40 'screen 1 | grep -q "FAKE-REPLY" && screen 2 | grep -q "FAKE-REPLY"'
check "chat 1 terminal shows the model reply" 'screen 1 | grep -q "FAKE-REPLY"'
check "chat 2 terminal shows the model reply" 'screen 2 | grep -q "FAKE-REPLY"'
check "two separate containers" '[ "$(docker ps --filter label=proxy-terminal=1 -q | wc -l)" -eq 2 ]'
PORT1=$(api GET /api/chats | python -c "import sys,json;print(json.load(sys.stdin)['chats'][0]['port'])")
check "ttyd terminal reachable on localhost (chat 1)" '[ "$(curl -s -o /dev/null -w %{http_code} localhost:$PORT1/)" = 200 ]'

echo "== follow-up message goes to the same Cline"
before=$(fake count sk-or-test-AAA one "" 1)
send 1 "second message"
wait_until 90 '[ "$(fake count sk-or-test-AAA one "" 1)" -gt '$before' ]'
check "follow-up reached the model" '[ "$(fake count sk-or-test-AAA one "" 1)" -gt '$before' ]'
check "still exactly one cline-auto in container 1" '[ "$(nproc 1)" -eq 1 ]'

echo "== network error -> cline-auto types Continue"
curl -s -X POST localhost:9999/__mode -d '{"neterr":12}' >/dev/null
send 1 "trigger a network error please"
wait_until 300 'clog 1 | grep -q "typed .Continue."'
check "cline-auto typed Continue by itself" 'clog 1 | grep -q "typed .Continue."'
curl -s -X POST localhost:9999/__mode -d '{"neterr":0}' >/dev/null
wait_until 200 '[ "$(screen 1 | grep -c FAKE-REPLY)" -ge 3 ]'
check "after the outage the task carried on and got a reply" '[ "$(screen 1 | grep -c FAKE-REPLY)" -ge 3 ]'

echo "== model disappears -> cline-auto switches model and resumes the session"
cur=$(fake models sk-or-test-AAA | tr ' ' '\n' | tail -1)
curl -s -X POST localhost:9999/__mode -d "{\"gone\":\"$cur\"}" >/dev/null
send 1 "model gone test"
wait_until 300 'clog 1 | grep -q "switching"'
check "cline-auto logged a model switch" 'clog 1 | grep -q "switching"'
wait_until 200 '[ "$(fake models sk-or-test-AAA | wc -w)" -ge 2 ]'
check "requests now go out with a different model" '[ "$(fake models sk-or-test-AAA | wc -w)" -ge 2 ]'

echo "== lifecycle"
api POST /api/chats/2/done '{"done":true}' >/dev/null
check "Done removes chat 2 container" '! docker ps -q --filter name=proxy-terminal-2 | grep -q .'
check "chat 1 container untouched" 'docker ps -q --filter name=proxy-terminal-1 | grep -q .'
api DELETE /api/chats/1 >/dev/null
check "Delete removes chat 1 container" '! docker ps -q --filter name=proxy-terminal-1 | grep -q .'

echo; echo "RESULT: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
