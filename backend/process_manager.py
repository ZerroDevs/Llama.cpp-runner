import subprocess
import threading
import socket
import os
from backend.log_streamer import LogStreamer

class ProcessManager:
    def __init__(self):
        self.process = None
        self.log_streamer = None
        self.window = None

    def set_window(self, window):
        self.window = window

    def log_ui(self, msg):
        if self.window:
            try:
                import json
                safe_msg = json.dumps(msg)
                self.window.evaluate_js(f"window.receiveLog({safe_msg})")
            except Exception:
                pass

    def is_port_in_use(self, port, host):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            return s.connect_ex((host, port)) == 0

    def build_command(self, config):
        cmd = [config.get("server_binary")]
        
        model_path = config.get("model_path")
        if model_path:
            cmd.extend(["-m", model_path])
            
        loras = config.get("lora_adapters", "").split(",")
        for lora in loras:
            lora = lora.strip()
            if lora:
                cmd.extend(["--lora", lora])
            
        vision = config.get("vision_projector")
        if vision:
            cmd.extend(["--mmproj", vision])
            
        draft = config.get("draft_model")
        if draft:
            cmd.extend(["--model-draft", draft])
            
        cmd.extend(["-c", str(config.get("context_size", 8192))])
        cmd.extend(["-ngl", str(config.get("gpu_layers", 99))])
        cmd.extend(["--port", str(int(config.get("port", 8080)) + 1)])
        
        if config.get("flash_attention"):
            cmd.extend(["-fa", "on"])
            
        cmd.extend(["-t", str(config.get("cpu_threads", 4))])
        cmd.extend(["-ctk", config.get("kv_cache_type_k", "f16")])
        cmd.extend(["-ctv", config.get("kv_cache_type_v", "f16")])
        cmd.extend(["-b", str(config.get("batch_size", 512))])
        cmd.extend(["-ub", str(config.get("ubatch_size", 2048))])
        cmd.extend(["--host", config.get("host", "127.0.0.1")])
        
        api_key = config.get("api_key")
        if api_key:
            cmd.extend(["--api-key", api_key])
            
        custom_args = config.get("custom_args", "").strip()
        if custom_args:
            import shlex
            cmd.extend(shlex.split(custom_args))
            
        return cmd

    def start_server(self, config):
        if self.process and self.process.poll() is None:
            self.log_ui("[WARN] [Llama] Attempted to start server, but it is already running.")
            return {"status": "error", "message": "Server is already running."}
            
        binary = config.get("server_binary")
        if not binary or not os.path.exists(binary):
            return {"status": "error", "message": "Server binary not found. Please locate llama-server.exe"}
            
        port = int(config.get("port", 8080)) + 1 # Internal port for proxy

        host = config.get("host", "127.0.0.1")
        if self.is_port_in_use(port, host):
            return {"status": "error", "message": f"Port {port} is already in use on {host}."}

        cmd = self.build_command(config)
        
        self.log_ui(f"[INFO] [Llama] Starting llama-server on {host}:{port}...")
        self.log_ui(f"[INFO] [Llama] Command: {' '.join(cmd)}")
        
        try:
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startupinfo.wShowWindow = subprocess.SW_HIDE
            
            self.process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                startupinfo=startupinfo,
                creationflags=subprocess.CREATE_NO_WINDOW,
                text=True,
                bufsize=1,
                encoding='utf-8',
                errors='replace'
            )
            
            self.log_streamer = LogStreamer(self.process.stdout, self.window)
            self.log_streamer.start()
            
            self.log_ui("[INFO] [Llama] Subprocess spawned successfully. Binding LogStreamer...")
            return {"status": "success", "message": "Server started successfully."}
        except Exception as e:
            self.log_ui(f"[ERR] [Llama] Failed to start server: {str(e)}")
            return {"status": "error", "message": str(e)}

    def stop_server(self):
        if self.process:
            self.log_ui("[INFO] [Llama] Stopping llama-server subprocess...")
            pid = self.process.pid
            
            try:
                subprocess.run(
                    ["taskkill", "/F", "/T", "/PID", str(pid)],
                    creationflags=subprocess.CREATE_NO_WINDOW,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL
                )
            except Exception:
                try:
                    import psutil
                    parent = psutil.Process(pid)
                    for child in parent.children(recursive=True):
                        child.kill()
                    parent.kill()
                except Exception:
                    pass
                    
            if self.log_streamer:
                self.log_streamer.stop()
                
            self.process = None
            self.log_streamer = None
            
        # Instant fallback for any orphaned llama-server.exe
        try:
            subprocess.run(
                ["taskkill", "/F", "/IM", "llama-server.exe"],
                creationflags=subprocess.CREATE_NO_WINDOW,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
        except Exception:
            pass
            
        return {"status": "success", "message": "Server stopped."}

    def flush_kv_cache(self, config):
        if not self.check_status():
            return {"status": "error", "message": "Server is not running."}
            
        port = int(config.get("port", 8080)) + 1 # internal port
        api_key = config.get("api_key", "")
        headers = {}
        if api_key:
            headers['Authorization'] = f"Bearer {api_key}"
            
        import requests
        slots_cleared = 0
        try:
            # 1. Query /slots to get active slots
            resp = requests.get(f"http://127.0.0.1:{port}/slots", headers=headers, timeout=3)
            if resp.status_code == 200:
                slots = resp.json()
                if isinstance(slots, list):
                    for slot in slots:
                        slot_id = slot.get('id', 0)
                        requests.post(f"http://127.0.0.1:{port}/slots/{slot_id}?action=erase", headers=headers, timeout=3)
                        slots_cleared += 1
            
            # 2. General slot flush fallbacks
            try:
                requests.post(f"http://127.0.0.1:{port}/slots/0?action=erase", headers=headers, timeout=2)
                requests.post(f"http://127.0.0.1:{port}/slots?action=erase", headers=headers, timeout=2)
            except Exception:
                pass
                
            self.log_ui(f"[INFO] [Llama] Flushed KV cache and context slots ({slots_cleared} slot(s) cleared to 0 tokens).")
            return {"status": "success", "message": f"Flushed {slots_cleared} slot(s) and cleared KV Cache." if slots_cleared else "Context & KV Cache wiped successfully."}
        except Exception as e:
            self.log_ui(f"[WARN] [Llama] Failed to flush slots: {str(e)}")
            return {"status": "error", "message": f"Failed to flush KV cache: {str(e)}"}

    def check_status(self):
        if self.process and self.process.poll() is None:
            return True
        return False
