using System;
using System.Text.Json;
using System.Threading.Tasks;

namespace LlamaServerControl.Backend
{
    public static class VoiceStudioTools
    {
        public static object GetToolDefinition()
        {
            return new
            {
                name = "generate_speech",
                description = "Generate natural human speech audio from text using VoiceStudio. Use whenever the user asks to speak aloud, read something, create voice audio, or synthesize speech.",
                parameters = new
                {
                    type = "object",
                    properties = new
                    {
                        text = new
                        {
                            type = "string",
                            description = "The text to speak out loud."
                        },
                        voice = new
                        {
                            type = "string",
                            description = "Voice profile or stock name (e.g. 'Narrator', 'Storyteller', 'Casual', 'News Anchor', 'Whisper'). Optional."
                        },
                        speed = new
                        {
                            type = "number",
                            description = "Playback speech rate (0.5 to 2.0, default 1.0). Optional."
                        },
                        instruct = new
                        {
                            type = "string",
                            description = "Tone or style instruction (e.g. 'warm and gentle', 'excited', 'whispering'). Optional."
                        },
                        language = new
                        {
                            type = "string",
                            description = "Language code ('en', 'ar', 'es', 'fr', etc.). Optional, default 'en'."
                        }
                    },
                    required = new[] { "text" }
                }
            };
        }

        public static async Task<object> ExecuteAsync(VoiceStudioService voiceService, JsonElement args)
        {
            try
            {
                string text = "";
                if (args.TryGetProperty("text", out var tp) || args.TryGetProperty("input", out tp) || args.TryGetProperty("prompt", out tp))
                {
                    text = tp.GetString() ?? "";
                }

                if (string.IsNullOrWhiteSpace(text))
                {
                    return new { status = "error", message = "Missing 'text' parameter for generate_speech." };
                }

                string? voice = null;
                if (args.TryGetProperty("voice", out var vp)) voice = vp.GetString();

                double speed = 1.0;
                if (args.TryGetProperty("speed", out var sp))
                {
                    if (sp.ValueKind == JsonValueKind.Number) speed = sp.GetDouble();
                    else if (double.TryParse(sp.GetString(), out var sVal)) speed = sVal;
                }

                string? instruct = null;
                if (args.TryGetProperty("instruct", out var ip)) instruct = ip.GetString();

                string? lang = null;
                if (args.TryGetProperty("language", out var lp)) lang = lp.GetString();

                var record = await voiceService.GenerateSpeechAsync(text, voice, speed, instruct, lang);

                // Build exact markup card tag for frontend chat stream and rendering
                string cardTag = $"[AUDIO_CARD:id=\"{record.Id}\", file=\"{record.RelativeUrl}\", voice=\"{record.Voice}\", prompt=\"{record.Text.Replace("\"", "\\\"")}\"]";

                return new
                {
                    status = "success",
                    id = record.Id,
                    file = record.RelativeUrl,
                    voice = record.Voice,
                    markup_tag = cardTag,
                    output = $"Generated speech audio using voice '{record.Voice}'.\n\n{cardTag}"
                };
            }
            catch (Exception ex)
            {
                return new
                {
                    status = "error",
                    message = $"Speech generation failed: {ex.Message}"
                };
            }
        }
    }
}
