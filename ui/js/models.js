// models.js

const btnScan = document.getElementById('btn-scan-models');
const modelsDirInput = document.getElementById('cfg-models_dir');
const modelsGrid = document.getElementById('models-grid');

btnScan?.addEventListener('click', async () => {
    if (!window.pywebview) return;
    
    const rootDir = modelsDirInput.value;
    if (!rootDir) {
        alert(translations[currentLang].err_no_dir || 'Please select a directory first.');
        return;
    }
    
    btnScan.disabled = true;
    btnScan.innerHTML = '<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> Scanning...';
    lucide.createIcons();
    
    const result = await window.pywebview.api.scan_models(rootDir);
    btnScan.disabled = false;
    btnScan.innerHTML = '<i data-lucide="refresh-cw" class="w-4 h-4"></i> Scan Directory';
    lucide.createIcons();
    
    if (result.status === 'error') {
        alert(result.message);
        return;
    }
    
    renderModelsGrid(result.models);
    if (window.showToast) window.showToast(`Found ${result.models.length} models.`);
});

async function backgroundScanModels() {
    if (!window.pywebview) return;
    const rootDir = modelsDirInput.value;
    if (rootDir) {
        const result = await window.pywebview.api.scan_models(rootDir);
        if (result.status === 'success') {
            renderModelsGrid(result.models);
        }
    }
}

document.getElementById('btn-browse-models-dir')?.addEventListener('click', async () => {
    if (!window.pywebview) return;
    const path = await window.pywebview.api.select_directory();
    if (path) {
        modelsDirInput.value = path;
        saveConfig();
        btnScan.click();
    }
});

function renderModelsGrid(models) {
    modelsGrid.innerHTML = '';
    
    if (models.length === 0) {
        modelsGrid.innerHTML = `<div class="col-span-full text-center p-8 text-textMuted">${translations[currentLang].no_models_found || 'No .gguf models found in this directory.'}</div>`;
        return;
    }
    
    const projectors = models.filter(m => m.is_mmproj);
    
    updateDashboardDropdowns(models);
    
    models.forEach(model => {
        const card = document.createElement('div');
        card.className = 'card p-5 rounded-xl border border-border flex flex-col gap-3 hover:border-brand transition-colors';
        
        const isProjector = model.is_mmproj;
        const badgeColor = isProjector ? 'bg-sec/20 text-sec border-sec/30' : 'bg-brand/20 text-brand border-brand/30';
        
        let projectorDropdown = '';
        if (!isProjector && projectors.length > 0) {
            let options = '<option value="">None (Standalone)</option>';
            projectors.forEach(p => {
                options += `<option value="${p.path}">${p.name}</option>`;
            });
            projectorDropdown = `
                <div class="mt-2 text-xs">
                    <label class="block text-textMuted mb-1 font-semibold">Attach Vision Projector:</label>
                    <select class="w-full bg-bgDark border border-border rounded px-2 py-1.5 proj-select text-textMuted outline-none focus:border-brand transition-colors">
                        ${options}
                    </select>
                </div>
            `;
        }
        
        card.innerHTML = `
            <div class="flex items-start justify-between gap-2">
                <h4 class="font-bold text-sm truncate flex-1" title="${model.name}">${model.name}</h4>
                <span class="px-2 py-0.5 rounded text-[10px] font-bold border ${badgeColor}">${model.quant}</span>
            </div>
            <div class="text-xs text-textMuted flex items-center justify-between">
                <span>${model.size_gb} GB</span>
                <span>${isProjector ? 'Vision Projector' : 'LLM'}</span>
            </div>
            ${projectorDropdown}
            <button class="btn-secondary w-full py-1.5 mt-2 text-xs flex items-center justify-center gap-2 load-btn">
                <i data-lucide="play" class="w-3.5 h-3.5"></i> ${translations[currentLang].btn_load_run || 'Load & Run'}
            </button>
        `;
        
        const loadBtn = card.querySelector('.load-btn');
        loadBtn.addEventListener('click', async () => {
            if (isProjector) {
                configMap.vision_projector.value = model.path;
            } else {
                configMap.model_path.value = model.path;
                const projSelect = card.querySelector('.proj-select');
                if (projSelect && projSelect.value !== "") {
                    configMap.vision_projector.value = projSelect.value;
                } else if (projSelect && projSelect.value === "") {
                    configMap.vision_projector.value = "";
                }
            }
            ensureOptionExists(configMap.model_path, configMap.model_path.value);
            ensureOptionExists(configMap.vision_projector, configMap.vision_projector.value);
            saveConfig();
            
            // Switch to main tab
            document.querySelector('[data-target="tab-main"]').click();
            
            // Highlight the fields to show they updated
            const el = isProjector ? configMap.vision_projector : configMap.model_path;
            el.classList.add('ring-2', 'ring-brand');
            setTimeout(() => el.classList.remove('ring-2', 'ring-brand'), 1500);
            
            if (!isProjector) {
                const isRunning = await window.pywebview.api.check_status();
                if (isRunning) {
                    if (window.showToast) window.showToast('Restarting server with new model...');
                    const btnStop = document.getElementById('btn-stop-server');
                    const btnStart = document.getElementById('btn-start-server');
                    
                    btnStop.click();
                    
                    let retries = 20;
                    while (retries > 0 && await window.pywebview.api.check_status()) {
                        await new Promise(r => setTimeout(r, 250));
                        retries--;
                    }
                    
                    btnStart.click();
                } else {
                    if (window.showToast) window.showToast('Model selected! Click Start Server.');
                }
            }
        });
        
        modelsGrid.appendChild(card);
    });
    lucide.createIcons();
}

function updateDashboardDropdowns(models) {
    const modelSelect = document.getElementById('cfg-model_path');
    const projSelect = document.getElementById('cfg-vision_projector');
    
    if (!modelSelect || !projSelect) return;
    
    const currentModel = modelSelect.value;
    const currentProj = projSelect.value;
    
    while (modelSelect.options.length > 1) modelSelect.remove(1);
    while (projSelect.options.length > 1) projSelect.remove(1);
    
    models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.path;
        opt.text = m.name;
        
        if (m.is_mmproj) {
            projSelect.appendChild(opt);
        } else {
            modelSelect.appendChild(opt);
        }
    });
    
    ensureOptionExists(modelSelect, currentModel);
    ensureOptionExists(projSelect, currentProj);
}

function ensureOptionExists(selectEl, value) {
    if (!value) {
        selectEl.value = '';
        return;
    }
    let exists = false;
    for (let i = 0; i < selectEl.options.length; i++) {
        if (selectEl.options[i].value === value) {
            exists = true;
            break;
        }
    }
    if (!exists) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.text = value.split('\\').pop().split('/').pop();
        selectEl.appendChild(opt);
    }
    selectEl.value = value;
}
