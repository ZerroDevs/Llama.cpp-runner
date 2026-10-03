import os
import sys
import webview
from backend.api_bridge import ApiBridge
from backend.config_manager import ConfigManager
from backend.process_manager import ProcessManager

def get_base_path():
    if getattr(sys, 'frozen', False):
        return sys._MEIPASS
    return os.path.dirname(os.path.abspath(__file__))

def main():
    base_path = get_base_path()
    ui_path = os.path.join(base_path, 'ui', 'index.html')
    
    config_manager = ConfigManager(os.path.join(base_path, 'config.json'))
    process_manager = ProcessManager()
    api = ApiBridge(config_manager, process_manager)
    
    window = webview.create_window(
        'Llama Server Control',
        f'file://{ui_path}',
        js_api=api,
        width=1000,
        height=800,
        min_size=(800, 600)
    )
    
    api.set_window(window)
    process_manager.set_window(window)
    
    webview.start(debug=False)

if __name__ == '__main__':
    main()
