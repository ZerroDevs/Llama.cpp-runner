/**
 * Llama Server Control - AI Chat & Vision Workspace Controller
 * Includes:
 * 1. Multiple Chat Conversations & Saved History Drawer (chats.json / localStorage persistence)
 * 2. In-Chat Model Quick-Switcher with live hot-reloading
 * 3. Message Branching (< 1/3 >) for user edits and assistant regenerations
 * 4. Streaming, Slash Commands, Stop Generation, and Markdown Thinking Accordions
 */

import { api } from './api.js';
import { state } from './state.js';
import { showToast } from './toast.js';

export function setupChat() {
  // Configure marked for GFM tables and clean line breaks
  if (window.marked && typeof window.marked.setOptions === 'function') {
    try {
      window.marked.setOptions({
        gfm: true,
        breaks: true
      });
    } catch {}
  }

  // 1. Presets / Personas
  document.querySelectorAll('.chat-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.chat-preset-btn').forEach(b => {
        b.className = 'chat-preset-btn px-2.5 py-1 rounded-lg text-xs font-medium bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer shrink-0';
      });
      btn.className = 'chat-preset-btn active px-2.5 py-1 rounded-lg text-xs font-semibold bg-[var(--brand)] text-black cursor-pointer shrink-0';
      state.selectedPreset = btn.getAttribute('data-preset');
      showToast('Persona Activated', btn.textContent, 'info', 1500);
    });
  });

  // 2. Chat History Sidebar & Sessions Controls
  document.getElementById('btn-new-chat')?.addEventListener('click', () => {
    createNewChatSession();
  });

  document.getElementById('btn-toggle-chat-sidebar')?.addEventListener('click', () => {
    toggleChatSidebar();
  });

  document.getElementById('btn-collapse-chat-sidebar')?.addEventListener('click', () => {
    toggleChatSidebar(false);
  });

  document.getElementById('btn-expand-chat-sidebar')?.addEventListener('click', () => {
    toggleChatSidebar(true);
  });

  const searchInput = document.getElementById('chat-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderChatSessionsList(searchInput.value);
    });
  }

  document.getElementById('btn-export-chat-md')?.addEventListener('click', () => {
    exportActiveChat('md');
  });

  document.getElementById('btn-export-chat-json')?.addEventListener('click', () => {
    exportActiveChat('json');
  });

  // 3. Clear Chat (wipes messages in current active session)
  document.getElementById('btn-clear-chat')?.addEventListener('click', () => {
    if (state.isStreaming) stopGeneration();
    state.chatMessages = [];
    saveCurrentChatSession();
    renderPlaceholder();
    updateChatTokenBadge();
    showToast('Chat Cleared', 'Active conversation messages cleared.', 'info', 1500);
  });

  // 4. In-Chat Model Quick-Switcher
  const modelQuickSelect = document.getElementById('chat-model-quick-select');
  if (modelQuickSelect) {
    modelQuickSelect.addEventListener('change', async (e) => {
      const newPath = e.target.value;
      if (!newPath || newPath === state.config.model_path) return;

      const modelName = getFilename(newPath);
      state.config.model_path = newPath;

      // Update backend config
      await api.invoke('save_config', { model_path: newPath });

      if (state.serverRunning) {
        showToast('Hot-Swapping Model', `Reloading engine with ${modelName}...`, 'info', 2500);
        try {
          await api.invoke('stop_server');
          await new Promise(r => setTimeout(r, 600));
          await api.invoke('start_server', state.config);
          showToast('Model Ready', `${modelName} loaded into VRAM.`, 'success', 2500);
        } catch (err) {
          showToast('Swap Error', err.message || 'Failed to restart server', 'error', 3500);
        }
      } else {
        showToast('Model Selected', `${modelName} selected. Ready to launch or auto-wake.`, 'success', 2000);
      }
    });
  }

  // 5. Chat Input Auto-Grow & Enter Key
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

  // 6. Send / Stop Button in input rail
  document.getElementById('btn-chat-send')?.addEventListener('click', () => {
    if (state.isStreaming) {
      stopGeneration();
    } else {
      sendChatMessage();
    }
  });

  // 7. Floating Stop Button above input rail
  document.getElementById('btn-floating-stop')?.addEventListener('click', () => {
    stopGeneration();
  });

  // 8. Vision File Attachment & Clipboard / Drag-Drop Support
  const fileInput = document.getElementById('input-file-vision');
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) {
        handleIncomingImageFiles(files, 'attached');
      }
      fileInput.value = '';
    });
  }

  // Paste Event on Chat Input & Global Window (when in Studio Chat tab)
  input?.addEventListener('paste', (e) => {
    handlePasteImageEvent(e);
  });

  window.addEventListener('paste', (e) => {
    if (state.activeTab === 'tab-chat' && e.target !== input) {
      // Don't intercept paste if user is typing inside search or rename inputs
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      handlePasteImageEvent(e);
    }
  });

  // Drag & Drop Image directly onto Chat Workspace
  const chatArea = document.getElementById('chat-main-area');
  if (chatArea) {
    chatArea.addEventListener('dragover', (e) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });

    chatArea.addEventListener('drop', (e) => {
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      const imageFiles = Array.from(files).filter(isImageFile);
      if (imageFiles.length > 0) {
        e.preventDefault();
        handleIncomingImageFiles(imageFiles, 'dropped');
      }
    });
  }

  // 9. Load saved conversations & populate quick switcher
  restoreChatSidebarState();
  loadChatSessions();
  populateChatModelSelector();

  // 10. Session & Context Telemetry Modal Event Handlers
  document.getElementById('btn-chat-session-stats')?.addEventListener('click', () => {
    openSessionStatsModal();
  });

  document.getElementById('btn-close-session-stats')?.addEventListener('click', () => {
    closeSessionStatsModal();
  });

  document.getElementById('btn-stats-close')?.addEventListener('click', () => {
    closeSessionStatsModal();
  });

  const statsModal = document.getElementById('modal-session-stats');
  if (statsModal) {
    statsModal.addEventListener('click', (e) => {
      if (e.target === statsModal) closeSessionStatsModal();
    });
  }

  document.getElementById('btn-stats-flush-cache')?.addEventListener('click', async () => {
    try {
      const res = await api.invoke('flush_kv_cache');
      if (res && res.status === 'success') {
        showToast('Context Flushed', res.message || 'Active slots reset, KV cache cleared to 0 tokens.', 'success');
      } else {
        showToast('Flush Warning', res?.message || 'Server did not acknowledge flush.', 'warning');
      }
      await openSessionStatsModal();
      await updateChatTokenBadge();
    } catch (err) {
      showToast('Flush Failed', err.message, 'error');
    }
  });

  document.getElementById('btn-stats-copy-summary')?.addEventListener('click', () => {
    const stats = calculateSessionTokenStats();
    const rawModel = state.config.model_path || '';
    const mName = getFilename(rawModel) || 'Active Model';
    const lines = [
      `Session: ${stats.session.title || 'New Conversation'}`,
      `Messages: ${stats.messagesCount}`,
      `Provider: Llama.cpp (Local Engine)`,
      `Model: ${mName}`,
      `Context Limit: ${stats.contextLimit.toLocaleString()}`,
      `Total Tokens: ${stats.totalTokens.toLocaleString()}`,
      `Usage: ${stats.usagePercent}%`,
      `Input Tokens: ${stats.inputTokens.toLocaleString()}`,
      `Output Tokens: ${stats.outputTokens.toLocaleString()}`,
      `Reasoning Tokens: ${stats.reasoningTokens.toLocaleString()}`,
      `Cache Tokens: ${stats.cachedTokens?.toLocaleString?.() || '0'} / 0`,
      `User Messages: ${stats.userMessages}`,
      `Assistant Messages: ${stats.assistantMessages}`,
      `Avg Speed: ${stats.avgTps ? `${stats.avgTps} T/s` : '--'}`,
      `Generation Time: ${stats.totalGenerationSec > 0 ? formatDurationDisplay(stats.totalGenerationSec) : '--'}`,
      `Total Cost: $0.00`,
      `Session Created: ${formatStatsDate(stats.session.createdAt)}`,
      `Last Activity: ${formatStatsDate(stats.session.updatedAt || stats.session.createdAt)}`
    ];
    navigator.clipboard.writeText(lines.join('\n'));
    showToast('Copied to Clipboard', 'Session stats summary copied.', 'success', 2000);
  });
}

