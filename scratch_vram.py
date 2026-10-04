import gguf
import json
import os

model_path = r"E:\Llama.cpp models\hub\models--Noobito45--Qwen3.8-9B-heretic-uncensored-NVFP4-GGUF\snapshots\6a9d3ae466e566cd3319d0cbae3e1243279b62e3\Qwen3.8-9B-distill-heretic_nvfp4_q4_k_m.gguf"

reader = gguf.GGUFReader(model_path)

def get_str(key):
    if key not in reader.fields:
        return None
    field = reader.fields[key]
    data = field.parts[field.data[0]]
    if isinstance(data, list):
        return "".join(chr(c) for c in data)
    return str(data)

def get_int(key):
    if key not in reader.fields:
        return None
    field = reader.fields[key]
    data = field.parts[field.data[0]]
    if isinstance(data, list):
        return data[0]
    return int(data)

arch = get_str("general.architecture")
print(f"Arch: {arch}")

block_count = get_int(f"{arch}.block_count")
ctx_len = get_int(f"{arch}.context_length")
embd_len = get_int(f"{arch}.embedding_length")
head_count = get_int(f"{arch}.attention.head_count")
head_count_kv = get_int(f"{arch}.attention.head_count_kv")

print(f"Block count: {block_count}")
print(f"Context length: {ctx_len}")
print(f"Embedding length: {embd_len}")
print(f"Head count: {head_count}")
print(f"Head count KV: {head_count_kv}")
