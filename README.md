# Llama Server Control

Llama Server Control is a sleek, unified graphical interface for managing your local AI ecosystem. Built with Python (PyWebview) on the backend and modern web technologies (Vanilla JS, TailwindCSS) on the frontend, it acts as a powerful central hub for running LLMs via `llama.cpp` and Image Generation models via `SwarmUI`.

## Project Vision
Our vision is to build the absolute lightest, most performant, zero-waste local AI manager in existence. Hardware headroom is precious. Every megabyte of RAM saved by the control panel is a megabyte given back to your models or your games. We enforce aggressive thread hygiene, zero-copy binary streaming, and strict UI DOM virtualization. Whether you are daily-driving a massive LLM or generating hundreds of high-res images, Llama Server Control is designed to stay completely out of your hardware's way.

---

## Current Features

### 🚀 Advanced Server Management
- **Full Configuration Control:** Easily tune `llama-server` settings including Host, Port, Context Size, CPU Threads, GPU Layers, Batch Sizes, Flash Attention, and K/V Cache Types.
- **Hardware Acceleration:** Native support for Vision Projectors, LoRA Adapters, and Draft Models for speculative decoding.
- **1-Click Start/Stop:** Effortlessly boot up your local AI server and shut it down cleanly through the UI or the System Tray. UI buttons dynamically lock/grey-out based on live server state.
- **Auto-Sleep / VRAM Reclaimer:** Automatically unloads LLMs from VRAM after 10 minutes of inactivity to instantly return hardware resources back to the host system for gaming or heavy browsing. Seamlessly hot-loads the model back in the exact moment a new chat request is received.

### 🧠 Model Hub & Library
- **HuggingFace Integration:** Search, browse, and download `.gguf` models directly from HuggingFace Hub right inside the app. Filter by "Uncensored", exact max VRAM constraints, and specific quantizations.
- **Local Models Directory:** Scan your local folders for GGUF files. See exact file sizes at a glance.
- **Auto VRAM Calculation:** Click the "Auto" button next to any local model to dynamically compute the ideal number of GPU layers based on your currently available system VRAM.

### 🖼️ SwarmUI Studio & Gallery
- **Integrated Image Generation:** Boot up SwarmUI seamlessly in the background on your chosen port. Use our robust internal bridge to generate images directly through text prompts using `qwen-image-2.1-UC-Q6_K.gguf`.
- **Dynamic Image Library:** View all generated images grouped elegantly into folders by date. Includes a smart dropdown filter to organize your viewing experience.
- **Deep Metadata Viewer:** Click any image to view it in a modal. The app meticulously parses binary PNG `tEXt` and `iTXt` chunks to flawlessly retrieve the exact `prompt`, `negativeprompt`, `steps`, and `cfgscale` used to generate the image, bypassing any binary garbage!
- **Interactive Previews:** Zoom (mouse-wheel) and Pan (click-and-drag) your high-res generated images. Click "Fullscreen" to view them boundlessly. One-click copy for metadata tags directly to your clipboard.
- **Bulk Action Mode:** Effortlessly manage your gallery with a multi-select mode. Delete massive batches of old generations straight from your hard drive with one click.
- **Blur / Censor Filter:** Got spicy or NSFW generations? Select images and hit the "Eye-Off" button to apply a heavy, permanent blur mask to them in the gallery. Hover to temporarily peek, or hit "Eye" to permanently uncensor them. Memory persists locally via a `censored.json` footprint.

### 💻 Testing & Development
- **API Playground:** A built-in coding environment to fire requests against your running local server. Test Chat Completions, Text Completions, and Text-to-Image API routes instantly.
- **Live Logs Terminal:** Watch raw `stdout` and `stderr` streams directly from `llama-server` and `SwarmUI` with auto-scrolling and one-click copying.
- **Benchmarking Tools:** Run localized benchmarks to evaluate Prompt Processing speed and Token Generation (T/s) using the actively loaded model.

### 💬 Chat Interface & Personas
- **Local AI Chat:** Chat directly with your loaded models right in the app.
- **Persona Generator:** Inject custom system prompts to change AI behavior. Don't know what to write? Give the AI a tiny hint (e.g. "Grumpy Pirate") and the app will ask the loaded model to *generate its own rich system prompt* to adopt the persona!

### 📊 System Monitoring
- **Hardware Monitor:** Watch real-time graphical usage metrics for CPU, System RAM, GPU Core Utilization, and Dedicated VRAM (powered by `psutil` and `pynvml`).

### ⚙️ UI & Personalization
- **Modern Aesthetic:** Deeply customized UI featuring glassmorphism, smooth micro-animations, and striking neon accents.
- **Localization:** Instantly switch the entire interface between English and Arabic (`العربية`).
- **Theming:** Full Dark/Light mode support.
- **System Tray:** Minimize to the system tray to keep your servers running silently in the background. Features quick actions to open SwarmUI or stop servers.

### ⚡ Ultra-Low Memory Footprint
- **Zero-Copy Binary Streaming:** The app meticulously stream-skips over multi-megabyte `IDAT` image payloads without allocating them to RAM, achieving zero-footprint metadata extraction.
- **Virtual DOM Trimming:** Live streaming terminal logs are aggressively ring-buffered to a strict 500-line cap, preventing infinite browser DOM bloat during extended 24-hour sessions.
- **Lazy Module Initialization:** Heavy libraries (like `huggingface_hub`) are strictly deferred and loaded on-the-fly *only* when you interact with specific tabs, slashing idle RAM usage.
- **Lazy Gallery Virtualization:** Generated images are never dumped directly into memory. They are cleanly proxied via a highly-efficient `/local_image` endpoint and dynamically requested by the browser strictly when scrolled into view.
- **Aggressive Garbage Collection:** Tight background WMI/NVML hardware polling drops to 0% background activity when the UI is minimized, constantly triggering `gc.collect()` sweeps to ensure pristine memory states.

---

## 🔮 Planned Features (Roadmap)

- **Dynamic SwarmUI Model Selector:** Live querying of the `SwarmUI` model directory to dynamically populate image model dropdowns, allowing effortless hot-swapping between Qwen, SDXL, and SD1.5 checkpoints without hardcoding.
- **Expanded Hub Integrations:** Allow direct 1-click installation of LoRAs and Vision Projectors from HuggingFace to matching local directories.

---

## Requirements

- Windows OS
- Python 3.10+
- `llama-server.exe` (Downloadable via the [Llama.cpp project](https://github.com/ggml-org/llama.cpp))
- (Optional) [SwarmUI](https://github.com/mcmonkeyprojects/SwarmUI) installed locally for image generation features (SwarmUI is powered by [ComfyUI](https://github.com/Comfy-Org/ComfyUI) under the hood, which it downloads automatically during its own installation).

## Setup Instructions

1. Clone this repository.
2. Install the required Python packages:
   ```cmd
   pip install pywebview psutil pynvml requests huggingface_hub
   ```
3. Run the application (or compile it to a `.exe`):
   ```cmd
   python app.py
   ```
4. On the first launch, head over to the **Dashboard & Server** tab to set the path to your `llama-server.exe` binary.
5. Head over to **Models Library** to specify the folder where you store your `.gguf` files.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