// ==========================================
// CHAT SESSION & HISTORY DRAWER MANAGEMENT
// ==========================================

export async function loadChatSessions() {
  let loaded = null;
  try {
    const res = await api.invoke('load_chats');
    if (res && res.status === 'success' && res.data) {
      loaded = JSON.parse(res.data);
    }
  } catch {}

  if (!loaded || !Array.isArray(loaded) || loaded.length === 0) {
    try {
      const local = localStorage.getItem('llama_chat_sessions');
      if (local) loaded = JSON.parse(local);
    } catch {}
  }

  if (!loaded || !Array.isArray(loaded) || loaded.length === 0) {
    const legacyMsgs = state.chatMessages && state.chatMessages.length > 0 ? [...state.chatMessages] : [];
    loaded = [{
      id: 'session_' + Date.now(),
      title: legacyMsgs.length > 0 ? 'Previous Chat' : 'New Conversation',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: legacyMsgs
    }];
  }

  state.chatSessions = loaded;
  state.activeSessionId = loaded[0].id;
  state.chatMessages = loaded[0].messages || [];

  renderChatSessionsList();
  renderAllMessages();
  updateSessionCountBadge();
  updateChatTokenBadge();
}

export function saveCurrentChatSession() {
  if (!state.chatSessions || state.chatSessions.length === 0) return;

  const current = state.chatSessions.find(s => s.id === state.activeSessionId);
  if (current) {
    current.messages = state.chatMessages;
    current.updatedAt = Date.now();
  }

  const payload = JSON.stringify(state.chatSessions, null, 2);
  try {
    api.invoke('save_chats', payload);
  } catch {}
  try {
    localStorage.setItem('llama_chat_sessions', payload);
  } catch {}

  updateSessionCountBadge();
  updateChatTokenBadge();
}

export function createNewChatSession() {
  if (state.isStreaming) stopGeneration();

  saveCurrentChatSession();

  const newSession = {
    id: 'session_' + Date.now(),
    title: 'New Conversation',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: []
  };

  state.chatSessions.unshift(newSession);
  switchChatSession(newSession.id);
  updateChatTokenBadge();
  showToast('New Chat', 'Started a fresh conversation.', 'info', 1200);
}

export function switchChatSession(sessionId) {
  if (state.isStreaming) stopGeneration();

  const target = state.chatSessions.find(s => s.id === sessionId);
  if (!target) return;

  saveCurrentChatSession();

  state.activeSessionId = sessionId;
  state.chatMessages = target.messages || [];

  renderChatSessionsList();
  renderAllMessages();
  updateChatTokenBadge();

  const input = document.getElementById('chat-input');
  if (input) input.focus();
}

export function deleteChatSession(sessionId) {
  if (state.chatSessions.length <= 1) {
    // Clear the only chat
    state.chatMessages = [];
    state.chatSessions[0].title = 'New Conversation';
    state.chatSessions[0].messages = [];
    saveCurrentChatSession();
    renderChatSessionsList();
    renderAllMessages();
    updateChatTokenBadge();
    showToast('Chat Cleared', 'Conversation reset.', 'info', 1200);
    return;
  }

  const idx = state.chatSessions.findIndex(s => s.id === sessionId);
  if (idx === -1) return;

  state.chatSessions.splice(idx, 1);

  if (state.activeSessionId === sessionId) {
    const nextSession = state.chatSessions[Math.min(idx, state.chatSessions.length - 1)];
    state.activeSessionId = nextSession.id;
    state.chatMessages = nextSession.messages || [];
  }

  saveCurrentChatSession();
  renderChatSessionsList();
  renderAllMessages();
  updateChatTokenBadge();
  showToast('Chat Deleted', 'Conversation removed.', 'info', 1200);
}

export function startRenameChatSession(sessionId) {
  const session = state.chatSessions.find(s => s.id === sessionId);
  if (!session) return;

  const itemDiv = document.querySelector(`.chat-session-item[data-session-id="${sessionId}"]`);
  if (!itemDiv) return;

  const titleSpan = itemDiv.querySelector('.session-title');
  if (!titleSpan) return;

  const currentTitle = session.title || 'Untitled Chat';
  titleSpan.innerHTML = `
    <input type="text" class="rename-session-input w-full bg-[var(--bg-card)] border border-[var(--brand)] rounded px-1.5 py-0.5 text-xs text-[var(--text-primary)] outline-none" value="${escapeHtml(currentTitle)}" />
  `;

  const input = titleSpan.querySelector('.rename-session-input');
  if (input) {
    input.focus();
    input.select();

    const commit = () => {
      const newTitle = input.value.trim() || currentTitle;
      session.title = newTitle;
      saveCurrentChatSession();
      renderChatSessionsList();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        renderChatSessionsList();
      }
    });

    input.addEventListener('blur', () => {
      commit();
    });
  }
}

