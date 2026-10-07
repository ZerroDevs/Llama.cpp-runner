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
        private readonly HttpClient _http = new() { Timeout = TimeSpan.FromMinutes(30) };
        private readonly string _censoredPath = "censored.json";
        private string? _lastKnownSwarmDir;

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

                _lastKnownSwarmDir = Path.GetDirectoryName(launcherPath);

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

        public List<Dictionary<string, object>> ScanSwarmModels(string? customFolder, Dictionary<string, object> config)
        {
            var results = new List<Dictionary<string, object>>();
            var scannedPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            var searchRoots = new List<string>();

            if (!string.IsNullOrWhiteSpace(customFolder) && Directory.Exists(customFolder))
            {
                searchRoots.Add(customFolder);
            }

            string cfgModelsPath = config.TryGetValue("swarm_models_path", out var smp) ? smp?.ToString() ?? "" : "";
            if (!string.IsNullOrWhiteSpace(cfgModelsPath) && Directory.Exists(cfgModelsPath) && !searchRoots.Contains(cfgModelsPath, StringComparer.OrdinalIgnoreCase))
            {
                searchRoots.Add(cfgModelsPath);
            }

            string launcherPath = config.TryGetValue("swarm_launcher_path", out var slp) ? slp?.ToString() ?? "" : "";
            if (!string.IsNullOrWhiteSpace(launcherPath) && File.Exists(launcherPath))
            {
                string swarmDir = Path.GetDirectoryName(launcherPath) ?? "";
                if (!string.IsNullOrWhiteSpace(swarmDir) && Directory.Exists(swarmDir))
                {
                    string mPath = Path.Combine(swarmDir, "Models");
                    if (Directory.Exists(mPath) && !searchRoots.Contains(mPath, StringComparer.OrdinalIgnoreCase))
                    {
                        searchRoots.Add(mPath);
                    }
                }
            }

            string defaultCandidate = @"E:\GE Ui\SwarmUI\Models";
            if (Directory.Exists(defaultCandidate) && !searchRoots.Contains(defaultCandidate, StringComparer.OrdinalIgnoreCase))
            {
                searchRoots.Add(defaultCandidate);
            }

            var allowedExtensions = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                ".gguf", ".safetensors", ".ckpt", ".pt", ".bin"
            };

            foreach (var root in searchRoots)
            {
                try
                {
                    var files = Directory.EnumerateFiles(root, "*.*", SearchOption.AllDirectories)
                        .Where(f => allowedExtensions.Contains(Path.GetExtension(f)))
                        .Select(f => new FileInfo(f))
                        .OrderBy(f => f.Name);

                    foreach (var fi in files)
                    {
                        if (scannedPaths.Contains(fi.FullName)) continue;
                        scannedPaths.Add(fi.FullName);

                        string relPath = Path.GetRelativePath(root, fi.FullName).Replace('\\', '/');
                        double sizeGb = Math.Round(fi.Length / (1024.0 * 1024.0 * 1024.0), 2);
                        string formatSize = sizeGb >= 1.0 ? $"{sizeGb:0.##} GB" : $"{Math.Round(fi.Length / (1024.0 * 1024.0), 1)} MB";

                        bool isDiffusion = fi.FullName.Contains("diffusion_models", StringComparison.OrdinalIgnoreCase) ||
                                           fi.FullName.Contains("Stable-Diffusion", StringComparison.OrdinalIgnoreCase) ||
                                           fi.Name.Contains("qwen", StringComparison.OrdinalIgnoreCase) ||
                                           fi.Name.Contains("sd", StringComparison.OrdinalIgnoreCase) ||
                                           fi.Name.Contains("flux", StringComparison.OrdinalIgnoreCase);

                        results.Add(new Dictionary<string, object>
                        {
                            { "name", fi.Name },
                            { "relative_path", relPath },
                            { "full_path", fi.FullName },
                            { "size_bytes", fi.Length },
                            { "formatted_size", formatSize },
                            { "is_diffusion", isDiffusion }
                        });
                    }
                }
                catch (Exception ex)
                {
                    OnLog?.Invoke($"[SwarmUI] Error scanning models in '{root}': {ex.Message}");
                }
            }

            // Always ensure default model is present in the list
            if (!results.Any(m => m.TryGetValue("name", out var n) && n?.ToString()?.Equals("qwen-image-2.1-UC-Q6_K.gguf", StringComparison.OrdinalIgnoreCase) == true))
            {
                results.Insert(0, new Dictionary<string, object>
                {
                    { "name", "qwen-image-2.1-UC-Q6_K.gguf" },
                    { "relative_path", "diffusion_models/qwen-image-2.1-UC-Q6_K.gguf" },
                    { "full_path", @"E:\GE Ui\SwarmUI\Models\diffusion_models\qwen-image-2.1-UC-Q6_K.gguf" },
                    { "size_bytes", 5876556576L },
                    { "formatted_size", "5.88 GB" },
                    { "is_diffusion", true }
                });
            }

            return results;
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
            int port = 7801,
            string? launcherPath = null)
        {
            string baseUrl = $"http://{(string.IsNullOrWhiteSpace(host) ? "127.0.0.1" : host)}:{port}";
            OnLog?.Invoke($"[SwarmUI] Requesting session from {baseUrl}...");

            string sessionId = "local";
            try
            {
                using var sessCts = new System.Threading.CancellationTokenSource(TimeSpan.FromSeconds(10));
                using var sessContent = new StringContent("{}", System.Text.Encoding.UTF8, "application/json");
                using var sessResp = await _http.PostAsync($"{baseUrl}/API/GetNewSession", sessContent, sessCts.Token);
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

            string effectiveModel = !string.IsNullOrWhiteSpace(modelName) ? modelName.Trim() : "qwen-image-2.1-UC-Q6_K.gguf";

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
                { "height", height },
                { "model", effectiveModel }
            };

            OnLog?.Invoke($"[SwarmUI] Dispatching {width}x{height} image generation request with model '{effectiveModel}' (cfg: {cfgScale}, steps: {steps})...");
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

            string cleanRel = imageVal.TrimStart('/');
            if (cleanRel.StartsWith("ViewImage?image=", StringComparison.OrdinalIgnoreCase))
            {
                cleanRel = cleanRel.Substring("ViewImage?image=".Length);
            }
            cleanRel = Uri.UnescapeDataString(cleanRel);

            string ext = Path.GetExtension(cleanRel);
            if (string.IsNullOrWhiteSpace(ext) || ext.Length > 5)
            {
                ext = ".png";
            }
            string targetFileName = $"swarm_{Guid.NewGuid():N}{ext}";
            string targetFilePath = Path.Combine(cacheDir, targetFileName);

            bool saved = false;

            // Strategy 1: Base64 data URL
            if (imageVal.StartsWith("data:image", StringComparison.OrdinalIgnoreCase) ||
                (!imageVal.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
                 !imageVal.StartsWith("https://", StringComparison.OrdinalIgnoreCase) &&
                 !imageVal.StartsWith("/") &&
                 !imageVal.StartsWith("ViewImage", StringComparison.OrdinalIgnoreCase) &&
                 !imageVal.StartsWith("Output", StringComparison.OrdinalIgnoreCase) &&
                 imageVal.Length > 200 && !imageVal.Contains(' ') && !imageVal.Contains('.')))
            {
                try
                {
                    string b64 = imageVal;
                    int commaIdx = b64.IndexOf(',');
                    if (commaIdx >= 0) b64 = b64[(commaIdx + 1)..];
                    int pad = b64.Length % 4;
                    if (pad != 0) b64 += new string('=', 4 - pad);
                    byte[] imgBytes = Convert.FromBase64String(b64);
                    await File.WriteAllBytesAsync(targetFilePath, imgBytes);
                    saved = true;
                }
                catch (Exception b64Ex)
                {
                    OnLog?.Invoke($"[SwarmUI] Base64 decode notice: {b64Ex.Message}");
                }
            }

            // Strategy 2: Direct local disk lookup
            if (!saved)
            {
                var candidateRoots = new List<string>();
                if (!string.IsNullOrWhiteSpace(launcherPath) && File.Exists(launcherPath))
                {
                    string? lpDir = Path.GetDirectoryName(launcherPath);
                    if (!string.IsNullOrEmpty(lpDir)) candidateRoots.Add(lpDir);
                }
                if (!string.IsNullOrWhiteSpace(_lastKnownSwarmDir) && Directory.Exists(_lastKnownSwarmDir))
                {
                    candidateRoots.Add(_lastKnownSwarmDir);
                }

                foreach (var cRoot in candidateRoots)
                {
                    string candidateDiskPath = Path.Combine(cRoot, cleanRel.Replace('/', Path.DirectorySeparatorChar));
                    if (File.Exists(candidateDiskPath))
                    {
                        try
                        {
                            File.Copy(candidateDiskPath, targetFilePath, true);
                            saved = true;
                            OnLog?.Invoke($"[SwarmUI] Loaded image directly from local storage: {candidateDiskPath}");
                            break;
                        }
                        catch { }
                    }
                }
            }

            // Strategy 3: HTTP download via SwarmUI endpoints
            if (!saved)
            {
                var downloadUrls = new List<string>();
                if (imageVal.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || imageVal.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                {
                    downloadUrls.Add(imageVal);
                }
                else
                {
                    if (imageVal.StartsWith("ViewImage", StringComparison.OrdinalIgnoreCase) || imageVal.StartsWith("/ViewImage", StringComparison.OrdinalIgnoreCase))
                    {
                        downloadUrls.Add($"{baseUrl}/{imageVal.TrimStart('/')}");
                    }
                    else
                    {
                        downloadUrls.Add($"{baseUrl}/ViewImage?image={Uri.EscapeDataString(cleanRel)}");
                        downloadUrls.Add($"{baseUrl}/{Uri.EscapeDataString(cleanRel)}");
                        downloadUrls.Add($"{baseUrl}/{cleanRel}");
                    }
                }

                foreach (var dUrl in downloadUrls)
                {
                    try
                    {
                        using var dlCts = new System.Threading.CancellationTokenSource(TimeSpan.FromSeconds(30));
                        byte[] imgBytes = await _http.GetByteArrayAsync(dUrl, dlCts.Token);
                        if (imgBytes != null && imgBytes.Length > 100)
                        {
                            await File.WriteAllBytesAsync(targetFilePath, imgBytes);
                            saved = true;
                            OnLog?.Invoke($"[SwarmUI] Downloaded image from: {dUrl} ({imgBytes.Length} bytes)");
                            break;
                        }
                    }
                    catch (Exception dlEx)
                    {
                        OnLog?.Invoke($"[SwarmUI] HTTP download attempt notice ({dUrl}): {dlEx.Message}");
                    }
                }
            }

            if (!saved || !File.Exists(targetFilePath))
            {
                throw new Exception($"SwarmUI completed generation but image file could not be retrieved (path: {imageVal}).");
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
