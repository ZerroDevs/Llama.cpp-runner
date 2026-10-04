// hardware.js

const ramBar = document.getElementById('ram-bar');
const ramText = document.getElementById('ram-text');
const gpuBar = document.getElementById('gpu-bar');
const gpuText = document.getElementById('gpu-text');
const cpuText = document.getElementById('cpu-text');
const cpuName = document.getElementById('cpu-name');
const gpuName = document.getElementById('gpu-name');

// Context Estimator
const ctxSelect = document.getElementById('cfg-context_size');
const ctxWarning = document.getElementById('ctx-warning');

setInterval(async () => {
    if (!window.pywebview) return;
    
    // Ensure we only poll if tab is active (optimization)
    const isHardwareActive = !document.getElementById('tab-hardware').classList.contains('hidden');
    const isMainActive = !document.getElementById('tab-main').classList.contains('hidden');
    
    if (isHardwareActive || isMainActive) {
        const data = await window.pywebview.api.get_hardware_data();
        
        if (isHardwareActive) {
            ramBar.style.width = `${data.ram_percent}%`;
            ramText.innerText = `${data.ram_used} GB / ${data.ram_total} GB`;
            
            gpuBar.style.width = `${data.gpu_percent}%`;
            gpuText.innerText = `${Math.round(data.gpu_used / 1024)} GB / ${Math.round(data.gpu_total / 1024)} GB`;
            if (gpuName) gpuName.innerText = data.gpu_name;
            
            cpuText.innerText = `${data.cpu_percent}%`;
            if (cpuName) cpuName.innerText = `${data.cpu_name} (${data.cpu_cores} Cores / ${data.cpu_threads} Threads)`;
            
            // Context logic
            const totalGpuGb = data.gpu_total / 1024;
            const ctxSize = parseInt(ctxSelect.value);
            
            if (ctxWarning) {
                if (ctxSize > 32000 && totalGpuGb < 12) {
                    ctxWarning.classList.remove('hidden');
                    ctxWarning.innerText = 'High context size may cause OOM on < 12GB VRAM.';
                } else if (ctxSize > 65000 && totalGpuGb < 24) {
                    ctxWarning.classList.remove('hidden');
                    ctxWarning.innerText = 'Extreme context requires massive VRAM (24GB+).';
                } else {
                    ctxWarning.classList.add('hidden');
                }
            }
            
            // Swarm UI Speed update
            const swarmSpeedEl = document.getElementById('swarm-gen-speed');
            if (swarmSpeedEl) {
                // If it's been a while since we updated currentSwarmIts, we might want to fade it to 0, 
                // but for now just show what's there.
                const speed = window.currentSwarmIts || 0;
                swarmSpeedEl.innerHTML = `${speed.toFixed(2)} <span class="text-sm text-textMuted font-normal">it/s</span>`;
            }
        }
    }
}, 2000);

// Benchmark Logic
let benchChart = null;
const btnRunBenchmark = document.getElementById('btn-run-benchmark');
const promptSpeedEl = document.getElementById('bench-prompt-speed');
const genSpeedEl = document.getElementById('bench-gen-speed');

