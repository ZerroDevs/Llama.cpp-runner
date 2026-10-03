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

    def is_port_in_use(self, port, host):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            return s.connect_ex((host, port)) == 0

    def build_command(self, config):
        cmd = [config.get("server_binary")]
        
        model_path = config.get("model_path")
        if model_path:
            cmd.extend(["-m", model_path])
            
        vision = config.get("vision_projector")
        if vision:
            cmd.extend(["--mmproj", vision])
            
        cmd.extend(["-c", str(config.get("context_size", 8192))])
        cmd.extend(["-ngl", str(config.get("gpu_layers", 99))])
        cmd.extend(["--port", str(config.get("port", 8080))])
        
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
            return {"status": "error", "message": "Server is already running."}
            
        binary = config.get("server_binary")
        if not binary or not os.path.exists(binary):
            return {"status": "error", "message": "Server binary not found. Please locate llama-server.exe"}
            
        port = int(config.get("port", 8080))
        host = config.get("host", "127.0.0.1")
        if self.is_port_in_use(port, host):
            return {"status": "error", "message": f"Port {port} is already in use on {host}."}

        cmd = self.build_command(config)
        
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
            
            return {"status": "success", "message": "Server started successfully."}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def stop_server(self):
        if self.process:
            try:
                self.process.terminate()
                self.process.wait(timeout=3)
            except Exception:
                pass
            try:
                if self.process.poll() is None:
                    self.process.kill()
            except Exception:
                pass
            
            if self.log_streamer:
                self.log_streamer.stop()
                
            self.process = None
            self.log_streamer = None
            
        return {"status": "success", "message": "Server stopped."}

    def check_status(self):
        if self.process and self.process.poll() is None:
            return True
        return False
