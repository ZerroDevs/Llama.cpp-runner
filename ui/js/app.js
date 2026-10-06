/**
 * Llama Server Control - Master Application Bootstrap
 * Coordinates all modular subsystems, loads partials, and starts telemetry
 */

import { api } from './api.js';
import { state } from './state.js';
import { loadPartials } from './loader.js';
import { setupTheme } from './theme.js';
import { setupNavigation, switchTab } from './navigation.js';
import { setupDashboard, applyConfigToForm, checkServerStatuses } from './dashboard.js';
import { setupModels, scanLocalModels } from './models.js';
import { setupChat } from './chat.js';
import { setupHub } from './hub.js';
import { setupTelemetry } from './hardware.js';
import { setupTuning } from './tuning.js';
import { setupPlayground } from './playground.js';
import { setupSwarm } from './swarm.js';
import { setupLogs } from './logs.js';
import { setupModals } from './modals.js';

// Application Bootstrap
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // 1. Load all modular HTML partials (tabs and modals)
    await loadPartials();

    // 2. Initialize UI Controllers
    setupNavigation();
    setupTheme();
    setupDashboard();
    setupModels();
    setupChat();
    setupHub();
    setupTelemetry();
    setupTuning();
    setupPlayground();
    setupSwarm();
    setupLogs();
    setupModals();

    // 3. Render all Lucide Icons across dynamically loaded partials
    if (window.lucide) {
      window.lucide.createIcons();
    }

    // 4. Ensure initial tab is strictly activated
    switchTab('tab-dashboard');

    // 5. Fetch Initial Backend State & Config
    await loadInitialData();
  } catch (err) {
    console.error('[App] Bootstrap error:', err);
  }
});

async function loadInitialData() {
  try {
    const cfg = await api.invoke('get_config');
    if (cfg) {
      state.config = cfg;
      applyConfigToForm(cfg);
    }

    await checkServerStatuses();

    // Auto scan models if models_dir or model_path exists
    let scanFolder = cfg.models_dir;
    if (!scanFolder && cfg.model_path) {
      const idx = Math.max(cfg.model_path.lastIndexOf('\\'), cfg.model_path.lastIndexOf('/'));
      if (idx !== -1) scanFolder = cfg.model_path.substring(0, idx);
    }
    if (scanFolder) {
      await scanLocalModels(scanFolder);
    }
  } catch (err) {
    console.error('[App] Initial data error:', err);
  }
}
