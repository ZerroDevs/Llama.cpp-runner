/**
 * Llama Server Control - SwarmUI Studio & Image Gallery Controller
 */

import { api } from './api.js';
import { state } from './state.js';
import { showToast } from './toast.js';
import { updateServerUI } from './dashboard.js';
import { openImageInspector } from './modals.js';

export function setupSwarm() {
  // Swarm Generation Parameter Sliders
  const wInput = document.getElementById('cfg-swarm_width');
  const hInput = document.getElementById('cfg-swarm_height');
  const sInput = document.getElementById('cfg-swarm_steps');
  const cInput = document.getElementById('cfg-swarm_cfg');
  const wVal = document.getElementById('val-swarm_width');
  const hVal = document.getElementById('val-swarm_height');
  const sVal = document.getElementById('val-swarm_steps');
  const cVal = document.getElementById('val-swarm_cfg');
  const chkOpenBrowser = document.getElementById('check-swarm-open-browser');

  if (wInput && wVal) {
    wInput.value = state.config.swarm_width || 1024;
    wVal.textContent = wInput.value;
    wInput.addEventListener('input', () => {
      wVal.textContent = wInput.value;
      state.config.swarm_width = parseInt(wInput.value);
      api.invoke('save_config', state.config);
    });
  }

  if (hInput && hVal) {
    hInput.value = state.config.swarm_height || 1024;
    hVal.textContent = hInput.value;
    hInput.addEventListener('input', () => {
      hVal.textContent = hInput.value;
      state.config.swarm_height = parseInt(hInput.value);
      api.invoke('save_config', state.config);
    });
  }

  if (sInput && sVal) {
    sInput.value = state.config.swarm_steps !== undefined ? state.config.swarm_steps : 25;
    sVal.textContent = sInput.value;
    sInput.addEventListener('input', () => {
      sVal.textContent = sInput.value;
      state.config.swarm_steps = parseInt(sInput.value);
      api.invoke('save_config', state.config);
    });
  }

  if (cInput && cVal) {
    cInput.value = state.config.swarm_cfg !== undefined ? state.config.swarm_cfg : 3.5;
    cVal.textContent = cInput.value;
    cInput.addEventListener('input', () => {
      cVal.textContent = cInput.value;
      state.config.swarm_cfg = parseFloat(cInput.value);
      api.invoke('save_config', state.config);
    });
  }

  if (chkOpenBrowser) {
    chkOpenBrowser.checked = Boolean(state.config.swarm_open_browser);
    chkOpenBrowser.addEventListener('change', () => {
      state.config.swarm_open_browser = chkOpenBrowser.checked;
      api.invoke('save_config', state.config);
    });
  }

  // Open Swarm Web UI in default browser
  document.getElementById('btn-open-swarm-web')?.addEventListener('click', async () => {
    const port = parseInt(document.getElementById('input-swarm-port')?.value || state.config.swarm_port || 7801);
    const host = state.config.swarm_host || '127.0.0.1';
    const url = `http://${host}:${port}`;
    await api.invoke('open_url', url);
    showToast('Swarm Web UI', `Opening ${url} in browser...`, 'info', 2000);
  });

  // Toggle SwarmUI buttons (in tab header and sidebar rail)
  document.getElementById('btn-toggle-swarm')?.addEventListener('click', toggleSwarmUI);
  document.getElementById('btn-rail-toggle-swarm')?.addEventListener('click', toggleSwarmUI);

  // Browse Swarm Launcher
  document.getElementById('btn-browse-swarm')?.addEventListener('click', async () => {
    const p = await api.invoke('select_file', 'exe');
    if (p) {
      document.getElementById('input-swarm-path').value = p;
      state.config.swarm_launcher_path = p;
      await api.invoke('save_config', state.config);
      showToast('Swarm Launcher Set', p.split(/[\\/]/).pop(), 'success');
      await scanSwarmModels();
    }
  });

  // Swarm Models Directory & Active Model Setup
  const modelsPathInput = document.getElementById('input-swarm-models-path');
  const selectModel = document.getElementById('select-swarm-model');
  const nameInput = document.getElementById('input-swarm-model-name');

  if (modelsPathInput) {
    if (state.config.swarm_models_path) {
      modelsPathInput.value = state.config.swarm_models_path;
    } else if (state.config.swarm_launcher_path) {
      const sDir = state.config.swarm_launcher_path.replace(/[\\/][^\\/]+$/, '');
      modelsPathInput.value = `${sDir}\\Models`;
    }

    modelsPathInput.addEventListener('change', async () => {
      state.config.swarm_models_path = modelsPathInput.value.trim();
      await api.invoke('save_config', state.config);
      await scanSwarmModels(state.config.swarm_models_path);
    });
  }

  document.getElementById('btn-browse-swarm-models-path')?.addEventListener('click', async () => {
    const dir = await api.invoke('select_directory');
    if (dir) {
      if (modelsPathInput) modelsPathInput.value = dir;
      state.config.swarm_models_path = dir;
      await api.invoke('save_config', state.config);
      await scanSwarmModels(dir);
      showToast('Models Folder Set', dir.split(/[\\/]/).pop(), 'success');
    }
  });

  document.getElementById('btn-rescan-swarm-models')?.addEventListener('click', async () => {
    await scanSwarmModels();
    showToast('Rescanned Models', 'Updated diffusion models list.', 'info', 1500);
  });

  selectModel?.addEventListener('change', async () => {
    const val = selectModel.value;
    state.config.swarm_model = val;
    if (nameInput) nameInput.value = val;
    await api.invoke('save_config', state.config);
    showToast('Active Diffusion Model', val, 'success', 2000);
  });

  document.getElementById('btn-save-swarm-model')?.addEventListener('click', async () => {
    const val = nameInput?.value?.trim() || 'qwen-image-2.1-UC-Q6_K.gguf';
    state.config.swarm_model = val;
    await api.invoke('save_config', state.config);
    await scanSwarmModels();
    showToast('Swarm Model Saved', val, 'success');
  });

  // Initial models scan
  scanSwarmModels();

  // Refresh Gallery Button
  document.getElementById('btn-refresh-gallery')?.addEventListener('click', () => refreshGallery());

  // Search Filter
  document.getElementById('input-gallery-search')?.addEventListener('input', () => filterAndRenderGallery());

  // Folder Select Dropdown Filter (PRIMARY DROPDOWN 5)
  document.getElementById('select-gallery-folder')?.addEventListener('change', () => filterAndRenderGallery());

  // Select Mode Toggle
  document.getElementById('btn-gallery-select-mode')?.addEventListener('click', () => {
    state.gallerySelectMode = !state.gallerySelectMode;
    const bar = document.getElementById('gallery-bulk-actions');
    const btn = document.getElementById('btn-gallery-select-mode');

    if (state.gallerySelectMode) {
      bar?.classList.remove('hidden');
      bar?.classList.add('flex');
      btn.textContent = 'Cancel Selection';
      btn.className = 'px-3 py-1.5 rounded-xl border border-rose-500/30 bg-rose-500/15 text-xs font-medium text-rose-400';
    } else {
      bar?.classList.add('hidden');
      bar?.classList.remove('flex');
      btn.textContent = 'Select Mode';
      btn.className = 'px-3 py-1.5 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors';
      state.gallerySelected.clear();
      updateSelectedCount();
    }
    filterAndRenderGallery();
  });

  // Bulk Actions
  document.getElementById('btn-gallery-webhook')?.addEventListener('click', async () => {
    if (state.gallerySelected.size === 0) return;
    const paths = Array.from(state.gallerySelected);
    showToast('Uploading to Discord...', `${paths.length} items queued`, 'info');
    const res = await api.invoke('send_to_webhook', paths);
    if (res) showToast('Webhook Dispatched', 'Images sent to Discord channel.', 'success');
  });

  document.getElementById('btn-gallery-censor')?.addEventListener('click', async () => {
    if (state.gallerySelected.size === 0) return;
    const paths = Array.from(state.gallerySelected);
    await api.invoke('censor_images', paths);
    showToast('Censorship Mask Applied', `${paths.length} images blurred.`, 'info');
    await refreshGallery();
  });

  document.getElementById('btn-gallery-uncensor')?.addEventListener('click', async () => {
    if (state.gallerySelected.size === 0) return;
    const paths = Array.from(state.gallerySelected);
    await api.invoke('uncensor_images', paths);
    showToast('Censorship Mask Removed', `${paths.length} images uncensored.`, 'info');
    await refreshGallery();
  });

  document.getElementById('btn-gallery-delete')?.addEventListener('click', async () => {
    if (state.gallerySelected.size === 0) return;
    if (!confirm(`Permanently delete ${state.gallerySelected.size} selected image(s) from disk?`)) return;

    const paths = Array.from(state.gallerySelected);
    const res = await api.invoke('delete_images', paths);
    showToast('Files Deleted', `${res?.deleted || 0} images removed.`, 'info');
    state.gallerySelected.clear();
    updateSelectedCount();
    await refreshGallery();
  });
}