export function renderChatSessionsList(filterText = '') {
  const container = document.getElementById('chat-sessions-list');
  if (!container) return;

  const query = filterText.trim().toLowerCase();
  const sessions = state.chatSessions.filter(s => !query || (s.title && s.title.toLowerCase().includes(query)));

  if (sessions.length === 0) {
    container.innerHTML = `
      <div class="p-4 text-center text-xs text-[var(--text-muted)] select-none">
        ${query ? 'No matching chats' : 'No saved conversations'}
      </div>
    `;
    return;
  }

  container.innerHTML = sessions.map(s => {
    const isActive = s.id === state.activeSessionId;
    return `
      <div class="chat-session-item ${isActive ? 'active' : ''} group" data-session-id="${s.id}">
        <div class="flex items-center gap-2 min-w-0 flex-1">
          <i data-lucide="message-square" class="w-3.5 h-3.5 shrink-0 ${isActive ? 'text-[var(--brand)]' : 'text-[var(--text-muted)]'}"></i>
          <span class="session-title truncate text-xs flex-1">${escapeHtml(s.title || 'Untitled Chat')}</span>
        </div>
        <div class="chat-session-actions">
          <button class="chat-session-action-btn edit-title-btn" title="Rename" data-session-id="${s.id}">
            <i data-lucide="pencil" class="w-3 h-3"></i>
          </button>
          <button class="chat-session-action-btn delete-btn" title="Delete" data-session-id="${s.id}">
            <i data-lucide="trash-2" class="w-3 h-3"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons({ root: container });

  // Attach session selection listener
  container.querySelectorAll('.chat-session-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.chat-session-actions')) return;
      const sId = item.getAttribute('data-session-id');
      if (sId && sId !== state.activeSessionId) {
        switchChatSession(sId);
      }
    });
  });

  // Attach rename & delete buttons
  container.querySelectorAll('.edit-title-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const sId = btn.getAttribute('data-session-id');
      startRenameChatSession(sId);
    });
  });

  container.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const sId = btn.getAttribute('data-session-id');
      deleteChatSession(sId);
    });
  });

  updateSessionCountBadge();
}

function updateSessionCountBadge() {
  const badge = document.getElementById('chat-session-count');
  if (badge) {
    const count = (state.chatSessions || []).length;
    badge.textContent = `${count} ${count === 1 ? 'Chat' : 'Chats'}`;
  }
}

export function toggleChatSidebar(show, savePreference = true) {
  const sidebar = document.getElementById('chat-history-sidebar');
  const toggleBtn = document.getElementById('btn-toggle-chat-sidebar');
  const expandBtn = document.getElementById('btn-expand-chat-sidebar');

  const shouldShow = show !== undefined ? show : (sidebar ? sidebar.classList.contains('collapsed') : true);
  state.chatSidebarOpen = shouldShow;

  if (savePreference) {
    try {
      localStorage.setItem('llama_chat_sidebar_open', shouldShow ? 'true' : 'false');
    } catch {}
  }

  if (sidebar) {
    if (shouldShow) {
      sidebar.classList.remove('collapsed');
      if (expandBtn) expandBtn.classList.add('hidden');
      if (toggleBtn) {
        toggleBtn.classList.remove('text-[var(--text-secondary)]');
        toggleBtn.classList.add('text-[var(--brand)]');
        const icon = toggleBtn.querySelector('i, svg');
        if (icon) {
          icon.classList.remove('text-[var(--text-secondary)]');
          icon.classList.add('text-[var(--brand)]');
        }
        toggleBtn.setAttribute('title', 'Collapse Saved Chats Drawer');
      }
    } else {
      sidebar.classList.add('collapsed');
      if (expandBtn) expandBtn.classList.remove('hidden');
      if (toggleBtn) {
        toggleBtn.classList.remove('text-[var(--brand)]');
        toggleBtn.classList.add('text-[var(--text-secondary)]');
        const icon = toggleBtn.querySelector('i, svg');
        if (icon) {
          icon.classList.remove('text-[var(--brand)]');
          icon.classList.add('text-[var(--text-secondary)]');
        }
        toggleBtn.setAttribute('title', 'Open Saved Chats Drawer');
      }
    }
  }

  // Preserve bottom scroll after transition reflow
  setTimeout(() => {
    scrollChatToBottom();
  }, 220);
}

export function restoreChatSidebarState() {
  try {
    const saved = localStorage.getItem('llama_chat_sidebar_open');
    if (saved !== null) {
      toggleChatSidebar(saved === 'true', false);
    }
  } catch {}
}

export function scrollChatToBottom(smooth = false) {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  const doScroll = () => {
    const lastMsg = container.lastElementChild;
    if (lastMsg && typeof lastMsg.scrollIntoView === 'function') {
      lastMsg.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'end' });
    }
    container.scrollTop = container.scrollHeight;
  };

  doScroll();
  requestAnimationFrame(() => {
    doScroll();
    setTimeout(doScroll, 40);
    setTimeout(doScroll, 150);
  });
}

export function onChatTabActivated() {
  restoreChatSidebarState();
  scrollChatToBottom();
  const input = document.getElementById('chat-input');
  if (input) input.focus();
}

export function exportActiveChat(format = 'md') {
  const session = state.chatSessions.find(s => s.id === state.activeSessionId);
  if (!session || !session.messages || session.messages.length === 0) {
    showToast('Export', 'No messages in current conversation to export.', 'warning');
    return;
  }

  const safeTitle = (session.title || 'conversation').replace(/[^a-z0-9_\-\u0600-\u06FF]/gi, '_').toLowerCase();

  if (format === 'json') {
    const jsonStr = JSON.stringify(session, null, 2);
    downloadBlob(jsonStr, `${safeTitle}.json`, 'application/json');
    showToast('Exported', 'Conversation exported as JSON.', 'success');
  } else {
    let md = `# ${session.title || 'Conversation'}\n\n`;
    md += `*Exported from Llama Server Control on ${new Date().toLocaleString()}*\n\n---\n\n`;
    session.messages.forEach(m => {
      const roleName = m.role === 'user' ? '👤 User' : '🦙 Assistant';
      md += `### ${roleName}\n\n${m.content}\n\n---\n\n`;
    });
    downloadBlob(md, `${safeTitle}.md`, 'text/markdown');
    showToast('Exported', 'Conversation exported as Markdown.', 'success');
  }
}

function downloadBlob(content, filename, contentType) {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function updateActiveSessionTitleFromPrompt(prompt) {
  const session = state.chatSessions.find(s => s.id === state.activeSessionId);
  if (!session) return;

  if (!session.title || session.title === 'New Conversation' || session.title.startsWith('New Chat')) {
    const cleanPrompt = prompt.replace(/\n+/g, ' ').trim();
    session.title = cleanPrompt.length > 28 ? cleanPrompt.substring(0, 28) + '...' : cleanPrompt;
    renderChatSessionsList();
  }
}

// ==========================================
// IN-CHAT MODEL QUICK-SWITCHER
// ==========================================

export function populateChatModelSelector() {
  const select = document.getElementById('chat-model-quick-select');
  if (!select) return;

  const currentModelPath = state.config.model_path || '';
  const currentFileName = currentModelPath ? getFilename(currentModelPath) : '';

  select.innerHTML = '';

  if (!state.models || state.models.length === 0) {
    if (currentModelPath) {
      const opt = document.createElement('option');
      opt.value = currentModelPath;
      opt.textContent = currentFileName || 'Active Model';
      opt.selected = true;
      select.appendChild(opt);
    } else {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No model loaded';
      opt.disabled = true;
      opt.selected = true;
      select.appendChild(opt);
    }
    return;
  }

  let foundSelected = false;
  state.models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.path;
    const sizeBadge = m.size_formatted ? ` (${m.size_formatted})` : '';
    opt.textContent = `${m.name}${sizeBadge}`;
    if (m.path === currentModelPath) {
      opt.selected = true;
      foundSelected = true;
    }
    select.appendChild(opt);
  });

  if (!foundSelected && currentModelPath) {
    const opt = document.createElement('option');
    opt.value = currentModelPath;
    opt.textContent = `${currentFileName} (Active)`;
    opt.selected = true;
    select.insertBefore(opt, select.firstChild);
  }
}

function getFilename(path) {
  if (!path) return '';
  const norm = path.replace(/\\/g, '/');
  return norm.substring(norm.lastIndexOf('/') + 1);
}

// ==========================================
// CHAT MESSAGES, BRANCHING & RENDERING
// ==========================================

