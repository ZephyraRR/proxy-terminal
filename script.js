class ChatApp {
    constructor() {
        this.chats = [];
        this.currentChatId = null;
        this.nextChatId = 1;
        this.terminal = document.getElementById('terminal');
        this.chatList = document.getElementById('chat-list');
        this.chatMessages = document.getElementById('chat-messages');
        this.chatForm = document.getElementById('chat-form');
        this.chatInput = document.getElementById('chat-input');
        this.newChatBtn = document.getElementById('new-chat-btn');
        // OpenRouter API key - INSERT YOUR KEY HERE
        this.apiKey = ''; // <-- INSERT YOUR OPENROUTER API KEY
        // Model to use (free tier)
        this.model = 'google/gemma-7b-it:free';
        // UI elements for settings
        this.apiKeyInput = null;
        this.proxyCountrySelect = null;
        this.saveSettingsBtn = null;
        this.init();
    }

    init() {
        this.newChatBtn.addEventListener('click', () => this.createChat());
        this.chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.sendMessage();
        });
        // Settings inputs
        this.apiKeyInput = document.getElementById('api-key-input');
        this.proxyCountrySelect = document.getElementById('proxy-country-select');
        this.saveSettingsBtn = document.getElementById('save-settings-btn');
        this.saveSettingsBtn.addEventListener('click', () => this.saveSettingsForCurrentChat());
        // Create initial chat
        this.createChat('New chat');
    }

    createChat(name = `New chat`) {
        const chat = {
            id: this.nextChatId++,
            name,
            messages: [],
            apiKey: '',
            proxyCountry: ''
        };
        this.chats.push(chat);
        this.switchChat(chat.id);
        this.renderChatList();
    }

    switchChat(chatId) {
        this.currentChatId = chatId;
        this.renderChatList();
        this.renderMessages();
        this.chatInput.focus();
        // Update settings UI to reflect current chat's values
        if (this.apiKeyInput) this.apiKeyInput.value = this.getCurrentChat().apiKey || '';
        if (this.proxyCountrySelect) this.proxyCountrySelect.value = this.getCurrentChat().proxyCountry || '';
    }

    renderChatList() {
        this.chatList.innerHTML = '';
        this.chats.forEach(chat => {
            const div = document.createElement('div');
            div.className = `chat-item${chat.id === this.currentChatId ? ' active' : ''}${chat.done ? ' done' : ''}`;
            div.innerHTML = `
                <span class="chat-name">${chat.name}</span>
                <div class="chat-controls">
                    <label class="done-label">
                        <input type="checkbox" ${chat.done ? 'checked' : ''}>
                        Done
                    </label>
                    <button class="trash-btn" title="Delete chat">🗑️</button>
                </div>
            `;
            // Attach event listeners
            const checkbox = div.querySelector('input[type="checkbox"]');
            checkbox.addEventListener('change', (e) => {
                this.toggleDone(chat.id);
                e.stopPropagation(); // prevent triggering switchChat
            });
            const trashBtn = div.querySelector('.trash-btn');
            trashBtn.addEventListener('click', (e) => {
                this.deleteChat(chat.id);
                e.stopPropagation(); // prevent triggering switchChat
            });
            div.addEventListener('click', () => this.switchChat(chat.id));
            this.chatList.appendChild(div);
        });
    }

    renderMessages() {
        this.chatMessages.innerHTML = '';
        const chat = this.getCurrentChat();
        if (!chat) return;

        chat.messages.forEach(msg => {
            const div = document.createElement('div');
            div.className = `message ${msg.sender}`;
            div.textContent = msg.text;
            this.chatMessages.appendChild(div);
        });
        // Scroll to bottom
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }
    getCurrentChat() {
        return this.chats.find(c => c.id === this.currentChatId);
    }

    saveSettingsForCurrentChat() {
        const chat = this.getCurrentChat();
        if (!chat) return;
        chat.apiKey = this.apiKeyInput ? this.apiKeyInput.value.trim() : '';
        chat.proxyCountry = this.proxyCountrySelect ? this.proxyCountrySelect.value.trim() : '';
        this.appendToTerminal(`[Settings] Saved API key and proxy country for chat ${chat.id}\n`);
    }

    toggleDone(chatId) {
        const chat = this.chats.find(c => c.id === chatId);
        if (chat) {
            chat.done = !chat.done;
            this.renderChatList();
        }
    }

    deleteChat(chatId) {
        if (this.chats.length <= 1) {
            // Prevent deleting the last chat
            return;
        }
        const index = this.chats.findIndex(c => c.id === chatId);
        if (index !== -1) {
            this.chats.splice(index, 1);
            // If deleted chat was current, switch to another
            if (this.currentChatId === chatId) {
                const newCurrent = this.chats[Math.min(index, this.chats.length - 1)];
                this.switchChat(newCurrent.id);
            }
            this.renderChatList();
            this.renderMessages();
        }
    }
    async sendMessage() {
        const text = this.chatInput.value.trim();
        if (!text) return;
        const chat = this.getCurrentChat();
        if (!chat) return;

        // Add user message
        chat.messages.push({ text, sender: 'user' });
        // If this is the first message, set chat name to truncated text
        if (chat.messages.length === 1) {
            const truncated = text.length > 30 ? text.slice(0, 30) + '...' : text;
            chat.name = truncated;
            this.renderChatList(); // update name in sidebar
        }
        this.chatInput.value = '';
        this.renderMessages();
        this.chatInput.focus();

        // Determine which API key to use
        const apiKeyToUse = chat.apiKey ? chat.apiKey : this.apiKey;
        if (!apiKeyToUse) {
            this.appendToTerminal('[Error] No API key configured. Please set API key in settings.\n\n');
            chat.messages.push({ text: 'Error: No API key configured', sender: 'bot' });
            this.renderMessages();
            return;
        }
        // Proxy label for logging
        const proxyLabel = chat.proxyCountry || 'global';

        // Show loading indicator in terminal
        this.appendToTerminal(`[${proxyLabel}] Sending request to ${this.model}...\n`);

        try {
            const fullResponse = await this.callAPIStream(text, apiKeyToUse, proxyLabel);
            // After stream completes, add final bot message (optional)
            const botMessage = fullResponse.trim() || '(no response)';
            chat.messages.push({ text: botMessage, sender: 'bot' });
            this.renderMessages();
            this.appendToTerminal(`[${proxyLabel}] Request completed.\n\n`);
        } catch (error) {
            this.appendToTerminal(`[${proxyLabel}] Error: ${error.message}\n\n`);
            chat.messages.push({ text: `Error: ${error.message}`, sender: 'bot' });
            this.renderMessages();
        }
    }
    /**
     * Call OpenRouter API with streaming and retry logic.
     * @param {string} prompt 
     * @param {string} apiKey 
     * @param {string} proxyLabel 
     * @returns {Promise<string>} accumulated response text
     */
    async callAPIStream(prompt, apiKey, proxyLabel) {
        const maxRetries = 2;
        let attempt = 0;
        while (attempt <= maxRetries) {
            try {
                return await this.fetchStream(prompt, apiKey, proxyLabel);
            } catch (err) {
                attempt++;
                if (attempt > maxRetries) throw err;
                // wait a bit before retry
                await new Promise(res => setTimeout(res, 500 * attempt));
                this.appendToTerminal(`[${proxyLabel}] Retry ${attempt}/${maxRetries} after error: ${err.message}\n`);
            }
        }
        // Should not reach here
        throw new Error('Failed after retries');
    }

    /**
     * Perform streaming request to OpenRouter.
     * @param {string} prompt
     * @param {string} apiKey
     * @param {string} proxyLabel
     * @returns {Promise<string>}
     */
    async fetchStream(prompt, apiKey, proxyLabel) {
        const url = 'https://openrouter.ai/api/v1/chat/completions';
        const body = {
            model: this.model,
            messages: [{ role: 'user', content: prompt }],
            stream: true,
            temperature: 0.7,
            max_tokens: 1000
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                // Optional: provide referer for openrouter stats
                'HTTP-Referer': 'https://proxy-terminal.local',
                'X-Title': 'Proxy Terminal Chat'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        if (!response.body) {
            throw new Error('No readable stream from response');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let accumulated = '';
        let buffer = '';

        // Read chunks
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            // Split by newline to process SSE lines
            let lines = buffer.split('\n');
            // Keep last incomplete line in buffer
            buffer = lines.pop() || '';
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') {
                        // End of stream
                        reader.cancel();
                        return accumulated;
                    }
                    try {
                        const json = JSON.parse(data);
                        const delta = json.choices?.[0]?.delta?.content;
                        if (delta) {
                            accumulated += delta;
                            // Write delta to terminal in real-time
                            this.terminal.value += delta;
                            this.terminal.scrollTop = this.terminal.scrollHeight;
                        }
                    } catch (e) {
                        // Ignore parsing errors
                    }
                }
            }
        }
        // If any leftover buffer
        if (buffer) {
            // try to parse if it's a complete line
            if (buffer.startsWith('data: ')) {
                const data = buffer.slice(6);
                if (data !== '[DONE]') {
                    try {
                        const json = JSON.parse(data);
                        const delta = json.choices?.[0]?.delta?.content;
                        if (delta) {
                            accumulated += delta;
                            this.terminal.value += delta;
                            this.terminal.scrollTop = this.terminal.scrollHeight;
                        }
                    } catch (e) { /* ignore */ }
                }
            }
        }
        return accumulated;
    }

    appendToTerminal(text) {
        this.terminal.value += text + '\\n\\n';
        this.terminal.scrollTop = this.terminal.scrollHeight;
    }
}

// Initialize app when DOM loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new ChatApp();
});