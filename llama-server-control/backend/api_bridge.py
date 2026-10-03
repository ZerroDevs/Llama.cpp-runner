import webview
import os
import webbrowser

class ApiBridge:
    def __init__(self, config_manager, process_manager):
        self._config_manager = config_manager
        self._process_manager = process_manager
        self._window = None

    def set_window(self, window):
        self._window = window

    def get_config(self):
        return self._config_manager.get_config()

    def save_config(self, config_data):
        self._config_manager.save_config(config_data)
        return {"status": "success"}

    def select_binary(self):
        if not self._window:
            return None
        file_types = ('Executable Files (*.exe)', 'All Files (*.*)')
        result = self._window.create_file_dialog(webview.FileDialog.OPEN, allow_multiple=False, file_types=file_types)
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

    def open_web_chat(self, url):
        webbrowser.open(url)
        return {"status": "success"}
