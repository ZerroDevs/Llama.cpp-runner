/**
 * Llama Server Control - AI Chat & Vision Workspace Controller
 * Includes Streaming, Stop Generation, Message Editing, and Response Regeneration
 */

import { state } from './state.js';
import { showToast } from './toast.js';

export function setupChat() {
  // Presets / Personas
  document.querySelectorAll('.chat-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.chat-preset-btn').forEach(b => {
        b.className = 'chat-preset-btn px-2.5 py-1 rounded-lg text-xs font-medium bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer';
      });
      btn.className = 'chat-preset-btn active px-2.5 py-1 rounded-lg text-xs font-semibold bg-[var(--brand)] text-black cursor-pointer';
      state.selectedPreset = btn.getAttribute('data-preset');
      showToast('Persona Activated', btn.textContent, 'info', 1500);
    });
  });

  // Clear Chat
  document.getElementById('btn-clear-chat')?.addEventListener('click', () => {
    if (state.isStreaming) stopGeneration();
    state.chatMessages = [];
    renderPlaceholder();
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
        if (state.isStreaming) return;
        sendChatMessage();
      }
    });
  }

  // Send / Stop Button in input rail
  document.getElementById('btn-chat-send')?.addEventListener('click', () => {
    if (state.isStreaming) {
      stopGeneration();
    } else {
      sendChatMessage();
    }
  });

  // Floating Stop Button above input rail
  document.getElementById('btn-floating-stop')?.addEventListener('click', () => {
    stopGeneration();
  });

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
      { cmd: '/imagine <prompt>', desc: 'Direct SwarmUI generation' },
      { cmd: '/draw <prompt>', desc: 'LLM positive prompt enhancement + render' },
      { cmd: '/art <prompt>', desc: 'LLM rewrite positive & negative + render' },
      { cmd: '/guess', desc: 'Vision model describes image prompt' },
      { cmd: '/yes', desc: 'Render last guessed prompt' },
      { cmd: '/cfg <val>', desc: 'Set SwarmUI CFG Scale (0-20)' },
      { cmd: '/step <val>', desc: 'Set SwarmUI Generation Steps (0-50)' },
      { cmd: '/res <WxH>', desc: 'Set SwarmUI Resolution (e.g. 1024x1024)' },
      { cmd: '/sys', desc: 'Print real-time hardware telemetry HUD' },
      { cmd: '/eject', desc: 'Unload model from GPU to free 100% VRAM' },
      { cmd: '/models', desc: 'List discovered local .gguf models' },
      { cmd: '/clear', desc: 'Flush active slots & KV cache' },
      { cmd: '/compact', desc: 'Summarize context into dense memory block' },
      { cmd: '/hook', desc: 'Send last image to Discord Webhook' },
      { cmd: '/api', desc: 'View API connection instructions' },
      { cmd: '/help', desc: 'Print all commands cheat sheet' }
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
      <button class="btn-remove-attachment absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-rose-500 text-white flex items-center justify-center text-[10px] cursor-pointer" data-index="${idx}">×</button>
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

