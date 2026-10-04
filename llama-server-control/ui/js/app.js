let appConfig = {};
let isRunning = false;
let localLanIp = "127.0.0.1";

const missingBanner = document.getElementById('missing-binary-banner');
const btnLocate = document.getElementById('banner-locate-btn');
const logoEl = document.getElementById('app-logo');
const themeToggle = document.getElementById('theme-toggle');
const langSelect = document.getElementById('lang-select');
const presetSelect = document.getElementById('cfg-preset');
const hostStatusLabel = document.getElementById('lbl-host-status');
const networkUrlText = document.getElementById('network-url');

const configMap = {
    'server_binary': document.getElementById('cfg-server_binary'),
    'model_path': document.getElementById('cfg-model_path'),
    'lora_adapters': document.getElementById('cfg-lora_adapters'),
    'vision_projector': document.getElementById('cfg-vision_projector'),
    'draft_model': document.getElementById('cfg-draft_model'),
    'context_size': document.getElementById('cfg-context_size'),
    'port': document.getElementById('cfg-port'),
    'flash_attention': document.getElementById('cfg-flash_attention'),
    'gpu_layers': document.getElementById('cfg-gpu_layers'),
    'cpu_threads': document.getElementById('cfg-cpu_threads'),
    'host': document.getElementById('cfg-host'),
    'kv_cache_type_k': document.getElementById('cfg-kv_cache_type_k'),
    'kv_cache_type_v': document.getElementById('cfg-kv_cache_type_v'),
    'batch_size': document.getElementById('cfg-batch_size'),
    'ubatch_size': document.getElementById('cfg-ubatch_size'),
    'api_key': document.getElementById('cfg-api_key'),
    'custom_args': document.getElementById('cfg-custom_args'),
    'models_dir': document.getElementById('cfg-models_dir'),
    'minimize_to_tray': document.getElementById('cfg-minimize_to_tray'),
    'run_on_startup': document.getElementById('cfg-run_on_startup'),
    'swarm_launcher_path': document.getElementById('cfg-swarm_launcher_path'),
    'swarm_port': document.getElementById('cfg-swarm_port'),
    'swarm_host': document.getElementById('cfg-swarm_host'),
    'swarm_extra_args': document.getElementById('cfg-swarm_extra_args')
};

const sliderGpu = document.getElementById('cfg-gpu_layers-slider');

sliderGpu.addEventListener('input', (e) => { configMap.gpu_layers.value = e.target.value; saveConfig(); presetSelect.value="custom"; });
configMap.gpu_layers.addEventListener('input', (e) => { sliderGpu.value = e.target.value; saveConfig(); presetSelect.value="custom"; });

window.addEventListener('pywebviewready', async () => {
    appConfig = await window.pywebview.api.get_config();
    localLanIp = await window.pywebview.api.get_lan_ip();
    loadConfigToUI();
    applyTheme(appConfig.theme || 'dark');
    langSelect.value = appConfig.language || 'en';
    applyTranslations(appConfig.language || 'en');
    checkBinaryPresence();
    updateNetworkInfo();
    
    setInterval(pollStatus, 1000);
    setInterval(pollSwarmStatus, 1000);
});

function loadConfigToUI() {
    for (const [key, el] of Object.entries(configMap)) {
        if (!el) continue;
        if (el.type === 'checkbox') {
            el.checked = appConfig[key];
        } else {
            let val = appConfig[key] ?? '';
            if (key === 'swarm_port' && (val === 0 || val === '')) val = 7801;
            if (key === 'swarm_host' && val === '') val = '127.0.0.1';
            el.value = val;
        }
    }
    sliderGpu.value = appConfig.gpu_layers ?? 99;
}

async function saveConfig() {
    for (const [key, el] of Object.entries(configMap)) {
        if (!el) continue;
        if (el.type === 'checkbox') {
            appConfig[key] = el.checked;
        } else if (el.type === 'number' || el.tagName === 'SELECT') {
            appConfig[key] = el.type === 'number' ? Number(el.value) : el.value;
        } else {
            appConfig[key] = el.value;
        }
    }
    appConfig.theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    appConfig.language = langSelect.value;
    
    if (window.pywebview && window.pywebview.api) {
        await window.pywebview.api.save_config(appConfig);
    }
    checkBinaryPresence();
    updateNetworkInfo();
}

