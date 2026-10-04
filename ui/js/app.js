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
    'swarm_extra_args': document.getElementById('cfg-swarm_extra_args'),
    'swarm_steps': document.getElementById('cfg-swarm_steps'),
    'swarm_cfg': document.getElementById('cfg-swarm_cfg'),
    'swarm_width': document.getElementById('cfg-swarm_width'),
    'swarm_height': document.getElementById('cfg-swarm_height'),
    'auto_sleep': document.getElementById('cfg-auto_sleep'),
    'swarm_model': document.getElementById('cfg-swarm_model'),
    'discord_webhook': document.getElementById('cfg-discord_webhook')
};

const valSwarmSteps = document.getElementById('val-swarm_steps');
configMap.swarm_steps.addEventListener('input', (e) => {
    valSwarmSteps.textContent = e.target.value;
    saveConfig();
});

const valSwarmCfg = document.getElementById('val-swarm_cfg');
configMap.swarm_cfg.addEventListener('input', (e) => {
    valSwarmCfg.textContent = parseFloat(e.target.value).toFixed(1);
    saveConfig();
});

const valSwarmWidth = document.getElementById('val-swarm_width');
configMap.swarm_width.addEventListener('input', (e) => {
    valSwarmWidth.textContent = e.target.value;
    saveConfig();
});

const valSwarmHeight = document.getElementById('val-swarm_height');
configMap.swarm_height.addEventListener('input', (e) => {
    valSwarmHeight.textContent = e.target.value;
    saveConfig();
});

configMap.auto_sleep.addEventListener('change', (e) => {
    saveConfig();
    if (window.showToast) {
        window.showToast(`Auto-Sleep LLM: ${e.target.checked ? 'Enabled' : 'Disabled'}`);
    }
});
configMap.swarm_model.addEventListener('change', saveConfig);

async function refreshSwarmModels() {
    const btn = document.getElementById('btn-refresh-swarm-models');
    if (btn) btn.classList.add('opacity-50', 'pointer-events-none');
    
    configMap.swarm_model.innerHTML = '<option value="">Loading models...</option>';
    const models = await window.pywebview.api.get_swarm_models();
    
    configMap.swarm_model.innerHTML = '';
    if (!models || models.length === 0) {
        configMap.swarm_model.innerHTML = '<option value="">No models found (Check SwarmUI)</option>';
    } else {
        models.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent = m;
            configMap.swarm_model.appendChild(opt);
        });
        
        if (appConfig.swarm_model && models.includes(appConfig.swarm_model)) {
            configMap.swarm_model.value = appConfig.swarm_model;
        } else {
            configMap.swarm_model.value = models[0];
            saveConfig();
        }
    }
    if (btn) btn.classList.remove('opacity-50', 'pointer-events-none');
}

document.getElementById('btn-refresh-swarm-models')?.addEventListener('click', refreshSwarmModels);

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
    refreshSwarmModels();
    
    if (typeof backgroundScanModels === 'function') {
        backgroundScanModels();
    }
    setInterval(pollStatus, 1000);
    setInterval(pollSwarmStatus, 1000);
    // Swarm gallery is now lazy-loaded on tab click to save RAM at startup
});

let allGalleryImages = [];
let galleryGroups = {};

let isSelectionMode = false;
let selectedImages = new Set();

const btnToggleSelect = document.getElementById('btn-toggle-select');
const btnBulkDelete = document.getElementById('btn-bulk-delete');
const btnBulkCensor = document.getElementById('btn-bulk-censor');
const btnBulkUncensor = document.getElementById('btn-bulk-uncensor');
const btnBulkWebhook = document.getElementById('btn-bulk-webhook');
const btnBulkCancel = document.getElementById('btn-bulk-cancel');
const bulkActions = document.getElementById('bulk-actions');
const bulkCount = document.getElementById('bulk-count');

if (btnToggleSelect) {
    btnToggleSelect.addEventListener('click', () => {
        isSelectionMode = !isSelectionMode;
        if (!isSelectionMode) {
            selectedImages.clear();
        }
        updateBulkUI();
        renderSwarmGallery();
    });
}

if (btnBulkCancel) {
    btnBulkCancel.addEventListener('click', () => {
        isSelectionMode = false;
        selectedImages.clear();
        updateBulkUI();
        renderSwarmGallery();
    });
}

