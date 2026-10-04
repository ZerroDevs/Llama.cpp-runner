import json
import os
import threading

class ConfigManager:
    def __init__(self, config_path="config.json"):
        self.config_path = config_path
        self.lock = threading.Lock()
        self.default_config = {
            "server_binary": "",
            "model_path": "",
            "vision_projector": "",
            "context_size": "8192",
            "gpu_layers": 99,
            "port": 8080,
            "flash_attention": True,
            "cpu_threads": os.cpu_count() or 4,
            "kv_cache_type_k": "f16",
            "kv_cache_type_v": "f16",
            "batch_size": 512,
            "ubatch_size": 2048,
            "host": "127.0.0.1",
            "api_key": "",
            "custom_args": "",
            "theme": "dark",
            "language": "en",
            "models_dir": "",
            "minimize_to_tray": False
        }
        self.config = self.load_config()

    def load_config(self):
        with self.lock:
            if not os.path.exists(self.config_path):
                self._save_config(self.default_config)
                return self.default_config.copy()
            
            try:
                with open(self.config_path, "r", encoding="utf-8") as f:
                    config = json.load(f)
                    merged = self.default_config.copy()
                    merged.update(config)
                    return merged
            except Exception as e:
                print(f"Error loading config: {e}")
                return self.default_config.copy()

    def _save_config(self, config_data):
        try:
            with open(self.config_path, "w", encoding="utf-8") as f:
                json.dump(config_data, f, indent=4)
        except Exception as e:
            print(f"Error saving config: {e}")

    def save_config(self, new_config):
        with self.lock:
            self.config.update(new_config)
            self._save_config(self.config)

    def get_config(self):
        with self.lock:
            return self.config.copy()
