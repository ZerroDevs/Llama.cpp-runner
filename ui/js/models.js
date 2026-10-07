/**
 * Llama Server Control - Local Models & GGUF Discovery Controller
 */

import { api } from './api.js';
import { state } from './state.js';
import { showToast } from './toast.js';
import { updateServerUI } from './dashboard.js';
import { populateChatModelSelector } from './chat.js';

export function setupModels() {
  document.getElementById('btn-rescan-models')?.addEventListener('click', () => scanLocalModels());
  document.getElementById('btn-rescan-library')?.addEventListener('click', () => scanLocalModels());

  // Browse model from Dashboard
  document.getElementById('btn-browse-model')?.addEventListener('click', async () => {
    const path = await api.invoke('select_file', 'model');
    if (path) {
      state.config.model_path = path;
      await api.invoke('save_config', state.config);
      const select = document.getElementById('select-model');
      if (select) {
        let opt = Array.from(select.options).find(o => o.value === path);
        if (!opt) {
          opt = document.createElement('option');
          opt.value = path;
          opt.textContent = `Custom: ${path.split(/[\\/]/).pop()}`;
          select.prepend(opt);
        }
        select.value = path;
      }
      showToast('Model Loaded', path.split(/[\\/]/).pop(), 'success');
      updateServerUI();
    }
  });

  // Change Models Directory
  document.getElementById('btn-change-models-dir')?.addEventListener('click', async () => {
    const dir = await api.invoke('select_directory');
    if (dir) {
      state.config.models_dir = dir;
      await api.invoke('save_config', state.config);
      showToast('Directory Set', dir, 'info');
      await scanLocalModels(dir);
    }
  });
}

// Scanned Models & Dropdown Population (PRIMARY DROPDOWN 1)
export async function scanLocalModels(folderPath = null) {
  let dir = folderPath || state.config.models_dir;
  if (!dir && state.config.model_path) {
    const idx = Math.max(state.config.model_path.lastIndexOf('\\'), state.config.model_path.lastIndexOf('/'));
    if (idx !== -1) dir = state.config.model_path.substring(0, idx);
  }
  if (!dir) return;

  try {
    const models = await api.invoke('scan_models', dir);
    if (Array.isArray(models)) {
      models.forEach(m => {
        if (m.name.toLowerCase().includes('mmproj') || m.is_vision) {
          m.is_vision = true;
          m.tag = 'Vision';
        }
      });
      state.models = models;
      populateModelDropdown(models);
      populateVisionDropdown(models);
      populateDraftDropdown(models);
      renderModelsLibrary(models);
      populateChatModelSelector();
    }
  } catch (err) {
    console.error('Model scan error:', err);
  }
}

export function populateModelDropdown(models) {
  const select = document.getElementById('select-model');
  if (!select) return;

  select.innerHTML = '';

  if (models.length === 0) {
    select.innerHTML = '<option value="">-- No models found in folder --</option>';
    return;
  }

  const currentPath = state.config.model_path || '';
  let matched = false;

  models.forEach(m => {
    const isVision = m.is_vision || m.name.toLowerCase().includes('mmproj');
    const opt = document.createElement('option');
    opt.value = m.path;
    opt.textContent = isVision ? `👁️ [Vision] ${m.name} (${m.size_gb} GB)` : `${m.name} (${m.size_gb} GB)`;
    if (m.path === currentPath) {
      opt.selected = true;
      matched = true;
    }
    select.appendChild(opt);
  });

  if (!matched && currentPath) {
    const customOpt = document.createElement('option');
    customOpt.value = currentPath;
    customOpt.textContent = `Custom: ${currentPath.split(/[\\/]/).pop()}`;
    customOpt.selected = true;
    select.prepend(customOpt);
  }

  select.onchange = () => {
    state.config.model_path = select.value;
    api.invoke('save_config', state.config);
    showToast('Model Selected', select.options[select.selectedIndex]?.text, 'info', 2000);
    updateServerUI();
  };
}

export function populateVisionDropdown(models) {
  const select = document.getElementById('select-vision-model');
  if (!select) return;

  select.innerHTML = '<option value="">-- Disabled / No Vision Projector --</option>';
  const currentVision = state.config.mmproj_path || state.config.vision_projector || '';
  let matched = false;

  // Sort mmproj / vision models first in vision dropdown
  const visionSorted = [...models].sort((a, b) => {
    const aV = a.is_vision || a.name.toLowerCase().includes('mmproj');
    const bV = b.is_vision || b.name.toLowerCase().includes('mmproj');
    if (aV && !bV) return -1;
    if (!aV && bV) return 1;
    return a.name.localeCompare(b.name);
  });

  visionSorted.forEach(m => {
    const isVision = m.is_vision || m.name.toLowerCase().includes('mmproj');
    const opt = document.createElement('option');
    opt.value = m.path;
    opt.textContent = isVision ? `⭐ [Vision Model] ${m.name} (${m.size_gb} GB)` : `${m.name} (${m.size_gb} GB)`;
    if (m.path === currentVision) {
      opt.selected = true;
      matched = true;
    }
    select.appendChild(opt);
  });

  if (!matched && currentVision) {
    const customOpt = document.createElement('option');
    customOpt.value = currentVision;
    customOpt.textContent = `Custom: ${currentVision.split(/[\\/]/).pop()}`;
    customOpt.selected = true;
    select.appendChild(customOpt);
  }

  // Auto-flag and suggest first detected mmproj model if none currently selected
  if (!matched && !currentVision) {
    const firstVision = models.find(m => m.is_vision || m.name.toLowerCase().includes('mmproj'));
    if (firstVision) {
      select.value = firstVision.path;
      state.config.mmproj_path = firstVision.path;
      state.config.vision_projector = firstVision.path;
      api.invoke('save_config', state.config);
    }
  }

  select.onchange = () => {
    state.config.mmproj_path = select.value;
    state.config.vision_projector = select.value;
    api.invoke('save_config', state.config);
    showToast('Vision Model', select.value ? select.options[select.selectedIndex]?.text : 'Disabled', 'info', 2000);
  };
}

