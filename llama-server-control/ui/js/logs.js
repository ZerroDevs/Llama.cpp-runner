const logContainer = document.getElementById('log-container');
const autoScrollCheckbox = document.getElementById('auto-scroll');

function resetSwarmItsTimeout() {
    clearTimeout(window.swarmItsTimeout);
    window.swarmItsTimeout = setTimeout(() => {
        window.currentSwarmIts = 0;
    }, 2000);
}

window.receiveLog = function(logLine) {
    if (!logLine) return;
    
    const div = document.createElement('div');
    div.className = 'whitespace-pre-wrap log-line';
    
    if (logLine.startsWith('[SWARM] ')) {
        div.dataset.source = 'swarm';
        logLine = logLine.substring(8);
        div.classList.add('text-indigo-400');
        
        // Parse it/s or s/it for telemetry
        const itsMatch = logLine.match(/([\d.]+)\s*it\/s/i);
        if (itsMatch) {
            window.currentSwarmIts = parseFloat(itsMatch[1]);
            resetSwarmItsTimeout();
        } else {
            const sitMatch = logLine.match(/([\d.]+)\s*s\/it/i);
            if (sitMatch) {
                const sIt = parseFloat(sitMatch[1]);
                if (sIt > 0) {
                    window.currentSwarmIts = (1 / sIt);
                    resetSwarmItsTimeout();
                }
            }
        }
    } else {
        div.dataset.source = 'llama';
        if (logLine.includes('WARN')) {
            div.classList.add('log-warn');
        } else if (logLine.includes('ERR') || logLine.includes('fail')) {
            div.classList.add('log-error');
        } else if (logLine.includes('INFO') || logLine.includes('llama_')) {
            div.classList.add('log-info');
        } else {
            div.classList.add('text-gray-300', 'dark:text-gray-400');
        }
    }
    
    div.textContent = logLine;
    logContainer.appendChild(div);
    
    while (logContainer.childElementCount > 500) {
        logContainer.removeChild(logContainer.firstChild);
    }
    
    if (autoScrollCheckbox.checked) {
        logContainer.scrollTop = logContainer.scrollHeight;
    }
};

document.getElementById('btn-clear-logs')?.addEventListener('click', () => {
    logContainer.innerHTML = '';
});

document.getElementById('btn-copy-logs')?.addEventListener('click', () => {
    const text = logContainer.innerText;
    navigator.clipboard.writeText(text).then(() => {
        if (window.showToast) {
            window.showToast(translations[currentLang].toast_copied || 'Copied!');
        }
    });
});

document.getElementById('btn-export-logs')?.addEventListener('click', () => {
    const text = logContainer.innerText;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `llama-server-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
});

// Log Filter Logic
const filterAll = document.getElementById('log-filter-all');
const filterLlama = document.getElementById('log-filter-llama');
const filterSwarm = document.getElementById('log-filter-swarm');

function setLogFilter(source) {
    const activeClass = ['bg-brand', 'text-white', 'shadow-sm'];
    const inactiveClass = ['text-textMuted', 'hover:text-textPrimary'];
    
    [filterAll, filterLlama, filterSwarm].forEach(btn => {
        if (btn) {
            btn.classList.remove(...activeClass);
            btn.classList.add(...inactiveClass);
        }
    });

    if (source === 'all') {
        filterAll.classList.remove(...inactiveClass);
        filterAll.classList.add(...activeClass);
        logContainer.className = "h-full overflow-y-auto font-mono text-[13px] leading-relaxed break-all select-text space-y-1 p-1 filter-all";
    } else if (source === 'llama') {
        filterLlama.classList.remove(...inactiveClass);
        filterLlama.classList.add(...activeClass);
        logContainer.className = "h-full overflow-y-auto font-mono text-[13px] leading-relaxed break-all select-text space-y-1 p-1 filter-llama";
    } else if (source === 'swarm') {
        filterSwarm.classList.remove(...inactiveClass);
        filterSwarm.classList.add(...activeClass);
        logContainer.className = "h-full overflow-y-auto font-mono text-[13px] leading-relaxed break-all select-text space-y-1 p-1 filter-swarm";
    }
}

filterAll?.addEventListener('click', () => setLogFilter('all'));
filterLlama?.addEventListener('click', () => setLogFilter('llama'));
filterSwarm?.addEventListener('click', () => setLogFilter('swarm'));

// Initial state css is handled in style.css or dynamically:
// We need to inject styles for these classes to hide unwanted logs
const style = document.createElement('style');
style.innerHTML = `
    .filter-llama .log-line[data-source="swarm"] { display: none !important; }
    .filter-swarm .log-line[data-source="llama"] { display: none !important; }
`;
document.head.appendChild(style);
