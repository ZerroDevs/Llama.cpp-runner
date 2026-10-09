/**
 * Voice Studio - Advanced Zero-Latency Local Speech & Voice Synthesis Controller
 * Connects to VoiceStudio Engine (port 3900 / Kestrel port 9095 proxy)
 */

import { api } from './api.js';
import { showToast } from './toast.js';

let voicesList = [];
let profilesList = [];
let historyList = [];
let isVoiceStudioOnline = false;
let activeEffect = 'raw';
let isStarredFilterActive = false;
let telemetryTimer = null;

const EFFECT_DESCRIPTIONS = {
  raw: 'No processing (Raw engine output)',
  broadcast: 'Radio standard - warm, compressed, clear',
  cinematic: 'Film-quality - spacious reverb, gentle compression',
  podcast: 'Close-mic intimate - heavy compression',
  warm: 'Boosted low-mids, cozy feel',
  bright: 'Crisp high-end presence'
};

export function setupVoiceStudio() {
  // 1. Status & Engine Controls
  document.getElementById('btn-voicestudio-retry')?.addEventListener('click', () => {
    checkVoiceStudioStatus(true);
  });

  document.getElementById('btn-vs-refresh-voices')?.addEventListener('click', () => {
    loadDiscoveredVoices(true);
    loadVoiceProfiles();
  });

  document.getElementById('btn-vs-flush-memory')?.addEventListener('click', () => {
    flushVoiceStudioVram();
  });

  document.getElementById('btn-vs-unload-model')?.addEventListener('click', () => {
    unloadVoiceStudioModel();
  });

  // 2. Voice Designer & Description Analysis
  const descInput = document.getElementById('vs-voice-description');
  document.getElementById('btn-vs-analyze-description')?.addEventListener('click', () => {
    analyzeVoiceDescription();
  });

  descInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      analyzeVoiceDescription();
    }
  });

  document.getElementById('btn-vs-reset-description')?.addEventListener('click', () => {
    if (descInput) descInput.value = '';
    resetDetailSelects();
    const tray = document.getElementById('vs-predicted-tags-tray');
    if (tray) {
      tray.innerHTML = '';
      tray.classList.add('hidden');
    }
  });

  // 3. Starting Points Presets
  setupPresetPills();

  // 4. Input Text & Dynamic Sliders
  const textInput = document.getElementById('vs-input-text');
  textInput?.addEventListener('input', () => {
    updateCharCounter();
  });

  const speedSlider = document.getElementById('vs-speed-slider');
  speedSlider?.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value).toFixed(2);
    const badge = document.getElementById('vs-speed-val');
    if (badge) badge.textContent = `${val}x`;
  });

  const guidanceSlider = document.getElementById('vs-guidance-slider');
  guidanceSlider?.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value).toFixed(1);
    const badge = document.getElementById('vs-guidance-val');
    if (badge) badge.textContent = val;
  });

  const stepsSlider = document.getElementById('vs-steps-slider');
  stepsSlider?.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    const badge = document.getElementById('vs-steps-val');
    if (badge) badge.textContent = String(val);
  });

  document.getElementById('btn-vs-randomize-seed')?.addEventListener('click', () => {
    const seedInput = document.getElementById('vs-seed-input');
    if (seedInput) {
      seedInput.value = Math.floor(Math.random() * 10000000);
    }
  });

  document.getElementById('btn-vs-sample-text')?.addEventListener('click', () => {
    insertSampleText();
  });

  // 5. DSP Master Audio Effect Pills
  setupEffectPills();

  // 6. Synthesis Action
  document.getElementById('btn-vs-synthesize')?.addEventListener('click', () => {
    synthesizeSpeech();
  });

  // 7. Sub-Tab Switcher (Library vs Profiles vs Speech-to-Speech vs Stories)
  setupSubTabs();

  // 8. Library Actions, Starred Filter & Search
  document.getElementById('vs-history-search')?.addEventListener('input', (e) => {
    filterHistoryRecords(e.target.value);
  });

  document.getElementById('btn-vs-filter-starred')?.addEventListener('click', () => {
    toggleStarredFilter();
  });

  document.getElementById('btn-vs-reload-history')?.addEventListener('click', () => {
    loadGeneratedHistory(true);
  });

  // 9. Voice Cloning & Profiles Setup
  setupVoiceCloningStudio();

  // 10. Speech-to-Speech (Voice Morph) Setup
  setupSpeechToSpeech();

  // 11. Stories & Script Composer
  setupStoriesStudio();

  // Initial Data Fetch
  checkVoiceStudioStatus();
  loadDiscoveredVoices();
  loadVoiceProfiles();
  loadPersonalitiesPresets();
  loadGeneratedHistory();

  // Start Background Telemetry (3.5s interval, paused on document hidden/blur)
  startTelemetryPolling();
}

/**
 * Checks VoiceStudio connectivity and updates UI status badges
 */
export async function checkVoiceStudioStatus(verbose = false) {
  try {
    const res = await api.invoke('voicestudio_get_status');
    isVoiceStudioOnline = Boolean(res && res.online);

    if (isVoiceStudioOnline) {
      markVoiceStudioOnline(res.device);
      if (verbose) showToast('VoiceStudio Online', 'Connected to VoiceStudio local engine.', 'success', 2000);
      updateModelTelemetry();
    } else {
      markVoiceStudioOffline(res?.error || 'Server did not respond');
      if (verbose) showToast('VoiceStudio Offline', 'Could not reach VoiceStudio at port 3900.', 'error', 3000);
    }
  } catch (err) {
    isVoiceStudioOnline = false;
    markVoiceStudioOffline(err.message);
  }
}

export function markVoiceStudioOnline(deviceInfo = null) {
  isVoiceStudioOnline = true;
  const dot = document.getElementById('vs-status-dot');
  const text = document.getElementById('vs-status-text');
  const banner = document.getElementById('voicestudio-offline-banner');

  if (dot) {
    dot.className = 'w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)]';
  }
  if (text) {
    let devStr = 'Ready';
    if (deviceInfo) {
      if (typeof deviceInfo === 'string' && deviceInfo.toLowerCase().includes('cuda')) {
        devStr = 'CUDA Active';
      } else {
        devStr = String(deviceInfo);
      }
    }
    text.textContent = `OmniVoice ${devStr}`;
    text.className = 'font-semibold text-emerald-400';
  }
  if (banner) banner.classList.add('hidden');
}

