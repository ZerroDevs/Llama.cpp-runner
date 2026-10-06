using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace LlamaServerControl.Backend
{
    public class StreamingProxy
    {
        private HttpListener? _listener;
        private readonly ProcessManager _processManager;
        private readonly ConfigManager _configManager;
        private readonly SwarmManager _swarmManager;
        private readonly HttpClient _http = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
        private CancellationTokenSource? _cts;

        public StreamingProxy(ProcessManager processManager, ConfigManager configManager, SwarmManager swarmManager)
        {
            _processManager = processManager;
            _configManager = configManager;
            _swarmManager = swarmManager;
        }

        public void Start(int port = 8081)
        {
            try
            {
                _listener = new HttpListener();
                _listener.Prefixes.Add($"http://127.0.0.1:{port}/");
                _listener.Start();

                _cts = new CancellationTokenSource();
                Task.Run(() => ListenLoop(_cts.Token));
            }
            catch { }
        }

        public void Stop()
        {
            try
            {
                _cts?.Cancel();
                _listener?.Stop();
                _listener?.Close();
            }
            catch { }
        }

        private async Task ListenLoop(CancellationToken ct)
        {
            while (!ct.IsCancellationRequested && _listener != null && _listener.IsListening)
            {
                try
                {
                    var context = await _listener.GetContextAsync();
                    _ = ProcessRequestAsync(context);
                }
                catch
                {
                    break;
                }
            }
        }

        private async Task ProcessRequestAsync(HttpListenerContext context)
        {
            var req = context.Request;
            var res = context.Response;

            // Enable CORS
            res.Headers.Add("Access-Control-Allow-Origin", "*");
            res.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            res.Headers.Add("Access-Control-Allow-Headers", "Content-Type, Authorization");

            if (req.HttpMethod == "OPTIONS")
            {
                res.StatusCode = 200;
                res.Close();
                return;
            }

            try
            {
                string path = req.Url?.AbsolutePath ?? "";

                if (path == "/local_image")
                {
                    await HandleLocalImage(req, res);
                    return;
                }

                if (path == "/v1/chat/completions")
                {
                    await HandleChatCompletions(req, res);
                    return;
                }

                if (path == "/slots" && req.QueryString["action"] == "erase")
                {
                    var cfg = _configManager.GetConfig();
                    await _processManager.FlushKvCacheAsync(cfg);
                    byte[] ok = Encoding.UTF8.GetBytes("{\"status\":\"success\"}");
                    res.ContentType = "application/json";
                    await res.OutputStream.WriteAsync(ok, 0, ok.Length);
                    res.Close();
                    return;
                }

                res.StatusCode = 404;
                res.Close();
            }
            catch
            {
                try { res.StatusCode = 500; res.Close(); } catch { }
            }
        }

        private async Task HandleLocalImage(HttpListenerRequest req, HttpListenerResponse res)
        {
            string imgPath = req.QueryString["path"] ?? "";
            if (!string.IsNullOrWhiteSpace(imgPath))
            {
                imgPath = Uri.UnescapeDataString(imgPath);
                if (File.Exists(imgPath))
                {
                    string ext = Path.GetExtension(imgPath).ToLower();
                    res.ContentType = ext switch
                    {
                        ".jpg" or ".jpeg" => "image/jpeg",
                        ".png" => "image/png",
                        ".webp" => "image/webp",
                        _ => "application/octet-stream"
                    };

                    using var fs = File.OpenRead(imgPath);
                    res.ContentLength64 = fs.Length;
                    await fs.CopyToAsync(res.OutputStream);
                    res.Close();
                    return;
                }
            }
            res.StatusCode = 404;
            res.Close();
        }

        private async Task HandleChatCompletions(HttpListenerRequest req, HttpListenerResponse res)
        {
            using var reader = new StreamReader(req.InputStream, req.ContentEncoding);
            string bodyJson = await reader.ReadToEndAsync();

            var cfg = _configManager.GetConfig();
            int serverPort = int.TryParse(cfg.GetValueOrDefault("port", 8080)?.ToString(), out int sp) ? sp : 8080;
            string targetUrl = $"http://127.0.0.1:{serverPort}/v1/chat/completions";

            try
            {
                using var content = new StringContent(bodyJson, Encoding.UTF8, "application/json");
                using var upstreamReq = new HttpRequestMessage(HttpMethod.Post, targetUrl) { Content = content };

                using var upstreamResp = await _http.SendAsync(upstreamReq, HttpCompletionOption.ResponseHeadersRead);

                res.StatusCode = (int)upstreamResp.StatusCode;
                res.ContentType = upstreamResp.Content.Headers.ContentType?.ToString() ?? "text/event-stream";

                using var upstreamStream = await upstreamResp.Content.ReadAsStreamAsync();
                await upstreamStream.CopyToAsync(res.OutputStream);
                res.Close();
            }
            catch (HttpRequestException)
            {
                bool isRunning = _processManager.CheckStatus();
                string errMsg = isRunning
                    ? "llama-server is currently loading model weights into VRAM. Please wait a few seconds and retry."
                    : "llama-server is offline. Please start the server from the Dashboard first.";
                var errPayload = new
                {
                    error = new
                    {
                        message = errMsg,
                        type = isRunning ? "server_warming_up" : "server_offline",
                        code = 503
                    }
                };
                byte[] errBytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(errPayload));
                res.StatusCode = 503;
                res.ContentType = "application/json";
                await res.OutputStream.WriteAsync(errBytes, 0, errBytes.Length);
                res.Close();
            }
        }
    }
}
