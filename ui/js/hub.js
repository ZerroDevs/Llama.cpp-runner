/**
 * Llama Server Control - HuggingFace Model Hub Controller
 */

import { api } from './api.js';
import { state } from './state.js';
import { showToast } from './toast.js';

export function setupHub() {
  const btn = document.getElementById('btn-hub-search');
  const input = document.getElementById('input-hub-search');

  btn?.addEventListener('click', () => searchHub());
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchHub();
  });
}

export async function searchHub() {
  const input = document.getElementById('input-hub-search');
  const uncensored = document.getElementById('check-hub-uncensored')?.checked || false;
  const query = input?.value.trim() || 'Qwen2.5-Coder';
  const container = document.getElementById('hub-results');

  if (!container) return;
  container.innerHTML = '<div class="col-span-2 text-center py-10 text-xs text-cyan-400 font-mono">Searching HuggingFace GGUF models...</div>';

  try {
    const models = await api.invoke('search_hub', { query, uncensored, limit: 10 });
    if (!models || models.length === 0) {
      container.innerHTML = '<div class="col-span-2 text-center py-10 text-xs text-[var(--text-muted)]">No GGUF models found matching criteria.</div>';
      return;
    }

    container.innerHTML = '';
    models.forEach(m => {
      const card = document.createElement('div');
      card.className = 'p-4 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] hover:border-indigo-500/40 transition-all flex flex-col justify-between gap-3 shadow-xs';
      card.innerHTML = `
        <div>
          <div class="flex items-start justify-between gap-2">
            <h4 class="font-mono text-xs font-bold text-[var(--text-primary)] truncate max-w-sm" title="${m.id}">${m.id}</h4>
            <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--bg-elevated)] border border-[var(--border)] text-indigo-400 font-semibold shrink-0">❤️ ${m.likes || 0}</span>
          </div>
          <div class="text-[11px] text-[var(--text-muted)] mt-1 truncate">Downloads: ${(m.downloads || 0).toLocaleString()}</div>
        </div>
        <div class="pt-2 border-t border-[var(--border)] flex items-center justify-between">
          <button class="btn-inspect-quants px-3 py-1 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] text-xs font-medium text-[var(--text-secondary)] hover:text-white transition-colors" data-repo="${m.id}">Inspect Files</button>
        </div>
        <div class="quants-tray hidden pt-2 space-y-1.5 border-t border-[var(--border)]"></div>
      `;

      card.querySelector('.btn-inspect-quants').addEventListener('click', async (e) => {
        const tray = card.querySelector('.quants-tray');
        if (!tray.classList.contains('hidden')) {
          tray.classList.add('hidden');
          return;
        }

        tray.classList.remove('hidden');
        tray.innerHTML = '<div class="text-[11px] text-cyan-400 font-mono">Fetching .gguf files...</div>';

        const files = await api.invoke('list_hub_files', m.id);
        if (!files || files.length === 0) {
          tray.innerHTML = '<div class="text-[11px] text-[var(--text-muted)] font-mono">No .gguf files in root.</div>';
          return;
        }

        tray.innerHTML = files.slice(0, 8).map(f => `
          <div class="flex items-center justify-between text-xs py-1 px-2 rounded-lg bg-[var(--bg-base)] border border-[var(--border)]">
            <span class="font-mono text-[11px] truncate max-w-[200px]" title="${f}">${f}</span>
            <button class="btn-dl-file px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold hover:bg-emerald-500/25" data-repo="${m.id}" data-file="${f}">Download</button>
          </div>
        `).join('');

        tray.querySelectorAll('.btn-dl-file').forEach(dlBtn => {
          dlBtn.addEventListener('click', async () => {
            const rId = dlBtn.getAttribute('data-repo');
            const fName = dlBtn.getAttribute('data-file');
            const dest = state.config.models_dir || '';

            await api.invoke('download_hub_file', { repoId: rId, filename: fName, destDir: dest });
            showToast('Download Started', fName, 'info');
            startHubProgressPolling();
          });
        });
      });

      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = `<div class="col-span-2 text-center py-10 text-xs text-rose-400 font-mono">Error: ${err.message}</div>`;
  }
}

function startHubProgressPolling() {
  const banner = document.getElementById('hub-download-banner');
  const nameEl = document.getElementById('hub-dl-filename');
  const pctEl = document.getElementById('hub-dl-percent');
  const barEl = document.getElementById('hub-dl-bar');
  const speedEl = document.getElementById('hub-dl-speed');
  const etaEl = document.getElementById('hub-dl-eta');

  if (banner) banner.classList.remove('hidden');

  const pollInterval = setInterval(async () => {
    try {
      const p = await api.invoke('get_download_progress');
      if (p) {
        if (p.filename && nameEl) nameEl.textContent = p.filename;
        if (pctEl) pctEl.textContent = `${p.percent}%`;
        if (barEl) barEl.style.width = `${p.percent}%`;
        if (speedEl) speedEl.textContent = p.speed || '0 MB/s';
        if (etaEl) etaEl.textContent = `ETA: ${p.eta || 'Calculating...'}`;

        if (!p.active) {
          clearInterval(pollInterval);
          if (p.completed) {
            showToast('Download Finished', p.filename, 'success');
          }
          setTimeout(() => {
            if (banner) banner.classList.add('hidden');
          }, 3500);
        }
      }
    } catch {
      clearInterval(pollInterval);
    }
  }, 1000);
}