if (btnBulkCensor) {
    btnBulkCensor.addEventListener('click', async () => {
        if (selectedImages.size === 0) return;
        btnBulkCensor.disabled = true;
        btnBulkCensor.innerHTML = '<i data-lucide="loader" class="animate-spin w-4 h-4 text-indigo-400"></i>';
        if (window.lucide) window.lucide.createIcons();
        try {
            const paths = Array.from(selectedImages);
            await window.pywebview.api.censor_images(paths);
            isSelectionMode = false;
            selectedImages.clear();
            updateBulkUI();
            await loadSwarmGallery();
        } catch (e) {
            if (window.showToast) window.showToast('Failed to censor images');
        } finally {
            btnBulkCensor.disabled = false;
            btnBulkCensor.innerHTML = '<i data-lucide="eye-off" class="w-4 h-4"></i>';
            if (window.lucide) window.lucide.createIcons();
        }
    });
}

if (btnBulkUncensor) {
    btnBulkUncensor.addEventListener('click', async () => {
        if (selectedImages.size === 0) return;
        btnBulkUncensor.disabled = true;
        btnBulkUncensor.innerHTML = '<i data-lucide="loader" class="animate-spin w-4 h-4 text-green-400"></i>';
        if (window.lucide) window.lucide.createIcons();
        try {
            const paths = Array.from(selectedImages);
            await window.pywebview.api.uncensor_images(paths);
            isSelectionMode = false;
            selectedImages.clear();
            updateBulkUI();
            await loadSwarmGallery();
        } catch (e) {
            if (window.showToast) window.showToast('Failed to uncensor images');
        } finally {
            btnBulkUncensor.disabled = false;
            btnBulkUncensor.innerHTML = '<i data-lucide="eye" class="w-4 h-4"></i>';
            if (window.lucide) window.lucide.createIcons();
        }
    });
}

if (btnBulkDelete) {
    btnBulkDelete.addEventListener('click', async () => {
        if (selectedImages.size === 0) return;
        if (!confirm(`Are you sure you want to delete ${selectedImages.size} images?`)) return;
        
        btnBulkDelete.disabled = true;
        btnBulkDelete.innerHTML = '<i data-lucide="loader" class="animate-spin w-4 h-4 text-red-500"></i>';
        if (window.lucide) window.lucide.createIcons();
        
        try {
            const paths = Array.from(selectedImages);
            await window.pywebview.api.delete_images(paths);
            isSelectionMode = false;
            selectedImages.clear();
            updateBulkUI();
            await loadSwarmGallery();
        } catch (e) {
            if (window.showToast) window.showToast('Failed to delete some images');
        } finally {
            btnBulkDelete.disabled = false;
            btnBulkDelete.innerHTML = '<i data-lucide="trash-2" class="w-4 h-4"></i>';
            if (window.lucide) window.lucide.createIcons();
        }
    });
}

if (btnBulkWebhook) {
    btnBulkWebhook.addEventListener('click', async () => {
        if (selectedImages.size === 0) return;
        
        btnBulkWebhook.disabled = true;
        btnBulkWebhook.innerHTML = '<i data-lucide="loader" class="animate-spin w-4 h-4 text-brand"></i>';
        if (window.lucide) window.lucide.createIcons();
        
        try {
            const paths = Array.from(selectedImages);
            const res = await window.pywebview.api.send_to_webhook(paths);
            if(res.status === 'success') {
                if (window.showToast) window.showToast('Images sent to Discord webhook!');
            } else {
                if (window.showToast) window.showToast(res.message || 'Failed to send to webhook');
            }
            isSelectionMode = false;
            selectedImages.clear();
            updateBulkUI();
            await loadSwarmGallery();
        } catch (e) {
            if (window.showToast) window.showToast('Failed to send images');
        } finally {
            btnBulkWebhook.disabled = false;
            btnBulkWebhook.innerHTML = '<i data-lucide="send" class="w-4 h-4"></i>';
            if (window.lucide) window.lucide.createIcons();
        }
    });
}

function updateBulkUI() {
    if (!bulkActions || !btnToggleSelect) return;
    if (isSelectionMode) {
        bulkActions.classList.remove('hidden');
        bulkActions.classList.add('flex');
        btnToggleSelect.classList.add('bg-indigo-500/20', 'text-indigo-400');
        bulkCount.textContent = selectedImages.size;
    } else {
        bulkActions.classList.add('hidden');
        bulkActions.classList.remove('flex');
        btnToggleSelect.classList.remove('bg-indigo-500/20', 'text-indigo-400');
    }
}