export function markVoiceStudioOffline(reason) {
  isVoiceStudioOnline = false;
  const dot = document.getElementById('vs-status-dot');
  const text = document.getElementById('vs-status-text');
  const banner = document.getElementById('voicestudio-offline-banner');
  const vramBadge = document.getElementById('vs-vram-telemetry');

  if (dot) {
    dot.className = 'w-2 h-2 rounded-full bg-amber-400';
  }
  if (text) {
    text.textContent = 'VoiceStudio Offline';
    text.className = 'font-medium text-amber-400';
  }
  if (banner) banner.classList.remove('hidden');
  if (vramBadge) vramBadge.classList.add('hidden');
}

/**
 * Background VRAM and Model Status Telemetry (Zero-waste hygiene)
 */
function startTelemetryPolling() {
  if (telemetryTimer) clearInterval(telemetryTimer);

  telemetryTimer = setInterval(() => {
    // Pause telemetry when window or tab is hidden
    if (document.hidden) return;
    if (!isVoiceStudioOnline) return;

    updateModelTelemetry();
  }, 3500);
}

async function updateModelTelemetry() {
  try {
    const info = await api.invoke('voicestudio_get_model_info');
    if (!info || info.error) return;

    const vramContainer = document.getElementById('vs-vram-telemetry');
    const vramBadge = document.getElementById('vs-vram-badge');
    const modelBadge = document.getElementById('vs-model-checkpoint');

    if (!vramContainer || !vramBadge) return;

    // Parse VRAM and active models from /model/loaded and /model/status
    let totalVramMb = 0;
    let modelName = 'OmniVoice';

    if (info.loaded && Array.isArray(info.loaded.models) && info.loaded.models.length > 0) {
      info.loaded.models.forEach(m => {
        if (m.vram_mb) totalVramMb += m.vram_mb;
        if (m.checkpoint) modelName = m.checkpoint.split('/').pop();
      });
    } else if (info.status && info.status.vram_mb) {
      totalVramMb = info.status.vram_mb;
    }

    vramContainer.classList.remove('hidden');
    vramContainer.classList.add('flex');

    if (totalVramMb > 0) {
      vramBadge.textContent = `${totalVramMb.toLocaleString()} MB`;
      vramBadge.className = 'font-mono text-emerald-400 font-semibold text-[11px]';
    } else {
      vramBadge.textContent = '0 MB (Unloaded)';
      vramBadge.className = 'font-mono text-amber-400 font-semibold text-[11px]';
    }

    if (modelBadge) {
      modelBadge.textContent = modelName;
    }
  } catch {
    // Non-fatal telemetry polling
  }
}

/**
 * 1-Click Unload Model from GPU memory
 */
async function unloadVoiceStudioModel() {
  const btn = document.getElementById('btn-vs-unload-model');
  if (btn) btn.disabled = true;

  try {
    const res = await api.invoke('voicestudio_unload_model', { model_id: 'tts' });
    if (res && (res.success || res.unloaded)) {
      showToast('Model Unloaded', 'TTS model flushed from GPU. VRAM reclaimed.', 'success', 2500);
      updateModelTelemetry();
    } else {
      showToast('Unload Failed', res?.error || 'Could not unload model.', 'warning', 2500);
    }
  } catch (err) {
    showToast('Unload Failed', err.message, 'error', 3000);
  } finally {
    if (btn) btn.disabled = false;
  }
}

/**
 * Flushes VoiceStudio VRAM cache for zero-waste memory hygiene
 */
async function flushVoiceStudioVram() {
  try {
    const res = await api.invoke('voicestudio_flush_memory');
    if (res && res.status === 'success') {
      showToast('VRAM Flushed', 'VoiceStudio GPU caches flushed successfully.', 'success', 2000);
      updateModelTelemetry();
    } else {
      showToast('Flush Requested', 'Flushed VoiceStudio memory caches.', 'info', 2000);
    }
  } catch (err) {
    showToast('Flush Failed', err.message, 'error', 3000);
  }
}

/**
 * Discovers and populates voices and custom profiles
 */
export async function loadDiscoveredVoices(force = false) {
  try {
    const voices = await api.invoke('voicestudio_get_voices', { refresh: force });
    if (Array.isArray(voices) && voices.length > 0) {
      voicesList = voices;
      populateVoiceDropdowns(voices);
      if (force) showToast('Voices Refreshed', `Loaded ${voices.length} voices and profiles.`, 'success', 1500);
    }
  } catch (err) {
    console.warn('[VoiceStudio] Could not load voices:', err);
  }
}

function populateVoiceDropdowns(list) {
  const select = document.getElementById('vs-voice-select');
  const morphSelect = document.getElementById('vs-convert-target-profile');
  if (!select) return;

  const currentVal = select.value;
  select.innerHTML = '';
  if (morphSelect) morphSelect.innerHTML = '<option value="">Select target voice profile...</option>';

  const profiles = list.filter(v => v.type === 'profile');
  const stocks = list.filter(v => v.type !== 'profile');

  if (profiles.length > 0) {
    const optGroupProf = document.createElement('optgroup');
    optGroupProf.label = 'Custom Cloned & Designed Profiles';
    profiles.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.name || p.id;
      opt.textContent = `${p.name} (${p.gender || 'Profile'})`;
      optGroupProf.appendChild(opt);

      if (morphSelect) {
        const mOpt = document.createElement('option');
        mOpt.value = p.id || p.name;
        mOpt.textContent = `${p.name} (Cloned Profile)`;
        morphSelect.appendChild(mOpt);
      }
    });
    select.appendChild(optGroupProf);
  }

  const optGroupStock = document.createElement('optgroup');
  optGroupStock.label = 'Stock Engine Voices';
  stocks.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.name || s.id;
    opt.textContent = `${s.name} (${s.gender || 'Stock'})`;
    optGroupStock.appendChild(opt);

    if (morphSelect) {
      const mOpt = document.createElement('option');
      mOpt.value = s.name || s.id;
      mOpt.textContent = `${s.name} (Stock Voice)`;
      morphSelect.appendChild(mOpt);
    }
  });
  select.appendChild(optGroupStock);

  if (currentVal && list.some(v => (v.name || v.id) === currentVal)) {
    select.value = currentVal;
  }
}

