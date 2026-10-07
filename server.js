// proxy-terminal backend (no dependencies, needs Docker).
// Every chat gets its own container: isolated Cline (+ `cline auth` with that chat's API key) behind ttyd/tmux.
// Messages sent in the chat are typed into that container's Cline. Traffic to OpenRouter goes through a
// Cloudflare Worker (config.json -> workers[country]) via Cline's base URL.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PORT = +process.env.PORT || 3100;
const HOST = '127.0.0.1';
const ROOT = __dirname;
const STATE_FILE = path.join(ROOT, 'state.json');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const config = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const docker = (...args) => new Promise((resolve, reject) =>
    execFile('docker', args, { maxBuffer: 8 << 20 }, (err, out, errout) =>
        err ? reject(new Error((errout || err.message).trim())) : resolve(out.trim())));

// ---- state ---------------------------------------------------------------------------------------------------
let state = { next: 1, chats: [] };
try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { /* first run */ }
const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));
const find = (id) => state.chats.find((c) => c.id === +id);
const cname = (c) => `proxy-terminal-${c.id}`;
const publicChat = ({ apiKey, ...c }) => ({ ...c, hasKey: !!apiKey });

// ---- containers ----------------------------------------------------------------------------------------------
const pane = (chat) => docker('exec', cname(chat), 'tmux', 'capture-pane', '-p', '-t', 'main');

// Cline's TUI drops keys typed while it is still starting, so retype until the text shows up in the pane.
async function type(chat, text) {
    const probe = text.slice(0, 12);
    for (let i = 0; i < 15; i++) {
        // a promo modal ("Open ClinePass ... any other key to close") can cover the prompt: close it with Escape
        if ((await pane(chat)).includes('any other key to close')) {
            await docker('exec', cname(chat), 'tmux', 'send-keys', '-t', 'main', 'Escape');
            await sleep(500);
        }
        await docker('exec', cname(chat), 'tmux', 'send-keys', '-t', 'main', '-l', text);
        await sleep(1000);
        if ((await pane(chat)).includes(probe)) break;
        await sleep(2000);
    }
    await docker('exec', cname(chat), 'tmux', 'send-keys', '-t', 'main', 'Enter');
}

async function ensureContainer(chat) {
    if (chat.status === 'running' && chat.port) return;
    if (!chat.apiKey) throw new Error('No API key set for this chat (Save Settings first).');
    const cfg = config();
    const base = cfg.workers[chat.country] || cfg.workers.Default || '';
    chat.status = 'starting'; chat.port = null; save();
    await docker('rm', '-f', cname(chat)).catch(() => {});
    const ws = path.join(ROOT, 'workspaces', String(chat.id));
    fs.mkdirSync(ws, { recursive: true });
    await docker('run', '-d', '--name', cname(chat), '--label', 'proxy-terminal=1',
        '-p', '127.0.0.1::7681', '-v', `${ws}:/workspace`,
        '-e', `API_KEY=${chat.apiKey}`, '-e', `MODEL=${chat.model || cfg.model || ''}`, '-e', `BASE_URL=${base}`,
        cfg.image);
    const mapped = await docker('port', cname(chat), '7681/tcp');
    chat.port = +mapped.split('\n')[0].split(':').pop();
    for (let i = 0; i < 60; i++) {          // wait until Cline's screen is drawn in the tmux session
        await sleep(1000);
        const screen = await pane(chat).catch(() => '');
        if (/Ask anything|What can I do/.test(screen)) break;
    }
    await sleep(2000);
    chat.status = 'running'; save();
}

async function removeContainer(chat) {
    await docker('rm', '-f', cname(chat)).catch(() => {});
    chat.status = 'stopped'; chat.port = null; save();
}

