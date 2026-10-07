/**
 * Llama Server Control - Native C# IPC Bridge Client
 * Supports dual-mode transport:
 * 1. WebView2 Native IPC (zero-latency desktop window)
 * 2. Real-time WebSocket + HTTP RPC Bridge (web browser on localhost or network)
 */

class NativeApiClient {
  constructor() {
    this._reqId = 0;
    this._pending = new Map();
    this._eventListeners = new Map();
    this._isWebView2 = Boolean(window.chrome && window.chrome.webview);
    this._ws = null;
    this._wsConnected = false;
    this._reconnectTimer = null;

    if (this._isWebView2) {
      window.chrome.webview.addEventListener('message', (event) => {
        const data = event.data;
        if (!data) return;
        this._dispatchIncoming(data);
      });
    } else {
      // Running inside standard web browser (localhost or LAN host)
      this._initWebSocket();
    }
  }

  _initWebSocket() {
    if (this._isWebView2) return;
    try {
      const isHttps = window.location.protocol === 'https:';
      const wsProtocol = isHttps ? 'wss:' : 'ws:';
      const host = window.location.host;
      if (!host) return;

      const wsUrl = `${wsProtocol}//${host}/api/ws`;
      this._ws = new WebSocket(wsUrl);

      this._ws.onopen = () => {
        this._wsConnected = true;
        if (this._reconnectTimer) {
          clearTimeout(this._reconnectTimer);
          this._reconnectTimer = null;
        }
      };

      this._ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data) this._dispatchIncoming(data);
        } catch (e) {
          console.error('[NativeAPI] WebSocket parse error:', e);
        }
      };

      this._ws.onclose = () => {
        this._wsConnected = false;
        this._scheduleReconnect();
      };

      this._ws.onerror = () => {
        this._wsConnected = false;
      };
    } catch (e) {
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    if (this._reconnectTimer || this._isWebView2) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._initWebSocket();
    }, 2500);
  }

  _dispatchIncoming(data) {
    // 1. Check if event broadcast (log, telemetry, notifications, etc.)
    if (data.event) {
      const listeners = this._eventListeners.get(data.event) || [];
      for (const cb of listeners) {
        try { cb(data.data); } catch (e) { console.error(e); }
      }
      return;
    }

    // 2. Check if response to RPC request
    if (data.id && this._pending.has(data.id)) {
      const { resolve, reject, timeoutId } = this._pending.get(data.id);
      if (timeoutId) clearTimeout(timeoutId);
      this._pending.delete(data.id);
      if (data.error) {
        reject(new Error(data.error));
      } else {
        resolve(data.result);
      }
    }
  }

  on(eventName, callback) {
    if (!this._eventListeners.has(eventName)) {
      this._eventListeners.set(eventName, []);
    }
    this._eventListeners.get(eventName).push(callback);
  }

  async invoke(method, args = null) {
    const id = 'req_' + (++this._reqId) + '_' + Date.now();

    // Transport 1: WebView2 Native Messaging
    if (this._isWebView2) {
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          if (this._pending.has(id)) {
            this._pending.delete(id);
            reject(new Error(`RPC timeout for method: ${method}`));
          }
        }, 30000);

        this._pending.set(id, { resolve, reject, timeoutId });
        window.chrome.webview.postMessage({ id, method, args });
      });
    }

    // Transport 2: WebSocket RPC (Fastest bidirectional when connected)
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          if (this._pending.has(id)) {
            this._pending.delete(id);
            reject(new Error(`RPC timeout for method: ${method}`));
          }
        }, 30000);

        this._pending.set(id, { resolve, reject, timeoutId });
        this._ws.send(JSON.stringify({ id, method, args }));
      });
    }

    // Transport 3: HTTP POST /api/rpc (Immediate cold-start & reconnect fallback)
    try {
      const res = await fetch('/api/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, method, args })
      });

      if (!res.ok) {
        throw new Error(`RPC HTTP ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();
      if (data.error) {
        throw new Error(data.error);
      }
      return data.result;
    } catch (err) {
      // Transport 4: Mock fallback if testing offline / static file without backend
      if (window.location.protocol === 'file:') {
        return this._mockFallback(method, args);
      }
      throw err;
    }
  }

  _mockFallback(method, args) {
    switch (method) {
      case 'get_config':
        return {
          model_path: '',
          server_path: '',
          models_dir: '',
          context_size: 4096,
          threads: 8,
          gpu_layers: 99,
          batch_size: 512,
          ubatch_size: 512,
          port: 8080,
          web_port: 9095,
          host: '0.0.0.0',
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
          vram_used: 0,
          vram_total: 16.0,
          vram_percent: 0,
          ram_used: 8.0,
          ram_total: 32.0,
          ram_percent: 25,
          cpu_percent: 5,
          gpu_name: 'GPU',
          gpu_temp: 45
        };
      case 'scan_models':
        return [];
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