function renderPlaceholder() {
  const container = document.getElementById('chat-messages');
  if (!container) return;
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

export function setStreamingState(isStreaming) {
  state.isStreaming = isStreaming;
  const sendBtn = document.getElementById('btn-chat-send');
  const stopContainer = document.getElementById('chat-stop-container');

  if (isStreaming) {
    // Show dark circle button with red rounded stop square (as in user screenshot)
    if (sendBtn) {
      sendBtn.className = 'p-2.5 bg-[#202020] hover:bg-[#2c2c2c] border border-white/10 text-white rounded-xl font-bold transition-all shrink-0 flex items-center justify-center cursor-pointer shadow-md';
      sendBtn.title = 'Stop generating';
      sendBtn.innerHTML = '<span class="w-3.5 h-3.5 bg-rose-500 rounded-xs block"></span>';
    }
    if (stopContainer) stopContainer.classList.remove('hidden');
  } else {
    // Restore normal send button
    if (sendBtn) {
      sendBtn.className = 'p-2 bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-black rounded-xl font-bold transition-all shrink-0 cursor-pointer shadow-sm';
      sendBtn.title = 'Send message (Enter)';
      sendBtn.innerHTML = '<i data-lucide="send" class="w-4 h-4"></i>';
      if (window.lucide) window.lucide.createIcons({ root: sendBtn });
    }
    if (stopContainer) stopContainer.classList.add('hidden');
  }
}

export function stopGeneration() {
  if (state.isStreaming) {
    if (state.abortController) {
      state.abortController.abort();
    }
    setStreamingState(false);
    showToast('Generation Stopped', 'Request aborted.', 'info', 1500);

    // Refresh action toolbar on last assistant message
    const msgs = document.querySelectorAll('.chat-msg-wrapper');
    if (msgs.length > 0) {
      const lastMsg = msgs[msgs.length - 1];
      const assistantBubble = lastMsg.querySelector('.chat-assistant-container');
      if (assistantBubble) {
        const lastIdx = state.chatMessages.length - 1;
        attachAssistantToolbar(lastMsg, lastIdx);
      }
    }
  }
}

export async function sendChatMessage() {
  if (state.isStreaming) return;

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

  // Add User Message to History
  state.chatMessages.push({
    role: 'user',
    content: prompt,
    attachments: currentAttachments
  });

  renderAllMessages();
  await triggerChatStream();
}

export function renderAllMessages() {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  if (state.chatMessages.length === 0) {
    renderPlaceholder();
    return;
  }

  container.innerHTML = '';
  state.chatMessages.forEach((msg, idx) => {
    appendMessage(msg.role, msg.content, msg.attachments || [], idx);
  });

  container.scrollTop = container.scrollHeight;
}

function appendMessage(role, text, attachments = [], idx = 0) {
  const container = document.getElementById('chat-messages');
  if (!container) return null;

  const msgWrapper = document.createElement('div');
  msgWrapper.className = `chat-msg-wrapper flex gap-3 max-w-3xl ${role === 'user' ? 'ml-auto justify-end' : 'mr-auto justify-start'} w-full animate-in fade-in`;
  msgWrapper.setAttribute('data-msg-index', idx);

  if (role === 'user') {
    let attachHtml = '';
    if (attachments && attachments.length > 0) {
      attachHtml = `<div class="flex gap-2 mb-2 flex-wrap">${attachments.map(a => `<img src="${a.dataUrl}" class="w-20 h-20 object-cover rounded-xl border border-white/20" />`).join('')}</div>`;
    }

    msgWrapper.innerHTML = `
      <div class="flex flex-col items-end gap-1 max-w-xl group">
        <div class="user-bubble-box bg-[var(--brand)] text-black font-medium rounded-2xl rounded-tr-xs p-3.5 text-xs shadow-md select-text leading-relaxed">
          ${attachHtml}
          <div class="msg-text-content whitespace-pre-wrap">${escapeHtml(text)}</div>
        </div>
        <div class="chat-msg-actions flex items-center gap-1 mt-0.5">
          <button class="chat-action-btn btn-edit-msg" title="Edit message" data-msg-idx="${idx}">
            <i data-lucide="pencil" class="w-3 h-3"></i>
            <span>Edit</span>
          </button>
          <button class="chat-action-btn btn-copy-msg" title="Copy message" data-text="${escapeHtml(text)}">
            <i data-lucide="copy" class="w-3 h-3"></i>
          </button>
        </div>
      </div>
    `;

    // Hook edit & copy
    msgWrapper.querySelector('.btn-edit-msg')?.addEventListener('click', () => startEditMessage(idx));
    msgWrapper.querySelector('.btn-copy-msg')?.addEventListener('click', (e) => {
      const t = e.currentTarget.getAttribute('data-text');
      copyMessageText(t);
    });

    container.appendChild(msgWrapper);
    if (window.lucide) window.lucide.createIcons({ root: msgWrapper });
    return msgWrapper;
  } else {
    msgWrapper.innerHTML = `
      <div class="w-8 h-8 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border)] flex items-center justify-center shrink-0 text-emerald-400 font-bold text-xs">
        🦙
      </div>
      <div class="chat-assistant-container flex-1 max-w-2xl bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl rounded-tl-xs p-4 shadow-sm min-w-0">
        <div class="chat-bubble-content prose-chat select-text">
          ${text ? renderMarkdownWithThinking(text) : `
            <div class="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
              <span class="w-1.5 h-1.5 rounded-full bg-[var(--brand)] animate-pulse"></span>
              <span>Generating...</span>
            </div>
          `}
        </div>
        <div class="chat-assistant-toolbar flex items-center gap-2 mt-3 pt-2.5 border-t border-[var(--border)] ${text ? '' : 'hidden'}">
          <button class="chat-action-btn active-regen btn-regen-msg" title="Regenerate this response" data-msg-idx="${idx}">
            <i data-lucide="rotate-cw" class="w-3 h-3"></i>
            <span>Regenerate</span>
          </button>
          <button class="chat-action-btn btn-copy-msg" title="Copy response" data-text="${escapeHtml(text)}">
            <i data-lucide="copy" class="w-3 h-3"></i>
            <span>Copy</span>
          </button>
        </div>
      </div>
    `;

    // Hook regen & copy
    msgWrapper.querySelector('.btn-regen-msg')?.addEventListener('click', () => regenerateResponse(idx));
    msgWrapper.querySelector('.btn-copy-msg')?.addEventListener('click', (e) => {
      const t = e.currentTarget.getAttribute('data-text');
      copyMessageText(t);
    });

    container.appendChild(msgWrapper);
    if (window.lucide) window.lucide.createIcons({ root: msgWrapper });
    return msgWrapper;
  }
}

function startEditMessage(msgIdx) {
  if (state.isStreaming) {
    showToast('Busy', 'Please wait for current generation to finish or click Stop.', 'warning');
    return;
  }

  const msg = state.chatMessages[msgIdx];
  if (!msg || msg.role !== 'user') return;

  const msgDiv = document.querySelector(`.chat-msg-wrapper[data-msg-index="${msgIdx}"]`);
  if (!msgDiv) return;

  const userBox = msgDiv.querySelector('.user-bubble-box');
  const actions = msgDiv.querySelector('.chat-msg-actions');
  if (!userBox) return;

  if (actions) actions.classList.add('hidden');

  userBox.innerHTML = `
    <div class="chat-inline-editor">
      <textarea class="chat-inline-textarea" rows="3">${escapeHtml(msg.content)}</textarea>
      <div class="flex items-center justify-end gap-2 mt-1">
        <button class="btn-cancel-edit px-2.5 py-1 text-xs rounded-lg hover:bg-black/10 text-black/80 font-medium transition-colors cursor-pointer">Cancel</button>
        <button class="btn-save-edit px-3 py-1 text-xs font-bold rounded-lg bg-black text-white hover:bg-neutral-800 transition-colors shadow-xs cursor-pointer">Save & Submit</button>
      </div>
    </div>
  `;

  const textarea = userBox.querySelector('.chat-inline-textarea');
  textarea?.focus();

  userBox.querySelector('.btn-cancel-edit')?.addEventListener('click', () => {
    renderAllMessages();
  });

  userBox.querySelector('.btn-save-edit')?.addEventListener('click', async () => {
    const newText = textarea.value.trim();
    if (!newText) return;

    // Truncate all subsequent messages after this user message
    state.chatMessages = state.chatMessages.slice(0, msgIdx);
    state.chatMessages.push({
      role: 'user',
      content: newText,
      attachments: msg.attachments || []
    });

    renderAllMessages();
    await triggerChatStream();
  });
}

function regenerateResponse(assistantIdx) {
  if (state.isStreaming) {
    showToast('Busy', 'Please wait for current generation to finish or click Stop.', 'warning');
    return;
  }

  // Remove this assistant message and any subsequent messages
  state.chatMessages = state.chatMessages.slice(0, assistantIdx);
  renderAllMessages();
  triggerChatStream();
}

function copyMessageText(text) {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    showToast('Copied', 'Message content copied to clipboard.', 'info', 1200);
  }).catch(() => {
    showToast('Copy Failed', 'Clipboard access denied.', 'error', 1500);
  });
}

