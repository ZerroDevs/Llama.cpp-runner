import webview
import os
import webbrowser
import socket
import time
from backend.hardware_monitor import HardwareMonitor
from backend.model_scanner import ModelScanner
from backend.startup_manager import StartupManager
from backend.vram_calculator import VRAMCalculator
from backend.hub_manager import HubManager
from backend.updater import Updater

class ApiBridge:
    def __init__(self, config_manager, process_manager, swarm_manager):
        self._config_manager = config_manager
        self._process_manager = process_manager
        self._swarm_manager = swarm_manager
        self._hardware_monitor = HardwareMonitor()
        self._hardware_monitor.start()
        self._window = None
        self._hub_manager = HubManager(self)
        self._updater = Updater(process_manager)

    def set_window(self, window):
        self._window = window

    def get_config(self):
        return self._config_manager.get_config()

    def save_config(self, config_data):
        self._config_manager.save_config(config_data)
        
        # Handle Windows Startup integration
        run_on_startup = config_data.get('run_on_startup', False)
        if run_on_startup:
            StartupManager.enable_startup()
        else:
            StartupManager.disable_startup()
            
        return {"status": "success"}

    def select_binary(self):
        if not self._window:
            return None
        file_types = ('Executable Files (*.exe)', 'All Files (*.*)')
        result = self._window.create_file_dialog(webview.FileDialog.OPEN, allow_multiple=False, file_types=file_types)
        if result and len(result) > 0:
            return result[0]
        return None

    def select_directory(self):
        if not self._window:
            return None
        result = self._window.create_file_dialog(webview.FileDialog.FOLDER, allow_multiple=False)
        if result and len(result) > 0:
            return result[0]
        return None

    def select_model(self):
        if not self._window:
            return None
        file_types = ('GGUF Models (*.gguf)', 'All Files (*.*)')
        result = self._window.create_file_dialog(webview.FileDialog.OPEN, allow_multiple=False, file_types=file_types)
        if result and len(result) > 0:
            return result[0]
        return None

    def select_mmproj(self):
        if not self._window:
            return None
        file_types = ('Vision Projectors (*.gguf)', 'All Files (*.*)')
        result = self._window.create_file_dialog(webview.FileDialog.OPEN, allow_multiple=False, file_types=file_types)
        if result and len(result) > 0:
            return result[0]
        return None

    def start_server(self, config):
        self._config_manager.save_config(config)
        return self._process_manager.start_server(config)

    def stop_server(self):
        return self._process_manager.stop_server()

    def check_status(self):
        return self._process_manager.check_status()

    def calculate_vram(self, model_path, context_size, batch_size, kv_k, kv_v):
        if not model_path:
            return {"status": "error", "message": "No model selected."}
        try:
            return VRAMCalculator.estimate_vram(
                model_path,
                int(context_size),
                int(batch_size),
                kv_k,
                kv_v
            )
        except Exception as e:
            return {"status": "error", "message": str(e)}

    # Hub Methods
    def search_hub(self, query, uncensored=False, limit=12):
        return self._hub_manager.search_models(query, uncensored, limit)

    def list_hub_files(self, repo_id):
        return self._hub_manager.list_files(repo_id)

    def download_hub_file(self, repo_id, filename, dest_dir):
        return self._hub_manager.start_download(repo_id, filename, dest_dir)

    def get_download_progress(self):
        return self._hub_manager.get_download_progress()
        
    # Updater
    def update_llama_server(self):
        return self._updater.update_server()

    def open_web_chat(self, url):
        webbrowser.open(url)
        return {"status": "success"}

    def get_lan_ip(self):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.connect(("8.8.8.8", 80))
                return s.getsockname()[0]
        except Exception:
            return "127.0.0.1"

    def scan_models(self, root_dir):
        return ModelScanner.scan_directory(root_dir)

    def get_hardware_data(self):
        return self._hardware_monitor.get_data()

    # SwarmUI specific functions
    def select_swarm_launcher(self):
        if not self._window:
            return None
        file_types = ('SwarmUI Launcher (*.bat;*.cmd;*.exe)', 'All files (*.*)')
        result = self._window.create_file_dialog(webview.FileDialog.OPEN, allow_multiple=False, file_types=file_types)
        if result and len(result) > 0:
            return result[0]
        return None

    def start_swarm(self, config):
        return self._swarm_manager.start_swarm(config)

    def stop_swarm(self):
        return self._swarm_manager.stop_swarm()

    def get_swarm_status(self):
        return self._swarm_manager.check_status()
        
    def open_swarm_ui(self):
        port = self.get_config().get("swarm_port", 7801)
        webbrowser.open(f"http://127.0.0.1:{port}")
        return {"status": "success"}

    def get_swarm_images(self):
        try:
            config = self.get_config()
            swarm_bat = config.get('swarm_launcher_path', '')
            if not swarm_bat or not os.path.exists(swarm_bat):
                return []
            
            swarm_dir = os.path.dirname(swarm_bat)
            raw_dir = os.path.join(swarm_dir, 'Output', 'local', 'raw')
            if not os.path.exists(raw_dir):
                return []
            
            image_files = []
            for root, dirs, files in os.walk(raw_dir):
                for f in files:
                    if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
                        image_files.append(os.path.join(root, f))
                        
            image_files.sort(key=lambda x: os.path.getmtime(x), reverse=True)
            image_files = image_files[:100] # Limit to 100
            
            result = []
            import base64
            for img_path in image_files:
                try:
                    with open(img_path, 'rb') as f:
                        b64 = base64.b64encode(f.read()).decode('utf-8')
                        ext = os.path.splitext(img_path)[1].lower().replace('.', '')
                        if ext == 'jpg': ext = 'jpeg'
                        
                        # Get folder name securely
                        folder = os.path.basename(os.path.dirname(img_path))
                        
                        result.append({
                            "path": img_path,
                            "folder": folder,
                            "data": f"data:image/{ext};base64,{b64}"
                        })
                except:
                    pass
            return result
        except:
            return []

    def delete_image(self, path):
        try:
            if os.path.exists(path) and "SwarmUI" in path:
                os.remove(path)
                return {"status": "success"}
        except:
            pass
        return {"status": "error"}

    def open_image_folder(self, path):
        try:
            if os.path.exists(path):
                import subprocess
                # Select the file in explorer
                subprocess.Popen(f'explorer /select,"{path}"')
                return {"status": "success"}
        except:
            pass
        return {"status": "error"}

    def get_image_metadata(self, path):
        try:
            stats = os.stat(path)
            metadata = {
                "File Size": f"{stats.st_size / 1024:.2f} KB",
                "Created": time.ctime(stats.st_ctime)
            }
            if path.lower().endswith(".png"):
                with open(path, 'rb') as f:
                    if f.read(8) == b'\x89PNG\r\n\x1a\n':
                        while True:
                            try:
                                length_bytes = f.read(4)
                                if len(length_bytes) != 4: break
                                length = int.from_bytes(length_bytes, 'big')
                                chunk_type = f.read(4)
                                chunk_data = f.read(length)
                                crc = f.read(4)
                                
                                if chunk_type == b'tEXt':
                                    parts = chunk_data.split(b'\0', 1)
                                    if len(parts) == 2:
                                        k = parts[0].decode('latin-1', 'ignore').strip()
                                        v = parts[1].decode('latin-1', 'ignore').strip()
                                        if k and v: metadata[k] = v
                                elif chunk_type == b'iTXt':
                                    null1 = chunk_data.find(b'\0')
                                    if null1 != -1:
                                        k = chunk_data[:null1].decode('latin-1', 'ignore').strip()
                                        null2 = chunk_data.find(b'\0', null1 + 3)
                                        if null2 != -1:
                                            null3 = chunk_data.find(b'\0', null2 + 1)
                                            if null3 != -1:
                                                v = chunk_data[null3 + 1:].decode('utf-8', 'ignore').strip()
                                                if k and v: metadata[k] = v
                                elif chunk_type == b'IEND':
                                    break
                            except:
                                break
            return {"status": "success", "metadata": metadata}
        except Exception as e:
            return {"status": "error", "message": str(e)}
