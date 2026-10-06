/**
 * Llama Server Control - Native C# IPC Bridge Client
 */

class NativeApiClient {
  constructor() {
    this._reqId = 0;
    this._pending = new Map();
    this._eventListeners = new Map();

    if (window.chrome && window.chrome.webview) {
      window.chrome.webview.addEventListener('message', (event) => {
        const data = event.data;
        if (!data) return;

        // Check if event broadcast (log, telemetry, etc.)
        if (data.event) {
          const listeners = this._eventListeners.get(data.event) || [];
          for (const cb of listeners) {
            try { cb(data.data); } catch (e) { console.error(e); }
          }
          return;
        }

        // Check if response to RPC request
        if (data.id && this._pending.has(data.id)) {
          const { resolve, reject } = this._pending.get(data.id);
          this._pending.delete(data.id);
          if (data.error) {
            reject(new Error(data.error));
          } else {
            resolve(data.result);
          }
        }
      });
    }
  }

  on(eventName, callback) {
    if (!this._eventListeners.has(eventName)) {
      this._eventListeners.set(eventName, []);
    }
    this._eventListeners.get(eventName).push(callback);
  }

  async invoke(method, args = null) {
    if (window.chrome && window.chrome.webview) {
      const id = 'req_' + (++this._reqId) + '_' + Date.now();
      return new Promise((resolve, reject) => {
        this._pending.set(id, { resolve, reject });
        window.chrome.webview.postMessage({ id, method, args });

        // Safety timeout
        setTimeout(() => {
          if (this._pending.has(id)) {
            this._pending.delete(id);
            reject(new Error(`RPC timeout for method: ${method}`));
          }
        }, 30000);
      });
    }

    // Mock fallback when testing in standard web browser
    console.warn(`[Mock] Native API invoked: ${method}`, args);
    return this._mockFallback(method, args);
  }

  _mockFallback(method, args) {
    switch (method) {
      case 'get_config':
        return {
          model_path: 'C:\\Models\\Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf',
          server_path: 'C:\\llama.cpp\\llama-server.exe',
          models_dir: 'C:\\Models',
          context_size: 4096,
          threads: 8,
          gpu_layers: 99,
          batch_size: 512,
          ubatch_size: 512,
          port: 8080,
          host: '127.0.0.1',
          flash_attention: true,
          cache_type_k: 'f16',
          cache_type_v: 'f16',
          mmproj_path: '',
          custom_args: '',
          swarm_launcher_path: '',
          swarm_host: '127.0.0.1',
          swarm_port: 7801,
          discord_webhook: '',
          minimize_to_tray: false,
          run_on_startup: false,
          language: 'en'
        };
      case 'check_status':
        return false;
      case 'get_hardware_data':
        return {
          vram_used: 4.8,
          vram_total: 12.0,
          vram_percent: 40,
          ram_used: 12.2,
          ram_total: 32.0,
          ram_percent: 38,
          cpu_percent: 12,
          gpu_name: 'NVIDIA RTX 4070',
          gpu_temp: 50
        };
      case 'scan_models':
        return [
          { name: 'Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf', path: 'C:\\Models\\Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf', size_gb: 4.68, modified: '2026-10-01 14:20' },
          { name: 'Llama-3.3-70B-Instruct-Q4_K_M.gguf', path: 'C:\\Models\\Llama-3.3-70B-Instruct-Q4_K_M.gguf', size_gb: 42.10, modified: '2026-10-02 09:15' },
          { name: 'Mistral-Nemo-Instruct-2407-Q8_0.gguf', path: 'C:\\Models\\Mistral-Nemo-Instruct-2407-Q8_0.gguf', size_gb: 13.20, modified: '2026-10-03 18:40' }
        ];
      case 'get_swarm_images':
        return [];
      case 'get_download_progress':
        return { active: false };
      default:
        return { status: 'success' };
    }
  }
}

export const api = new NativeApiClient();
