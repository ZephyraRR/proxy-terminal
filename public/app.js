const $ = (id) => document.getElementById(id);
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let chats = [], countries = [], current = null, shownPort = null, editing = false;

async function call(method, url, body) {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return r.json();
}
const cur = () => chats.find((c) => c.id === current);

async function refresh() {
    const data = await call('GET', '/api/chats');
    chats = data.chats;
    if (!countries.length) {
        countries = data.countries;
        $('proxy-country-select').innerHTML = countries.map((c) => `<option>${esc(c)}</option>`).join('');
    }
    if (!cur()) {
        if (!chats.length) chats.push(await call('POST', '/api/chats'));
        current = chats[0].id;
        editing = false;
    }
    render();
}

function render() {
    $('chat-list').innerHTML = '';
    chats.forEach((chat) => {
        const div = document.createElement('div');
        div.className = `chat-item${chat.id === current ? ' active' : ''}${chat.done ? ' done' : ''}`;
        div.innerHTML = `<span class="chat-name">${esc(chat.name)}</span>
            <div class="chat-controls">
                <label class="done-label"><input type="checkbox" ${chat.done ? 'checked' : ''}> Done</label>
                <button class="trash-btn" title="Delete chat">🗑️</button>
            </div>`;
        const box = div.querySelector('input');
        box.addEventListener('click', (e) => e.stopPropagation());
        box.addEventListener('change', async () => { await call('POST', `/api/chats/${chat.id}/done`, { done: box.checked }); refresh(); });
        div.querySelector('.trash-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            await call('DELETE', `/api/chats/${chat.id}`);
            refresh();
        });
        div.addEventListener('click', () => { current = chat.id; editing = false; render(); });
        $('chat-list').appendChild(div);
    });
    const chat = cur();
    if (!chat) return;
    $('chat-messages').innerHTML = chat.messages.map((m) => `<div class="message ${m.sender === 'user' ? 'user' : 'bot'}">${esc(m.text)}</div>`).join('');
    $('chat-messages').scrollTop = $('chat-messages').scrollHeight;
    $('chat-status').textContent = chat.status + (chat.hasKey ? '' : ' - no API key');
    const frame = $('terminal');
    const port = chat.status === 'running' ? chat.port : null;
    if (port !== shownPort) {
        shownPort = port;
        frame.hidden = !port;
        $('terminal-placeholder').hidden = !!port;
        frame.src = port ? `http://127.0.0.1:${port}/` : 'about:blank';
    }
    if (!port) {
        $('terminal-placeholder').textContent = chat.status === 'starting'
            ? 'Starting container...'
            : 'Send a message: a new container with its own Cline starts here.';
    }
    if (!editing) {
        $('api-key-input').placeholder = chat.hasKey ? 'API key saved (type to replace)' : 'OpenRouter API key';
        $('api-key-input').value = '';
        $('proxy-country-select').value = chat.country;
        $('model-input').value = chat.model || '';
    }
}

['api-key-input', 'proxy-country-select', 'model-input'].forEach((id) => $(id).addEventListener('input', () => { editing = true; }));
$('save-settings-btn').addEventListener('click', async () => {
    await call('PUT', `/api/chats/${current}/settings`, { apiKey: $('api-key-input').value, country: $('proxy-country-select').value, model: $('model-input').value });
    editing = false;
    refresh();
});
$('new-chat-btn').addEventListener('click', async () => { current = (await call('POST', '/api/chats')).id; editing = false; refresh(); });
$('chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('chat-input').value.trim();
    if (!text) return;
    $('chat-input').value = '';
    await call('POST', `/api/chats/${current}/message`, { text });
    refresh();
});

refresh();
setInterval(refresh, 2000);
