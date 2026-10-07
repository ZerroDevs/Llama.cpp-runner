/**
 * Llama Server Control - Llama Default Browser Chat Controller
 * Manages embedded iframe, URL synchronization, and server offline overlays.
 */

import { api } from './api.js';
import { state } from './state.js';
import { showToast } from './toast.js';
import { switchTab } from './navigation.js';
import { startServer } from './dashboard.js';

export function setupLlamaWeb() {
  const btnReload = document.getElementById('btn-reload-llama-web');
  const btnCopyUrl = document.getElementById('btn-copy-llama-web-url');
  const btnOpenExt = document.getElementById('btn-open-llama-web-ext');
  const btnSwitchStudio = document.getElementById('btn-switch-to-studio');
  const btnStartServer = document.getElementById('btn-web-start-server');

  // Reload iframe
  btnReload?.addEventListener('click', () => {
    const iframe = document.getElementById('iframe-llama-web');
    if (iframe) {
      const port = state.config.port || 8080;
      iframe.src = `http://127.0.0.1:${port}/`;
      showToast('Reloading', 'Refreshing Llama Web UI...', 'info', 1500);
    }
  });

  // Copy Web URL
  btnCopyUrl?.addEventListener('click', () => {
    const port = state.config.port || 8080;
    const url = `http://127.0.0.1:${port}/`;
    navigator.clipboard.writeText(url).then(() => {
      showToast('Copied URL', url, 'success', 1500);
    }).catch(() => {
      showToast('Copy Failed', 'Clipboard access denied.', 'error');
    });
  });

  // Open in External Browser
  btnOpenExt?.addEventListener('click', async () => {
    const port = state.config.port || 8080;
    const url = `http://127.0.0.1:${port}/`;
    await api.invoke('open_url', url);
  });

  // Switch back to Studio Chat
  btnSwitchStudio?.addEventListener('click', () => {
    switchTab('tab-chat');
  });

  // Start server button from offline overlay
  btnStartServer?.addEventListener('click', async () => {
    await startServer();
    setTimeout(() => {
      syncLlamaWebState();
    }, 1000);
  });
}

export function syncLlamaWebState() {
  const port = state.config.port || 8080;
  const url = `http://127.0.0.1:${port}/`;
  const iframe = document.getElementById('iframe-llama-web');
  const overlay = document.getElementById('llama-web-offline-overlay');
  const urlText = document.getElementById('llama-web-url-text');
  const portHint = document.getElementById('llama-web-port-hint');

  if (urlText) urlText.textContent = url;
  if (portHint) portHint.textContent = port;

  if (!state.serverRunning) {
    if (overlay) overlay.classList.remove('hidden');
    if (iframe) iframe.src = 'about:blank';
  } else {
    if (overlay) overlay.classList.add('hidden');
    if (iframe && (iframe.src === 'about:blank' || !iframe.src.includes(`:${port}`))) {
      iframe.src = url;
    }
  }

  const tabWeb = document.getElementById('tab-llama-web');
  if (tabWeb && window.lucide) {
    window.lucide.createIcons({ root: tabWeb });
  }
}
