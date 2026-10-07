/**
 * Llama Server Control - Dashboard & Server Engine Controller
 */

import { api } from './api.js';
import { state } from './state.js';
import { showToast } from './toast.js';
import { syncLlamaWebState } from './llama-web.js';
import { updateChatTokenBadge } from './chat.js';

export function setupDashboard() {
  // Save Config Button
  document.getElementById('btn-save-config')?.addEventListener('click', async () => {
    const newCfg = collectConfigFromForm();
    state.config = newCfg;
    await api.invoke('save_config', newCfg);
    showToast('Settings Saved', 'Engine configuration updated successfully.', 'success');
    updateMissingBinaryBanner();
  });

  // Settings Tab Save Button
  document.getElementById('btn-save-settings')?.addEventListener('click', async () => {
    const newCfg = collectConfigFromForm();
    state.config = newCfg;
    await api.invoke('save_config', newCfg);
    showToast('Settings Saved', 'Lifecycle automation and system settings saved.', 'success');
  });

  // Auto-save toggle switches in Settings tab
  const hookToggleAutoSave = (id, label) => {
    document.getElementById(id)?.addEventListener('change', async (e) => {
      const newCfg = collectConfigFromForm();
      state.config = newCfg;
      await api.invoke('save_config', newCfg);
      showToast('Setting Updated', `${label}: ${e.target.checked ? 'Enabled' : 'Disabled'}`, 'info', 1600);
    });
  };

  hookToggleAutoSave('check-auto-wake-llm', 'Auto Wake LLM');
  hookToggleAutoSave('check-auto-wake-swarm', 'Auto Wake Swarm');
  hookToggleAutoSave('check-auto-sleep', 'Auto-Sleep LLM');
  hookToggleAutoSave('check-tray', 'System Tray');
  hookToggleAutoSave('check-startup', 'Startup Launch');

  document.getElementById('input-discord-webhook')?.addEventListener('change', async () => {
    const newCfg = collectConfigFromForm();
    state.config = newCfg;
    await api.invoke('save_config', newCfg);
    showToast('Webhook Saved', 'Discord webhook URL updated.', 'info', 1600);
  });

  // Browse Binary Button
  document.getElementById('btn-browse-binary')?.addEventListener('click', async () => {
    const path = await api.invoke('select_file', 'exe');
    if (path) {
      document.getElementById('input-binary-path').value = path;
      state.config.server_path = path;
      await api.invoke('save_config', state.config);
      updateMissingBinaryBanner();
      showToast('Binary Configured', path.split(/[\\/]/).pop(), 'success');
    }
  });

  // Advanced Options Accordion Toggle
  const toggleAdv = document.getElementById('btn-toggle-advanced-models');
  const panelAdv = document.getElementById('panel-advanced-models');
  const iconAdv = document.getElementById('icon-advanced-chevron');
  toggleAdv?.addEventListener('click', () => {
    if (panelAdv) {
      panelAdv.classList.toggle('hidden');
      const isHidden = panelAdv.classList.contains('hidden');
      if (iconAdv) {
        iconAdv.style.transform = isHidden ? 'rotate(0deg)' : 'rotate(90deg)';
      }
    }
  });

  // Browse mmproj vision projector
  document.getElementById('btn-browse-mmproj')?.addEventListener('click', async () => {
    const path = await api.invoke('select_file', 'model');
    if (path) {
      state.config.mmproj_path = path;
      state.config.vision_projector = path;
      await api.invoke('save_config', state.config);
      const sel = document.getElementById('select-vision-model');
      if (sel) {
        let opt = Array.from(sel.options).find(o => o.value === path);
        if (!opt) {
          opt = document.createElement('option');
          opt.value = path;
          opt.textContent = `Custom: ${path.split(/[\\/]/).pop()}`;
          sel.appendChild(opt);
        }
        sel.value = path;
      }
      showToast('Vision Projector Set', path.split(/[\\/]/).pop(), 'info');
    }
  });

  // Browse draft model
  document.getElementById('btn-browse-draft')?.addEventListener('click', async () => {
    const path = await api.invoke('select_file', 'model');
    if (path) {
      state.config.draft_model = path;
      await api.invoke('save_config', state.config);
      const sel = document.getElementById('select-draft-model');
      if (sel) {
        let opt = Array.from(sel.options).find(o => o.value === path);
        if (!opt) {
          opt = document.createElement('option');
          opt.value = path;
          opt.textContent = `Custom: ${path.split(/[\\/]/).pop()}`;
          sel.appendChild(opt);
        }
        sel.value = path;
      }
      showToast('Draft Model Set', path.split(/[\\/]/).pop(), 'info');
    }
  });

  // Browse LoRA model
  document.getElementById('btn-browse-lora')?.addEventListener('click', async () => {
    const path = await api.invoke('select_file', 'model');
    if (path) {
      state.config.lora_adapters = path;
      state.config.lora_model = path;
      await api.invoke('save_config', state.config);
      const inp = document.getElementById('input-lora-model');
      if (inp) inp.value = path;
      showToast('LoRA Adapter Set', path.split(/[\\/]/).pop(), 'info');
    }
  });

  document.getElementById('input-lora-model')?.addEventListener('change', async (e) => {
    state.config.lora_adapters = e.target.value.trim();
    state.config.lora_model = e.target.value.trim();
    await api.invoke('save_config', state.config);
  });

  // Copy Web App Host Endpoint Button
  document.getElementById('btn-copy-web-host')?.addEventListener('click', () => {
    const ep = document.getElementById('lbl-web-host-endpoint')?.textContent || 'http://localhost:9095';
    navigator.clipboard.writeText(ep);
    showToast('Copied to Clipboard', ep, 'info', 2000);
  });

  // Open Web App Host in Default Browser Button
  document.getElementById('btn-open-web-host')?.addEventListener('click', async () => {
    const ep = document.getElementById('lbl-web-host-endpoint')?.textContent || 'http://localhost:9095';
    await api.invoke('open_url', ep);
    showToast('Opening in Browser', ep, 'info', 1800);
  });

  // Copy Endpoint Button
  document.getElementById('btn-copy-network')?.addEventListener('click', () => {
    const ep = document.getElementById('lbl-network-endpoint')?.textContent || 'http://127.0.0.1:8080/v1';
    navigator.clipboard.writeText(ep);
    showToast('Copied to Clipboard', ep, 'info', 2000);
  });

  // Rail Start/Stop LLM Toggle
  document.getElementById('btn-rail-toggle-server')?.addEventListener('click', async () => {
    if (state.serverRunning) {
      await stopServer();
    } else {
      await startServer();
    }
  });

  // Rail Flush KV Cache
  document.getElementById('btn-rail-flush')?.addEventListener('click', async () => {
    try {
      const res = await api.invoke('flush_kv_cache');
      if (res && res.status === 'success') {
        showToast('Context Flushed', res.message || 'Active slots reset, KV cache cleared to 0 tokens.', 'success');
        updateChatTokenBadge();
      } else {
        showToast('Flush Warning', res?.message || 'Server did not acknowledge flush.', 'warning');
      }
    } catch (e) {
      showToast('Flush Failed', e.message, 'error');
    }
  });

  // Rail Eject Model
  document.getElementById('btn-rail-eject')?.addEventListener('click', async () => {
    if (state.serverRunning) {
      await stopServer();
      showToast('Model Ejected', 'VRAM 100% freed to system.', 'info');
    } else {
      showToast('Server Offline', 'No model currently active in VRAM.', 'info', 2000);
    }
  });

  // Locate binary from banner
  document.getElementById('btn-banner-locate')?.addEventListener('click', async () => {
    const path = await api.invoke('select_file', 'exe');
    if (path) {
      document.getElementById('input-binary-path').value = path;
      state.config.server_path = path;
      await api.invoke('save_config', state.config);
      updateMissingBinaryBanner();
      showToast('Binary Configured', path.split(/[\\/]/).pop(), 'success');
    }
  });
  // Server Exited IPC Event
  api.on('server_exited', () => {
    state.serverRunning = false;
    updateServerUI();
    showToast('Server Stopped', 'llama-server process exited.', 'warning');
  });
}

