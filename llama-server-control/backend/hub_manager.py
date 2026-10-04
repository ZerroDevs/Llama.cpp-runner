import os
import requests
import threading
from huggingface_hub import HfApi

class HubManager:
    def __init__(self, api_bridge):
        self.api = HfApi()
        self.download_thread = None
        self.download_progress = {
            "status": "idle",
            "progress": 0,
            "downloaded": 0,
            "total": 0,
            "filename": "",
            "repo_id": ""
        }
        self._api_bridge = api_bridge # For hardware info

    def search_models(self, query, uncensored=False, limit=12):
        try:
            filters = ["gguf"]
            if uncensored:
                filters.append("uncensored")
                
            models = list(self.api.list_models(search=query, filter=filters, limit=limit, sort="downloads"))
            
            hw = self._api_bridge.get_hardware_data()
            sys_ram_gb = hw.get("ram_total", 16.0)
            gpu_vram_gb = hw.get("gpu_total", 0.0) / 1024.0
            
            from concurrent.futures import ThreadPoolExecutor
            
            def process_model(m):
                try:
                    info = self.api.model_info(m.id, files_metadata=True)
                    # Find smallest gguf size
                    sizes = [s.size for s in info.siblings if s.rfilename.endswith('.gguf') and s.size]
                    if not sizes:
                        return m, 0, "Unknown", "text-textMuted"
                    
                    min_size_gb = min(sizes) / (1024**3)
                    req_gb = min_size_gb * 1.15 + 0.5
                    
                    if gpu_vram_gb > req_gb:
                        compat = "Full GPU"
                        color = "text-brand"
                    elif sys_ram_gb + gpu_vram_gb > req_gb:
                        compat = "Partial/CPU"
                        color = "text-amber-500"
                    else:
                        compat = "Too Large"
                        color = "text-red-500"
                        
                    return m, min_size_gb, compat, color
                except:
                    return m, 0, "Unknown", "text-textMuted"

            result = []
            with ThreadPoolExecutor(max_workers=12) as executor:
                for m, min_size_gb, compat, color in executor.map(process_model, models):
                    size_str = f"~{min_size_gb:.1f} GB" if min_size_gb > 0 else "Unknown Size"
                    result.append({
                        "id": m.id,
                        "downloads": m.downloads,
                        "likes": m.likes,
                        "size_str": size_str,
                        "compatibility": compat,
                        "color": color
                    })
                    
            return {"status": "success", "models": result}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def list_files(self, repo_id):
        try:
            info = self.api.model_info(repo_id, files_metadata=True)
            gguf_files = []
            
            hw = self._api_bridge.get_hardware_data()
            sys_ram_gb = hw.get("ram_total", 16.0)
            gpu_vram_gb = hw.get("gpu_total", 0.0) / 1024.0
            
            for s in info.siblings:
                if s.rfilename.endswith('.gguf') and s.size:
                    size_gb = s.size / (1024**3)
                    req_gb = size_gb * 1.15 + 0.5
                    
                    if gpu_vram_gb > req_gb:
                        compat = "Full GPU"
                        color = "text-brand"
                    elif sys_ram_gb + gpu_vram_gb > req_gb:
                        compat = "Partial/CPU"
                        color = "text-amber-500"
                    else:
                        compat = "Too Large"
                        color = "text-red-500"
                        
                    gguf_files.append({
                        "filename": s.rfilename,
                        "size": s.size,
                        "size_str": f"{size_gb:.1f} GB",
                        "compatibility": compat,
                        "color": color
                    })
                    
            return {"status": "success", "files": gguf_files}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def start_download(self, repo_id, filename, dest_dir):
        if self.download_progress["status"] == "downloading":
            return {"status": "error", "message": "A download is already in progress."}
            
        if not os.path.exists(dest_dir):
            return {"status": "error", "message": "Destination directory does not exist."}
            
        self.download_progress = {
            "status": "downloading",
            "progress": 0,
            "downloaded": 0,
            "total": 0,
            "filename": filename,
            "repo_id": repo_id
        }
        
        self.download_thread = threading.Thread(target=self._download_worker, args=(repo_id, filename, dest_dir), daemon=True)
        self.download_thread.start()
        
        return {"status": "success"}

    def _download_worker(self, repo_id, filename, dest_dir):
        url = f"https://huggingface.co/{repo_id}/resolve/main/{filename}?download=true"
        dest_path = os.path.join(dest_dir, filename.split('/')[-1])
        
        try:
            response = requests.get(url, stream=True, allow_redirects=True)
            response.raise_for_status()
            
            total_size = int(response.headers.get('content-length', 0))
            self.download_progress["total"] = total_size
            
            with open(dest_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192*4):
                    if not chunk:
                        break
                    f.write(chunk)
                    self.download_progress["downloaded"] += len(chunk)
                    if total_size > 0:
                        self.download_progress["progress"] = int((self.download_progress["downloaded"] / total_size) * 100)
                        
            self.download_progress["status"] = "finished"
        except Exception as e:
            self.download_progress["status"] = "error"
            self.download_progress["message"] = str(e)
            if os.path.exists(dest_path):
                os.remove(dest_path)

    def get_download_progress(self):
        return self.download_progress