/**
 * Loads personality presets from /personalities
 */
async function loadPersonalitiesPresets() {
  const select = document.getElementById('vs-detail-personality');
  if (!select) return;

  try {
    const presets = await api.invoke('voicestudio_get_personalities');
    if (Array.isArray(presets) && presets.length > 0) {
      select.innerHTML = '<option value="">Default (No Personality Modification)</option>';
      presets.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id || p.name;
        opt.textContent = `${p.name} - ${p.description || ''}`;
        select.appendChild(opt);
      });
    }
  } catch {
    // Non-fatal fallback
  }
}

/**
 * DSP Master Audio Effect Pills
 */
function setupEffectPills() {
  const pills = document.querySelectorAll('.vs-effect-pill');
  const descLabel = document.getElementById('vs-active-effect-desc');

  pills.forEach(pill => {
    pill.addEventListener('click', () => {
      pills.forEach(p => {
        p.className = 'vs-effect-pill px-2.5 py-1 rounded-lg text-xs font-medium bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-emerald-500/40 transition-all cursor-pointer';
      });
      pill.className = 'vs-effect-pill active px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-500 text-black border border-emerald-400 shadow-xs cursor-pointer';

      activeEffect = pill.getAttribute('data-effect') || 'raw';
      if (descLabel) {
        descLabel.textContent = EFFECT_DESCRIPTIONS[activeEffect] || 'Custom DSP Effect';
      }
    });
  });
}

/**
 * Natural voice design parser (/design/describe)
 */
