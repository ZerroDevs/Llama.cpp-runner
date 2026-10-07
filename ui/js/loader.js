/**
 * Llama Server Control - HTML Partials Dynamic Loader
 * Loads modular tabs and modals asynchronously into the shell
 */

export async function loadPartials() {
  const tabs = [
    'dashboard',
    'chat',
    'llama-web',
    'models',
    'hub',
    'hardware',
    'tuning',
    'api',
    'swarm',
    'logs',
    'settings'
  ];

  const modals = [
    'image-inspector',
    'cmd-palette',
    'quick-model',
    'session-stats',
    'snippets',
    'file-preview'
  ];

  const main = document.getElementById('main-content');
  const modalsRoot = document.getElementById('modals-container');

  try {
    const tabHtmls = await Promise.all(
      tabs.map(name =>
        fetch(`tabs/${name}.html`)
          .then(res => {
            if (!res.ok) throw new Error(`Failed to load tabs/${name}.html: ${res.statusText}`);
            return res.text();
          })
      )
    );

    if (main) {
      main.innerHTML = tabHtmls.join('\n');
    }

    const modalHtmls = await Promise.all(
      modals.map(name =>
        fetch(`modals/${name}.html`)
          .then(res => {
            if (!res.ok) throw new Error(`Failed to load modals/${name}.html: ${res.statusText}`);
            return res.text();
          })
      )
    );

    if (modalsRoot) {
      modalsRoot.innerHTML = modalHtmls.join('\n');
    }
  } catch (err) {
    console.error('[Loader] Error loading HTML partials:', err);
  }
}
