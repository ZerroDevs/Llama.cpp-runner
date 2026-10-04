document.addEventListener('DOMContentLoaded', () => {
    const chatMessages = document.getElementById('chat-messages');
    const chatInput = document.getElementById('chat-input');
    const btnSend = document.getElementById('btn-send-chat');
    const btnClear = document.getElementById('btn-clear-chat');
    
    const sysPromptInput = document.getElementById('chat-system-prompt');
    const tempInput = document.getElementById('chat-temp');
    const tempLabel = document.getElementById('lbl-temp');
    const tokensInput = document.getElementById('chat-tokens');
    const tokensLabel = document.getElementById('lbl-tokens');
    
    const personaIdea = document.getElementById('persona-idea');
    const btnGeneratePersona = document.getElementById('btn-generate-persona');
    
    // Markdown configuration
    if (window.marked && window.hljs) {
        marked.setOptions({
            highlight: function(code, lang) {
                const language = hljs.getLanguage(lang) ? lang : 'plaintext';
                return hljs.highlight(code, { language }).value;
            },
            langPrefix: 'hljs language-'
        });
    }

    let messageHistory = [];

    // UI Updates for sliders
    tempInput.addEventListener('input', () => {
        tempLabel.innerText = tempInput.value;
    });
    
    tokensInput.addEventListener('input', () => {
        tokensLabel.innerText = tokensInput.value == "-1" ? "Infinite" : tokensInput.value;
    });

    function getBaseUrl() {
        if (!appConfig) return "http://127.0.0.1:8080/v1";
        const host = appConfig.host === '0.0.0.0' ? '127.0.0.1' : appConfig.host;
        return `http://${host}:${appConfig.port}/v1`;
    }
    
    function addMessageToUI(role, content) {
        const wrap = document.createElement('div');
        wrap.className = role === 'user' ? 'flex gap-3 max-w-[85%] ml-auto flex-row-reverse' : 'flex gap-3 max-w-[85%]';
        
        const avatar = document.createElement('div');
        avatar.className = role === 'user' ? 'w-8 h-8 rounded-full bg-sec/20 flex items-center justify-center shrink-0 mt-1' : 'w-8 h-8 rounded-full bg-brand/20 flex items-center justify-center shrink-0 mt-1';
        avatar.innerHTML = role === 'user' ? '<i data-lucide="user" class="w-4 h-4 text-sec"></i>' : '<i data-lucide="bot" class="w-4 h-4 text-brand"></i>';
        
        const bubble = document.createElement('div');
        bubble.className = role === 'user' 
            ? 'bg-sec text-white border border-sec p-3 rounded-2xl rounded-tr-sm text-sm'
            : 'bg-card border border-border p-3 rounded-2xl rounded-tl-sm text-sm markdown-body overflow-hidden';
            
        if (role === 'user') {
            bubble.innerText = content;
        } else {
            bubble.innerHTML = window.marked ? marked.parse(content) : content;
        }
        
        wrap.appendChild(avatar);
        wrap.appendChild(bubble);
        chatMessages.appendChild(wrap);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        
        if (window.lucide) lucide.createIcons({root: wrap});
        return bubble;
    }
    
    async function sendMessage() {
        const text = chatInput.value.trim();
        if (!text) return;
        
        if (document.getElementById('status-text').innerText !== 'Running') {
            window.showToast("Please start the server first!");
            return;
        }
        
        chatInput.value = '';
        addMessageToUI('user', text);
        messageHistory.push({ role: 'user', content: text });
        
        const assistantBubble = addMessageToUI('assistant', '<i data-lucide="loader" class="w-4 h-4 animate-spin text-textMuted"></i>');
        
        btnSend.disabled = true;
        chatInput.disabled = true;
        
        // Build payload
        const messages = [];
        if (sysPromptInput.value.trim()) {
            messages.push({ role: 'system', content: sysPromptInput.value.trim() });
        }
        messages.push(...messageHistory);
        
        const payload = {
            messages: messages,
            temperature: parseFloat(tempInput.value),
            stream: true
        };
        
        const maxTokens = parseInt(tokensInput.value);
        if (maxTokens > 0) payload.max_tokens = maxTokens;
        
        try {
            const response = await fetch(`${getBaseUrl()}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${appConfig.api_key || 'sk-no-key'}`
                },
                body: JSON.stringify(payload)
            });
            
            if (!response.ok) {
                throw new Error("Server responded with " + response.status);
            }
            
            assistantBubble.innerHTML = '';
            let fullResponse = '';
            
            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let done = false;
            
            while (!done) {
                const { value, done: readerDone } = await reader.read();
                done = readerDone;
                if (value) {
                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split('\n');
                    for (const line of lines) {
                        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                            try {
                                const data = JSON.parse(line.substring(6));
                                if (data.choices[0].delta && data.choices[0].delta.content) {
                                    fullResponse += data.choices[0].delta.content;
                                    assistantBubble.innerHTML = window.marked ? marked.parse(fullResponse) : fullResponse;
                                    chatMessages.scrollTop = chatMessages.scrollHeight;
                                }
                            } catch (e) {}
                        }
                    }
                }
            }
            messageHistory.push({ role: 'assistant', content: fullResponse });
            
        } catch (e) {
            assistantBubble.innerHTML = `<span class="text-red-500">Error: ${e.message}</span>`;
            messageHistory.pop(); // Remove user message from history so they can try again
        } finally {
            btnSend.disabled = false;
            chatInput.disabled = false;
            chatInput.focus();
        }
    }
    
    btnSend.addEventListener('click', sendMessage);
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    btnClear.addEventListener('click', () => {
        messageHistory = [];
        chatMessages.innerHTML = `
            <div class="flex gap-3 max-w-[85%]">
                <div class="w-8 h-8 rounded-full bg-brand/20 flex items-center justify-center shrink-0 mt-1">
                    <i data-lucide="bot" class="w-4 h-4 text-brand"></i>
                </div>
                <div class="bg-card border border-border p-3 rounded-2xl rounded-tl-sm text-sm">
                    Chat cleared. How can I help?
                </div>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
    });
    
    // Auto-Generate Persona Feature
    btnGeneratePersona.addEventListener('click', async () => {
        const idea = personaIdea.value.trim();
        if (!idea) {
            window.showToast("Please enter a persona idea first!");
            return;
        }
        
        if (document.getElementById('status-text').innerText !== 'Running') {
            window.showToast("Please start the server first! I need the AI to generate the persona.");
            return;
        }
        
        btnGeneratePersona.disabled = true;
        const originalHtml = btnGeneratePersona.innerHTML;
        btnGeneratePersona.innerHTML = '<i data-lucide="loader" class="w-3 h-3 animate-spin"></i>';
        if (window.lucide) lucide.createIcons();
        
        sysPromptInput.value = "";
        
        try {
            const prompt = `You are an expert prompt engineer and persona creator. 
The user wants you to write a "System Prompt" to force an AI model to adopt the following persona/behavior: "${idea}".
Write ONLY the exact text of the system prompt. Do not include any introductions, explanations, or quotes. Write in the second person ("You are..."). Be highly detailed and strict.`;

            const response = await fetch(`${getBaseUrl()}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${appConfig.api_key || 'sk-no-key'}`
                },
                body: JSON.stringify({
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.7,
                    max_tokens: 500,
                    stream: true
                })
            });
            
            if (!response.ok) throw new Error("Server error");
            
            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let done = false;
            let firstChunk = true;
            
            while (!done) {
                const { value, done: readerDone } = await reader.read();
                done = readerDone;
                if (value) {
                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split('\n');
                    for (const line of lines) {
                        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                            try {
                                const data = JSON.parse(line.substring(6));
                                if (data.choices[0].delta && data.choices[0].delta.content) {
                                    let content = data.choices[0].delta.content;
                                    // Remove leading quotes if they exist
                                    if (firstChunk && content.startsWith('"')) {
                                        content = content.substring(1);
                                    }
                                    firstChunk = false;
                                    sysPromptInput.value += content;
                                }
                            } catch (e) {}
                        }
                    }
                }
            }
            
            // Cleanup trailing quote
            if (sysPromptInput.value.trim().endsWith('"')) {
                sysPromptInput.value = sysPromptInput.value.trim().slice(0, -1);
            }
            
            if (!sysPromptInput.value.trim()) {
                window.showToast("The model returned an empty response. Try a different idea.");
            } else {
                window.showToast("Persona generated successfully!");
            }
            
        } catch (e) {
            sysPromptInput.value = "";
            window.showToast("Failed to generate persona.");
        } finally {
            btnGeneratePersona.disabled = false;
            btnGeneratePersona.innerHTML = originalHtml;
            if (window.lucide) lucide.createIcons();
        }
    });
    
    // Update model name dynamically
    setInterval(() => {
        if (!appConfig) return;
        const modelNameEl = document.getElementById('chat-model-name');
        if (document.getElementById('status-text').innerText === 'Running') {
            const pathParts = appConfig.model_path ? appConfig.model_path.split('\\') : [];
            const name = pathParts.length > 0 ? pathParts[pathParts.length - 1] : "Unknown Model";
            if (modelNameEl) modelNameEl.innerText = name;
        } else {
            if (modelNameEl) modelNameEl.innerText = "No model loaded";
        }
    }, 2000);
});