async function analyzeVoiceDescription() {
  const descInput = document.getElementById('vs-voice-description');
  const text = descInput ? descInput.value.trim() : '';

  if (!text) {
    showToast('Description Required', 'Please enter a description for your voice.', 'warning', 2000);
    return;
  }

  const btn = document.getElementById('btn-vs-analyze-description');
  if (btn) btn.disabled = true;

  try {
    const res = await api.invoke('voicestudio_describe', { description: text });
    if (res) {
      applyVoicePredictions(res);

      const instInput = document.getElementById('vs-instruct-input');
      if (instInput && !instInput.value) {
        instInput.value = text;
      }

      const acc = document.getElementById('vs-details-accordion');
      if (acc) acc.open = true;

      showToast('Voice Analyzed', 'Detail tags automatically matched to your description.', 'success', 2000);
    }
  } catch (err) {
    showToast('Analysis Error', err.message, 'error', 3000);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function applyVoicePredictions(tags) {
  if (!tags) return;

  const genderSel = document.getElementById('vs-detail-gender');
  const ageSel = document.getElementById('vs-detail-age');
  const pitchSel = document.getElementById('vs-detail-pitch');
  const styleSel = document.getElementById('vs-detail-style');
  const accentSel = document.getElementById('vs-detail-accent');
  const langSel = document.getElementById('vs-detail-language');

  if (genderSel && tags.gender) selectOptionCaseInsensitive(genderSel, tags.gender);
  if (ageSel && tags.age) selectOptionCaseInsensitive(ageSel, tags.age);
  if (pitchSel && tags.pitch) selectOptionCaseInsensitive(pitchSel, tags.pitch);
  if (styleSel && tags.style) selectOptionCaseInsensitive(styleSel, tags.style);
  if (accentSel && (tags.english_accent || tags.accent)) {
    selectOptionCaseInsensitive(accentSel, tags.english_accent || tags.accent);
  }
  if (langSel && tags.language) selectOptionCaseInsensitive(langSel, tags.language);

  const tray = document.getElementById('vs-predicted-tags-tray');
  if (tray) {
    tray.innerHTML = '';
    const items = [
      tags.gender && `Gender: ${tags.gender}`,
      tags.age && `Age: ${tags.age}`,
      tags.pitch && `Pitch: ${tags.pitch}`,
      tags.style && `Style: ${tags.style}`,
      tags.english_accent && `Accent: ${tags.english_accent}`
    ].filter(Boolean);

    if (items.length > 0) {
      tray.classList.remove('hidden');
      items.forEach(tagStr => {
        const span = document.createElement('span');
        span.className = 'px-2 py-0.5 rounded-md text-[10px] font-medium bg-emerald-500/15 border border-emerald-500/30 text-emerald-300';
        span.textContent = tagStr;
        tray.appendChild(span);
      });
    }
  }
}

function selectOptionCaseInsensitive(selectEl, value) {
  const norm = String(value || '').toLowerCase().trim();
  for (let i = 0; i < selectEl.options.length; i++) {
    if (selectEl.options[i].value.toLowerCase() === norm || selectEl.options[i].text.toLowerCase() === norm) {
      selectEl.selectedIndex = i;
      return;
    }
  }
}

function resetDetailSelects() {
  ['vs-detail-gender', 'vs-detail-age', 'vs-detail-pitch', 'vs-detail-style', 'vs-detail-accent'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = 'Auto';
  });
}

/**
 * Starting Points Pill Presets Setup
 */
function setupPresetPills() {
  const pills = document.querySelectorAll('.vs-preset-pill');
  pills.forEach(pill => {
    pill.addEventListener('click', () => {
      pills.forEach(p => {
        p.className = 'vs-preset-pill px-2.5 py-1 rounded-lg text-xs font-medium bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-emerald-500/40 transition-all cursor-pointer';
      });
      pill.className = 'vs-preset-pill active px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-500 text-black border border-emerald-400 shadow-sm transition-all cursor-pointer';

      const preset = pill.getAttribute('data-preset');
      applyStartingPointPreset(preset);
    });
  });
}

function applyStartingPointPreset(preset) {
  const instInput = document.getElementById('vs-instruct-input');
  const voiceSelect = document.getElementById('vs-voice-select');

  if (instInput) instInput.value = preset;

  if (voiceSelect) {
    for (let i = 0; i < voiceSelect.options.length; i++) {
      if (voiceSelect.options[i].value.toLowerCase() === preset.toLowerCase()) {
        voiceSelect.selectedIndex = i;
        break;
      }
    }
  }

  const genderSel = document.getElementById('vs-detail-gender');
  const ageSel = document.getElementById('vs-detail-age');
  const pitchSel = document.getElementById('vs-detail-pitch');
  const styleSel = document.getElementById('vs-detail-style');

  resetDetailSelects();

  switch (preset) {
    case 'Narrator':
      if (genderSel) genderSel.value = 'Male';
      if (pitchSel) pitchSel.value = 'Low';
      if (ageSel) ageSel.value = 'Middle-aged';
      break;
    case 'Storyteller':
      if (genderSel) genderSel.value = 'Female';
      if (pitchSel) pitchSel.value = 'Moderate';
      break;
    case 'News Anchor':
      if (pitchSel) pitchSel.value = 'Moderate';
      if (ageSel) ageSel.value = 'Young Adult';
      break;
    case 'Whisper':
      if (styleSel) styleSel.value = 'Whisper';
      break;
    case 'Excited Child':
      if (ageSel) ageSel.value = 'Child';
      if (pitchSel) pitchSel.value = 'High';
      break;
    case 'Elder':
      if (ageSel) ageSel.value = 'Elderly';
      if (pitchSel) pitchSel.value = 'Low';
      break;
    case 'Authoritative':
      if (pitchSel) pitchSel.value = 'Low';
      break;
  }
}

function updateCharCounter() {
  const input = document.getElementById('vs-input-text');
  const counter = document.getElementById('vs-char-counter');
  if (input && counter) {
    const chars = input.value.length;
    const words = input.value.trim() ? input.value.trim().split(/\s+/).length : 0;
    counter.textContent = `${chars} chars · ${words} words`;
  }
}

function insertSampleText() {
  const samples = [
    "Welcome to Voice Studio. With native local synthesis, your models can now speak naturally with low latency and pristine fidelity.",
    "Beyond the misty mountains, the ancient library stood silent under the starlit sky, guarding secrets whispered through centuries.",
    "Attention crew: system diagnostics are complete. All subroutines and neural pipelines are operational at peak efficiency."
  ];
  const input = document.getElementById('vs-input-text');
  if (input) {
    const rand = samples[Math.floor(Math.random() * samples.length)];
    input.value = rand;
    updateCharCounter();
  }
}

/**
 * Direct Speech Synthesis with Advanced Acoustic & DSP Parameters
 */
async function synthesizeSpeech() {
  const textInput = document.getElementById('vs-input-text');
  const text = textInput ? textInput.value.trim() : '';

  if (!text) {
    showToast('Input Required', 'Please enter text to synthesize.', 'warning', 2000);
    return;
  }

  const voiceSelect = document.getElementById('vs-voice-select');
  const voice = voiceSelect ? voiceSelect.value : 'Narrator';

  const speedSlider = document.getElementById('vs-speed-slider');
  const speed = speedSlider ? parseFloat(speedSlider.value) : 1.0;

  const guidanceSlider = document.getElementById('vs-guidance-slider');
  const guidanceScale = guidanceSlider ? parseFloat(guidanceSlider.value) : 3.0;

  const stepsSlider = document.getElementById('vs-steps-slider');
  const numSteps = stepsSlider ? parseInt(stepsSlider.value, 10) : 32;

  const seedInput = document.getElementById('vs-seed-input');
  let seedVal = seedInput ? parseInt(seedInput.value, 10) : -1;
  if (isNaN(seedVal) || seedVal < 0) seedVal = null;

  const instructInput = document.getElementById('vs-instruct-input');
  let instruct = instructInput ? instructInput.value.trim() : '';

  // Append any active detail selections to instruct
  const gender = document.getElementById('vs-detail-gender')?.value;
  const age = document.getElementById('vs-detail-age')?.value;
  const pitch = document.getElementById('vs-detail-pitch')?.value;
  const style = document.getElementById('vs-detail-style')?.value;
  const accent = document.getElementById('vs-detail-accent')?.value;
  const lang = document.getElementById('vs-detail-language')?.value || 'en';
  const personality = document.getElementById('vs-detail-personality')?.value;

  const extraTags = [];
  if (gender && gender !== 'Auto') extraTags.push(`${gender}`);
  if (age && age !== 'Auto') extraTags.push(`${age}`);
  if (pitch && pitch !== 'Auto') extraTags.push(`${pitch} pitch`);
  if (style && style !== 'Auto') extraTags.push(`${style}`);
  if (accent && accent !== 'Auto') extraTags.push(`${accent} accent`);
  if (personality) extraTags.push(`personality: ${personality}`);

  if (extraTags.length > 0) {
    instruct = instruct ? `${instruct}, ${extraTags.join(', ')}` : extraTags.join(', ');
  }

  const btn = document.getElementById('btn-vs-synthesize');
  const btnText = document.getElementById('vs-synth-btn-text');
  const btnIcon = document.getElementById('vs-synth-icon');

  if (btn) btn.disabled = true;
  if (btnText) btnText.textContent = 'Synthesizing Audio...';
  if (btnIcon) btnIcon.classList.add('animate-spin');

  try {
    const res = await api.invoke('voicestudio_generate', {
      text,
      voice,
      speed,
      instruct,
      language: lang,
      effect: activeEffect !== 'raw' ? activeEffect : null,
      guidance_scale: guidanceScale,
      num_step: numSteps,
      seed: seedVal
    });

    if (res && res.status === 'success' && res.record) {
      markVoiceStudioOnline();
      showToast('Synthesis Complete', `Audio created with voice '${voice}'.`, 'success', 2500);
      prependHistoryRecord(res.record);
      switchToLibraryView();
      updateModelTelemetry();
    } else if (res && res.Filename) {
      markVoiceStudioOnline();
      showToast('Synthesis Complete', `Audio created with voice '${voice}'.`, 'success', 2500);
      prependHistoryRecord(res);
      switchToLibraryView();
      updateModelTelemetry();
    } else {
      throw new Error(res?.message || 'Synthesis returned an unexpected response');
    }
  } catch (err) {
    showToast('Synthesis Failed', err.message, 'error', 4000);
  } finally {
    if (btn) btn.disabled = false;
    if (btnText) btnText.textContent = 'Synthesize Audio';
    if (btnIcon) btnIcon.classList.remove('animate-spin');
  }
}

/**
 * Multi-Mode Sub-Tabs Navigation (Library vs Profiles vs Speech-to-Speech vs Stories)
 */
function setupSubTabs() {
  const tabs = [
    { btnId: 'btn-vs-subtab-history', paneId: 'vs-pane-history', showActions: true },
    { btnId: 'btn-vs-subtab-profiles', paneId: 'vs-pane-profiles', showActions: false },
    { btnId: 'btn-vs-subtab-convert', paneId: 'vs-pane-convert', showActions: false },
    { btnId: 'btn-vs-subtab-stories', paneId: 'vs-pane-stories', showActions: false }
  ];

  tabs.forEach(tab => {
    document.getElementById(tab.btnId)?.addEventListener('click', () => {
      tabs.forEach(t => {
        const b = document.getElementById(t.btnId);
        const p = document.getElementById(t.paneId);
        if (b) {
          b.className = t.btnId === tab.btnId
            ? 'vs-subtab-btn active px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap'
            : 'vs-subtab-btn px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap';
        }
        if (p) {
          if (t.btnId === tab.btnId) p.classList.remove('hidden');
          else p.classList.add('hidden');
        }
      });

      const actions = document.getElementById('vs-history-actions');
      if (actions) {
        if (tab.showActions) actions.classList.remove('hidden');
        else actions.classList.add('hidden');
      }

      if (tab.paneId === 'vs-pane-profiles') {
        loadVoiceProfiles();
      }
    });
  });
}

function switchToLibraryView() {
  document.getElementById('btn-vs-subtab-history')?.click();
}

/**
 * Generated History Library Management & Starring
 */
export async function loadGeneratedHistory(force = false) {
  try {
    const list = await api.invoke('voicestudio_get_history');
    if (Array.isArray(list)) {
      historyList = list;
      renderHistoryList(getVisibleHistory());
      updateHistoryCounter(list.length);
      if (force) showToast('Library Refreshed', `Loaded ${list.length} tracks.`, 'info', 1500);
    }
  } catch (err) {
    console.warn('[VoiceStudio] Could not load history:', err);
  }
}

function getVisibleHistory() {
  if (isStarredFilterActive) {
    return historyList.filter(x => Boolean(x.starred || x.Starred));
  }
  return historyList;
}

function toggleStarredFilter() {
  isStarredFilterActive = !isStarredFilterActive;
  const btn = document.getElementById('btn-vs-filter-starred');
  if (btn) {
    if (isStarredFilterActive) {
      btn.className = 'px-2.5 py-1 rounded-lg border border-amber-500/50 bg-amber-500/15 text-xs text-amber-300 font-semibold transition-colors flex items-center gap-1 cursor-pointer';
    } else {
      btn.className = 'px-2.5 py-1 rounded-lg border border-[var(--border)] bg-[var(--bg-base)] text-xs text-[var(--text-muted)] hover:text-amber-400 hover:border-amber-500/40 transition-colors flex items-center gap-1 cursor-pointer';
    }
  }
  renderHistoryList(getVisibleHistory());
}

function updateHistoryCounter(count) {
  const badge = document.getElementById('vs-history-count');
  if (badge) badge.textContent = count;
}

function renderHistoryList(list) {
  const emptyState = document.getElementById('vs-history-empty');
  const container = document.getElementById('vs-history-list');
  if (!container || !emptyState) return;

  if (list.length === 0) {
    emptyState.classList.remove('hidden');
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  emptyState.classList.add('hidden');
  container.classList.remove('hidden');
  container.innerHTML = '';

  list.forEach(rec => {
    container.appendChild(createHistoryCardElement(rec));
  });
}

function prependHistoryRecord(record) {
  historyList.unshift(record);
  updateHistoryCounter(historyList.length);

  const emptyState = document.getElementById('vs-history-empty');
  const container = document.getElementById('vs-history-list');
  if (emptyState) emptyState.classList.add('hidden');
  if (container) {
    container.classList.remove('hidden');
    const card = createHistoryCardElement(record);
    container.prepend(card);
  }
}

function createHistoryCardElement(rec) {
  const card = document.createElement('div');
  card.className = 'p-4 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border)] hover:border-emerald-500/40 transition-all flex flex-col gap-2.5 shadow-xs select-text animate-in fade-in duration-200';
  const id = rec.id || rec.Id;
  card.setAttribute('data-id', id);

  const fileUrl = rec.relative_url || rec.RelativeUrl || `/media/audio/${rec.filename || rec.Filename}`;
  const filename = rec.filename || rec.Filename || 'tts_speech.mp3';
  const voice = rec.voice || rec.Voice || 'Narrator';
  const text = rec.text || rec.Text || '';
  const timestamp = formatTimestamp(rec.timestamp || rec.Timestamp);
  const sizeKb = rec.size_bytes || rec.SizeBytes ? `${Math.round((rec.size_bytes || rec.SizeBytes) / 1024)} KB` : '';
  const isStarred = Boolean(rec.starred || rec.Starred);
  const effectName = rec.effect || rec.Effect;

  card.innerHTML = `
    <div class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-2 min-w-0 flex-wrap">
        <span class="px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 truncate">
          ${escapeHtml(voice)}
        </span>
        ${effectName ? `<span class="px-2 py-0.5 rounded-md text-[10px] font-medium bg-[var(--bg-base)] border border-[var(--border)] text-emerald-300 font-mono">${escapeHtml(effectName)}</span>` : ''}
        <span class="text-[11px] text-[var(--text-muted)] font-mono">${escapeHtml(timestamp)}</span>
        ${sizeKb ? `<span class="text-[10px] text-[var(--text-muted)] hidden sm:inline font-mono">(${sizeKb})</span>` : ''}
      </div>

      <div class="flex items-center gap-1.5 shrink-0">
        <!-- Star Toggle Button -->
        <button class="btn-star-audio p-1.5 rounded-lg bg-[var(--bg-base)] border border-[var(--border)] ${isStarred ? 'text-amber-400 border-amber-500/40' : 'text-[var(--text-muted)] hover:text-amber-400'} transition-all cursor-pointer shadow-xs" title="${isStarred ? 'Unstar take' : 'Star keeper take (survives cleanup)'}">
          <svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        </button>

        <!-- Download Button -->
        <a href="${escapeHtml(fileUrl)}" download="${escapeHtml(filename)}" class="p-1.5 rounded-lg bg-[var(--bg-base)] border border-[var(--border)] hover:border-emerald-500/50 hover:text-emerald-400 text-[var(--text-secondary)] transition-all cursor-pointer shadow-xs" title="Download Audio">
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </a>

        <!-- Delete Button -->
        <button class="btn-delete-audio p-1.5 rounded-lg bg-[var(--bg-base)] border border-[var(--border)] hover:border-rose-500/50 hover:text-rose-400 text-[var(--text-muted)] transition-all cursor-pointer" title="Delete Audio Track">
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
        </button>
      </div>
    </div>

    ${text ? `<div class="text-xs text-[var(--text-primary)] leading-relaxed italic bg-[var(--bg-base)]/60 px-3 py-2 rounded-xl border-l-2 border-emerald-500/60 line-clamp-3 select-text">“${escapeHtml(text)}”</div>` : ''}

    <div class="pt-0.5">
      <audio controls preload="metadata" class="w-full h-9 rounded-xl outline-none accent-emerald-500">
        <source src="${escapeHtml(fileUrl)}" type="audio/mpeg">
        Your browser does not support audio playback.
      </audio>
    </div>
  `;

  // Star Toggle Handler
  const starBtn = card.querySelector('.btn-star-audio');
  starBtn?.addEventListener('click', async () => {
    const curState = Boolean(rec.starred || rec.Starred);
    const newState = !curState;
    rec.starred = newState;
    rec.Starred = newState;

    try {
      await api.invoke('voicestudio_toggle_star', { id, starred: newState });
      if (newState) {
        starBtn.className = 'btn-star-audio p-1.5 rounded-lg bg-[var(--bg-base)] border border-amber-500/40 text-amber-400 transition-all cursor-pointer shadow-xs';
        showToast('Take Starred', 'Take pinned to keepers.', 'info', 1200);
      } else {
        starBtn.className = 'btn-star-audio p-1.5 rounded-lg bg-[var(--bg-base)] border border-[var(--border)] text-[var(--text-muted)] hover:text-amber-400 transition-all cursor-pointer shadow-xs';
      }
    } catch (err) {
      showToast('Star Update Failed', err.message, 'error', 2000);
    }
  });

  // Delete Action
  const delBtn = card.querySelector('.btn-delete-audio');
  delBtn?.addEventListener('click', async () => {
    if (confirm('Delete this generated audio track?')) {
      try {
        await api.invoke('voicestudio_delete_history', { id });
        card.remove();
        historyList = historyList.filter(h => (h.id || h.Id) !== id);
        updateHistoryCounter(historyList.length);
        if (historyList.length === 0) {
          document.getElementById('vs-history-empty')?.classList.remove('hidden');
          document.getElementById('vs-history-list')?.classList.add('hidden');
        }
        showToast('Track Deleted', 'Audio record removed.', 'info', 1500);
      } catch (err) {
        showToast('Delete Failed', err.message, 'error', 2500);
      }
    }
  });

  return card;
}

function filterHistoryRecords(query) {
  const norm = String(query || '').toLowerCase().trim();
  const source = getVisibleHistory();

  if (!norm) {
    renderHistoryList(source);
    return;
  }

  const filtered = source.filter(rec => {
    const voice = (rec.voice || rec.Voice || '').toLowerCase();
    const text = (rec.text || rec.Text || '').toLowerCase();
    return voice.includes(norm) || text.includes(norm);
  });
  renderHistoryList(filtered);
}

/**
 * Voice Cloning & Custom Profiles Studio
 */
function setupVoiceCloningStudio() {
  const browseBtn = document.getElementById('btn-vs-clone-browse');
  const pathInput = document.getElementById('vs-clone-file-path');
  const fileInput = document.getElementById('vs-clone-file-input');

  browseBtn?.addEventListener('click', async () => {
    // Attempt native file dialog via NativeBridge
    try {
      const selected = await api.invoke('dialog_select_file', { filter: 'audio' });
      if (selected && typeof selected === 'string') {
        if (pathInput) pathInput.value = selected;
        return;
      }
    } catch {
      // Fallback to HTML input
    }
    fileInput?.click();
  });

  fileInput?.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      const f = e.target.files[0];
      if (pathInput) pathInput.value = f.name;
    }
  });

  document.getElementById('btn-vs-create-clone')?.addEventListener('click', () => {
    createVoiceCloneProfile();
  });

  document.getElementById('btn-vs-reload-profiles')?.addEventListener('click', () => {
    loadVoiceProfiles(true);
  });
}

