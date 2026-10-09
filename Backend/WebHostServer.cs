using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace LlamaServerControl.Backend
{
    public class WebHostServer
    {
        private WebApplication? _app;
        private readonly NativeBridge _nativeBridge;
        private readonly ConfigManager _configManager;
        private readonly ProcessManager _processManager;
        private readonly StreamingProxy _streamingProxy;
        private readonly string _uiDir;
        private readonly VoiceStudioService? _voiceStudioService;

        private readonly ConcurrentDictionary<Guid, WebSocket> _clients = new();
        private readonly HttpClient _http = new(new SocketsHttpHandler
        {
            AutomaticDecompression = DecompressionMethods.All,
            PooledConnectionLifetime = TimeSpan.FromMinutes(10),
            PooledConnectionIdleTimeout = TimeSpan.FromMinutes(2)
        })
        {
            Timeout = TimeSpan.FromMinutes(10)
        };

        private CancellationTokenSource? _cts;
        private int _activePort = 9095;
        public int ActivePort => _activePort;

        public WebHostServer(
            NativeBridge nativeBridge,
            ConfigManager configManager,
            ProcessManager processManager,
            StreamingProxy streamingProxy,
            string uiDir,
            VoiceStudioService? voiceStudioService = null)
        {
            _nativeBridge = nativeBridge;
            _configManager = configManager;
            _processManager = processManager;
            _streamingProxy = streamingProxy;
            _uiDir = uiDir;
            _voiceStudioService = voiceStudioService;

            _nativeBridge.OnEventBroadcast += OnEventBroadcastReceived;
        }

        public void Start(int? forcedPort = null)
        {
            Stop();

            var cfg = _configManager.GetConfig();
            int port = forcedPort ?? (int.TryParse(cfg.GetValueOrDefault("web_port", 9095)?.ToString(), out int p) ? p : 9095);
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

                    // Global CORS & Private Network Access Headers
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

                    // WebSocket Middleware
                    app.UseWebSockets();

                    // WebSocket RPC and Event Streaming Endpoint
                    app.Map("/api/ws", HandleWebSocketAsync);

                    // HTTP JSON-RPC Bridge Endpoint
                    app.MapPost("/api/rpc", HandleHttpRpcAsync);

                    // Network IP Telemetry Endpoint
                    app.MapGet("/api/network_info", HandleNetworkInfoAsync);

                    // Chat Completions & Token Streaming Proxy
                    app.MapPost("/v1/chat/completions", ctx => ForwardCompletionsAsync(ctx, false));
                    app.MapPost("/completion", ctx => ForwardCompletionsAsync(ctx, true));

                    // KV Cache and Slot Erase Forwarders
                    app.MapGet("/slots", ctx => ForwardGenericAsync(ctx, "/slots"));
                    app.MapPost("/slots", ctx => ForwardGenericAsync(ctx, "/slots"));
                    app.MapGet("/slots/{id}", ctx => ForwardGenericAsync(ctx, $"/slots/{ctx.Request.RouteValues["id"]}"));
                    app.MapPost("/slots/{id}", ctx => ForwardGenericAsync(ctx, $"/slots/{ctx.Request.RouteValues["id"]}"));

                    // Local Images & Cache Assets
                    app.MapGet("/local_image", HandleLocalImageAsync);
                    app.MapGet("/generated_cache/{*filePath}", HandleGeneratedCacheAsync);

                    // VoiceStudio Speech & Audio Endpoints
                    app.MapGet("/api/voicestudio/status", async (ctx) =>
                    {
                        if (_voiceStudioService != null)
                        {
                            var st = await _voiceStudioService.CheckStatusAsync();
                            await ctx.Response.WriteAsJsonAsync(st);
                        }
                        else
                        {
                            await ctx.Response.WriteAsJsonAsync(new { online = false, error = "VoiceStudio service not initialized" });
                        }
                    });

                    app.MapGet("/api/voicestudio/voices", async (ctx) =>
                    {
                        if (_voiceStudioService != null)
                        {
                            bool force = ctx.Request.Query.ContainsKey("refresh");
                            var v = await _voiceStudioService.DiscoverVoicesAsync(force);
                            await ctx.Response.WriteAsJsonAsync(v);
                        }
                        else
                        {
                            await ctx.Response.WriteAsJsonAsync(new List<object>());
                        }
                    });

                    app.MapPost("/api/voicestudio/generate", async (ctx) =>
                    {
                        if (_voiceStudioService == null)
                        {
                            ctx.Response.StatusCode = 500;
                            await ctx.Response.WriteAsJsonAsync(new { status = "error", message = "VoiceStudio service not initialized" });
                            return;
                        }
                        try
                        {
                            using var doc = await JsonDocument.ParseAsync(ctx.Request.Body);
                            var root = doc.RootElement;
                            string text = root.TryGetProperty("text", out var tp) ? tp.GetString() ?? "" : "";
                            string? voice = root.TryGetProperty("voice", out var vp) ? vp.GetString() : null;
                            double speed = 1.0;
                            if (root.TryGetProperty("speed", out var sp))
                            {
                                if (sp.ValueKind == JsonValueKind.Number) speed = sp.GetDouble();
                                else if (double.TryParse(sp.GetString(), out var spVal)) speed = spVal;
                            }
                            string? instruct = root.TryGetProperty("instruct", out var ip) ? ip.GetString() : null;
                            string? language = root.TryGetProperty("language", out var lp) ? lp.GetString() : null;
                            string? effect = root.TryGetProperty("effect", out var ep) ? ep.GetString() : null;
                            double? guidance = root.TryGetProperty("guidance_scale", out var gp) && gp.ValueKind == JsonValueKind.Number ? gp.GetDouble() : null;
                            int? steps = root.TryGetProperty("num_step", out var stp) && stp.ValueKind == JsonValueKind.Number ? stp.GetInt32() : null;
                            long? seed = root.TryGetProperty("seed", out var sdp) && sdp.ValueKind == JsonValueKind.Number ? sdp.GetInt64() : null;

                            var rec = await _voiceStudioService.GenerateSpeechAsync(text, voice, speed, instruct, language, effect, guidance, steps, seed);
                            await ctx.Response.WriteAsJsonAsync(new { status = "success", record = rec });
                        }
                        catch (Exception ex)
                        {
                            ctx.Response.StatusCode = 500;
                            await ctx.Response.WriteAsJsonAsync(new { status = "error", message = ex.Message });
                        }
                    });

                    app.MapGet("/api/voicestudio/history", (ctx) =>
                    {
                        var hist = _voiceStudioService?.GetHistory() ?? new List<GeneratedAudioRecord>();
                        return ctx.Response.WriteAsJsonAsync(hist);
                    });

                    app.MapDelete("/api/voicestudio/history/{id}", (ctx) =>
                    {
                        string id = ctx.Request.RouteValues["id"]?.ToString() ?? "";
                        bool ok = _voiceStudioService?.DeleteHistoryItem(id) ?? false;
                        return ctx.Response.WriteAsJsonAsync(new { status = ok ? "success" : "not_found", id });
                    });

                    app.MapPut("/api/voicestudio/history/{id}/starred", async (ctx) =>
                    {
                        string id = ctx.Request.RouteValues["id"]?.ToString() ?? "";
                        bool starred = true;
                        try
                        {
                            using var doc = await JsonDocument.ParseAsync(ctx.Request.Body);
                            if (doc.RootElement.TryGetProperty("starred", out var sp)) starred = sp.GetBoolean();
                        }
                        catch { }
                        bool ok = _voiceStudioService != null && await _voiceStudioService.ToggleStarRecordAsync(id, starred);
                        await ctx.Response.WriteAsJsonAsync(new { success = ok, id, starred });
                    });

                    app.MapGet("/api/voicestudio/model_info", async (ctx) =>
                    {
                        var info = _voiceStudioService != null ? await _voiceStudioService.GetModelInfoAsync() : (object)new { error = "Not initialized" };
                        await ctx.Response.WriteAsJsonAsync(info);
                    });

                    app.MapPost("/api/voicestudio/model_unload", async (ctx) =>
                    {
                        string mId = "tts";
                        try
                        {
                            if (ctx.Request.ContentLength > 0)
                            {
                                using var doc = await JsonDocument.ParseAsync(ctx.Request.Body);
                                if (doc.RootElement.TryGetProperty("model_id", out var midp)) mId = midp.GetString() ?? "tts";
                            }
                        }
                        catch { }
                        var res = _voiceStudioService != null ? await _voiceStudioService.UnloadModelAsync(mId) : (object)new { success = false };
                        await ctx.Response.WriteAsJsonAsync(res);
                    });

                    app.MapGet("/api/voicestudio/effects", async (ctx) =>
                    {
                        var effs = _voiceStudioService != null ? await _voiceStudioService.GetEffectsPresetsAsync() : new object[0];
                        await ctx.Response.WriteAsJsonAsync(effs);
                    });

                    app.MapGet("/api/voicestudio/personalities", async (ctx) =>
                    {
                        var p = _voiceStudioService != null ? await _voiceStudioService.GetPersonalitiesAsync() : new object[0];
                        await ctx.Response.WriteAsJsonAsync(p);
                    });

                    app.MapGet("/api/voicestudio/profiles", async (ctx) =>
                    {
                        var profs = _voiceStudioService != null ? await _voiceStudioService.GetProfilesAsync() : new object[0];
                        await ctx.Response.WriteAsJsonAsync(profs);
                    });

                    app.MapPost("/api/voicestudio/profiles", async (ctx) =>
                    {
                        if (_voiceStudioService == null)
                        {
                            ctx.Response.StatusCode = 500;
                            await ctx.Response.WriteAsJsonAsync(new { status = "error", message = "VoiceStudio service not initialized" });
                            return;
                        }
                        using var doc = await JsonDocument.ParseAsync(ctx.Request.Body);
                        var root = doc.RootElement;
                        string pName = root.TryGetProperty("name", out var pnp) ? pnp.GetString() ?? "Custom Voice" : "Custom Voice";
                        string? pAudio = root.TryGetProperty("audio_path", out var pap) ? pap.GetString() : null;
                        string? pRef = root.TryGetProperty("ref_text", out var prp) ? prp.GetString() : null;
                        string? pInst = root.TryGetProperty("instruct", out var pip) ? pip.GetString() : null;
                        string? pLang = root.TryGetProperty("language", out var plp) ? plp.GetString() : null;
                        var res = await _voiceStudioService.CreateProfileAsync(pName, pAudio, pRef, pInst, pLang);
                        await ctx.Response.WriteAsJsonAsync(res);
                    });

                    app.MapDelete("/api/voicestudio/profiles/{id}", async (ctx) =>
                    {
                        string id = ctx.Request.RouteValues["id"]?.ToString() ?? "";
                        var res = _voiceStudioService != null ? await _voiceStudioService.DeleteProfileAsync(id) : (object)new { success = false };
                        await ctx.Response.WriteAsJsonAsync(res);
                    });

                    app.MapPost("/api/voicestudio/convert", async (ctx) =>
                    {
                        if (_voiceStudioService == null)
                        {
                            ctx.Response.StatusCode = 500;
                            await ctx.Response.WriteAsJsonAsync(new { status = "error", message = "VoiceStudio service not initialized" });
                            return;
                        }
                        using var doc = await JsonDocument.ParseAsync(ctx.Request.Body);
                        var root = doc.RootElement;
                        string sAudio = root.TryGetProperty("audio_path", out var sap) ? sap.GetString() ?? "" : "";
                        string tProfile = root.TryGetProperty("profile_id", out var tpp) ? tpp.GetString() ?? "" : "";
                        bool mDur = !root.TryGetProperty("match_duration", out var mdp) || mdp.GetBoolean();
                        bool cFirst = root.TryGetProperty("clean_first", out var cfp) && cfp.GetBoolean();
                        var res = await _voiceStudioService.ConvertSpeechAsync(sAudio, tProfile, mDur, cFirst);
                        await ctx.Response.WriteAsJsonAsync(res);
                    });

                    app.MapPost("/api/voicestudio/clean", async (ctx) =>
                    {
                        if (_voiceStudioService == null)
                        {
                            ctx.Response.StatusCode = 500;
                            await ctx.Response.WriteAsJsonAsync(new { status = "error", message = "VoiceStudio service not initialized" });
                            return;
                        }
                        using var doc = await JsonDocument.ParseAsync(ctx.Request.Body);
                        string clAudio = doc.RootElement.TryGetProperty("audio_path", out var cap) ? cap.GetString() ?? "" : "";
                        var clRes = await _voiceStudioService.CleanAudioAsync(clAudio);
                        if (clRes != null) await ctx.Response.WriteAsJsonAsync(new { status = "success", data = clRes });
                        else await ctx.Response.WriteAsJsonAsync(new { status = "error", message = "Clean audio failed" });
                    });

                    app.MapPost("/api/voicestudio/describe", async (ctx) =>
                    {
                        if (_voiceStudioService == null)
                        {
                            await ctx.Response.WriteAsJsonAsync(new { status = "error", message = "VoiceStudio service not initialized" });
                            return;
                        }
                        using var doc = await JsonDocument.ParseAsync(ctx.Request.Body);
                        string desc = doc.RootElement.TryGetProperty("description", out var dp) ? dp.GetString() ?? "" : "";
                        var res = await _voiceStudioService.ParseVoiceDescriptionAsync(desc);
                        await ctx.Response.WriteAsJsonAsync(res);
                    });

                    app.MapGet("/api/voicestudio/archetypes", async (ctx) =>
                    {
                        if (_voiceStudioService != null)
                        {
                            var arch = await _voiceStudioService.GetArchetypesAsync();
                            await ctx.Response.WriteAsJsonAsync(arch);
                        }
                        else
                        {
                            await ctx.Response.WriteAsJsonAsync(new string[0]);
                        }
                    });

                    app.MapPost("/api/voicestudio/story", async (ctx) =>
                    {
                        if (_voiceStudioService == null)
                        {
                            await ctx.Response.WriteAsJsonAsync(new { status = "error", message = "VoiceStudio service not initialized" });
                            return;
                        }
                        using var doc = await JsonDocument.ParseAsync(ctx.Request.Body);
                        var res = await _voiceStudioService.RenderStoryAsync(doc.RootElement);
                        await ctx.Response.WriteAsJsonAsync(res);
                    });

                    app.MapPost("/api/voicestudio/flush", async (ctx) =>
                    {
                        if (_voiceStudioService != null)
                        {
                            var res = await _voiceStudioService.FlushMemoryAsync();
                            await ctx.Response.WriteAsJsonAsync(res);
                        }
                        else
                        {
                            await ctx.Response.WriteAsJsonAsync(new { status = "error", message = "VoiceStudio service not initialized" });
                        }
                    });

                    // Generated Audio Stream Endpoint
                    app.MapGet("/media/audio/{*fileName}", HandleAudioMediaAsync);

                    // Static UI Assets Fallback (index.html, JS, CSS, tabs, modals)
                    app.MapFallback("{*path}", HandleStaticFileFallbackAsync);

                    _app = app;

                    var ips = GetLocalIPv4Addresses();
                    string lanStr = ips.Count > 0 ? $" | Network: http://{ips[0]}:{port}" : "";
                    _processManager.Log($"[WebHost] Web app running at http://0.0.0.0:{port} (Local: http://localhost:{port}{lanStr})");

                    await app.RunAsync();
                }
                catch (Exception ex)
                {
                    _processManager.Log($"[WebHost ERR] Could not start web server on port {port}: {ex.Message}");
                }
            });
        }

        public void Stop()
        {
            try
            {
                _cts?.Cancel();
                foreach (var (id, ws) in _clients)
                {
                    try
                    {
                        if (ws.State == WebSocketState.Open)
                        {
                            ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "Server stopping", CancellationToken.None).Wait(500);
                        }
                    }
                    catch { }
                }
                _clients.Clear();

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

        private void OnEventBroadcastReceived(string eventJson)
        {
            if (_clients.IsEmpty) return;
            byte[] bytes = Encoding.UTF8.GetBytes(eventJson);
            var segment = new ArraySegment<byte>(bytes);

            foreach (var (id, client) in _clients)
            {
                if (client.State == WebSocketState.Open)
                {
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            await client.SendAsync(segment, WebSocketMessageType.Text, true, CancellationToken.None);
                        }
                        catch
                        {
                            _clients.TryRemove(id, out _);
                        }
                    });
                }
                else
                {
                    _clients.TryRemove(id, out _);
                }
            }
        }

        private async Task HandleWebSocketAsync(HttpContext context)
        {
            if (!context.WebSockets.IsWebSocketRequest)
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                await context.Response.WriteAsync("WebSocket connection required at /api/ws");
                return;
            }

            using var ws = await context.WebSockets.AcceptWebSocketAsync();
            var clientId = Guid.NewGuid();
            _clients.TryAdd(clientId, ws);

            var buffer = new byte[65536];
            try
            {
                while (ws.State == WebSocketState.Open && _cts != null && !_cts.IsCancellationRequested)
                {
                    using var ms = new MemoryStream();
                    WebSocketReceiveResult result;
                    do
                    {
                        result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), _cts.Token);
                        if (result.MessageType == WebSocketMessageType.Close) break;
                        ms.Write(buffer, 0, result.Count);
                    } while (!result.EndOfMessage);

                    if (result.MessageType == WebSocketMessageType.Close) break;

                    string requestJson = Encoding.UTF8.GetString(ms.ToArray());
                    if (!string.IsNullOrWhiteSpace(requestJson))
                    {
                        string responseJson = await _nativeBridge.HandleMessageAsync(requestJson);
                        byte[] respBytes = Encoding.UTF8.GetBytes(responseJson);

                        if (ws.State == WebSocketState.Open)
                        {
                            await ws.SendAsync(new ArraySegment<byte>(respBytes), WebSocketMessageType.Text, true, CancellationToken.None);
                        }
                    }
                }
            }
            catch { }
            finally
            {
                _clients.TryRemove(clientId, out _);
                try
                {
                    if (ws.State == WebSocketState.Open || ws.State == WebSocketState.CloseReceived)
                    {
                        await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "Session ended", CancellationToken.None);
                    }
                }
                catch { }
            }
        }

        private async Task HandleHttpRpcAsync(HttpContext context)
        {
            try
            {
                using var reader = new StreamReader(context.Request.Body, Encoding.UTF8);
                string messageJson = await reader.ReadToEndAsync();
                if (string.IsNullOrWhiteSpace(messageJson))
                {
                    context.Response.StatusCode = 400;
                    context.Response.ContentType = "application/json; charset=utf-8";
                    await context.Response.WriteAsync("{\"error\":\"Empty RPC request\"}");
                    return;
                }

                string responseJson = await _nativeBridge.HandleMessageAsync(messageJson);
                context.Response.StatusCode = 200;
                context.Response.ContentType = "application/json; charset=utf-8";
                await context.Response.WriteAsync(responseJson);
            }
            catch (Exception ex)
            {
                context.Response.StatusCode = 500;
                context.Response.ContentType = "application/json; charset=utf-8";
                await context.Response.WriteAsync(JsonSerializer.Serialize(new { error = ex.Message }));
            }
        }

        private async Task HandleNetworkInfoAsync(HttpContext context)
        {
            var info = GetNetworkInfo(_configManager.GetConfig(), _streamingProxy.ActivePort, _activePort);
            context.Response.ContentType = "application/json; charset=utf-8";
            await context.Response.WriteAsync(JsonSerializer.Serialize(info, new JsonSerializerOptions { WriteIndented = true }));
        }

        private async Task ForwardCompletionsAsync(HttpContext context, bool isLegacy)
        {
            int proxyPort = _streamingProxy.ActivePort;
            string targetPath = isLegacy ? "/completion" : "/v1/chat/completions";
            string targetUrl = $"http://127.0.0.1:{proxyPort}{targetPath}";

            using var requestMessage = new HttpRequestMessage(HttpMethod.Post, targetUrl);

            foreach (var header in context.Request.Headers)
            {
                if (!header.Key.StartsWith("Host", StringComparison.OrdinalIgnoreCase) &&
                    !header.Key.StartsWith("Content-Length", StringComparison.OrdinalIgnoreCase))
                {
                    requestMessage.Headers.TryAddWithoutValidation(header.Key, header.Value.ToArray());
                }
            }

            requestMessage.Content = new StreamContent(context.Request.Body);
            if (context.Request.ContentType != null)
            {
                requestMessage.Content.Headers.ContentType = System.Net.Http.Headers.MediaTypeHeaderValue.Parse(context.Request.ContentType);
            }

            try
            {
                using var responseMessage = await _http.SendAsync(requestMessage, HttpCompletionOption.ResponseHeadersRead, context.RequestAborted);

                context.Response.StatusCode = (int)responseMessage.StatusCode;
                foreach (var header in responseMessage.Headers)
                {
                    context.Response.Headers[header.Key] = header.Value.ToArray();
                }
                foreach (var header in responseMessage.Content.Headers)
                {
                    context.Response.Headers[header.Key] = header.Value.ToArray();
                }
                context.Response.Headers.AccessControlAllowOrigin = "*";

                await responseMessage.Content.CopyToAsync(context.Response.Body, context.RequestAborted);
            }
            catch (OperationCanceledException)
            {
                // Client aborted stream
            }
            catch (Exception ex)
            {
                if (!context.Response.HasStarted)
                {
                    context.Response.StatusCode = StatusCodes.Status502BadGateway;
                    context.Response.ContentType = "application/json; charset=utf-8";
                    await context.Response.WriteAsync(JsonSerializer.Serialize(new
                    {
                        error = new
                        {
                            message = $"Upstream engine unreachable on port {proxyPort}: {ex.Message}. Verify server is started.",
                            code = 502
                        }
                    }));
                }
            }
        }

        private async Task ForwardGenericAsync(HttpContext context, string subPath)
        {
            int proxyPort = _streamingProxy.ActivePort;
            string targetUrl = $"http://127.0.0.1:{proxyPort}{subPath}{context.Request.QueryString}";

            var method = new HttpMethod(context.Request.Method);
            using var requestMessage = new HttpRequestMessage(method, targetUrl);

            foreach (var header in context.Request.Headers)
            {
                if (!header.Key.StartsWith("Host", StringComparison.OrdinalIgnoreCase) &&
                    !header.Key.StartsWith("Content-Length", StringComparison.OrdinalIgnoreCase))
                {
                    requestMessage.Headers.TryAddWithoutValidation(header.Key, header.Value.ToArray());
                }
            }

            if (HttpMethods.IsPost(context.Request.Method) || HttpMethods.IsPut(context.Request.Method))
            {
                requestMessage.Content = new StreamContent(context.Request.Body);
                if (context.Request.ContentType != null)
                {
                    requestMessage.Content.Headers.ContentType = System.Net.Http.Headers.MediaTypeHeaderValue.Parse(context.Request.ContentType);
                }
            }

            try
            {
                using var responseMessage = await _http.SendAsync(requestMessage, HttpCompletionOption.ResponseHeadersRead, context.RequestAborted);
                context.Response.StatusCode = (int)responseMessage.StatusCode;
                foreach (var header in responseMessage.Headers)
                {
                    context.Response.Headers[header.Key] = header.Value.ToArray();
                }
                foreach (var header in responseMessage.Content.Headers)
                {
                    context.Response.Headers[header.Key] = header.Value.ToArray();
                }
                context.Response.Headers.AccessControlAllowOrigin = "*";
                await responseMessage.Content.CopyToAsync(context.Response.Body, context.RequestAborted);
            }
            catch (Exception ex)
            {
                if (!context.Response.HasStarted)
                {
                    context.Response.StatusCode = 502;
                    await context.Response.WriteAsync(JsonSerializer.Serialize(new { error = ex.Message }));
                }
            }
        }

        private async Task HandleLocalImageAsync(HttpContext context)
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

        private async Task HandleGeneratedCacheAsync(HttpContext context, string filePath)
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

        private async Task HandleStaticFileFallbackAsync(HttpContext context)
        {
            string reqPath = context.Request.RouteValues.TryGetValue("path", out var pObj) && pObj != null
                ? pObj.ToString() ?? ""
                : (context.Request.Path.Value ?? "");
            if (reqPath.Contains(".."))
            {
                context.Response.StatusCode = 400;
                return;
            }

            if (string.IsNullOrEmpty(reqPath) || reqPath == "/")
            {
                reqPath = "/index.html";
            }

            string cleanRel = reqPath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
            string filePath = Path.Combine(_uiDir, cleanRel);

            if (!File.Exists(filePath))
            {
                // Check if file exists in runtime output ui folder as secondary fallback
                string baseAppDir = AppDomain.CurrentDomain.BaseDirectory;
                string altPath = Path.Combine(baseAppDir, "ui", cleanRel);
                if (File.Exists(altPath))
                {
                    filePath = altPath;
                }
            }

            if (File.Exists(filePath))
            {
                string mime = GetMimeType(filePath);
                context.Response.ContentType = mime;
                context.Response.Headers.Append("Access-Control-Allow-Origin", "*");
                context.Response.Headers.Append("Access-Control-Allow-Private-Network", "true");
                await context.Response.SendFileAsync(filePath);
                return;
            }

            // SPA Fallback for extensionless URLs
            if (!Path.HasExtension(reqPath))
            {
                string indexPath = Path.Combine(_uiDir, "index.html");
                if (File.Exists(indexPath))
                {
                    context.Response.ContentType = "text/html; charset=utf-8";
                    context.Response.Headers.Append("Access-Control-Allow-Origin", "*");
                    await context.Response.SendFileAsync(indexPath);
                    return;
                }
            }

            context.Response.StatusCode = 404;
        }

        private static string GetMimeType(string path)
        {
            string ext = Path.GetExtension(path).ToLowerInvariant();
            return ext switch
            {
                ".html" or ".htm" => "text/html; charset=utf-8",
                ".js" or ".mjs" => "application/javascript; charset=utf-8",
                ".css" => "text/css; charset=utf-8",
                ".json" => "application/json; charset=utf-8",
                ".png" => "image/png",
                ".jpg" or ".jpeg" => "image/jpeg",
                ".webp" => "image/webp",
                ".gif" => "image/gif",
                ".svg" => "image/svg+xml",
                ".ico" => "image/x-icon",
                ".woff2" => "font/woff2",
                ".woff" => "font/woff",
                ".ttf" => "font/ttf",
                ".txt" => "text/plain; charset=utf-8",
                ".md" => "text/markdown; charset=utf-8",
                ".mp3" => "audio/mpeg",
                ".wav" => "audio/wav",
                ".m4a" or ".m4b" => "audio/mp4",
                _ => "application/octet-stream"
            };
        }

        private async Task HandleAudioMediaAsync(HttpContext context)
        {
            string fileName = context.Request.RouteValues["fileName"]?.ToString() ?? "";
            if (string.IsNullOrWhiteSpace(fileName))
            {
                context.Response.StatusCode = 404;
                return;
            }

            string fullPath = _voiceStudioService != null
                ? _voiceStudioService.GetAudioFilePath(fileName)
                : Path.Combine(_uiDir, "media", "audio", fileName);

            if (!File.Exists(fullPath))
            {
                // Also check relative to AppDomain base directory
                string altPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "ui", "media", "audio", fileName);
                if (File.Exists(altPath))
                {
                    fullPath = altPath;
                }
                else
                {
                    context.Response.StatusCode = 404;
                    return;
                }
            }

            context.Response.ContentType = "audio/mpeg";
            context.Response.Headers.Append("Accept-Ranges", "bytes");
            context.Response.Headers.Append("Access-Control-Allow-Origin", "*");
            context.Response.Headers.Append("Access-Control-Allow-Private-Network", "true");
            await context.Response.SendFileAsync(fullPath);
        }

        public static List<string> GetLocalIPv4Addresses()
        {
            var ips = new List<string>();
            try
            {
                foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (ni.OperationalStatus != OperationalStatus.Up) continue;
                    if (ni.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;

                    var props = ni.GetIPProperties();
                    foreach (var ip in props.UnicastAddresses)
                    {
                        if (ip.Address.AddressFamily == AddressFamily.InterNetwork)
                        {
                            string s = ip.Address.ToString();
                            if (!s.StartsWith("127.") && !s.StartsWith("169.254."))
                            {
                                ips.Add(s);
                            }
                        }
                    }
                }
            }
            catch { }
            return ips;
        }

        public static Dictionary<string, object> GetNetworkInfo(Dictionary<string, object> cfg, int apiPort, int webPort)
        {
            var lanIps = GetLocalIPv4Addresses();
            string primaryLanIp = lanIps.Count > 0 ? lanIps[0] : "127.0.0.1";

            return new Dictionary<string, object>
            {
                { "web_port", webPort },
                { "local_url", $"http://localhost:{webPort}" },
                { "lan_ips", lanIps },
                { "network_url", $"http://{primaryLanIp}:{webPort}" },
                { "api_port", apiPort },
                { "api_url", $"http://{primaryLanIp}:{apiPort}/v1" }
            };
        }
    }
}
