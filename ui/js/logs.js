/**
 * Llama Server Control - Live Logs Terminal Controller
 * Supports multi-source categorization (All, Llama, SwarmUI, Other),
 * colored severity and source badges, auto-scroll, search, and clipboard export.
 */

import { api } from './api.js';
import { state } from './state.js';
import { showToast } from './toast.js';
import { updateServerUI } from './dashboard.js';

let logCounter = 0;
const milestoneThrottle = new Map();

function notifyMilestone(key, title, message) {
  const now = Date.now();
  if (milestoneThrottle.has(key) && (now - milestoneThrottle.get(key) < 8000)) {
    return;
  }
  milestoneThrottle.set(key, now);

  showToast(title, message, 'success', 5000);

  // Desktop notification if permitted/supported
  try {
    if (window.Notification && Notification.permission === 'granted') {
      new Notification(title, { body: message });
    } else if (window.Notification && Notification.permission === 'default') {
      Notification.requestPermission().then(p => {
        if (p === 'granted') new Notification(title, { body: message });
      }).catch(() => {});
    }
  } catch {}
}

function checkMilestoneLogs(text) {
  if (!text) return;

  // 1. Llama server model loaded
  if (text.includes('llama_server: model loaded') || (text.includes('model loaded') && text.includes('llama_server'))) {
    notifyMilestone('llama_model_loaded', 'Model Ready', 'Model started and ready to use!');
    state.serverRunning = true;
    updateServerUI();
    return;
  }

  // 2. SwarmUI ComfyUI backend started
  if (/Self-Start\s+ComfyUI-\d+\s+on\s+port\s+\d+\s+started/i.test(text) || (text.includes('Self-Start ComfyUI') && text.includes('started'))) {
    notifyMilestone('comfyui_started', 'ComfyUI Started', 'Self-Start ComfyUI backend started and ready.');
    return;
  }

  // 3. SwarmUI local server running
  if (/SwarmUI\s+v[0-9.]+\s*-\s*Local\s+is\s+now\s+running/i.test(text) || (text.includes('SwarmUI') && text.includes('Local is now running'))) {
    notifyMilestone('swarmui_started', 'SwarmUI Started', 'SwarmUI is now running and ready.');
    state.swarmRunning = true;
    updateServerUI();
    return;
  }
}

export function setupLogs() {
  const terminal = document.getElementById('terminal-box');
  const filterInput = document.getElementById('input-log-filter');
  const autoScrollBtn = document.getElementById('btn-log-autoscroll');
  const clearBtn = document.getElementById('btn-clear-logs');
  const copyBtn = document.getElementById('btn-copy-logs');

  // Source Filter Buttons (Show All, Llama, SwarmUI, Other)
  document.querySelectorAll('.btn-log-source').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-log-source').forEach(b => {
        b.classList.remove('active');
        b.classList.add('text-[var(--text-secondary)]');
      });
      btn.classList.add('active');
      btn.classList.remove('text-[var(--text-secondary)]');

      state.logSourceFilter = btn.getAttribute('data-source') || 'all';
      renderLogs();
    });
  });

  // Auto-scroll toggle
  autoScrollBtn?.addEventListener('click', () => {
    state.logAutoScroll = !state.logAutoScroll;
    if (state.logAutoScroll) {
      autoScrollBtn.className = 'px-2.5 py-1 rounded-lg border border-emerald-500/30 bg-emerald-500/15 text-emerald-400 text-xs font-medium cursor-pointer transition-all flex items-center gap-1.5';
      if (terminal) terminal.scrollTop = terminal.scrollHeight;
    } else {
      autoScrollBtn.className = 'px-2.5 py-1 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)] text-xs font-medium cursor-pointer transition-all flex items-center gap-1.5';
    }
  });

  // Copy visible logs
  copyBtn?.addEventListener('click', () => {
    const filtered = getFilteredLogs();
    const text = filtered.map(l => l.text).join('\n');
    if (!text) {
      showToast('Logs Empty', 'No logs available to copy.', 'info', 1500);
      return;
    }
    navigator.clipboard.writeText(text).then(() => {
      showToast('Copied', `${filtered.length} log lines copied to clipboard.`, 'info', 1500);
    }).catch(() => {
      showToast('Copy Failed', 'Clipboard access denied.', 'error', 1500);
    });
  });

  // Clear logs
  clearBtn?.addEventListener('click', () => {
    state.logs = [];
    if (terminal) terminal.replaceChildren();
    updateCounts();
    showToast('Terminal Cleared', 'Logs wiped clean.', 'info', 1200);
  });

  // Search filter
  filterInput?.addEventListener('input', () => {
    state.logFilter = filterInput.value.toLowerCase().trim();
    renderLogs();
  });

  // Listen to IPC stream events
  api.on('log', (payload) => {
    const text = typeof payload === 'string' ? payload : (payload?.text || '');
    if (!text) return;

    // Detect server readiness milestone logs to notify user
    checkMilestoneLogs(text);

    const source = (typeof payload === 'object' && payload?.source) ? payload.source : detectSource(text);
    const level = detectLevel(text);

    const logItem = {
      id: ++logCounter,
      text,
      source,
      level
    };

    state.logs.push(logItem);

    // Enforce strict 500-line buffer cap per project directives
    if (state.logs.length > 500) {
      state.logs.shift();
    }

    updateCounts();

    // Check if new line matches active source filter and text search
    const matchesSource = (state.logSourceFilter === 'all' || state.logSourceFilter === source);
    const matchesQuery = (!state.logFilter || text.toLowerCase().includes(state.logFilter));

    if (matchesSource && matchesQuery && terminal) {
      terminal.appendChild(createLogElement(logItem));

      // Keep DOM element count bounded to avoid memory leaks
      if (terminal.children.length > 500) {
        terminal.firstElementChild?.remove();
      }

      if (state.logAutoScroll) {
        terminal.scrollTop = terminal.scrollHeight;
      }
    }
  });
}