async function loadSwarmGallery() {
    const gallery = document.getElementById('swarm-gallery');
    const filterSelect = document.getElementById('gallery-folder-filter');
    if (!gallery || !filterSelect) return;
    
    gallery.innerHTML = '<div class="col-span-full text-center text-textMuted py-8 text-sm"><i data-lucide="loader" class="w-5 h-5 animate-spin mx-auto mb-2"></i>Loading images...</div>';
    if (window.lucide) window.lucide.createIcons();
    
    try {
        allGalleryImages = await window.pywebview.api.get_swarm_images();
        if (allGalleryImages && allGalleryImages.length > 0) {
            // Group by folder
            galleryGroups = {};
            allGalleryImages.forEach(img => {
                const f = img.folder || 'Unknown Date';
                if (!galleryGroups[f]) galleryGroups[f] = [];
                galleryGroups[f].push(img);
            });
            
            // Populate select
            const currentFilter = filterSelect.value;
            filterSelect.innerHTML = '<option value="all">All Folders</option>';
            const sortedFolders = Object.keys(galleryGroups).sort((a,b) => b.localeCompare(a));
            
            sortedFolders.forEach(f => {
                const opt = document.createElement('option');
                opt.value = f;
                opt.textContent = `${f} (${galleryGroups[f].length})`;
                filterSelect.appendChild(opt);
            });
            
            // Restore selection if still exists
            if (sortedFolders.includes(currentFilter)) {
                filterSelect.value = currentFilter;
            } else {
                filterSelect.value = 'all';
            }
            
            renderSwarmGallery();
        } else {
            gallery.innerHTML = '<div class="col-span-full text-center text-textMuted py-8 text-sm">No images found or SwarmUI not configured.</div>';
        }
    } catch (e) {
        gallery.innerHTML = '<div class="col-span-full text-center text-red-500 py-8 text-sm">Error loading images.</div>';
    }
}

function renderSwarmGallery() {
    const gallery = document.getElementById('swarm-gallery');
    const filterSelect = document.getElementById('gallery-folder-filter');
    if (!gallery || !filterSelect) return;
    
    gallery.innerHTML = '';
    
    let foldersToRender = [];
    if (filterSelect.value === 'all') {
        foldersToRender = Object.keys(galleryGroups).sort((a,b) => b.localeCompare(a));
    } else {
        foldersToRender = [filterSelect.value];
    }
    
    if (foldersToRender.length === 0) {
        gallery.innerHTML = '<div class="col-span-full text-center text-textMuted py-8 text-sm">No images in this folder.</div>';
        return;
    }
    
    foldersToRender.forEach(folderName => {
        const groupContainer = document.createElement('div');
        groupContainer.className = 'space-y-4 mb-6';
        
        // Header with count badge
        const count = galleryGroups[folderName].length;
        const header = document.createElement('div');
        header.className = 'flex items-center justify-between border-b border-border pb-2';
        header.innerHTML = `
            <h4 class="font-bold text-lg text-textPrimary flex items-center gap-2">
                <i data-lucide="folder-open" class="w-5 h-5 text-brand"></i> ${folderName}
            </h4>
            <span class="bg-base px-2.5 py-0.5 rounded-full text-xs font-semibold text-textMuted border border-border">${count} Images</span>
        `;
        
        const grid = document.createElement('div');
        grid.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4';
        
        galleryGroups[folderName].forEach(img => {
            const imgDiv = document.createElement('div');
            const isSelected = selectedImages.has(img.path);
            
            imgDiv.className = `aspect-square rounded-xl overflow-hidden border ${isSelected ? 'border-brand ring-2 ring-brand' : 'border-border'} shadow-sm group relative cursor-pointer bg-card flex items-center justify-center transition-all`;
            
            let checkHtml = `<div class="select-check absolute top-2 right-2 bg-brand text-white rounded-full p-1 shadow-lg z-10 ${isSelected ? '' : 'hidden'}">
                <i data-lucide="check" class="w-3 h-3 text-white"></i>
            </div>`;
            
            let blurClass = img.is_censored ? 'blur-2xl scale-110 hover:blur-none' : 'group-hover:scale-105';
            
            imgDiv.innerHTML = `${checkHtml}<img src="${img.data}" loading="lazy" class="w-full h-full object-cover transition-all duration-300 ${blurClass}">`;
            
            imgDiv.onclick = (e) => {
                if (isSelectionMode) {
                    if (selectedImages.has(img.path)) {
                        selectedImages.delete(img.path);
                        imgDiv.classList.remove('border-brand', 'ring-2', 'ring-brand');
                        imgDiv.classList.add('border-border');
                        const check = imgDiv.querySelector('.select-check');
                        if (check) check.classList.add('hidden');
                    } else {
                        selectedImages.add(img.path);
                        imgDiv.classList.remove('border-border');
                        imgDiv.classList.add('border-brand', 'ring-2', 'ring-brand');
                        const check = imgDiv.querySelector('.select-check');
                        if (check) check.classList.remove('hidden');
                    }
                    updateBulkUI();
                } else {
                    openImageModal(img);
                }
            };
            grid.appendChild(imgDiv);
        });
        
        groupContainer.appendChild(header);
        groupContainer.appendChild(grid);
        gallery.appendChild(groupContainer);
    });
    
    if (window.lucide) window.lucide.createIcons();
}

