import subprocess
import threading
import socket
import os
from backend.log_streamer import LogStreamer

class SwarmManager:
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
        cmd = [config.get("swarm_launcher_path")]
        
        # SwarmUI launch-windows.bat doesn't typically accept all args natively unless passed to the underlying program, 
        # but we pass what the user provides in extra_args.
        custom_args = config.get("swarm_extra_args", "").strip()
        if "--launch_mode" not in custom_args:
            cmd.extend(["--launch_mode", "none"])
            
        if custom_args:
            import shlex
            cmd.extend(shlex.split(custom_args))
            
        return cmd

    def start_swarm(self, config):
        if self.process and self.process.poll() is None:
            self.log_ui("[WARN] [SWARM] Attempted to start SwarmUI, but it is already running.")
            return {"status": "error", "message": "SwarmUI is already running."}
            
        binary = config.get("swarm_launcher_path")
        if not binary or not os.path.exists(binary):
            return {"status": "error", "message": "SwarmUI launcher not found. Please locate it."}
            
        port = int(config.get("swarm_port", 7801))
        host = config.get("swarm_host", "127.0.0.1")
        if self.is_port_in_use(port, host):
            return {"status": "error", "message": f"Port {port} is already in use on {host}."}

        cmd = self.build_command(config)
        
        self.log_ui(f"[INFO] [SWARM] Starting SwarmUI on {host}:{port}...")
        self.log_ui(f"[INFO] [SWARM] Command: {' '.join(cmd)}")
        
        try:
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startupinfo.wShowWindow = subprocess.SW_HIDE
            
            # SwarmUI's launch.bat needs to run in its own directory
            cwd = os.path.dirname(os.path.abspath(binary))
            
            self.process = subprocess.Popen(
                cmd,
                cwd=cwd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                startupinfo=startupinfo,
                creationflags=subprocess.CREATE_NO_WINDOW,
                text=True,
                bufsize=1,
                encoding='utf-8',
                errors='replace'
            )
            
            # We use a distinct prefix/channel for SwarmUI logs so the frontend can filter them
            self.log_streamer = LogStreamer(self.process.stdout, self.window, prefix="[SWARM] ")
            self.log_streamer.start()
            
            self.log_ui("[INFO] [SWARM] Subprocess spawned successfully. Binding LogStreamer...")
            return {"status": "success", "message": "SwarmUI started successfully."}
        except Exception as e:
            self.log_ui(f"[ERR] [SWARM] Failed to start SwarmUI: {str(e)}")
            return {"status": "error", "message": str(e)}

    def stop_swarm(self):
        if self.process:
            self.log_ui("[INFO] [SWARM] Stopping SwarmUI subprocess...")
            pid = self.process.pid
            
            try:
                import psutil
                parent = psutil.Process(pid)
                for child in parent.children(recursive=True):
                    child.kill()
                parent.kill()
            except Exception:
                try:
                    subprocess.run(
                        ["taskkill", "/F", "/T", "/PID", str(pid)],
                        creationflags=subprocess.CREATE_NO_WINDOW,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL
                    )
                except Exception:
                    pass
                    
            try:
                self.process.wait(timeout=2)
            except Exception:
                pass
            
            if self.log_streamer:
                self.log_streamer.stop()
                
            self.process = None
            self.log_streamer = None
            
        return {"status": "success", "message": "SwarmUI stopped."}

    def check_status(self):
        if self.process and self.process.poll() is None:
            return True
        return False
