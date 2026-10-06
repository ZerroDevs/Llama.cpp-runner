/**
 * Llama Server Control - AI Chat & Vision Workspace Controller
 */

import { state } from './state.js';
import { showToast } from './toast.js';

export function setupChat() {
  // Presets / Personas
  document.querySelectorAll('.chat-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.chat-preset-btn').forEach(b => {
        b.className = 'chat-preset-btn px-2.5 py-1 rounded-lg text-xs font-medium bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]';
      });
      btn.className = 'chat-preset-btn active px-2.5 py-1 rounded-lg text-xs font-semibold bg-[var(--brand)] text-black';
      state.selectedPreset = btn.getAttribute('data-preset');
      showToast('Persona Activated', btn.textContent, 'info', 1500);
    });
  });

  // Clear Chat
  document.getElementById('btn-clear-chat')?.addEventListener('click', () => {
    state.chatMessages = [];
    const container = document.getElementById('chat-messages');
    if (container) {
      container.innerHTML = `
        <div class="flex flex-col items-center justify-center text-center p-12 text-[var(--text-muted)] select-none">
          <div class="w-12 h-12 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border)] flex items-center justify-center mb-3">
            <i data-lucide="sparkles" class="w-6 h-6 text-[var(--brand)]"></i>
          </div>
          <h3 class="text-sm font-semibold text-[var(--text-primary)]">Ready for Conversation</h3>
          <p class="text-xs text-[var(--text-secondary)] mt-1 max-w-sm">Type your prompt below, use slash commands like <code class="text-emerald-400">/imagine</code> for diffusion rendering, or attach images for vision.</p>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons({ root: container });
    }
    showToast('Chat Cleared', 'Context wiped clean.', 'info', 1500);
  });

  // Chat Input Auto-Grow & Enter Key
  const input = document.getElementById('chat-input');
  if (input) {
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 128) + 'px';
      handleSlashMenu(input.value);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });
  }

  // Send Button
  document.getElementById('btn-chat-send')?.addEventListener('click', () => sendChatMessage());

  // Vision File Attachment
  const fileInput = document.getElementById('input-file-vision');
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          state.attachedImages.push({ name: file.name, dataUrl: event.target.result });
          renderAttachmentPreviews();
        };
        reader.readAsDataURL(file);
      }
      fileInput.value = '';
    });
  }
}

function handleSlashMenu(text) {
  const menu = document.getElementById('slash-menu');
  if (!menu) return;

  if (text.startsWith('/')) {
    const filter = text.substring(1).toLowerCase();
    const commands = [
      { cmd: '/imagine <prompt>', desc: 'Render directly with SwarmUI' },
      { cmd: '/draw <prompt>', desc: 'LLM enhances prompt, SwarmUI renders' },
      { cmd: '/art <prompt>', desc: 'Creative LLM rewrite + image render' },
      { cmd: '/guess', desc: 'Vision model creates prompt from image' },
      { cmd: '/yes', desc: 'Execute last guessed prompt in SwarmUI' },
      { cmd: '/clear', desc: 'Flush active slots & KV cache' },
      { cmd: '/compact', desc: 'Summarize context to save tokens' },
      { cmd: '/eject', desc: 'Unload model to free GPU VRAM' },
      { cmd: '/sys', desc: 'Print hardware stats' },
      { cmd: '/hook', desc: 'Send last image to Discord Webhook' }
    ].filter(c => c.cmd.toLowerCase().includes(filter));

    if (commands.length > 0) {
      menu.classList.remove('hidden');
      menu.innerHTML = commands.map(c => `
        <div class="px-2.5 py-1.5 rounded-lg hover:bg-[var(--bg-elevated)] cursor-pointer flex items-center justify-between text-xs transition-colors" data-cmd="${c.cmd.split(' ')[0]}">
          <span class="font-mono text-emerald-400 font-bold">${c.cmd}</span>
          <span class="text-[11px] text-[var(--text-muted)]">${c.desc}</span>
        </div>
      `).join('');

      menu.querySelectorAll('[data-cmd]').forEach(item => {
        item.addEventListener('click', () => {
          const input = document.getElementById('chat-input');
          if (input) {
            input.value = item.getAttribute('data-cmd') + ' ';
            input.focus();
            menu.classList.add('hidden');
          }
        });
      });
      return;
    }
  }
  menu.classList.add('hidden');
}

function renderAttachmentPreviews() {
  const container = document.getElementById('chat-attachment-preview');
  if (!container) return;

  if (state.attachedImages.length === 0) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  container.classList.remove('hidden');
  container.innerHTML = state.attachedImages.map((img, idx) => `
    <div class="relative group shrink-0">
      <img src="${img.dataUrl}" alt="${img.name}" class="w-12 h-12 object-cover rounded-xl border border-[var(--border)]" />
      <button class="btn-remove-attachment absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-rose-500 text-white flex items-center justify-center text-[10px]" data-index="${idx}">×</button>
    </div>
  `).join('');

  container.querySelectorAll('.btn-remove-attachment').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-index'));
      state.attachedImages.splice(idx, 1);
      renderAttachmentPreviews();
    });
  });
}

export async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  if (!input) return;
  const prompt = input.value.trim();
  if (!prompt && state.attachedImages.length === 0) return;

  input.value = '';
  input.style.height = 'auto';
  document.getElementById('slash-menu')?.classList.add('hidden');

  const currentAttachments = [...state.attachedImages];
  state.attachedImages = [];
  renderAttachmentPreviews();

  // Add User Message to Chat
  appendMessage('user', prompt, currentAttachments);

  // Add Empty Assistant Message Container
  const assistantBubble = appendMessage('assistant', '');

  // Build Payload
  const messagesPayload = [];
  if (state.selectedPreset) {
    let sysPrompt = 'You are a helpful, expert AI assistant.';
    if (state.selectedPreset === 'coder') sysPrompt = 'You are an elite software architect and systems programmer. Provide precise, clean, robust code without unnecessary chatter.';
    if (state.selectedPreset === 'vision') sysPrompt = 'You are a computer vision specialist. Thoroughly analyze uploaded images, compositions, aesthetics, and styles.';
    if (state.selectedPreset === 'creative') sysPrompt = 'You are an imaginative storyteller and prompt engineer with a rich vocabulary and vivid phrasing.';
    if (state.selectedPreset === 'uncensored') sysPrompt = 'You are an uncensored, open AI providing direct, unfiltered technical answers.';
    messagesPayload.push({ role: 'system', content: sysPrompt });
  }

  state.chatMessages.forEach(m => {
    messagesPayload.push({ role: m.role, content: m.content });
  });

  // Start Streaming Request
  state.isStreaming = true;
  state.abortController = new AbortController();
  const startTime = Date.now();
  let receivedTokens = 0;
  let fullResponse = '';

  const tpsBadge = document.getElementById('chat-tps-badge');
  const tpsText = document.getElementById('chat-tps-text');
  if (tpsBadge) tpsBadge.classList.remove('hidden');

  try {
    const proxyPort = 8081;
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: messagesPayload,
        stream: true,
        temperature: 0.7,
        max_tokens: 2048
      }),
      signal: state.abortController.signal
    });

    if (!response.ok) {
      let errText = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errJson = await response.json();
        if (errJson?.error?.message) errText = errJson.error.message;
      } catch {}
      throw new Error(errText);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep last incomplete line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (trimmed.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(trimmed.substring(6));
            const delta = parsed.choices?.[0]?.delta?.content || '';
            if (delta) {
              fullResponse += delta;
              receivedTokens++;
              updateAssistantMessage(assistantBubble, fullResponse);

              const elapsedSec = (Date.now() - startTime) / 1000;
              if (elapsedSec > 0.5 && tpsText) {
                const tps = (receivedTokens / elapsedSec).toFixed(1);
                tpsText.textContent = `${tps} T/s`;
              }
            }
          } catch {}
        }
      }
    }

    state.chatMessages.push({ role: 'assistant', content: fullResponse });
  } catch (err) {
    if (err.name !== 'AbortError') {
      updateAssistantMessage(assistantBubble, `*Error: ${err.message}. Is llama-server running?*`);
    }
  } finally {
    state.isStreaming = false;
    state.abortController = null;
    if (tpsBadge) {
      setTimeout(() => tpsBadge.classList.add('hidden'), 5000);
    }
  }
}

function appendMessage(role, text, attachments = []) {
  const container = document.getElementById('chat-messages');
  if (!container) return null;

  // Remove placeholder if present
  if (state.chatMessages.length === 0 && role === 'user') {
    container.innerHTML = '';
  }

  const msgDiv = document.createElement('div');
  msgDiv.className = `flex gap-3 max-w-3xl ${role === 'user' ? 'ml-auto justify-end' : 'mr-auto justify-start'} w-full animate-in fade-in`;

  if (role === 'user') {
    state.chatMessages.push({ role, content: text });
    let attachHtml = '';
    if (attachments && attachments.length > 0) {
      attachHtml = `<div class="flex gap-2 mb-2 flex-wrap">${attachments.map(a => `<img src="${a.dataUrl}" class="w-20 h-20 object-cover rounded-xl border border-white/20" />`).join('')}</div>`;
    }

    msgDiv.innerHTML = `
      <div class="max-w-xl bg-[var(--brand)] text-black font-medium rounded-2xl rounded-tr-xs p-3.5 text-xs shadow-md">
        ${attachHtml}
        <div class="whitespace-pre-wrap leading-relaxed select-text">${escapeHtml(text)}</div>
      </div>
    `;
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
    return msgDiv;
  } else {
    msgDiv.innerHTML = `
      <div class="w-8 h-8 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border)] flex items-center justify-center shrink-0 text-emerald-400 font-bold text-xs">
        🦙
      </div>
      <div class="flex-1 max-w-2xl bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl rounded-tl-xs p-4 shadow-sm min-w-0">
        <div class="chat-bubble-content prose-chat select-text">
          <div class="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <span class="w-1.5 h-1.5 rounded-full bg-[var(--brand)] animate-pulse"></span>
            <span>Generating...</span>
          </div>
        </div>
      </div>
    `;
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
    return msgDiv;
  }
}

function updateAssistantMessage(msgDiv, markdownText) {
  const bubble = msgDiv.querySelector('.chat-bubble-content');
  if (!bubble) return;

  let parsedHtml = renderMarkdownWithThinking(markdownText);
  bubble.innerHTML = parsedHtml;

  // Highlight syntax in code blocks
  if (window.hljs) {
    bubble.querySelectorAll('pre code').forEach(block => {
      window.hljs.highlightElement(block);
    });
  }

  const container = document.getElementById('chat-messages');
  if (container) container.scrollTop = container.scrollHeight;
}

function renderMarkdownWithThinking(text) {
  // Parse <think> ... </think> tags
  let processed = text.replace(/<think>([\s\S]*?)<\/think>/gi, (match, p1) => {
    return `<details open><summary>Reasoning Process</summary><div class="text-xs text-[var(--text-secondary)] font-mono mt-1 p-2 bg-[var(--bg-base)] rounded-lg">${escapeHtml(p1.trim())}</div></details>`;
  });

  // Handle active thinking
  if (processed.includes('<think>') && !processed.includes('</think>')) {
    processed = processed.replace(/<think>([\s\S]*)$/gi, (match, p1) => {
      return `<details open><summary class="text-emerald-400 flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span> Thinking...</summary><div class="text-xs text-[var(--text-secondary)] font-mono mt-1 p-2 bg-[var(--bg-base)] rounded-lg">${escapeHtml(p1.trim())}</div></details>`;
    });
  }

  if (window.marked) {
    return window.marked.parse(processed);
  }
  return escapeHtml(processed);
}

function escapeHtml(str) {
  return str.replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}