if (btnRunBenchmark) {
    btnRunBenchmark.addEventListener('click', async () => {
        if (document.getElementById('status-text').innerText !== 'Running') {
            window.showToast("Please start the server first!");
            return;
        }

        const originalBtnHTML = btnRunBenchmark.innerHTML;
        btnRunBenchmark.innerHTML = '<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> Running...';
        btnRunBenchmark.disabled = true;
        if (window.lucide) window.lucide.createIcons();

        // Reset text
        promptSpeedEl.innerHTML = `-- <span class="text-sm text-textMuted font-normal">T/s</span>`;
        genSpeedEl.innerHTML = `-- <span class="text-sm text-textMuted font-normal">T/s</span>`;

        // Initialize or clear chart
        const ctxCanvas = document.getElementById('benchmarkChart').getContext('2d');
        if (benchChart) {
            benchChart.destroy();
        }
        
        benchChart = new Chart(ctxCanvas, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Llama Tokens / Second',
                    data: [],
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3,
                    yAxisID: 'y'
                }, {
                    label: 'SwarmUI Speed (it/s)',
                    data: [],
                    borderColor: '#6366f1',
                    backgroundColor: 'rgba(99, 102, 241, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3,
                    yAxisID: 'y1'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { display: true, title: { display: true, text: 'Time (s)', color: '#9ca3af' }, ticks: { color: '#9ca3af' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                    y: { type: 'linear', display: true, position: 'left', title: { display: true, text: 'T/s', color: '#9ca3af' }, ticks: { color: '#9ca3af' }, grid: { color: 'rgba(255,255,255,0.05)' }, beginAtZero: true },
                    y1: { type: 'linear', display: true, position: 'right', title: { display: true, text: 'it/s', color: '#9ca3af' }, ticks: { color: '#9ca3af' }, grid: { drawOnChartArea: false }, beginAtZero: true }
                },
                plugins: { legend: { display: true, labels: { color: '#9ca3af' } } },
                animation: false
            }
        });

        let host = "127.0.0.1";
        let port = 8080;
        let apiKey = "sk-no-key";
        if (window.appConfig) {
            host = window.appConfig.host === '0.0.0.0' ? '127.0.0.1' : window.appConfig.host;
            port = window.appConfig.port;
            apiKey = window.appConfig.api_key || "sk-no-key";
        }
        
        try {
            // A long prompt to force prompt eval time, and long generation
            const prompt = "Write a comprehensive 5-paragraph essay about the history of artificial intelligence, starting from the Turing Test up to modern transformers. Make it detailed.";
            
            const startReqTime = performance.now();
            
            const response = await fetch(`http://${host}:${port}/v1/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify({
                    messages: [{ role: 'user', content: prompt }],
                    stream: true,
                    max_tokens: 300,
                    temperature: 0.7
                })
            });
            
            if (!response.ok) throw new Error("Server error");
            
            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let done = false;
            
            let firstTokenTime = 0;
            let tokensGenerated = 0;
            let lastChartTime = performance.now();
            let tokensSinceLastChart = 0;
            
            let buffer = '';
            while (!done) {
                const { value, done: readerDone } = await reader.read();
                done = readerDone;
                if (value) {
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop(); // keep partial line in buffer
                    for (const line of lines) {
                        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                            try {
                                const data = JSON.parse(line.substring(6));
                                
                                if (data.error) {
                                    throw new Error(data.error.message || "Unknown stream error");
                                }

                                if (data.choices && data.choices.length > 0) {
                                    if (firstTokenTime === 0) {
                                        firstTokenTime = performance.now();
                                        const evalTimeMs = firstTokenTime - startReqTime;
                                        const estimatedPromptTokens = 30; // roughly
                                        const pSpeed = (estimatedPromptTokens / (evalTimeMs / 1000)).toFixed(1);
                                        promptSpeedEl.innerHTML = `${pSpeed} <span class="text-sm text-textMuted font-normal">T/s (est.)</span>`;
                                    }
                                    
                                    // Even if content is empty string, count it as a token if it's a valid delta
                                    if (data.choices[0].delta) {
                                        tokensGenerated++;
                                        tokensSinceLastChart++;
                                    }
                                }
                                
                                // Update chart every ~0.5s
                                const now = performance.now();
                                if (now - lastChartTime > 500 && firstTokenTime > 0) {
                                    const timeDiffSec = (now - lastChartTime) / 1000;
                                    const currentSpeed = tokensSinceLastChart / timeDiffSec;
                                    
                                    const totalTimeSec = (now - firstTokenTime) / 1000;
                                    benchChart.data.labels.push(totalTimeSec.toFixed(1));
                                    benchChart.data.datasets[0].data.push(currentSpeed);
                                    
                                    // Push SwarmUI current telemetry
                                    benchChart.data.datasets[1].data.push(window.currentSwarmIts || 0);
                                    
                                    benchChart.update();
                                    
                                    genSpeedEl.innerHTML = `${currentSpeed.toFixed(1)} <span class="text-sm text-textMuted font-normal">T/s</span>`;
                                    
                                    lastChartTime = now;
                                    tokensSinceLastChart = 0;
                                }
                                
                                // End of stream usage
                                if (data.usage) {
                                    if (data.usage.prompt_tokens && firstTokenTime > 0) {
                                        const pSpeed = (data.usage.prompt_tokens / ((firstTokenTime - startReqTime) / 1000)).toFixed(1);
                                        promptSpeedEl.innerHTML = `${pSpeed} <span class="text-sm text-textMuted font-normal">T/s</span>`;
                                    }
                                }
                            } catch (e) {
                                if (e.message !== "Unexpected end of JSON input" && e.message !== "Unexpected token 'D', \"DONE]\" is not valid JSON") {
                                    console.error("Stream parse error:", e, line);
                                    if (e.message && e.message.includes("Unknown stream error")) {
                                        throw e; // bubble up to outer catch
                                    }
                                }
                            }
                        }
                    }
                }
            }
            
            // Final average
            if (firstTokenTime > 0) {
                const totalGenTimeSec = (performance.now() - firstTokenTime) / 1000;
                const finalAvg = (tokensGenerated / totalGenTimeSec).toFixed(1);
                genSpeedEl.innerHTML = `${finalAvg} <span class="text-sm text-textMuted font-normal">T/s (Avg)</span>`;
            }
            window.showToast("Benchmark Complete!");
            
        } catch (e) {
            window.showToast("Benchmark failed: " + e.message);
        } finally {
            btnRunBenchmark.innerHTML = originalBtnHTML;
            btnRunBenchmark.disabled = false;
            if (window.lucide) window.lucide.createIcons();
        }
    });
}
