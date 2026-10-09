using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;

namespace LlamaServerControl.Backend
{
    public class GeneratedAudioRecord
    {
        public string Id { get; set; } = Guid.NewGuid().ToString();
        public string Timestamp { get; set; } = DateTime.UtcNow.ToString("o");
        public string Filename { get; set; } = "";
        public string RelativeUrl { get; set; } = "";
        public string Voice { get; set; } = "default";
        public string Text { get; set; } = "";
        public double Speed { get; set; } = 1.0;
        public string? Instruct { get; set; }
        public string? Language { get; set; } = "en";
        public long SizeBytes { get; set; }
        public bool Starred { get; set; } = false;
        public string? Effect { get; set; }
    }

    public class VoiceStudioService
    {
        private readonly ConfigManager _config;
        private readonly string _audioDir;
        private readonly string _dbPath;
        private readonly List<GeneratedAudioRecord> _historyCache = new();
        private readonly object _lock = new();

        private readonly HttpClient _http = new(new SocketsHttpHandler
        {
            PooledConnectionLifetime = TimeSpan.FromMinutes(10),
            PooledConnectionIdleTimeout = TimeSpan.FromMinutes(2)
        })
        {
            Timeout = TimeSpan.FromMinutes(5)
        };

        private List<object>? _cachedVoices;
        private DateTime _lastVoiceFetch = DateTime.MinValue;

        public VoiceStudioService(ConfigManager config, string uiDir)
        {
            _config = config;

            string baseDir = Path.GetDirectoryName(_config.ConfigPath) ?? AppDomain.CurrentDomain.BaseDirectory;
            _dbPath = Path.Combine(baseDir, "voicestudio_history.db");

            _audioDir = Path.Combine(uiDir, "media", "audio");
            Directory.CreateDirectory(_audioDir);

            InitializeDatabase();
            LoadHistory();
        }

        public string BaseUrl
        {
            get
            {
                var cfg = _config.GetConfig();
                if (cfg.TryGetValue("voicestudio_url", out var u) && !string.IsNullOrWhiteSpace(u?.ToString()))
                {
                    return u.ToString()!.TrimEnd('/');
                }
                return "http://127.0.0.1:3900";
            }
        }

        private void InitializeDatabase()
        {
            try
            {
                using var conn = new SqliteConnection($"Data Source={_dbPath}");
                conn.Open();
                using var cmd = conn.CreateCommand();
                cmd.CommandText = @"
                    CREATE TABLE IF NOT EXISTS generated_audio (
                        id TEXT PRIMARY KEY,
                        timestamp TEXT NOT NULL,
                        filename TEXT NOT NULL,
                        relative_url TEXT NOT NULL,
                        voice TEXT NOT NULL,
                        text TEXT NOT NULL,
                        speed REAL NOT NULL,
                        instruct TEXT,
                        language TEXT,
                        size_bytes INTEGER NOT NULL,
                        starred INTEGER DEFAULT 0,
                        effect TEXT DEFAULT ''
                    );
                    CREATE INDEX IF NOT EXISTS idx_audio_timestamp ON generated_audio (timestamp DESC);
                ";
                cmd.ExecuteNonQuery();

                // Safe migrations for pre-existing tables
                try
                {
                    cmd.CommandText = "ALTER TABLE generated_audio ADD COLUMN starred INTEGER DEFAULT 0;";
                    cmd.ExecuteNonQuery();
                }
                catch { }

                try
                {
                    cmd.CommandText = "ALTER TABLE generated_audio ADD COLUMN effect TEXT DEFAULT '';";
                    cmd.ExecuteNonQuery();
                }
                catch { }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[VoiceStudio DB ERR] {ex.Message}");
            }
        }

