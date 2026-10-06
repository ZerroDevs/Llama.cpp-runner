using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace LlamaServerControl.Backend
{
    public class SwarmManager
    {
        private Process? _process;
        private readonly System.Threading.Lock _lock = new();
        private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(15) };
        private readonly string _censoredPath = "censored.json";

        public event Action<string>? OnLog;

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

        public Dictionary<string, object> StartSwarm(Dictionary<string, object> config)
        {
            lock (_lock)
            {
                if (CheckStatus())
                {
                    return new Dictionary<string, object>
                    {
                        { "status", "error" },
                        { "message", "SwarmUI is already running." }
                    };
                }

                string launcherPath = config.TryGetValue("swarm_launcher_path", out var slp) ? slp?.ToString() ?? "" : "";
                if (string.IsNullOrWhiteSpace(launcherPath) || !File.Exists(launcherPath))
                {
                    return new Dictionary<string, object>
                    {
                        { "status", "error" },
                        { "message", "SwarmUI launcher path not found or invalid." }
                    };
                }

                try
                {
                    bool openBrowser = false;
                    if (config.TryGetValue("swarm_open_browser", out var obObj))
                    {
                        if (obObj is bool ob) openBrowser = ob;
                        else if (obObj is JsonElement je && (je.ValueKind == JsonValueKind.True || je.ValueKind == JsonValueKind.False)) openBrowser = je.GetBoolean();
                        else if (bool.TryParse(obObj?.ToString(), out var parsedBool)) openBrowser = parsedBool;
                    }

                    string extraArgs = config.TryGetValue("swarm_extra_args", out var ea) ? ea?.ToString() ?? "" : "";
                    var argsList = new List<string>();

                    if (!openBrowser && !extraArgs.Contains("--launch_mode", StringComparison.OrdinalIgnoreCase))
                    {
                        argsList.Add("--launch_mode none");
                    }

                    if (!string.IsNullOrWhiteSpace(extraArgs))
                    {
                        argsList.Add(extraArgs.Trim());
                    }

                    var psi = new ProcessStartInfo
                    {
                        FileName = launcherPath,
                        Arguments = string.Join(" ", argsList),
                        WorkingDirectory = Path.GetDirectoryName(launcherPath) ?? "",
                        UseShellExecute = false,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true,
                        CreateNoWindow = true
                    };

                    _process = new Process { StartInfo = psi, EnableRaisingEvents = true };

                    _process.OutputDataReceived += (s, e) =>
                    {
                        if (!string.IsNullOrEmpty(e.Data)) OnLog?.Invoke($"[SwarmUI] {e.Data}");
                    };

                    _process.ErrorDataReceived += (s, e) =>
                    {
                        if (!string.IsNullOrEmpty(e.Data)) OnLog?.Invoke($"[SwarmUI ERR] {e.Data}");
                    };

                    _process.Exited += (s, e) =>
                    {
                        OnLog?.Invoke("[INFO] SwarmUI process terminated.");
                    };

                    _process.Start();
                    _process.BeginOutputReadLine();
                    _process.BeginErrorReadLine();

                    OnLog?.Invoke($"[INFO] Started SwarmUI (PID: {_process.Id})");

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

        public Dictionary<string, object> StopSwarm()
        {
            lock (_lock)
            {
                if (_process == null) return new Dictionary<string, object> { { "status", "success" } };

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

        public List<Dictionary<string, object>> GetSwarmImages(Dictionary<string, object> config, int port)
        {
            var result = new List<Dictionary<string, object>>();
            string launcherPath = config.TryGetValue("swarm_launcher_path", out var slp) ? slp?.ToString() ?? "" : "";
            if (string.IsNullOrWhiteSpace(launcherPath) || !File.Exists(launcherPath)) return result;

            string swarmDir = Path.GetDirectoryName(launcherPath) ?? "";
            string outputDir = Path.Combine(swarmDir, "Output");
            if (!Directory.Exists(outputDir)) return result;

            try
            {
                var files = Directory.EnumerateFiles(outputDir, "*.*", SearchOption.AllDirectories)
                    .Where(s => s.EndsWith(".png", StringComparison.OrdinalIgnoreCase) ||
                                s.EndsWith(".jpg", StringComparison.OrdinalIgnoreCase) ||
                                s.EndsWith(".jpeg", StringComparison.OrdinalIgnoreCase) ||
                                s.EndsWith(".webp", StringComparison.OrdinalIgnoreCase))
                    .Select(f => new FileInfo(f))
                    .OrderByDescending(f => f.LastWriteTimeUtc)
                    .Take(500)
                    .ToList();

                var censored = GetCensoredList();

                foreach (var fi in files)
                {
                    string folder = Path.GetFileName(Path.GetDirectoryName(fi.FullName) ?? "");
                    string encoded = Uri.EscapeDataString(fi.FullName);

                    result.Add(new Dictionary<string, object>
                    {
                        { "path", fi.FullName },
                        { "filename", fi.Name },
                        { "folder", folder },
                        { "size_kb", Math.Round(fi.Length / 1024.0, 1) },
                        { "modified", fi.LastWriteTime.ToString("yyyy-MM-dd HH:mm") },
                        { "is_censored", censored.Contains(fi.FullName) },
                        { "url", $"http://127.0.0.1:{port}/local_image?path={encoded}" }
                    });
                }
            }
            catch { }

            return result;
        }

        private HashSet<string> GetCensoredList()
        {
            if (File.Exists(_censoredPath))
            {
                try
                {
                    string json = File.ReadAllText(_censoredPath);
                    var list = JsonSerializer.Deserialize<List<string>>(json);
                    if (list != null) return [.. list];
                }
                catch { }
            }
            return [];
        }

        private void SaveCensoredList(HashSet<string> set)
        {
            try
            {
                string json = JsonSerializer.Serialize(set.ToList());
                File.WriteAllText(_censoredPath, json);
            }
            catch { }
        }

        public void CensorImages(List<string> paths)
        {
            var set = GetCensoredList();
            foreach (var p in paths) set.Add(p);
            SaveCensoredList(set);
        }

        public void UncensorImages(List<string> paths)
        {
            var set = GetCensoredList();
            foreach (var p in paths) set.Remove(p);
            SaveCensoredList(set);
        }

        public static int DeleteImages(List<string> paths)
        {
            int deleted = 0;
            foreach (var p in paths)
            {
                try
                {
                    if (File.Exists(p))
                    {
                        string ext = Path.GetExtension(p).ToLowerInvariant();
                        if (ext == ".png" || ext == ".jpg" || ext == ".jpeg" || ext == ".webp")
                        {
                            File.Delete(p);
                            deleted++;
                        }
                    }
                }
                catch { }
            }
            return deleted;
        }

        public Task<bool> SendToWebhookAsync(List<string> paths, string webhookUrl)
        {
            if (string.IsNullOrWhiteSpace(webhookUrl)) return Task.FromResult(false);

            _ = Task.Run(async () =>
            {
                foreach (var path in paths)
                {
                    try
                    {
                        if (File.Exists(path))
                        {
                            using var form = new MultipartFormDataContent();
                            byte[] bytes = await File.ReadAllBytesAsync(path);
                            using var fileContent = new ByteArrayContent(bytes);
                            string ext = Path.GetExtension(path).ToLower();
                            fileContent.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(ext == ".jpg" || ext == ".jpeg" ? "image/jpeg" : "image/png");
                            form.Add(fileContent, "file", Path.GetFileName(path));

                            var payload = new
                            {
                                content = "**SwarmUI Gallery Export**",
                                embeds = new[]
                                {
                                    new
                                    {
                                        title = Path.GetFileName(path),
                                        color = 5814783,
                                        image = new { url = $"attachment://{Path.GetFileName(path)}" }
                                    }
                                }
                            };
                            form.Add(new StringContent(JsonSerializer.Serialize(payload)), "payload_json");

                            await _http.PostAsync(webhookUrl, form);
                            OnLog?.Invoke($"[INFO] Webhook dispatched: {Path.GetFileName(path)}");
                        }
                    }
                    catch (Exception ex)
                    {
                        OnLog?.Invoke($"[ERR] Webhook error: {ex.Message}");
                    }
                }
            });

            return Task.FromResult(true);
        }
    }
}
