// Zero-dependency backend: serves the UI and relays /api/chat to OpenRouter,
// optionally through the HTTP proxy configured for the chat's country in proxies.json
// (values like "host:port" or "user:pass@host:port"; empty = direct connection).
const http = require('http');
const https = require('https');
const tls = require('tls');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const UPSTREAM = { host: 'openrouter.ai', path: '/api/v1/chat/completions' };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const STATIC = new Set(['/index.html', '/script.js', '/style.css']);

function loadProxies() {
    try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'proxies.json'), 'utf8')); }
    catch { return {}; }
}

// Open a TLS socket to openrouter.ai:443 through an HTTP CONNECT proxy.
function tunnel(proxy) {
    return new Promise((resolve, reject) => {
        const m = proxy.match(/^(?:([^@]+)@)?([^:]+):(\d+)$/);
        if (!m) return reject(new Error(`Bad proxy entry: ${proxy}`));
        const headers = { Host: `${UPSTREAM.host}:443` };
        if (m[1]) headers['Proxy-Authorization'] = 'Basic ' + Buffer.from(m[1]).toString('base64');
        const req = http.request({ host: m[2], port: +m[3], method: 'CONNECT', path: `${UPSTREAM.host}:443`, headers });
        req.setTimeout(15000, () => req.destroy(new Error('Proxy connect timeout')));
        req.on('connect', (res, socket) => {
            if (res.statusCode !== 200) { socket.destroy(); return reject(new Error(`Proxy returned ${res.statusCode}`)); }
            resolve(tls.connect({ socket, servername: UPSTREAM.host }));
        });
        req.on('error', reject);
        req.end();
    });
}

async function relay(req, res) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const country = req.headers['x-proxy-country'] || '';
    const proxy = country ? loadProxies()[country] : '';
    if (country && !proxy) console.log(`[${country}] no proxy configured in proxies.json, connecting directly`);

    const opts = {
        host: UPSTREAM.host, path: UPSTREAM.path, method: 'POST',
        headers: {
            'Authorization': req.headers['authorization'] || '',
            'Content-Type': 'application/json',
            'Content-Length': body.length,
            'HTTP-Referer': 'https://proxy-terminal.local',
            'X-Title': 'Proxy Terminal Chat'
        }
    };
    try {
        if (proxy) { const socket = await tunnel(proxy); opts.createConnection = () => socket; opts.agent = false; }
    } catch (e) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        return res.end(`Proxy error: ${e.message}`);
    }
    const up = https.request(opts, (ur) => {
        res.writeHead(ur.statusCode, { 'Content-Type': ur.headers['content-type'] || 'text/plain', 'Cache-Control': 'no-cache' });
        ur.pipe(res);
    });
    up.on('error', (e) => {
        if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end(`Upstream error: ${e.message}`);
    });
    res.on('close', () => up.destroy());
    up.end(body);
}

http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (req.method === 'POST' && url === '/api/chat') return relay(req, res);
    const file = url === '/' ? '/index.html' : url;
    if (req.method === 'GET' && STATIC.has(file)) {
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'text/plain' });
        return fs.createReadStream(path.join(__dirname, file)).pipe(res);
    }
    res.writeHead(404); res.end('Not found');
}).listen(PORT, HOST, () => console.log(`proxy-terminal on http://${HOST}:${PORT}`));
