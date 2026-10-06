/**
 * Llama Server Control - API Playground Controller
 */

import { state } from './state.js';

export function setupPlayground() {
  document.getElementById('btn-api-send')?.addEventListener('click', async () => {
    const bodyStr = document.getElementById('api-request-body')?.value;
    const outputEl = document.getElementById('api-response-output');
    const latencyEl = document.getElementById('api-latency');

    if (!outputEl) return;
    outputEl.textContent = 'Sending request to local server...';

    const t0 = performance.now();
    try {
      const port = state.config.port || 8080;
      const parsedBody = JSON.parse(bodyStr);
      const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsedBody)
      });

      const elapsed = Math.round(performance.now() - t0);
      if (latencyEl) latencyEl.textContent = `${elapsed} ms`;

      const json = await res.json();
      outputEl.textContent = JSON.stringify(json, null, 2);
    } catch (err) {
      const elapsed = Math.round(performance.now() - t0);
      if (latencyEl) latencyEl.textContent = `${elapsed} ms`;
      outputEl.textContent = `Error: ${err.message}\nMake sure llama-server is running on port ${state.config.port || 8080}.`;
    }
  });
}
