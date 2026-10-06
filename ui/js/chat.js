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
    
    const personaPresets = document.getElementById('persona-presets');
    const btnSavePersona = document.getElementById('btn-save-persona');
    const btnDeletePersona = document.getElementById('btn-delete-persona');
    
    // Markdown configuration
    if (window.marked && window.hljs) {
        const renderer = new marked.Renderer();
        renderer.code = function(arg1, arg2) {
            let code = arg1;
            let language = arg2;
            // Handle Marked.js v13+ token object signature
            if (typeof arg1 === 'object' && arg1 !== null) {
                code = arg1.text || '';
                language = arg1.lang || '';
            }
            
            const validLanguage = (language && window.hljs.getLanguage(language)) ? language : 'plaintext';
            let highlighted = code;
            
            try {
                if (validLanguage !== 'plaintext') {
                    highlighted = window.hljs.highlight(code, { language: validLanguage }).value;
                } else {
                    highlighted = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                }
            } catch (e) {
                highlighted = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            }
            
            const encoded = encodeURIComponent(code).replace(/'/g, "\\'");
            
            return `
            <div class="my-4 rounded-md overflow-hidden bg-[#1e1e1e] border border-border/50 shadow-sm">
                <div class="flex items-center justify-between px-4 py-2 bg-[#2d2d2d] text-xs text-textMuted select-none border-b border-border/30">
                    <span class="font-mono uppercase tracking-wider">${validLanguage}</span>
                    <button class="hover:text-white transition-colors flex items-center gap-1.5" onclick="navigator.clipboard.writeText(decodeURIComponent('${encoded}')); this.innerHTML='<i data-lucide=\\'check\\' class=\\'w-3 h-3\\'></i> Copied'; setTimeout(()=>this.innerHTML='<i data-lucide=\\'copy\\' class=\\'w-3 h-3\\'></i> Copy', 2000);">
                        <i data-lucide="copy" class="w-3 h-3"></i> Copy
                    </button>
                </div>
                <div class="p-4 overflow-x-auto text-sm">
                    <pre><code class="hljs language-${validLanguage}">${highlighted}</code></pre>
                </div>
            </div>`;
        };
        
        marked.setOptions({
            renderer: renderer,
            langPrefix: 'hljs language-'
        });
    }

    let messageHistory = [];

    window.addEventListener('pywebviewready', () => {
        loadPersonaPresets();
    });

    function loadPersonaPresets() {
        if (!appConfig.persona_presets) {
            appConfig.persona_presets = {
                "Default Assistant": "You are a helpful AI assistant."
            };
        }
        
        personaPresets.innerHTML = '<option value="">-- Presets --</option>';
        for (const [name, content] of Object.entries(appConfig.persona_presets)) {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            personaPresets.appendChild(opt);
        }
    }

    personaPresets.addEventListener('change', () => {
        const name = personaPresets.value;
        if (name && appConfig.persona_presets && appConfig.persona_presets[name]) {
            sysPromptInput.value = appConfig.persona_presets[name];
        }
    });

    btnSavePersona.addEventListener('click', async () => {
        const content = sysPromptInput.value.trim();
        if (!content) return;
        
        let name = personaPresets.value;
        if (!name) {
            name = prompt("Enter a name for this persona preset:");
            if (!name) return;
        }
        
        if (!appConfig.persona_presets) appConfig.persona_presets = {};
        appConfig.persona_presets[name] = content;
        await window.pywebview.api.save_config(appConfig);
        
        loadPersonaPresets();
        personaPresets.value = name;
        
        const oldIcon = btnSavePersona.innerHTML;
        btnSavePersona.innerHTML = '<i data-lucide="check" class="w-3 h-3 text-green-400"></i>';
        if (window.lucide) window.lucide.createIcons();
        setTimeout(() => {
            btnSavePersona.innerHTML = oldIcon;
            if (window.lucide) window.lucide.createIcons();
        }, 1500);
    });

    btnDeletePersona.addEventListener('click', async () => {
        const name = personaPresets.value;
        if (!name) return;
        
        if (confirm(`Are you sure you want to delete the persona preset "${name}"?`)) {
            delete appConfig.persona_presets[name];
            await window.pywebview.api.save_config(appConfig);
            sysPromptInput.value = '';
            loadPersonaPresets();
        }
    });

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
    
    function escapeHtml(unsafe) {
        return (unsafe || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function formatThinkTags(text) {
        if (!text) return '';
        
        let thinkContent = '';
        let finalContent = text;
        
        // Match <think>...</think> (complete)
        if (text.includes('<think>') && text.includes('</think>')) {
            const match = text.match(/<think>([\s\S]*?)<\/think>/i);
            if (match) {
                thinkContent = match[1].trim();
                finalContent = text.replace(/<think>[\s\S]*?<\/think>/i, '').trim();
            }
        } else if (text.startsWith('<think>')) {
            // Streaming (unclosed)
            thinkContent = text.substring(7).trim();
            finalContent = '';
        }
        
        let html = '';
        if (thinkContent) {
            const isStreaming = !finalContent;
            html += `
            <details ${isStreaming ? 'open' : ''} class="think-block mb-3 border border-border/80 rounded-xl bg-base/60 overflow-hidden group/think">
                <summary class="cursor-pointer text-xs font-medium text-textMuted flex items-center justify-between p-2.5 select-none hover:text-white hover:bg-card/40 transition-all">
                    <span class="flex items-center gap-2 font-mono">
                        <i data-lucide="brain" class="w-3.5 h-3.5 ${isStreaming ? 'animate-pulse text-brand' : 'text-brand'}"></i>
                        <span>${isStreaming ? 'Thinking...' : 'Reasoning Process'}</span>
                    </span>
                    <i data-lucide="chevron-down" class="w-3.5 h-3.5 text-textMuted group-open/think:rotate-180 transition-transform"></i>
                </summary>
                <div class="text-xs text-textMuted/90 px-3.5 py-3 border-t border-border/50 bg-base/30 whitespace-pre-wrap font-mono leading-relaxed">
${escapeHtml(thinkContent)}
                </div>
            </details>`;
        }
        
        if (finalContent) {
            html += window.marked ? marked.parse(finalContent) : escapeHtml(finalContent);
        }
        return html;
    }

    function addMessageToUI(role, content) {
        const wrap = document.createElement('div');
        wrap.className = role === 'user' ? 'flex gap-3 max-w-[85%] ml-auto flex-row-reverse group' : 'flex gap-3 max-w-[85%] group';
        
        const avatar = document.createElement('div');
        avatar.className = role === 'user' ? 'w-8 h-8 rounded-full bg-sec/20 flex items-center justify-center shrink-0 mt-1' : 'w-8 h-8 rounded-full bg-brand/20 flex items-center justify-center shrink-0 mt-1';
        avatar.innerHTML = role === 'user' ? '<i data-lucide="user" class="w-4 h-4 text-sec"></i>' : '<i data-lucide="bot" class="w-4 h-4 text-brand"></i>';
        
        const contentCol = document.createElement('div');
        contentCol.className = 'flex flex-col gap-1 min-w-0';

        const bubble = document.createElement('div');
        bubble.className = role === 'user' 
            ? 'bg-sec text-white border border-sec p-3 rounded-2xl rounded-tr-sm text-sm'
            : 'bg-card border border-border p-3 rounded-2xl rounded-tl-sm text-sm markdown-body overflow-hidden';
            
        if (role === 'user') {
            bubble.innerText = content;
        } else {
            bubble.innerHTML = formatThinkTags(content);
            bubble.setAttribute('data-raw', content);
            if (window.lucide) lucide.createIcons({root: bubble});
        }
        
        const actionBar = document.createElement('div');
        actionBar.className = `flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity ${role === 'user' ? 'justify-end' : 'justify-start'}`;
        
        const btnCopy = document.createElement('button');
        btnCopy.className = 'text-textMuted hover:text-white transition-colors p-1 rounded hover:bg-base';
        btnCopy.title = 'Copy Text';
        btnCopy.innerHTML = '<i data-lucide="copy" class="w-3 h-3"></i>';
        btnCopy.addEventListener('click', () => {
            const rawContent = bubble.getAttribute('data-raw') !== null ? bubble.getAttribute('data-raw') : bubble.innerText;
            navigator.clipboard.writeText(rawContent);
            window.showToast("Copied to clipboard!");
        });
        
        if (role === 'user') {
            const btnEdit = document.createElement('button');
            btnEdit.className = 'text-textMuted hover:text-white transition-colors p-1 rounded hover:bg-base';
            btnEdit.title = 'Edit / Retry';
            btnEdit.innerHTML = '<i data-lucide="edit-2" class="w-3 h-3"></i>';
            btnEdit.addEventListener('click', () => {
                // Find index of this message in DOM
                const children = Array.from(chatMessages.children);
                const indexInDom = children.indexOf(wrap);
                if (indexInDom === -1) return;
                
                // Clear DOM from this message downwards
                while (chatMessages.children.length > indexInDom) {
                    chatMessages.removeChild(chatMessages.lastChild);
                }
                
                // Truncate history (accounting for system prompt if any, but history only holds user/assistant)
                messageHistory = [];
                Array.from(chatMessages.children).forEach(child => {
                    const b = child.querySelector('.bg-sec') || child.querySelector('.markdown-body');
                    if (b) {
                        const isUser = child.querySelector('.bg-sec') !== null;
                        messageHistory.push({
                            role: isUser ? 'user' : 'assistant',
                            content: isUser ? b.innerText : (b.getAttribute('data-raw') || b.innerText)
                        });
                    }
                });
                
                chatInput.value = content;
                chatInput.focus();
            });
            actionBar.appendChild(btnEdit);
        } else {
            // Save raw content for editing history reconstruction
            bubble.setAttribute('data-raw', content);
        }
        
        actionBar.appendChild(btnCopy);

        contentCol.appendChild(bubble);
        contentCol.appendChild(actionBar);
        
        wrap.appendChild(avatar);
        wrap.appendChild(contentCol);
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
            let thinkingText = '';
            let responseText = '';
            let inThinkingTag = false;
            
            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let done = false;
            
            let buffer = '';
            while (!done) {
                const { value, done: readerDone } = await reader.read();
                done = readerDone;
                if (value) {
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop();
                    for (const line of lines) {
                        const trimmedLine = line.trim();
                        if (trimmedLine.startsWith('data: ') && trimmedLine !== 'data: [DONE]') {
                            try {
                                const data = JSON.parse(trimmedLine.substring(6));
                                if (data.choices && data.choices.length > 0 && data.choices[0].delta) {
                                    const delta = data.choices[0].delta;
                                    const reasoningChunk = delta.reasoning_content || delta.reasoning || '';
                                    const contentChunk = delta.content || '';
                                    
                                    if (reasoningChunk) {
                                        thinkingText += reasoningChunk;
                                    }
                                    
                                    if (contentChunk) {
                                        if (contentChunk.includes('<think>')) {
                                            inThinkingTag = true;
                                            const parts = contentChunk.split('<think>');
                                            responseText += parts[0];
                                            thinkingText += parts.slice(1).join('<think>');
                                        } else if (inThinkingTag) {
                                            if (contentChunk.includes('</think>')) {
                                                inThinkingTag = false;
                                                const parts = contentChunk.split('</think>');
                                                thinkingText += parts[0];
                                                responseText += parts.slice(1).join('</think>');
                                            } else {
                                                thinkingText += contentChunk;
                                            }
                                        } else {
                                            responseText += contentChunk;
                                        }
                                    }
                                    
                                    let combined = '';
                                    if (thinkingText && !responseText) {
                                        combined = `<think>${thinkingText}`;
                                    } else if (thinkingText && responseText) {
                                        combined = `<think>${thinkingText}</think>\n\n${responseText}`;
                                    } else {
                                        combined = responseText;
                                    }
                                    
                                    assistantBubble.innerHTML = formatThinkTags(combined);
                                    assistantBubble.setAttribute('data-raw', combined);
                                    if (window.lucide) lucide.createIcons({root: assistantBubble});
                                    chatMessages.scrollTop = chatMessages.scrollHeight;
                                }
                            } catch (e) {}
                        }
                    }
                }
            }
            
            let finalCombined = '';
            if (thinkingText) {
                finalCombined = `<think>${thinkingText}</think>\n\n${responseText}`;
            } else {
                finalCombined = responseText;
            }
            assistantBubble.innerHTML = formatThinkTags(finalCombined);
            assistantBubble.setAttribute('data-raw', finalCombined);
            if (window.lucide) lucide.createIcons({root: assistantBubble});
            messageHistory.push({ role: 'assistant', content: finalCombined });
            
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
            
            let buffer = '';
            while (!done) {
                const { value, done: readerDone } = await reader.read();
                done = readerDone;
                if (value) {
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop();
                    for (const line of lines) {
                        const trimmedLine = line.trim();
                        if (trimmedLine.startsWith('data: ') && trimmedLine !== 'data: [DONE]') {
                            try {
                                const data = JSON.parse(trimmedLine.substring(6));
                                if (data.choices && data.choices.length > 0 && data.choices[0].delta) {
                                    let content = data.choices[0].delta.content || '';
                                    if (content) {
                                        // Remove leading quotes if they exist
                                        if (firstChunk && content.startsWith('"')) {
                                            content = content.substring(1);
                                        }
                                        firstChunk = false;
                                        sysPromptInput.value += content;
                                    }
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