export function renderAllMessages() {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  if (!state.chatMessages || state.chatMessages.length === 0) {
    renderPlaceholder();
    return;
  }

  container.innerHTML = '';
  state.chatMessages.forEach((msg, idx) => {
    appendMessage(msg.role, msg.content, msg.attachments || [], idx, msg);
  });

  scrollChatToBottom();
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

function appendMessage(role, text, attachments = [], idx = 0, msgObj = null) {
  const container = document.getElementById('chat-messages');
  if (!container) return null;

  const msg = msgObj || state.chatMessages[idx] || { role, content: text, attachments };
  ensureMessageVersions(msg);

  const msgWrapper = document.createElement('div');
  msgWrapper.className = `chat-msg-wrapper flex gap-3 max-w-3xl ${role === 'user' ? 'ml-auto justify-end' : 'mr-auto justify-start'} w-full animate-in fade-in`;
  msgWrapper.setAttribute('data-msg-index', idx);

  // Branching pagination pill (< 1/3 >)
  let branchPillHtml = '';
  if (msg.versions && msg.versions.length > 1) {
    const cur = (msg.currentVersion || 0) + 1;
    const total = msg.versions.length;
    branchPillHtml = `
      <div class="chat-branch-pill">
        <button class="chat-branch-btn btn-branch-prev" data-msg-idx="${idx}" ${msg.currentVersion === 0 ? 'disabled' : ''} title="Previous version">
          <i data-lucide="chevron-left" class="w-3 h-3"></i>
        </button>
        <span class="chat-branch-text">${cur}/${total}</span>
        <button class="chat-branch-btn btn-branch-next" data-msg-idx="${idx}" ${msg.currentVersion >= total - 1 ? 'disabled' : ''} title="Next version">
          <i data-lucide="chevron-right" class="w-3 h-3"></i>
        </button>
      </div>
    `;
  }

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
        <div class="chat-msg-actions flex items-center gap-1.5 mt-0.5">
          ${branchPillHtml}
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
      copyMessageText(e.currentTarget.getAttribute('data-text'));
    });

    // Hook branching arrows
    msgWrapper.querySelector('.btn-branch-prev')?.addEventListener('click', () => {
      switchMessageBranch(idx, msg.currentVersion - 1);
    });
    msgWrapper.querySelector('.btn-branch-next')?.addEventListener('click', () => {
      switchMessageBranch(idx, msg.currentVersion + 1);
    });

    container.appendChild(msgWrapper);
    if (window.lucide) window.lucide.createIcons({ root: msgWrapper });
    return msgWrapper;
  } else {
    msgWrapper.innerHTML = `
      <div class="w-8 h-8 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border)] flex items-center justify-center shrink-0 text-emerald-400 font-bold text-xs select-none">
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
          ${branchPillHtml}
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
      copyMessageText(e.currentTarget.getAttribute('data-text'));
    });

    // Hook branching arrows
    msgWrapper.querySelector('.btn-branch-prev')?.addEventListener('click', () => {
      switchMessageBranch(idx, msg.currentVersion - 1);
    });
    msgWrapper.querySelector('.btn-branch-next')?.addEventListener('click', () => {
      switchMessageBranch(idx, msg.currentVersion + 1);
    });

    container.appendChild(msgWrapper);
    if (window.lucide) window.lucide.createIcons({ root: msgWrapper });
    return msgWrapper;
  }
}

function ensureMessageVersions(msg) {
  if (!msg.versions || !Array.isArray(msg.versions) || msg.versions.length === 0) {
    msg.versions = [{
      content: msg.content || '',
      attachments: msg.attachments || [],
      subsequent: []
    }];
    msg.currentVersion = 0;
  }
}

function switchMessageBranch(msgIdx, newVersion) {
  if (state.isStreaming) return;
  const msg = state.chatMessages[msgIdx];
  if (!msg || !msg.versions || newVersion < 0 || newVersion >= msg.versions.length) return;

  // Save current active subsequent branch messages into current version
  msg.versions[msg.currentVersion].subsequent = state.chatMessages.slice(msgIdx + 1);

  // Switch active version
  msg.currentVersion = newVersion;
  msg.content = msg.versions[newVersion].content;
  if (msg.role === 'user') {
    msg.attachments = msg.versions[newVersion].attachments || [];
  }

  // Restore saved subsequent branch messages
  const restored = msg.versions[newVersion].subsequent || [];
  state.chatMessages = state.chatMessages.slice(0, msgIdx + 1).concat(restored);

  saveCurrentChatSession();
  renderAllMessages();
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

    ensureMessageVersions(msg);
    // Save current branch subsequent messages
    msg.versions[msg.currentVersion].subsequent = state.chatMessages.slice(msgIdx + 1);

    // Push new branch version
    msg.versions.push({
      content: newText,
      attachments: msg.attachments || [],
      subsequent: []
    });
    msg.currentVersion = msg.versions.length - 1;
    msg.content = newText;

    // Truncate messages after this point in active thread
    state.chatMessages = state.chatMessages.slice(0, msgIdx + 1);

    saveCurrentChatSession();
    renderAllMessages();
    await triggerChatStream();
  });
}

function regenerateResponse(assistantIdx) {
  if (state.isStreaming) {
    showToast('Busy', 'Please wait for current generation to finish or click Stop.', 'warning');
    return;
  }

  const msg = state.chatMessages[assistantIdx];
  if (!msg || msg.role !== 'assistant') return;

  ensureMessageVersions(msg);
  // Save subsequent messages (if any)
  msg.versions[msg.currentVersion].subsequent = state.chatMessages.slice(assistantIdx + 1);

  // Truncate thread after assistant message, we will append a fresh version
  state.chatMessages = state.chatMessages.slice(0, assistantIdx);

  renderAllMessages();
  triggerChatStream(msg);
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

  // Add User Message to History with branching version container
  const userMsg = {
    role: 'user',
    content: prompt,
    attachments: currentAttachments,
    versions: [
      { content: prompt, attachments: currentAttachments, subsequent: [] }
    ],
    currentVersion: 0
  };
  state.chatMessages.push(userMsg);

  updateActiveSessionTitleFromPrompt(prompt);
  saveCurrentChatSession();
  renderAllMessages();
  await triggerChatStream();
}

export function formatDurationDisplay(seconds) {
  const s = parseFloat(seconds) || 0;
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const rem = (s % 60).toFixed(0);
    return `${m}m ${rem}s`;
  }
  return `${s >= 10 ? s.toFixed(0) : s.toFixed(1)}s`;
}

async function triggerChatStream(existingAssistantMsg = null) {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  // Add Empty Assistant Message Container
  const assistantIdx = state.chatMessages.length;
  const assistantBubble = appendMessage('assistant', '', [], assistantIdx);
  container.scrollTop = container.scrollHeight;

  // Build Payload from current active conversation thread
  const messagesPayload = [];
  if (state.selectedPreset) {
    const systemPrompts = {
      coder: 'You are an expert programming assistant and senior software engineer. Provide concise, clean, well-commented code.',
      vision: 'You are a visual inspection assistant. Analyze images thoroughly with detailed descriptions of objects, text, aesthetics, and colors.',
      creative: 'You are an imaginative storyteller and creative writer with vivid descriptive flair.',
      uncensored: 'You are an unfiltered, direct AI assistant. Answer queries completely, objectively, and without unsolicited lectures.'
    };
    if (systemPrompts[state.selectedPreset]) {
      messagesPayload.push({ role: 'system', content: systemPrompts[state.selectedPreset] });
    }
  }

  // Include up to last 20 messages for context
  const contextSlice = state.chatMessages.slice(-20);
  for (const m of contextSlice) {
    if (m.attachments && m.attachments.length > 0) {
      const parts = [{ type: 'text', text: m.content || '' }];
      for (const a of m.attachments) {
        parts.push({
          type: 'image_url',
          image_url: { url: a.dataUrl }
        });
      }
      messagesPayload.push({ role: m.role, content: parts });
    } else {
      messagesPayload.push({ role: m.role, content: m.content });
    }
  }

  setStreamingState(true);
  state.abortController = new AbortController();

  let fullResponse = '';
  let receivedTokens = 0;
  const startTime = Date.now();

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
    let hasOpenedThinkTag = false;
    let hasClosedThinkTag = false;
    let thinkStartTime = null;
    let thinkDurationSec = null;
    let thinkTicker = null;

    const startThinkingTimer = () => {
      if (!thinkStartTime) {
        thinkStartTime = Date.now();
        thinkTicker = setInterval(() => {
          if (hasOpenedThinkTag && !hasClosedThinkTag && thinkStartTime) {
            const elapsed = Math.max(1, Math.round((Date.now() - thinkStartTime) / 1000));
            const counterEl = assistantBubble?.querySelector('.group-think.is-thinking .think-counter');
            if (counterEl) {
              counterEl.textContent = `Thinking for ${formatDurationDisplay(elapsed)}...`;
            }
          }
        }, 150);
      }
    };

    const stopThinkingTimer = () => {
      if (thinkTicker) {
        clearInterval(thinkTicker);
        thinkTicker = null;
      }
      if (thinkStartTime && thinkDurationSec === null) {
        thinkDurationSec = ((Date.now() - thinkStartTime) / 1000).toFixed(1);
        const timeLabel = formatDurationDisplay(thinkDurationSec);
        fullResponse = fullResponse.replace(/<think(?:\s+(?:time|duration)="[^"]*")?>/, `<think time="${timeLabel}">`);
      }
    };

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
            const choice = parsed.choices?.[0];
            const deltaObj = choice?.delta;

            // Extract reasoning tokens (DeepSeek R1, Qwen reasoning, llama-server format)
            const reasoningChunk = deltaObj?.reasoning_content ?? deltaObj?.reasoning ?? parsed.reasoning_content ?? parsed.reasoning ?? '';
            // Extract standard text content tokens
            const contentChunk = deltaObj?.content ?? parsed.content ?? '';

            let chunkRendered = false;

            // 1. Process reasoning stream
            if (reasoningChunk) {
              if (!hasOpenedThinkTag) {
                startThinkingTimer();
                fullResponse += '<think>';
                hasOpenedThinkTag = true;
              }
              fullResponse += reasoningChunk;
              receivedTokens++;
              chunkRendered = true;
            }

            // 2. Process content stream
            if (contentChunk) {
              // If reasoning was previously streaming via reasoning_content and not yet closed, close it now
              if (hasOpenedThinkTag && !hasClosedThinkTag) {
                stopThinkingTimer();
                fullResponse += '</think>\n\n';
                hasClosedThinkTag = true;
              }

              // Detect raw <think> / </think> tags inside contentChunk
              if (contentChunk.includes('<think>')) {
                hasOpenedThinkTag = true;
                startThinkingTimer();
              }
              if (contentChunk.includes('</think>')) {
                hasClosedThinkTag = true;
                stopThinkingTimer();
              }

              fullResponse += contentChunk;
              receivedTokens++;
              chunkRendered = true;
            }

            if (chunkRendered) {
              // While actively thinking, stamp current elapsed seconds into the unclosed think tag for live display
              let renderPayload = fullResponse;
              if (hasOpenedThinkTag && !hasClosedThinkTag && thinkStartTime) {
                const liveSec = Math.max(1, Math.round((Date.now() - thinkStartTime) / 1000));
                renderPayload = renderPayload.replace(/<think(?:\s+(?:time|duration)="[^"]*")?>/, `<think time="${formatDurationDisplay(liveSec)}">`);
              }

              updateAssistantMessage(assistantBubble, renderPayload, false);

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

    // Ensure any trailing opened <think> tag is closed cleanly when stream ends
    if (hasOpenedThinkTag && !hasClosedThinkTag) {
      stopThinkingTimer();
      fullResponse += '</think>\n\n';
      hasClosedThinkTag = true;
    } else if (fullResponse.includes('<think>') && !fullResponse.includes('</think>')) {
      stopThinkingTimer();
      fullResponse += '</think>\n\n';
    } else if (thinkStartTime && thinkDurationSec === null) {
      stopThinkingTimer();
    }

    const elapsedSec = Math.max(0.01, (Date.now() - startTime) / 1000);
    const finalTps = (elapsedSec > 0.2 && receivedTokens > 0) ? Number((receivedTokens / elapsedSec).toFixed(1)) : 0;
    if (finalTps > 0) state.currentTps = finalTps;

    // Save response into active conversation
    if (existingAssistantMsg) {
      existingAssistantMsg.versions.push({
        content: fullResponse,
        subsequent: [],
        generationSec: Number(elapsedSec.toFixed(2)),
        generatedTokens: receivedTokens,
        tps: finalTps
      });
      existingAssistantMsg.currentVersion = existingAssistantMsg.versions.length - 1;
      existingAssistantMsg.content = fullResponse;
      existingAssistantMsg.generationSec = Number(elapsedSec.toFixed(2));
      existingAssistantMsg.generatedTokens = receivedTokens;
      existingAssistantMsg.tps = finalTps;
      state.chatMessages.push(existingAssistantMsg);
    } else {
      const assistantMsg = {
        role: 'assistant',
        content: fullResponse,
        generationSec: Number(elapsedSec.toFixed(2)),
        generatedTokens: receivedTokens,
        tps: finalTps,
        versions: [{
          content: fullResponse,
          subsequent: [],
          generationSec: Number(elapsedSec.toFixed(2)),
          generatedTokens: receivedTokens,
          tps: finalTps
        }],
        currentVersion: 0
      };
      state.chatMessages.push(assistantMsg);
    }

    saveCurrentChatSession();
    updateAssistantMessage(assistantBubble, fullResponse, true, assistantIdx);
    renderAllMessages();
  } catch (err) {
    if (err.name !== 'AbortError') {
      let msg = err.message || 'Unknown network error';
      if (msg === 'Failed to fetch' || msg.toLowerCase().includes('network')) {
        msg = `Network connection to http://127.0.0.1:${state.config.port || 8080} failed. Please verify the server is running.`;
      }
      const errMsg = `*Error: ${msg}*`;
      updateAssistantMessage(assistantBubble, errMsg, true, assistantIdx);
      state.chatMessages.push({ role: 'assistant', content: errMsg, versions: [{ content: errMsg, subsequent: [] }], currentVersion: 0 });
      saveCurrentChatSession();
    } else {
      if (fullResponse) {
        const elapsedSec = Math.max(0.01, (Date.now() - startTime) / 1000);
        const finalTps = (elapsedSec > 0.2 && receivedTokens > 0) ? Number((receivedTokens / elapsedSec).toFixed(1)) : 0;
        if (finalTps > 0) state.currentTps = finalTps;

        const partialMsg = {
          role: 'assistant',
          content: fullResponse,
          generationSec: Number(elapsedSec.toFixed(2)),
          generatedTokens: receivedTokens,
          tps: finalTps,
          versions: [{
            content: fullResponse,
            subsequent: [],
            generationSec: Number(elapsedSec.toFixed(2)),
            generatedTokens: receivedTokens,
            tps: finalTps
          }],
          currentVersion: 0
        };
        state.chatMessages.push(partialMsg);
        saveCurrentChatSession();
        updateAssistantMessage(assistantBubble, fullResponse, true, assistantIdx);
        renderAllMessages();
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
    updateChatTokenBadge();
  }
}