let currentModalImage = null;
let scale = 1, panX = 0, panY = 0;
let isDragging = false, startX, startY;

const modal = document.getElementById('image-modal');
const modalImage = document.getElementById('modal-image');
const modalMetadata = document.getElementById('modal-metadata');

// Zoom and Pan Logic
modalImage.parentElement.addEventListener('wheel', (e) => {
    e.preventDefault();
    scale += e.deltaY * -0.002;
    scale = Math.min(Math.max(0.5, scale), 5);
    updateTransform();
});

modalImage.parentElement.addEventListener('mousedown', (e) => {
    if (scale > 1) {
        isDragging = true;
        startX = e.clientX - panX;
        startY = e.clientY - panY;
        modalImage.parentElement.style.cursor = 'grabbing';
    }
});

window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    panX = e.clientX - startX;
    panY = e.clientY - startY;
    updateTransform();
});

window.addEventListener('mouseup', () => {
    isDragging = false;
    modalImage.parentElement.style.cursor = scale > 1 ? 'grab' : 'default';
});

function updateTransform() {
    if (scale <= 1) {
        panX = 0;
        panY = 0;
    } else {
        const wrapper = modalImage.parentElement;
        // Limit panning bounds so the image doesn't fly off screen
        const limitX = Math.max(0, (wrapper.clientWidth * scale - wrapper.clientWidth) / 2);
        const limitY = Math.max(0, (wrapper.clientHeight * scale - wrapper.clientHeight) / 2);
        
        // Add a small buffer (e.g., 50px) so they can reach the edges easily if aspect ratio is weird
        panX = Math.min(Math.max(panX, -limitX - 50), limitX + 50);
        panY = Math.min(Math.max(panY, -limitY - 50), limitY + 50);
    }
    
    modalImage.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    modalImage.parentElement.style.cursor = scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default';
}

function resetTransform() {
    scale = 1; panX = 0; panY = 0;
    updateTransform();
    modalImage.style.transform = '';
}