        private void LoadHistory()
        {
            lock (_lock)
            {
                _historyCache.Clear();
                try
                {
                    using var conn = new SqliteConnection($"Data Source={_dbPath}");
                    conn.Open();
                    using var cmd = conn.CreateCommand();
                    cmd.CommandText = @"
                        SELECT id, timestamp, filename, relative_url, voice, text, speed, instruct, language, size_bytes,
                               COALESCE(starred, 0), COALESCE(effect, '')
                        FROM generated_audio
                        ORDER BY timestamp DESC
                        LIMIT 300;
                    ";
                    using var reader = cmd.ExecuteReader();
                    while (reader.Read())
                    {
                        _historyCache.Add(new GeneratedAudioRecord
                        {
                            Id = reader.GetString(0),
                            Timestamp = reader.GetString(1),
                            Filename = reader.GetString(2),
                            RelativeUrl = reader.GetString(3),
                            Voice = reader.GetString(4),
                            Text = reader.GetString(5),
                            Speed = reader.GetDouble(6),
                            Instruct = reader.IsDBNull(7) ? null : reader.GetString(7),
                            Language = reader.IsDBNull(8) ? null : reader.GetString(8),
                            SizeBytes = reader.GetInt64(9),
                            Starred = reader.GetInt32(10) == 1,
                            Effect = reader.IsDBNull(11) ? null : reader.GetString(11)
                        });
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[VoiceStudio Load ERR] {ex.Message}");
                }
            }
        }

        public async Task<object> CheckStatusAsync()
        {
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(4));
                var resp = await _http.GetAsync($"{BaseUrl}/health", cts.Token);
                if (resp.IsSuccessStatusCode)
                {
                    string json = await resp.Content.ReadAsStringAsync();
                    string device = "cuda";
                    string version = "";
                    try
                    {
                        using var doc = JsonDocument.Parse(json);
                        if (doc.RootElement.TryGetProperty("device", out var dp)) device = dp.GetString() ?? "cuda";
                        if (doc.RootElement.TryGetProperty("version", out var vp)) version = vp.GetString() ?? "";
                    }
                    catch { }

                    return new
                    {
                        online = true,
                        status_code = (int)resp.StatusCode,
                        device,
                        version,
                        url = BaseUrl
                    };
                }

                // Fallback to /profiles or /v1/audio/capabilities
                using var ctsFallback = new CancellationTokenSource(TimeSpan.FromSeconds(3));
                var respFallback = await _http.GetAsync($"{BaseUrl}/profiles", ctsFallback.Token);
                return new
                {
                    online = respFallback.IsSuccessStatusCode,
                    status_code = (int)respFallback.StatusCode,
                    url = BaseUrl
                };
            }
            catch (Exception ex)
            {
                // Secondary fallback attempt on /profiles
                try
                {
                    using var ctsRetry = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                    var retryResp = await _http.GetAsync($"{BaseUrl}/profiles", ctsRetry.Token);
                    if (retryResp.IsSuccessStatusCode)
                    {
                        return new
                        {
                            online = true,
                            status_code = (int)retryResp.StatusCode,
                            url = BaseUrl
                        };
                    }
                }
                catch { }

                return new
                {
                    online = false,
                    error = ex.Message,
                    url = BaseUrl
                };
            }
        }

        public async Task<List<object>> DiscoverVoicesAsync(bool forceRefresh = false)
        {
            if (!forceRefresh && _cachedVoices != null && (DateTime.UtcNow - _lastVoiceFetch).TotalSeconds < 30)
            {
                return _cachedVoices;
            }

            var merged = new List<object>();

            // 1. Fetch custom cloned/designed profiles (/profiles)
            try
            {
                using var cts1 = new CancellationTokenSource(TimeSpan.FromSeconds(4));
                var profilesResp = await _http.GetAsync($"{BaseUrl}/profiles", cts1.Token);
                if (profilesResp.IsSuccessStatusCode)
                {
                    string json = await profilesResp.Content.ReadAsStringAsync();
                    using var doc = JsonDocument.Parse(json);
                    if (doc.RootElement.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var el in doc.RootElement.EnumerateArray())
                        {
                            string id = el.TryGetProperty("id", out var idp) ? idp.GetString() ?? "" : "";
                            string name = el.TryGetProperty("name", out var np) ? np.GetString() ?? id : id;
                            string desc = el.TryGetProperty("description", out var dp) ? dp.GetString() ?? "" : "";
                            string gender = el.TryGetProperty("gender", out var gp) ? gp.GetString() ?? "Auto" : "Auto";
                            string lang = el.TryGetProperty("language", out var lp) ? lp.GetString() ?? "en" : "en";

                            if (!string.IsNullOrEmpty(name))
                            {
                                merged.Add(new
                                {
                                    id = !string.IsNullOrEmpty(id) ? id : name,
                                    name,
                                    type = "profile",
                                    gender,
                                    language = lang,
                                    description = desc
                                });
                            }
                        }
                    }
                }
            }
            catch { }