// Update integration codes
function updateNetworkInfo() {
    const isNetwork = configMap.host.value === '0.0.0.0';
    hostStatusLabel.innerText = configMap.host.value;
    const url = `http://${isNetwork ? localLanIp : '127.0.0.1'}:${configMap.port.value}/v1`;
    networkUrlText.innerText = url;
    
    const curlCode = document.getElementById('code-curl');
    if (curlCode) {
        curlCode.innerText = `curl ${url}/chat/completions \\\n-H "Content-Type: application/json" \\\n${configMap.api_key.value ? `-H "Authorization: Bearer ${configMap.api_key.value}" \\\n` : ''}-d '{\n  "model": "local-model",\n  "messages": [{"role": "user", "content": "Hello!"}]\n}'`;
    }
    const pyCode = document.getElementById('code-python');
    if (pyCode) {
        pyCode.innerText = `from openai import OpenAI\nclient = OpenAI(base_url="${url}", api_key="${configMap.api_key.value || 'sk-no-key'}")\nres = client.chat.completions.create(\n    model="local-model",\n    messages=[{"role": "user", "content": "Hello!"}]\n)\nprint(res.choices[0].message.content)`;
    }
}

document.getElementById('btn-copy-network').addEventListener('click', () => {
    navigator.clipboard.writeText(networkUrlText.innerText).then(() => showToast('Copied URL!'));
});

const btnUpdateServer = document.getElementById('btn-update-server');
if (btnUpdateServer) {
    btnUpdateServer.addEventListener('click', async () => {
        const originalHtml = btnUpdateServer.innerHTML;
        btnUpdateServer.innerHTML = '<i data-lucide="loader" class="w-3 h-3 animate-spin"></i> Updating...';
        btnUpdateServer.disabled = true;
        if (window.lucide) window.lucide.createIcons();
        
        try {
            const res = await window.pywebview.api.update_llama_server();
            if (res.status === 'success') {
                window.showToast(res.message);
                const config = await window.pywebview.api.get_config();
                if (config.server_binary) {
                    configMap.server_binary.value = config.server_binary;
                }
            } else {
                window.showToast(res.message);
            }
        } catch (e) {
            window.showToast("Failed to update server.");
        }
        
        btnUpdateServer.innerHTML = originalHtml;
        btnUpdateServer.disabled = false;
        if (window.lucide) window.lucide.createIcons();
    });
}

// Presets Logic
presetSelect.addEventListener('change', () => {
    const p = presetSelect.value;
    if (p === 'fast') {
        configMap.context_size.value = "4096";
        configMap.gpu_layers.value = 99;
        sliderGpu.value = 99;
        configMap.flash_attention.checked = true;
        configMap.kv_cache_type_k.value = "f16";
        configMap.kv_cache_type_v.value = "f16";
    } else if (p === 'deep') {
        configMap.context_size.value = "16384";
        configMap.gpu_layers.value = 99;
        sliderGpu.value = 99;
        configMap.flash_attention.checked = true;
        configMap.kv_cache_type_k.value = "q8_0";
        configMap.kv_cache_type_v.value = "q8_0";
    }
    saveConfig();
});

document.getElementById('btn-auto-vram').addEventListener('click', async () => {
    const btn = document.getElementById('btn-auto-vram');
    const text = document.getElementById('vram-prediction-text');
    
    const model = document.getElementById('cfg-model_path').value;
    const ctx = document.getElementById('cfg-context_size').value;
    const b = document.getElementById('cfg-batch_size').value;
    const kv_k = document.getElementById('cfg-kv_cache_type_k').value;
    const kv_v = document.getElementById('cfg-kv_cache_type_v').value;

    if (!model) {
        showToast("Please select a model first.");
        return;
    }
    
    const originalBtnHTML = btn.innerHTML;
    btn.innerHTML = '<i data-lucide="loader" class="w-3 h-3 animate-spin"></i> Calculating...';
    btn.disabled = true;
    if (window.lucide) window.lucide.createIcons();
    
    try {
        const res = await window.pywebview.api.calculate_vram(model, ctx, b, kv_k, kv_v);
        if (res.status === 'success') {
            document.getElementById('cfg-gpu_layers-slider').max = res.block_count + 1;
            document.getElementById('cfg-gpu_layers-slider').value = res.optimal_layers;
            document.getElementById('cfg-gpu_layers').value = res.optimal_layers;
            document.getElementById('cfg-gpu_layers-slider').dispatchEvent(new Event('input'));
            
            text.classList.remove('hidden');
            if (res.optimal_layers >= res.block_count) {
                text.innerHTML = `<span class="text-brand">Fully Offloaded:</span> Requires ~${res.total_vram_gb}GB VRAM (You have ${res.available_vram_gb}GB available).`;
            } else {
                text.innerHTML = `<span class="text-amber-500">Partially Offloaded:</span> Requires ~${res.total_vram_gb}GB VRAM (You only have ${res.available_vram_gb}GB available). Set to max safe limit (${res.optimal_layers}/${res.block_count}).`;
            }
            saveConfig();
            showToast("GPU Layers auto-set!");
        } else {
            showToast(res.message);
        }
    } catch (e) {
        showToast("Error calculating VRAM.");
    }
    
    btn.innerHTML = originalBtnHTML;
    btn.disabled = false;
    if (window.lucide) window.lucide.createIcons();
});