export async function toggleSwarmUI() {
  if (state.swarmRunning) {
    await api.invoke('stop_swarm');
    state.swarmRunning = false;
    updateServerUI();
    showToast('SwarmUI Stopped', 'Process terminated cleanly.', 'info');
  } else {
    const cfg = state.config;
    cfg.swarm_launcher_path = document.getElementById('input-swarm-path')?.value.trim() || cfg.swarm_launcher_path || '';
    cfg.swarm_port = parseInt(document.getElementById('input-swarm-port')?.value || cfg.swarm_port || 7801);
    cfg.swarm_width = parseInt(document.getElementById('cfg-swarm_width')?.value || cfg.swarm_width || 1024);
    cfg.swarm_height = parseInt(document.getElementById('cfg-swarm_height')?.value || cfg.swarm_height || 1024);
    cfg.swarm_steps = parseInt(document.getElementById('cfg-swarm_steps')?.value || cfg.swarm_steps || 25);
    cfg.swarm_cfg = parseFloat(document.getElementById('cfg-swarm_cfg')?.value || cfg.swarm_cfg || 3.5);
    const chk = document.getElementById('check-swarm-open-browser');
    cfg.swarm_open_browser = chk ? chk.checked : Boolean(cfg.swarm_open_browser);
    await api.invoke('save_config', cfg);

    const res = await api.invoke('start_swarm', cfg);
    if (res && res.status === 'success') {
      state.swarmRunning = true;
      updateServerUI();
      const modeDesc = cfg.swarm_open_browser ? 'opening browser' : 'background server mode';
      showToast('SwarmUI Booting', `Launching on port ${cfg.swarm_port} (${modeDesc})...`, 'success');
    } else {
      showToast('Launch Error', res?.message || 'Check path to launch-windows.bat', 'error');
    }
  }
}

