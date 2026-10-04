import webview
import os
import webbrowser
import socket
from backend.hardware_monitor import HardwareMonitor
from backend.model_scanner import ModelScanner
from backend.startup_manager import StartupManager
from backend.vram_calculator import VRAMCalculator
from backend.hub_manager import HubManager
from backend.updater import Updater

class ApiBridge:
    def __init__(self, config_manager, process_manager):
        self._config_manager = config_manager
        self._process_manager = process_manager
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