async function createVoiceCloneProfile() {
  const nameInput = document.getElementById('vs-clone-name');
  const name = nameInput ? nameInput.value.trim() : '';

  const pathInput = document.getElementById('vs-clone-file-path');
  const audioPath = pathInput ? pathInput.value.trim() : '';

  if (!name) {
    showToast('Name Required', 'Please specify a name for the voice clone.', 'warning', 2000);
    return;
  }

  if (!audioPath) {
    showToast('Reference Audio Required', 'Please select a reference audio file.', 'warning', 2000);
    return;
  }

  const refText = document.getElementById('vs-clone-ref-text')?.value.trim() || null;
  const instruct = document.getElementById('vs-clone-instruct')?.value.trim() || null;
  const lang = document.getElementById('vs-clone-lang')?.value || 'en';

  const btn = document.getElementById('btn-vs-create-clone');
  const btnText = document.getElementById('btn-vs-create-clone-text');
  if (btn) btn.disabled = true;
  if (btnText) btnText.textContent = 'Saving Profile...';

  try {
    const res = await api.invoke('voicestudio_create_profile', {
      name,
      audio_path: audioPath,
      ref_text: refText,
      instruct,
      language: lang
    });

    if (res && (res.status === 'success' || res.id)) {
      showToast('Voice Profile Created', `Profile "${name}" ready for synthesis!`, 'success', 3000);
      if (nameInput) nameInput.value = '';
      if (pathInput) pathInput.value = '';
      document.getElementById('vs-clone-ref-text').value = '';
      document.getElementById('vs-clone-instruct').value = '';

      loadVoiceProfiles();
      loadDiscoveredVoices(true);
    } else {
      throw new Error(res?.message || 'Failed to create voice profile');
    }
  } catch (err) {
    showToast('Profile Creation Failed', err.message, 'error', 3500);
  } finally {
    if (btn) btn.disabled = false;
    if (btnText) btnText.textContent = 'Save Voice Profile';
  }
}

