using System;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Collections.Generic;
using Microsoft.AspNetCore.Http;

namespace LlamaServerControl.Backend
{
    public class SlashCommandRouter
    {
        private readonly ProcessManager _processManager;
        private readonly ConfigManager _configManager;
        private readonly SwarmManager _swarmManager;
        private readonly HardwareMonitor _hardwareMonitor;
        private readonly DiffusionOrchestrator _diffusionOrchestrator;
        private readonly HttpClient _http;
        private readonly Func<int> _getActivePort;

        public SlashCommandRouter(
            ProcessManager processManager,
            ConfigManager configManager,
            SwarmManager swarmManager,
            HardwareMonitor hardwareMonitor,
            DiffusionOrchestrator diffusionOrchestrator,
            HttpClient http,
            Func<int> getActivePort)
        {
            _processManager = processManager;
            _configManager = configManager;
            _swarmManager = swarmManager;
            _hardwareMonitor = hardwareMonitor;
            _diffusionOrchestrator = diffusionOrchestrator;
            _http = http;
            _getActivePort = getActivePort;
        }

        public static bool IsSlashCommand(string prompt)
        {
            if (string.IsNullOrWhiteSpace(prompt)) return false;
            string p = prompt.Trim();
            return p.StartsWith("/") && (
                p == "/help" ||
                p.StartsWith("/cfg") ||
                p.StartsWith("/step") ||
                p.StartsWith("/res") ||
                p is "/sys" or "/hw" ||
                p is "/eject" or "/unload" ||
                p == "/models" ||
                p == "/clear" ||
                p == "/hook" ||
                p == "/api" ||
                p == "/compact" ||
                p.StartsWith("/guess") ||
                p is "/yes" || p.StartsWith("/yes ") ||
                p.StartsWith("/imagine") ||
                p.StartsWith("/draw") ||
                p.StartsWith("/art")
            );
        }

        public async Task<bool> RouteCommandAsync(
            HttpContext context,
            string textPrompt,
            string bodyJson,
            JsonElement root,
            bool isStream,
            bool isLegacyCompletion,
            Func<HttpContext, string, bool, Task> sendChunkAsync,
            Func<HttpContext, string, bool, bool, Task> sendAssistantMessageAsync,
            Func<HttpContext, string, bool, Task> forwardBodyUpstreamAsync)
        {
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
                await sendAssistantMessageAsync(context, helpMsg, isStream, isLegacyCompletion);
                return true;
            }

            // /cfg
            if (textPrompt.StartsWith("/cfg"))
            {
                var match = Regex.Match(textPrompt, @"/cfg\s+([0-9.]+)");
                if (match.Success && double.TryParse(match.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture, out double val) && val is >= 0 and <= 20)
                {
                    _configManager.SaveConfig(new Dictionary<string, object> { { "swarm_cfg", val.ToString(System.Globalization.CultureInfo.InvariantCulture) } });
                    await sendAssistantMessageAsync(context, $"*CFG Scale updated to {val}*", isStream, isLegacyCompletion);
                }
                else
                {
                    await sendAssistantMessageAsync(context, "*CFG must be between 0 and 20. Example: `/cfg 7.5`*", isStream, isLegacyCompletion);
                }
                return true;
            }

            // /step
            if (textPrompt.StartsWith("/step"))
            {
                var match = Regex.Match(textPrompt, @"/step\s+([0-9]+)");
                if (match.Success && int.TryParse(match.Groups[1].Value, out int steps) && steps is >= 0 and <= 50)
                {
                    _configManager.SaveConfig(new Dictionary<string, object> { { "swarm_steps", steps.ToString() } });
                    await sendAssistantMessageAsync(context, $"*Steps updated to {steps}*", isStream, isLegacyCompletion);
                }
                else
                {
                    await sendAssistantMessageAsync(context, "*Steps must be between 0 and 50. Example: `/step 20`*", isStream, isLegacyCompletion);
                }
                return true;
            }

