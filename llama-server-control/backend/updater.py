import os
import sys
import zipfile
import urllib.request
import json
import logging
from .config_manager import ConfigManager

class Updater:
    def __init__(self, process_manager):
        self.process_manager = process_manager
        
    def update_server(self):
        # 1. Ensure server is stopped
        if self.process_manager.process and self.process_manager.process.poll() is None:
            return {"status": "error", "message": "Please stop the server before updating."}
            
        try:
            # 2. Get latest release from github
            url = "https://api.github.com/repos/ggerganov/llama.cpp/releases/latest"
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req) as response:
                data = json.loads(response.read().decode())
                
            # Find the Windows cu12 (CUDA 12) zip
            download_url = None
            for asset in data.get('assets', []):
                name = asset.get('name', '').lower()
                if 'win' in name and 'cu12' in name and name.endswith('.zip'):
                    download_url = asset.get('browser_download_url')
                    break
                    
            if not download_url:
                return {"status": "error", "message": "Could not find a CUDA 12 Windows build in the latest release."}
                
            # 3. Get directory to save to
            cm = ConfigManager()
            config = cm.get_config()
            target_bin = config.get("server_binary", "")
            
            if not target_bin or not os.path.exists(os.path.dirname(target_bin)):
                # Default to a new folder next to our app
                dest_dir = os.path.join(os.getcwd(), 'llama-bin')
                os.makedirs(dest_dir, exist_ok=True)
                target_bin = os.path.join(dest_dir, 'llama-server.exe')
            else:
                dest_dir = os.path.dirname(target_bin)
                
            zip_path = os.path.join(dest_dir, "update.zip")
            
            # 4. Download zip
            urllib.request.urlretrieve(download_url, zip_path)
            
            # 5. Extract llama-server.exe
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                # the zip contains a bunch of exes, we just need llama-server.exe
                # sometimes they are inside a folder, sometimes root.
                server_file = None
                for name in zip_ref.namelist():
                    if name.endswith('llama-server.exe'):
                        server_file = name
                        break
                        
                if not server_file:
                    os.remove(zip_path)
                    return {"status": "error", "message": "llama-server.exe not found in downloaded archive."}
                    
                # Extract specifically the server file
                source = zip_ref.open(server_file)
                # Overwrite the target binary
                with open(target_bin, "wb") as target:
                    target.write(source.read())
                    
            # 6. Clean up
            os.remove(zip_path)
            
            # 7. Update config if it was a new path
            if target_bin != config.get("server_binary"):
                config["server_binary"] = target_bin
                cm.save_config(config)
                
            return {"status": "success", "message": f"Successfully updated to {data.get('tag_name')}"}
            
        except Exception as e:
            logging.error(f"Update failed: {e}")
            return {"status": "error", "message": str(e)}