function attachAssistantToolbar(msgWrapper, msgIdx) {
  const toolbar = msgWrapper.querySelector('.chat-assistant-toolbar');
  if (!toolbar) return;

  const contentText = state.chatMessages[msgIdx]?.content || '';
  toolbar.classList.remove('hidden');

  const regenBtn = toolbar.querySelector('.btn-regen-msg');
  if (regenBtn) {
    regenBtn.setAttribute('data-msg-idx', msgIdx);
    regenBtn.onclick = () => regenerateResponse(msgIdx);
  }

  const copyBtn = toolbar.querySelector('.btn-copy-msg');
  if (copyBtn) {
    copyBtn.setAttribute('data-text', contentText);
    copyBtn.onclick = () => copyMessageText(contentText);
  }

  if (window.lucide) window.lucide.createIcons({ root: toolbar });
}

async function triggerChatStream() {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  // Add Empty Assistant Message Container
  const assistantIdx = state.chatMessages.length;
  const assistantBubble = appendMessage('assistant', '', [], assistantIdx);
  container.scrollTop = container.scrollHeight;

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
  setStreamingState(true);
  state.abortController = new AbortController();
  const startTime = Date.now();
  let receivedTokens = 0;
  let fullResponse = '';

  const tpsBadge = document.getElementById('chat-tps-badge');
  const tpsText = document.getElementById('chat-tps-text');
  if (tpsBadge) tpsBadge.classList.remove('hidden');

  try {
    const port = state.config.port || 8080;
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: messagesPayload,
        stream: true,
        temperature: 0.7,
        max_tokens: 4096
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
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (trimmed.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(trimmed.substring(6));
            const delta = parsed.choices?.[0]?.delta?.content || parsed.content || '';
            if (delta) {
              fullResponse += delta;
              receivedTokens++;
              updateAssistantMessage(assistantBubble, fullResponse, false);

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
    updateAssistantMessage(assistantBubble, fullResponse, true, assistantIdx);
  } catch (err) {
    if (err.name !== 'AbortError') {
      let msg = err.message || 'Unknown network error';
      if (msg === 'Failed to fetch' || msg.toLowerCase().includes('network')) {
        msg = `Network connection to http://127.0.0.1:${state.config.port || 8080} failed. Please verify the server is running.`;
      }
      const errMsg = `*Error: ${msg}*`;
      updateAssistantMessage(assistantBubble, errMsg, true, assistantIdx);
      state.chatMessages.push({ role: 'assistant', content: errMsg });
    } else {
      if (fullResponse) {
        state.chatMessages.push({ role: 'assistant', content: fullResponse });
        updateAssistantMessage(assistantBubble, fullResponse, true, assistantIdx);
      } else {
        assistantBubble?.remove();
      }
    }
  } finally {
    setStreamingState(false);
    state.abortController = null;
    if (tpsBadge) {
      setTimeout(() => tpsBadge.classList.add('hidden'), 5000);
    }
  }
}

function updateAssistantMessage(msgDiv, markdownText, isComplete = false, msgIndex = null) {
  if (!msgDiv) return;
  const bubble = msgDiv.querySelector('.chat-bubble-content');
  if (!bubble) return;

  bubble.innerHTML = renderMarkdownWithThinking(markdownText);

  // Syntax highlighting
  if (window.hljs) {
    bubble.querySelectorAll('pre code').forEach(block => {
      window.hljs.highlightElement(block);
    });
  }

  if (isComplete && msgIndex !== null) {
    attachAssistantToolbar(msgDiv, msgIndex);
  }

  const container = document.getElementById('chat-messages');
  if (container) container.scrollTop = container.scrollHeight;
}

function renderMarkdownWithThinking(text) {
  if (!text) return '';

  // Parse completed <think> ... </think> tags
  let processed = text.replace(/<think>([\s\S]*?)<\/think>/gi, (match, p1) => {
    return `<details open><summary class="text-emerald-400 font-semibold cursor-pointer">Reasoning Process</summary><div class="text-xs text-[var(--text-secondary)] font-mono mt-1 p-2.5 bg-[var(--bg-base)] border border-[var(--border)] rounded-xl leading-relaxed">${escapeHtml(p1.trim())}</div></details>`;
  });

  // Handle active thinking
  if (processed.includes('<think>') && !processed.includes('</think>')) {
    processed = processed.replace(/<think>([\s\S]*)$/gi, (match, p1) => {
      return `<details open><summary class="text-emerald-400 flex items-center gap-1.5 font-semibold cursor-pointer"><span class="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span> Thinking...</summary><div class="text-xs text-[var(--text-secondary)] font-mono mt-1 p-2.5 bg-[var(--bg-base)] border border-[var(--border)] rounded-xl leading-relaxed">${escapeHtml(p1.trim())}</div></details>`;
    });
  }

  if (window.marked) {
    return window.marked.parse(processed);
  }
  return escapeHtml(processed);
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}
