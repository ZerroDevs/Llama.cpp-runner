/**
 * Llama Server Control - Modals & Overlays Controller
 * (Command Palette Ctrl+K, Quick Model Switcher Ctrl+M, PNG Metadata Chunk Inspector)
 */

import { api } from './api.js';
import { state } from './state.js';
import { showToast } from './toast.js';
import { switchTab } from './navigation.js';
import { updateServerUI } from './dashboard.js';

export function setupModals() {
  setupCommandPalette();
  setupQuickModelSwitcher();
  setupImageInspectorEvents();
  setupPromptLibraryModal();

  // Global Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      toggleCommandPalette();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      toggleQuickModel();
    }
    if (e.key === 'Escape') {
      closeAllModals();
    }
  });
}

export function closeAllModals() {
  document.getElementById('modal-image-inspector')?.classList.add('hidden');
  document.getElementById('modal-cmd-palette')?.classList.add('hidden');
  document.getElementById('modal-quick-model')?.classList.add('hidden');
  document.getElementById('modal-session-stats')?.classList.add('hidden');
  closePromptLibraryModal();
}

// ==========================================
// 1. COMMAND PALETTE (CTRL+K)
// ==========================================
function setupCommandPalette() {
  const modal = document.getElementById('modal-cmd-palette');
  const input = document.getElementById('cmd-input');
  const btn = document.getElementById('btn-cmd-palette');

  btn?.addEventListener('click', () => toggleCommandPalette());
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });

  input?.addEventListener('input', () => {
    renderCommandList(input.value.toLowerCase().trim());
  });
}

export function toggleCommandPalette() {
  const modal = document.getElementById('modal-cmd-palette');
  const input = document.getElementById('cmd-input');
  if (!modal) return;

  if (modal.classList.contains('hidden')) {
    closeAllModals();
    modal.classList.remove('hidden');
    renderCommandList('');
    if (input) {
      input.value = '';
      input.focus();
    }
  } else {
    modal.classList.add('hidden');
  }
}

function renderCommandList(query) {
  const list = document.getElementById('cmd-list');
  if (!list) return;

  const commands = [
    { name: 'Dashboard & Engine', category: 'Navigation', icon: 'gauge', action: () => switchTab('tab-dashboard') },
    { name: 'AI Chat Workspace', category: 'Navigation', icon: 'message-square', action: () => switchTab('tab-chat') },
    { name: 'Models Library', category: 'Navigation', icon: 'hard-drive', action: () => switchTab('tab-models') },
    { name: 'Model Hub (HuggingFace)', category: 'Navigation', icon: 'cloud-download', action: () => switchTab('tab-hub') },
    { name: 'Hardware Monitor', category: 'Navigation', icon: 'activity', action: () => switchTab('tab-hardware') },
    { name: 'Performance Tuning', category: 'Navigation', icon: 'sliders-horizontal', action: () => switchTab('tab-tuning') },
    { name: 'API Playground', category: 'Navigation', icon: 'code-2', action: () => switchTab('tab-api') },
    { name: 'SwarmUI Studio & Gallery', category: 'Navigation', icon: 'palette', action: () => switchTab('tab-swarm') },
    { name: 'Live Process Logs', category: 'Navigation', icon: 'terminal-square', action: () => switchTab('tab-logs') },
    { name: 'Settings & About', category: 'Navigation', icon: 'settings', action: () => switchTab('tab-settings') },
    { name: 'Prompt Library, Snippets & Commands (/snippets)', category: 'Action', icon: 'sparkles', action: () => openPromptLibraryModal() },
    { name: 'Flush KV Cache (0 tokens)', category: 'Action', icon: 'eraser', action: () => api.invoke('flush_kv_cache') },
    { name: 'Eject Model from VRAM', category: 'Action', icon: 'log-out', action: () => api.invoke('stop_server') }
  ].filter(c => !query || c.name.toLowerCase().includes(query) || c.category.toLowerCase().includes(query));

  list.innerHTML = commands.map((c, i) => `
    <div class="cmd-item" data-index="${i}">
      <div class="flex items-center gap-2.5">
        <i data-lucide="${c.icon}" class="w-4 h-4 text-cyan-400"></i>
        <span class="font-medium text-xs">${c.name}</span>
      </div>
      <span class="text-[10px] font-mono text-[var(--text-muted)]">${c.category}</span>
    </div>
  `).join('');

  list.querySelectorAll('.cmd-item').forEach(item => {
    item.addEventListener('click', () => {
      const idx = parseInt(item.getAttribute('data-index'));
      document.getElementById('modal-cmd-palette')?.classList.add('hidden');
      commands[idx].action();
    });
  });

  if (window.lucide) window.lucide.createIcons({ root: list });
}

// ==========================================
// 2. QUICK MODEL SWITCHER (CTRL+M)
// ==========================================
function setupQuickModelSwitcher() {
  const modal = document.getElementById('modal-quick-model');
  const input = document.getElementById('quick-model-search');
  const btn = document.getElementById('btn-quick-model');

  btn?.addEventListener('click', () => toggleQuickModel());
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });

  input?.addEventListener('input', () => {
    renderQuickModelList(input.value.toLowerCase().trim());
  });
}

export function toggleQuickModel() {
  const modal = document.getElementById('modal-quick-model');
  const input = document.getElementById('quick-model-search');
  if (!modal) return;

  if (modal.classList.contains('hidden')) {
    closeAllModals();
    modal.classList.remove('hidden');
    renderQuickModelList('');
    if (input) {
      input.value = '';
      input.focus();
    }
  } else {
    modal.classList.add('hidden');
  }
}