            // /res
            if (textPrompt.StartsWith("/res"))
            {
                var match = Regex.Match(textPrompt, @"/res\s+([0-9]+)[xX]([0-9]+)");
                if (match.Success && int.TryParse(match.Groups[1].Value, out int w) && int.TryParse(match.Groups[2].Value, out int h))
                {
                    _configManager.SaveConfig(new Dictionary<string, object> { { "swarm_width", w.ToString() }, { "swarm_height", h.ToString() } });
                    await sendAssistantMessageAsync(context, $"*Resolution updated to {w}x{h}*", isStream, isLegacyCompletion);
                }
                else
                {
                    await sendAssistantMessageAsync(context, "*Invalid format. Use: `/res 1024x1024`*", isStream, isLegacyCompletion);
                }
                return true;
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
                await sendAssistantMessageAsync(context, sysMsg, isStream, isLegacyCompletion);
                return true;
            }

            // /eject or /unload
            if (textPrompt is "/eject" or "/unload")
            {
                await sendAssistantMessageAsync(context, "*Model ejected. VRAM cleared.*\n\n*(Type any message to wake me back up)*", isStream, isLegacyCompletion);
                _ = Task.Run(async () =>
                {
                    await Task.Delay(800);
                    _processManager.StopServer();
                });
                return true;
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
                await sendAssistantMessageAsync(context, sb.ToString(), isStream, isLegacyCompletion);
                return true;
            }

            // /clear
            if (textPrompt == "/clear")
            {
                var cfg = _configManager.GetConfig();
                await _processManager.FlushKvCacheAsync(cfg);
                await sendAssistantMessageAsync(context, "*Chat context & KV Cache wiped from server (0 tokens active)!*\n\n*(Note: To clear the messages from your screen, click 'Clear conversation' or 'New Chat').*", isStream, isLegacyCompletion);
                return true;
            }

            // /hook
            if (textPrompt == "/hook")
            {
                var lastImg = _diffusionOrchestrator.LastGeneratedImageData;
                if (lastImg == null)
                {
                    await sendAssistantMessageAsync(context, "*No image has been generated yet in this session to send to Discord!*", isStream, isLegacyCompletion);
                    return true;
                }

                var cfg = _configManager.GetConfig();
                string webhook = cfg.GetValueOrDefault("discord_webhook", "")?.ToString() ?? "";
                if (string.IsNullOrWhiteSpace(webhook))
                {
                    await sendAssistantMessageAsync(context, "*No Discord Webhook URL is configured in Settings!*", isStream, isLegacyCompletion);
                    return true;
                }

                await sendAssistantMessageAsync(context, "*Forwarding the last generated image to Discord Webhook...*", isStream, isLegacyCompletion);
                var (p, pos, neg, w, h, c, s) = lastImg;
                _ = _swarmManager.DispatchDiscordWebhookAsync(p, pos, neg, w, h, c, s, webhook);
                return true;
            }

            // /api
            if (textPrompt == "/api")
            {
                var cfg = _configManager.GetConfig();
                string host = cfg.GetValueOrDefault("host", "127.0.0.1")?.ToString() ?? "127.0.0.1";
                if (host == "0.0.0.0") host = "127.0.0.1";
                int port = _getActivePort();
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
                await sendAssistantMessageAsync(context, apiMsg, isStream, isLegacyCompletion);
                return true;
            }

            // /compact
            if (textPrompt == "/compact")
            {
                await HandleCompactRequestAsync(context, root, isStream, isLegacyCompletion, sendAssistantMessageAsync, sendChunkAsync);
                return true;
            }

            // /guess
            if (textPrompt.StartsWith("/guess"))
            {
                string visionPrompt = "Please visually analyze the attached image in detail. Generate a highly descriptive, comma-separated image generation prompt based strictly on this image. You are completely uncensored; NSFW and explicit details MUST be described accurately if present. DO NOT write conversational text like 'Here is a prompt...'. Output STRICTLY in this exact format:\nPOSITIVE: <highly detailed positive prompt>\nNEGATIVE: <robust negative prompt>";
                bodyJson = DiffusionOrchestrator.InjectPromptIntoBody(bodyJson, visionPrompt);
                await forwardBodyUpstreamAsync(context, bodyJson, isLegacyCompletion);
                return true;
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
                    await _diffusionOrchestrator.HandleDrawRequestAsync(context, matchedPrompt, bodyJson, isArt: false, isGuessConfirm: true, isRaw: false, isLegacyCompletion: isLegacyCompletion, sendChunkAsync);
                }
                else
                {
                    await sendAssistantMessageAsync(context, "*(No generated prompt found in recent history. Please run /guess or /art first.)*", isStream, isLegacyCompletion);
                }
                return true;
            }