for (const el of Object.values(configMap)) {
    if(!el) continue;
    el.addEventListener('change', (e) => {
        if(e.target.id.includes('context') || e.target.id.includes('gpu') || e.target.id.includes('flash') || e.target.id.includes('cache')) {
            presetSelect.value = "custom";
        }
        saveConfig();
        if(e.target.id === 'cfg-minimize_to_tray') {
            showToast(`Minimize to Tray: ${e.target.checked ? 'Enabled' : 'Disabled'}`);
        } else if (e.target.id === 'cfg-run_on_startup') {
            showToast(`Run on Startup: ${e.target.checked ? 'Enabled' : 'Disabled'}`);
        }
    });
    if (el.type === 'text' || el.type === 'number' || el.type === 'password') {
        el.addEventListener('keyup', () => {
            clearTimeout(el.saveTimeout);
            el.saveTimeout = setTimeout(saveConfig, 500);
        });
    }
}

function checkBinaryPresence() {
    if (!appConfig.server_binary || appConfig.server_binary.trim() === '') {
        missingBanner.classList.remove('hidden');
    } else {
        missingBanner.classList.add('hidden');
    }
}

document.getElementById('btn-browse-binary').addEventListener('click', async () => {
    if (!window.pywebview) return;
    const path = await window.pywebview.api.select_binary();
    if (path) {
        configMap.server_binary.value = path;
        saveConfig();
    }
});
btnLocate.addEventListener('click', () => document.getElementById('btn-browse-binary').click());

document.getElementById('btn-browse-model').addEventListener('click', async () => {
    if (!window.pywebview) return;
    const path = await window.pywebview.api.select_model();
    if (path) {
        configMap.model_path.value = path;
        saveConfig();
    }
});

document.getElementById('btn-browse-lora').addEventListener('click', async () => {
    if (!window.pywebview) return;
    const path = await window.pywebview.api.select_model(); // reuse select_model for gguf
    if (path) {
        if (configMap.lora_adapters.value) {
            configMap.lora_adapters.value += ", " + path;
        } else {
            configMap.lora_adapters.value = path;
        }
        saveConfig();
    }
});

document.getElementById('btn-browse-vision').addEventListener('click', async () => {
    if (!window.pywebview) return;
    const path = await window.pywebview.api.select_mmproj();
    if (path) {
        configMap.vision_projector.value = path;
        saveConfig();
    }
});

document.getElementById('btn-browse-draft').addEventListener('click', async () => {
    if (!window.pywebview) return;
    const path = await window.pywebview.api.select_model();
    if (path) {
        configMap.draft_model.value = path;
        saveConfig();
    }
});

document.getElementById('btn-browse-swarm-launcher').addEventListener('click', async () => {
    if (!window.pywebview) return;
    const path = await window.pywebview.api.select_swarm_launcher();
    if (path) {
        configMap.swarm_launcher_path.value = path;
        saveConfig();
    }
});

function applyTheme(theme) {
    if (theme === 'dark') {
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('light');
        logoEl.src = 'images/Logo-nobg.png';
    } else {
        document.documentElement.classList.remove('dark');
        document.documentElement.classList.add('light');
        logoEl.src = 'images/Logozxr.png';
    }
    logoEl.style.display = 'block';
    document.getElementById('logo-fallback').classList.add('hidden');
}

themeToggle.addEventListener('click', () => {
    const newTheme = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
    applyTheme(newTheme);
    saveConfig();
});

langSelect.addEventListener('change', (e) => {
    applyTranslations(e.target.value);
    saveConfig();
});

document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.add('hidden'));
        const targetId = btn.getAttribute('data-target');
        document.getElementById(targetId).classList.remove('hidden');
        
        if (targetId === 'tab-models') {
            const scanBtn = document.getElementById('btn-scan-models');
            if (scanBtn) scanBtn.click();
        }
    });
});

const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const btnWebchat = document.getElementById('btn-webchat');

window.onServerReady = function() {
    btnWebchat.disabled = false;
    showToast('Server is ready! Model loaded.');
};