function renderQuickModelList(query) {
  const list = document.getElementById('quick-model-list');
  if (!list) return;

  const models = state.models.filter(m => !query || m.name.toLowerCase().includes(query));

  if (models.length === 0) {
    list.innerHTML = '<div class="p-4 text-center text-xs text-[var(--text-muted)] font-mono">No matching models found.</div>';
    return;
  }

  list.innerHTML = models.map((m, i) => {
    const isVision = m.is_vision || m.name.toLowerCase().includes('mmproj');
    return `
      <div class="cmd-item" data-path="${m.path}">
        <div class="flex items-center gap-2.5 truncate max-w-sm">
          <i data-lucide="${isVision ? 'eye' : 'file'}" class="w-4 h-4 ${isVision ? 'text-fuchsia-400' : 'text-emerald-400'} shrink-0"></i>
          <span class="font-mono text-xs truncate">${m.name}</span>
          ${isVision ? '<span class="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-fuchsia-500/15 border border-fuchsia-500/30 text-fuchsia-400 shrink-0">VISION</span>' : ''}
        </div>
        <span class="text-[10px] font-mono text-emerald-400 font-bold shrink-0">${m.size_gb} GB</span>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.cmd-item').forEach(item => {
    item.addEventListener('click', () => {
      const p = item.getAttribute('data-path');
      state.config.model_path = p;
      const select = document.getElementById('select-model');
      if (select) select.value = p;
      api.invoke('save_config', state.config);
      showToast('Model Activated', p.split(/[\\/]/).pop(), 'success');
      updateServerUI();
      document.getElementById('modal-quick-model')?.classList.add('hidden');
    });
  });

  if (window.lucide) window.lucide.createIcons({ root: list });
}

// ==========================================
// 3. DEEP PNG METADATA CHUNK & ZOOM INSPECTOR
// ==========================================
let currentInspectedImage = null;
let zoomLevel = 1;
let panOffset = { x: 0, y: 0 };
let isPanning = false;
let panStart = { x: 0, y: 0 };

function setupImageInspectorEvents() {
  const modal = document.getElementById('modal-image-inspector');
  const closeBtn = document.getElementById('btn-close-inspector');
  const viewport = document.getElementById('inspector-img-viewport');
  const container = document.getElementById('inspector-img-container');
  const btnFullscreen = document.getElementById('btn-modal-fullscreen');
  const btnExitFs = document.getElementById('btn-exit-fullscreen');
  const btnFolder = document.getElementById('btn-modal-folder');
  const btnCopy = document.getElementById('btn-modal-copy-img');
  const btnDelete = document.getElementById('btn-modal-delete-img');
  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomOut = document.getElementById('btn-zoom-out');
  const btnZoomReset = document.getElementById('btn-zoom-reset');

  // Close handlers
  closeBtn?.addEventListener('click', () => closeInspector());
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeInspector();
  });

  // Fullscreen toggle
  btnFullscreen?.addEventListener('click', () => toggleInspectorFullscreen());
  btnExitFs?.addEventListener('click', () => exitInspectorFullscreen());

  document.addEventListener('fullscreenchange', () => {
    const exitBtn = document.getElementById('btn-exit-fullscreen');
    if (document.fullscreenElement) {
      exitBtn?.classList.remove('hidden');
      exitBtn?.classList.add('flex');
    } else {
      exitBtn?.classList.add('hidden');
      exitBtn?.classList.remove('flex');
    }
  });

  // Toolbar Actions: Folder, Copy, Delete
  btnFolder?.addEventListener('click', async () => {
    if (currentInspectedImage) {
      await api.invoke('open_image_folder', currentInspectedImage.path);
    }
  });

  btnCopy?.addEventListener('click', async () => {
    if (currentInspectedImage) {
      await copyImageToClipboard(currentInspectedImage);
    }
  });

  btnDelete?.addEventListener('click', async () => {
    if (currentInspectedImage) {
      if (!confirm(`Permanently delete "${currentInspectedImage.filename}" from disk?`)) return;
      const res = await api.invoke('delete_image', currentInspectedImage.path);
      if (res && res.status === 'success') {
        showToast('Image Deleted', currentInspectedImage.filename, 'info');
        closeInspector();
        const refreshBtn = document.getElementById('btn-refresh-gallery');
        refreshBtn?.click();
      } else {
        showToast('Delete Failed', 'Could not delete image file.', 'error');
      }
    }
  });

  // Zoom controls (+, -, reset)
  btnZoomIn?.addEventListener('click', () => adjustZoom(0.35));
  btnZoomOut?.addEventListener('click', () => adjustZoom(-0.35));
  btnZoomReset?.addEventListener('click', () => resetZoomAndPan());

  // Mouse wheel zoom on viewport
  viewport?.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.25 : -0.25;
    adjustZoom(delta);
  }, { passive: false });

  // Pan dragging
  viewport?.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || zoomLevel <= 1) return;
    isPanning = true;
    panStart = { x: e.clientX - panOffset.x, y: e.clientY - panOffset.y };
    if (container) container.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    panOffset.x = e.clientX - panStart.x;
    panOffset.y = e.clientY - panStart.y;
    applyTransform();
  });

  window.addEventListener('mouseup', () => {
    if (isPanning) {
      isPanning = false;
      if (container) container.style.cursor = zoomLevel > 1 ? 'grab' : 'default';
    }
  });

  // Double click resets or zooms in
  viewport?.addEventListener('dblclick', () => {
    if (zoomLevel > 1) {
      resetZoomAndPan();
    } else {
      adjustZoom(1.5);
    }
  });
}

function adjustZoom(delta) {
  const newZoom = Math.min(Math.max(zoomLevel + delta, 1), 7);
  if (newZoom === 1) {
    panOffset = { x: 0, y: 0 };
  }
  zoomLevel = newZoom;
  applyTransform();
}

function resetZoomAndPan() {
  zoomLevel = 1;
  panOffset = { x: 0, y: 0 };
  applyTransform();
}

function applyTransform() {
  const container = document.getElementById('inspector-img-container');
  const lblZoom = document.getElementById('lbl-zoom-level');
  if (container) {
    container.style.transform = `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomLevel})`;
    container.style.cursor = zoomLevel > 1 ? (isPanning ? 'grabbing' : 'grab') : 'default';
  }
  if (lblZoom) {
    lblZoom.textContent = `${Math.round(zoomLevel * 100)}%`;
  }
}

function toggleInspectorFullscreen() {
  const vp = document.getElementById('inspector-img-viewport');
  if (!document.fullscreenElement) {
    if (vp?.requestFullscreen) {
      vp.requestFullscreen();
    } else if (vp?.webkitRequestFullscreen) {
      vp.webkitRequestFullscreen();
    }
  } else {
    exitInspectorFullscreen();
  }
}

function exitInspectorFullscreen() {
  if (document.fullscreenElement) {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  }
}

function closeInspector() {
  exitInspectorFullscreen();
  resetZoomAndPan();
  document.getElementById('modal-image-inspector')?.classList.add('hidden');
  currentInspectedImage = null;
}

export async function openImageInspector(img) {
  const modal = document.getElementById('modal-image-inspector');
  const imgEl = document.getElementById('inspector-img');
  const metaEl = document.getElementById('inspector-metadata-entries');

  if (!modal || !imgEl || !metaEl) return;

  closeAllModals();
  currentInspectedImage = img;
  resetZoomAndPan();

  imgEl.src = img.url;
  metaEl.innerHTML = '<div class="text-xs text-cyan-400 font-mono py-8 text-center animate-pulse">Extracting zero-copy PNG chunks...</div>';
  modal.classList.remove('hidden');

  try {
    const res = await api.invoke('get_image_metadata', img.path);
    const rawMeta = res?.metadata || (res && typeof res === 'object' && !res.status ? res : null);

    if (rawMeta && Object.keys(rawMeta).length > 0) {
      const parsed = extractSwarmParams(rawMeta);
      renderMetadataSpecSheet(metaEl, parsed, rawMeta, img);
    } else {
      renderEmptyMetadata(metaEl, img);
    }
  } catch (err) {
    metaEl.innerHTML = `<div class="text-xs text-rose-400 py-4 font-mono">Failed to read image chunks: ${escapeHtml(err.message)}</div>`;
  }

  if (window.lucide) window.lucide.createIcons({ root: modal });
}

function extractSwarmParams(rawMeta) {
  let params = {};
  if (!rawMeta) return params;

  // 1. Search for JSON chunk string in any tEXt/iTXt field
  for (const val of Object.values(rawMeta)) {
    if (typeof val === 'string' && val.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(val);
        if (parsed.sui_image_params && typeof parsed.sui_image_params === 'object') {
          params = { ...parsed.sui_image_params };
          break;
        } else if (parsed.prompt || parsed.steps || parsed.seed) {
          params = { ...parsed };
          break;
        }
      } catch (e) {}
    }
  }

  // 2. Fallbacks on named JSON keys
  if (!params.prompt && rawMeta.sui_image_params) {
    try {
      const p = typeof rawMeta.sui_image_params === 'string' ? JSON.parse(rawMeta.sui_image_params) : rawMeta.sui_image_params;
      params = { ...params, ...p };
    } catch (e) {}
  }
  if (!params.prompt && rawMeta.parameters) {
    try {
      const p = typeof rawMeta.parameters === 'string' ? JSON.parse(rawMeta.parameters) : rawMeta.parameters;
      params = { ...params, ...p };
    } catch (e) {}
  }

  // 3. Fallbacks on top-level keys
  if (!params.prompt && rawMeta.prompt) params.prompt = rawMeta.prompt;
  if (!params.negativeprompt && (rawMeta.negativeprompt || rawMeta.negative_prompt)) {
    params.negativeprompt = rawMeta.negativeprompt || rawMeta.negative_prompt;
  }
  if (!params.steps && rawMeta.steps) params.steps = rawMeta.steps;
  if (!params.cfgscale && (rawMeta.cfgscale || rawMeta.cfg_scale || rawMeta.cfg)) {
    params.cfgscale = rawMeta.cfgscale || rawMeta.cfg_scale || rawMeta.cfg;
  }
  if (!params.seed && rawMeta.seed) params.seed = rawMeta.seed;
  if (!params.width && rawMeta.width) params.width = rawMeta.width;
  if (!params.height && rawMeta.height) params.height = rawMeta.height;

  // 4. Calculate resolution string with aspect ratio: e.g. "1152x1152 (1:1)"
  if (params.width && params.height) {
    const w = parseInt(params.width);
    const h = parseInt(params.height);
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    const d = gcd(w, h) || 1;
    const aspectW = Math.round(w / d);
    const aspectH = Math.round(h / d);
    params.resolution = `${w}x${h} (${aspectW}:${aspectH})`;
  }

  // 5. Additional file metadata
  if (rawMeta['Generation Time']) params.generation_time = rawMeta['Generation Time'];
  if (rawMeta['File Size']) params.file_size = rawMeta['File Size'];
  if (rawMeta['Created']) params.created = rawMeta['Created'];

  return params;
}

function renderMetadataSpecSheet(container, params, rawMeta, img) {
  const hasPrompt = Boolean(params.prompt);
  const hasNeg = Boolean(params.negativeprompt);
  const hasRes = Boolean(params.resolution);
  const hasSeed = params.seed !== undefined && params.seed !== null && params.seed !== '';
  const hasSteps = params.steps !== undefined && params.steps !== null && params.steps !== '';
  const hasCfg = params.cfgscale !== undefined && params.cfgscale !== null && params.cfgscale !== '';

  container.innerHTML = `
    <div class="space-y-4">
      <!-- PROMPT -->
      <div class="group relative rounded-xl bg-[var(--bg-base)] border border-[var(--border)] p-3.5 space-y-1.5 transition-colors hover:border-cyan-500/40">
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-mono font-bold tracking-wider text-[var(--text-muted)] uppercase">PROMPT</span>
          <button class="btn-copy-prompt px-2 py-0.5 rounded bg-cyan-500/10 hover:bg-cyan-500/25 text-cyan-400 text-[11px] font-mono flex items-center gap-1 transition-colors" data-copy="${escapeHtml(params.prompt || '')}">
            <i data-lucide="copy" class="w-3 h-3"></i>
            <span>Copy</span>
          </button>
        </div>
        <div class="font-mono text-xs text-emerald-400 leading-relaxed select-text max-h-48 overflow-y-auto whitespace-pre-wrap break-words pr-1">
          ${escapeHtml(params.prompt || 'None')}
        </div>
      </div>

      <!-- NEGATIVE PROMPT -->
      ${hasNeg ? `
        <div class="group relative rounded-xl bg-[var(--bg-base)] border border-[var(--border)] p-3.5 space-y-1.5 transition-colors hover:border-rose-500/40">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-mono font-bold tracking-wider text-[var(--text-muted)] uppercase">NEGATIVE PROMPT</span>
            <button class="btn-copy-neg px-2 py-0.5 rounded bg-rose-500/10 hover:bg-rose-500/25 text-rose-400 text-[11px] font-mono flex items-center gap-1 transition-colors" data-copy="${escapeHtml(params.negativeprompt)}">
              <i data-lucide="copy" class="w-3 h-3"></i>
              <span>Copy</span>
            </button>
          </div>
          <div class="font-mono text-xs text-emerald-400 leading-relaxed select-text max-h-36 overflow-y-auto whitespace-pre-wrap break-words pr-1">
            ${escapeHtml(params.negativeprompt)}
          </div>
        </div>
      ` : ''}

      <!-- RESOLUTION -->
      <div class="rounded-xl bg-[var(--bg-base)] border border-[var(--border)] p-3 space-y-1">
        <span class="text-[10px] font-mono font-bold tracking-wider text-[var(--text-muted)] uppercase">RESOLUTION</span>
        <div class="font-mono text-xs text-emerald-400 font-semibold">
          ${escapeHtml(params.resolution || (img.size_kb ? `${img.size_kb} KB` : '--'))}
        </div>
      </div>

      <!-- SEED -->
      <div class="group rounded-xl bg-[var(--bg-base)] border border-[var(--border)] p-3 space-y-1 cursor-pointer hover:border-cyan-500/40" title="Click to copy seed">
        <div class="flex items-center justify-between">
          <span class="text-[10px] font-mono font-bold tracking-wider text-[var(--text-muted)] uppercase">SEED</span>
          <i data-lucide="copy" class="w-3 h-3 text-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity"></i>
        </div>
        <div class="font-mono text-xs text-emerald-400 font-semibold truncate btn-copy-seed" data-copy="${escapeHtml(String(params.seed || ''))}">
          ${escapeHtml(String(params.seed !== undefined ? params.seed : '--'))}
        </div>
      </div>

      <!-- STEPS & CFG SCALE -->
      <div class="grid grid-cols-2 gap-3">
        <div class="rounded-xl bg-[var(--bg-base)] border border-[var(--border)] p-3 space-y-1">
          <span class="text-[10px] font-mono font-bold tracking-wider text-[var(--text-muted)] uppercase">STEPS</span>
          <div class="font-mono text-xs text-emerald-400 font-semibold">
            ${escapeHtml(String(params.steps !== undefined ? params.steps : '--'))}
          </div>
        </div>

        <div class="rounded-xl bg-[var(--bg-base)] border border-[var(--border)] p-3 space-y-1">
          <span class="text-[10px] font-mono font-bold tracking-wider text-[var(--text-muted)] uppercase">CFG SCALE</span>
          <div class="font-mono text-xs text-emerald-400 font-semibold">
            ${escapeHtml(String(params.cfgscale !== undefined ? params.cfgscale : '--'))}
          </div>
        </div>
      </div>

      <!-- Extra Model / File Details -->
      ${params.model || params.generation_time || rawMeta['Created'] ? `
        <div class="rounded-xl bg-[var(--bg-base)] border border-[var(--border)] p-3 space-y-1 text-[11px] text-[var(--text-muted)]">
          ${params.model ? `<div><span class="text-[var(--text-secondary)] font-semibold">Model:</span> ${escapeHtml(params.model)}</div>` : ''}
          ${params.generation_time ? `<div><span class="text-[var(--text-secondary)] font-semibold">Gen Time:</span> ${escapeHtml(params.generation_time)}</div>` : ''}
          ${rawMeta['Created'] ? `<div><span class="text-[var(--text-secondary)] font-semibold">Created:</span> ${escapeHtml(rawMeta['Created'])}</div>` : ''}
        </div>
      ` : ''}
    </div>
  `;

  // Bind copy handlers
  container.querySelector('.btn-copy-prompt')?.addEventListener('click', (e) => {
    e.stopPropagation();
    copyTextWithFeedback(params.prompt, 'Prompt copied to clipboard.');
  });

  container.querySelector('.btn-copy-neg')?.addEventListener('click', (e) => {
    e.stopPropagation();
    copyTextWithFeedback(params.negativeprompt, 'Negative prompt copied to clipboard.');
  });

  container.querySelectorAll('.btn-copy-seed').forEach(el => {
    el.parentElement?.addEventListener('click', () => {
      if (params.seed !== undefined) {
        copyTextWithFeedback(String(params.seed), 'Seed copied to clipboard.');
      }
    });
  });

  if (window.lucide) window.lucide.createIcons({ root: container });
}

function renderEmptyMetadata(container, img) {
  container.innerHTML = `
    <div class="p-6 rounded-2xl bg-[var(--bg-base)] border border-[var(--border)] text-center space-y-3 font-mono">
      <div class="w-10 h-10 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center mx-auto">
        <i data-lucide="file-question" class="w-5 h-5"></i>
      </div>
      <div class="text-xs font-bold text-white/90 truncate">${escapeHtml(img.filename)}</div>
      <p class="text-[11px] text-[var(--text-muted)] leading-relaxed">
        No embedded PNG generation metadata was found in this file.
      </p>
      <div class="pt-2 text-[10px] text-cyan-400/80">
        Tip: Images generated directly by SwarmUI automatically include full prompts and seeds.
      </div>
    </div>
  `;
  if (window.lucide) window.lucide.createIcons({ root: container });
}

async function copyTextWithFeedback(text, successMsg) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(String(text));
    showToast('Copied', successMsg, 'info', 1600);
  } catch {
    showToast('Copy Failed', 'Unable to access clipboard.', 'error');
  }
}

async function copyImageToClipboard(img) {
  let copied = false;
  try {
    const res = await api.invoke('copy_image_to_clipboard', img.path);
    if (res && res.status === 'success') copied = true;
  } catch (err) {}

  try {
    const response = await fetch(img.url);
    const blob = await response.blob();
    if (window.ClipboardItem) {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);
      copied = true;
    }
  } catch (err) {}

  if (copied) {
    showToast('Image Copied', 'Ready to paste into Discord, folders, or graphics apps.', 'success');
  } else {
    try {
      await navigator.clipboard.writeText(img.path);
      showToast('Path Copied', img.filename, 'info');
    } catch {
      showToast('Copy Failed', 'Unable to access clipboard.', 'error');
    }
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}

// ==========================================
// 4. PROMPT LIBRARY, SNIPPETS & COMMANDS MODAL
// ==========================================

export const DEFAULT_SNIPPETS = [
  // --- SwarmUI & Diffusion Image Generation Commands ---
  {
    id: 'cmd-imagine',
    command: '/imagine',
    title: 'Direct Image Render',
    category: 'image',
    tags: ['#image', '#diffusion', '#swarm', '#raw-prompt'],
    icon: 'image',
    desc: 'Directly dispatch positive and negative prompts to SwarmUI without any LLM alteration.',
    prompt: '/imagine a high-tech obsidian laboratory with glowing cyan data charts | blurry, low quality, artifacts'
  },
  {
    id: 'cmd-draw',
    command: '/draw',
    title: 'AI-Enhanced Draw',
    category: 'image',
    tags: ['#image', '#diffusion', '#prompt-gen', '#enhance'],
    icon: 'palette',
    desc: 'LLM creatively enhances positive prompt, preserves negative prompt, then renders in SwarmUI.',
    prompt: '/draw cyberpunk neon street at rainy dusk | blurry, watermark, low quality'
  },
  {
    id: 'cmd-art',
    command: '/art',
    title: 'Full Creative Art',
    category: 'image',
    tags: ['#image', '#creative', '#rewrite', '#swarm'],
    icon: 'sparkles',
    desc: 'LLM creatively rewrites both positive and negative prompts for maximum artistic quality.',
    prompt: '/art futuristic mecha warrior standing in obsidian ruins'
  },
  {
    id: 'cmd-guess',
    command: '/guess',
    title: 'Vision Prompt Guesser',
    category: 'image',
    tags: ['#image', '#vision', '#prompt-gen', '#multimodal'],
    icon: 'eye',
    desc: 'Vision model inspects attached image and reverse-engineers positive and negative prompts.',
    prompt: '/guess'
  },
  {
    id: 'cmd-yes',
    command: '/yes',
    title: 'Confirm Guessed Render',
    category: 'image',
    tags: ['#image', '#execute', '#swarm', '#confirm'],
    icon: 'check',
    desc: 'Immediately dispatch the prompt engineered by /guess or /art to SwarmUI for GPU rendering.',
    prompt: '/yes'
  },
  {
    id: 'cmd-cfg',
    command: '/cfg',
    title: 'Set CFG Scale',
    category: 'image',
    tags: ['#image', '#settings', '#cfg', '#guidance'],
    icon: 'sliders',
    desc: 'Configure diffusion guidance scale (0.0 - 20.0). Example: /cfg 7.5',
    prompt: '/cfg 7.5'
  },
  {
    id: 'cmd-step',
    command: '/step',
    title: 'Set Sampling Steps',
    category: 'image',
    tags: ['#image', '#settings', '#steps', '#sampling'],
    icon: 'gauge',
    desc: 'Set diffusion generation sampling steps (1 - 50). Example: /step 25',
    prompt: '/step 25'
  },
  {
    id: 'cmd-res',
    command: '/res',
    title: 'Set Resolution',
    category: 'image',
    tags: ['#image', '#settings', '#resolution', '#dimensions'],
    icon: 'maximize',
    desc: 'Set generation width and height (e.g. 1024x1024, 1152x896, 1280x768).',
    prompt: '/res 1024x1024'
  },
  {
    id: 'cmd-hook',
    command: '/hook',
    title: 'Discord Webhook Dispatch',
    category: 'image',
    tags: ['#image', '#discord', '#webhook', '#share'],
    icon: 'send',
    desc: 'Post the most recently generated image directly to your configured Discord webhook.',
    prompt: '/hook'
  },

  // --- Engine & Reasoning Mode Commands ---
  {
    id: 'cmd-think',
    command: '/think',
    title: 'Reasoning Mode Toggle',
    category: 'engine',
    tags: ['#engine', '#reasoning', '#think', '#mode'],
    icon: 'brain',
    desc: 'Toggle the model thinking and reasoning process on or off. Usage: /think on or /think off',
    prompt: '/think off'
  },
  {
    id: 'cmd-fast',
    command: '/fast',
    title: 'Fast Direct Mode',
    category: 'engine',
    tags: ['#engine', '#fast', '#direct', '#low-latency'],
    icon: 'zap',
    desc: 'Execute prompt directly with assistant prefill suppression, bypassing <think> reasoning tokens.',
    prompt: '/fast '
  },

  // --- System & Hardware Commands ---
  {
    id: 'cmd-sys',
    command: '/sys',
    title: 'Hardware Telemetry HUD',
    category: 'system',
    tags: ['#system', '#hardware', '#vram', '#telemetry'],
    icon: 'activity',
    desc: 'Print real-time hardware telemetry matrix (VRAM, RAM, and CPU core utilization).',
    prompt: '/sys'
  },
  {
    id: 'cmd-eject',
    command: '/eject',
    title: 'Eject / Unload Model',
    category: 'system',
    tags: ['#system', '#vram', '#unload', '#memory'],
    icon: 'eject',
    desc: 'Unload current model from GPU memory to free 100% VRAM while keeping server online.',
    prompt: '/eject'
  },
  {
    id: 'cmd-models',
    command: '/models',
    title: 'List Local Models',
    category: 'system',
    tags: ['#system', '#models', '#gguf', '#local'],
    icon: 'layers',
    desc: 'Scan models directory and list all available .gguf model files with formatted sizes.',
    prompt: '/models'
  },
  {
    id: 'cmd-clear',
    command: '/clear',
    title: 'Clear Context & Slots',
    category: 'system',
    tags: ['#system', '#context', '#clear', '#slots'],
    icon: 'trash',
    desc: 'Wipe backend memory cache and erase active server KV prompt slots.',
    prompt: '/clear'
  },
  {
    id: 'cmd-compact',
    command: '/compact',
    title: 'Compact Chat History',
    category: 'system',
    tags: ['#system', '#context', '#compact', '#summary'],
    icon: 'minimize-2',
    desc: 'Condense previous conversation history into a dense summary block to save context.',
    prompt: '/compact'
  },
  {
    id: 'cmd-api',
    command: '/api',
    title: 'API Endpoints Guide',
    category: 'system',
    tags: ['#system', '#api', '#endpoints', '#agents'],
    icon: 'terminal',
    desc: 'Print OpenAI-compatible endpoints, port, and instructions for connecting external agents.',
    prompt: '/api'
  },
  {
    id: 'cmd-help',
    command: '/help',
    title: 'Command Help Directory',
    category: 'system',
    tags: ['#system', '#help', '#commands', '#cheatsheet'],
    icon: 'help-circle',
    desc: 'Print all available proxy slash commands and formatting syntax directly in chat.',
    prompt: '/help'
  },
  {
    id: 'cmd-snippets',
    command: '/snippets',
    title: 'Prompt Library & Macros',
    category: 'commands',
    tags: ['#commands', '#macros', '#productivity', '#library'],
    icon: 'bookmark',
    desc: 'Open the Prompt Library and Snippet Macros popup catalog.',
    prompt: '/snippets'
  },

  // --- Coding & Development Macros ---
  {
    id: 'code-review',
    command: '/review',
    title: 'Code Review',
    category: 'coding',
    tags: ['#coding', '#review', '#security', '#bugs', '#performance'],
    icon: 'code',
    desc: 'Senior code review checking bugs, bottlenecks, security, and edge cases.',
    prompt: 'Perform a comprehensive senior-level code review of the following code. Inspect for bugs, edge cases, performance bottlenecks, and security vulnerabilities. Provide actionable improvements with clean code examples:\n\n'
  },
  {
    id: 'code-refactor',
    command: '/refactor',
    title: 'Refactor & Optimize',
    category: 'coding',
    tags: ['#coding', '#refactor', '#performance', '#clean-code'],
    icon: 'wrench',
    desc: 'Clean architecture, idiomatic patterns, and performance optimization.',
    prompt: 'Refactor the following code to make it more clean, maintainable, modular, and performant. Adhere to idiomatic best practices and explain the rationale for each modification:\n\n'
  },
  {
    id: 'code-tests',
    command: '/tests',
    title: 'Generate Unit Tests',
    category: 'coding',
    tags: ['#coding', '#tests', '#qa', '#edge-cases', '#unit'],
    icon: 'check-circle-2',
    desc: 'Comprehensive unit tests covering edge cases, assertions, and error handling.',
    prompt: 'Write comprehensive, edge-case-covering unit tests for the following code. Include test cases for normal inputs, edge cases, error conditions, and null/empty values:\n\n'
  },
  {
    id: 'code-docs',
    command: '/docs',
    title: 'Write Documentation',
    category: 'coding',
    tags: ['#coding', '#docs', '#docstrings', '#architecture'],
    icon: 'book-open',
    desc: 'Clean docstrings, parameter types, architecture overview, and usage examples.',
    prompt: 'Generate clear, professional documentation for the following code or component, including parameters, return types, usage examples, and error handling:\n\n'
  },

  // --- Writing & Summary Macros ---
  {
    id: 'writing-summary',
    command: '/summary',
    title: 'Executive Summary',
    category: 'writing',
    tags: ['#writing', '#summary', '#executive', '#key-points'],
    icon: 'file-text',
    desc: 'Concise executive summary followed by actionable takeaway bullet points.',
    prompt: 'Summarize the following text concisely. Provide a 2-3 sentence executive summary followed by bullet points of key takeaways and actionable conclusions:\n\n'
  },

  // --- Translation Macros ---
  {
    id: 'trans-ar',
    command: '/arabic',
    title: 'Translate to Arabic',
    category: 'translation',
    tags: ['#translation', '#arabic', '#العربية', '#localization'],
    icon: 'languages',
    desc: 'Accurate Modern Standard Arabic translation preserving technical context.',
    prompt: 'ترجم النص التالي بدقة واحترافية إلى اللغة العربية الفصحى مع الحفاظ على المعنى والسياق والمصطلحات التقنية:\n\n'
  },
  {
    id: 'trans-en',
    command: '/english',
    title: 'Translate to English',
    category: 'translation',
    tags: ['#translation', '#english', '#fluent', '#localization'],
    icon: 'languages',
    desc: 'Idiomatic and fluent English translation preserving professional tone.',
    prompt: 'Translate the following text accurately and idiomatically into clear, fluent English while preserving technical terminology and tone:\n\n'
  },

  // --- Learning & Explanations ---
  {
    id: 'learn-explain',
    command: '/explain',
    title: 'Explain Simply (ELI5)',
    category: 'learning',
    tags: ['#learning', '#eli5', '#explain', '#analogy', '#concepts'],
    icon: 'lightbulb',
    desc: 'Plain language explanation with intuitive real-world analogies.',
    prompt: 'Explain the following concept or code simply in plain language as if explaining to a beginner, using intuitive real-world analogies:\n\n'
  }
];

export function getAllPromptSnippets() {
  let custom = [];
  try {
    const raw = localStorage.getItem('llama_prompt_snippets');
    if (raw) custom = JSON.parse(raw);
  } catch {}
  return [...DEFAULT_SNIPPETS, ...custom];
}

export function openPromptLibraryModal(categoryFilter = 'all', searchQuery = '') {
  const modal = document.getElementById('modal-prompt-library');
  if (!modal) return;
  modal.classList.remove('hidden');

  // Sync category filter buttons if specified
  if (categoryFilter) {
    document.querySelectorAll('#snippet-category-filters .snippet-cat-btn').forEach(b => {
      if (b.getAttribute('data-cat') === categoryFilter) {
        b.className = 'snippet-cat-btn active px-2.5 py-1 rounded-lg text-xs font-semibold bg-[var(--brand)] text-black cursor-pointer shrink-0';
      } else {
        b.className = 'snippet-cat-btn px-2.5 py-1 rounded-lg text-xs font-medium bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border)] cursor-pointer shrink-0';
      }
    });
  }

  const searchInput = document.getElementById('input-snippet-search');
  if (searchInput && searchQuery) {
    searchInput.value = searchQuery;
  }

  renderPromptSnippets(categoryFilter || 'all', searchQuery || searchInput?.value || '');
  if (window.lucide) window.lucide.createIcons({ root: modal });
}

export function closePromptLibraryModal() {
  const modal = document.getElementById('modal-prompt-library');
  if (modal) modal.classList.add('hidden');
  const form = document.getElementById('form-new-snippet');
  if (form) form.classList.add('hidden');
}

export function renderPromptSnippets(categoryFilter = 'all', searchQuery = '') {
  const container = document.getElementById('snippet-cards-list');
  if (!container) return;

  const allSnippets = getAllPromptSnippets();
  const q = (searchQuery || '').trim().toLowerCase();

  const filtered = allSnippets.filter(s => {
    let matchCat = false;
    if (categoryFilter === 'all') {
      matchCat = true;
    } else if (categoryFilter === 'commands') {
      matchCat = !!s.command || s.category.toLowerCase() === 'commands';
    } else if (categoryFilter === 'custom') {
      matchCat = s.id.startsWith('custom-') || s.category.toLowerCase() === 'custom';
    } else {
      matchCat = (s.category && s.category.toLowerCase() === categoryFilter.toLowerCase());
    }

    if (!matchCat) return false;
    if (!q) return true;

    const inTitle = s.title && s.title.toLowerCase().includes(q);
    const inCmd = s.command && s.command.toLowerCase().includes(q);
    const inDesc = s.desc && s.desc.toLowerCase().includes(q);
    const inPrompt = s.prompt && s.prompt.toLowerCase().includes(q);
    const inCategory = s.category && s.category.toLowerCase().includes(q);
    const inTags = Array.isArray(s.tags) && s.tags.some(t => t.toLowerCase().includes(q));

    return inTitle || inCmd || inDesc || inPrompt || inCategory || inTags;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-12 flex flex-col items-center justify-center text-center text-[var(--text-muted)]">
        <i data-lucide="sparkles" class="w-8 h-8 mb-2 opacity-50"></i>
        <span class="text-xs font-medium">No commands or snippets match "${escapeHtml(q || categoryFilter)}".</span>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons({ root: container });
    return;
  }

  const catColors = {
    commands: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    image: 'text-pink-400 bg-pink-500/10 border-pink-500/20',
    engine: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    coding: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
    writing: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    translation: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
    learning: 'text-teal-400 bg-teal-500/10 border-teal-500/20',
    system: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
    custom: 'text-fuchsia-400 bg-fuchsia-500/10 border-fuchsia-500/20'
  };

  container.innerHTML = filtered.map(s => {
    const colorClass = catColors[s.category.toLowerCase()] || catColors.custom;
    const isCustom = !DEFAULT_SNIPPETS.some(d => d.id === s.id);
    return `
      <div class="snippet-card group" data-snippet-id="${escapeHtml(s.id)}">
        <div class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between gap-1.5 flex-wrap">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-[9px] font-mono uppercase font-bold px-1.5 py-0.5 rounded border ${colorClass}">
                ${escapeHtml(s.category)}
              </span>
              ${s.command ? `
                <span class="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border)] text-cyan-400">
                  ${escapeHtml(s.command)}
                </span>
              ` : ''}
            </div>
            ${isCustom ? `
              <button class="btn-delete-snippet p-1 rounded hover:bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-rose-400 transition-colors cursor-pointer" data-id="${escapeHtml(s.id)}" title="Delete snippet">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
              </button>
            ` : ''}
          </div>
          <div class="flex items-start gap-2 mt-0.5">
            ${s.icon ? `<i data-lucide="${escapeHtml(s.icon)}" class="w-4 h-4 mt-0.5 shrink-0 text-[var(--text-muted)] group-hover:text-[var(--brand)] transition-colors"></i>` : ''}
            <h4 class="text-xs font-bold text-[var(--text-primary)] group-hover:text-[var(--brand)] transition-colors leading-tight">${escapeHtml(s.title)}</h4>
          </div>
          <p class="text-[11px] text-[var(--text-secondary)] line-clamp-2 leading-relaxed">${escapeHtml(s.desc || s.prompt.substring(0, 100))}</p>
          ${Array.isArray(s.tags) && s.tags.length > 0 ? `
            <div class="flex items-center gap-1 flex-wrap mt-1">
              ${s.tags.map(t => `
                <button type="button" class="snippet-tag-pill" data-tag="${escapeHtml(t)}" title="Filter by ${escapeHtml(t)}">
                  ${escapeHtml(t)}
                </button>
              `).join('')}
            </div>
          ` : ''}
        </div>
        <div class="flex items-center justify-end gap-1.5 pt-2 border-t border-[var(--border)] mt-auto">
          <button class="btn-insert-snippet px-2.5 py-1 rounded-lg bg-[var(--bg-card)] hover:bg-[var(--border)] text-xs text-[var(--text-primary)] font-medium transition-colors cursor-pointer shadow-xs" data-id="${escapeHtml(s.id)}">
            Insert
          </button>
          <button class="btn-run-snippet px-2.5 py-1 rounded-lg bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-black text-xs font-bold transition-all cursor-pointer shadow-xs" data-id="${escapeHtml(s.id)}">
            ${s.command ? 'Run' : 'Run Macro'}
          </button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.btn-insert-snippet').forEach(btn => {
    btn.addEventListener('click', () => {
      const sId = btn.getAttribute('data-id');
      const snippet = allSnippets.find(x => x.id === sId);
      if (snippet) applyPromptSnippet(snippet, false);
    });
  });

  container.querySelectorAll('.btn-run-snippet').forEach(btn => {
    btn.addEventListener('click', () => {
      const sId = btn.getAttribute('data-id');
      const snippet = allSnippets.find(x => x.id === sId);
      if (snippet) applyPromptSnippet(snippet, true);
    });
  });

  container.querySelectorAll('.btn-delete-snippet').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const sId = btn.getAttribute('data-id');
      deleteCustomPromptSnippet(sId);
    });
  });

  container.querySelectorAll('.snippet-tag-pill').forEach(tagBtn => {
    tagBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tag = tagBtn.getAttribute('data-tag');
      const searchInput = document.getElementById('input-snippet-search');
      if (searchInput) {
        searchInput.value = tag;
        const activeCat = document.querySelector('#snippet-category-filters .snippet-cat-btn.active')?.getAttribute('data-cat') || 'all';
        renderPromptSnippets(activeCat, tag);
      }
    });
  });

  if (window.lucide) window.lucide.createIcons({ root: container });
}