function detectSource(text) {
  if (!text) return 'other';
  if (text.startsWith('[SwarmUI') || text.includes('SwarmUI') || text.includes('ComfyUI')) {
    return 'swarm';
  }
  if (text.startsWith('[Proxy') || text.startsWith('[Auto-Sleep') || text.startsWith('[Hub') || text.startsWith('[ACTION') || text.startsWith('[INFO] Webhook')) {
    return 'other';
  }
  if (/^\s*\d+\.[\d.]+\s+[IWE]\s+/.test(text) || text.includes('llama_') || text.includes('llama-server') || text.includes('ggml_') || text.includes('slot launch') || text.includes('n_gpu_layers') || text.includes('main:') || text.includes('common_init')) {
    return 'llama';
  }
  return 'llama';
}

function detectLevel(text) {
  if (!text) return 'info';
  const lower = text.toLowerCase();
  if (lower.includes('[err') || lower.includes('error:') || lower.includes('exception:') || lower.includes('abort') || /^\s*\d+\.[\d.]+\s+E\s+/.test(text)) {
    return 'error';
  }
  if (lower.includes('[warn') || lower.includes('warning') || /^\s*\d+\.[\d.]+\s+W\s+/.test(text)) {
    return 'warn';
  }
  if (lower.includes('successfully') || lower.includes('is now running') || lower.includes('wiped to 0 tokens')) {
    return 'success';
  }
  return 'info';
}

function createLogElement(log) {
  const line = document.createElement('div');
  line.className = `log-line log-src-${log.source} log-lvl-${log.level}`;

  const badge = document.createElement('span');
  badge.className = 'log-badge';

  if (log.level === 'error') {
    badge.textContent = 'ERR';
  } else if (log.level === 'warn') {
    badge.textContent = 'WARN';
  } else {
    badge.textContent = log.source === 'llama' ? 'LLAMA' : log.source === 'swarm' ? 'SWARM' : 'OTHER';
  }

  const textEl = document.createElement('span');
  textEl.className = 'log-text select-text';
  textEl.textContent = log.text;

  line.appendChild(badge);
  line.appendChild(textEl);
  return line;
}

function getFilteredLogs() {
  const currentSrc = state.logSourceFilter || 'all';
  const query = state.logFilter || '';

  return state.logs.filter(log => {
    if (currentSrc !== 'all' && log.source !== currentSrc) return false;
    if (query && !log.text.toLowerCase().includes(query)) return false;
    return true;
  });
}

function renderLogs() {
  const terminal = document.getElementById('terminal-box');
  if (!terminal) return;

  const filtered = getFilteredLogs();
  const frag = document.createDocumentFragment();

  for (const log of filtered) {
    frag.appendChild(createLogElement(log));
  }

  terminal.replaceChildren(frag);

  if (state.logAutoScroll) {
    terminal.scrollTop = terminal.scrollHeight;
  }

  updateCounts();
}

function updateCounts() {
  let countLlama = 0;
  let countSwarm = 0;
  let countOther = 0;

  for (const l of state.logs) {
    if (l.source === 'llama') countLlama++;
    else if (l.source === 'swarm') countSwarm++;
    else countOther++;
  }

  const allEl = document.getElementById('count-all');
  const llamaEl = document.getElementById('count-llama');
  const swarmEl = document.getElementById('count-swarm');
  const otherEl = document.getElementById('count-other');
  const totalCountEl = document.getElementById('log-count');

  if (allEl) allEl.textContent = state.logs.length;
  if (llamaEl) llamaEl.textContent = countLlama;
  if (swarmEl) swarmEl.textContent = countSwarm;
  if (otherEl) otherEl.textContent = countOther;
  if (totalCountEl) totalCountEl.textContent = `${state.logs.length} lines`;
}
