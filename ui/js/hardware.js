/**
 * Llama Server Control - Hardware Telemetry & Matrix Controller
 */

import { api } from './api.js';
import { state } from './state.js';

export function setupTelemetry() {
  // Low-overhead background telemetry polling (2.5s interval per directives)
  setInterval(async () => {
    if (!state.isWindowVisible) return;
    try {
      const data = await api.invoke('get_hardware_data');
      if (data) updateHardwareTelemetry(data);
    } catch {}
  }, 2500);

  // Auto-pause polling when window is blurred/hidden
  document.addEventListener('visibilitychange', () => {
    state.isWindowVisible = !document.hidden;
  });

  // Hardware Tab: Calculate VRAM button
  document.getElementById('btn-calc-vram')?.addEventListener('click', async () => {
    const out = document.getElementById('vram-calc-output');
    if (!out) return;
    out.classList.remove('hidden');
    out.innerHTML = '<span class="text-indigo-400">Computing offload footprint...</span>';

    const res = await api.invoke('calculate_vram', {
      model_path: state.config.model_path || '',
      context_size: parseInt(document.getElementById('select-context-size')?.value || 4096),
      batch_size: parseInt(document.getElementById('input-batch-size')?.value || 512)
    });

    if (res && res.status === 'success') {
      out.innerHTML = `
        <div class="flex items-center gap-4 flex-wrap">
          <div><span class="text-[var(--text-muted)]">Model Weights:</span> <span class="font-bold text-emerald-400">${res.model_vram_gb} GB</span></div>
          <div><span class="text-[var(--text-muted)]">KV Context:</span> <span class="font-bold text-cyan-400">${res.kv_cache_vram_gb} GB</span></div>
          <div><span class="text-[var(--text-muted)]">Estimated Total:</span> <span class="font-bold text-indigo-400">${res.total_vram_gb} GB</span></div>
          <div><span class="text-[var(--text-muted)]">Recommended -ngl:</span> <span class="font-bold text-emerald-400">99 (Full)</span></div>
        </div>
      `;
    } else {
      out.innerHTML = `<span class="text-rose-400">Estimation error: ${res?.message || 'Check model path'}</span>`;
    }
  });
}

export function updateHardwareTelemetry(data) {
  if (!data) return;

  const vramPct = (data.vram_pct !== undefined ? data.vram_pct : data.vram_percent) ?? 0;
  const ramPct = (data.ram_pct !== undefined ? data.ram_pct : data.ram_percent) ?? 0;
  const cpuPct = (data.cpu_pct !== undefined ? data.cpu_pct : data.cpu_percent) ?? 0;
  const vramUsed = data.vram_used ?? 0;
  const vramTotal = data.vram_total ?? 0;
  const ramUsed = data.ram_used ?? 0;
  const ramTotal = data.ram_total ?? 0;
  const gpuTemp = data.gpu_temp ?? '--';
  const gpuName = data.gpu_name || 'GPU';

  // Top Header HUD
  const hudVram = document.getElementById('hud-vram');
  const hudRam = document.getElementById('hud-ram');
  const hudCpu = document.getElementById('hud-cpu');

  if (hudVram) hudVram.textContent = `${vramPct}%`;
  if (hudRam) hudRam.textContent = `${ramPct}%`;
  if (hudCpu) hudCpu.textContent = `${cpuPct}%`;

  // Hardware Matrix Tab (if open)
  const matVramPct = document.getElementById('mat-vram-pct');
  const matVramBar = document.getElementById('mat-vram-bar');
  const matVramUsed = document.getElementById('mat-vram-used');
  const matVramTotal = document.getElementById('mat-vram-total');

  if (matVramPct) matVramPct.textContent = `${vramPct}%`;
  if (matVramBar) matVramBar.style.width = `${vramPct}%`;
  if (matVramUsed) matVramUsed.textContent = `${vramUsed} GB used`;
  if (matVramTotal) matVramTotal.textContent = `${vramTotal} GB total`;

  const matRamPct = document.getElementById('mat-ram-pct');
  const matRamBar = document.getElementById('mat-ram-bar');
  const matRamUsed = document.getElementById('mat-ram-used');
  const matRamTotal = document.getElementById('mat-ram-total');

  if (matRamPct) matRamPct.textContent = `${ramPct}%`;
  if (matRamBar) matRamBar.style.width = `${ramPct}%`;
  if (matRamUsed) matRamUsed.textContent = `${ramUsed} GB used`;
  if (matRamTotal) matRamTotal.textContent = `${ramTotal} GB total`;

  const matCpuPct = document.getElementById('mat-cpu-pct');
  const matCpuBar = document.getElementById('mat-cpu-bar');
  const matGpuTemp = document.getElementById('mat-gpu-temp');
  const matGpuName = document.getElementById('mat-gpu-name');

  if (matCpuPct) matCpuPct.textContent = `CPU: ${cpuPct}%`;
  if (matCpuBar) matCpuBar.style.width = `${cpuPct}%`;
  if (matGpuTemp) matGpuTemp.textContent = `${gpuTemp} °C`;
  if (matGpuName) matGpuName.textContent = gpuName;
}