function updateAssistantMessage(msgDiv, markdownText, isComplete = false, msgIndex = null) {
  if (!msgDiv) return;
  const bubble = msgDiv.querySelector('.chat-bubble-content');
  if (!bubble) return;

  // Track if reasoning was actively generating or already completed
  const existingThink = bubble.querySelector('details.group-think');
  const wasActivelyThinking = existingThink ? existingThink.classList.contains('is-thinking') : false;
  // If user manually clicked open/closed after reasoning finished, preserve their explicit choice
  const userManuallyOpened = existingThink && !wasActivelyThinking ? existingThink.open : null;

  bubble.innerHTML = renderMarkdownWithThinking(markdownText);

  // If reasoning was already finished previously and user had manually toggled it, restore their choice
  if (userManuallyOpened !== null) {
    const newThink = bubble.querySelector('details.group-think');
    if (newThink) newThink.open = userManuallyOpened;
  }

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

/**
 * Normalizes Markdown tables produced by LLMs.
 * Removes empty lines between table rows, ensures proper delimiters,
 * and isolates table blocks with boundary spacing for reliable GFM parsing.
 */
function cleanMarkdownTables(text) {
  if (!text || !text.includes('|')) return text;

  const lines = text.split('\n');
  const result = [];

  const getColCount = (rowStr) => {
    const s = rowStr.trim();
    const parts = s.split('|');
    let count = parts.length;
    if (s.startsWith('|')) count--;
    if (s.endsWith('|')) count--;
    return Math.max(1, count);
  };

  const isTableLine = (str, inBlock = false) => {
    const s = str.trim();
    if (!s) return false;
    if (s.startsWith('|')) return true;
    if (inBlock && s.includes('|')) return true;
    if (s.includes('|') && !s.startsWith('#') && !s.startsWith('>') && !s.startsWith('- ') && !s.startsWith('* ')) {
      return s.split('|').length >= 3 || (s.includes('---') && s.includes('|'));
    }
    return false;
  };

  const isDelimiterLine = (str) => {
    const s = str.trim();
    return /^[|:\s-]+$/.test(s) && s.includes('---') && s.includes('|');
  };

  let inTableBlock = false;
  let inCodeBlock = false;
  let tableRows = [];

  const flushTableBlock = () => {
    if (tableRows.length === 0) return;

    if (tableRows.length >= 2) {
      const headerCols = getColCount(tableRows[0]);
      if (isDelimiterLine(tableRows[1])) {
        const delimCols = getColCount(tableRows[1]);
        if (delimCols < headerCols) {
          tableRows[1] = '|' + '---|'.repeat(headerCols);
        }
      } else {
        // Missing delimiter line entirely
        const delimiterRow = '|' + '---|'.repeat(headerCols);
        tableRows.splice(1, 0, delimiterRow);
      }
    }

    // Ensure leading empty line before table block
    if (result.length > 0 && result[result.length - 1] !== '') {
      result.push('');
    }

    for (const row of tableRows) {
      result.push(row);
    }

    // Ensure trailing empty line after table block
    result.push('');
    tableRows = [];
    inTableBlock = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      if (inTableBlock) flushTableBlock();
      inCodeBlock = !inCodeBlock;
      result.push(line);
      continue;
    }

    if (inCodeBlock) {
      result.push(line);
      continue;
    }

    if (isTableLine(trimmed, inTableBlock)) {
      inTableBlock = true;
      tableRows.push(trimmed);
    } else if (inTableBlock && trimmed === '') {
      // Look ahead to check if table continues after blank line
      let nextIsTable = false;
      for (let j = i + 1; j < lines.length; j++) {
        const nextTrimmed = lines[j].trim();
        if (nextTrimmed !== '') {
          if (isTableLine(nextTrimmed, true)) nextIsTable = true;
          break;
        }
      }
      if (!nextIsTable) {
        flushTableBlock();
      }
      // If table continues, drop the blank line so rows stay contiguous
    } else {
      if (inTableBlock) {
        flushTableBlock();
      }
      result.push(line);
    }
  }

  if (inTableBlock) {
    flushTableBlock();
  }

  return result.join('\n');
}

