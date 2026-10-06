using System;
using System.IO;
using System.Text.Json;
using System.Collections.Generic;

namespace LlamaServerControl.Backend
{
    public class ConfigManager
    {
        private readonly string _configPath;
        private readonly object _lock = new object();
        private Dictionary<string, object> _cachedConfig;

        public ConfigManager(string configPath)
        {
            _configPath = configPath;
            _cachedConfig = LoadFromFile();
        }

        private Dictionary<string, object> GetDefaultConfig()
        {
            return new Dictionary<string, object>
            {
                { "model_path", "" },
                { "server_path", "" },
                { "models_dir", "" },
                { "context_size", 4096 },
                { "threads", 8 },
                { "gpu_layers", 99 },
                { "batch_size", 512 },
                { "ubatch_size", 512 },
                { "port", 8080 },
                { "host", "127.0.0.1" },
                { "flash_attention", true },
                { "cache_type_k", "f16" },
                { "cache_type_v", "f16" },
                { "mmproj_path", "" },
                { "custom_args", "" },
                { "swarm_launcher_path", "" },
                { "swarm_host", "127.0.0.1" },
                { "swarm_port", 7801 },
                { "swarm_width", 1024 },
                { "swarm_height", 1024 },
                { "swarm_steps", 25 },
                { "swarm_cfg", 3.5 },
                { "swarm_open_browser", false },
                { "swarm_extra_args", "" },
                { "discord_webhook", "" },
                { "minimize_to_tray", false },
                { "run_on_startup", false },
                { "language", "en" }
            };
        }

        private Dictionary<string, object> LoadFromFile()
        {
            lock (_lock)
            {
                if (File.Exists(_configPath))
                {
                    try
                    {
                        string json = File.ReadAllText(_configPath);
                        var parsed = JsonSerializer.Deserialize<Dictionary<string, object>>(json);
                        if (parsed != null)
                        {
                            var defaults = GetDefaultConfig();
                            foreach (var kvp in parsed)
                            {
                                defaults[kvp.Key] = kvp.Value;
                            }
                            return defaults;
                        }
                    }
                    catch { }
                }
                return GetDefaultConfig();
            }
        }

        public Dictionary<string, object> GetConfig()
        {
            lock (_lock)
            {
                return new Dictionary<string, object>(_cachedConfig);
            }
        }

        public void SaveConfig(Dictionary<string, object> newConfig)
        {
            lock (_lock)
            {
                foreach (var kvp in newConfig)
                {
                    _cachedConfig[kvp.Key] = kvp.Value;
                }
                try
                {
                    string? dir = Path.GetDirectoryName(_configPath);
                    if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                    {
                        Directory.CreateDirectory(dir);
                    }
                    string json = JsonSerializer.Serialize(_cachedConfig, new JsonSerializerOptions { WriteIndented = true });
                    File.WriteAllText(_configPath, json);
                }
                catch { }
            }
        }
    }
}
