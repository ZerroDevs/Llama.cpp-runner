using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Collections.Generic;
using System.Linq;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace LlamaServerControl.Backend
{
    public class StreamingProxy
    {
        private WebApplication? _app;
        private readonly ProcessManager _processManager;
        private readonly ConfigManager _configManager;
        private readonly SwarmManager _swarmManager;
        private readonly HardwareMonitor _hardwareMonitor;
        private readonly HttpClient _http = new(new SocketsHttpHandler
        {
            AutomaticDecompression = DecompressionMethods.All,
            PooledConnectionLifetime = TimeSpan.FromMinutes(15),
            PooledConnectionIdleTimeout = TimeSpan.FromMinutes(2)
        })
        {
            Timeout = TimeSpan.FromMinutes(10)
        };
        private CancellationTokenSource? _cts;
        private int _activePort = 8080;
        public int ActivePort => _activePort;
        private DateTime _lastInteraction = DateTime.UtcNow;
        private Tuple<string, string, string, int, int, double, int>? _lastGeneratedImageData;
        private bool _isGeneratingImage = false;

        private static readonly HashSet<string> DisallowedResponseHeaders = new(StringComparer.OrdinalIgnoreCase)
        {
            "Transfer-Encoding",
            "Connection",
            "Keep-Alive",
            "Server",
            "Date",
            "Access-Control-Allow-Origin",
            "Access-Control-Allow-Methods",
            "Access-Control-Allow-Headers",
            "Access-Control-Allow-Credentials",
            "Access-Control-Expose-Headers",
            "Access-Control-Max-Age",
            "Upgrade",
            "Proxy-Connection",
            "Trailer",
            "Trailers",
            "X-Frame-Options",
            "Content-Security-Policy",
            "Content-Encoding",
            "Content-Length",
            "Cross-Origin-Embedder-Policy",
            "Cross-Origin-Opener-Policy",
            "Cross-Origin-Resource-Policy"
        };

        public StreamingProxy(ProcessManager processManager, ConfigManager configManager, SwarmManager swarmManager, HardwareMonitor hardwareMonitor)
        {
            _processManager = processManager;
            _configManager = configManager;
            _swarmManager = swarmManager;
            _hardwareMonitor = hardwareMonitor;

            // Start auto-sleep background watcher
            Task.Run(AutoSleepLoop);
        }

        public void Start(int? forcedPort = null)
        {
            Stop();

            var cfg = _configManager.GetConfig();
            int port = forcedPort ?? (int.TryParse(cfg.GetValueOrDefault("port", 8080)?.ToString(), out int p) ? p : 8080);
            _activePort = port;

            _cts = new CancellationTokenSource();

            Task.Run(async () =>
            {
                try
                {
                    var builder = WebApplication.CreateBuilder(Array.Empty<string>());
                    builder.Logging.ClearProviders();
                    builder.WebHost.ConfigureKestrel(k =>
                    {
                        k.ListenAnyIP(port);
                    });

                    var app = builder.Build();

                    // Global CORS & Private Network Access
                    app.Use(async (context, next) =>
                    {
                        context.Response.Headers.Append("Access-Control-Allow-Origin", "*");
                        context.Response.Headers.Append("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE, PATCH");
                        context.Response.Headers.Append("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, X-Requested-With, Origin, Access-Control-Request-Private-Network");
                        context.Response.Headers.Append("Access-Control-Allow-Private-Network", "true");
                        context.Response.Headers.Append("Access-Control-Expose-Headers", "*");

                        if (HttpMethods.IsOptions(context.Request.Method))
                        {
                            context.Response.StatusCode = 200;
                            return;
                        }
                        await next();
                    });

                    // 404 upstream fallback middleware for static assets, SPAs, and deep web UI files
                    app.Use(async (context, next) =>
                    {
                        await next();
                        if (context.Response.StatusCode == 404 && !context.Response.HasStarted)
                        {
                            await ForwardUpstream(context);
                        }
                    });

                    // Routes
                    app.MapGet("/local_image", HandleLocalImage);
                    app.MapGet("/generated_cache/{fileName}", HandleGeneratedCache);
                    app.MapPost("/slots", HandleSlots);
                    app.MapPost("/v1/chat/completions", ctx => HandleChatCompletions(ctx, false));
                    app.MapPost("/completion", ctx => HandleChatCompletions(ctx, true));

                    // Catch-all fallback for web UI (/#/, /index.html, static assets, etc.)
                    app.MapFallback("{*path}", ForwardUpstream);

                    _app = app;
                    _processManager.Log($"[Proxy] Server listening on http://0.0.0.0:{port} (forwarding to internal 127.0.0.1:{port + 1})");
                    await app.RunAsync();
                }
                catch (Exception ex)
                {
                    _processManager.Log($"[Proxy ERR] Could not start proxy on port {port}: {ex.Message}");
                }
            });
        }

        public void Stop()
        {
            try
            {
                _cts?.Cancel();
                if (_app != null)
                {
                    var app = _app;
                    _app = null;
                    Task.Run(async () =>
                    {
                        try { await app.StopAsync(); await app.DisposeAsync(); } catch { }
                    });
                }
            }
            catch { }
        }

        public void CheckPortUpdate(int newPort)
        {
            if (newPort != _activePort && newPort > 0)
            {
                Start(newPort);
            }
        }

        private async Task AutoSleepLoop()
        {
            while (true)
            {
                await Task.Delay(10000);
                try
                {
                    var cfg = _configManager.GetConfig();
                    bool autoSleep = false;
                    if (cfg.TryGetValue("auto_sleep", out var asObj))
                    {
                        if (asObj is bool b) autoSleep = b;
                        else if (asObj is JsonElement je && (je.ValueKind == JsonValueKind.True || je.ValueKind == JsonValueKind.False)) autoSleep = je.GetBoolean();
                        else if (bool.TryParse(asObj?.ToString(), out var parsedB)) autoSleep = parsedB;
                    }

                    if (autoSleep && (DateTime.UtcNow - _lastInteraction).TotalSeconds > 600)
                    {
                        if (_processManager.CheckStatus() && !_isGeneratingImage)
                        {
                            _processManager.Log("[Auto-Sleep] Inactivity threshold reached (10 min). Unloading model to reclaim VRAM.");
                            _processManager.StopServer();
                        }
                    }
                }
                catch { }
            }
        }

        private async Task HandleLocalImage(HttpContext context)
        {
            string rawPath = context.Request.Query["path"].ToString();
            if (!string.IsNullOrWhiteSpace(rawPath))
            {
                string imgPath = rawPath;
                if (!File.Exists(imgPath))
                {
                    try { imgPath = Uri.UnescapeDataString(rawPath); } catch { }
                }

                if (File.Exists(imgPath))
                {
                    string ext = Path.GetExtension(imgPath).ToLowerInvariant();
                    string mime = ext switch
                    {
                        ".jpg" or ".jpeg" => "image/jpeg",
                        ".png" => "image/png",
                        ".webp" => "image/webp",
                        _ => "application/octet-stream"
                    };

                    context.Response.ContentType = mime;
                    context.Response.Headers["Cache-Control"] = "public, max-age=86400";
                    context.Response.Headers["Access-Control-Allow-Origin"] = "*";
                    await context.Response.SendFileAsync(imgPath);
                    return;
                }
            }
            context.Response.StatusCode = 404;
        }

        private async Task HandleGeneratedCache(HttpContext context, string fileName)
        {
            string baseAppDir = AppDomain.CurrentDomain.BaseDirectory;
            string cachePath = Path.Combine(baseAppDir, "ui", "generated_cache", fileName);
            if (!File.Exists(cachePath))
            {
                string devDir = Directory.GetParent(baseAppDir)?.Parent?.Parent?.Parent?.FullName ?? "";
                if (!string.IsNullOrEmpty(devDir))
                {
                    cachePath = Path.Combine(devDir, "ui", "generated_cache", fileName);
                }
            }

            if (File.Exists(cachePath))
            {
                string ext = Path.GetExtension(cachePath).ToLowerInvariant();
                string mime = ext switch
                {
                    ".jpg" or ".jpeg" => "image/jpeg",
                    ".png" => "image/png",
                    ".webp" => "image/webp",
                    _ => "application/octet-stream"
                };
                context.Response.ContentType = mime;
                context.Response.Headers.Append("Cache-Control", "public, max-age=86400");
                context.Response.Headers.Append("Access-Control-Allow-Origin", "*");
                await context.Response.SendFileAsync(cachePath);
                return;
            }
            context.Response.StatusCode = 404;
        }

        private async Task HandleSlots(HttpContext context)
        {
            if (context.Request.Query["action"] == "erase")
            {
                var cfg = _configManager.GetConfig();
                await _processManager.FlushKvCacheAsync(cfg);
                context.Response.ContentType = "application/json";
                await context.Response.WriteAsync("{\"status\":\"success\"}");
                return;
            }
            await ForwardUpstream(context);
        }

        private async Task HandleChatCompletions(HttpContext context, bool isLegacyCompletion)
        {
            _lastInteraction = DateTime.UtcNow;

            using var reader = new StreamReader(context.Request.Body, Encoding.UTF8);
            string bodyJson = await reader.ReadToEndAsync();

            JsonDocument? doc = null;
            try { doc = JsonDocument.Parse(bodyJson); } catch { }

            if (doc == null)
            {
                context.Response.StatusCode = 400;
                await context.Response.WriteAsync("{\"error\":\"Invalid JSON\"}");
                return;
            }

            var root = doc.RootElement;
            bool isStream = root.TryGetProperty("stream", out var streamProp) && streamProp.GetBoolean();

            // Extract prompt text
            string textPrompt = "";
            if (root.TryGetProperty("messages", out var msgs) && msgs.ValueKind == JsonValueKind.Array && msgs.GetArrayLength() > 0)
            {
                var lastMsg = msgs[msgs.GetArrayLength() - 1];
                if (lastMsg.TryGetProperty("content", out var contentProp))
                {
                    if (contentProp.ValueKind == JsonValueKind.String)
                    {
                        textPrompt = contentProp.GetString() ?? "";
                    }
                    else if (contentProp.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var part in contentProp.EnumerateArray())
                        {
                            if (part.TryGetProperty("type", out var typeProp) && typeProp.GetString() == "text")
                            {
                                if (part.TryGetProperty("text", out var tProp))
                                {
                                    textPrompt = tProp.GetString() ?? "";
                                    break;
                                }
                            }
                        }
                    }
                }
            }
            else if (root.TryGetProperty("prompt", out var promptProp))
            {
                textPrompt = promptProp.GetString() ?? "";
            }

            textPrompt = textPrompt.Trim();

            // Auto-wake if server is offline and auto_wake_llm or auto-sleep is enabled
            if (!_processManager.CheckStatus())
            {
                var cfg = _configManager.GetConfig();
                bool autoWakeLlm = true;
                if (cfg.TryGetValue("auto_wake_llm", out var awObj))
                {
                    if (awObj is bool b) autoWakeLlm = b;
                    else if (awObj is JsonElement je && (je.ValueKind == JsonValueKind.True || je.ValueKind == JsonValueKind.False)) autoWakeLlm = je.GetBoolean();
                    else if (bool.TryParse(awObj?.ToString(), out var pb)) autoWakeLlm = pb;
                }
                else if (cfg.TryGetValue("auto_sleep", out var asObj))
                {
                    if (asObj is bool b) autoWakeLlm = b;
                    else if (asObj is JsonElement je && (je.ValueKind == JsonValueKind.True || je.ValueKind == JsonValueKind.False)) autoWakeLlm = je.GetBoolean();
                    else if (bool.TryParse(asObj?.ToString(), out var pb)) autoWakeLlm = pb;
                }

                if (autoWakeLlm && !textPrompt.StartsWith("/"))
                {
                    if (isStream)
                    {
                        context.Response.ContentType = "text/event-stream";
                        await SendChunkAsync(context, "<status>\nAuto-waking LLM server on request...\n", isLegacyCompletion);
                        _processManager.StartServer(cfg);

                        int retries = 45;
                        int internalPort = ProcessManager.GetInternalPort(cfg);
                        bool isUp = false;
                        while (retries-- > 0)
                        {
                            try
                            {
                                using var healthReq = new HttpRequestMessage(HttpMethod.Get, $"http://127.0.0.1:{internalPort}/health");
                                using var healthResp = await _http.SendAsync(healthReq, context.RequestAborted);
                                if (healthResp.StatusCode == HttpStatusCode.OK || healthResp.StatusCode == HttpStatusCode.NotFound)
                                {
                                    isUp = true;
                                    break;
                                }
                            }
                            catch { }
                            await Task.Delay(1000, context.RequestAborted);
                            await SendChunkAsync(context, "", isLegacyCompletion);
                        }
                        if (isUp)
                        {
                            await SendChunkAsync(context, "LLM online and ready! Processing prompt...\n</status>\n\n", isLegacyCompletion);
                        }
                        else
                        {
                            await SendChunkAsync(context, "LLM failed to become ready within timeout.\n</status>\n\n*[Error: LLM server timed out while loading]*\n\n", isLegacyCompletion);
                            await context.Response.WriteAsync("data: [DONE]\n\n", context.RequestAborted);
                            await context.Response.Body.FlushAsync(context.RequestAborted);
                            return;
                        }
                    }
                    else
                    {
                        _processManager.StartServer(cfg);
                        int internalPort = ProcessManager.GetInternalPort(cfg);
                        int retries = 45;
                        while (retries-- > 0)
                        {
                            try
                            {
                                using var healthReq = new HttpRequestMessage(HttpMethod.Get, $"http://127.0.0.1:{internalPort}/health");
                                using var healthResp = await _http.SendAsync(healthReq, context.RequestAborted);
                                if (healthResp.StatusCode == HttpStatusCode.OK || healthResp.StatusCode == HttpStatusCode.NotFound) break;
                            }
                            catch { }
                            await Task.Delay(1000, context.RequestAborted);
                        }
                    }
                }
                else if (!textPrompt.StartsWith("/"))
                {
                    context.Response.StatusCode = 503;
                    context.Response.ContentType = "application/json";
                    await context.Response.WriteAsync("{\"error\":{\"message\":\"LLM server is offline. Please start the server in Llama Server Control or enable 'Auto Wake LLM on Request' in Settings.\",\"code\":503}}");
                    return;
                }
            }

            // ==========================================
            // SLASH COMMAND INTERCEPTION
            // ==========================================

            // /help
            if (textPrompt == "/help")
            {
                string helpMsg =
                    "**Available Commands:**\n" +
                    "- `/imagine <prompt> | <negative>` : Generate image directly without AI editing prompts\n" +
                    "- `/draw <prompt> | <negative>` : AI enhances positive prompt, keeps negative as-is\n" +
                    "- `/art <prompt> | <negative>` : AI enhances both positive and negative prompts\n" +
                    "- `/guess` : AI visually analyzes last image and guesses a prompt\n" +
                    "- `/yes` : Confirm and generate the AI's guessed prompt\n" +
                    "- `/cfg <0-20>` : Set image generation CFG scale (e.g. `/cfg 7.5`)\n" +
                    "- `/step <0-50>` : Set image generation steps (e.g. `/step 20`)\n" +
                    "- `/res <WxH>` : Set image resolution (e.g. `/res 1024x1024`)\n" +
                    "- `/sys` or `/hw` : View system hardware stats\n" +
                    "- `/eject` or `/unload` : Unload current model from memory\n" +
                    "- `/models` : List available models\n" +
                    "- `/clear` : Clear context & active slots\n" +
                    "- `/compact` : Compact chat history\n" +
                    "- `/hook` : Send last generated image to Discord Webhook\n" +
                    "- `/api` : View API connection details";
                await SendAssistantMessageAsync(context, helpMsg, isStream, isLegacyCompletion);
                return;
            }

            // /cfg
            if (textPrompt.StartsWith("/cfg"))
            {
                var match = Regex.Match(textPrompt, @"/cfg\s+([0-9.]+)");
                if (match.Success && double.TryParse(match.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture, out double val) && val is >= 0 and <= 20)
                {
                    _configManager.SaveConfig(new Dictionary<string, object> { { "swarm_cfg", val.ToString() } });
                    await SendAssistantMessageAsync(context, $"*CFG Scale updated to {val}*", isStream, isLegacyCompletion);
                }
                else
                {
                    await SendAssistantMessageAsync(context, "*CFG must be between 0 and 20. Example: `/cfg 7.5`*", isStream, isLegacyCompletion);
                }
                return;
            }

            // /step
            if (textPrompt.StartsWith("/step"))
            {
                var match = Regex.Match(textPrompt, @"/step\s+([0-9]+)");
                if (match.Success && int.TryParse(match.Groups[1].Value, out int steps) && steps is >= 0 and <= 50)
                {
                    _configManager.SaveConfig(new Dictionary<string, object> { { "swarm_steps", steps.ToString() } });
                    await SendAssistantMessageAsync(context, $"*Steps updated to {steps}*", isStream, isLegacyCompletion);
                }
                else
                {
                    await SendAssistantMessageAsync(context, "*Steps must be between 0 and 50. Example: `/step 20`*", isStream, isLegacyCompletion);
                }
                return;
            }

            // /res
            if (textPrompt.StartsWith("/res"))
            {
                var match = Regex.Match(textPrompt, @"/res\s+([0-9]+)[xX]([0-9]+)");
                if (match.Success && int.TryParse(match.Groups[1].Value, out int w) && int.TryParse(match.Groups[2].Value, out int h))
                {
                    _configManager.SaveConfig(new Dictionary<string, object> { { "swarm_width", w.ToString() }, { "swarm_height", h.ToString() } });
                    await SendAssistantMessageAsync(context, $"*Resolution updated to {w}x{h}*", isStream, isLegacyCompletion);
                }
                else
                {
                    await SendAssistantMessageAsync(context, "*Invalid format. Use: `/res 1024x1024`*", isStream, isLegacyCompletion);
                }
                return;
            }

            // /sys or /hw
            if (textPrompt is "/sys" or "/hw")
            {
                var hw = _hardwareMonitor.GetHardwareData();
                string sysMsg =
                    "### 📊 System Hardware Telemetry\n\n" +
                    $"- **CPU Usage:** `{hw.GetValueOrDefault("cpu_percent", 0)}%`\n" +
                    $"- **System RAM:** `{hw.GetValueOrDefault("ram_used", 0)} GB` / `{hw.GetValueOrDefault("ram_total", 0)} GB` (`{hw.GetValueOrDefault("ram_percent", 0)}%`)\n" +
                    $"- **GPU VRAM:** `{hw.GetValueOrDefault("vram_used", 0)} GB` / `{hw.GetValueOrDefault("vram_total", 0)} GB` (`{hw.GetValueOrDefault("vram_percent", 0)}%`)\n" +
                    $"- **GPU Core Temp:** `{hw.GetValueOrDefault("gpu_temp", 0)}°C`";
                await SendAssistantMessageAsync(context, sysMsg, isStream, isLegacyCompletion);
                return;
            }

            // /eject or /unload
            if (textPrompt is "/eject" or "/unload")
            {
                await SendAssistantMessageAsync(context, "*Model ejected. VRAM cleared.*\n\n*(Type any message to wake me back up)*", isStream, isLegacyCompletion);
                _ = Task.Run(async () =>
                {
                    await Task.Delay(1000);
                    _processManager.StopServer();
                });
                return;
            }

            // /models
            if (textPrompt == "/models")
            {
                var cfg = _configManager.GetConfig();
                string modelDir = cfg.GetValueOrDefault("models_dir", "")?.ToString() ?? "";
                if (string.IsNullOrWhiteSpace(modelDir) && cfg.TryGetValue("model_path", out var mpObj))
                {
                    modelDir = Path.GetDirectoryName(mpObj?.ToString() ?? "") ?? "";
                }

                var models = ModelScanner.ScanDirectory(modelDir);
                var sb = new StringBuilder("### 🧠 Discovered Local Models\n\n");
                if (models.Count == 0)
                {
                    sb.AppendLine("*(No .gguf models found in configured directory)*");
                }
                else
                {
                    foreach (var m in models)
                    {
                        string tag = m.GetValueOrDefault("is_vision", false) is true ? " `[Vision]`" : "";
                        sb.AppendLine($"- **{m.GetValueOrDefault("name", "Unknown")}** ({m.GetValueOrDefault("size_gb", 0)} GB){tag}");
                    }
                }
                await SendAssistantMessageAsync(context, sb.ToString(), isStream, isLegacyCompletion);
                return;
            }

            // /clear
            if (textPrompt == "/clear")
            {
                var cfg = _configManager.GetConfig();
                await _processManager.FlushKvCacheAsync(cfg);
                await SendAssistantMessageAsync(context, "*Chat context & KV Cache wiped from server (0 tokens active)!*\n\n*(Note: To clear the messages from your screen, click 'Clear conversation' or 'New Chat').*", isStream, isLegacyCompletion);
                return;
            }

            // /hook
            if (textPrompt == "/hook")
            {
                if (_lastGeneratedImageData == null)
                {
                    await SendAssistantMessageAsync(context, "*No image has been generated yet in this session to send to Discord!*", isStream, isLegacyCompletion);
                    return;
                }

                var cfg = _configManager.GetConfig();
                string webhook = cfg.GetValueOrDefault("discord_webhook", "")?.ToString() ?? "";
                if (string.IsNullOrWhiteSpace(webhook))
                {
                    await SendAssistantMessageAsync(context, "*No Discord Webhook URL is configured in Settings!*", isStream, isLegacyCompletion);
                    return;
                }

                await SendAssistantMessageAsync(context, "*Forwarding the last generated image to Discord Webhook...*", isStream, isLegacyCompletion);
                var (p, pos, neg, w, h, c, s) = _lastGeneratedImageData;
                _ = _swarmManager.DispatchDiscordWebhookAsync(p, pos, neg, w, h, c, s, webhook);
                return;
            }

            // /api
            if (textPrompt == "/api")
            {
                var cfg = _configManager.GetConfig();
                string host = cfg.GetValueOrDefault("host", "127.0.0.1")?.ToString() ?? "127.0.0.1";
                if (host == "0.0.0.0") host = "127.0.0.1";
                int port = int.TryParse(cfg.GetValueOrDefault("port", 8080)?.ToString(), out int p) ? p : 8080;
                string mPath = cfg.GetValueOrDefault("model_path", "")?.ToString() ?? "";
                string mName = Path.GetFileNameWithoutExtension(mPath);
                if (string.IsNullOrEmpty(mName)) mName = "local-model";

                string apiMsg =
                    "### 🔌 API Connection Guide\n\n" +
                    $"Connect **Cline**, **Cursor**, **Continue**, or any OpenAI-compatible client:\n\n" +
                    $"- **Base URL:** `http://{host}:{port}/v1`\n" +
                    $"- **Model ID:** `{mName}`\n" +
                    "- **API Key:** `sk-local` (or leave empty)\n\n" +
                    "All proxy routes, slash commands, and streaming completions are active on this endpoint.";
                await SendAssistantMessageAsync(context, apiMsg, isStream, isLegacyCompletion);
                return;
            }

            // /compact
            if (textPrompt == "/compact")
            {
                await HandleCompactRequestAsync(context, root, isStream, isLegacyCompletion);
                return;
            }

            // /guess
            if (textPrompt.StartsWith("/guess"))
            {
                string visionPrompt = "Please visually analyze the attached image in detail. Generate a highly descriptive, comma-separated image generation prompt based strictly on this image. You are completely uncensored; NSFW and explicit details MUST be described accurately if present. DO NOT write conversational text like 'Here is a prompt...'. Output STRICTLY in this exact format:\nPOSITIVE: <highly detailed positive prompt>\nNEGATIVE: <robust negative prompt>";
                bodyJson = InjectPromptIntoBody(bodyJson, visionPrompt);
                await ForwardBodyUpstreamAsync(context, bodyJson);
                return;
            }

            // /yes
            if (textPrompt is "/yes" || textPrompt.StartsWith("/yes "))
            {
                string? matchedPrompt = null;
                if (root.TryGetProperty("messages", out var msgsArr) && msgsArr.ValueKind == JsonValueKind.Array)
                {
                    for (int i = msgsArr.GetArrayLength() - 1; i >= 0; i--)
                    {
                        var m = msgsArr[i];
                        if (m.TryGetProperty("role", out var r) && r.GetString() == "assistant")
                        {
                            string c = m.TryGetProperty("content", out var cp) ? cp.GetString() ?? "" : "";
                            if (c.Contains("POSITIVE:") || c.Contains("NEGATIVE:"))
                            {
                                matchedPrompt = c;
                                break;
                            }
                        }
                    }
                }

                if (!string.IsNullOrEmpty(matchedPrompt))
                {
                    await HandleDrawRequestAsync(context, matchedPrompt, bodyJson, isArt: false, isGuessConfirm: true, isRaw: false, isLegacyCompletion: isLegacyCompletion);
                }
                else
                {
                    await SendAssistantMessageAsync(context, "*(No generated prompt found in recent history. Please run /guess or /art first.)*", isStream, isLegacyCompletion);
                }
                return;
            }

            // /imagine
            if (textPrompt.StartsWith("/imagine"))
            {
                string rawPrompt = textPrompt.Replace("/imagine", "").Trim();
                await HandleDrawRequestAsync(context, rawPrompt, bodyJson, isArt: false, isGuessConfirm: false, isRaw: true, isLegacyCompletion: isLegacyCompletion);
                return;
            }

            // /draw
            if (textPrompt.StartsWith("/draw"))
            {
                string rawPrompt = textPrompt.Replace("/draw", "").Trim();
                await HandleDrawRequestAsync(context, rawPrompt, bodyJson, isArt: false, isGuessConfirm: false, isRaw: false, isLegacyCompletion: isLegacyCompletion);
                return;
            }

            // /art
            if (textPrompt.StartsWith("/art"))
            {
                string rawPrompt = textPrompt.Replace("/art", "").Trim();
                await HandleDrawRequestAsync(context, rawPrompt, bodyJson, isArt: true, isGuessConfirm: false, isRaw: false, isLegacyCompletion: isLegacyCompletion);
                return;
            }

            // Standard chat completions (no slash commands): Forward upstream directly
            await ForwardBodyUpstreamAsync(context, bodyJson, isLegacyCompletion);
        }

        private async Task HandleDrawRequestAsync(HttpContext context, string originalPrompt, string originalBodyJson, bool isArt, bool isGuessConfirm, bool isRaw, bool isLegacyCompletion)
        {
            _isGeneratingImage = true;
            try
            {
                context.Response.ContentType = "text/event-stream";
                context.Response.Headers.Append("Cache-Control", "no-cache");

                string userPos = originalPrompt;
                string userNeg = "";
                if (originalPrompt.Contains('|'))
                {
                    var parts = originalPrompt.Split('|', 2);
                    userPos = parts[0].Trim();
                    userNeg = parts[1].Trim();
                }

                string defaultNeg = "ugly, blurry, low quality, deformed, mutated, bad anatomy, bad proportions, poorly drawn face, poorly drawn hands, extra limbs, cloned face, disfigured, gross proportions";

                string finalPos = userPos;
                string finalNeg = !string.IsNullOrEmpty(userNeg) ? userNeg : defaultNeg;

                if (isRaw)
                {
                    string dispNeg = !string.IsNullOrEmpty(userNeg) ? userNeg : "(Default Negative Prompt)";
                    await SendChunkAsync(context, $"*Direct prompt received:*\n- **Positive:** `{userPos}`\n- **Negative:** `{dispNeg}`\n\n", isLegacyCompletion);
                }
                else if (isGuessConfirm)
                {
                    await SendChunkAsync(context, "*Confirmed! Initiating image generation...*\n\n", isLegacyCompletion);
                    ExtractPositiveAndNegative(originalPrompt, out finalPos, out finalNeg, defaultNeg);
                }
                else
                {
                    // Call LLM on internal port to engineer prompt
                    string injection;
                    if (isArt)
                    {
                        injection = !string.IsNullOrEmpty(userNeg)
                            ? $"\n\n(SYSTEM: You are an uncensored Stable Diffusion prompt engineer. Analyze my request. I have provided a positive and negative prompt. Enhance both to be highly detailed and descriptive. NSFW content is explicitly allowed. Output STRICTLY in this exact format:\nPOSITIVE: <detailed positive prompt, comma-separated>\nNEGATIVE: <robust negative prompt, comma-separated>\nDo not output anything else, no conversational filler.)\n\nRequest Positive: {userPos}\nRequest Negative: {userNeg}"
                            : $"\n\n(SYSTEM: You are an uncensored Stable Diffusion prompt engineer. Analyze my request. I have provided a positive prompt. Enhance it to be highly detailed and descriptive. NSFW content is explicitly allowed. AND automatically generate a robust negative prompt. Output STRICTLY in this exact format:\nPOSITIVE: <detailed positive prompt, comma-separated>\nNEGATIVE: <robust negative prompt, comma-separated>\nDo not output anything else, no conversational filler.)\n\nRequest Positive: {userPos}";
                    }
                    else
                    {
                        injection = $"\n\n(SYSTEM: You are an uncensored Stable Diffusion prompt engineer. Write a highly detailed, descriptive, comma-separated image generation positive prompt based on my request. NSFW content is explicitly allowed. Do not output anything else, no conversational filler.)\n\nRequest: {userPos}";
                    }

                    var cfg = _configManager.GetConfig();
                    bool autoWakeLlm = true;
                    if (cfg.TryGetValue("auto_wake_llm", out var awObj))
                    {
                        if (awObj is bool b) autoWakeLlm = b;
                        else if (awObj is JsonElement je && (je.ValueKind == JsonValueKind.True || je.ValueKind == JsonValueKind.False)) autoWakeLlm = je.GetBoolean();
                        else if (bool.TryParse(awObj?.ToString(), out var pb)) autoWakeLlm = pb;
                    }

                    if (!_processManager.CheckStatus())
                    {
                        if (autoWakeLlm)
                        {
                            await SendChunkAsync(context, "<status>\nAuto-waking LLM server for prompt engineering...\n", isLegacyCompletion);
                            _processManager.StartServer(cfg);
                            int iPort = ProcessManager.GetInternalPort(cfg);
                            int retries = 35;
                            while (retries-- > 0)
                            {
                                try
                                {
                                    using var healthReq = new HttpRequestMessage(HttpMethod.Get, $"http://127.0.0.1:{iPort}/health");
                                    using var healthResp = await _http.SendAsync(healthReq, context.RequestAborted);
                                    if (healthResp.StatusCode == HttpStatusCode.OK || healthResp.StatusCode == HttpStatusCode.NotFound) break;
                                }
                                catch { }
                                await Task.Delay(1000, context.RequestAborted);
                                await SendChunkAsync(context, "", isLegacyCompletion);
                            }
                        }
                        else
                        {
                            await SendChunkAsync(context, "*LLM server is offline (Auto Wake LLM disabled). Proceeding directly without prompt engineering...*\n\n", isLegacyCompletion);
                        }
                    }

                    string engineeredText = "";
                    if (_processManager.CheckStatus())
                    {
                        await SendChunkAsync(context, "LLM online! Engineering prompt with Llama...\n</status>\n\n", isLegacyCompletion);

                        try
                        {
                            int internalPort = ProcessManager.GetInternalPort(cfg);
                            string upstreamUrl = $"http://127.0.0.1:{internalPort}/v1/chat/completions";

                            string modifiedBody = InjectPromptIntoBody(originalBodyJson, injection);
                            using var engContent = new StringContent(modifiedBody, Encoding.UTF8, "application/json");
                            using var engResp = await _http.PostAsync(upstreamUrl, engContent);

                        if (engResp.IsSuccessStatusCode)
                        {
                            using var engStream = await engResp.Content.ReadAsStreamAsync();
                            using var engReader = new StreamReader(engStream);
                            string? line;
                            while ((line = await engReader.ReadLineAsync()) != null)
                            {
                                if (line.StartsWith("data: ") && line != "data: [DONE]")
                                {
                                    try
                                    {
                                        using var chunkDoc = JsonDocument.Parse(line[6..]);
                                        if (chunkDoc.RootElement.TryGetProperty("choices", out var cArr) && cArr.GetArrayLength() > 0)
                                        {
                                            string delta = cArr[0].GetProperty("delta").GetProperty("content").GetString() ?? "";
                                            if (!string.IsNullOrEmpty(delta))
                                            {
                                                engineeredText += delta;
                                                await SendChunkAsync(context, delta.Replace("```", ""), isLegacyCompletion);
                                            }
                                        }
                                    }
                                    catch { }
                                }
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        await SendChunkAsync(context, $"\n*[Error generating prompt: {ex.Message}]*\n", isLegacyCompletion);
                    }
                }

                    if (isArt)
                    {
                        ExtractPositiveAndNegative(engineeredText, out finalPos, out finalNeg, defaultNeg);
                    }
                    else
                    {
                        finalPos = engineeredText.Trim();
                        if (finalPos.Contains("POSITIVE:")) finalPos = finalPos.Split("POSITIVE:")[^1].Trim();
                        if (string.IsNullOrEmpty(finalPos)) finalPos = userPos;
                        finalNeg = !string.IsNullOrEmpty(userNeg) ? userNeg : defaultNeg;
                    }
                }

                await SendChunkAsync(context, "\n\n---\n\n", isLegacyCompletion);

                // 1. Unload llama-server to free 100% VRAM
                await SendChunkAsync(context, "*Llama server stopped. Unloading from VRAM...*\n\n", isLegacyCompletion);
                _processManager.StopServer();
                await Task.Delay(2000);

                // 2. Dispatch to SwarmUI
                var freshCfg = _configManager.GetConfig();
                int swarmPort = int.TryParse(freshCfg.GetValueOrDefault("swarm_port", 7801)?.ToString(), out int sp) ? sp : 7801;
                string swarmHost = freshCfg.GetValueOrDefault("swarm_host", "127.0.0.1")?.ToString() ?? "127.0.0.1";
                int steps = int.TryParse(freshCfg.GetValueOrDefault("swarm_steps", 20)?.ToString(), out int st) ? st : 20;
                double cfgScale = double.TryParse(freshCfg.GetValueOrDefault("swarm_cfg", 7.0)?.ToString(), System.Globalization.CultureInfo.InvariantCulture, out double cs) ? cs : 7.0;
                int width = int.TryParse(freshCfg.GetValueOrDefault("swarm_width", 1024)?.ToString(), out int w) ? w : 1024;
                int height = int.TryParse(freshCfg.GetValueOrDefault("swarm_height", 1024)?.ToString(), out int h) ? h : 1024;
                string launcherPath = freshCfg.GetValueOrDefault("swarm_launcher_path", "")?.ToString() ?? "";

                // Auto-Wake Swarm if offline
                if (!_swarmManager.CheckStatus())
                {
                    bool autoWakeSwarm = true;
                    if (freshCfg.TryGetValue("auto_wake_swarm", out var awsObj))
                    {
                        if (awsObj is bool b) autoWakeSwarm = b;
                        else if (awsObj is JsonElement je && (je.ValueKind == JsonValueKind.True || je.ValueKind == JsonValueKind.False)) autoWakeSwarm = je.GetBoolean();
                        else if (bool.TryParse(awsObj?.ToString(), out var pb)) autoWakeSwarm = pb;
                    }

                    if (autoWakeSwarm)
                    {
                        await SendChunkAsync(context, "<status>\nSwarmUI is offline. Auto-waking SwarmUI engine...\n", isLegacyCompletion);
                        var startRes = _swarmManager.StartSwarm(freshCfg);
                        if (startRes.TryGetValue("status", out var sStatus) && sStatus?.ToString() == "error")
                        {
                            string sMsg = startRes.GetValueOrDefault("message", "Could not start SwarmUI.")?.ToString() ?? "";
                            await SendChunkAsync(context, $"*[Auto-Wake Swarm Failed: {sMsg}]*\n</status>\n\n", isLegacyCompletion);
                            throw new Exception($"Auto-wake SwarmUI failed: {sMsg}");
                        }

                        // Wait for SwarmUI port to accept connections
                        int maxWaitSec = 60;
                        bool swarmOnline = false;
                        string checkHost = swarmHost == "0.0.0.0" ? "127.0.0.1" : swarmHost;
                        while (maxWaitSec-- > 0)
                        {
                            try
                            {
                                using var tcp = new System.Net.Sockets.TcpClient();
                                var connectTask = tcp.ConnectAsync(checkHost, swarmPort);
                                var delayTask = Task.Delay(1000);
                                if (await Task.WhenAny(connectTask, delayTask) == connectTask && tcp.Connected)
                                {
                                    swarmOnline = true;
                                    break;
                                }
                            }
                            catch { }
                            await SendChunkAsync(context, "", isLegacyCompletion);
                        }

                        if (swarmOnline)
                        {
                            await SendChunkAsync(context, "SwarmUI engine online! Proceeding with GPU generation...\n</status>\n\n", isLegacyCompletion);
                            await Task.Delay(2500);
                        }
                        else
                        {
                            await SendChunkAsync(context, "SwarmUI process active, dispatching generation...\n</status>\n\n", isLegacyCompletion);
                        }
                    }
                    else
                    {
                        await SendChunkAsync(context, "*[Error: SwarmUI is not running. Please start SwarmUI in SwarmUI Studio, or enable 'Auto Wake Swarm on Request' in Settings.]*\n\n", isLegacyCompletion);
                        throw new Exception("SwarmUI is offline and Auto Wake Swarm is disabled.");
                    }
                }

                await SendChunkAsync(context, "*Generating image on GPU with SwarmUI...*\n\n", isLegacyCompletion);

                string swarmModel = freshCfg.GetValueOrDefault("swarm_model", "qwen-image-2.1-UC-Q6_K.gguf")?.ToString() ?? "qwen-image-2.1-UC-Q6_K.gguf";
                if (string.IsNullOrWhiteSpace(swarmModel)) swarmModel = "qwen-image-2.1-UC-Q6_K.gguf";

                // SSE keep-alive loop during image generation
                var genTask = _swarmManager.GenerateImageAsync(finalPos, finalNeg, width, height, cfgScale, steps, swarmModel, swarmHost, swarmPort, launcherPath);
                while (!genTask.IsCompleted)
                {
                    var completed = await Task.WhenAny(genTask, Task.Delay(2000));
                    if (completed != genTask)
                    {
                        await SendChunkAsync(context, "", isLegacyCompletion);
                    }
                }

                string imagePath = await genTask;

                string reqHost = context.Request.Host.Value ?? $"127.0.0.1:{_activePort}";
                string safePath = Uri.EscapeDataString(imagePath);
                string imgMarkdown = $"\n\n![Generated Image](http://{reqHost}/local_image?path={safePath})\n\n";
                await SendChunkAsync(context, imgMarkdown, isLegacyCompletion);

                _lastGeneratedImageData = Tuple.Create(imagePath, finalPos, finalNeg, width, height, cfgScale, steps);

                string webhook = freshCfg.GetValueOrDefault("discord_webhook", "")?.ToString() ?? "";
                if (!string.IsNullOrWhiteSpace(webhook))
                {
                    _ = _swarmManager.DispatchDiscordWebhookAsync(imagePath, finalPos, finalNeg, width, height, cfgScale, steps, webhook);
                }
            }
            catch (Exception ex)
            {
                await SendChunkAsync(context, $"\n\n*[Failed to generate image: {ex.Message}]*\n\n", isLegacyCompletion);
            }
            finally
            {
                _isGeneratingImage = false;

                // 3. Guaranteed Auto-Reload: restore llama-server into VRAM so it is ready to chat
                try
                {
                    await SendChunkAsync(context, "<status>\nRestoring Llama server to VRAM...\n", isLegacyCompletion);
                    var reloadCfg = _configManager.GetConfig();
                    _processManager.StartServer(reloadCfg);

                    int internalPort = ProcessManager.GetInternalPort(reloadCfg);
                    int maxWait = 35;
                    bool restored = false;
                    while (maxWait-- > 0)
                    {
                        try
                        {
                            using var healthReq = new HttpRequestMessage(HttpMethod.Get, $"http://127.0.0.1:{internalPort}/health");
                            using var healthResp = await _http.SendAsync(healthReq);
                            if (healthResp.StatusCode == HttpStatusCode.OK || healthResp.StatusCode == HttpStatusCode.NotFound)
                            {
                                restored = true;
                                break;
                            }
                        }
                        catch { }
                        await Task.Delay(1000);
                        await SendChunkAsync(context, "", isLegacyCompletion);
                    }

                    if (restored)
                    {
                        await SendChunkAsync(context, "Llama server successfully restored and ready to chat!\n</status>\n\n", isLegacyCompletion);
                    }
                    else
                    {
                        await SendChunkAsync(context, "Llama server launched.\n</status>\n\n", isLegacyCompletion);
                    }
                }
                catch (Exception rex)
                {
                    await SendChunkAsync(context, $"\n*[Notice: Failed to auto-reload LLM: {rex.Message}]*\n</status>\n\n", isLegacyCompletion);
                }

                try
                {
                    await context.Response.WriteAsync("data: [DONE]\n\n");
                    await context.Response.Body.FlushAsync();
                }
                catch { }
            }
        }

        private static void ExtractPositiveAndNegative(string text, out string pos, out string neg, string defaultNeg)
        {
            pos = "";
            neg = defaultNeg;
            var lines = text.Split('\n');
            var posLines = new List<string>();
            var negLines = new List<string>();
            char current = ' ';

            foreach (var l in lines)
            {
                string line = l.Trim();
                if (line.StartsWith("POSITIVE:", StringComparison.OrdinalIgnoreCase))
                {
                    current = 'P';
                    posLines.Add(line[9..].Trim());
                }
                else if (line.StartsWith("NEGATIVE:", StringComparison.OrdinalIgnoreCase))
                {
                    current = 'N';
                    negLines.Add(line[9..].Trim());
                }
                else if (current == 'P')
                {
                    posLines.Add(line);
                }
                else if (current == 'N')
                {
                    negLines.Add(line);
                }
            }

            if (posLines.Count > 0) pos = string.Join(" ", posLines).Trim();
            if (negLines.Count > 0) neg = string.Join(" ", negLines).Trim();
            if (string.IsNullOrEmpty(pos)) pos = text.Replace("Here is a prompt", "").Replace("Prompt:", "").Trim(' ', '"', '\'', '\n', '\r');
            if (string.IsNullOrEmpty(neg)) neg = defaultNeg;
        }

        private async Task HandleCompactRequestAsync(HttpContext context, JsonElement root, bool isStream, bool isLegacyCompletion)
        {
            if (!root.TryGetProperty("messages", out var msgs) || msgs.GetArrayLength() <= 2)
            {
                await SendAssistantMessageAsync(context, "*Chat is already too short to compact!*", isStream, isLegacyCompletion);
                return;
            }

            var sb = new StringBuilder();
            for (int i = 0; i < msgs.GetArrayLength() - 1; i++)
            {
                var m = msgs[i];
                string role = m.TryGetProperty("role", out var r) ? r.GetString() ?? "user" : "user";
                string msgContent = m.TryGetProperty("content", out var c) ? c.GetString() ?? "" : "";
                sb.AppendLine($"{role.ToUpper()}: {msgContent}\n");
            }

            string summaryPrompt = $"Please read the following chat history and summarize it into a highly condensed, dense block of text that retains all critical facts, context, code snippets, and active tasks. This will be used as the new memory context for the next chat session. DO NOT add conversational filler.\n\nCHAT HISTORY:\n{sb}\n\nDense Summary:";

            var compactPayload = new
            {
                messages = new[] { new { role = "user", content = summaryPrompt } },
                stream = true
            };

            context.Response.ContentType = "text/event-stream";
            await SendChunkAsync(context, "*Compacting chat history...*\n\n> ", isLegacyCompletion);

            var cfg = _configManager.GetConfig();
            int internalPort = ProcessManager.GetInternalPort(cfg);
            string upstreamUrl = $"http://127.0.0.1:{internalPort}/v1/chat/completions";

            using var httpContent = new StringContent(JsonSerializer.Serialize(compactPayload), Encoding.UTF8, "application/json");
            using var resp = await _http.PostAsync(upstreamUrl, httpContent);

            if (resp.IsSuccessStatusCode)
            {
                using var stream = await resp.Content.ReadAsStreamAsync();
                using var r = new StreamReader(stream);
                string? line;
                while ((line = await r.ReadLineAsync()) != null)
                {
                    if (line.StartsWith("data: ") && line != "data: [DONE]")
                    {
                        try
                        {
                            using var cDoc = JsonDocument.Parse(line[6..]);
                            if (cDoc.RootElement.TryGetProperty("choices", out var ca) && ca.GetArrayLength() > 0)
                            {
                                string delta = ca[0].GetProperty("delta").GetProperty("content").GetString() ?? "";
                                if (!string.IsNullOrEmpty(delta)) await SendChunkAsync(context, delta, isLegacyCompletion);
                            }
                        }
                        catch { }
                    }
                }
            }

            await SendChunkAsync(context, "\n\n*✅ Compaction complete. Please copy the text block above, click 'Clear conversation' to clear your screen, and paste it as your first message to continue with this condensed memory!*", isLegacyCompletion);
            await context.Response.WriteAsync("data: [DONE]\n\n");
            await context.Response.Body.FlushAsync();
        }

        private async Task ForwardBodyUpstreamAsync(HttpContext context, string bodyJson, bool isLegacyCompletion = false)
        {
            var cfg = _configManager.GetConfig();
            int internalPort = ProcessManager.GetInternalPort(cfg);
            string upstreamUrl = $"http://127.0.0.1:{internalPort}{context.Request.Path}{context.Request.QueryString}";

            using var upstreamReq = new HttpRequestMessage(HttpMethod.Post, upstreamUrl)
            {
                Content = new StringContent(bodyJson, Encoding.UTF8, "application/json")
            };

            foreach (var header in context.Request.Headers)
            {
                if (header.Key.Equals("Host", StringComparison.OrdinalIgnoreCase) ||
                    header.Key.Equals("Content-Type", StringComparison.OrdinalIgnoreCase) ||
                    header.Key.Equals("Content-Length", StringComparison.OrdinalIgnoreCase) ||
                    header.Key.Equals("Accept-Encoding", StringComparison.OrdinalIgnoreCase) ||
                    header.Key.Equals("Connection", StringComparison.OrdinalIgnoreCase))
                    continue;
                upstreamReq.Headers.TryAddWithoutValidation(header.Key, (IEnumerable<string>)header.Value);
            }

            if (!upstreamReq.Headers.Contains("Accept-Encoding"))
            {
                upstreamReq.Headers.TryAddWithoutValidation("Accept-Encoding", "gzip, deflate, br");
            }

            try
            {
                using var upstreamResp = await _http.SendAsync(upstreamReq, HttpCompletionOption.ResponseHeadersRead, context.RequestAborted);

                if (context.Response.HasStarted)
                {
                    // Response already started (e.g., auto-wake status chunks were sent)
                    if (!upstreamResp.IsSuccessStatusCode)
                    {
                        string errBody = await upstreamResp.Content.ReadAsStringAsync(context.RequestAborted);
                        string errDesc = "Upstream LLM engine error";
                        try
                        {
                            using var errDoc = JsonDocument.Parse(errBody);
                            if (errDoc.RootElement.TryGetProperty("error", out var eObj))
                            {
                                if (eObj.TryGetProperty("message", out var mObj)) errDesc = mObj.GetString() ?? errBody;
                            }
                        }
                        catch
                        {
                            if (!string.IsNullOrWhiteSpace(errBody)) errDesc = errBody;
                        }
                        await SendChunkAsync(context, $"\n\n*[LLM Engine Error ({upstreamResp.StatusCode}): {errDesc}]*\n\n", isLegacyCompletion);
                        await context.Response.WriteAsync("data: [DONE]\n\n", context.RequestAborted);
                        await context.Response.Body.FlushAsync(context.RequestAborted);
                        return;
                    }
                }
                else
                {
                    context.Response.StatusCode = (int)upstreamResp.StatusCode;

                    bool isChunked = upstreamResp.Headers.TransferEncodingChunked == true;

                    foreach (var header in upstreamResp.Headers)
                    {
                        if (DisallowedResponseHeaders.Contains(header.Key)) continue;
                        context.Response.Headers[header.Key] = header.Value.ToArray();
                    }
                    foreach (var header in upstreamResp.Content.Headers)
                    {
                        if (DisallowedResponseHeaders.Contains(header.Key)) continue;
                        if (header.Key.Equals("Content-Length", StringComparison.OrdinalIgnoreCase) && isChunked) continue;
                        context.Response.Headers[header.Key] = header.Value.ToArray();
                    }
                }

                using var stream = await upstreamResp.Content.ReadAsStreamAsync(context.RequestAborted);
                byte[] buffer = new byte[4096];
                int bytesRead;
                while ((bytesRead = await stream.ReadAsync(buffer, 0, buffer.Length, context.RequestAborted)) > 0)
                {
                    await context.Response.Body.WriteAsync(buffer.AsMemory(0, bytesRead), context.RequestAborted);
                    await context.Response.Body.FlushAsync(context.RequestAborted);
                }
            }
            catch (OperationCanceledException)
            {
                // Client disconnected or user stopped generation
            }
            catch (Exception ex)
            {
                if (!context.Response.HasStarted)
                {
                    bool isRunning = _processManager.CheckStatus();
                    context.Response.StatusCode = 503;
                    context.Response.ContentType = "application/json";
                    string errMsg = isRunning
                        ? "llama-server is currently loading model weights into VRAM. Please wait a few seconds and retry."
                        : "llama-server is offline. Please start the server from Llama Server Control first.";
                    await context.Response.WriteAsync($"{{\"error\":{{\"message\":\"{errMsg}\",\"details\":\"{ex.Message}\",\"code\":503}}}}");
                }
                else
                {
                    try
                    {
                        await SendChunkAsync(context, $"\n\n*[Error streaming from llama-server: {ex.Message}]*\n\n", isLegacyCompletion);
                        await context.Response.WriteAsync("data: [DONE]\n\n");
                        await context.Response.Body.FlushAsync();
                    }
                    catch { }
                }
            }
        }

        private async Task ForwardUpstream(HttpContext context)
        {
            var cfg = _configManager.GetConfig();
            int internalPort = ProcessManager.GetInternalPort(cfg);
            string upstreamUrl = $"http://127.0.0.1:{internalPort}{context.Request.Path}{context.Request.QueryString}";

            using var upstreamReq = new HttpRequestMessage(new HttpMethod(context.Request.Method), upstreamUrl);

            foreach (var header in context.Request.Headers)
            {
                if (header.Key.Equals("Host", StringComparison.OrdinalIgnoreCase) ||
                    header.Key.Equals("Content-Length", StringComparison.OrdinalIgnoreCase) ||
                    header.Key.Equals("Content-Type", StringComparison.OrdinalIgnoreCase) ||
                    header.Key.Equals("Accept-Encoding", StringComparison.OrdinalIgnoreCase) ||
                    header.Key.Equals("Connection", StringComparison.OrdinalIgnoreCase))
                    continue;
                upstreamReq.Headers.TryAddWithoutValidation(header.Key, (IEnumerable<string>)header.Value);
            }

            if (!upstreamReq.Headers.Contains("Accept-Encoding"))
            {
                upstreamReq.Headers.TryAddWithoutValidation("Accept-Encoding", "gzip, deflate, br");
            }

            if (HttpMethods.IsPost(context.Request.Method) || HttpMethods.IsPut(context.Request.Method) || HttpMethods.IsPatch(context.Request.Method))
            {
                upstreamReq.Content = new StreamContent(context.Request.Body);
                if (context.Request.ContentType != null)
                {
                    upstreamReq.Content.Headers.ContentType = System.Net.Http.Headers.MediaTypeHeaderValue.Parse(context.Request.ContentType);
                }
            }

            try
            {
                using var upstreamResp = await _http.SendAsync(upstreamReq, HttpCompletionOption.ResponseHeadersRead, context.RequestAborted);
                if (!context.Response.HasStarted)
                {
                    context.Response.StatusCode = (int)upstreamResp.StatusCode;

                    bool isChunked = upstreamResp.Headers.TransferEncodingChunked == true;

                    foreach (var header in upstreamResp.Headers)
                    {
                        if (DisallowedResponseHeaders.Contains(header.Key)) continue;
                        context.Response.Headers[header.Key] = header.Value.ToArray();
                    }
                    foreach (var header in upstreamResp.Content.Headers)
                    {
                        if (DisallowedResponseHeaders.Contains(header.Key)) continue;
                        if (header.Key.Equals("Content-Length", StringComparison.OrdinalIgnoreCase) && isChunked) continue;
                        context.Response.Headers[header.Key] = header.Value.ToArray();
                    }
                }

                using var stream = await upstreamResp.Content.ReadAsStreamAsync(context.RequestAborted);
                byte[] buffer = new byte[8192];
                int bytesRead;
                while ((bytesRead = await stream.ReadAsync(buffer, 0, buffer.Length, context.RequestAborted)) > 0)
                {
                    await context.Response.Body.WriteAsync(buffer.AsMemory(0, bytesRead), context.RequestAborted);
                    await context.Response.Body.FlushAsync(context.RequestAborted);
                }
            }
            catch (OperationCanceledException)
            {
                // Client aborted request
            }
            catch
            {
                if (!context.Response.HasStarted)
                {
                    if (!_processManager.CheckStatus())
                    {
                        context.Response.StatusCode = 503;
                        context.Response.ContentType = "text/html; charset=utf-8";
                        await context.Response.WriteAsync("<!DOCTYPE html><html><body style='font-family:system-ui,-apple-system,sans-serif;background:#0d1117;color:#c9d1d9;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;'><div style='text-align:center;padding:2rem;background:#161b22;border:1px solid #30363d;border-radius:1rem;max-width:460px;'><h2 style='color:#58a6ff;margin-top:0;'>Llama Server is Offline</h2><p style='color:#8b949e;font-size:14px;line-height:1.6;'>Please launch <b>Llama Server Control</b> on your desktop and click <b>Start LLM Server</b> to activate the model engine and web interface.</p></div></body></html>");
                    }
                    else
                    {
                        context.Response.StatusCode = 502;
                        context.Response.ContentType = "application/json";
                        await context.Response.WriteAsync("{\"error\":{\"message\":\"Bad Gateway to upstream engine\",\"code\":502}}");
                    }
                }
            }
        }

        private static async Task SendChunkAsync(HttpContext context, string text, bool isLegacyCompletion)
        {
            if (isLegacyCompletion)
            {
                var chunk = new { content = text };
                await context.Response.WriteAsync($"data: {JsonSerializer.Serialize(chunk)}\n\n");
            }
            else
            {
                var chunk = new { choices = new[] { new { delta = new { content = text } } } };
                await context.Response.WriteAsync($"data: {JsonSerializer.Serialize(chunk)}\n\n");
            }
            await context.Response.Body.FlushAsync();
        }

        private static async Task SendAssistantMessageAsync(HttpContext context, string text, bool isStream, bool isLegacyCompletion)
        {
            context.Response.Headers.Append("Cache-Control", "no-cache");
            if (isStream)
            {
                context.Response.ContentType = "text/event-stream";
                await SendChunkAsync(context, text, isLegacyCompletion);
                await context.Response.WriteAsync("data: [DONE]\n\n");
                await context.Response.Body.FlushAsync();
            }
            else
            {
                context.Response.ContentType = "application/json";
                if (isLegacyCompletion)
                {
                    var resp = new { content = text };
                    await context.Response.WriteAsync(JsonSerializer.Serialize(resp));
                }
                else
                {
                    var resp = new { choices = new[] { new { message = new { role = "assistant", content = text } } } };
                    await context.Response.WriteAsync(JsonSerializer.Serialize(resp));
                }
            }
        }

        private static string InjectPromptIntoBody(string bodyJson, string injection)
        {
            try
            {
                using var doc = JsonDocument.Parse(bodyJson);
                var dict = JsonSerializer.Deserialize<Dictionary<string, object>>(bodyJson);
                if (dict == null) return bodyJson;

                if (dict.TryGetValue("messages", out var msgsObj) && msgsObj is JsonElement je && je.ValueKind == JsonValueKind.Array)
                {
                    var msgsList = JsonSerializer.Deserialize<List<Dictionary<string, object>>>(je.GetRawText());
                    if (msgsList != null && msgsList.Count > 0)
                    {
                        var last = msgsList[^1];
                        last["content"] = injection;
                        dict["messages"] = msgsList;
                    }
                }
                else if (dict.ContainsKey("prompt"))
                {
                    dict["prompt"] = injection;
                }

                dict["stream"] = true;
                return JsonSerializer.Serialize(dict);
            }
            catch
            {
                return bodyJson;
            }
        }
    }
}
