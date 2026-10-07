using System;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using System.Collections.Generic;
using Microsoft.Web.WebView2.Core;
using System.Diagnostics;

namespace LlamaServerControl.Backend
{
    public class NativeBridge
    {
        private readonly ConfigManager _config;
        private readonly ProcessManager _process;
        private readonly SwarmManager _swarm;
        private readonly HardwareMonitor _hardware;
        private readonly HubManager _hub;
        private readonly StreamingProxy? _proxy;
        private CoreWebView2? _coreWebView;

        public NativeBridge(ConfigManager config, ProcessManager process, SwarmManager swarm, HardwareMonitor hardware, HubManager hub, StreamingProxy? proxy = null)
        {
            _config = config;
            _process = process;
            _swarm = swarm;
            _hardware = hardware;
            _hub = hub;
            _proxy = proxy;

            _process.OnLog += (line) =>
            {
                string src = "llama";
                if (line.StartsWith("[Proxy", StringComparison.OrdinalIgnoreCase) ||
                    line.StartsWith("[Auto-Sleep", StringComparison.OrdinalIgnoreCase) ||
                    line.StartsWith("[Hub", StringComparison.OrdinalIgnoreCase) ||
                    line.StartsWith("[ACTION", StringComparison.OrdinalIgnoreCase))
                {
                    src = "other";
                }
                EmitEvent("log", new { text = line, source = src });
            };
            _swarm.OnLog += (line) => EmitEvent("log", new { text = line, source = "swarm" });
            _process.OnExited += () => EmitEvent("server_exited", new { running = false });
        }

        public void SetWebView(CoreWebView2 webView)
        {
            _coreWebView = webView;
        }

        private void EmitEvent(string eventName, object data)
        {
            if (_coreWebView == null) return;
            try
            {
                var payload = new { @event = eventName, data };
                string json = JsonSerializer.Serialize(payload);

                var app = System.Windows.Application.Current;
                if (app != null && app.Dispatcher != null && !app.Dispatcher.CheckAccess())
                {
                    app.Dispatcher.InvokeAsync(() =>
                    {
                        try { _coreWebView.PostWebMessageAsJson(json); } catch { }
                    });
                }
                else
                {
                    _coreWebView.PostWebMessageAsJson(json);
                }
            }
            catch { }
        }