export function applyConfigToForm(cfg) {
  if (!cfg) return;
  const binary = cfg.server_path || cfg.server_binary || '';
  if (document.getElementById('input-binary-path')) document.getElementById('input-binary-path').value = binary;
  if (document.getElementById('select-context-size')) document.getElementById('select-context-size').value = cfg.context_size || 4096;
  if (document.getElementById('select-cache-k')) document.getElementById('select-cache-k').value = cfg.cache_type_k || cfg.kv_cache_type_k || 'f16';
  if (document.getElementById('select-cache-v')) document.getElementById('select-cache-v').value = cfg.cache_type_v || cfg.kv_cache_type_v || 'f16';
  if (document.getElementById('input-gpu-layers')) document.getElementById('input-gpu-layers').value = cfg.gpu_layers ?? 99;
  if (document.getElementById('input-threads')) document.getElementById('input-threads').value = cfg.threads || cfg.cpu_threads || 8;
  if (document.getElementById('input-batch-size')) document.getElementById('input-batch-size').value = cfg.batch_size || 512;
  if (document.getElementById('input-port')) document.getElementById('input-port').value = cfg.port || 8080;
  if (document.getElementById('select-host')) document.getElementById('select-host').value = cfg.host || '127.0.0.1';
  if (document.getElementById('check-flash-attn')) document.getElementById('check-flash-attn').checked = cfg.flash_attention !== false;
  if (document.getElementById('input-custom-args')) document.getElementById('input-custom-args').value = cfg.custom_args || '';
  if (document.getElementById('input-swarm-path')) document.getElementById('input-swarm-path').value = cfg.swarm_launcher_path || '';
  if (document.getElementById('input-swarm-port')) document.getElementById('input-swarm-port').value = cfg.swarm_port || 7801;
  if (document.getElementById('input-discord-webhook')) document.getElementById('input-discord-webhook').value = cfg.discord_webhook || '';
  if (document.getElementById('check-tray')) document.getElementById('check-tray').checked = !!cfg.minimize_to_tray;
  if (document.getElementById('check-startup')) document.getElementById('check-startup').checked = !!cfg.run_on_startup;
  if (document.getElementById('check-auto-wake-llm')) document.getElementById('check-auto-wake-llm').checked = cfg.auto_wake_llm !== false;
  if (document.getElementById('check-auto-wake-swarm')) document.getElementById('check-auto-wake-swarm').checked = cfg.auto_wake_swarm !== false;
  if (document.getElementById('check-auto-sleep')) document.getElementById('check-auto-sleep').checked = !!cfg.auto_sleep;

  // Vision Model
  const visionPath = cfg.mmproj_path || cfg.vision_projector || cfg.vision_model || '';
  const visionSel = document.getElementById('select-vision-model');
  if (visionSel && visionPath) {
    let opt = Array.from(visionSel.options).find(o => o.value === visionPath);
    if (!opt) {
      opt = document.createElement('option');
      opt.value = visionPath;
      opt.textContent = `Custom: ${visionPath.split(/[\\/]/).pop()}`;
      visionSel.appendChild(opt);
    }
    visionSel.value = visionPath;
  }

  // Draft Model
  const draftPath = cfg.draft_model || '';
  const draftSel = document.getElementById('select-draft-model');
  if (draftSel && draftPath) {
    let opt = Array.from(draftSel.options).find(o => o.value === draftPath);
    if (!opt) {
      opt = document.createElement('option');
      opt.value = draftPath;
      opt.textContent = `Custom: ${draftPath.split(/[\\/]/).pop()}`;
      draftSel.appendChild(opt);
    }
    draftSel.value = draftPath;
  }

  // LoRA Model
  const loraPath = cfg.lora_adapters || cfg.lora_model || '';
  const loraInp = document.getElementById('input-lora-model');
  if (loraInp) loraInp.value = loraPath;

  updateMissingBinaryBanner();
  updateNetworkEndpoints();
}

