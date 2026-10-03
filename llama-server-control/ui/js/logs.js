const logContainer = document.getElementById('log-container');
const autoScrollCheckbox = document.getElementById('auto-scroll');

window.receiveLog = function(logLine) {
    if (!logLine) return;
    
    const div = document.createElement('div');
    div.className = 'whitespace-pre-wrap';
    
    if (logLine.includes('WARN')) {
        div.classList.add('log-warn');
    } else if (logLine.includes('ERR') || logLine.includes('fail')) {
        div.classList.add('log-error');
    } else if (logLine.includes('INFO') || logLine.includes('llama_')) {
        div.classList.add('log-info');
    } else {
        div.classList.add('text-gray-300', 'dark:text-gray-400');
    }
    
    div.textContent = logLine;
    logContainer.appendChild(div);
    
    if (logContainer.childElementCount > 1000) {
        logContainer.removeChild(logContainer.firstChild);
    }
    
    if (autoScrollCheckbox.checked) {
        logContainer.scrollTop = logContainer.scrollHeight;
    }
};

document.getElementById('btn-clear-logs').addEventListener('click', () => {
    logContainer.innerHTML = '';
});

document.getElementById('btn-copy-logs').addEventListener('click', () => {
    const text = logContainer.innerText;
    navigator.clipboard.writeText(text).then(() => {
        if (window.showToast) {
            window.showToast(translations[currentLang].toast_copied || 'Copied!');
        }
    });
});