export function applyPromptSnippet(snippet, runImmediately = false) {
  // Ensure chat tab is active so user sees prompt in workspace
  switchTab('tab-chat');

  const input = document.getElementById('chat-input');
  if (!input) return;

  const currentVal = input.value.trim();
  let finalPrompt = '';

  if (snippet.command) {
    if (currentVal && !currentVal.startsWith('/')) {
      finalPrompt = `${snippet.command} ${currentVal}`;
    } else {
      finalPrompt = snippet.prompt || snippet.command;
    }
  } else if (currentVal) {
    finalPrompt = `${snippet.prompt}${currentVal}`;
  } else {
    finalPrompt = snippet.prompt;
  }

  input.value = finalPrompt;
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 128) + 'px';

  closePromptLibraryModal();
  input.focus();

  if (runImmediately) {
    const readyCommands = [
      '/sys', '/hw', '/eject', '/unload', '/models', '/clear', '/compact', '/hook', '/api', '/help', '/guess', '/yes'
    ];
    const isReadyToRun = readyCommands.includes(snippet.command) || !snippet.command || currentVal;
    if (isReadyToRun) {
      const sendBtn = document.getElementById('btn-chat-send');
      if (sendBtn) sendBtn.click();
    } else {
      showToast('Command Ready', `Add parameters for ${snippet.command} and press Send.`, 'info', 2000);
    }
  } else {
    showToast('Snippet Inserted', `"${snippet.title}" placed into prompt.`, 'info', 1500);
  }
}

