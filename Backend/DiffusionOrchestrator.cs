using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Collections.Generic;
using System.Diagnostics;
using Microsoft.AspNetCore.Http;

namespace LlamaServerControl.Backend
{
    public class DiffusionOrchestrator
    {
        private readonly ProcessManager _processManager;
        private readonly ConfigManager _configManager;
        private readonly SwarmManager _swarmManager;
        private readonly HardwareMonitor _hardwareMonitor;
        private readonly HttpClient _http;
        private readonly Func<int> _getActivePort;

        public bool IsGeneratingImage { get; private set; } = false;
        public Tuple<string, string, string, int, int, double, int>? LastGeneratedImageData { get; private set; }

        public DiffusionOrchestrator(
            ProcessManager processManager,
            ConfigManager configManager,
            SwarmManager swarmManager,
            HardwareMonitor hardwareMonitor,
            HttpClient http,
            Func<int> getActivePort)
        {
            _processManager = processManager;
            _configManager = configManager;
            _swarmManager = swarmManager;
            _hardwareMonitor = hardwareMonitor;
            _http = http;
            _getActivePort = getActivePort;
        }

        public async Task HandleDrawRequestAsync(
            HttpContext context,
            string originalPrompt,
            string originalBodyJson,
            bool isArt,
            bool isGuessConfirm,
            bool isRaw,
            bool isLegacyCompletion,
            Func<HttpContext, string, bool, Task> sendChunkAsync)
        {
            IsGeneratingImage = true;
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
                    await sendChunkAsync(context, $"*Direct prompt received:*\n- **Positive:** `{userPos}`\n- **Negative:** `{dispNeg}`\n\n", isLegacyCompletion);
                }
                else if (isGuessConfirm)
                {
                    await sendChunkAsync(context, "*Confirmed! Initiating image generation...*\n\n", isLegacyCompletion);
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
                            await sendChunkAsync(context, "<status>\nAuto-waking LLM server for prompt engineering...\n", isLegacyCompletion);
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
                                await sendChunkAsync(context, "", isLegacyCompletion);
                            }
                        }
                        else
                        {
                            await sendChunkAsync(context, "*LLM server is offline (Auto Wake LLM disabled). Proceeding directly without prompt engineering...*\n\n", isLegacyCompletion);
                        }
                    }

                    string engineeredText = "";
                    if (_processManager.CheckStatus())
                    {
                        await sendChunkAsync(context, "LLM online! Engineering prompt with Llama...\n</status>\n\n", isLegacyCompletion);

                        try
                        {
                            int internalPort = ProcessManager.GetInternalPort(cfg);
                            string upstreamUrl = $"http://127.0.0.1:{internalPort}/v1/chat/completions";

                            string modifiedBody = InjectPromptIntoBody(originalBodyJson, injection);
                            using var engContent = new StringContent(modifiedBody, Encoding.UTF8, "application/json");
                            using var engResp = await _http.PostAsync(upstreamUrl, engContent, context.RequestAborted);

                            if (engResp.IsSuccessStatusCode)
                            {
                                using var engStream = await engResp.Content.ReadAsStreamAsync(context.RequestAborted);
                                using var engReader = new StreamReader(engStream);
                                string? line;
                                while ((line = await engReader.ReadLineAsync(context.RequestAborted)) != null)
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
                                                    await sendChunkAsync(context, delta.Replace("```", ""), isLegacyCompletion);
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
                            await sendChunkAsync(context, $"\n*[Error generating prompt: {ex.Message}]*\n", isLegacyCompletion);
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

                await sendChunkAsync(context, "\n\n---\n\n", isLegacyCompletion);

                // 1. Hardware-Verified VRAM Drain: Unload llama-server and actively poll VRAM release
                await sendChunkAsync(context, "*Llama server stopped. Reclaiming VRAM headroom...*\n\n", isLegacyCompletion);
                _processManager.StopServer();
                await WaitForVramDrainAsync(context, isLegacyCompletion, sendChunkAsync);

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
                        await sendChunkAsync(context, "<status>\nSwarmUI is offline. Auto-waking SwarmUI engine...\n", isLegacyCompletion);
                        var startRes = _swarmManager.StartSwarm(freshCfg);
                        if (startRes.TryGetValue("status", out var sStatus) && sStatus?.ToString() == "error")
                        {
                            string sMsg = startRes.GetValueOrDefault("message", "Could not start SwarmUI.")?.ToString() ?? "";
                            await sendChunkAsync(context, $"*[Auto-Wake Swarm Failed: {sMsg}]*\n</status>\n\n", isLegacyCompletion);
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
                            await sendChunkAsync(context, "", isLegacyCompletion);
                        }

                        if (swarmOnline)
                        {
                            await sendChunkAsync(context, "SwarmUI engine online! Proceeding with GPU generation...\n</status>\n\n", isLegacyCompletion);
                            await Task.Delay(2500, context.RequestAborted);
                        }
                        else
                        {
                            await sendChunkAsync(context, "SwarmUI process active, dispatching generation...\n</status>\n\n", isLegacyCompletion);
                        }
                    }
                    else
                    {
                        await sendChunkAsync(context, "*[Error: SwarmUI is not running. Please start SwarmUI in SwarmUI Studio, or enable 'Auto Wake Swarm on Request' in Settings.]*\n\n", isLegacyCompletion);
                        throw new Exception("SwarmUI is offline and Auto Wake Swarm is disabled.");
                    }
                }

                await sendChunkAsync(context, "*Generating image on GPU with SwarmUI...*\n\n", isLegacyCompletion);

                string swarmModel = freshCfg.GetValueOrDefault("swarm_model", "qwen-image-2.1-UC-Q6_K.gguf")?.ToString() ?? "qwen-image-2.1-UC-Q6_K.gguf";
                if (string.IsNullOrWhiteSpace(swarmModel)) swarmModel = "qwen-image-2.1-UC-Q6_K.gguf";

                // SSE keep-alive loop during image generation
                var genTask = _swarmManager.GenerateImageAsync(finalPos, finalNeg, width, height, cfgScale, steps, swarmModel, swarmHost, swarmPort, launcherPath);
                while (!genTask.IsCompleted)
                {
                    var completed = await Task.WhenAny(genTask, Task.Delay(2000));
                    if (completed != genTask)
                    {
                        await sendChunkAsync(context, "", isLegacyCompletion);
                    }
                }

                string imagePath = await genTask;

                int activePort = _getActivePort();
                string reqHost = context.Request.Host.Value ?? $"127.0.0.1:{activePort}";
                string safePath = Uri.EscapeDataString(imagePath);
                string imgMarkdown = $"\n\n![Generated Image](http://{reqHost}/local_image?path={safePath})\n\n";
                await sendChunkAsync(context, imgMarkdown, isLegacyCompletion);

                LastGeneratedImageData = Tuple.Create(imagePath, finalPos, finalNeg, width, height, cfgScale, steps);

                string webhook = freshCfg.GetValueOrDefault("discord_webhook", "")?.ToString() ?? "";
                if (!string.IsNullOrWhiteSpace(webhook))
                {
                    _ = _swarmManager.DispatchDiscordWebhookAsync(imagePath, finalPos, finalNeg, width, height, cfgScale, steps, webhook);
                }
            }
            catch (Exception ex)
            {
                await sendChunkAsync(context, $"\n\n*[Failed to generate image: {ex.Message}]*\n\n", isLegacyCompletion);
            }
            finally
            {
                IsGeneratingImage = false;

                // 3. Guaranteed Auto-Reload: restore llama-server into VRAM so it is ready to chat
                try
                {
                    await sendChunkAsync(context, "<status>\nRestoring Llama server to VRAM...\n", isLegacyCompletion);
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
                            using var healthResp = await _http.SendAsync(healthReq, context.RequestAborted);
                            if (healthResp.StatusCode == HttpStatusCode.OK || healthResp.StatusCode == HttpStatusCode.NotFound)
                            {
                                restored = true;
                                break;
                            }
                        }
                        catch { }
                        await Task.Delay(1000, context.RequestAborted);
                        await sendChunkAsync(context, "", isLegacyCompletion);
                    }

                    if (restored)
                    {
                        await sendChunkAsync(context, "Llama server successfully restored and ready to chat!\n</status>\n\n", isLegacyCompletion);
                    }
                    else
                    {
                        await sendChunkAsync(context, "Llama server launched.\n</status>\n\n", isLegacyCompletion);
                    }
                }
                catch (Exception rex)
                {
                    await sendChunkAsync(context, $"\n*[Notice: Failed to auto-reload LLM: {rex.Message}]*\n</status>\n\n", isLegacyCompletion);
                }

                try
                {
                    await context.Response.WriteAsync("data: [DONE]\n\n");
                    await context.Response.Body.FlushAsync();
                }
                catch { }
            }
        }

        private async Task WaitForVramDrainAsync(
            HttpContext context,
            bool isLegacyCompletion,
            Func<HttpContext, string, bool, Task> sendChunkAsync)
        {
            var initialHw = _hardwareMonitor.GetHardwareData();
            double initialVram = 0;
            if (initialHw.TryGetValue("vram_used", out var ivObj) && double.TryParse(ivObj?.ToString(), System.Globalization.CultureInfo.InvariantCulture, out double parsedIv))
            {
                initialVram = parsedIv;
            }

            _processManager.Log($"[Proxy] Stopping LLM server. Initial VRAM: {initialVram:0.1} GB. Verifying hardware memory drain...");

            var sw = Stopwatch.StartNew();
            // Minimum wait of 600ms for OS process handle teardown, maximum safety timeout of 4500ms
            while (sw.ElapsedMilliseconds < 4500 && !context.RequestAborted.IsCancellationRequested)
            {
                await Task.Delay(250, context.RequestAborted);
                await sendChunkAsync(context, "", isLegacyCompletion);

                var currentHw = _hardwareMonitor.GetHardwareData();
                double currentVram = 0;
                if (currentHw.TryGetValue("vram_used", out var cvObj) && double.TryParse(cvObj?.ToString(), System.Globalization.CultureInfo.InvariantCulture, out double parsedCv))
                {
                    currentVram = parsedCv;
                }

                // If memory has drained significantly or dropped to idle baseline
                if (sw.ElapsedMilliseconds >= 600 && (initialVram - currentVram >= 1.2 || currentVram <= 2.8))
                {
                    _processManager.Log($"[Proxy] VRAM drained to {currentVram:0.1} GB in {sw.ElapsedMilliseconds}ms. Headroom confirmed for SwarmUI.");
                    return;
                }
            }

            _processManager.Log($"[Proxy] VRAM drain wait completed ({sw.ElapsedMilliseconds}ms). Proceeding to SwarmUI.");
        }

        public static void ExtractPositiveAndNegative(string text, out string pos, out string neg, string defaultNeg)
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

        public static string InjectPromptIntoBody(string bodyJson, string injection, bool appendAssistantPrefill = false)
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
                        if (appendAssistantPrefill)
                        {
                            msgsList.Add(new Dictionary<string, object>
                            {
                                { "role", "assistant" },
                                { "content", "<think>\n</think>\n" }
                            });
                        }
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