export async function updateNetworkEndpoints() {
  try {
    const netInfo = await api.invoke('get_network_info');
    if (netInfo) {
      const lblWeb = document.getElementById('lbl-web-host-endpoint');
      const lblApi = document.getElementById('lbl-network-endpoint');
      if (lblWeb) {
        lblWeb.textContent = netInfo.network_url || netInfo.local_url || 'http://localhost:9095';
        lblWeb.title = `Local: ${netInfo.local_url} | Network: ${netInfo.network_url}`;
      }
      if (lblApi) {
        lblApi.textContent = netInfo.api_url || `http://127.0.0.1:${netInfo.api_port || 8080}/v1`;
      }
    }
  } catch {}
}

export function collectConfigFromForm() {
  const binary = document.getElementById('input-binary-path')?.value.trim() || state.config.server_path || state.config.server_binary || '';
  const model = document.getElementById('select-model')?.value || state.config.model_path || '';
  const visionModel = document.getElementById('select-vision-model')?.value || state.config.mmproj_path || state.config.vision_projector || '';
  const draftModel = document.getElementById('select-draft-model')?.value || state.config.draft_model || '';
  const loraModel = document.getElementById('input-lora-model')?.value.trim() || state.config.lora_adapters || '';

  return {
    ...state.config,
    server_path: binary,
    server_binary: binary,
    model_path: model,
    context_size: parseInt(document.getElementById('select-context-size')?.value || 4096),
    cache_type_k: document.getElementById('select-cache-k')?.value || 'f16',
    cache_type_v: document.getElementById('select-cache-v')?.value || 'f16',
    kv_cache_type_k: document.getElementById('select-cache-k')?.value || 'f16',
    kv_cache_type_v: document.getElementById('select-cache-v')?.value || 'f16',
    gpu_layers: parseInt(document.getElementById('input-gpu-layers')?.value || 99),
    threads: parseInt(document.getElementById('input-threads')?.value || 8),
    cpu_threads: parseInt(document.getElementById('input-threads')?.value || 8),
    batch_size: parseInt(document.getElementById('input-batch-size')?.value || 512),
    port: parseInt(document.getElementById('input-port')?.value || 8080),
    host: document.getElementById('select-host')?.value || '127.0.0.1',
    flash_attention: document.getElementById('check-flash-attn')?.checked || false,
    mmproj_path: visionModel,
    vision_projector: visionModel,
    draft_model: draftModel,
    lora_adapters: loraModel,
    lora_model: loraModel,
    custom_args: document.getElementById('input-custom-args')?.value.trim() || '',
    swarm_launcher_path: document.getElementById('input-swarm-path')?.value.trim() || '',
    swarm_port: parseInt(document.getElementById('input-swarm-port')?.value || 7801),
    discord_webhook: document.getElementById('input-discord-webhook')?.value.trim() || '',
    minimize_to_tray: document.getElementById('check-tray')?.checked || false,
    run_on_startup: document.getElementById('check-startup')?.checked || false,
    auto_wake_llm: document.getElementById('check-auto-wake-llm') ? document.getElementById('check-auto-wake-llm').checked : (state.config.auto_wake_llm ?? true),
    auto_wake_swarm: document.getElementById('check-auto-wake-swarm') ? document.getElementById('check-auto-wake-swarm').checked : (state.config.auto_wake_swarm ?? true),
    auto_sleep: document.getElementById('check-auto-sleep') ? document.getElementById('check-auto-sleep').checked : (state.config.auto_sleep ?? false)
  };
}

