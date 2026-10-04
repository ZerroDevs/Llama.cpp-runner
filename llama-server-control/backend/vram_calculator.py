import os
import subprocess

try:
    import gguf
    import numpy as np
except ImportError:
    gguf = None
    np = None

class VRAMCalculator:
    @staticmethod
    def _extract_val(field, as_str=False):
        try:
            if not field or not hasattr(field, 'parts') or not hasattr(field, 'data'):
                return None
            idx = field.data[0]
            val = field.parts[idx]
            
            is_array = isinstance(val, (list, tuple)) or (np and isinstance(val, np.ndarray))
            
            if is_array:
                if as_str:
                    return bytes(val).decode('utf-8', errors='ignore')
                else:
                    return int(val[0]) if len(val) > 0 else 0
            if as_str:
                if isinstance(val, bytes):
                    return val.decode('utf-8', errors='ignore')
                return str(val)
            return int(val)
        except Exception:
            return None

    @staticmethod
    def _get_gpu_total_mb():
        try:
            result = subprocess.check_output(
                ['nvidia-smi', '--query-gpu=memory.total', '--format=csv,nounits,noheader'],
                text=True, creationflags=subprocess.CREATE_NO_WINDOW
            )
            lines = result.strip().split('\n')
            if lines:
                return int(lines[0].strip())
        except Exception:
            pass
        return 8192 # default 8GB fallback

    @staticmethod
    def estimate_vram(model_path, context_size, batch_size=512, kv_cache_type_k="f16", kv_cache_type_v="f16"):
        if not os.path.exists(model_path):
            return {"status": "error", "message": "Model not found."}

        file_size_gb = os.path.getsize(model_path) / (1024**3)
        
        block_count = 32
        embd_length = 4096
        head_count_kv = 8
        
        if gguf:
            try:
                reader = gguf.GGUFReader(model_path)
                
                arch_field = reader.fields.get('general.architecture')
                arch = VRAMCalculator._extract_val(arch_field, as_str=True) if arch_field else 'llama'
                if not arch:
                    arch = 'llama'
                    
                bc = VRAMCalculator._extract_val(reader.fields.get(f'{arch}.block_count'))
                if bc: block_count = bc
                
                el = VRAMCalculator._extract_val(reader.fields.get(f'{arch}.embedding_length'))
                if el: embd_length = el
                
                hckv = VRAMCalculator._extract_val(reader.fields.get(f'{arch}.attention.head_count_kv'))
                if hckv: 
                    head_count_kv = hckv
                else:
                    hc = VRAMCalculator._extract_val(reader.fields.get(f'{arch}.attention.head_count'))
                    if hc: head_count_kv = hc
            except Exception as e:
                pass

        head_size = 128
        bytes_per_elem_k = 2 if kv_cache_type_k == "f16" else (1 if "q8" in kv_cache_type_k else 0.5)
        bytes_per_elem_v = 2 if kv_cache_type_v == "f16" else (1 if "q8" in kv_cache_type_v else 0.5)
        
        k_cache_bytes = block_count * context_size * head_count_kv * head_size * bytes_per_elem_k
        v_cache_bytes = block_count * context_size * head_count_kv * head_size * bytes_per_elem_v
        kv_cache_gb = (k_cache_bytes + v_cache_bytes) / (1024**3)
        
        compute_buffer_gb = 0.5 + (context_size / 32768) + (batch_size / 2048)
        total_vram_gb = file_size_gb + kv_cache_gb + compute_buffer_gb
        
        gpu_total_gb = VRAMCalculator._get_gpu_total_mb() / 1024
        # OS and Desktop window manager takes ~0.5GB to 1GB usually
        available_vram_gb = gpu_total_gb - 0.7
        
        if total_vram_gb <= available_vram_gb:
            optimal_layers = block_count + 1 # offload all
        else:
            # How many layers can we fit?
            # VRAM per layer = total_vram_gb / block_count
            vram_per_layer = total_vram_gb / block_count
            optimal_layers = int(available_vram_gb / vram_per_layer)
            if optimal_layers < 0: optimal_layers = 0
            if optimal_layers > block_count: optimal_layers = block_count + 1

        return {
            "status": "success",
            "model_size_gb": round(file_size_gb, 2),
            "kv_cache_gb": round(kv_cache_gb, 2),
            "total_vram_gb": round(total_vram_gb, 2),
            "available_vram_gb": round(available_vram_gb, 2),
            "block_count": block_count,
            "optimal_layers": optimal_layers
        }
