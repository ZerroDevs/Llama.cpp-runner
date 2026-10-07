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

## Requirements

- **Operating System:** Windows 10 / 11 (x64)
- **Runtimes:**
  - For **Native Engine**: .NET 10 Runtime / SDK & Microsoft Edge WebView2 (preinstalled on modern Windows)
  - For **Classic Engine (`app.py`)**: Python 3.10+ (`pywebview`, `psutil`, `pynvml`, `requests`, `huggingface_hub`)
- **Server Binaries:**
  - `llama-server.exe` (Downloadable via the [Llama.cpp project](https://github.com/ggml-org/llama.cpp))
  - *(Optional)* [SwarmUI](https://github.com/mcmonkeyprojects/SwarmUI) installed locally for image generation features (SwarmUI is powered by [ComfyUI](https://github.com/Comfy-Org/ComfyUI) under the hood)

---

## Native Engine (Zero-Waste High Performance Architecture)

The **Llama Server Control Native Engine** is engineered in **C# / .NET 10** with **Microsoft Edge WebView2**. It completely eliminates Python runtime dependencies, PyInstaller bootloader overhead, and extraction lag, achieving sub-45MB idle memory and instantaneous 0ms application startup.

### Key Native Enhancements:
- **Preserved Classic Workflow Dropdowns:**
  - **Active Model File Dropdown (`#select-model`):** Auto-scans `.gguf` models in your directory, displaying formatted filenames and exact file size badges (e.g. `4.2 GB`).
  - **Context Size Dropdown (`#select-context-size`):** Instant selector for 2K, 4K, 8K, 16K, 32K, and 64K tokens without manual typing.
  - **Cache K/V Quant Dropdowns (`#select-cache-k`, `#select-cache-v`):** Directly pick `f16` (Full), `q8_0` (Balanced), or `q4_0` (Low VRAM).
  - **SwarmUI Date Folders Dropdown (`#select-gallery-folder`):** Filter generated generations cleanly by date-stamped output folders.
- **Dedicated 10-Tab Interface:**
  1. **Dashboard & Server Engine:** Direct server configuration, local network endpoints (`http://127.0.0.1:8080/v1`), binary path picker, and 1-click Start/Stop/Flush/Eject actions.
  2. **AI Chat & Vision:** Real-time conversational interface with streaming markdown, code syntax highlighting, vision image attachments, and slash commands (`/imagine`, `/draw`, `/art`, `/guess`, `/yes`, `/clear`, `/compact`, `/cfg`, `/step`, `/res`, `/hook`).
  3. **Models Library:** Visual model gallery displaying all discovered local GGUF models, sizes, timestamps, 1-click model switching, and Auto VRAM calculation.
  4. **Model Hub:** Direct HuggingFace integration to search GGUF repositories, inspect quants, and download models with live chunked speed & ETA telemetry.
  5. **Hardware Monitor:** Real-time telemetry matrix tracking Dedicated VRAM, System RAM, GPU Core Temp, and CPU utilization via ultra-low-footprint Win32 native calls.
  6. **Performance Tuning:** Speculative decoding draft model selection, draft max tokens, and custom flags.
  7. **API Playground:** Built-in JSON request tester for OpenAI-compatible completions with live latency timing.
  8. **SwarmUI Studio & Gallery:** SwarmUI background launcher, interactive image gallery, bulk selection/deletion, censorship blur mask (`censored.json`), Discord webhook dispatch, and deep zero-copy PNG metadata chunk inspection (`tEXt` / `iTXt`).
  9. **Live Logs:** Ring-buffered terminal stream for `llama-server` and `SwarmUI` with search filters and auto-scroll control.
  10. **Settings & About:** Global configuration management, system tray toggles, startup behavior, and dark/light obsidian theme control.
- **Productivity & Shortcuts:**
  - **Quick Model Switcher (`Ctrl+M`):** Instant modal to search and swap local models from any tab.
  - **Command Palette (`Ctrl+K`):** Global action menu for quick navigation and server commands.
  - **Native Process Tree Management:** Spawns `llama-server` with `CREATE_NO_WINDOW` and performs clean process tree termination (`Kill(entireProcessTree: true)`) on shutdown or model swaps.
  - **Instant 0ms Window Hide:** Closing the app window hides the UI instantly while performing clean background process teardown.
- **Clean Modular UI Architecture (`ui/`):**
  - **Modular Tab Partials (`ui/tabs/*.html`):** 10 isolated HTML views loaded dynamically with zero latency.
  - **Modular Modals (`ui/modals/*.html`):** Dedicated HTML components for Command Palette, Quick Model Switcher, and PNG Inspector.
  - **Modular CSS System (`ui/css/*.css`):** 8 focused stylesheets (`base.css`, `layout.css`, `components.css`, `chat.css`, `gallery.css`, `terminal.css`, `modals.css`, `styles.css`) with strict `.tab-pane` visibility (`display: none !important;`) preventing overlapping or stacked views.
  - **Modular ES Modules (`ui/js/*.js`):** 17 decoupled JavaScript controllers covering IPC, global state, telemetry, chat streaming, and media manipulation.
- **SwarmUI Studio & Gallery Enhancements:**
  - **Generation Parameters Control:** Integrated Width (256–2048 px), Height (256–2048 px), Generation Steps (0–50), and CFG Scale (0–20) sliders with live numerical badges and persistent configuration.
  - **Silent Headless Swarm Server Mode:** Toggle "Open in Web Browser on Launch" to run SwarmUI in the background without automatically launching a browser window (`--launch_mode none`), alongside a dedicated "Open Swarm Web" button.
  - **Enhanced Image Gallery Actions:** Quick card actions for 1-click Image Copying to system clipboard, Open Containing Folder in File Explorer, and Image Deletion.
  - **Deep Generation Specs Inspector:** Flawlessly extracts and renders generation parameters matching modern specs:
    - **PROMPT** with 1-click clipboard copy.
    - **NEGATIVE PROMPT** with 1-click clipboard copy.
    - **RESOLUTION** with calculated aspect ratio (e.g., `1152x1152 (1:1)`).
    - **SEED** with instant click-to-copy.
    - **STEPS** and **CFG SCALE** badges.
  - **Interactive Fullscreen Zoom & Pan:** View high-res images in Fullscreen mode with mouse wheel zoom (1x–7x), smooth drag-to-pan navigation, double-click reset, and a prominent floating top-right "Exit Fullscreen" button.
- **Conversational Chat & Productivity Controls:**
  - **Live Stop Generation Button:** Instant abort of streaming LLM responses via both the transformed send button (red stop square icon) and a floating action pill.
  - **Inline User Message Editing:** Edit prior user prompts in-place with "Save & Submit" and "Cancel", dynamically truncating subsequent messages and automatically re-streaming fresh responses.
  - **1-Click Assistant Regeneration:** Re-roll responses from any assistant turn directly using the message action toolbar.
  - **Message Clipboard Copy:** 1-click clipboard export on all chat cards.
- **Universal Kestrel Reverse Proxy & Slash Commands:**
  - **Dual Local & LAN Access (`0.0.0.0:{port}`):** High-performance Kestrel reverse proxy listening on all network interfaces without requiring administrator URLACL reservations. Seamlessly serves the native `llama-server` web UI at `http://127.0.0.1:8080/#/` and local LAN access (`http://192.168.1.100:8080/#/`).
  - **Hop-by-Hop Header Sanitization & True SSE Chunk Streaming:** Correctly suppresses hop-by-hop headers (`Transfer-Encoding`, `Connection`) from being invalidly written to Kestrel responses while immediately flushing chunked SSE byte blocks with zero-buffering latency.
  - **Zero-Copy Local Image Endpoint (`/local_image`):** Dynamically resolves SwarmUI gallery assets across Unicode/Arabic paths with automatic query unescaping and CORS compliance, resolving both thumbnail grids and deep metadata inspector views.
  - **Universal Slash Command Interception:** Intercepts slash commands (`/imagine`, `/draw`, `/art`, `/guess`, `/yes`, `/cfg`, `/step`, `/res`, `/sys`, `/hw`, `/eject`, `/unload`, `/models`, `/clear`, `/compact`, `/hook`, `/api`, `/help`) across all clients—including the desktop chat tab, the browser web UI, external agents (Cline/Cursor), and mobile devices.
  - **Dual-Engine Auto-VRAM Orchestration:** Automatically halts `llama-server` to reclaim 100% VRAM when generating images via SwarmUI, then automatically hot-reloads the LLM back into VRAM once generation completes.

### Running & Building Native Engine

#### Run in Development Mode:
```cmd
dotnet run
```

#### Build / Compile:
```cmd
dotnet build .\LlamaServerControl.csproj
```
The compiled executable will be located at:
`bin/Debug/net10.0-windows/LlamaServerControl.exe`

#### Publish as a Standalone Single-File Executable:
```cmd
dotnet publish .\LlamaServerControl.csproj -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true -o .\dist
```

---

## Running Classic Engine (Python)

If you prefer to run the original Python version:
```cmd
python app.py
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

