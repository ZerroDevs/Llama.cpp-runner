/**
 * Llama Server Control - Performance Tuning & Speculative Decoding Controller
 */

import { state } from './state.js';
import { api } from './api.js';

export function setupTuning() {
  const draftModelInput = document.getElementById('input-draft-model');
  const draftMaxInput = document.getElementById('input-draft-max');

  draftModelInput?.addEventListener('change', () => {
    state.config.draft_model = draftModelInput.value.trim();
    api.invoke('save_config', state.config);
  });

  draftMaxInput?.addEventListener('change', () => {
    state.config.draft_max = parseInt(draftMaxInput.value) || 16;
    api.invoke('save_config', state.config);
  });
}