export async function copyImageToClipboard(img) {
  let copied = false;

  // 1. Native Windows file-drop copy
  try {
    const res = await api.invoke('copy_image_to_clipboard', img.path);
    if (res && res.status === 'success') {
      copied = true;
    }
  } catch (err) {}

  // 2. Browser ClipboardItem bitmap copy
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
    // Fallback: copy file path
    try {
      await navigator.clipboard.writeText(img.path);
      showToast('Path Copied', img.filename, 'info');
    } catch {
      showToast('Copy Failed', 'Unable to access clipboard.', 'error');
    }
  }
}

export async function deleteSingleImage(img) {
  if (!confirm(`Permanently delete "${img.filename}" from disk?`)) return;
  const res = await api.invoke('delete_image', img.path);
  if (res && res.status === 'success') {
    showToast('Image Deleted', img.filename, 'info');
    state.gallerySelected.delete(img.path);
    updateSelectedCount();
    await refreshGallery();
  } else {
    showToast('Delete Failed', 'Could not delete image file.', 'error');
  }
}

export async function refreshGallery() {
  const container = document.getElementById('gallery-grid');
  if (!container) return;

  try {
    const images = await api.invoke('get_swarm_images');
    if (Array.isArray(images)) {
      state.galleryImages = images;
      populateGalleryFolderDropdown(images);
      filterAndRenderGallery();
    }
  } catch (err) {
    console.error('Gallery refresh error:', err);
  }
}