export async function startServer() {
  const cfg = collectConfigFromForm();
  state.config = cfg;
  await api.invoke('save_config', cfg);

  if (!cfg.server_path) {
    showToast('Missing Server Binary', 'Please specify path to llama-server.exe.', 'error');
    return;
  }
  if (!cfg.model_path) {
    showToast('No Model Selected', 'Please select a GGUF model file first.', 'warning');
    return;
  }

  showToast('Booting Engine...', 'Starting llama.cpp server instance...', 'info', 2500);

  const res = await api.invoke('start_server', cfg);
  if (res && res.status === 'success') {
    state.serverRunning = true;
    updateServerUI();
    showToast('Server Online', `Listening on port ${cfg.port}`, 'success');
  } else {
    showToast('Start Failed', res?.message || 'Check terminal logs for errors.', 'error');
  }
}

export async function stopServer() {
  const res = await api.invoke('stop_server');
  state.serverRunning = false;
  updateServerUI();
  showToast('Server Stopped', 'Process terminated cleanly.', 'info');
}

export async function checkServerStatuses() {
  try {
    state.serverRunning = await api.invoke('check_status');
    state.swarmRunning = await api.invoke('get_swarm_status');
    updateServerUI();
  } catch {}
}

export function updateServerUI() {
  const dot = document.getElementById('llm-dot');
  const ping = document.getElementById('llm-ping');
  const headerModel = document.getElementById('header-model-name');
  const railBtn = document.getElementById('btn-rail-toggle-server');
  const railText = document.getElementById('btn-rail-server-text');

  if (state.serverRunning) {
    if (dot) dot.className = 'relative inline-flex rounded-full h-2 w-2 bg-emerald-500';
    if (ping) ping.classList.remove('hidden');
    const mName = (state.config.model_path || 'Running').split(/[\\/]/).pop().replace(/\.gguf$/i, '');
    if (headerModel) headerModel.textContent = mName;

    if (railBtn) {
      railBtn.className = 'w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 hover:bg-rose-500/25 text-xs font-semibold transition-all shadow-xs';
      railBtn.innerHTML = '<i data-lucide="square" class="w-3.5 h-3.5 fill-current"></i><span id="btn-rail-server-text">Stop LLM Server</span>';
    }
  } else {
    if (dot) dot.className = 'relative inline-flex rounded-full h-2 w-2 bg-neutral-500';
    if (ping) ping.classList.add('hidden');
    if (headerModel) headerModel.textContent = 'Offline';

    if (railBtn) {
      railBtn.className = 'w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25 text-xs font-semibold transition-all shadow-xs';
      railBtn.innerHTML = '<i data-lucide="play" class="w-3.5 h-3.5 fill-current"></i><span id="btn-rail-server-text">Start LLM Server</span>';
    }
  }

  const swarmDot = document.getElementById('swarm-dot');
  const swarmStatus = document.getElementById('header-swarm-status');
  const swarmBtn = document.getElementById('btn-toggle-swarm');
  const railSwarmBtn = document.getElementById('btn-rail-toggle-swarm');

  if (state.swarmRunning) {
    if (swarmDot) swarmDot.className = 'relative inline-flex rounded-full h-2 w-2 bg-cyan-500';
    if (swarmStatus) swarmStatus.textContent = `Port ${state.config.swarm_port || 7801}`;
    if (swarmBtn) {
      swarmBtn.className = 'px-3.5 py-1.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 hover:bg-rose-500/25 text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-xs';
      swarmBtn.innerHTML = '<i data-lucide="square" class="w-3.5 h-3.5 fill-current"></i><span id="lbl-swarm-btn-text">Stop SwarmUI</span>';
    }
    if (railSwarmBtn) {
      railSwarmBtn.className = 'w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 hover:bg-rose-500/25 text-xs font-semibold transition-all shadow-xs';
      railSwarmBtn.innerHTML = '<i data-lucide="square" class="w-3.5 h-3.5 fill-current"></i><span id="btn-rail-swarm-text">Stop SwarmUI</span>';
    }
  } else {
    if (swarmDot) swarmDot.className = 'relative inline-flex rounded-full h-2 w-2 bg-neutral-500';
    if (swarmStatus) swarmStatus.textContent = 'Offline';
    if (swarmBtn) {
      swarmBtn.className = 'px-3.5 py-1.5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border)] text-xs font-semibold text-[var(--text-secondary)] hover:text-cyan-400 transition-colors flex items-center gap-1.5';
      swarmBtn.innerHTML = '<i data-lucide="play" class="w-3.5 h-3.5 fill-current"></i><span id="lbl-swarm-btn-text">Start SwarmUI</span>';
    }
    if (railSwarmBtn) {
      railSwarmBtn.className = 'w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/25 text-xs font-semibold transition-all shadow-xs';
      railSwarmBtn.innerHTML = '<i data-lucide="play" class="w-3.5 h-3.5 fill-current"></i><span id="btn-rail-swarm-text">Start SwarmUI</span>';
    }
  }

  if (window.lucide) {
    if (swarmBtn) window.lucide.createIcons({ root: swarmBtn });
    if (railSwarmBtn) window.lucide.createIcons({ root: railSwarmBtn });
    if (railBtn) window.lucide.createIcons({ root: railBtn });
  }

  if (state.activeTab === 'tab-llama-web') {
    syncLlamaWebState();
  }
}

export function updateMissingBinaryBanner() {
  const banner = document.getElementById('banner-missing-binary');
  if (!banner) return;
  const path = state.config.server_path;
  if (!path) {
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}
