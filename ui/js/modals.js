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

