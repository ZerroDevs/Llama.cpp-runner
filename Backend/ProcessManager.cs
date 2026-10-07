using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using System.Collections.Generic;

namespace LlamaServerControl.Backend
{
    public class ProcessManager
    {
        private Process? _process;
        private readonly System.Threading.Lock _lock = new();
        private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(5) };

        public event Action<string>? OnLog;
        public event Action? OnExited;

        public bool CheckStatus()
        {
            lock (_lock)
            {
                if (_process == null) return false;
                try
                {
                    return !_process.HasExited;
                }
                catch
                {
                    return false;
                }
            }
        }

        public Dictionary<string, object> StartServer(Dictionary<string, object> config)
        {
            lock (_lock)
            {
                if (CheckStatus())
                {
                    return new Dictionary<string, object>
                    {
                        { "status", "error" },
                        { "message", "Server is already running." }
                    };
                }

                string binaryPath = "";
                if (config.TryGetValue("server_path", out var sp) && !string.IsNullOrWhiteSpace(sp?.ToString()))
                    binaryPath = sp.ToString()!.Trim('"', ' ');
                else if (config.TryGetValue("server_binary", out var sb) && !string.IsNullOrWhiteSpace(sb?.ToString()))
                    binaryPath = sb.ToString()!.Trim('"', ' ');

                string modelPath = "";
                if (config.TryGetValue("model_path", out var mp) && !string.IsNullOrWhiteSpace(mp?.ToString()))
                    modelPath = mp.ToString()!.Trim('"', ' ');

                if (string.IsNullOrWhiteSpace(binaryPath) || !File.Exists(binaryPath))
                {
                    return new Dictionary<string, object>
                    {
                        { "status", "error" },
                        { "message", $"llama-server.exe binary not found at '{binaryPath}'" }
                    };
                }

                if (string.IsNullOrWhiteSpace(modelPath) || !File.Exists(modelPath))
                {
                    return new Dictionary<string, object>
                    {
                        { "status", "error" },
                        { "message", $"Model file not found at '{modelPath}'" }
                    };
                }

                int ctx = int.TryParse(config.GetValueOrDefault("context_size", 4096)?.ToString(), out int c) ? c : 4096;
                int ngl = int.TryParse(config.GetValueOrDefault("gpu_layers", 99)?.ToString(), out int l) ? l : 99;
                int threads = int.TryParse(config.GetValueOrDefault("threads", config.GetValueOrDefault("cpu_threads", 8))?.ToString(), out int t) ? t : 8;
                int batch = int.TryParse(config.GetValueOrDefault("batch_size", 512)?.ToString(), out int b) ? b : 512;
                int ubatch = int.TryParse(config.GetValueOrDefault("ubatch_size", 512)?.ToString(), out int ub) ? ub : 512;
                int publicPort = int.TryParse(config.GetValueOrDefault("port", 8080)?.ToString(), out int p) ? p : 8080;
                int internalPort = publicPort + 1;
                string host = config.GetValueOrDefault("host", "127.0.0.1")?.ToString() ?? "127.0.0.1";

                // Construct CLI arguments (llama-server binds internally to 127.0.0.1 on port + 1)
                var args = new List<string>
                {
                    $"-m \"{modelPath}\"",
                    $"-c {ctx}",
                    $"-ngl {ngl}",
                    $"-t {threads}",
                    $"-b {batch}",
                    $"-ub {ubatch}",
                    $"--port {internalPort}",
                    $"--host 127.0.0.1"
                };

                // Flash Attention: llama-server requires explicit 'on' or 'off'
                bool isFa = false;
                if (config.TryGetValue("flash_attention", out var fa))
                {
                    if (fa is bool fb) isFa = fb;
                    else if (fa is JsonElement je && je.ValueKind == JsonValueKind.True) isFa = true;
                    else if (fa?.ToString()?.ToLower() == "true") isFa = true;
                }
                if (isFa)
                {
                    args.Add("-fa on");
                }

                // Cache Types: standard llama-server flags are -ctk and -ctv
                string ctk = config.GetValueOrDefault("cache_type_k", config.GetValueOrDefault("kv_cache_type_k", "f16"))?.ToString() ?? "f16";
                if (!string.IsNullOrWhiteSpace(ctk))
                {
                    args.Add($"-ctk {ctk}");
                }

                string ctv = config.GetValueOrDefault("cache_type_v", config.GetValueOrDefault("kv_cache_type_v", "f16"))?.ToString() ?? "f16";
                if (!string.IsNullOrWhiteSpace(ctv))
                {
                    args.Add($"-ctv {ctv}");
                }

                // Vision Projector
                string mmproj = config.GetValueOrDefault("mmproj_path", config.GetValueOrDefault("vision_projector", config.GetValueOrDefault("vision_model", "")))?.ToString()?.Trim('"', ' ') ?? "";
                if (!string.IsNullOrWhiteSpace(mmproj) && File.Exists(mmproj))
                {
                    args.Add($"--mmproj \"{mmproj}\"");
                }

                // Draft Model
                string draft = config.GetValueOrDefault("draft_model", "")?.ToString()?.Trim('"', ' ') ?? "";
                if (!string.IsNullOrWhiteSpace(draft) && File.Exists(draft))
                {
                    args.Add($"--model-draft \"{draft}\"");
                }

                // LoRA Adapters
                string lora = config.GetValueOrDefault("lora_adapters", config.GetValueOrDefault("lora_model", ""))?.ToString()?.Trim('"', ' ') ?? "";
                if (!string.IsNullOrWhiteSpace(lora) && File.Exists(lora))
                {
                    args.Add($"--lora \"{lora}\"");
                }

                // Custom extra args
                string custom = config.GetValueOrDefault("custom_args", "")?.ToString() ?? "";
                if (!string.IsNullOrWhiteSpace(custom))
                {
                    args.Add(custom.Trim());
                }

                string argumentsString = string.Join(" ", args);

                try
                {
                    var psi = new ProcessStartInfo
                    {
                        FileName = binaryPath,
                        Arguments = argumentsString,
                        WorkingDirectory = Path.GetDirectoryName(binaryPath) ?? "",
                        UseShellExecute = false,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true,
                        CreateNoWindow = true
                    };

                    _process = new Process { StartInfo = psi, EnableRaisingEvents = true };

                    _process.OutputDataReceived += (s, e) =>
                    {
                        if (!string.IsNullOrEmpty(e.Data)) OnLog?.Invoke(e.Data);
                    };

                    _process.ErrorDataReceived += (s, e) =>
                    {
                        if (!string.IsNullOrEmpty(e.Data)) OnLog?.Invoke(e.Data);
                    };

                    _process.Exited += (s, e) =>
                    {
                        OnLog?.Invoke($"[INFO] llama-server process terminated (ExitCode: {_process?.ExitCode ?? -1}).");
                        OnExited?.Invoke();
                    };

                    _process.Start();
                    _process.BeginOutputReadLine();
                    _process.BeginErrorReadLine();

                    OnLog?.Invoke($"[INFO] Started llama-server (PID: {_process.Id}) with arguments: {argumentsString}");

                    return new Dictionary<string, object>
                    {
                        { "status", "success" },
                        { "pid", _process.Id }
                    };
                }
                catch (Exception ex)
                {
                    return new Dictionary<string, object>
                    {
                        { "status", "error" },
                        { "message", ex.Message }
                    };
                }
            }
        }