async function pollStatus() {
    if (!window.pywebview) return;
    const status = await window.pywebview.api.check_status();
    updateStatusUI(status);
}

function updateStatusUI(running) {
    if (isRunning && !running) {
        // Just stopped
        btnWebchat.disabled = true;
    }
    isRunning = running;
    if (isRunning) {
        btnStart.classList.add('hidden');
        btnStop.classList.remove('hidden');
        btnStop.classList.add('flex');
        
        statusDot.classList.remove('bg-red-500');
        statusDot.classList.add('pulsating-dot');
        statusText.innerHTML = translations[currentLang].status_running;
    } else {
        btnStop.classList.add('hidden');
        btnStop.classList.remove('flex');
        btnStart.classList.remove('hidden');
        
        statusDot.classList.remove('pulsating-dot');
        statusDot.classList.add('bg-red-500');
        statusText.innerHTML = translations[currentLang].status_stopped;
        btnWebchat.disabled = true;
    }
}

btnStart.addEventListener('click', async () => {
    if (!window.pywebview) return;
    await saveConfig();
    const res = await window.pywebview.api.start_server(appConfig);
    if (res.status === 'error') {
        alert(res.message);
    } else {
        updateStatusUI(true);
        btnWebchat.disabled = true; // Wait for onServerReady
        document.querySelector('[data-target="tab-logs"]').click();
        document.getElementById('log-container').innerHTML = ''; // clear logs on start
    }
});

btnStop.addEventListener('click', async () => {
    if (!window.pywebview) return;
    const res = await window.pywebview.api.stop_server();
    if (res.status === 'error') {
        alert(res.message);
    } else {
        updateStatusUI(false);
    }
});

btnWebchat.addEventListener('click', () => {
    if (!window.pywebview) return;
    const host = configMap.host.value === '0.0.0.0' ? '127.0.0.1' : configMap.host.value;
    const url = `http://${host}:${configMap.port.value}`;
    window.pywebview.api.open_web_chat(url);
});

document.getElementById('btn-copyurl').addEventListener('click', () => {
    const host = configMap.host.value === '0.0.0.0' ? '127.0.0.1' : configMap.host.value;
    const url = `http://${host}:${configMap.port.value}/v1`;
    navigator.clipboard.writeText(url).then(() => showToast(translations[currentLang].toast_copied));
});

window.showToast = function(msg) {
    const toast = document.getElementById('toast');
    document.getElementById('toast-msg').innerText = msg;
    toast.classList.remove('opacity-0', 'translate-y-2');
    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-2');
    }, 3000);
}

// SwarmUI Logic
let isSwarmRunning = false;
async function pollSwarmStatus() {
    if (!window.pywebview || !window.pywebview.api) return;
    const running = await window.pywebview.api.get_swarm_status();
    updateSwarmStatusUI(running);
}

function updateSwarmStatusUI(running) {
    const btnStart = document.getElementById('btn-start-swarm');
    const btnStop = document.getElementById('btn-stop-swarm');
    const statusDot = document.getElementById('swarm-status-dot');
    const statusText = document.getElementById('swarm-status-text');
    
    isSwarmRunning = running;
    if (isSwarmRunning) {
        btnStart.classList.add('hidden');
        btnStop.classList.remove('hidden');
        btnStop.classList.add('flex');
        
        statusDot.classList.remove('bg-red-500');
        statusDot.classList.add('pulsating-dot');
        statusText.innerHTML = translations[currentLang]?.status_running || "Running";
    } else {
        btnStop.classList.add('hidden');
        btnStop.classList.remove('flex');
        btnStart.classList.remove('hidden');
        
        statusDot.classList.remove('pulsating-dot');
        statusDot.classList.add('bg-red-500');
        statusText.innerHTML = translations[currentLang]?.status_stopped || "Stopped";
    }
}

document.getElementById('btn-start-swarm').addEventListener('click', async () => {
    if (!window.pywebview) return;
    await saveConfig();
    const res = await window.pywebview.api.start_swarm(appConfig);
    if (res.status === 'error') {
        alert(res.message);
    } else {
        updateSwarmStatusUI(true);
        document.querySelector('[data-target="tab-logs"]').click();
    }
});

document.getElementById('btn-stop-swarm').addEventListener('click', async () => {
    if (!window.pywebview) return;
    const res = await window.pywebview.api.stop_swarm();
    if (res.status === 'error') {
        alert(res.message);
    } else {
        updateSwarmStatusUI(false);
    }
});

document.getElementById('btn-open-swarm-web').addEventListener('click', () => {
    if (!window.pywebview) return;
    window.pywebview.api.open_swarm_ui();
});
