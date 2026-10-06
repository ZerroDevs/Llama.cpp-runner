/**
 * Llama Server Control - Live Logs Terminal Controller
 */

import { api } from './api.js';
import { state } from './state.js';

export function setupLogs() {
  const terminal = document.getElementById('terminal-box');
  const countEl = document.getElementById('log-count');
  const filterInput = document.getElementById('input-log-filter');
  const autoScrollBtn = document.getElementById('btn-log-autoscroll');
  const clearBtn = document.getElementById('btn-clear-logs');

  autoScrollBtn?.addEventListener('click', () => {
    state.logAutoScroll = !state.logAutoScroll;
    if (state.logAutoScroll) {
      autoScrollBtn.className = 'px-2.5 py-1 rounded-lg border border-emerald-500/30 bg-emerald-500/15 text-emerald-400 text-xs font-medium';
      if (terminal) terminal.scrollTop = terminal.scrollHeight;
    } else {
      autoScrollBtn.className = 'px-2.5 py-1 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)] text-xs font-medium';
    }
  });

  clearBtn?.addEventListener('click', () => {
    state.logs = [];
    if (terminal) terminal.textContent = '';
    if (countEl) countEl.textContent = '0 lines';
  });

  filterInput?.addEventListener('input', () => {
    state.logFilter = filterInput.value.toLowerCase().trim();
    renderLogs();
  });

  // Listen to IPC stream events
  api.on('log', (line) => {
    if (!line) return;
    state.logs.push(line);

    // Enforce strict 500-line buffer cap per project directives
    if (state.logs.length > 500) {
      state.logs.shift();
    }

    if (countEl) countEl.textContent = `${state.logs.length} lines`;

    if (!state.logFilter || line.toLowerCase().includes(state.logFilter)) {
      if (terminal) {
        terminal.textContent += line + '\n';
        if (state.logAutoScroll) {
          terminal.scrollTop = terminal.scrollHeight;
        }
      }
    }
  });
}

function renderLogs() {
  const terminal = document.getElementById('terminal-box');
  if (!terminal) return;

  const filtered = state.logFilter
    ? state.logs.filter(l => l.toLowerCase().includes(state.logFilter))
    : state.logs;

  terminal.textContent = filtered.join('\n');
  if (state.logAutoScroll) {
    terminal.scrollTop = terminal.scrollHeight;
  }
}