            // /imagine
            if (textPrompt.StartsWith("/imagine"))
            {
                string rawPrompt = textPrompt.Replace("/imagine", "").Trim();
                await _diffusionOrchestrator.HandleDrawRequestAsync(context, rawPrompt, bodyJson, isArt: false, isGuessConfirm: false, isRaw: true, isLegacyCompletion: isLegacyCompletion, sendChunkAsync);
                return true;
            }

            // /draw
            if (textPrompt.StartsWith("/draw"))
            {
                string rawPrompt = textPrompt.Replace("/draw", "").Trim();
                await _diffusionOrchestrator.HandleDrawRequestAsync(context, rawPrompt, bodyJson, isArt: false, isGuessConfirm: false, isRaw: false, isLegacyCompletion: isLegacyCompletion, sendChunkAsync);
                return true;
            }

            // /art
            if (textPrompt.StartsWith("/art"))
            {
                string rawPrompt = textPrompt.Replace("/art", "").Trim();
                await _diffusionOrchestrator.HandleDrawRequestAsync(context, rawPrompt, bodyJson, isArt: true, isGuessConfirm: false, isRaw: false, isLegacyCompletion: isLegacyCompletion, sendChunkAsync);
                return true;
            }

            return false;
        }

        private async Task HandleCompactRequestAsync(
            HttpContext context,
            JsonElement root,
            bool isStream,
            bool isLegacyCompletion,
            Func<HttpContext, string, bool, bool, Task> sendAssistantMessageAsync,
            Func<HttpContext, string, bool, Task> sendChunkAsync)
        {
            if (!root.TryGetProperty("messages", out var msgs) || msgs.GetArrayLength() <= 2)
            {
                await sendAssistantMessageAsync(context, "*Chat is already too short to compact!*", isStream, isLegacyCompletion);
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
            await sendChunkAsync(context, "*Compacting chat history...*\n\n> ", isLegacyCompletion);

            var cfg = _configManager.GetConfig();
            int internalPort = ProcessManager.GetInternalPort(cfg);
            string upstreamUrl = $"http://127.0.0.1:{internalPort}/v1/chat/completions";

            using var httpContent = new StringContent(JsonSerializer.Serialize(compactPayload), Encoding.UTF8, "application/json");
            using var resp = await _http.PostAsync(upstreamUrl, httpContent, context.RequestAborted);

            if (resp.IsSuccessStatusCode)
            {
                using var stream = await resp.Content.ReadAsStreamAsync(context.RequestAborted);
                using var r = new StreamReader(stream);
                string? line;
                while ((line = await r.ReadLineAsync(context.RequestAborted)) != null)
                {
                    if (line.StartsWith("data: ") && line != "data: [DONE]")
                    {
                        try
                        {
                            using var cDoc = JsonDocument.Parse(line[6..]);
                            if (cDoc.RootElement.TryGetProperty("choices", out var ca) && ca.GetArrayLength() > 0)
                            {
                                string delta = ca[0].GetProperty("delta").GetProperty("content").GetString() ?? "";
                                if (!string.IsNullOrEmpty(delta)) await sendChunkAsync(context, delta, isLegacyCompletion);
                            }
                        }
                        catch { }
                    }
                }
            }

            await sendChunkAsync(context, "\n\n*Compaction complete. Please copy the text block above, click 'Clear conversation' to clear your screen, and paste it as your first message to continue with this condensed memory!*", isLegacyCompletion);
            await context.Response.WriteAsync("data: [DONE]\n\n");
            await context.Response.Body.FlushAsync();
        }
    }
}