            // 2. Fetch stock & pre-loaded models (/v1/audio/voices)
            try
            {
                using var cts2 = new CancellationTokenSource(TimeSpan.FromSeconds(6));
                var voicesResp = await _http.GetAsync($"{BaseUrl}/v1/audio/voices", cts2.Token);
                if (voicesResp.IsSuccessStatusCode)
                {
                    string json = await voicesResp.Content.ReadAsStringAsync();
                    using var doc = JsonDocument.Parse(json);
                    
                    JsonElement items = doc.RootElement;
                    if (doc.RootElement.TryGetProperty("voices", out var vArr)) items = vArr;
                    else if (doc.RootElement.TryGetProperty("data", out var dArr)) items = dArr;

                    if (items.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var el in items.EnumerateArray())
                        {
                            string id = "";
                            string name = "";
                            string desc = "";
                            string gender = "Auto";
                            string lang = "en";

                            if (el.ValueKind == JsonValueKind.String)
                            {
                                id = el.GetString() ?? "";
                                name = id;
                            }
                            else if (el.ValueKind == JsonValueKind.Object)
                            {
                                id = el.TryGetProperty("id", out var idp) ? idp.GetString() ?? "" : "";
                                name = el.TryGetProperty("name", out var np) ? np.GetString() ?? id : id;
                                desc = el.TryGetProperty("description", out var dp) ? dp.GetString() ?? "" : "";
                                gender = el.TryGetProperty("gender", out var gp) ? gp.GetString() ?? "Auto" : "Auto";
                                lang = el.TryGetProperty("language", out var lp) ? lp.GetString() ?? "en" : "en";
                            }

                            if (!string.IsNullOrEmpty(name))
                            {
                                merged.Add(new
                                {
                                    id = !string.IsNullOrEmpty(id) ? id : name,
                                    name,
                                    type = "stock",
                                    gender,
                                    language = lang,
                                    description = desc
                                });
                            }
                        }
                    }
                }
            }
            catch { }

            // Fallback stock presets if VoiceStudio returned empty
            if (merged.Count == 0)
            {
                merged.Add(new { id = "Narrator", name = "Narrator", type = "stock", gender = "Male", language = "en", description = "Classic audiobook narrator" });
                merged.Add(new { id = "Storyteller", name = "Storyteller", type = "stock", gender = "Female", language = "en", description = "Warm expressive storyteller" });
                merged.Add(new { id = "Casual", name = "Casual", type = "stock", gender = "Female", language = "en", description = "Natural conversational tone" });
                merged.Add(new { id = "News Anchor", name = "News Anchor", type = "stock", gender = "Male", language = "en", description = "Clear crisp broadcaster" });
            }

            _cachedVoices = merged;
            _lastVoiceFetch = DateTime.UtcNow;
            return merged;
        }

        public async Task<GeneratedAudioRecord> GenerateSpeechAsync(
            string text,
            string? voice = null,
            double speed = 1.0,
            string? instruct = null,
            string? lang = null,
            string? effect = null,
            double? guidanceScale = null,
            int? numStep = null,
            long? seed = null)
        {
            if (string.IsNullOrWhiteSpace(text))
            {
                throw new ArgumentException("Input text cannot be empty.");
            }

            string chosenVoice = string.IsNullOrWhiteSpace(voice) ? "Narrator" : voice.Trim();
            double chosenSpeed = Math.Clamp(speed <= 0 ? 1.0 : speed, 0.25, 3.0);
            string chosenLang = string.IsNullOrWhiteSpace(lang) ? "en" : lang.Trim();
            string chosenInstruct = instruct ?? "";

            var payloadDict = new Dictionary<string, object>
            {
                ["model"] = "omnivoice",
                ["input"] = text,
                ["voice"] = chosenVoice,
                ["response_format"] = "mp3",
                ["speed"] = chosenSpeed,
                ["instruct"] = chosenInstruct,
                ["language"] = chosenLang
            };

            if (!string.IsNullOrWhiteSpace(effect) && effect != "raw")
            {
                payloadDict["effect_preset"] = effect;
            }
            if (guidanceScale.HasValue && guidanceScale.Value > 0)
            {
                payloadDict["guidance_scale"] = guidanceScale.Value;
            }
            if (numStep.HasValue && numStep.Value > 0)
            {
                payloadDict["num_step"] = numStep.Value;
            }
            if (seed.HasValue && seed.Value >= 0)
            {
                payloadDict["seed"] = seed.Value;
            }

            string jsonPayload = JsonSerializer.Serialize(payloadDict);
            using var content = new StringContent(jsonPayload, Encoding.UTF8, "application/json");

            var resp = await _http.PostAsync($"{BaseUrl}/v1/audio/speech", content);
            if (!resp.IsSuccessStatusCode)
            {
                string errText = await resp.Content.ReadAsStringAsync();
                throw new HttpRequestException($"VoiceStudio generation failed ({(int)resp.StatusCode}): {errText}");
            }

            string fileId = Guid.NewGuid().ToString("N")[..10];
            string filename = $"tts_{DateTime.UtcNow:yyyyMMdd_HHmmss}_{fileId}.mp3";
            string fullPath = Path.Combine(_audioDir, filename);

            long bytesWritten = 0;
            // Stream incoming MP3 directly into file on disk with zero bloat in RAM
            using (var stream = await resp.Content.ReadAsStreamAsync())
            using (var fileStream = new FileStream(fullPath, FileMode.Create, FileAccess.Write, FileShare.None, 32768, true))
            {
                await stream.CopyToAsync(fileStream);
                bytesWritten = fileStream.Length;
            }

            var record = new GeneratedAudioRecord
            {
                Id = Guid.NewGuid().ToString(),
                Timestamp = DateTime.UtcNow.ToString("o"),
                Filename = filename,
                RelativeUrl = $"/media/audio/{filename}",
                Voice = chosenVoice,
                Text = text,
                Speed = chosenSpeed,
                Instruct = chosenInstruct,
                Language = chosenLang,
                SizeBytes = bytesWritten,
                Effect = effect
            };

            SaveRecordToDb(record);

            lock (_lock)
            {
                _historyCache.Insert(0, record);
                if (_historyCache.Count > 300) _historyCache.RemoveAt(_historyCache.Count - 1);
            }

            return record;
        }

        private void SaveRecordToDb(GeneratedAudioRecord record)
        {
            try
            {
                using var conn = new SqliteConnection($"Data Source={_dbPath}");
                conn.Open();
                using var cmd = conn.CreateCommand();
                cmd.CommandText = @"
                    INSERT INTO generated_audio (id, timestamp, filename, relative_url, voice, text, speed, instruct, language, size_bytes, starred, effect)
                    VALUES ($id, $ts, $fn, $url, $voice, $text, $spd, $inst, $lang, $sz, $star, $eff);
                ";
                cmd.Parameters.AddWithValue("$id", record.Id);
                cmd.Parameters.AddWithValue("$ts", record.Timestamp);
                cmd.Parameters.AddWithValue("$fn", record.Filename);
                cmd.Parameters.AddWithValue("$url", record.RelativeUrl);
                cmd.Parameters.AddWithValue("$voice", record.Voice);
                cmd.Parameters.AddWithValue("$text", record.Text);
                cmd.Parameters.AddWithValue("$spd", record.Speed);
                cmd.Parameters.AddWithValue("$inst", (object?)record.Instruct ?? DBNull.Value);
                cmd.Parameters.AddWithValue("$lang", (object?)record.Language ?? DBNull.Value);
                cmd.Parameters.AddWithValue("$sz", record.SizeBytes);
                cmd.Parameters.AddWithValue("$star", record.Starred ? 1 : 0);
                cmd.Parameters.AddWithValue("$eff", (object?)record.Effect ?? DBNull.Value);
                cmd.ExecuteNonQuery();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[VoiceStudio Save DB ERR] {ex.Message}");
            }
        }

        public async Task<object> ParseVoiceDescriptionAsync(string description)
        {
            if (string.IsNullOrWhiteSpace(description))
            {
                return new { status = "error", message = "Description is empty" };
            }

            try
            {
                var payload = new { description };
                string json = JsonSerializer.Serialize(payload);
                using var content = new StringContent(json, Encoding.UTF8, "application/json");

                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                var resp = await _http.PostAsync($"{BaseUrl}/design/describe", content, cts.Token);
                if (resp.IsSuccessStatusCode)
                {
                    string respJson = await resp.Content.ReadAsStringAsync();
                    return JsonSerializer.Deserialize<object>(respJson) ?? new { };
                }
            }
            catch { }

            // Heuristic fallback parser if VoiceStudio describe endpoint is unreachable
            return FallbackParseDescription(description);
        }

        private object FallbackParseDescription(string d)
        {
            string lower = d.ToLowerInvariant();

            string gender = lower.Contains("female") || lower.Contains("woman") || lower.Contains("girl") || lower.Contains("lady") ? "Female"
                : (lower.Contains("male") || lower.Contains("man") || lower.Contains("guy") || lower.Contains("boy") ? "Male" : "Auto");

            string age = "Auto";
            if (lower.Contains("child") || lower.Contains("kid")) age = "Child";
            else if (lower.Contains("teen")) age = "Teenager";
            else if (lower.Contains("young")) age = "Young Adult";
            else if (lower.Contains("middle-aged") || lower.Contains("mature")) age = "Middle-aged";
            else if (lower.Contains("elder") || lower.Contains("old") || lower.Contains("grandpa") || lower.Contains("grandma")) age = "Elderly";

            string pitch = "Auto";
            if (lower.Contains("deep") || lower.Contains("very low")) pitch = "Very Low";
            else if (lower.Contains("low") || lower.Contains("raspy") || lower.Contains("baritone")) pitch = "Low";
            else if (lower.Contains("high")) pitch = "High";

            string style = lower.Contains("whisper") ? "Whisper" : "Auto";

            string accent = "Auto";
            if (lower.Contains("british") || lower.Contains("uk")) accent = "British";
            else if (lower.Contains("american") || lower.Contains("us")) accent = "American";
            else if (lower.Contains("australian") || lower.Contains("aussie")) accent = "Australian";
            else if (lower.Contains("canadian")) accent = "Canadian";
            else if (lower.Contains("indian")) accent = "Indian";
            else if (lower.Contains("chinese")) accent = "Chinese";
            else if (lower.Contains("japanese")) accent = "Japanese";
            else if (lower.Contains("portuguese")) accent = "Portuguese";
            else if (lower.Contains("russian")) accent = "Russian";

            return new
            {
                gender,
                age,
                pitch,
                style,
                english_accent = accent,
                dialect = "Auto"
            };
        }

        public async Task<object> GetArchetypesAsync()
        {
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(3));
                var resp = await _http.GetAsync($"{BaseUrl}/archetypes", cts.Token);
                if (resp.IsSuccessStatusCode)
                {
                    string json = await resp.Content.ReadAsStringAsync();
                    return JsonSerializer.Deserialize<object>(json) ?? new { };
                }
            }
            catch { }

            return new string[]
            {
                "Narrator", "Casual", "News Anchor", "Storyteller", "Corporate",
                "Energetic", "Authoritative", "Excited Child", "Whisper", "Surprised", "Elder"
            };
        }

        public async Task<object> RenderStoryAsync(JsonElement payload)
        {
            try
            {
                string storyTitle = "Story Render";
                string format = "mp3";

                // Build normalized chapters list adhering to VoiceStudio LongformRenderRequest schema
                var chaptersList = new List<object>();

                if (payload.ValueKind == JsonValueKind.Object)
                {
                    if (payload.TryGetProperty("title", out var tp) && !string.IsNullOrWhiteSpace(tp.GetString()))
                    {
                        storyTitle = tp.GetString()!;
                    }
                    if (payload.TryGetProperty("format", out var fp) && !string.IsNullOrWhiteSpace(fp.GetString()))
                    {
                        format = fp.GetString()!;
                    }

                    // 1. Check if payload already contains chapterized structures
                    if (payload.TryGetProperty("chapters", out var chaps) && chaps.ValueKind == JsonValueKind.Array && chaps.GetArrayLength() > 0)
                    {
                        foreach (var chap in chaps.EnumerateArray())
                        {
                            string cTitle = chap.TryGetProperty("title", out var ctp) ? ctp.GetString() ?? storyTitle : storyTitle;
                            var spansList = new List<object>();
                            if (chap.TryGetProperty("spans", out var spans) && spans.ValueKind == JsonValueKind.Array)
                            {
                                foreach (var span in spans.EnumerateArray())
                                {
                                    string vId = span.TryGetProperty("voice_id", out var vp) ? vp.GetString() ?? "Narrator" : "Narrator";
                                    string sText = span.TryGetProperty("text", out var txp) ? txp.GetString() ?? "" : "";
                                    if (!string.IsNullOrWhiteSpace(sText))
                                    {
                                        spansList.Add(new { voice_id = vId, text = sText });
                                    }
                                }
                            }
                            if (spansList.Count > 0)
                            {
                                chaptersList.Add(new { title = cTitle, spans = spansList });
                            }
                        }
                    }
                    // 2. Or flat lines array: { voice: "...", text: "..." }
                    else if (payload.TryGetProperty("lines", out var lines) && lines.ValueKind == JsonValueKind.Array)
                    {
                        var spansList = new List<object>();
                        foreach (var line in lines.EnumerateArray())
                        {
                            string vId = line.TryGetProperty("voice", out var vp) ? vp.GetString() ?? "Narrator" : "Narrator";
                            string sText = line.TryGetProperty("text", out var txp) ? txp.GetString() ?? "" : "";
                            if (!string.IsNullOrWhiteSpace(sText))
                            {
                                spansList.Add(new { voice_id = vId, text = sText });
                            }
                        }
                        if (spansList.Count > 0)
                        {
                            chaptersList.Add(new { title = storyTitle, spans = spansList });
                        }
                    }
                }

                if (chaptersList.Count == 0)
                {
                    return new { status = "error", message = "No dialogue or script lines provided." };
                }

                var requestObj = new
                {
                    format = format,
                    chapters = chaptersList
                };

                string json = JsonSerializer.Serialize(requestObj);
                using var content = new StringContent(json, Encoding.UTF8, "application/json");

                using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(10));
                var resp = await _http.PostAsync($"{BaseUrl}/longform/render", content, cts.Token);

                if (!resp.IsSuccessStatusCode)
                {
                    string err = await resp.Content.ReadAsStringAsync();
                    try
                    {
                        using var errDoc = JsonDocument.Parse(err);
                        if (errDoc.RootElement.TryGetProperty("detail", out var dt))
                        {
                            err = dt.ToString();
                        }
                    }
                    catch { }
                    return new { status = "error", message = err };
                }

                // If content is direct binary audio stream
                string contentType = resp.Content.Headers.ContentType?.MediaType ?? "";
                if (contentType.Contains("audio") || contentType.Contains("octet-stream"))
                {
                    string fileId = Guid.NewGuid().ToString("N")[..10];
                    string filename = $"story_{DateTime.UtcNow:yyyyMMdd_HHmmss}_{fileId}.mp3";
                    string fullPath = Path.Combine(_audioDir, filename);

                    using (var stream = await resp.Content.ReadAsStreamAsync())
                    using (var fs = new FileStream(fullPath, FileMode.Create, FileAccess.Write, FileShare.None, 32768, true))
                    {
                        await stream.CopyToAsync(fs);
                    }

                    var rec = new GeneratedAudioRecord
                    {
                        Id = Guid.NewGuid().ToString(),
                        Timestamp = DateTime.UtcNow.ToString("o"),
                        Filename = filename,
                        RelativeUrl = $"/media/audio/{filename}",
                        Voice = "Multi-Character",
                        Text = storyTitle,
                        Speed = 1.0,
                        Language = "en",
                        SizeBytes = new FileInfo(fullPath).Length
                    };

                    SaveRecordToDb(rec);
                    lock (_lock)
                    {
                        _historyCache.Insert(0, rec);
                        if (_historyCache.Count > 300) _historyCache.RemoveAt(_historyCache.Count - 1);
                    }

                    return new { status = "success", record = rec };
                }

                // Handle SSE (text/event-stream) or JSON response stream
                string responseText = await resp.Content.ReadAsStringAsync();
                string? outputAudioFilename = null;
                string? sseError = null;

                // Inspect SSE "data: ..." events
                var textLines = responseText.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
                foreach (var line in textLines)
                {
                    string trimmed = line.Trim();
                    if (trimmed.StartsWith("data:"))
                    {
                        string dataJson = trimmed.Substring(5).Trim();
                        if (string.IsNullOrEmpty(dataJson)) continue;
                        try
                        {
                            using var evtDoc = JsonDocument.Parse(dataJson);
                            var root = evtDoc.RootElement;
                            if (root.TryGetProperty("type", out var typeProp))
                            {
                                string t = typeProp.GetString() ?? "";
                                if (t == "done" && root.TryGetProperty("output", out var outProp))
                                {
                                    outputAudioFilename = outProp.GetString();
                                }
                                else if (t == "error" && root.TryGetProperty("error", out var errProp))
                                {
                                    sseError = errProp.GetString();
                                }
                            }
                        }
                        catch { }
                    }
                }

                if (!string.IsNullOrEmpty(sseError))
                {
                    return new { status = "error", message = sseError };
                }

                // If not extracted via SSE, try plain JSON
                if (string.IsNullOrEmpty(outputAudioFilename))
                {
                    try
                    {
                        using var doc = JsonDocument.Parse(responseText);
                        if (doc.RootElement.TryGetProperty("output", out var outP))
                        {
                            outputAudioFilename = outP.GetString();
                        }
                        else if (doc.RootElement.TryGetProperty("filename", out var fnP))
                        {
                            outputAudioFilename = fnP.GetString();
                        }
                    }
                    catch { }
                }

                // If we have the engine's output filename, download and persist it
                if (!string.IsNullOrEmpty(outputAudioFilename))
                {
                    var audioGet = await _http.GetAsync($"{BaseUrl}/audio/{outputAudioFilename}", cts.Token);
                    if (audioGet.IsSuccessStatusCode)
                    {
                        string fileId = Guid.NewGuid().ToString("N")[..10];
                        string localFilename = $"story_{DateTime.UtcNow:yyyyMMdd_HHmmss}_{fileId}.mp3";
                        string fullPath = Path.Combine(_audioDir, localFilename);

                        using (var stream = await audioGet.Content.ReadAsStreamAsync())
                        using (var fs = new FileStream(fullPath, FileMode.Create, FileAccess.Write, FileShare.None, 32768, true))
                        {
                            await stream.CopyToAsync(fs);
                        }

                        var rec = new GeneratedAudioRecord
                        {
                            Id = Guid.NewGuid().ToString(),
                            Timestamp = DateTime.UtcNow.ToString("o"),
                            Filename = localFilename,
                            RelativeUrl = $"/media/audio/{localFilename}",
                            Voice = "Multi-Character",
                            Text = storyTitle,
                            Speed = 1.0,
                            Language = "en",
                            SizeBytes = new FileInfo(fullPath).Length
                        };

                        SaveRecordToDb(rec);
                        lock (_lock)
                        {
                            _historyCache.Insert(0, rec);
                            if (_historyCache.Count > 300) _historyCache.RemoveAt(_historyCache.Count - 1);
                        }

                        return new { status = "success", record = rec };
                    }
                    else
                    {
                        return new { status = "error", message = $"Failed to download generated audio track: {audioGet.StatusCode}" };
                    }
                }

                return new { status = "error", message = "No audio output was produced by the engine." };
            }
            catch (Exception ex)
            {
                return new { status = "error", message = ex.Message };
            }
        }

        public async Task<object> FlushMemoryAsync()
        {
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(4));
                var resp = await _http.PostAsync($"{BaseUrl}/system/flush-memory?unload_model=true", null, cts.Token);
                return new
                {
                    status = resp.IsSuccessStatusCode ? "success" : "error",
                    status_code = (int)resp.StatusCode
                };
            }
            catch (Exception ex)
            {
                return new { status = "error", message = ex.Message };
            }
        }

        public List<GeneratedAudioRecord> GetHistory()
        {
            lock (_lock)
            {
                return _historyCache.ToList();
            }
        }

        public bool DeleteHistoryItem(string id)
        {
            if (string.IsNullOrWhiteSpace(id)) return false;

            GeneratedAudioRecord? toRemove = null;
            lock (_lock)
            {
                toRemove = _historyCache.FirstOrDefault(r => r.Id.Equals(id, StringComparison.OrdinalIgnoreCase));
                if (toRemove != null)
                {
                    _historyCache.Remove(toRemove);
                }
            }

            if (toRemove != null)
            {
                try
                {
                    string fullPath = Path.Combine(_audioDir, toRemove.Filename);
                    if (File.Exists(fullPath))
                    {
                        File.Delete(fullPath);
                    }
                }
                catch { }

                try
                {
                    using var conn = new SqliteConnection($"Data Source={_dbPath}");
                    conn.Open();
                    using var cmd = conn.CreateCommand();
                    cmd.CommandText = "DELETE FROM generated_audio WHERE id = $id;";
                    cmd.Parameters.AddWithValue("$id", id);
                    cmd.ExecuteNonQuery();
                    return true;
                }
                catch { }
            }

            return false;
        }

        public async Task<bool> ToggleStarRecordAsync(string id, bool starred)
        {
            if (string.IsNullOrWhiteSpace(id)) return false;

            lock (_lock)
            {
                var item = _historyCache.FirstOrDefault(x => x.Id == id);
                if (item != null) item.Starred = starred;
            }

            try
            {
                using var conn = new SqliteConnection($"Data Source={_dbPath}");
                conn.Open();
                using var cmd = conn.CreateCommand();
                cmd.CommandText = "UPDATE generated_audio SET starred = $starred WHERE id = $id;";
                cmd.Parameters.AddWithValue("$starred", starred ? 1 : 0);
                cmd.Parameters.AddWithValue("$id", id);
                cmd.ExecuteNonQuery();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[VoiceStudio Star DB ERR] {ex.Message}");
            }

            // Sync with engine backend if possible
            try
            {
                var payload = new { starred };
                string json = JsonSerializer.Serialize(payload);
                using var content = new StringContent(json, Encoding.UTF8, "application/json");
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(3));
                await _http.PutAsync($"{BaseUrl}/history/{id}/starred", content, cts.Token);
            }
            catch { }

            return true;
        }

        public async Task<object> GetModelInfoAsync()
        {
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(3));
                var respStatus = await _http.GetAsync($"{BaseUrl}/model/status", cts.Token);
                var respLoaded = await _http.GetAsync($"{BaseUrl}/model/loaded", cts.Token);

                object? statusObj = null;
                object? loadedObj = null;

                if (respStatus.IsSuccessStatusCode)
                {
                    string j = await respStatus.Content.ReadAsStringAsync();
                    statusObj = JsonSerializer.Deserialize<object>(j);
                }
                if (respLoaded.IsSuccessStatusCode)
                {
                    string j = await respLoaded.Content.ReadAsStringAsync();
                    loadedObj = JsonSerializer.Deserialize<object>(j);
                }

                return new
                {
                    status = statusObj ?? new { },
                    loaded = loadedObj ?? new { }
                };
            }
            catch (Exception ex)
            {
                return new { error = ex.Message };
            }
        }

        public async Task<object> UnloadModelAsync(string modelId = "tts")
        {
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                var resp = await _http.PostAsync($"{BaseUrl}/model/unload/{modelId}", null, cts.Token);
                if (resp.IsSuccessStatusCode)
                {
                    string res = await resp.Content.ReadAsStringAsync();
                    return JsonSerializer.Deserialize<object>(res) ?? new { success = true };
                }
                // Fallback to flush-memory
                var respFlush = await _http.PostAsync($"{BaseUrl}/system/flush-memory?unload_model=true", null, cts.Token);
                return new { success = respFlush.IsSuccessStatusCode, status_code = (int)respFlush.StatusCode };
            }
            catch (Exception ex)
            {
                return new { success = false, error = ex.Message };
            }
        }

        public async Task<object> GetEffectsPresetsAsync()
        {
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(3));
                var resp = await _http.GetAsync($"{BaseUrl}/tools/effects", cts.Token);
                if (resp.IsSuccessStatusCode)
                {
                    string json = await resp.Content.ReadAsStringAsync();
                    return JsonSerializer.Deserialize<object>(json) ?? new object[0];
                }
            }
            catch { }

            return new object[]
            {
                new { id = "raw", label = "Raw", icon = "🔇", description = "No processing - model output as-is." },
                new { id = "broadcast", label = "Broadcast", icon = "📻", description = "Radio standard - warm, compressed, clear." },
                new { id = "cinematic", label = "Cinematic", icon = "🎬", description = "Film-quality - spacious reverb, gentle compression." },
                new { id = "podcast", label = "Podcast", icon = "🎙️", description = "Close-mic intimate - heavy compression." },
                new { id = "warm", label = "Warm", icon = "☀️", description = "Boosted low-mids, cozy feel." },
                new { id = "bright", label = "Bright", icon = "✨", description = "Crisp high-end presence." }
            };
        }

        public async Task<object> GetPersonalitiesAsync()
        {
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(3));
                var resp = await _http.GetAsync($"{BaseUrl}/personalities", cts.Token);
                if (resp.IsSuccessStatusCode)
                {
                    string json = await resp.Content.ReadAsStringAsync();
                    return JsonSerializer.Deserialize<object>(json) ?? new object[0];
                }
            }
            catch { }

            return new object[0];
        }

        public async Task<object> GetProfilesAsync()
        {
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(3));
                var resp = await _http.GetAsync($"{BaseUrl}/profiles", cts.Token);
                if (resp.IsSuccessStatusCode)
                {
                    string json = await resp.Content.ReadAsStringAsync();
                    return JsonSerializer.Deserialize<object>(json) ?? new object[0];
                }
            }
            catch { }

            return new object[0];
        }

        public async Task<object> CreateProfileAsync(string name, string? audioFilePath, string? refText, string? instruct, string? language)
        {
            try
            {
                using var form = new MultipartFormDataContent();
                form.Add(new StringContent(name), "name");
                form.Add(new StringContent("clone"), "kind");
                if (!string.IsNullOrWhiteSpace(refText)) form.Add(new StringContent(refText), "ref_text");
                if (!string.IsNullOrWhiteSpace(instruct)) form.Add(new StringContent(instruct), "instruct");
                if (!string.IsNullOrWhiteSpace(language)) form.Add(new StringContent(language), "language");

                if (!string.IsNullOrWhiteSpace(audioFilePath) && File.Exists(audioFilePath))
                {
                    var fileBytes = await File.ReadAllBytesAsync(audioFilePath);
                    var fileContent = new ByteArrayContent(fileBytes);
                    string ext = Path.GetExtension(audioFilePath).ToLowerInvariant();
                    string mediaType = ext switch
                    {
                        ".mp3" => "audio/mpeg",
                        ".ogg" => "audio/ogg",
                        ".flac" => "audio/flac",
                        ".m4a" => "audio/mp4",
                        _ => "audio/wav"
                    };
                    fileContent.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(mediaType);
                    form.Add(fileContent, "ref_audio", Path.GetFileName(audioFilePath));
                }

                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
                var resp = await _http.PostAsync($"{BaseUrl}/profiles", form, cts.Token);
                string resStr = await resp.Content.ReadAsStringAsync();
                if (resp.IsSuccessStatusCode)
                {
                    _cachedVoices = null;
                    return JsonSerializer.Deserialize<object>(resStr) ?? new { status = "success" };
                }
                return new { status = "error", message = resStr };
            }
            catch (Exception ex)
            {
                return new { status = "error", message = ex.Message };
            }
        }

        public async Task<object> DeleteProfileAsync(string profileId)
        {
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                var resp = await _http.DeleteAsync($"{BaseUrl}/profiles/{profileId}", cts.Token);
                _cachedVoices = null;
                return new { success = resp.IsSuccessStatusCode, status_code = (int)resp.StatusCode };
            }
            catch (Exception ex)
            {
                return new { success = false, error = ex.Message };
            }
        }

        public async Task<object> ConvertSpeechAsync(string sourceAudioPath, string profileId, bool matchDuration = true, bool cleanFirst = false)
        {
            try
            {
                if (!File.Exists(sourceAudioPath))
                {
                    return new { status = "error", message = "Source audio file does not exist." };
                }

                string audioToUse = sourceAudioPath;

                if (cleanFirst)
                {
                    var cleaned = await CleanAudioAsync(sourceAudioPath);
                    if (cleaned != null && cleaned.TryGetValue("full_path", out var cp) && File.Exists(cp?.ToString()))
                    {
                        audioToUse = cp.ToString()!;
                    }
                }

                using var form = new MultipartFormDataContent();
                form.Add(new StringContent(profileId), "profile_id");
                form.Add(new StringContent(matchDuration.ToString().ToLowerInvariant()), "match_duration");

                var fileBytes = await File.ReadAllBytesAsync(audioToUse);
                var fileContent = new ByteArrayContent(fileBytes);
                fileContent.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("audio/wav");
                form.Add(fileContent, "audio", Path.GetFileName(audioToUse));

                using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(3));
                var resp = await _http.PostAsync($"{BaseUrl}/convert", form, cts.Token);

                if (!resp.IsSuccessStatusCode)
                {
                    string errStr = await resp.Content.ReadAsStringAsync();
                    return new { status = "error", message = errStr };
                }

                string json = await resp.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(json);
                string audioUrl = doc.RootElement.TryGetProperty("audio_url", out var aup) ? aup.GetString() ?? "" : "";
                string convText = doc.RootElement.TryGetProperty("text", out var txp) ? txp.GetString() ?? "Converted Speech" : "Converted Speech";

                string fileId = Guid.NewGuid().ToString("N")[..10];
                string localFilename = $"convert_{DateTime.UtcNow:yyyyMMdd_HHmmss}_{fileId}.wav";
                string fullPath = Path.Combine(_audioDir, localFilename);

                string fetchUrl = audioUrl.StartsWith("http") ? audioUrl : $"{BaseUrl}{audioUrl}";
                var getResp = await _http.GetAsync(fetchUrl, cts.Token);
                if (getResp.IsSuccessStatusCode)
                {
                    using (var stream = await getResp.Content.ReadAsStreamAsync())
                    using (var fs = new FileStream(fullPath, FileMode.Create, FileAccess.Write, FileShare.None, 32768, true))
                    {
                        await stream.CopyToAsync(fs);
                    }
                }

                var rec = new GeneratedAudioRecord
                {
                    Id = Guid.NewGuid().ToString(),
                    Timestamp = DateTime.UtcNow.ToString("o"),
                    Filename = localFilename,
                    RelativeUrl = $"/media/audio/{localFilename}",
                    Voice = $"Profile:{profileId}",
                    Text = convText,
                    Speed = 1.0,
                    Language = "en",
                    SizeBytes = File.Exists(fullPath) ? new FileInfo(fullPath).Length : 0,
                    Effect = "Speech-to-Speech"
                };

                SaveRecordToDb(rec);
                lock (_lock) _historyCache.Insert(0, rec);

                return new { status = "success", record = rec };
            }
            catch (Exception ex)
            {
                return new { status = "error", message = ex.Message };
            }
        }

        public async Task<Dictionary<string, object>?> CleanAudioAsync(string sourceAudioPath)
        {
            try
            {
                if (!File.Exists(sourceAudioPath)) return null;

                using var form = new MultipartFormDataContent();
                var fileBytes = await File.ReadAllBytesAsync(sourceAudioPath);
                var fileContent = new ByteArrayContent(fileBytes);
                fileContent.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("audio/wav");
                form.Add(fileContent, "file", Path.GetFileName(sourceAudioPath));

                using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(2));
                var resp = await _http.PostAsync($"{BaseUrl}/clean-audio", form, cts.Token);
                if (!resp.IsSuccessStatusCode) return null;

                string fileId = Guid.NewGuid().ToString("N")[..10];
                string localFilename = $"clean_{DateTime.UtcNow:yyyyMMdd_HHmmss}_{fileId}.wav";
                string fullPath = Path.Combine(_audioDir, localFilename);

                using (var stream = await resp.Content.ReadAsStreamAsync())
                using (var fs = new FileStream(fullPath, FileMode.Create, FileAccess.Write, FileShare.None, 32768, true))
                {
                    await stream.CopyToAsync(fs);
                }

                return new Dictionary<string, object>
                {
                    ["filename"] = localFilename,
                    ["relative_url"] = $"/media/audio/{localFilename}",
                    ["full_path"] = fullPath
                };
            }
            catch
            {
                return null;
            }
        }

        public string GetAudioFilePath(string filename)
        {
            return Path.Combine(_audioDir, filename);
        }
    }
}