export function populateDraftDropdown(models) {
  const select = document.getElementById('select-draft-model');
  if (!select) return;

  select.innerHTML = '<option value="">-- Disabled / No Draft Model --</option>';
  const currentDraft = state.config.draft_model || '';
  let matched = false;

  models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.path;
    opt.textContent = `${m.name} (${m.size_gb} GB)`;
    if (m.path === currentDraft) {
      opt.selected = true;
      matched = true;
    }
    select.appendChild(opt);
  });

  if (!matched && currentDraft) {
    const customOpt = document.createElement('option');
    customOpt.value = currentDraft;
    customOpt.textContent = `Custom: ${currentDraft.split(/[\\/]/).pop()}`;
    customOpt.selected = true;
    select.appendChild(customOpt);
  }

  select.onchange = () => {
    state.config.draft_model = select.value;
    api.invoke('save_config', state.config);
    showToast('Draft Model', select.value ? select.options[select.selectedIndex]?.text : 'Disabled', 'info', 2000);
  };
}

export function renderModelsLibrary(models) {
  const container = document.getElementById('models-list');
  if (!container) return;
  container.innerHTML = '';

  if (models.length === 0) {
    container.innerHTML = '<div class="col-span-2 text-center py-10 text-xs text-[var(--text-muted)]">No .gguf models found in configured directory.</div>';
    return;
  }

  models.forEach(m => {
    const isVision = m.is_vision || m.name.toLowerCase().includes('mmproj');
    const card = document.createElement('div');
    card.className = `p-4 rounded-2xl bg-[var(--bg-card)] border ${isVision ? 'border-fuchsia-500/40 bg-fuchsia-950/10' : 'border-[var(--border)]'} hover:border-[var(--brand)] transition-all flex flex-col justify-between gap-3 shadow-xs`;
    card.innerHTML = `
      <div>
        <div class="flex items-start justify-between gap-2">
          <div class="flex items-center gap-2 truncate max-w-sm">
            <h4 class="font-mono text-xs font-bold text-[var(--text-primary)] truncate">${m.name}</h4>
            ${isVision ? `
              <span class="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-fuchsia-500/15 border border-fuchsia-500/30 text-fuchsia-400 flex items-center gap-1 shrink-0">
                <i data-lucide="eye" class="w-3 h-3"></i>
                <span>Vision Model</span>
              </span>
            ` : ''}
          </div>
          <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--bg-elevated)] border border-[var(--border)] text-emerald-400 font-bold shrink-0">${m.size_gb} GB</span>
        </div>
        <div class="text-[11px] text-[var(--text-muted)] mt-1 font-mono flex items-center justify-between">
          <span>Modified: ${m.modified}</span>
          ${isVision ? '<span class="text-fuchsia-400/90 font-semibold text-[10px]">Type: Vision Projector (mmproj)</span>' : ''}
        </div>
      </div>
      <div class="flex items-center justify-between pt-2 border-t border-[var(--border)] text-xs">
        <div class="flex items-center gap-1.5">
          ${isVision ? `
            <button class="btn-set-vision px-3 py-1 rounded-lg bg-fuchsia-500/15 border border-fuchsia-500/30 text-fuchsia-400 hover:bg-fuchsia-500/25 font-semibold text-xs transition-colors flex items-center gap-1">
              <i data-lucide="eye" class="w-3 h-3"></i>
              <span>Set as Vision</span>
            </button>
            <button class="btn-select-model px-2.5 py-1 rounded-lg bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-white text-xs transition-colors">Select Primary</button>
          ` : `
            <button class="btn-select-model px-3 py-1 rounded-lg bg-[var(--brand-muted)] text-[var(--brand)] hover:bg-[var(--brand)] hover:text-black font-semibold text-xs transition-colors">Select Model</button>
          `}
        </div>
        <button class="btn-auto-vram text-[11px] text-cyan-400 hover:underline flex items-center gap-1"><i data-lucide="calculator" class="w-3 h-3"></i><span>Auto VRAM</span></button>
      </div>
    `;

    card.querySelector('.btn-set-vision')?.addEventListener('click', () => {
      state.config.mmproj_path = m.path;
      state.config.vision_projector = m.path;
      const selectV = document.getElementById('select-vision-model');
      if (selectV) selectV.value = m.path;
      api.invoke('save_config', state.config);
      showToast('Vision Model Set', m.name, 'success');
    });

    card.querySelector('.btn-select-model')?.addEventListener('click', () => {
      state.config.model_path = m.path;
      const select = document.getElementById('select-model');
      if (select) select.value = m.path;
      api.invoke('save_config', state.config);
      showToast('Model Switched', m.name, 'success');
      updateServerUI();
    });

    card.querySelector('.btn-auto-vram').addEventListener('click', async () => {
      const vramRes = await api.invoke('calculate_vram', {
        model_path: m.path,
        context_size: parseInt(document.getElementById('select-context-size')?.value || 4096),
        batch_size: 512
      });
      if (vramRes && vramRes.status === 'success') {
        showToast('VRAM Estimation', `Model: ${vramRes.model_vram_gb} GB | KV: ${vramRes.kv_cache_vram_gb} GB | Total: ${vramRes.total_vram_gb} GB`, 'info', 4500);
      }
    });

    container.appendChild(card);
  });

  if (window.lucide) window.lucide.createIcons({ root: container });
}
