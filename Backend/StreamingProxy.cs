using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
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
        private readonly DiffusionOrchestrator _diffusionOrchestrator;
        private readonly SlashCommandRouter _slashCommandRouter;

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

        public DiffusionOrchestrator DiffusionOrchestrator => _diffusionOrchestrator;
        public SlashCommandRouter SlashCommandRouter => _slashCommandRouter;

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

            _diffusionOrchestrator = new DiffusionOrchestrator(
                _processManager,
                _configManager,
                _swarmManager,
                _hardwareMonitor,
                _http,
                () => _activePort
            );

            _slashCommandRouter = new SlashCommandRouter(
                _processManager,
                _configManager,
                _swarmManager,
                _hardwareMonitor,
                _diffusionOrchestrator,
                _http,
                () => _activePort
            );

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
                    app.MapGet("/generated_cache/{*filePath}", HandleGeneratedCache);
                    app.MapPost("/slots", HandleSlots);
                    app.MapPost("/slots/{id}", HandleSlots);
                    app.MapGet("/slots", ForwardUpstream);
                    app.MapGet("/slots/{id}", ForwardUpstream);
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
                        if (_processManager.CheckStatus() && !_diffusionOrchestrator.IsGeneratingImage)
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
                    context.Response.Headers.Append("Cache-Control", "public, max-age=86400");
                    context.Response.Headers.Append("Access-Control-Allow-Origin", "*");
                    await context.Response.SendFileAsync(imgPath);
                    return;
                }
            }
            context.Response.StatusCode = 404;
        }

        private async Task HandleGeneratedCache(HttpContext context, string filePath)
        {
            if (string.IsNullOrWhiteSpace(filePath) || filePath.Contains(".."))
            {
                context.Response.StatusCode = 400;
                return;
            }

            string cleanPath = filePath.TrimStart('/', '\\').Replace('/', Path.DirectorySeparatorChar);
            string baseAppDir = AppDomain.CurrentDomain.BaseDirectory;
            string cachePath = Path.Combine(baseAppDir, "ui", "generated_cache", cleanPath);
            if (!File.Exists(cachePath))
            {
                string devDir = Directory.GetParent(baseAppDir)?.Parent?.Parent?.Parent?.FullName ?? "";
                if (!string.IsNullOrEmpty(devDir))
                {
                    cachePath = Path.Combine(devDir, "ui", "generated_cache", cleanPath);
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
            if (context.Request.Query["action"] == "erase" || context.Request.Query.ContainsKey("erase"))
            {
                var cfg = _configManager.GetConfig();
                var flushRes = await _processManager.FlushKvCacheAsync(cfg);
                context.Response.ContentType = "application/json";
                await context.Response.WriteAsync(JsonSerializer.Serialize(flushRes));
                return;
            }
            await ForwardUpstream(context);
        }

        private async Task HandleChatCompletions(HttpContext context, bool isLegacyCompletion)
        {
            _lastInteraction = DateTime.UtcNow;

            // Concurrency Lock: Guard against VRAM collisions while SwarmUI is generating
            if (_diffusionOrchestrator.IsGeneratingImage)
            {
                context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
                context.Response.ContentType = "application/json";
                context.Response.Headers.Append("Retry-After", "5");
                await context.Response.WriteAsync("{\"error\":{\"message\":\"GPU is currently executing an image generation pass with SwarmUI. Please retry shortly.\",\"code\":503}}");
                return;
            }

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

            // Route Slash Commands through SlashCommandRouter
            if (SlashCommandRouter.IsSlashCommand(textPrompt))
            {
                bool handled = await _slashCommandRouter.RouteCommandAsync(
                    context,
                    textPrompt,
                    bodyJson,
                    root,
                    isStream,
                    isLegacyCompletion,
                    SendChunkAsync,
                    SendAssistantMessageAsync,
                    ForwardBodyUpstreamAsync
                );
                if (handled) return;
            }

            // Standard chat completions (no slash commands): Forward upstream directly
            await ForwardBodyUpstreamAsync(context, bodyJson, isLegacyCompletion);
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
                // Client aborted request
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
    }
}
