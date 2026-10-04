import subprocess
import threading
import time
import platform

try:
    import winreg
    HAS_WINREG = True
except ImportError:
    HAS_WINREG = False

try:
    import psutil
    HAS_PSUTIL = True
except ImportError:
    HAS_PSUTIL = False

class HardwareMonitor:
    def __init__(self):
        self.running = False
        self.thread = None
        self.last_data = {
            "gpu_name": "Unknown GPU",
            "gpu_used": 0,
            "gpu_total": 8192,
            "gpu_percent": 0,
            "cpu_name": "Unknown CPU",
            "cpu_cores": 0,
            "cpu_threads": 0,
            "ram_used": 0,
            "ram_total": 0,
            "ram_percent": 0,
            "cpu_percent": 0
        }
        
        # Static info fetch once
        self.last_data["cpu_name"] = self._get_cpu_name()
        if HAS_PSUTIL:
            self.last_data["cpu_cores"] = psutil.cpu_count(logical=False)
            self.last_data["cpu_threads"] = psutil.cpu_count(logical=True)
            
    def _get_cpu_name(self):
        if HAS_WINREG:
            try:
                key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
                name, _ = winreg.QueryValueEx(key, "ProcessorNameString")
                return name.strip()
            except:
                pass
        return platform.processor()

    def start(self):
        if self.running:
            return
        self.running = True
        self.thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self.thread.start()

    def stop(self):
        self.running = False

    def get_data(self):
        return self.last_data

    def _monitor_loop(self):
        while self.running:
            data = {}
            
            if HAS_PSUTIL:
                mem = psutil.virtual_memory()
                data["ram_used"] = round(mem.used / (1024 ** 3), 2)
                data["ram_total"] = round(mem.total / (1024 ** 3), 2)
                data["ram_percent"] = mem.percent
                data["cpu_percent"] = psutil.cpu_percent(interval=None)
            else:
                data["ram_used"] = 0
                data["ram_total"] = 0
                data["ram_percent"] = 0
                data["cpu_percent"] = 0
                
            try:
                result = subprocess.check_output(
                    ['nvidia-smi', '--query-gpu=name,memory.used,memory.total', '--format=csv,nounits,noheader'],
                    text=True, creationflags=subprocess.CREATE_NO_WINDOW
                )
                lines = result.strip().split('\n')
                if lines:
                    parts = lines[0].split(',')
                    if len(parts) >= 3:
                        name = parts[0].strip()
                        used = int(parts[1].strip())
                        total = int(parts[2].strip())
                        data["gpu_name"] = name
                        data["gpu_used"] = used
                        data["gpu_total"] = total
                        data["gpu_percent"] = round((used / total) * 100, 1) if total > 0 else 0
            except Exception:
                data["gpu_used"] = 0
                data["gpu_total"] = 8192
                data["gpu_percent"] = 0
                
            self.last_data.update(data)
            
            import gc
            gc.collect()
            time.sleep(3)
