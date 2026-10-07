// Stand-in for openrouter.ai used by test/run-tests.sh. Logs every request to test/fake.log (JSON lines).
// Control: POST /__mode {"neterr": N, "gone": "model-id"} ; GET /__log
const http = require('http');
const fs = require('fs');
const LOG = __dirname + '/fake.log';
fs.writeFileSync(LOG, '');
const state = { neterr: 0, gone: '' };
const models = [
  ['fake/strong-coder:free', 70], ['fake/mid-coder:free', 55], ['fake/weak-coder:free', 30],
].map(([id, c]) => ({
  id, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'], context_length: 200000,
  architecture: { output_modalities: ['text'] },
  benchmarks: { artificial_analysis: { coding_index: c, agentic_index: c, intelligence_index: c } },
}));
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    const url = req.url.split('?')[0];
    if (url === '/__mode') { Object.assign(state, JSON.parse(body)); return send(res, 200, state); }
    let j = {}; try { j = JSON.parse(body); } catch {}
    const entry = { t: Date.now(), m: req.method, url, auth: (req.headers.authorization || '').replace('Bearer ', ''),
        worker: req.headers['x-worker-name'] || '', model: j.model, stream: !!j.stream, probe: !!(j.tools && JSON.stringify(j.tools).includes('"add"')) };
    fs.appendFileSync(LOG, JSON.stringify(entry) + '\n');
    if (url === '/api/v1/models') return send(res, 200, { data: models });
    if (url === '/api/v1/key') return send(res, 200, { data: { free_model_daily_requests: [1, 50] } });
    if (url === '/api/v1/chat/completions') {
        if (state.gone && j.model === state.gone) {
            return send(res, 404, { error: { code: 404, message: 'This model is unavailable for free. The paid version is available now - use this slug instead: ' + j.model.replace(':free', '') } });
        }
        if (entry.probe) {
            return send(res, 200, { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'add', arguments: '{"a":2,"b":3}' } }] } }] });
        }
        if (state.neterr > 0) { state.neterr--; return send(res, 502, { error: { code: 502, message: 'Network error: upstream connect error' } }); }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const chunk = (d, f) => res.write('data: ' + JSON.stringify({ id: 'g1', model: j.model, choices: [{ index: 0, delta: d, finish_reason: f || null }] }) + '\n\n');
        chunk({ role: 'assistant', content: '' });
        'FAKE-REPLY from '.split(' ').forEach((w) => chunk({ content: w + ' ' }));
        chunk({ content: j.model });
        chunk({}, 'stop');
        res.write('data: ' + JSON.stringify({ id: 'g1', model: j.model, choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }) + '\n\n');
        return res.end('data: [DONE]\n\n');
    }
    send(res, 404, { error: 'nope' });
}).listen(9999, '0.0.0.0', () => console.log('fake openrouter on 9999'));