// Like cline-auto: if Cline sits on a "Network error" and the screen has not moved, type Continue.
const lastScreen = new Map();
setInterval(async () => {
    for (const chat of state.chats.filter((c) => c.status === 'running')) {
        try {
            const s = await pane(chat);
            const prev = lastScreen.get(chat.id);
            const since = prev && prev.s === s ? prev.since : Date.now();
            lastScreen.set(chat.id, { s, since });
            const tail = s.split('\n').slice(-15).join('\n');
            if (Date.now() - since > 8000 && /network (error|connection)|upstream error|overloaded/i.test(tail)) {
                await type(chat, 'Continue');
                lastScreen.set(chat.id, { s, since: Date.now() + 20000 });
            }
        } catch { /* container gone */ }
    }
}, 4000);

// ---- http ----------------------------------------------------------------------------------------------------
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const readBody = async (req) => { let b = ''; for await (const c of req) b += c; return b ? JSON.parse(b) : {}; };

async function api(req, res, url) {
    const m = url.match(/^\/api\/chats(?:\/(\d+))?(?:\/(\w+))?$/);
    if (!m) return json(res, 404, { error: 'not found' });
    const [, id, action] = m;
    if (!id) {
        if (req.method === 'GET') return json(res, 200, { chats: state.chats.map(publicChat), countries: Object.keys(config().workers) });
        if (req.method === 'POST') {
            const chat = { id: state.next++, name: 'New chat', apiKey: '', country: 'Default', model: '', status: 'stopped', port: null, messages: [], done: false };
            state.chats.push(chat); save();
            return json(res, 200, publicChat(chat));
        }
    }
    const chat = find(id);
    if (!chat) return json(res, 404, { error: 'no such chat' });
    if (req.method === 'DELETE') {
        await removeContainer(chat);
        state.chats = state.chats.filter((c) => c !== chat); save();
        return json(res, 200, {});
    }
    if (req.method !== 'POST' && req.method !== 'PUT') return json(res, 405, {});
    const body = await readBody(req);
    if (action === 'settings') {
        if (typeof body.apiKey === 'string' && body.apiKey) chat.apiKey = body.apiKey.trim();
        if (typeof body.country === 'string') chat.country = body.country;
        if (typeof body.model === 'string') chat.model = body.model.trim();
        save();
        return json(res, 200, publicChat(chat));
    }
    if (action === 'done') {
        chat.done = !!body.done; save();
        if (chat.done) await removeContainer(chat);
        return json(res, 200, publicChat(chat));
    }
    if (action === 'message') {
        const text = String(body.text || '').trim();
        if (!text) return json(res, 400, { error: 'empty' });
        chat.messages.push({ sender: 'user', text });
        if (chat.messages.length === 1) chat.name = text.length > 30 ? text.slice(0, 30) + '...' : text;
        save();
        json(res, 202, publicChat(chat));           // starting/typing continues in the background; the UI polls status
        try {
            await ensureContainer(chat);
            await type(chat, text);
        } catch (e) {
            chat.status = 'error'; chat.messages.push({ sender: 'system', text: `Error: ${e.message}` }); save();
        }
        return;
    }
    return json(res, 404, { error: 'unknown action' });
}

http.createServer(async (req, res) => {
    const url = req.url.split('?')[0];
    try {
        if (url.startsWith('/api/')) return await api(req, res, url);
        const file = url === '/' ? '/index.html' : url;
        const pub = path.join(ROOT, 'public');
        const full = path.join(pub, path.normalize(file));
        if (!full.startsWith(pub) || !fs.existsSync(full)) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(full)] || 'text/plain' });
        fs.createReadStream(full).pipe(res);
    } catch (e) {
        if (!res.headersSent) json(res, 500, { error: e.message });
    }
}).listen(PORT, HOST, async () => {
    console.log(`proxy-terminal on http://${HOST}:${PORT}`);
    // containers of a previous run are not tracked any more: clear them
    const old = await docker('ps', '-aq', '--filter', 'label=proxy-terminal=1').catch(() => '');
    if (old) await docker('rm', '-f', ...old.split('\n')).catch(() => {});
    state.chats.forEach((c) => { c.status = 'stopped'; c.port = null; });
    save();
});