export function renderMarkdownWithThinking(text) {
  if (!text) return '';

  let raw = text;

  // Auto-wrap legacy auto-wake messages if missing explicit <status> tag
  if (!raw.includes('<status>') && raw.includes('Auto-waking LLM server')) {
    raw = raw.replace(/(\*?Auto-waking LLM server[\s\S]*?(?:Processing prompt\.\.\.|processing\.\.\.)\*?\n*)/gi, '<status>$1</status>\n\n');
  }

  // Normalize alternative thinking tags (<thought>, <thinking>)
  raw = raw
    .replace(/<thought>/gi, '<think>')
    .replace(/<\/thought>/gi, '</think>')
    .replace(/<thinking>/gi, '<think>')
    .replace(/<\/thinking>/gi, '</think>');

  // 1. Parse completed <status> ... </status> tags (Engine Lifecycle & Auto-Wake) - Collapsed by default when finished
  let processed = raw.replace(/<status>([\s\S]*?)<\/status>/gi, (match, p1) => {
    return `<details class="group-status mb-3 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl p-3"><summary class="flex items-center justify-between cursor-pointer select-none text-xs font-semibold text-cyan-400 hover:text-cyan-300 transition-colors list-none"><div class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-cyan-400 shrink-0"></span><span>Engine Status</span></div><svg class="w-3.5 h-3.5 transition-transform duration-200 details-chevron text-[var(--text-muted)]" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd"/></svg></summary><div class="text-xs text-[var(--text-secondary)] font-mono mt-2 pt-2 border-t border-[var(--border)] leading-relaxed whitespace-pre-wrap select-text">${escapeHtml(p1.trim())}</div></details>\n\n`;
  });

  // 2. Handle active status (while waking or executing) - Open while active
  if (processed.includes('<status>') && !processed.includes('</status>')) {
    processed = processed.replace(/<status>([\s\S]*)$/gi, (match, p1) => {
      return `<details open class="group-status mb-3 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl p-3 is-status-active"><summary class="flex items-center justify-between cursor-pointer select-none text-xs font-semibold text-cyan-400 hover:text-cyan-300 transition-colors list-none"><div class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-cyan-400 animate-ping shrink-0"></span><span>Auto-Waking Engine...</span></div><svg class="w-3.5 h-3.5 transition-transform duration-200 details-chevron text-[var(--text-muted)]" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd"/></svg></summary><div class="text-xs text-[var(--text-secondary)] font-mono mt-2 pt-2 border-t border-[var(--border)] leading-relaxed whitespace-pre-wrap select-text">${escapeHtml(p1.trim())}</div></details>\n\n`;
    });
  }

  // 3. Parse completed <think> ... </think> tags - Auto-closes once thinking finishes, user can click to open anytime
  processed = processed.replace(/<think(?:\s+(?:time|duration)="([^"]+)")?>([\s\S]*?)<\/think>/gi, (match, durationAttr, p1) => {
    const thinkingText = p1.trim();
    if (!thinkingText) return '';

    let timeText = durationAttr;
    if (!timeText) {
      // Fallback estimate based on characters/tokens for legacy messages
      const estTokens = Math.max(1, Math.ceil(thinkingText.length / 3.7));
      const estSec = Math.max(0.5, (estTokens / 28)).toFixed(1);
      timeText = `${estSec}s`;
    }

    return `<details class="group-think mb-3 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl p-3"><summary class="flex items-center justify-between cursor-pointer select-none text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition-colors list-none"><div class="flex items-center gap-2"><span>💡</span><span class="think-label font-medium text-emerald-300/90">Thought for <span class="font-mono text-emerald-400 font-semibold">${escapeHtml(timeText)}</span></span></div><svg class="w-3.5 h-3.5 transition-transform duration-200 details-chevron text-[var(--text-muted)]" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd"/></svg></summary><div class="think-content text-xs text-[var(--text-secondary)] mt-2 pt-2 border-t border-[var(--border)] leading-relaxed whitespace-pre-wrap select-text">${escapeHtml(thinkingText)}</div></details>\n\n`;
  });

  // 4. Handle active thinking (while unclosed) - Open while actively thinking so user sees thoughts in real time
  if (processed.includes('<think') && !processed.includes('</think>')) {
    processed = processed.replace(/<think(?:\s+(?:time|duration)="([^"]+)")?>([\s\S]*)$/gi, (match, durationAttr, p1) => {
      const thinkingText = p1.trim();
      const timeText = durationAttr || '1s';
      return `<details open class="group-think mb-3 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl p-3 is-thinking"><summary class="flex items-center justify-between cursor-pointer select-none text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition-colors list-none"><div class="flex items-center gap-2"><span>💡</span><span class="think-label font-medium"><span class="think-counter">Thinking for ${escapeHtml(timeText)}...</span></span><span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span></div><svg class="w-3.5 h-3.5 transition-transform duration-200 details-chevron text-[var(--text-muted)]" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd"/></svg></summary><div class="think-content text-xs text-[var(--text-secondary)] mt-2 pt-2 border-t border-[var(--border)] leading-relaxed whitespace-pre-wrap select-text">${escapeHtml(thinkingText)}</div></details>\n\n`;
    });
  }

  if (window.marked) {
    // Sanitize and structure table blocks so marked reliably enters table parsing mode
    processed = cleanMarkdownTables(processed);

    let html = window.marked.parse(processed);

    // Wrap all <table> elements in responsive scroll containers with auto Arabic RTL detection
    html = html.replace(/<table>([\s\S]*?)<\/table>/gi, (match, tableContent) => {
      const isArabic = /[\u0600-\u06FF]/.test(tableContent);
      const dirAttr = isArabic ? 'dir="rtl"' : 'dir="ltr"';
      const rtlClass = isArabic ? ' rtl-table' : '';
      return `<div class="table-container${rtlClass}" ${dirAttr}><table class="chat-table">${tableContent}</table></div>`;
    });

    // Unpack any accidental wrapping of table-containers inside <p>
    html = html.replace(/<p>\s*(<div class="table-container[\s\S]*?<\/div>)\s*<\/p>/gi, '$1');

    return html;
  }
  return escapeHtml(processed);
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

export function setStreamingState(isStreaming) {
  state.isStreaming = isStreaming;
  const sendBtn = document.getElementById('btn-chat-send');
  const stopContainer = document.getElementById('chat-stop-container');

  if (isStreaming) {
    if (sendBtn) {
      sendBtn.className = 'p-2.5 bg-[#202020] hover:bg-[#2c2c2c] border border-white/10 text-white rounded-xl font-bold transition-all shrink-0 flex items-center justify-center cursor-pointer shadow-md';
      sendBtn.title = 'Stop generating';
      sendBtn.innerHTML = '<span class="w-3.5 h-3.5 bg-rose-500 rounded-xs block"></span>';
    }
    if (stopContainer) stopContainer.classList.remove('hidden');
  } else {
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

function copyMessageText(text) {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    showToast('Copied', 'Message content copied to clipboard.', 'info', 1200);
  }).catch(() => {
    showToast('Copy Failed', 'Clipboard access denied.', 'error', 1500);
  });
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

function isImageFile(file) {
  if (!file) return false;
  if (file.type && file.type.startsWith('image/')) return true;
  if (file.name && /\.(png|jpe?g|webp|gif|bmp|tiff?|ico|avif)$/i.test(file.name)) return true;
  return false;
}

function handlePasteImageEvent(e) {
  const clipboardData = e.clipboardData || window.clipboardData;
  if (!clipboardData) return;

  const imageFiles = [];

  // 1. Check items (Blobs / Files in clipboard)
  const items = clipboardData.items;
  if (items && items.length > 0) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file' && (item.type.startsWith('image/') || item.type === '')) {
        const file = item.getAsFile();
        if (file && (file.type.startsWith('image/') || isImageFile(file))) {
          imageFiles.push(file);
        }
      }
    }
  }

  // 2. Fallback to files list if items was empty
  if (imageFiles.length === 0 && clipboardData.files && clipboardData.files.length > 0) {
    for (let i = 0; i < clipboardData.files.length; i++) {
      const file = clipboardData.files[i];
      if (isImageFile(file)) {
        imageFiles.push(file);
      }
    }
  }

  if (imageFiles.length > 0) {
    e.preventDefault();
    handleIncomingImageFiles(imageFiles, 'pasted');
  }
}