        public Dictionary<string, object> StopServer()
        {
            lock (_lock)
            {
                if (_process == null)
                {
                    return new Dictionary<string, object> { { "status", "success" } };
                }

                try
                {
                    if (!_process.HasExited)
                    {
                        _process.Kill(entireProcessTree: true);
                        _process.WaitForExit(800);
                    }
                }
                catch { }
                finally
                {
                    _process?.Dispose();
                    _process = null;
                }

                return new Dictionary<string, object> { { "status", "success" } };
            }
        }

        public void Log(string msg) => OnLog?.Invoke(msg);

        public static int GetInternalPort(Dictionary<string, object> config)
        {
            int publicPort = int.TryParse(config.GetValueOrDefault("port", 8080)?.ToString(), out int p) ? p : 8080;
            return publicPort + 1;
        }

        public async Task<Dictionary<string, object>> FlushKvCacheAsync(Dictionary<string, object> config)
        {
            if (_process == null || _process.HasExited)
            {
                OnLog?.Invoke("[ACTION] Flush KV Cache: Server is offline, cache is already 0 tokens.");
                return new Dictionary<string, object>
                {
                    { "status", "success" },
                    { "message", "LLM Server is offline; no active KV cache in memory." }
                };
            }

            int internalPort = GetInternalPort(config);

            try
            {
                int erasedCount = 0;
                bool erasedAny = false;

                // 1. Try to query /slots to find all active slots and erase each one
                try
                {
                    using var getCts = new CancellationTokenSource(2000);
                    var slotsResp = await _http.GetAsync($"http://127.0.0.1:{internalPort}/slots", getCts.Token);
                    if (slotsResp.IsSuccessStatusCode)
                    {
                        var slotsJson = await slotsResp.Content.ReadAsStringAsync(getCts.Token);
                        using var doc = JsonDocument.Parse(slotsJson);
                        if (doc.RootElement.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var slot in doc.RootElement.EnumerateArray())
                            {
                                int slotId = 0;
                                if (slot.TryGetProperty("id", out var idProp))
                                {
                                    slotId = idProp.GetInt32();
                                }
                                var eraseSlotResp = await _http.PostAsync($"http://127.0.0.1:{internalPort}/slots/{slotId}?action=erase", null);
                                if (eraseSlotResp.IsSuccessStatusCode)
                                {
                                    erasedAny = true;
                                    erasedCount++;
                                }
                            }
                        }
                    }
                }
                catch { }

                // 2. If slots enumeration didn't find/erase any, directly call slot 0 (standard single-slot mode)
                if (!erasedAny)
                {
                    var slot0Resp = await _http.PostAsync($"http://127.0.0.1:{internalPort}/slots/0?action=erase", null);
                    if (slot0Resp.IsSuccessStatusCode)
                    {
                        erasedAny = true;
                        erasedCount = 1;
                    }
                    else
                    {
                        // Fallback attempt: older /slots?action=erase
                        var generalResp = await _http.PostAsync($"http://127.0.0.1:{internalPort}/slots?action=erase", null);
                        if (generalResp.IsSuccessStatusCode)
                        {
                            erasedAny = true;
                            erasedCount = 1;
                        }
                    }
                }

                if (erasedAny)
                {
                    OnLog?.Invoke($"[ACTION] Flush KV Cache: {erasedCount} slot(s) wiped to 0 tokens successfully.");
                    return new Dictionary<string, object>
                    {
                        { "status", "success" },
                        { "message", $"KV Cache & active slots reset to 0 tokens ({erasedCount} slot{(erasedCount > 1 ? "s" : "")} cleared)." }
                    };
                }

                return new Dictionary<string, object>
                {
                    { "status", "warning" },
                    { "message", "Server did not acknowledge slot reset. Active slot may already be empty." }
                };
            }
            catch (Exception ex)
            {
                return new Dictionary<string, object>
                {
                    { "status", "error" },
                    { "message", ex.Message }
                };
            }
        }

        public async Task<Dictionary<string, object>> GetSlotTelemetryAsync(Dictionary<string, object> config)
        {
            if (_process == null || _process.HasExited)
            {
                return new Dictionary<string, object>
                {
                    { "online", false },
                    { "cached_tokens", 0 },
                    { "context_limit", 0 }
                };
            }

            int internalPort = GetInternalPort(config);
            try
            {
                using var cts = new CancellationTokenSource(1500);
                var resp = await _http.GetAsync($"http://127.0.0.1:{internalPort}/slots", cts.Token);
                if (resp.IsSuccessStatusCode)
                {
                    string json = await resp.Content.ReadAsStringAsync(cts.Token);
                    using var doc = JsonDocument.Parse(json);
                    int totalCached = 0;
                    int nCtx = 0;
                    if (doc.RootElement.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var slot in doc.RootElement.EnumerateArray())
                        {
                            if (slot.TryGetProperty("n_past", out var nPastProp))
                                totalCached += nPastProp.GetInt32();
                            else if (slot.TryGetProperty("n_cache", out var nCacheProp))
                                totalCached += nCacheProp.GetInt32();

                            if (slot.TryGetProperty("n_ctx", out var ctxProp))
                                nCtx = Math.Max(nCtx, ctxProp.GetInt32());
                        }
                    }

                    return new Dictionary<string, object>
                    {
                        { "online", true },
                        { "cached_tokens", totalCached },
                        { "context_limit", nCtx }
                    };
                }
            }
            catch { }

            return new Dictionary<string, object>
            {
                { "online", true },
                { "cached_tokens", 0 },
                { "context_limit", 0 }
            };
        }
    }
}
