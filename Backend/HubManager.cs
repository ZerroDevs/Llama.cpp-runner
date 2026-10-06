using System;
using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace LlamaServerControl.Backend
{
    public class HubManager
    {
        private readonly HttpClient _http = new();
        private CancellationTokenSource? _downloadCts;

        public Dictionary<string, object> DownloadProgress { get; private set; } = new()
        {
            { "active", false }
        };

        public async Task<List<Dictionary<string, object>>> SearchModelsAsync(string query, bool uncensored = false, int limit = 12)
        {
            var results = new List<Dictionary<string, object>>();
            try
            {
                string q = query.Trim();
                if (uncensored && !q.Contains("uncensored", StringComparison.OrdinalIgnoreCase))
                {
                    q += " uncensored";
                }

                string url = $"https://huggingface.co/api/models?search={Uri.EscapeDataString(q)}&filter=gguf&limit={limit}&full=false";
                _http.DefaultRequestHeaders.UserAgent.ParseAdd("LlamaServerControl/1.0");

                var resp = await _http.GetStringAsync(url);
                using var doc = JsonDocument.Parse(resp);

                foreach (var el in doc.RootElement.EnumerateArray())
                {
                    string id = el.GetProperty("id").GetString() ?? "";
                    int downloads = el.TryGetProperty("downloads", out var d) ? d.GetInt32() : 0;
                    int likes = el.TryGetProperty("likes", out var l) ? l.GetInt32() : 0;

                    results.Add(new Dictionary<string, object>
                    {
                        { "id", id },
                        { "modelId", id },
                        { "downloads", downloads },
                        { "likes", likes }
                    });
                }
            }
            catch { }

            return results;
        }

        public async Task<List<string>> ListFilesAsync(string repoId)
        {
            var files = new List<string>();
            try
            {
                string url = $"https://huggingface.co/api/models/{repoId}";
                _http.DefaultRequestHeaders.UserAgent.ParseAdd("LlamaServerControl/1.0");

                var resp = await _http.GetStringAsync(url);
                using var doc = JsonDocument.Parse(resp);

                if (doc.RootElement.TryGetProperty("siblings", out var siblings))
                {
                    foreach (var s in siblings.EnumerateArray())
                    {
                        string rfilename = s.GetProperty("rfilename").GetString() ?? "";
                        if (rfilename.EndsWith(".gguf", StringComparison.OrdinalIgnoreCase))
                        {
                            files.Add(rfilename);
                        }
                    }
                }
            }
            catch { }

            return files;
        }

        public Task<bool> StartDownloadAsync(string repoId, string filename, string destDir)
        {
            _downloadCts?.Cancel();
            _downloadCts = new CancellationTokenSource();
            var ct = _downloadCts.Token;

            if (string.IsNullOrWhiteSpace(destDir) || !Directory.Exists(destDir))
            {
                destDir = AppDomain.CurrentDomain.BaseDirectory;
            }

            string destFile = Path.Combine(destDir, filename);
            string url = $"https://huggingface.co/{repoId}/resolve/main/{filename}";

            DownloadProgress = new Dictionary<string, object>
            {
                { "active", true },
                { "filename", filename },
                { "percent", 0 },
                { "speed", "Starting..." },
                { "eta", "Calculating..." }
            };

            _ = Task.Run(async () =>
            {
                try
                {
                    using var response = await _http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
                    response.EnsureSuccessStatusCode();

                    long? totalBytes = response.Content.Headers.ContentLength;
                    using var contentStream = await response.Content.ReadAsStreamAsync(ct);
                    using var fileStream = new FileStream(destFile, FileMode.Create, FileAccess.Write, FileShare.None, 81920, true);

                    byte[] buffer = new byte[81920];
                    long totalRead = 0;
                    int bytesRead;
                    var sw = System.Diagnostics.Stopwatch.StartNew();
                    long lastRead = 0;

                    while ((bytesRead = await contentStream.ReadAsync(buffer.AsMemory(0, buffer.Length), ct)) > 0)
                    {
                        await fileStream.WriteAsync(buffer.AsMemory(0, bytesRead), ct);
                        totalRead += bytesRead;

                        if (sw.ElapsedMilliseconds > 1000)
                        {
                            double elapsedSec = sw.Elapsed.TotalSeconds;
                            double speedBps = (totalRead - lastRead) / elapsedSec;
                            lastRead = totalRead;
                            sw.Restart();

                            double speedMb = speedBps / (1024 * 1024);
                            int pct = totalBytes.HasValue && totalBytes.Value > 0
                                ? (int)((totalRead * 100) / totalBytes.Value)
                                : 0;

                            string etaStr = "Unknown";
                            if (totalBytes.HasValue && speedBps > 0)
                            {
                                long remaining = totalBytes.Value - totalRead;
                                int secLeft = (int)(remaining / speedBps);
                                etaStr = $"{secLeft / 60}m {secLeft % 60}s";
                            }

                            DownloadProgress = new Dictionary<string, object>
                            {
                                { "active", true },
                                { "filename", filename },
                                { "percent", pct },
                                { "speed", $"{speedMb:F1} MB/s" },
                                { "eta", etaStr }
                            };
                        }
                    }

                    DownloadProgress = new Dictionary<string, object>
                    {
                        { "active", false },
                        { "percent", 100 },
                        { "completed", true }
                    };
                }
                catch
                {
                    DownloadProgress = new Dictionary<string, object> { { "active", false } };
                }
            }, ct);

            return Task.FromResult(true);
        }
    }
}
