import os
import sys
import webview
import threading
import atexit
import signal
import logging
import ctypes
from backend.api_bridge import ApiBridge

logging.basicConfig(filename='exit_trace.log', level=logging.DEBUG)

from backend.config_manager import ConfigManager
from backend.process_manager import ProcessManager
from backend.swarm_manager import SwarmManager
from backend.llama_proxy import LlamaProxyServer

try:
    import pystray
    from PIL import Image, ImageDraw
    HAS_PYSTRAY = True
except ImportError:
    HAS_PYSTRAY = False

def create_tray_image():
    # Simple green circle if no logo
    image = Image.new('RGB', (64, 64), (2, 21, 26))
    d = ImageDraw.Draw(image)
    d.ellipse((16, 16, 48, 48), fill=(0, 229, 153))
    return image

def setup_tray(window, process_manager, swarm_manager, config_manager):
    import webbrowser

    def on_open(icon, item):
        window.show()
        window.restore()

    def on_toggle_server(icon, item):
        if process_manager.check_status():
            process_manager.stop_server()
            icon.notify("Server stopped.", title="Llama Server Control")
        else:
            config = config_manager.get_config()
            result = process_manager.start_server(config)
            if result.get("status") == "error":
                icon.notify(f"Start Error: {result.get('message')}", title="Llama Server Control")
            else:
                icon.notify("Server started successfully.", title="Llama Server Control")

    def on_open_web_ui(icon, item):
        port = config_manager.get_config().get("port", 8080)
        webbrowser.open(f"http://127.0.0.1:{port}")

    def on_open_swarmui(icon, item):
        cfg = config_manager.get_config()
        port = cfg.get("swarm_port", 7801)
        host = cfg.get("swarm_host", "127.0.0.1")
        if not host: host = "127.0.0.1"
        webbrowser.open(f"http://{host}:{port}/")

    def on_exit(icon, item):
        icon.stop()
        process_manager.stop_server()
        swarm_manager.stop_swarm()
        window.destroy()
        os._exit(0)

    menu = pystray.Menu(
        pystray.MenuItem('Open Dashboard', on_open, default=True),
        pystray.MenuItem(
            lambda item: 'Stop Server' if process_manager.check_status() else 'Start Server',
            on_toggle_server
        ),
        pystray.MenuItem(
            'Open Web Chat UI',
            on_open_web_ui,
            visible=lambda item: process_manager.check_status()
        ),
        pystray.MenuItem(
            'Open SwarmUI Web',
            on_open_swarmui,
            visible=lambda item: swarm_manager.check_status()
        ),
        pystray.MenuItem('Exit', on_exit)
    )
    
    icon = pystray.Icon("LlamaServerControl", create_tray_image(), "Llama Server Control", menu)
    threading.Thread(target=icon.run, daemon=True).start()
    return icon

def get_asset_path():
    if getattr(sys, 'frozen', False):
        return sys._MEIPASS
    return os.path.dirname(os.path.abspath(__file__))

def get_data_path():
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))

def main():
    asset_path = get_asset_path()
    data_path = get_data_path()
    ui_path = os.path.join(asset_path, 'ui', 'index.html')
    
    config_manager = ConfigManager(os.path.join(data_path, 'config.json'))
    process_manager = ProcessManager()
    swarm_manager = SwarmManager()
    api = ApiBridge(config_manager, process_manager, swarm_manager)
    
    window_width = 1200
    window_height = 850
    x = 0
    y = 0
    try:
        user32 = ctypes.windll.user32
        screen_width = user32.GetSystemMetrics(0)
        screen_height = user32.GetSystemMetrics(1)
        x = max(0, (screen_width - window_width) // 2)
        y = max(0, (screen_height - window_height) // 2)
    except Exception:
        pass

    window = webview.create_window(
        'Llama Server Control',
        f'file://{ui_path}',
        js_api=api,
        width=window_width,
        height=window_height,
        min_size=(1000, 700),
        x=x,
        y=y
    )
    
    api.set_window(window)
    process_manager.set_window(window)
    swarm_manager.set_window(window)

    proxy_server = LlamaProxyServer(process_manager, config_manager)
    proxy_server.start()

    def force_cleanup(signum=None, frame=None):
        logging.debug(f"force_cleanup called with signum={signum}")
        process_manager.stop_server()
        swarm_manager.stop_swarm()
        proxy_server.stop()
        os._exit(0)

    atexit.register(process_manager.stop_server)
    atexit.register(swarm_manager.stop_swarm)
    try:
        signal.signal(signal.SIGINT, force_cleanup)
        signal.signal(signal.SIGTERM, force_cleanup)
        signal.signal(signal.SIGBREAK, force_cleanup)
    except Exception:
        pass

    if HAS_PYSTRAY:
        tray_icon = setup_tray(window, process_manager, swarm_manager, config_manager)
        
        def on_closing():
            logging.debug("on_closing called")
            if config_manager.get_config().get("minimize_to_tray", False):
                logging.debug("minimize_to_tray is True, hiding window")
                try:
                    window.hide()
                except Exception:
                    pass
                try:
                    tray_icon.notify(
                        "App is still running in the background.",
                        title="Llama Server Control"
                    )
                except Exception:
                    pass
                return False
                
            logging.debug("closing: hiding window immediately and stopping processes")
            try:
                window.hide()
            except Exception:
                pass
            try:
                process_manager.stop_server()
                swarm_manager.stop_swarm()
                proxy_server.stop()
                tray_icon.stop()
            except Exception:
                pass
            os._exit(0)
            return True
            
        def on_closed():
            logging.debug("on_closed called")
            try:
                process_manager.stop_server()
                swarm_manager.stop_swarm()
                proxy_server.stop()
                if HAS_PYSTRAY:
                    tray_icon.stop()
            except Exception:
                pass
            os._exit(0)
            
        def on_minimized():
            logging.debug("on_minimized called")
            if config_manager.get_config().get("minimize_to_tray", False):
                try:
                    window.hide()
                except Exception:
                    pass
                try:
                    tray_icon.notify(
                        "App is still running in the background.",
                        title="Llama Server Control"
                    )
                except Exception:
                    pass

        window.events.closing += on_closing
        window.events.closed += on_closed
        window.events.minimized += on_minimized
    else:
        def on_closing():
            try:
                window.hide()
            except Exception:
                pass
            try:
                process_manager.stop_server()
                swarm_manager.stop_swarm()
                proxy_server.stop()
            except Exception:
                pass
            os._exit(0)
            return True
            
        def on_closed():
            try:
                process_manager.stop_server()
                swarm_manager.stop_swarm()
                proxy_server.stop()
            except Exception:
                pass
            os._exit(0)
            
        window.events.closing += on_closing
        window.events.closed += on_closed
    
    def on_loaded():
        if '--startup' in sys.argv:
            try:
                import threading
                threading.Timer(0.5, window.hide).start()
                def do_notify():
                    if HAS_PYSTRAY:
                        tray_icon.notify("Running in background.", "Llama Server Auto-Start")
                threading.Timer(2.0, do_notify).start()
                
                # Auto-start the server on Windows startup
                config = config_manager.get_config()
                process_manager.start_server(config)
            except Exception as e:
                logging.debug(f"Startup error: {e}")

    window.events.loaded += on_loaded
    # Attempt to force edgechromium with low memory footprint if supported by pywebview
    try:
        webview.start(debug=False, gui='edgechromium')
    except:
        webview.start(debug=False)

if __name__ == '__main__':
    main()
