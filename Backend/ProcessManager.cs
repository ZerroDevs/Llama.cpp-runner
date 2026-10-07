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
            int internalPort = GetInternalPort(config);
            string url = $"http://127.0.0.1:{internalPort}/slots?action=erase";

            try
            {
                var response = await _http.PostAsync(url, null);
                if (response.IsSuccessStatusCode)
                {
                    OnLog?.Invoke("[ACTION] Flush KV Cache: Slots wiped to 0 tokens successfully.");
                    return new Dictionary<string, object>
                    {
                        { "status", "success" },
                        { "message", "KV Cache & active slots reset to 0 tokens." }
                    };
                }
                return new Dictionary<string, object>
                {
                    { "status", "error" },
                    { "message", $"Server responded with code {(int)response.StatusCode}" }
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
}