function handleIncomingImageFiles(files, source = 'pasted') {
  if (!files || files.length === 0) return;
  let loadedCount = 0;
  const total = files.length;

  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const safeName = file.name || `Pasted_Image_${Date.now()}.png`;
      state.attachedImages.push({
        name: safeName,
        dataUrl: event.target.result
      });
      loadedCount++;
      if (loadedCount === total) {
        renderAttachmentPreviews();
        showToast('Image Attached', `${total > 1 ? total + ' images' : 'Image'} ${source} from clipboard.`, 'success', 1800);
      }
    };
    reader.readAsDataURL(file);
  });
}

// ==========================================
// SESSION & CONTEXT TOKEN TELEMETRY INSPECTOR
// ==========================================

function getSystemPromptTokens() {
  const selectedPreset = state.selectedPreset || 'general';
  if (state.config?.persona_presets && state.config.persona_presets[selectedPreset]) {
    return Math.max(1, Math.ceil(state.config.persona_presets[selectedPreset].length / 3.7));
  }
  const defaultPrompts = {
    coder: 'You are an expert programming assistant and senior software engineer. Provide concise, clean, well-commented code.',
    vision: 'You are a visual inspection assistant. Analyze images thoroughly with detailed descriptions of objects, text, aesthetics, and colors.',
    creative: 'You are an imaginative storyteller and creative writer with vivid descriptive flair.',
    uncensored: 'You are an unfiltered, direct AI assistant. Answer queries completely, objectively, and without unsolicited lectures.'
  };
  if (defaultPrompts[selectedPreset]) {
    return Math.max(1, Math.ceil(defaultPrompts[selectedPreset].length / 3.7));
  }
  return 0;
}

export function calculateSessionTokenStats() {
  const currentSession = (state.chatSessions || []).find(s => s.id === state.activeSessionId) || {
    id: 'default',
    title: 'New Conversation',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: state.chatMessages || []
  };

  const msgs = state.chatMessages || currentSession.messages || [];
  let userMsgs = 0;
  let assistantMsgs = 0;
  let inputTokens = getSystemPromptTokens();
  let outputTokens = 0;
  let reasoningTokens = 0;

  let recordedGenSec = 0;
  let recordedTokens = 0;
  let tpsSamples = [];

  for (const msg of msgs) {
    const content = typeof msg.content === 'string' ? msg.content : '';
    if (msg.role === 'user') {
      userMsgs++;
      const textToks = Math.max(1, Math.ceil(content.length / 3.7));
      const imageToks = (msg.attachments?.length || 0) * 576;
      inputTokens += textToks + imageToks;
    } else if (msg.role === 'assistant') {
      assistantMsgs++;
      // Extract reasoning tokens from <think>...</think>
      const thinkMatches = content.match(/<think>([\s\S]*?)<\/think>/g);
      let thinkChars = 0;
      if (thinkMatches) {
        for (const tm of thinkMatches) {
          thinkChars += tm.length;
        }
      }
      const answerChars = Math.max(0, content.length - thinkChars);
      const thinkToks = Math.ceil(thinkChars / 3.7);
      const answerToks = Math.ceil(answerChars / 3.7);
      reasoningTokens += thinkToks;
      outputTokens += answerToks;

      // Track TPS and generation time
      if (msg.generationSec && msg.generationSec > 0) {
        recordedGenSec += msg.generationSec;
        const msgTokens = (msg.generatedTokens && msg.generatedTokens > 0) ? msg.generatedTokens : (thinkToks + answerToks);
        recordedTokens += msgTokens;
        tpsSamples.push(msgTokens / msg.generationSec);
      } else if (msg.tps && msg.tps > 0) {
        tpsSamples.push(msg.tps);
      } else {
        // Fallback: check for stamped thinking time in message text
        const timeMatch = content.match(/<think(?:\s+(?:time|duration)="([^"]+)")?>/i);
        if (timeMatch && timeMatch[1]) {
          const timeStr = timeMatch[1];
          let parsedSec = 0;
          const mMatch = timeStr.match(/(\d+)m/);
          const sMatch = timeStr.match(/([\d.]+)s/);
          if (mMatch) parsedSec += parseInt(mMatch[1], 10) * 60;
          if (sMatch) parsedSec += parseFloat(sMatch[1]);
          if (parsedSec > 0 && thinkToks > 0) {
            recordedGenSec += parsedSec;
            recordedTokens += thinkToks;
            tpsSamples.push(thinkToks / parsedSec);
          }
        }
      }
    }
  }

  const totalTokens = inputTokens + outputTokens + reasoningTokens;
  const contextLimit = state.config?.context_size || state.config?.ctx_size || 65536;
  const usagePercent = Math.min(100, Math.round((totalTokens / contextLimit) * 100));

  let avgTps = null;
  if (recordedGenSec > 0 && recordedTokens > 0) {
    avgTps = Number((recordedTokens / recordedGenSec).toFixed(1));
  } else if (tpsSamples.length > 0) {
    avgTps = Number((tpsSamples.reduce((a, b) => a + b, 0) / tpsSamples.length).toFixed(1));
  } else if (currentSession.avgTps && currentSession.avgTps > 0) {
    avgTps = Number(currentSession.avgTps).toFixed(1);
  } else if (state.currentTps && state.currentTps > 0) {
    avgTps = Number(state.currentTps).toFixed(1);
  }

  const totalGenerationSec = recordedGenSec > 0 ? recordedGenSec : (currentSession.totalGenerationSec || 0);

  return {
    session: currentSession,
    messagesCount: msgs.length,
    userMessages: userMsgs,
    assistantMessages: assistantMsgs,
    inputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
    contextLimit,
    usagePercent,
    avgTps,
    totalGenerationSec
  };
}