export function deleteCustomPromptSnippet(id) {
  try {
    let custom = JSON.parse(localStorage.getItem('llama_prompt_snippets') || '[]');
    custom = custom.filter(s => s.id !== id);
    localStorage.setItem('llama_prompt_snippets', JSON.stringify(custom));
    renderPromptSnippets();
    showToast('Snippet Deleted', 'Custom snippet removed.', 'info', 1500);
  } catch {}
}

export function saveCustomPromptSnippet(title, category, promptText, tagsText = '') {
  if (!title || !promptText) return;

  let tags = [];
  if (tagsText) {
    tags = tagsText.split(/[,\s]+/)
      .map(t => t.trim())
      .filter(t => t.length > 0)
      .map(t => t.startsWith('#') ? t : `#${t}`);
  }
  if (tags.length === 0) {
    tags = [`#${(category || 'custom').toLowerCase()}`];
  }

  const isCommand = promptText.trim().startsWith('/');
  const commandMatch = isCommand ? promptText.trim().split(/\s+/)[0] : null;

  const newSnippet = {
    id: `custom-${Date.now()}`,
    title: title.trim(),
    command: commandMatch,
    category: (category || 'custom').trim(),
    tags: tags,
    icon: isCommand ? 'terminal' : 'sparkles',
    desc: promptText.trim().substring(0, 90) + (promptText.length > 90 ? '...' : ''),
    prompt: isCommand ? promptText.trim() : (promptText.trim() + (promptText.endsWith('\n') ? '' : '\n\n'))
  };

  try {
    let custom = JSON.parse(localStorage.getItem('llama_prompt_snippets') || '[]');
    custom.push(newSnippet);
    localStorage.setItem('llama_prompt_snippets', JSON.stringify(custom));
    showToast('Snippet Saved', `"${newSnippet.title}" added to your Prompt Library.`, 'success', 1800);
    renderPromptSnippets(category);
  } catch (err) {
    showToast('Error', 'Failed to save custom snippet.', 'error');
  }
}

