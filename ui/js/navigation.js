/**
 * Llama Server Control - Tab Navigation Manager
 */

import { state } from './state.js';
import { scanLocalModels } from './models.js';
import { refreshGallery } from './swarm.js';

export function setupNavigation() {
  const buttons = document.querySelectorAll('.nav-tab-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      if (targetId) switchTab(targetId);
    });
  });
}

export function switchTab(targetId) {
  state.activeTab = targetId;

  // Update navigation button active state
  document.querySelectorAll('.nav-tab-btn').forEach(b => {
    if (b.getAttribute('data-target') === targetId) {
      b.classList.add('active');
    } else {
      b.classList.remove('active');
    }
  });

  // Strict tab activation - ensure ONLY the target tab is visible
  document.querySelectorAll('.tab-pane').forEach(p => {
    if (p.id === targetId) {
      p.classList.add('active');
    } else {
      p.classList.remove('active');
    }
  });

  // Tab activation lifecycle hooks
  if (targetId === 'tab-models') scanLocalModels();
  if (targetId === 'tab-swarm') refreshGallery();
}