function populateGalleryFolderDropdown(images) {
  const select = document.getElementById('select-gallery-folder');
  if (!select) return;

  const currentVal = select.value;
  const folders = new Set();
  images.forEach(img => {
    if (img.folder) folders.add(img.folder);
  });

  select.innerHTML = '<option value="all">📁 All Date Folders</option>';
  Array.from(folders).sort().reverse().forEach(f => {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = `📁 ${f}`;
    if (f === currentVal) opt.selected = true;
    select.appendChild(opt);
  });
}

function filterAndRenderGallery() {
  const container = document.getElementById('gallery-grid');
  if (!container) return;

  const search = document.getElementById('input-gallery-search')?.value.toLowerCase().trim() || '';
  const folder = document.getElementById('select-gallery-folder')?.value || 'all';

  const filtered = state.galleryImages.filter(img => {
    if (folder !== 'all' && img.folder !== folder) return false;
    if (search && !img.filename.toLowerCase().includes(search) && !(img.folder || '').toLowerCase().includes(search)) return false;
    return true;
  });

  container.innerHTML = '';

  if (filtered.length === 0) {
    container.innerHTML = '<div class="col-span-full text-center py-16 text-xs text-[var(--text-muted)]">No images found in SwarmUI Output folder.</div>';
    return;
  }

  filtered.forEach(img => {
    const card = document.createElement('div');
    const isSelected = state.gallerySelected.has(img.path);
    card.className = `gallery-card group relative aspect-square rounded-2xl overflow-hidden border ${isSelected ? 'border-[var(--brand)] ring-2 ring-[var(--brand)]/30' : 'border-[var(--border)]'} bg-[var(--bg-card)] cursor-pointer shadow-xs transition-all hover:border-cyan-500/40`;

    const blurClass = img.censored ? 'censored-blur' : '';

    card.innerHTML = `
      <img src="${img.url}" alt="${img.filename}" loading="lazy" class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105 ${blurClass}" />
      
      <!-- Selection Checkbox -->
      ${state.gallerySelectMode ? `
        <div class="absolute top-2 left-2 z-10">
          <input type="checkbox" class="gallery-chk w-4 h-4 accent-[var(--brand)] rounded cursor-pointer" ${isSelected ? 'checked' : ''} />
        </div>
      ` : ''}

      <!-- Bottom Overlay Info & Quick Actions -->
      <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent p-2.5 pt-7 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-1.5 text-[10px]">
        <span class="font-mono text-white/90 truncate font-semibold">${img.filename}</span>
        
        <div class="flex items-center justify-between pt-1 border-t border-white/10">
          <div class="flex items-center gap-1.5">
            <button class="btn-card-copy p-1 rounded-md bg-white/10 hover:bg-white/20 text-white transition-colors" title="Copy Image to Clipboard">
              <i data-lucide="copy" class="w-3 h-3 text-cyan-400"></i>
            </button>
            <button class="btn-card-folder p-1 rounded-md bg-white/10 hover:bg-white/20 text-white transition-colors" title="Reveal in File Explorer">
              <i data-lucide="folder-open" class="w-3 h-3 text-cyan-400"></i>
            </button>
            <button class="btn-card-delete p-1 rounded-md bg-rose-500/20 hover:bg-rose-500/40 text-rose-300 transition-colors" title="Delete Image">
              <i data-lucide="trash-2" class="w-3 h-3 text-rose-400"></i>
            </button>
          </div>

          <button class="btn-inspect-quick px-2 py-0.5 rounded-md bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 flex items-center gap-1 font-mono transition-colors" title="Inspect Specs & Fullscreen">
            <i data-lucide="sparkles" class="w-3 h-3"></i>
            <span>Specs</span>
          </button>
        </div>
      </div>
    `;

    // Card Click: Inspect or Multi-select
    card.addEventListener('click', (e) => {
      if (state.gallerySelectMode) {
        if (state.gallerySelected.has(img.path)) {
          state.gallerySelected.delete(img.path);
        } else {
          state.gallerySelected.add(img.path);
        }
        updateSelectedCount();
        filterAndRenderGallery();
      } else {
        openImageInspector(img);
      }
    });

    // Quick Action: Inspect
    card.querySelector('.btn-inspect-quick')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openImageInspector(img);
    });

    // Quick Action: Copy
    card.querySelector('.btn-card-copy')?.addEventListener('click', (e) => {
      e.stopPropagation();
      copyImageToClipboard(img);
    });

    // Quick Action: Folder
    card.querySelector('.btn-card-folder')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      await api.invoke('open_image_folder', img.path);
    });

    // Quick Action: Delete
    card.querySelector('.btn-card-delete')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      await deleteSingleImage(img);
    });

    container.appendChild(card);
  });

  if (window.lucide) window.lucide.createIcons({ root: container });
}