async function loadVoiceProfiles(force = false) {
  try {
    const profs = await api.invoke('voicestudio_get_profiles');
    if (Array.isArray(profs)) {
      profilesList = profs;
      renderProfilesGrid(profs);
      const countBadge = document.getElementById('vs-profiles-count');
      if (countBadge) countBadge.textContent = profs.length;
      if (force) showToast('Profiles Refreshed', `Loaded ${profs.length} profiles.`, 'info', 1500);
    }
  } catch (err) {
    console.warn('[VoiceStudio] Could not load profiles:', err);
  }
}

function renderProfilesGrid(profiles) {
  const empty = document.getElementById('vs-profiles-empty');
  const grid = document.getElementById('vs-profiles-grid');
  if (!empty || !grid) return;

  if (profiles.length === 0) {
    empty.classList.remove('hidden');
    grid.classList.add('hidden');
    grid.innerHTML = '';
    return;
  }

  empty.classList.add('hidden');
  grid.classList.remove('hidden');
  grid.innerHTML = '';

  profiles.forEach(p => {
    const card = document.createElement('div');
    card.className = 'p-3.5 rounded-xl bg-[var(--bg-base)] border border-[var(--border)] hover:border-emerald-500/40 transition-all flex flex-col justify-between gap-3 shadow-xs';
    const profId = p.id || p.profile_id;
    const profName = p.name || 'Unnamed Voice';
    const kind = p.kind || 'clone';
    const lang = p.language || 'en';

    card.innerHTML = `
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 min-w-0">
          <div class="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold text-xs shrink-0">
            ${profName.charAt(0).toUpperCase()}
          </div>
          <div class="min-w-0">
            <h4 class="text-xs font-bold text-[var(--text-primary)] truncate">${escapeHtml(profName)}</h4>
            <span class="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">${escapeHtml(kind)} · ${escapeHtml(lang)}</span>
          </div>
        </div>

        <button class="btn-delete-profile p-1.5 rounded-lg text-[var(--text-muted)] hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer" title="Delete Profile">
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/></svg>
        </button>
      </div>

      <!-- Reference Audio Preview Player -->
      <div class="pt-1">
        <audio controls preload="none" class="w-full h-8 rounded-lg outline-none accent-emerald-500">
          <source src="http://127.0.0.1:3900/profiles/${escapeHtml(profId)}/audio" type="audio/wav">
          Your browser does not support audio playback.
        </audio>
      </div>

      <!-- Action Button -->
      <div class="pt-1">
        <button class="btn-use-profile w-full py-1.5 px-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] hover:border-emerald-500/50 hover:text-emerald-400 text-xs text-[var(--text-secondary)] font-medium transition-all flex items-center justify-center gap-1.5 cursor-pointer">
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          <span>Use as Active Voice</span>
        </button>
      </div>
    `;

    // Use As Active Voice Handler
    card.querySelector('.btn-use-profile')?.addEventListener('click', () => {
      const select = document.getElementById('vs-voice-select');
      if (select) {
        select.value = profName;
      }
      showToast('Voice Selected', `Active synthesizer voice set to "${profName}".`, 'success', 2000);
      switchToLibraryView();
    });

    // Delete Profile Handler
    card.querySelector('.btn-delete-profile')?.addEventListener('click', async () => {
      if (confirm(`Delete voice profile "${profName}"?`)) {
        try {
          await api.invoke('voicestudio_delete_profile', { id: profId });
          card.remove();
          loadVoiceProfiles();
          loadDiscoveredVoices(true);
          showToast('Profile Deleted', `Deleted "${profName}".`, 'info', 1500);
        } catch (err) {
          showToast('Delete Failed', err.message, 'error', 2500);
        }
      }
    });

    grid.appendChild(card);
  });
}