function openImageModal(img) {
    currentModalImage = img;
    modalImage.src = img.data;
    resetTransform();
    
    modal.classList.remove('hidden');
    // slight delay to allow display:flex to take effect before opacity transition
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        modal.classList.add('opacity-100');
    }, 10);
    
    modalMetadata.innerHTML = '<div class="animate-pulse">Loading metadata...</div>';
    
    window.pywebview.api.get_image_metadata(img.path).then(res => {
        if(res.status === 'success') {
            try {
                let params = {};
                
                // SwarmUI might store the JSON under 'parameters' or 'sui_image_params'
                for (const val of Object.values(res.metadata)) {
                    if (typeof val === 'string' && val.trim().startsWith('{')) {
                        try {
                            const parsed = JSON.parse(val);
                            if (parsed.sui_image_params) {
                                params = parsed.sui_image_params;
                                break;
                            } else if (parsed.prompt) {
                                params = parsed;
                                break;
                            }
                        } catch(e) {}
                    }
                }
                
                // Fallback if not found inside JSON wrapper
                if (!params.prompt && res.metadata.sui_image_params) {
                     try { params = JSON.parse(res.metadata.sui_image_params); } catch(e){}
                }

                // Calculate resolution string if available
                if (params.width && params.height) {
                    const gcd = (a, b) => b ? gcd(b, a % b) : a;
                    const divisor = gcd(params.width, params.height);
                    params.resolution = `${params.width}x${params.height} (${params.width/divisor}:${params.height/divisor})`;
                }
                
                // Merge generation time from top-level metadata if present
                if (res.metadata["Generation Time"]) {
                    params.generation_time = res.metadata["Generation Time"];
                }

                const displayKeys = ['prompt', 'negativeprompt', 'resolution', 'seed', 'steps', 'cfgscale', 'generation_time'];
                
                const labels = {
                    'prompt': 'PROMPT',
                    'negativeprompt': 'NEGATIVE PROMPT',
                    'resolution': 'RESOLUTION',
                    'seed': 'SEED',
                    'steps': 'STEPS',
                    'cfgscale': 'CFG SCALE',
                    'generation_time': 'GENERATION TIME'
                };
                
                modalMetadata.innerHTML = '';
                let hasData = false;
                
                displayKeys.forEach(k => {
                    if (params[k] !== undefined && params[k] !== null && params[k] !== '') {
                        hasData = true;
                        const div = document.createElement('div');
                        div.className = 'mb-3 group cursor-pointer hover:bg-white/5 p-2 rounded-lg transition-colors';
                        
                        const titleSpan = document.createElement('span');
                        titleSpan.className = 'text-textMuted block text-[10px] uppercase tracking-wider mb-1 flex items-center justify-between';
                        titleSpan.innerHTML = `${labels[k] || k} <i data-lucide="copy" class="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity"></i>`;
                        
                        const valSpan = document.createElement('span');
                        valSpan.className = 'text-brand font-medium block break-words';
                        valSpan.textContent = params[k];
                        
                        div.appendChild(titleSpan);
                        div.appendChild(valSpan);
                        
                        div.addEventListener('click', () => {
                            navigator.clipboard.writeText(String(params[k])).then(() => {
                                window.showToast(`Copied ${labels[k] || k}!`);
                            });
                        });
                        
                        modalMetadata.appendChild(div);
                    }
                });
                
                if (!hasData) {
                    modalMetadata.innerHTML = '<span class="text-textMuted">No prompt data found.</span>';
                }
                if (window.lucide) window.lucide.createIcons();
            } catch(e) {
                modalMetadata.innerHTML = '<span class="text-red-400">Error parsing metadata.</span>';
            }
        } else {
            modalMetadata.innerHTML = '<span class="text-red-400">Failed to load metadata.</span>';
        }
    });
}

function closeImageModal() {
    modal.classList.remove('opacity-100');
    modal.classList.add('opacity-0');
    setTimeout(() => {
        modal.classList.add('hidden');
        currentModalImage = null;
        modalImage.src = '';
    }, 300); // match transition duration
}

document.getElementById('modal-btn-close')?.addEventListener('click', closeImageModal);
document.getElementById('modal-btn-folder')?.addEventListener('click', () => {
    if(currentModalImage) window.pywebview.api.open_image_folder(currentModalImage.path);
});
document.getElementById('modal-btn-delete')?.addEventListener('click', async () => {
    if(currentModalImage && confirm("Delete this image?")) {
        const res = await window.pywebview.api.delete_image(currentModalImage.path);
        if(res.status === 'success') {
            closeImageModal();
            loadSwarmGallery();
            window.showToast("Image deleted.");
        }
    }
});
document.getElementById('modal-btn-copy')?.addEventListener('click', async () => {
    if(currentModalImage) {
        try {
            const r = await fetch(currentModalImage.data);
            const blob = await r.blob();
            await navigator.clipboard.write([new ClipboardItem({[blob.type]: blob})]);
            window.showToast("Image copied to clipboard!");
        } catch(e) {
            window.showToast("Failed to copy image.");
        }
    }
});
document.getElementById('modal-btn-webhook')?.addEventListener('click', async () => {
    if(currentModalImage) {
        const res = await window.pywebview.api.send_to_webhook([currentModalImage.path]);
        if(res.status === 'success') {
            window.showToast("Image sent to Discord webhook!");
        } else {
            window.showToast(res.message || "Failed to send to webhook");
        }
    }
});