export function formatStatsDate(ts) {
  if (!ts) return '--';
  try {
    const d = new Date(ts);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(d);
  } catch {
    return new Date(ts).toLocaleString();
  }
}

export async function updateChatTokenBadge() {
  const stats = calculateSessionTokenStats();

  const badgeCtx = document.getElementById('chat-token-badge-ctx');
  const badgeCache = document.getElementById('chat-token-badge-cache');

  const ctxLimitK = stats.contextLimit >= 1024 ? `${Math.round(stats.contextLimit / 1024)}k` : `${stats.contextLimit}`;
  const totalTokensFormatted = stats.totalTokens >= 1000 ? `${(stats.totalTokens / 1000).toFixed(1)}k` : `${stats.totalTokens}`;

  if (badgeCtx) {
    badgeCtx.textContent = `${totalTokensFormatted} / ${ctxLimitK} ctx`;
  }

  let cachedTokens = stats.inputTokens;
  try {
    if (state.serverRunning) {
      const telem = await api.invoke('get_slot_telemetry');
      if (telem && telem.cached_tokens !== undefined && telem.cached_tokens > 0) {
        cachedTokens = telem.cached_tokens;
      }
    }
  } catch {}

  const cacheFormatted = cachedTokens >= 1000 ? `${(cachedTokens / 1000).toFixed(1)}k` : `${cachedTokens}`;
  if (badgeCache) {
    badgeCache.textContent = `• ${cacheFormatted} cache`;
  }

  return { ...stats, cachedTokens };
}

export async function openSessionStatsModal() {
  const modal = document.getElementById('modal-session-stats');
  if (!modal) return;

  const stats = calculateSessionTokenStats();
  let cachedTokens = stats.inputTokens;

  let isOnline = state.serverRunning;
  try {
    const telem = await api.invoke('get_slot_telemetry');
    if (telem) {
      isOnline = telem.online;
      if (telem.cached_tokens !== undefined && telem.cached_tokens > 0) {
        cachedTokens = telem.cached_tokens;
      }
      if (telem.context_limit && telem.context_limit > 0) {
        stats.contextLimit = telem.context_limit;
        stats.usagePercent = Math.min(100, Math.round((stats.totalTokens / stats.contextLimit) * 100));
      }
    }
  } catch {}

  // Update status badge
  const statusBadge = document.getElementById('stats-server-status-badge');
  const statusText = document.getElementById('stats-server-status-text');
  if (statusBadge && statusText) {
    if (isOnline) {
      statusBadge.className = 'flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
      statusText.textContent = 'LLM Engine Online';
    } else {
      statusBadge.className = 'flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20';
      statusText.textContent = 'LLM Engine Offline';
    }
  }

  // Update usage bar
  const usagePercentage = document.getElementById('stats-usage-percentage');
  const usageTokensSummary = document.getElementById('stats-usage-tokens-summary');
  const usageBar = document.getElementById('stats-usage-bar');
  const usageVal = document.getElementById('stats-usage-val');

  if (usagePercentage) usagePercentage.textContent = `${stats.usagePercent}%`;
  if (usageVal) usageVal.textContent = `${stats.usagePercent}%`;
  if (usageTokensSummary) usageTokensSummary.textContent = `${stats.totalTokens.toLocaleString()} / ${stats.contextLimit.toLocaleString()} tokens`;
  if (usageBar) usageBar.style.width = `${Math.min(100, stats.usagePercent)}%`;

  // Update 2-column grid fields
  const titleEl = document.getElementById('stats-session-title');
  if (titleEl) {
    titleEl.textContent = stats.session.title || 'New Conversation';
    titleEl.setAttribute('title', stats.session.title || 'New Conversation');
  }

  const msgsCountEl = document.getElementById('stats-messages-count');
  if (msgsCountEl) msgsCountEl.textContent = stats.messagesCount.toLocaleString();

  const providerEl = document.getElementById('stats-provider');
  if (providerEl) providerEl.textContent = 'Llama.cpp (Local Engine)';

  const modelEl = document.getElementById('stats-model-name');
  if (modelEl) {
    const rawModel = state.config?.model_path || '';
    const mName = getFilename(rawModel) || 'Active Model';
    modelEl.textContent = mName;
    modelEl.setAttribute('title', rawModel || mName);
  }

  const ctxLimitEl = document.getElementById('stats-context-limit');
  if (ctxLimitEl) ctxLimitEl.textContent = stats.contextLimit.toLocaleString();

  const totalTokensEl = document.getElementById('stats-total-tokens');
  if (totalTokensEl) totalTokensEl.textContent = stats.totalTokens.toLocaleString();

  const inputTokensEl = document.getElementById('stats-input-tokens');
  if (inputTokensEl) inputTokensEl.textContent = stats.inputTokens.toLocaleString();

  const outputTokensEl = document.getElementById('stats-output-tokens');
  if (outputTokensEl) outputTokensEl.textContent = stats.outputTokens.toLocaleString();

  const reasoningTokensEl = document.getElementById('stats-reasoning-tokens');
  if (reasoningTokensEl) reasoningTokensEl.textContent = stats.reasoningTokens.toLocaleString();

  const cacheTokensEl = document.getElementById('stats-cache-tokens');
  if (cacheTokensEl) cacheTokensEl.textContent = `${cachedTokens.toLocaleString()} / 0`;

  const userMsgsEl = document.getElementById('stats-user-messages');
  if (userMsgsEl) userMsgsEl.textContent = stats.userMessages.toLocaleString();

  const assistantMsgsEl = document.getElementById('stats-assistant-messages');
  if (assistantMsgsEl) assistantMsgsEl.textContent = stats.assistantMessages.toLocaleString();

  const costEl = document.getElementById('stats-total-cost');
  if (costEl) costEl.textContent = '$0.00';

  const avgTpsEl = document.getElementById('stats-avg-tps');
  if (avgTpsEl) {
    if (stats.avgTps !== null && stats.avgTps !== undefined && stats.avgTps > 0) {
      avgTpsEl.textContent = `${stats.avgTps} T/s`;
      avgTpsEl.className = 'text-sm font-bold text-emerald-400 font-mono';
    } else {
      avgTpsEl.textContent = '--';
      avgTpsEl.className = 'text-sm font-bold text-[var(--text-muted)] font-mono';
    }
  }

  const genTimeEl = document.getElementById('stats-generation-time');
  if (genTimeEl) {
    if (stats.totalGenerationSec > 0) {
      genTimeEl.textContent = formatDurationDisplay(stats.totalGenerationSec);
    } else {
      genTimeEl.textContent = '--';
    }
  }

  const createdEl = document.getElementById('stats-session-created');
  if (createdEl) {
    createdEl.textContent = formatStatsDate(stats.session.createdAt || Date.now());
  }

  const updatedEl = document.getElementById('stats-last-activity');
  if (updatedEl) {
    updatedEl.textContent = formatStatsDate(stats.session.updatedAt || stats.session.createdAt || Date.now());
  }

  if (window.lucide) window.lucide.createIcons({ root: modal });
  modal.classList.remove('hidden');
}

export function closeSessionStatsModal() {
  document.getElementById('modal-session-stats')?.classList.add('hidden');
}

