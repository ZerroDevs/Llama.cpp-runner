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

        public async Task<string> GenerateImageAsync(
            string prompt,
            string negativePrompt,
            int width,
            int height,
            double cfgScale,
            int steps,
            string? modelName = null,
            string? host = null,
            int port = 7801)
        {
            string baseUrl = $"http://{(string.IsNullOrWhiteSpace(host) ? "127.0.0.1" : host)}:{port}";
            OnLog?.Invoke($"[SwarmUI] Requesting session from {baseUrl}...");

            string sessionId = "local";
            try
            {
                using var sessContent = new StringContent("{}", System.Text.Encoding.UTF8, "application/json");
                using var sessResp = await _http.PostAsync($"{baseUrl}/API/GetNewSession", sessContent);
                if (sessResp.IsSuccessStatusCode)
                {
                    var sessJson = await sessResp.Content.ReadAsStringAsync();
                    using var doc = JsonDocument.Parse(sessJson);
                    if (doc.RootElement.TryGetProperty("session_id", out var sid)) sessionId = sid.GetString() ?? "local";
                }
            }
            catch (Exception ex)
            {
                OnLog?.Invoke($"[SwarmUI] GetNewSession notice: {ex.Message}, falling back to 'local' session.");
            }

            var payload = new Dictionary<string, object>
            {
                { "session_id", sessionId },
                { "prompt", prompt },
                { "negativeprompt", negativePrompt },
                { "images", 1 },
                { "donotsave", false },
                { "steps", steps },
                { "cfgscale", cfgScale },
                { "width", width },
                { "height", height }
            };
            if (!string.IsNullOrWhiteSpace(modelName))
            {
                payload["model"] = modelName;
            }

            OnLog?.Invoke($"[SwarmUI] Dispatching {width}x{height} image generation request (cfg: {cfgScale}, steps: {steps})...");
            using var genContent = new StringContent(JsonSerializer.Serialize(payload), System.Text.Encoding.UTF8, "application/json");
            using var genResp = await _http.PostAsync($"{baseUrl}/API/GenerateText2Image", genContent);

            if (!genResp.IsSuccessStatusCode)
            {
                string errBody = await genResp.Content.ReadAsStringAsync();
                throw new Exception($"SwarmUI API returned {(int)genResp.StatusCode}: {errBody}");
            }

            string genJson = await genResp.Content.ReadAsStringAsync();
            using var resDoc = JsonDocument.Parse(genJson);
            if (!resDoc.RootElement.TryGetProperty("images", out var imagesArr) || imagesArr.GetArrayLength() == 0)
            {
                throw new Exception("SwarmUI completed generation but returned no image outputs.");
            }

            string imageVal = imagesArr[0].GetString() ?? "";

            string baseAppDir = AppDomain.CurrentDomain.BaseDirectory;
            string cacheDir = Path.Combine(baseAppDir, "ui", "generated_cache");
            if (!Directory.Exists(cacheDir))
            {
                string devDir = Directory.GetParent(baseAppDir)?.Parent?.Parent?.Parent?.FullName ?? "";
                if (!string.IsNullOrEmpty(devDir) && Directory.Exists(Path.Combine(devDir, "ui")))
                {
                    cacheDir = Path.Combine(devDir, "ui", "generated_cache");
                }
                Directory.CreateDirectory(cacheDir);
            }

            string targetFileName = $"swarm_{Guid.NewGuid():N}.jpg";
            string targetFilePath = Path.Combine(cacheDir, targetFileName);

            if (imageVal.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || imageVal.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                byte[] imgBytes = await _http.GetByteArrayAsync(imageVal);
                await File.WriteAllBytesAsync(targetFilePath, imgBytes);
            }
            else if (imageVal.StartsWith("data:image", StringComparison.OrdinalIgnoreCase) || (!imageVal.StartsWith("/") && !imageVal.StartsWith("ViewImage", StringComparison.OrdinalIgnoreCase) && !imageVal.StartsWith("Output", StringComparison.OrdinalIgnoreCase)))
            {
                string b64 = imageVal;
                int commaIdx = b64.IndexOf(',');
                if (commaIdx >= 0) b64 = b64[(commaIdx + 1)..];
                int pad = b64.Length % 4;
                if (pad != 0) b64 += new string('=', 4 - pad);
                byte[] imgBytes = Convert.FromBase64String(b64);
                await File.WriteAllBytesAsync(targetFilePath, imgBytes);
            }
            else
            {
                string cleanRel = imageVal.TrimStart('/');
                string imgUrl = $"{baseUrl}/{cleanRel}";
                byte[] imgBytes = await _http.GetByteArrayAsync(imgUrl);
                await File.WriteAllBytesAsync(targetFilePath, imgBytes);
            }

            OnLog?.Invoke($"[SwarmUI] Successfully generated and cached image: {targetFileName}");
            return targetFilePath;
        }

        public async Task DispatchDiscordWebhookAsync(string imagePath, string posPrompt, string negPrompt, int width, int height, double cfg, int steps, string webhookUrl)
        {
            if (string.IsNullOrWhiteSpace(webhookUrl) || !File.Exists(imagePath)) return;
            try
            {
                using var form = new MultipartFormDataContent();
                byte[] bytes = await File.ReadAllBytesAsync(imagePath);
                using var fileContent = new ByteArrayContent(bytes);
                string ext = Path.GetExtension(imagePath).ToLower();
                fileContent.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(ext is ".jpg" or ".jpeg" ? "image/jpeg" : "image/png");
                form.Add(fileContent, "file", Path.GetFileName(imagePath));

                string pos = string.IsNullOrWhiteSpace(posPrompt) ? "N/A" : posPrompt;
                string neg = string.IsNullOrWhiteSpace(negPrompt) ? "N/A" : negPrompt;
                if (pos.Length + neg.Length > 5000)
                {
                    if (pos.Length > 4000) pos = pos[..4000] + "...";
                    if (neg.Length > 950) neg = neg[..950] + "...";
                }

                var fields = new List<object>
                {
                    new { name = "Positive Prompt", value = pos.Length > 1024 ? pos[..1020] + "..." : pos },
                    new { name = "Negative Prompt", value = neg.Length > 1024 ? neg[..1020] + "..." : neg },
                    new { name = "Resolution", value = $"{width}x{height}", @inline = true },
                    new { name = "CFG Scale", value = cfg.ToString(), @inline = true },
                    new { name = "Steps", value = steps.ToString(), @inline = true }
                };

                var payload = new
                {
                    content = "**New Image Generated!**",
                    embeds = new[]
                    {
                        new
                        {
                            title = "Image Metadata",
                            color = 5814783,
                            image = new { url = $"attachment://{Path.GetFileName(imagePath)}" },
                            fields = fields
                        }
                    }
                };
                form.Add(new StringContent(JsonSerializer.Serialize(payload), System.Text.Encoding.UTF8, "application/json"), "payload_json");

                var resp = await _http.PostAsync(webhookUrl, form);
                if (resp.IsSuccessStatusCode)
                {
                    OnLog?.Invoke("[INFO] Successfully sent generated image to Discord Webhook.");
                }
                else
                {
                    OnLog?.Invoke($"[ERR] Discord Webhook Error: {(int)resp.StatusCode}");
                }
            }
            catch (Exception ex)
            {
                OnLog?.Invoke($"[ERR] Discord Webhook Exception: {ex.Message}");
            }
        }
    }
}
