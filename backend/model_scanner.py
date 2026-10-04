import os
import re

class ModelScanner:
    @staticmethod
    def scan_directory(root_dir):
        if not root_dir or not os.path.exists(root_dir):
            return {"status": "error", "message": "Directory not found."}
            
        models = []
        for dirpath, _, filenames in os.walk(root_dir):
            for file in filenames:
                if file.lower().endswith(".gguf"):
                    full_path = os.path.join(dirpath, file)
                    size_bytes = os.path.getsize(full_path)
                    size_gb = round(size_bytes / (1024 ** 3), 2)
                    
                    quant_match = re.search(r'(q[234568]_[01k_m]+|f16|f32|nvfp4|bf16)', file, re.IGNORECASE)
                    quant_tag = quant_match.group(1).upper() if quant_match else "UNKNOWN"
                    
                    is_mmproj = "mmproj" in file.lower()
                    
                    models.append({
                        "name": file,
                        "path": full_path,
                        "size_gb": size_gb,
                        "quant": quant_tag,
                        "is_mmproj": is_mmproj
                    })
        return {"status": "success", "models": models}
