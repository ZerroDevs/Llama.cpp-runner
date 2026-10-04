document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('hub-search-input');
    const searchBtn = document.getElementById('btn-hub-search');
    const resultsGrid = document.getElementById('hub-results-grid');
    
    const modal = document.getElementById('hub-download-modal');
    const modalRepoName = document.getElementById('modal-repo-name');
    const modalFileList = document.getElementById('modal-file-list');
    const modalCloseBtn = document.getElementById('btn-hub-close-modal');
    
    const progressContainer = document.getElementById('hub-progress-container');
    const progressText = document.getElementById('hub-progress-text');
    const progressPercent = document.getElementById('hub-progress-percent');
    const progressBar = document.getElementById('hub-progress-bar');
    
    let progressInterval = null;
    let currentRepoId = null;
    
    document.getElementById('hub-uncensored').addEventListener('change', () => {
        searchBtn.click();
    });
    
    // Listen to tab changes (handled in app.js) to trigger initial load
    let initialSearchDone = false;
    document.querySelector('[data-target="tab-hub"]').addEventListener('click', () => {
        if (!initialSearchDone) {
            initialSearchDone = true;
            searchBtn.click();
        }
    });
    
    searchBtn.addEventListener('click', async () => {
        const query = searchInput.value.trim();
        const uncensored = document.getElementById('hub-uncensored').checked;
        
        const originalHtml = searchBtn.innerHTML;
        searchBtn.innerHTML = '<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> Searching...';
        searchBtn.disabled = true;
        if (window.lucide) window.lucide.createIcons();
        
        resultsGrid.innerHTML = '<div class="col-span-full text-center p-8 text-textMuted"><i data-lucide="loader" class="w-8 h-8 animate-spin mx-auto mb-4 text-brand"></i> Searching Hub...</div>';
        if (window.lucide) window.lucide.createIcons();
        
        if (!window.pywebview) return;
        
        try {
            const res = await window.pywebview.api.search_hub(query, uncensored, 12);
            if (res.status === 'success') {
                renderResults(res.models);
            } else {
                resultsGrid.innerHTML = `<div class="col-span-full text-center p-8 text-red-500">Error: ${res.message}</div>`;
            }
        } catch (e) {
            resultsGrid.innerHTML = `<div class="col-span-full text-center p-8 text-red-500">Search failed.</div>`;
        }
        
        searchBtn.innerHTML = originalHtml;
        searchBtn.disabled = false;
        if (window.lucide) window.lucide.createIcons();
    });
    
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') searchBtn.click();
    });
    
    function renderResults(models) {
        resultsGrid.innerHTML = '';
        if (models.length === 0) {
            resultsGrid.innerHTML = '<div class="col-span-full text-center p-8 text-textMuted">No models found.</div>';
            return;
        }
        
        models.forEach(m => {
            const card = document.createElement('div');
            card.className = 'card p-5 rounded-xl border border-border hover:border-brand/50 transition-colors flex flex-col justify-between cursor-pointer group';
            card.innerHTML = `
                <div>
                    <div class="flex items-start gap-3 mb-3">
                        <div class="w-10 h-10 rounded-lg bg-brand/10 flex items-center justify-center shrink-0">
                            <i data-lucide="box" class="w-5 h-5 text-brand group-hover:scale-110 transition-transform"></i>
                        </div>
                        <h3 class="font-bold text-sm break-all leading-tight mt-1" title="${m.id}">${m.id}</h3>
                    </div>
                    <div class="flex items-center gap-3 text-xs mb-3 font-semibold">
                        <span class="text-textMuted bg-base px-2 py-1 rounded-md border border-border">${m.size_str}</span>
                        <span class="${m.color} flex items-center gap-1 bg-base px-2 py-1 rounded-md border border-border"><i data-lucide="activity" class="w-3 h-3"></i> ${m.compatibility}</span>
                    </div>
                </div>
                <div class="flex items-center justify-between mt-auto text-xs text-textMuted pt-4 border-t border-border">
                    <span class="flex items-center gap-1"><i data-lucide="download" class="w-3 h-3"></i> ${formatNumber(m.downloads)}</span>
                    <span class="flex items-center gap-1"><i data-lucide="heart" class="w-3 h-3"></i> ${formatNumber(m.likes)}</span>
                </div>
            `;
            card.addEventListener('click', () => openModal(m.id));
            resultsGrid.appendChild(card);
        });
        if (window.lucide) window.lucide.createIcons();
    }
    
    function formatNumber(num) {
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return num.toString();
    }
    
    async function openModal(repoId) {
        currentRepoId = repoId;
        modal.classList.remove('hidden');
        modalRepoName.innerText = repoId;
        modalFileList.innerHTML = '<div class="text-center p-4 text-textMuted"><i data-lucide="loader" class="w-6 h-6 animate-spin mx-auto mb-2 text-brand"></i> Fetching files...</div>';
        if (window.lucide) window.lucide.createIcons();
        progressContainer.classList.add('hidden');
        
        try {
            const res = await window.pywebview.api.list_hub_files(repoId);
            if (res.status === 'success') {
                renderFileList(res.files);
            } else {
                modalFileList.innerHTML = `<div class="text-center p-4 text-red-500">Error: ${res.message}</div>`;
            }
        } catch (e) {
            modalFileList.innerHTML = `<div class="text-center p-4 text-red-500">Failed to fetch files.</div>`;
        }
    }
    
    function renderFileList(files) {
        modalFileList.innerHTML = '';
        if (files.length === 0) {
            modalFileList.innerHTML = '<div class="text-center p-4 text-textMuted">No .gguf files found in this repository.</div>';
            return;
        }
        
        files.forEach(f => {
            const row = document.createElement('div');
            row.className = 'flex items-center justify-between p-3 rounded-lg bg-base border border-border hover:border-brand/30 transition-colors';
            
            row.innerHTML = `
                <div class="flex flex-col overflow-hidden gap-1">
                    <div class="flex items-center gap-2">
                        <i data-lucide="file-box" class="w-4 h-4 text-brand shrink-0"></i>
                        <span class="text-sm font-mono truncate font-bold" title="${f.filename}">${f.filename}</span>
                    </div>
                    <div class="flex items-center gap-3 text-xs pl-6">
                        <span class="text-textMuted">${f.size_str}</span>
                        <span class="${f.color} flex items-center gap-1"><i data-lucide="activity" class="w-3 h-3"></i> ${f.compatibility}</span>
                    </div>
                </div>
                <button class="btn-download btn-primary px-4 py-2 rounded-lg text-xs shrink-0 flex items-center gap-1 font-bold">
                    <i data-lucide="download" class="w-4 h-4"></i> Download
                </button>
            `;
            
            const btn = row.querySelector('.btn-download');
            btn.addEventListener('click', () => startDownload(f.filename, btn));
            
            modalFileList.appendChild(row);
        });
        if (window.lucide) window.lucide.createIcons();
    }
    
    async function startDownload(filename, btnEl) {
        if (!appConfig.models_dir) {
            window.showToast("Please select a Models Directory first in the Models Library tab.");
            return;
        }
        
        btnEl.disabled = true;
        btnEl.innerHTML = '<i data-lucide="loader" class="w-3 h-3 animate-spin"></i> Starting...';
        if (window.lucide) window.lucide.createIcons();
        
        try {
            const res = await window.pywebview.api.download_hub_file(currentRepoId, filename, appConfig.models_dir);
            if (res.status === 'success') {
                progressContainer.classList.remove('hidden');
                modalFileList.classList.add('hidden'); // Hide file list to focus on progress
                startProgressPolling();
            } else {
                window.showToast("Error: " + res.message);
                btnEl.disabled = false;
                btnEl.innerHTML = '<i data-lucide="download" class="w-3 h-3"></i> Download';
                if (window.lucide) window.lucide.createIcons();
            }
        } catch (e) {
            window.showToast("Failed to start download.");
        }
    }
    
    function startProgressPolling() {
        if (progressInterval) clearInterval(progressInterval);
        
        progressInterval = setInterval(async () => {
            const prog = await window.pywebview.api.get_download_progress();
            
            if (prog.status === 'downloading') {
                const mbDown = (prog.downloaded / (1024 * 1024)).toFixed(1);
                const mbTotal = (prog.total / (1024 * 1024)).toFixed(1);
                progressText.innerText = `Downloading ${prog.filename.split('/').pop()} (${mbDown} MB / ${mbTotal} MB)`;
                progressPercent.innerText = `${prog.progress}%`;
                progressBar.style.width = `${prog.progress}%`;
            } else if (prog.status === 'finished') {
                clearInterval(progressInterval);
                progressText.innerText = `Download Complete!`;
                progressPercent.innerText = `100%`;
                progressBar.style.width = `100%`;
                progressBar.classList.add('bg-green-500');
                progressBar.classList.remove('bg-brand');
                window.showToast("Download finished successfully!");
                
                // Refresh models list if possible
                const scanBtn = document.getElementById('btn-scan-models');
                if(scanBtn) scanBtn.click();
                
            } else if (prog.status === 'error') {
                clearInterval(progressInterval);
                progressText.innerText = `Error: ${prog.message}`;
                progressText.classList.add('text-red-500');
                progressBar.classList.add('bg-red-500');
                progressBar.classList.remove('bg-brand');
                window.showToast("Download failed.");
            }
        }, 500);
    }
    
    modalCloseBtn.addEventListener('click', () => {
        modal.classList.add('hidden');
        modalFileList.classList.remove('hidden');
        // We don't stop the background download, just hide the modal
    });
});
