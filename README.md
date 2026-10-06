# Llama Server Control

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Python 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/downloads/)
[![Platform: Windows](https://img.shields.io/badge/platform-Windows-lightgrey.svg)]()

Llama Server Control is a sleek, unified graphical interface for managing your local AI ecosystem. Built with Python (PyWebview) on the backend and modern web technologies (Vanilla JS, TailwindCSS) on the frontend, it acts as a powerful central hub for running LLMs via `llama.cpp` and Image Generation models via `SwarmUI`.

## Project Vision
Our vision is to build the absolute lightest, most performant, zero-waste local AI manager in existence. Hardware headroom is precious. Every megabyte of RAM saved by the control panel is a megabyte given back to your models or your games. We enforce aggressive thread hygiene, zero-copy binary streaming, and strict UI DOM virtualization. Whether you are daily-driving a massive LLM or generating hundreds of high-res images, Llama Server Control is designed to stay completely out of your hardware's way.

---

## Current Features

### 🚀 Advanced Server Management
- **Full Configuration Control:** Easily tune `llama-server` settings including Host, Port, Context Size, CPU Threads, GPU Layers, Batch Sizes, Flash Attention, and K/V Cache Types.
- **Hardware Acceleration:** Native support for Vision Projectors, LoRA Adapters, and Draft Models for speculative decoding.
- **1-Click Start/Stop:** Effortlessly boot up your local AI server and shut it down cleanly through the UI or the System Tray. UI buttons dynamically lock/grey-out based on live server state.
- **Flush Context & KV Cache (No-Reload Reset):** Instantly erase active slots and flush the entire KV context memory to 0 tokens with a single click (or via `/clear`), freeing context space after heavy agent sessions (Cline/Cursor) without unloading or reloading model weights from disk.
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
- **Proxy Slash Commands:** The backend proxy features an internal interception engine that allows you to type slash commands directly into your chat window (or external clients like Cline/Hermes) for instant control:
  - `/imagine <prompt> | <negative>`: Directly dispatches your exact positive and negative prompts to SwarmUI for GPU rendering without any LLM alteration. If negative is omitted, a robust default negative prompt is used.
  - `/draw <prompt> | <negative>`: Auto-ejects the LLM, fires up SwarmUI to generate an image natively on the GPU, pipes it back into the chat, and wakes the LLM. The LLM enhances your positive prompt but takes your negative prompt exactly as-is. (Auto-generates negative tags if omitted).
  - `/art <prompt> | <negative>`: Identical to `/draw`, but forces the LLM to creatively rewrite and enhance BOTH your positive and negative prompts.
  - `/guess`: Attach an image alongside this command to let the Vision Model visually analyze it and generate a flawless Stable Diffusion positive and negative prompt directly in the chat.
  - `/yes`: Type this after a `/guess` or `/art` command to instantly dispatch the exact prompt the LLM just engineered directly to SwarmUI for generation.
  - `/help`: Print a formatted list of all available commands directly in the chat.
  - `/cfg <0-20>`: Set the CFG scale for image generation (e.g., `/cfg 7.5`).
  - `/step <0-50>`: Set the number of steps for image generation (e.g., `/step 25`).
  - `/res <WxH>`: Set the resolution for image generation (e.g., `/res 1024x1024`).
  - `/hook`: Send the very last image generated in your current session directly to your configured Discord Webhook.
  - `/api`: Dynamically outputs a markdown guide with your precise Host, Port, and Model ID for connecting external agents.
  - `/eject` (or `/unload`): Instantly unloads the model to free 100% VRAM while keeping the API alive.
  - `/sys` (or `/hw`): Returns a live system hardware telemetry snapshot (VRAM, RAM, CPU).
  - `/models`: Scans and lists all `.gguf` files available in your models directory.
  - `/clear`: Wipes the backend stateless memory cache.
  - `/compact`: Condenses massive chat payloads dynamically into a dense summary block, saving huge amounts of context space.
  
  - `Note: --`
  - `/guess`: Attach up to multiple reference images alongside this command. The vision model analyzes their aesthetic, composition, and style, then strictly outputs optimized `Positive Prompt:` and `Negative Prompt:` tags without triggering generation.
  - `/yes`: Confirms and executes. Instantly catches the engineered prompts from the preceding `/guess` or `/art` response, unloads the LLM to free 100% VRAM, and dispatches them directly to SwarmUI for rendering.
  --
- **Persona Generator & Presets:** Inject custom system prompts to change AI behavior. Save your favorite personas as persistent presets, delete unused ones, or give the AI a tiny hint (e.g. "Grumpy Pirate") to have it *generate its own rich system prompt* to adopt the persona!
- **Real-Time Thinking & Reasoning:** Native live streaming of model thinking/reasoning processes (for DeepSeek-R1, QwQ, Qwen-distill models) rendered inside expandable `<details>` blocks with live brain indicators.
- **External Agent & IDE Compatibility:** Seamlessly connect Cline, Cursor, Open-WebUI, or Continue using standard OpenAI endpoints (`http://127.0.0.1:8080/v1`) with full Private Network Access (PNA) and CORS compliance.

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

## Studio V1 (Next-Generation Workspace)

Located in `v1/`, the **Llama Server Studio V1** introduces a high-performance modern workspace built with **Svelte 5** (Runes `$state`, `$derived`), **Vite**, and **TailwindCSS**, hosted inside an optimized native desktop wrapper:

- **Dual-Pane Studio Layout:** Conversational agent and streaming markdown terminal on the left; real-time diffusion canvas, SwarmUI gallery, telemetry matrix, and model hub on the right.
- **Instant 0ms Lifecycle:** Instantaneous window close with background asynchronous process tree termination (`taskkill /F /T`).
- **Global Command Palette (`Ctrl+K`):** Fuzzy-search actions, quick model switching, persona presets, and KV cache flushes.
- **Deep Chunk Inspector:** Inspect prompt, negative prompt, seed, steps, sampler, and CFG from generated PNGs in real-time.
- **Hardware Telemetry HUD:** Low-overhead VRAM, RAM, and CPU telemetry capsules with background pause on blur.
- **VRAM & Layer Offload Estimator:** Calculate required VRAM for any model, context size, and batch configuration before loading.

### Running Studio V1

To run Studio V1:
```cmd
cd v1
npm install
npm run build
python main.py
```

For live hot-reload development mode:
```cmd
cd v1
npm run dev
# In another terminal:
python main.py --dev
```

## Setup Instructions (Classic & V1)

1. Clone this repository.
2. Install the required Python packages:
   ```cmd
   pip install pywebview psutil pynvml requests huggingface_hub
   ```
3. Run Classic UI:
   ```cmd
   python app.py
   ```
   Or run Next-Gen Studio V1:
   ```cmd
   python v1/main.py
   ```
4. On first launch, configure your `llama-server.exe` path and select your `.gguf` model file.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

