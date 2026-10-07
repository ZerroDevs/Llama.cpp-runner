/**
 * Llama Server Control - Tab Navigation Manager
 */

import { state } from './state.js';
import { scanLocalModels } from './models.js';
import { refreshGallery, scanSwarmModels } from './swarm.js';
import { syncLlamaWebState } from './llama-web.js';
import { onChatTabActivated } from './chat.js';

export function setupNavigation() {
  const buttons = document.querySelectorAll('.nav-tab-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      if (targetId) {
        if (targetId === 'tab-chat') {
          const subMenu = document.getElementById('chat-sub-menu');
          const chevron = document.getElementById('chat-sub-chevron');
          if (state.activeTab === 'tab-chat' || state.activeTab === 'tab-llama-web') {
            subMenu?.classList.toggle('hidden');
            chevron?.classList.toggle('rotate-180');
          } else {
            subMenu?.classList.remove('hidden');
            chevron?.classList.add('rotate-180');
          }
        }
        switchTab(targetId);
      }
    });
  });

  // Toggle button specifically for Chat Sub-options
  const toggleBtn = document.getElementById('btn-toggle-chat-sub');
  toggleBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const subMenu = document.getElementById('chat-sub-menu');
    const chevron = document.getElementById('chat-sub-chevron');
    subMenu?.classList.toggle('hidden');
    chevron?.classList.toggle('rotate-180');
  });

  // Sub navigation buttons (Studio Chat & Llama Web UI)
  const subButtons = document.querySelectorAll('.nav-sub-btn');
  subButtons.forEach(subBtn => {
    subBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const targetId = subBtn.getAttribute('data-target');
      if (targetId) switchTab(targetId);
    });
  });

  // Header quick switch from Studio Chat to Llama Web UI
  document.getElementById('btn-chat-to-llama-web')?.addEventListener('click', () => {
    switchTab('tab-llama-web');
  });
}

export function switchTab(targetId) {
  state.activeTab = targetId;

  const isChatSection = targetId === 'tab-chat' || targetId === 'tab-llama-web';

  // Update navigation button active state
  document.querySelectorAll('.nav-tab-btn').forEach(b => {
    const btnTarget = b.getAttribute('data-target');
    if (btnTarget === targetId || (isChatSection && btnTarget === 'tab-chat')) {
      b.classList.add('active');
    } else {
      b.classList.remove('active');
    }
  });

  // Update sub-navigation buttons and ensure sub-menu is expanded when in chat
  const subMenu = document.getElementById('chat-sub-menu');
  const chevron = document.getElementById('chat-sub-chevron');
  if (isChatSection) {
    subMenu?.classList.remove('hidden');
    chevron?.classList.add('rotate-180');

    document.querySelectorAll('.nav-sub-btn').forEach(sb => {
      if (sb.getAttribute('data-target') === targetId) {
        sb.classList.add('active');
      } else {
        sb.classList.remove('active');
      }
    });
  }

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
  if (targetId === 'tab-swarm') {
    refreshGallery();
    scanSwarmModels();
  }
  if (targetId === 'tab-llama-web') syncLlamaWebState();
  if (targetId === 'tab-chat') onChatTabActivated();
}