/**
 * Speech-to-Speech (Voice Morph)
 */
function setupSpeechToSpeech() {
  const browseBtn = document.getElementById('btn-vs-convert-browse');
  const pathInput = document.getElementById('vs-convert-audio-path');
  const fileInput = document.getElementById('vs-convert-file-input');

  browseBtn?.addEventListener('click', async () => {
    try {
      const selected = await api.invoke('dialog_select_file', { filter: 'audio' });
      if (selected && typeof selected === 'string') {
        if (pathInput) pathInput.value = selected;
        return;
      }
    } catch {}
    fileInput?.click();
  });

  fileInput?.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      const f = e.target.files[0];
      if (pathInput) pathInput.value = f.name;
    }
  });

  document.getElementById('btn-vs-run-convert')?.addEventListener('click', () => {
    runSpeechConversion();
  });
}

async function runSpeechConversion() {
  const audioInput = document.getElementById('vs-convert-audio-path');
  const audioPath = audioInput ? audioInput.value.trim() : '';

  const profileSelect = document.getElementById('vs-convert-target-profile');
  const profileId = profileSelect ? profileSelect.value : '';

  if (!audioPath) {
    showToast('Source Audio Required', 'Please select a source spoken recording.', 'warning', 2000);
    return;
  }

  if (!profileId) {
    showToast('Target Profile Required', 'Please select a target voice profile.', 'warning', 2000);
    return;
  }

  const matchDur = document.getElementById('vs-convert-match-dur')?.checked ?? true;
  const cleanFirst = document.getElementById('vs-convert-clean-first')?.checked ?? true;

  const btn = document.getElementById('btn-vs-run-convert');
  const btnText = document.getElementById('btn-vs-run-convert-text');
  if (btn) btn.disabled = true;
  if (btnText) btnText.textContent = cleanFirst ? 'Cleaning & Morphing Speech...' : 'Morphing Speech...';

  try {
    const res = await api.invoke('voicestudio_convert_speech', {
      audio_path: audioPath,
      profile_id: profileId,
      match_duration: matchDur,
      clean_first: cleanFirst
    });

    if (res && res.status === 'success' && res.record) {
      showToast('Speech Converted', 'Voice morph completed successfully!', 'success', 2500);

      // Render Result Card
      const resultCard = document.getElementById('vs-convert-result-card');
      const resultAudio = document.getElementById('vs-convert-result-audio');
      const resultText = document.getElementById('vs-convert-result-text');
      const resultTime = document.getElementById('vs-convert-result-time');

      if (resultCard && resultAudio) {
        resultCard.classList.remove('hidden');
        const audioUrl = res.record.relative_url || res.record.RelativeUrl || `/media/audio/${res.record.filename || res.record.Filename}`;
        resultAudio.src = audioUrl;
        resultAudio.play().catch(() => {});

        if (resultText) resultText.textContent = `“${res.record.text || res.record.Text || 'Converted Voice'}”`;
        if (resultTime) resultTime.textContent = formatTimestamp(res.record.timestamp || res.record.Timestamp);
      }

      prependHistoryRecord(res.record);
    } else {
      throw new Error(res?.message || 'Speech conversion failed.');
    }
  } catch (err) {
    showToast('Conversion Failed', err.message, 'error', 3500);
  } finally {
    if (btn) btn.disabled = false;
    if (btnText) btnText.textContent = 'Morph Speech Audio';
  }
}