document.getElementById('modal-btn-fullscreen')?.addEventListener('click', () => {
    const wrapper = modalImage.parentElement;
    if (!document.fullscreenElement) {
        if (wrapper.requestFullscreen) {
            wrapper.requestFullscreen();
        } else if (wrapper.webkitRequestFullscreen) {
            wrapper.webkitRequestFullscreen();
        } else if (wrapper.msRequestFullscreen) {
            wrapper.msRequestFullscreen();
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }
});

document.addEventListener('fullscreenchange', () => {
    const exitBtn = document.getElementById('btn-exit-fullscreen');
    if (!exitBtn) return;
    
    resetTransform(); // Reset pan/zoom when toggling fullscreen
    
    if (document.fullscreenElement) {
        exitBtn.classList.remove('hidden');
    } else {
        exitBtn.classList.add('hidden');
    }
});

document.getElementById('btn-exit-fullscreen')?.addEventListener('click', () => {
    if (document.exitFullscreen) {
        document.exitFullscreen();
    }
});

const btnRefreshGallery = document.getElementById('btn-refresh-gallery');
if (btnRefreshGallery) {
    btnRefreshGallery.addEventListener('click', loadSwarmGallery);
}

const filterSelect = document.getElementById('gallery-folder-filter');
if (filterSelect) {
    filterSelect.addEventListener('change', renderSwarmGallery);
}

function loadConfigToUI() {
    for (const [key, el] of Object.entries(configMap)) {
        if (!el) continue;
        if (el.type === 'checkbox') {
            el.checked = appConfig[key];
        } else {
            let val = appConfig[key] ?? '';
            if (key === 'swarm_port' && (val === 0 || val === '')) val = 7801;
            if (key === 'swarm_host' && val === '') val = '127.0.0.1';
            
            if (el.tagName === 'SELECT' && val !== '') {
                let exists = false;
                for(let i=0; i<el.options.length; i++) {
                    if (el.options[i].value === val) {
                        exists = true; break;
                    }
                }
                if (!exists) {
                    const opt = document.createElement('option');
                    opt.value = val;
                    opt.text = val.split('\\').pop().split('/').pop() || val;
                    el.appendChild(opt);
                }
            }
            el.value = val;
        }
    }
    
    sliderGpu.value = appConfig.gpu_layers ?? 99;
    
    if (appConfig.swarm_steps) {
        configMap.swarm_steps.value = appConfig.swarm_steps;
        valSwarmSteps.textContent = appConfig.swarm_steps;
    }
    if (appConfig.swarm_cfg) {
        configMap.swarm_cfg.value = appConfig.swarm_cfg;
        valSwarmCfg.textContent = parseFloat(appConfig.swarm_cfg).toFixed(1);
    }
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
        const el = configMap.model_path;
        if (el.tagName === 'SELECT') {
            let exists = false;
            for(let i=0; i<el.options.length; i++) {
                if (el.options[i].value === path) { exists = true; break; }
            }
            if (!exists) {
                const opt = document.createElement('option');
                opt.value = path;
                opt.text = path.split('\\').pop().split('/').pop() || path;
                el.appendChild(opt);
            }
        }
        el.value = path;
        saveConfig();
    }
});

const btnClearModel = document.getElementById('btn-clear-model');
if (btnClearModel) {
    btnClearModel.addEventListener('click', () => {
        configMap.model_path.value = '';
        saveConfig();
        if (window.showToast) window.showToast('Model path cleared. Server will start without a model.');
    });
}

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
        const el = configMap.vision_projector;
        if (el.tagName === 'SELECT') {
            let exists = false;
            for(let i=0; i<el.options.length; i++) {
                if (el.options[i].value === path) { exists = true; break; }
            }
            if (!exists) {
                const opt = document.createElement('option');
                opt.value = path;
                opt.text = path.split('\\').pop().split('/').pop() || path;
                el.appendChild(opt);
            }
        }
        el.value = path;
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
        
        // Load dependencies dynamically when tabs are opened
        if (targetId === 'tab-models') {
            const scanBtn = document.getElementById('btn-scan-models');
            if (scanBtn) scanBtn.click();
        } else if (targetId === 'tab-swarm-lib') {
            loadSwarmGallery();
        }
        
        // AGGRESSIVE DOM UNLOADING: Free RAM when leaving heavy tabs
        if (targetId !== 'tab-swarm-lib') {
            const gallery = document.getElementById('swarm-gallery');
            if (gallery) gallery.innerHTML = '';
            allGalleryImages = [];
            galleryGroups = {};
        }
        
        if (targetId !== 'tab-hub') {
            const hubResults = document.getElementById('hub-results');
            if (hubResults) hubResults.innerHTML = '';
            // Hub state variables (like search query) can remain, but DOM is wiped
        }
    });
});

