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

    createChat(name = `Chat ${this.nextChatId}`) {
        const chat = {
            id: this.nextChatId++,
            name,
            messages: []
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
            div.className = `chat-item${chat.id === this.currentChatId ? ' active' : ''}`;
            div.textContent = chat.name;
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

    async sendMessage() {
        const text = this.chatInput.value.trim();
        if (!text) return;
        const chat = this.getCurrentChat();
        if (!chat) return;

        // Add user message
        chat.messages.push({ text, sender: 'user' });
        this.chatInput.value = '';
        this.renderMessages();

        // Show loading indicator? For simplicity, we'll just call API and then add bot message.
        try {
            const response = await this.callAPI(text);
            // Extract something from response to display in terminal
            const terminalText = JSON.stringify(response, null, 2);
            this.appendToTerminal(terminalText);

            // Add bot message (we can use a snippet from response)
            const botText = typeof response === 'string' ? response : (response.args?.text || JSON.stringify(response));
            chat.messages.push({ text: botText, sender: 'bot' });
            this.renderMessages();
        } catch (error) {
            this.appendToTerminal(`Error: ${error.message}`);
            chat.messages.push({ text: `Error: ${error.message}`, sender: 'bot' });
            this.renderMessages();
        }
    }

    async callAPI(text) {
        // Using a free echo service; you can replace with any API endpoint.
        const url = `https://httpbin.org/anything?text=${encodeURIComponent(text)}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return await response.json();
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