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
    
    models.forEach(model => {
        const card = document.createElement('div');
        card.className = 'card p-5 rounded-xl border border-border flex flex-col gap-3 hover:border-brand transition-colors';
        
        const isProjector = model.is_mmproj;
        const badgeColor = isProjector ? 'bg-sec/20 text-sec border-sec/30' : 'bg-brand/20 text-brand border-brand/30';
        
        card.innerHTML = `
            <div class="flex items-start justify-between gap-2">
                <h4 class="font-bold text-sm truncate flex-1" title="${model.name}">${model.name}</h4>
                <span class="px-2 py-0.5 rounded text-[10px] font-bold border ${badgeColor}">${model.quant}</span>
            </div>
            <div class="text-xs text-textMuted flex items-center justify-between">
                <span>${model.size_gb} GB</span>
                <span>${isProjector ? 'Vision Projector' : 'LLM'}</span>
            </div>
            <button class="btn-secondary w-full py-1.5 mt-2 text-xs flex items-center justify-center gap-2 load-btn">
                <i data-lucide="play" class="w-3.5 h-3.5"></i> ${translations[currentLang].btn_load_run || 'Load & Run'}
            </button>
        `;
        
        const loadBtn = card.querySelector('.load-btn');
        loadBtn.addEventListener('click', () => {
            if (isProjector) {
                configMap.vision_projector.value = model.path;
            } else {
                configMap.model_path.value = model.path;
            }
            saveConfig();
            
            // Switch to main tab
            document.querySelector('[data-target="tab-main"]').click();
            
            // Highlight the fields to show they updated
            const el = isProjector ? configMap.vision_projector : configMap.model_path;
            el.classList.add('ring-2', 'ring-brand');
            setTimeout(() => el.classList.remove('ring-2', 'ring-brand'), 1500);
            
            if (!isProjector) {
                // Flash toast
                if (window.showToast) window.showToast('Model selected! Click Start Server.');
            }
        });
        
        modelsGrid.appendChild(card);
    });
    lucide.createIcons();
}