function setupPromptLibraryModal() {
  document.getElementById('btn-close-prompt-library')?.addEventListener('click', () => {
    closePromptLibraryModal();
  });

  const promptModal = document.getElementById('modal-prompt-library');
  if (promptModal) {
    promptModal.addEventListener('click', (e) => {
      if (e.target === promptModal) closePromptLibraryModal();
    });
  }

  // Category filter tabs in Prompt Library
  document.querySelectorAll('#snippet-category-filters .snippet-cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#snippet-category-filters .snippet-cat-btn').forEach(b => {
        b.className = 'snippet-cat-btn px-2.5 py-1 rounded-lg text-xs font-medium bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border)] cursor-pointer shrink-0';
      });
      btn.className = 'snippet-cat-btn active px-2.5 py-1 rounded-lg text-xs font-semibold bg-[var(--brand)] text-black cursor-pointer shrink-0';
      const cat = btn.getAttribute('data-cat') || 'all';
      const q = document.getElementById('input-snippet-search')?.value || '';
      renderPromptSnippets(cat, q);
    });
  });

  // Search input in Prompt Library
  const snippetSearchInput = document.getElementById('input-snippet-search');
  if (snippetSearchInput) {
    snippetSearchInput.addEventListener('input', (e) => {
      const activeCat = document.querySelector('#snippet-category-filters .snippet-cat-btn.active')?.getAttribute('data-cat') || 'all';
      renderPromptSnippets(activeCat, e.target.value);
    });
  }

  // Create Custom Snippet inline form toggle
  const formSnippet = document.getElementById('form-new-snippet');
  document.getElementById('btn-create-snippet')?.addEventListener('click', () => {
    if (formSnippet) {
      formSnippet.classList.toggle('hidden');
      if (!formSnippet.classList.contains('hidden')) {
        document.getElementById('input-new-snippet-title')?.focus();
      }
    }
  });

  document.getElementById('btn-cancel-new-snippet')?.addEventListener('click', () => {
    if (formSnippet) formSnippet.classList.add('hidden');
  });

  document.getElementById('btn-save-custom-snippet')?.addEventListener('click', () => {
    const title = document.getElementById('input-new-snippet-title')?.value.trim();
    const cat = document.getElementById('select-new-snippet-cat')?.value || 'custom';
    const tagsText = document.getElementById('input-new-snippet-tags')?.value.trim();
    const promptText = document.getElementById('input-new-snippet-prompt')?.value.trim();

    if (!title || !promptText) {
      showToast('Validation Error', 'Please enter both a title and prompt template.', 'warning');
      return;
    }

    saveCustomPromptSnippet(title, cat, promptText, tagsText);
    if (formSnippet) formSnippet.classList.add('hidden');
    const titleInput = document.getElementById('input-new-snippet-title');
    const tagsInput = document.getElementById('input-new-snippet-tags');
    const promptInput = document.getElementById('input-new-snippet-prompt');
    if (titleInput) titleInput.value = '';
    if (tagsInput) tagsInput.value = '';
    if (promptInput) promptInput.value = '';
  });
}

// Global window hooks for universal calling from other codes / scripts
window.openPromptLibraryModal = openPromptLibraryModal;
window.closePromptLibraryModal = closePromptLibraryModal;
window.applyPromptSnippet = applyPromptSnippet;


