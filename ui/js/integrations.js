// integrations.js

document.getElementById('btn-copy-curl')?.addEventListener('click', () => {
    const code = document.getElementById('code-curl').innerText;
    navigator.clipboard.writeText(code).then(() => window.showToast('Copied cURL!'));
});

document.getElementById('btn-copy-python')?.addEventListener('click', () => {
    const code = document.getElementById('code-python').innerText;
    navigator.clipboard.writeText(code).then(() => window.showToast('Copied Python snippet!'));
});

document.getElementById('btn-test-ping')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-test-ping');
    const output = document.getElementById('ping-output');
    
    if (!isRunning) {
        output.innerText = "Error: Server is not running.";
        output.classList.add('text-red-500');
        return;
    }
    
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> Pinging...';
    lucide.createIcons();
    
    const host = configMap.host.value === '0.0.0.0' ? '127.0.0.1' : configMap.host.value;
    const port = configMap.port.value;
    
    try {
        const res = await fetch(`http://${host}:${port}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${configMap.api_key.value || 'sk-no-key'}`
            },
            body: JSON.stringify({
                model: 'local-model',
                messages: [{ role: 'user', content: 'Ping! Reply with exactly one word: Pong.' }],
                max_tokens: 10
            })
        });
        
        const data = await res.json();
        output.innerText = JSON.stringify(data.choices[0].message, null, 2);
        output.classList.remove('text-red-500');
        output.classList.add('text-brand');
    } catch (e) {
        output.innerText = `Error: ${e.message}`;
        output.classList.remove('text-brand');
        output.classList.add('text-red-500');
    }
    
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="send" class="w-4 h-4"></i> Send Ping';
    lucide.createIcons();
});