        public async Task<string> HandleMessageAsync(string messageJson)
        {
            try
            {
                using var doc = JsonDocument.Parse(messageJson);
                var root = doc.RootElement;
                string id = root.TryGetProperty("id", out var idProp) ? idProp.GetString() ?? "" : "";
                string method = root.TryGetProperty("method", out var mProp) ? mProp.GetString() ?? "" : "";
                var args = root.TryGetProperty("args", out var aProp) ? aProp : default;

                object? result = null;

                switch (method)
                {
                    case "get_config":
                        result = _config.GetConfig();
                        break;

                    case "save_config":
                        var cfgDict = JsonSerializer.Deserialize<Dictionary<string, object>>(args.GetRawText());
                        if (cfgDict != null)
                        {
                            _config.SaveConfig(cfgDict);
                            if (cfgDict.TryGetValue("port", out var pObj) && int.TryParse(pObj?.ToString(), out int newPort))
                            {
                                _proxy?.CheckPortUpdate(newPort);
                            }
                        }
                        result = new { status = "success" };
                        break;

                    case "start_server":
                        var startCfg = JsonSerializer.Deserialize<Dictionary<string, object>>(args.GetRawText());
                        result = _process.StartServer(startCfg ?? _config.GetConfig());
                        break;

                    case "stop_server":
                        result = _process.StopServer();
                        break;

                    case "check_status":
                        result = _process.CheckStatus();
                        break;

                    case "flush_kv_cache":
                        result = await _process.FlushKvCacheAsync(_config.GetConfig());
                        break;

                    case "get_slot_telemetry":
                        result = await _process.GetSlotTelemetryAsync(_config.GetConfig());
                        break;

                    case "get_hardware_data":
                        result = _hardware.GetHardwareData();
                        break;

                    case "scan_models":
                        string scanDir = args.GetString() ?? "";
                        result = ModelScanner.ScanDirectory(scanDir);
                        break;

                    case "select_file":
                        result = SelectFileNative(args.GetString() ?? "");
                        break;

                    case "select_directory":
                        result = SelectDirectoryNative();
                        break;

                    case "start_swarm":
                        var swarmCfg = JsonSerializer.Deserialize<Dictionary<string, object>>(args.GetRawText());
                        result = _swarm.StartSwarm(swarmCfg ?? _config.GetConfig());
                        break;

                    case "stop_swarm":
                        result = _swarm.StopSwarm();
                        break;

                    case "get_swarm_status":
                        result = _swarm.CheckStatus();
                        break;

                    case "scan_swarm_models":
                        string customDir = args.ValueKind == JsonValueKind.String ? args.GetString() ?? "" : "";
                        result = _swarm.ScanSwarmModels(customDir, _config.GetConfig());
                        break;

                    case "get_swarm_images":
                        int proxyPort = _proxy?.ActivePort ?? (int.TryParse(_config.GetConfig().GetValueOrDefault("port", 8080)?.ToString(), out int p) ? p : 8080);
                        result = _swarm.GetSwarmImages(_config.GetConfig(), proxyPort);
                        break;

                    case "get_image_metadata":
                        string imgPath = args.GetString() ?? "";
                        var metaDict = PngMetadataReader.ExtractMetadata(imgPath);
                        result = new { status = "success", metadata = metaDict };
                        break;

                    case "copy_image_to_clipboard":
                        string copyPath = args.GetString() ?? "";
                        if (File.Exists(copyPath))
                        {
                            try
                            {
                                System.Windows.Application.Current.Dispatcher.Invoke(() =>
                                {
                                    var fileCollection = new System.Collections.Specialized.StringCollection { copyPath };
                                    System.Windows.Clipboard.SetFileDropList(fileCollection);
                                });
                                result = new { status = "success" };
                            }
                            catch (Exception ex)
                            {
                                result = new { status = "error", message = ex.Message };
                            }
                        }
                        else
                        {
                            result = new { status = "error", message = "File not found" };
                        }
                        break;

                    case "delete_image":
                        string singleImg = args.GetString() ?? "";
                        int sDeleted = SwarmManager.DeleteImages([singleImg]);
                        result = new { status = sDeleted > 0 ? "success" : "error", deleted = sDeleted };
                        break;

                    case "censor_images":
                        var censorList = JsonSerializer.Deserialize<List<string>>(args.GetRawText());
                        if (censorList != null) _swarm.CensorImages(censorList);
                        result = new { status = "success" };
                        break;

                    case "uncensor_images":
                        var uncensorList = JsonSerializer.Deserialize<List<string>>(args.GetRawText());
                        if (uncensorList != null) _swarm.UncensorImages(uncensorList);
                        result = new { status = "success" };
                        break;

                    case "delete_images":
                        var delList = JsonSerializer.Deserialize<List<string>>(args.GetRawText());
                        int deleted = delList != null ? SwarmManager.DeleteImages(delList) : 0;
                        result = new { status = "success", deleted };
                        break;

                    case "send_to_webhook":
                        var hookList = JsonSerializer.Deserialize<List<string>>(args.GetRawText());
                        string hookUrl = _config.GetConfig().GetValueOrDefault("discord_webhook", "")?.ToString() ?? "";
                        result = await _swarm.SendToWebhookAsync(hookList ?? [], hookUrl);
                        break;

                    case "open_image_folder":
                        string targetPath = args.GetString() ?? "";
                        if (File.Exists(targetPath))
                        {
                            Process.Start("explorer.exe", $"/select,\"{targetPath}\"");
                            result = new { status = "success" };
                        }
                        else
                        {
                            result = new { status = "error" };
                        }
                        break;

                    case "open_url":
                        string urlToOpen = args.GetString() ?? "";
                        if (!string.IsNullOrWhiteSpace(urlToOpen) && (urlToOpen.StartsWith("http://") || urlToOpen.StartsWith("https://")))
                        {
                            Process.Start(new ProcessStartInfo { FileName = urlToOpen, UseShellExecute = true });
                            result = new { status = "success" };
                        }
                        else
                        {
                            result = new { status = "error", message = "Invalid URL" };
                        }
                        break;

                    case "load_chats":
                        string chatsPath = Path.Combine(Path.GetDirectoryName(_config.ConfigPath) ?? AppDomain.CurrentDomain.BaseDirectory, "chats.json");
                        if (File.Exists(chatsPath))
                        {
                            string chatsJson = await File.ReadAllTextAsync(chatsPath);
                            result = new { status = "success", data = chatsJson };
                        }
                        else
                        {
                            result = new { status = "success", data = "[]" };
                        }
                        break;

                    case "save_chats":
                        string saveChatsTarget = Path.Combine(Path.GetDirectoryName(_config.ConfigPath) ?? AppDomain.CurrentDomain.BaseDirectory, "chats.json");
                        string saveContent = args.ValueKind == JsonValueKind.String ? args.GetString() ?? "[]" : args.GetRawText();
                        await SanitizeAndSaveChatsAsync(saveChatsTarget, saveContent);
                        result = new { status = "success" };
                        break;

                    case "save_chat_attachment":
                        result = await SaveChatAttachmentAsync(args);
                        break;

                    case "search_hub":
                        string hubQuery = args.GetProperty("query").GetString() ?? "";
                        bool uncensored = args.TryGetProperty("uncensored", out var unProp) && unProp.GetBoolean();
                        int limit = args.TryGetProperty("limit", out var limProp) ? limProp.GetInt32() : 12;
                        result = await _hub.SearchModelsAsync(hubQuery, uncensored, limit);
                        break;

                    case "list_hub_files":
                        string repoId = args.GetString() ?? "";
                        result = await _hub.ListFilesAsync(repoId);
                        break;

                    case "download_hub_file":
                        string dRepo = args.GetProperty("repoId").GetString() ?? "";
                        string dFile = args.GetProperty("filename").GetString() ?? "";
                        string dDest = args.GetProperty("destDir").GetString() ?? "";
                        result = await _hub.StartDownloadAsync(dRepo, dFile, dDest);
                        break;

                    case "get_download_progress":
                        result = _hub.DownloadProgress;
                        break;

                    case "calculate_vram":
                        result = EstimateVram(args);
                        break;

                    default:
                        result = new { status = "error", message = $"Unknown method {method}" };
                        break;
                }

                return JsonSerializer.Serialize(new { id, result });
            }
            catch (Exception ex)
            {
                return JsonSerializer.Serialize(new { error = ex.Message });
            }
        }