function updateSelectedCount() {
  const el = document.getElementById('gallery-selected-count');
  if (el) el.textContent = `${state.gallerySelected.size} selected`;
}

export async function scanSwarmModels(folderPath = null) {
  const inputPath = document.getElementById('input-swarm-models-path');
  const path = folderPath !== null ? folderPath : (inputPath?.value || state.config.swarm_models_path || '');
  try {
    const models = await api.invoke('scan_swarm_models', path);
    populateSwarmModels(models);
  } catch (err) {
    console.error('[SwarmUI] Error scanning models:', err);
  }
}

export function populateSwarmModels(models) {
  const select = document.getElementById('select-swarm-model');
  const countBadge = document.getElementById('swarm-model-count-badge');
  const nameInput = document.getElementById('input-swarm-model-name');
  if (!select) return;

  select.innerHTML = '';
  const activeModel = state.config.swarm_model || 'qwen-image-2.1-UC-Q6_K.gguf';

  if (!models || models.length === 0) {
    const opt = document.createElement('option');
    opt.value = 'qwen-image-2.1-UC-Q6_K.gguf';
    opt.textContent = 'qwen-image-2.1-UC-Q6_K.gguf (Default)';
    opt.selected = true;
    select.appendChild(opt);
    if (countBadge) countBadge.textContent = '1 found';
    if (nameInput) nameInput.value = 'qwen-image-2.1-UC-Q6_K.gguf';
    return;
  }

  if (countBadge) countBadge.textContent = `${models.length} found`;

  let matched = false;

  models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.name;
    opt.textContent = `${m.name} (${m.formatted_size})`;
    if (m.name === activeModel || m.relative_path === activeModel) {
      opt.selected = true;
      matched = true;
    }
    select.appendChild(opt);
  });

  // If activeModel is a custom alias (e.g. "Qwen21") and not directly in scan list, add it as selected option
  if (!matched && activeModel) {
    const opt = document.createElement('option');
    opt.value = activeModel;
    opt.textContent = `${activeModel} (Custom Active)`;
    opt.selected = true;
    select.prepend(opt);
  }

  if (nameInput) {
    nameInput.value = activeModel;
  }
}
