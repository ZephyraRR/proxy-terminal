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
        this.model = 'mistralai/mistral-7b-instruct:free';

        this.init();
    }

    init() {
        this.newChatBtn.addEventListener('click', () => this.createChat());
        this.chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.sendMessage();
        });

        // Create initial chat
        this.createChat('Chat 1');
    }

    createChat(name = `New chat`) {
        const chat = {
            id: this.nextChatId++,
            name,
            messages: [],
            done: false,
            proxy: `proxy${this.nextChatId}`
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
    }

    renderChatList() {
        this.chatList.innerHTML = '';
        this.chats.forEach(chat => {
            const div = document.createElement('div');
            div.className = `chat-item${chat.id === this.currentChatId ? ' active' : ''}${chat.done ? ' done' : ''}`;
            div.innerHTML = `
                <span class="chat-name">${chat.name}</span>
                <label class="done-label">
                    <input type="checkbox" ${chat.done ? 'checked' : ''}>
                    <span>Done</span>
                </label>
            `;
            // Attach event listeners
            const checkbox = div.querySelector('input[type="checkbox"]');
            checkbox.addEventListener('change', (e) => {
                this.toggleDone(chat.id);
                e.stopPropagation(); // prevent triggering switchChat
            });
            div.addEventListener('click', () => this.switchChat(chat.id));
            this.chatList.appendChild(div);
        });
    }

    toggleDone(chatId) {
        const chat = this.chats.find(c => c.id === chatId);
        if (chat) {
            chat.done = !chat.done;
            this.renderChatList();
        }
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

        // Show loading indicator in terminal? We'll just start streaming.
        this.appendToTerminal(`[${chat.proxy}] Sending request to ${this.model}...\n`);

        try {
            const fullResponse = await this.callAPIStream(text, chat.proxy);
            // After stream completes, add final bot message (optional)
            const botMessage = fullResponse.trim() || '(no response)';
            chat.messages.push({ text: botMessage, sender: 'bot' });
            this.renderMessages();
            this.appendToTerminal(`[${chat.proxy}] Request completed.\n\n`);
        } catch (error) {
            this.appendToTerminal(`[${chat.proxy}] Error: ${error.message}\n\n`);
            chat.messages.push({ text: `Error: ${error.message}`, sender: 'bot' });
            this.renderMessages();
        }
    }

    /**
     * Call OpenRouter API with streaming and retry logic.
     * @param {string} prompt 
     * @param {string} proxyLabel 
     * @returns {Promise<string>} accumulated response text
     */
    async callAPIStream(prompt, proxyLabel) {
        const maxRetries = 2;
        let attempt = 0;
        while (attempt <= maxRetries) {
            try {
                return await this.fetchStream(prompt, proxyLabel);
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
     * @param {string} proxyLabel
     * @returns {Promise<string>}
     */
    async fetchStream(prompt, proxyLabel) {
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
                'Authorization': `Bearer ${this.apiKey}`,
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
                            this.appendToTerminal(delta);
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
                            this.appendToTerminal(delta);
                        }
                    } catch (e) { /* ignore */ }
                }
            }
        }
        return accumulated;
    }

    appendToTerminal(text) {
        this.terminal.value += text + '\n\n';
        this.terminal.scrollTop = this.terminal.scrollHeight;
    }
}

// Initialize app when DOM loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new ChatApp();
});