        private static string? SelectFileNative(string filter)
        {
            var dlg = new Microsoft.Win32.OpenFileDialog();
            if (filter == "model")
            {
                dlg.Filter = "GGUF Models (*.gguf)|*.gguf|All Files (*.*)|*.*";
            }
            else if (filter == "exe")
            {
                dlg.Filter = "Executable Files (*.exe;*.bat;*.cmd)|*.exe;*.bat;*.cmd|All Files (*.*)|*.*";
            }
            return dlg.ShowDialog() == true ? dlg.FileName : null;
        }

        private static string? SelectDirectoryNative()
        {
            var dlg = new Microsoft.Win32.OpenFolderDialog();
            return dlg.ShowDialog() == true ? dlg.FolderName : null;
        }

        private static object EstimateVram(JsonElement args)
        {
            try
            {
                string mPath = args.GetProperty("model_path").GetString() ?? "";
                int ctx = args.GetProperty("context_size").GetInt32();
                int batch = args.GetProperty("batch_size").GetInt32();

                double modelGb = 0;
                if (File.Exists(mPath))
                {
                    var fi = new FileInfo(mPath);
                    long length = fi.Length;
                    if (length == 0)
                    {
                        try
                        {
                            using var fs = new FileStream(mPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                            length = fs.Length;
                        }
                        catch { }
                    }
                    modelGb = Math.Round(length / (1024.0 * 1024.0 * 1024.0), 2);
                }

                // KV Cache formula: 2 * layers * n_embd * ctx * bytes
                double kvCacheGb = Math.Round((ctx / 4096.0) * 0.75, 2);
                double totalEstimated = Math.Round(modelGb + kvCacheGb + 0.4, 2);

                return new
                {
                    status = "success",
                    model_vram_gb = modelGb,
                    kv_cache_vram_gb = kvCacheGb,
                    total_vram_gb = totalEstimated,
                    recommended_layers = 99
                };
            }
            catch (Exception ex)
            {
                return new { status = "error", message = ex.Message };
            }
        }

