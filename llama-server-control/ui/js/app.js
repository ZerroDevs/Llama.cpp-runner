let appConfig = {};
let isRunning = false;

const missingBanner = document.getElementById('missing-binary-banner');
const btnLocate = document.getElementById('banner-locate-btn');
const logoEl = document.getElementById('app-logo');
const themeToggle = document.getElementById('theme-toggle');
const langSelect = document.getElementById('lang-select');

const configMap = {
    'server_binary': document.getElementById('cfg-server_binary'),
    'model_path': document.getElementById('cfg-model_path'),
    'vision_projector': document.getElementById('cfg-vision_projector'),
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
    'custom_args': document.getElementById('cfg-custom_args')
};

const sliderGpu = document.getElementById('cfg-gpu_layers-slider');

sliderGpu.addEventListener('input', (e) => { configMap.gpu_layers.value = e.target.value; saveConfig(); });
configMap.gpu_layers.addEventListener('input', (e) => { sliderGpu.value = e.target.value; saveConfig(); });

window.addEventListener('pywebviewready', async () => {
    appConfig = await window.pywebview.api.get_config();
    loadConfigToUI();
    applyTheme(appConfig.theme || 'dark');
    langSelect.value = appConfig.language || 'en';
    applyTranslations(appConfig.language || 'en');
    checkBinaryPresence();
    
    setInterval(pollStatus, 1000);
});

function loadConfigToUI() {
    for (const [key, el] of Object.entries(configMap)) {
        if (el.type === 'checkbox') {
            el.checked = appConfig[key];
        } else {
            el.value = appConfig[key] ?? '';
        }
    }
    sliderGpu.value = appConfig.gpu_layers ?? 99;
}

async function saveConfig() {
    for (const [key, el] of Object.entries(configMap)) {
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
}

for (const el of Object.values(configMap)) {
    el.addEventListener('change', saveConfig);
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

document.getElementById('btn-browse-vision').addEventListener('click', async () => {
    if (!window.pywebview) return;
    const path = await window.pywebview.api.select_mmproj();
    if (path) {
        configMap.vision_projector.value = path;
        saveConfig();
    }
});

function applyTheme(theme) {
    if (theme === 'dark') {
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('light');
        logoEl.src = 'images/Logo.nobg.png';
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
        document.getElementById(btn.getAttribute('data-target')).classList.remove('hidden');
    });
});

const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');

async function pollStatus() {
    if (!window.pywebview) return;
    const status = await window.pywebview.api.check_status();
    updateStatusUI(status);
}

function updateStatusUI(running) {
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
        document.querySelector('[data-target="tab-logs"]').click();
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

document.getElementById('btn-webchat').addEventListener('click', () => {
    if (!window.pywebview) return;
    const url = `http://${configMap.host.value}:${configMap.port.value}`;
    window.pywebview.api.open_web_chat(url);
});

document.getElementById('btn-copyurl').addEventListener('click', () => {
    const url = `http://${configMap.host.value === '0.0.0.0' ? '127.0.0.1' : configMap.host.value}:${configMap.port.value}/v1`;
    navigator.clipboard.writeText(url).then(() => showToast(translations[currentLang].toast_copied));
});

window.showToast = function(msg) {
    const toast = document.getElementById('toast');
    document.getElementById('toast-msg').innerText = msg;
    toast.classList.remove('opacity-0');
    setTimeout(() => {
        toast.classList.add('opacity-0');
    }, 3000);
}