const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const btnEject = document.getElementById('btn-eject');
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
    const btnCopyUrl = document.getElementById('btn-copyurl');
    if (isRunning && !running) {
        // Just stopped
        btnWebchat.disabled = true;
    }
    isRunning = running;
    if (isRunning) {
        btnStart.classList.add('hidden');
        btnStop.classList.remove('hidden');
        btnStop.classList.add('flex');
        if(btnEject) {
            btnEject.classList.remove('hidden');
            btnEject.classList.add('flex');
        }
        
        btnWebchat.classList.remove('opacity-50', 'pointer-events-none');
        btnWebchat.disabled = false;
        if (btnCopyUrl) {
            btnCopyUrl.classList.remove('opacity-50', 'pointer-events-none');
            btnCopyUrl.disabled = false;
        }
        
        statusDot.classList.remove('bg-red-500');
        statusDot.classList.add('pulsating-dot');
        statusText.innerHTML = translations[currentLang].status_running;
    } else {
        btnStop.classList.add('hidden');
        btnStop.classList.remove('flex');
        if(btnEject) {
            btnEject.classList.add('hidden');
            btnEject.classList.remove('flex');
        }
        btnStart.classList.remove('hidden');
        
        btnWebchat.classList.add('opacity-50', 'pointer-events-none');
        btnWebchat.disabled = true;
        if (btnCopyUrl) {
            btnCopyUrl.classList.add('opacity-50', 'pointer-events-none');
            btnCopyUrl.disabled = true;
        }
        
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

if (btnEject) {
    btnEject.addEventListener('click', async () => {
        if (!window.pywebview) return;
        const isRunning = await window.pywebview.api.check_status();
        if (isRunning) {
            if (window.showToast) window.showToast('Ejecting model...');
            await window.pywebview.api.stop_server();
            
            let retries = 20;
            while (retries > 0 && await window.pywebview.api.check_status()) {
                await new Promise(r => setTimeout(r, 250));
                retries--;
            }
            
            // Override config to empty model
            const currentConfig = { ...appConfig };
            currentConfig.model_path = '';
            currentConfig.vision_projector = '';
            
            await window.pywebview.api.start_server(currentConfig);
            
            // Clear UI
            configMap.model_path.value = '';
            configMap.vision_projector.value = '';
            saveConfig();
            
            if (window.showToast) window.showToast('Model ejected. API still running.');
        }
    });
}

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
    toast.classList.remove('opacity-0', 'translate-y-4');
    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-4');
    }, 3000);
}

// SwarmUI Logic
let isSwarmRunning = false;
async function pollSwarmStatus() {
    if (!window.pywebview || !window.pywebview.api) return;
    const running = await window.pywebview.api.get_swarm_status();
    updateSwarmStatusUI(running);
}

const btnOpenSwarm = document.getElementById('btn-open-swarmui-web');
if (btnOpenSwarm) {
    btnOpenSwarm.addEventListener('click', async () => {
        let port = configMap.swarm_port.value || 7801;
        let host = configMap.swarm_host.value || '127.0.0.1';
        let url = `http://${host}:${port}/`;
        if (window.pywebview) {
            await window.pywebview.api.open_web_chat(url);
        } else {
            window.open(url, '_blank');
        }
    });
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
        if (btnOpenSwarm) btnOpenSwarm.classList.remove('hidden');
        
        statusDot.classList.remove('bg-red-500');
        statusDot.classList.add('pulsating-dot');
        statusText.innerHTML = translations[currentLang]?.status_running || "Running";
    } else {
        btnStop.classList.add('hidden');
        btnStop.classList.remove('flex');
        btnStart.classList.remove('hidden');
        if (btnOpenSwarm) btnOpenSwarm.classList.add('hidden');
        
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