        private async Task<object> SaveChatAttachmentAsync(JsonElement attArgs)
        {
            try
            {
                string b64 = attArgs.GetProperty("data").GetString() ?? "";
                string origName = attArgs.TryGetProperty("filename", out var fnProp) ? fnProp.GetString() ?? "" : "";
                if (string.IsNullOrWhiteSpace(origName)) origName = $"attachment_{DateTime.UtcNow.Ticks}.png";

                string pureB64 = b64;
                int commaIdx = pureB64.IndexOf(',');
                if (commaIdx >= 0 && pureB64.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
                {
                    pureB64 = pureB64.Substring(commaIdx + 1);
                }

                byte[] imgBytes = Convert.FromBase64String(pureB64);
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                string parentDir = Directory.GetParent(baseDir)?.Parent?.Parent?.Parent?.FullName ?? "";
                string targetDir = !string.IsNullOrEmpty(parentDir) && Directory.Exists(Path.Combine(parentDir, "ui"))
                    ? Path.Combine(parentDir, "ui", "generated_cache", "attachments")
                    : Path.Combine(baseDir, "ui", "generated_cache", "attachments");

                Directory.CreateDirectory(targetDir);

                string ext = Path.GetExtension(origName);
                if (string.IsNullOrWhiteSpace(ext)) ext = ".png";
                string cleanFileName = $"{DateTime.UtcNow:yyyyMMdd_HHmmss}_{Guid.NewGuid().ToString("N")[..8]}{ext}";
                string fullPath = Path.Combine(targetDir, cleanFileName);
                await File.WriteAllBytesAsync(fullPath, imgBytes);

                int activeProxyPort = _proxy?.ActivePort ?? (int.TryParse(_config.GetConfig().GetValueOrDefault("port", 8080)?.ToString(), out int p) ? p : 8080);
                string localUrl = $"http://127.0.0.1:{activeProxyPort}/local_image?path={Uri.EscapeDataString(fullPath)}";

                return new
                {
                    status = "success",
                    file_path = fullPath,
                    file_name = cleanFileName,
                    url = localUrl
                };
            }
            catch (Exception ex)
            {
                return new { status = "error", message = ex.Message };
            }
        }

        private async Task SanitizeAndSaveChatsAsync(string saveChatsTarget, string rawJson)
        {
            try
            {
                if (!rawJson.Contains("data:image/", StringComparison.OrdinalIgnoreCase))
                {
                    await File.WriteAllTextAsync(saveChatsTarget, rawJson);
                    return;
                }

                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                string parentDir = Directory.GetParent(baseDir)?.Parent?.Parent?.Parent?.FullName ?? "";
                string targetDir = !string.IsNullOrEmpty(parentDir) && Directory.Exists(Path.Combine(parentDir, "ui"))
                    ? Path.Combine(parentDir, "ui", "generated_cache", "attachments")
                    : Path.Combine(baseDir, "ui", "generated_cache", "attachments");

                Directory.CreateDirectory(targetDir);
                int activeProxyPort = _proxy?.ActivePort ?? (int.TryParse(_config.GetConfig().GetValueOrDefault("port", 8080)?.ToString(), out int p) ? p : 8080);

                string pattern = @"\""dataUrl\""\s*:\s*\""data:image/([a-zA-Z0-9]+);base64,([^\""]+)\""";
                string sanitized = System.Text.RegularExpressions.Regex.Replace(rawJson, pattern, (match) =>
                {
                    try
                    {
                        string ext = "." + match.Groups[1].Value.ToLowerInvariant();
                        if (ext == ".jpeg") ext = ".jpg";
                        string b64 = match.Groups[2].Value;
                        byte[] bytes = Convert.FromBase64String(b64);
                        string fileName = $"{DateTime.UtcNow:yyyyMMdd_HHmmss}_{Guid.NewGuid().ToString("N")[..8]}{ext}";
                        string fullPath = Path.Combine(targetDir, fileName);
                        File.WriteAllBytes(fullPath, bytes);

                        string localUrl = $"http://127.0.0.1:{activeProxyPort}/local_image?path={Uri.EscapeDataString(fullPath)}";
                        return $"\"url\":\"{localUrl}\",\"path\":\"{fullPath.Replace("\\", "\\\\")}\"";
                    }
                    catch
                    {
                        return match.Value;
                    }
                });

                await File.WriteAllTextAsync(saveChatsTarget, sanitized);
            }
            catch
            {
                await File.WriteAllTextAsync(saveChatsTarget, rawJson);
            }
        }
    }
}