/**
 * Stories & Longform Script Composer
 */
function setupStoriesStudio() {
  const container = document.getElementById('vs-story-lines-container');
  document.getElementById('btn-vs-story-add-line')?.addEventListener('click', () => {
    addStoryScriptRow();
  });

  document.getElementById('btn-vs-story-example')?.addEventListener('click', () => {
    loadExampleStoryScript();
  });

  document.getElementById('btn-vs-render-story')?.addEventListener('click', () => {
    renderStoryAudio();
  });

  if (container && container.children.length === 0) {
    addStoryScriptRow('Narrator', 'The clock struck midnight as the traveler finally reached the sanctuary gates.');
    addStoryScriptRow('Casual', 'Is anybody still inside? I carry news from the northern border!');
  }
}

function addStoryScriptRow(defaultVoice = 'Narrator', defaultText = '') {
  const container = document.getElementById('vs-story-lines-container');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'story-script-row p-3 rounded-xl bg-[var(--bg-base)] border border-[var(--border)] flex flex-col sm:flex-row gap-2.5 items-start sm:items-center animate-in fade-in duration-150';

  let voiceOptionsHtml = '';
  voicesList.forEach(v => {
    const name = v.name || v.id;
    const isSel = name.toLowerCase() === defaultVoice.toLowerCase() ? 'selected' : '';
    voiceOptionsHtml += `<option value="${escapeHtml(name)}" ${isSel}>${escapeHtml(name)}</option>`;
  });

  if (!voiceOptionsHtml) {
    voiceOptionsHtml = `
      <option value="Narrator">Narrator</option>
      <option value="Storyteller">Storyteller</option>
      <option value="Casual">Casual</option>
      <option value="News Anchor">News Anchor</option>
    `;
  }

  row.innerHTML = `
    <div class="flex items-center gap-2 w-full sm:w-44 shrink-0">
      <select class="story-row-voice w-full px-2 py-1.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] text-xs text-[var(--text-primary)] font-medium">
        ${voiceOptionsHtml}
      </select>
    </div>
    <div class="flex-1 w-full">
      <textarea rows="1" class="story-row-text w-full px-2.5 py-1.5 text-xs bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-emerald-500/50 resize-none leading-relaxed" placeholder="Speaker dialogue or narration...">${escapeHtml(defaultText)}</textarea>
    </div>
    <button type="button" class="btn-remove-row p-1.5 rounded-lg text-[var(--text-muted)] hover:text-rose-400 hover:bg-rose-500/10 transition-colors self-end sm:self-center cursor-pointer" title="Remove line">
      <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  `;

  row.querySelector('.btn-remove-row')?.addEventListener('click', () => {
    row.remove();
  });

  container.appendChild(row);
}

function loadExampleStoryScript() {
  const container = document.getElementById('vs-story-lines-container');
  if (!container) return;
  container.innerHTML = '';

  const titleInput = document.getElementById('vs-story-title');
  if (titleInput) titleInput.value = 'The Obsidian Citadel';

  addStoryScriptRow('Narrator', 'The rain hammered relentlessly against the obsidian spires of the citadel.');
  addStoryScriptRow('Authoritative', 'Halt! Identify yourself before stepping across the threshold.');
  addStoryScriptRow('Casual', 'Peace, warden. I bring the cipher requested by the archivist.');
  addStoryScriptRow('Narrator', 'With a heavy groan of iron, the ancient gateway slowly unlocked.');
}

async function renderStoryAudio() {
  const title = document.getElementById('vs-story-title')?.value.trim() || 'Untitled Story';
  const format = document.getElementById('vs-story-format')?.value || 'mp3';
  const rows = document.querySelectorAll('.story-script-row');

  const lines = [];
  rows.forEach(r => {
    const voice = r.querySelector('.story-row-voice')?.value || 'Narrator';
    const text = r.querySelector('.story-row-text')?.value.trim() || '';
    if (text) {
      lines.push({ voice, text });
    }
  });

  if (lines.length === 0) {
    showToast('Script Empty', 'Please add at least one line of dialogue or narration.', 'warning', 2000);
    return;
  }

  const btn = document.getElementById('btn-vs-render-story');
  const btnText = document.getElementById('btn-vs-render-story-text');
  if (btn) btn.disabled = true;
  if (btnText) btnText.textContent = 'Rendering Full Story...';

  try {
    const spans = lines.map(l => ({
      voice_id: l.voice,
      text: l.text
    }));

    const payload = {
      title,
      format,
      chapters: [
        {
          title: title,
          spans: spans
        }
      ],
      lines
    };

    const res = await api.invoke('voicestudio_render_story', payload);
    if (res && res.status === 'success') {
      markVoiceStudioOnline();
      showToast('Story Rendered', `Audiobook "${title}" successfully synthesized!`, 'success', 3000);
      if (res.record) {
        prependHistoryRecord(res.record);
      }
      switchToLibraryView();
      updateModelTelemetry();
    } else {
      throw new Error(res?.message || 'Story synthesis failed.');
    }
  } catch (err) {
    showToast('Story Render Failed', err.message, 'error', 3500);
  } finally {
    if (btn) btn.disabled = false;
    if (btnText) btnText.textContent = 'Render Full Story Audio';
  }
}

// Formatting helpers
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTimestamp(isoStr) {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return isoStr;
  }
}
