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

- **Dual Chat Interfaces (Studio Chat & Embedded Llama.cpp Web UI):**
  - **Expandable AI Chat Navigation:** The sidebar "AI Chat" section features an interactive toggle accordion allowing instant navigation between **Studio Chat** (rich markdown, code blocks, vision attachments, edit/regenerate) and the official **Llama Web UI** (`http://127.0.0.1:8080/`).
  - **Live Reasoning & Thinking Elapsed Timer:** During generation, the collapsible reasoning accordion dynamically counts thinking duration in real time (e.g. `Thinking for 4s...`). Upon completion, it automatically folds and displays the exact duration (e.g. `Thought for 4.2s` or `Thought for 1m 12s`), fully preserved across sessions.
  - **Auto-Scroll to Latest Message & Viewport Anchoring:** Opening Studio Chat or switching between conversation sessions automatically anchors and scrolls the message viewport directly to the most recent message (combining immediate layout scrolls, `requestAnimationFrame`, and post-render passes) rather than stranding the viewport at the initial prompt.
  - **Persistent Saved Chats Drawer Memory:** Remembers your preference when collapsing or expanding the conversation history drawer. If you close the saved chats drawer, it remains collapsed when switching tabs or restarting the application until you choose to reopen it.
  - **Enhanced Markdown Tables & RTL Normalization:** High-contrast, responsive table styling featuring elevated headers, subtle cell gridlines, alternating row zebra striping, hover highlights, and smooth horizontal scrolling. Automatically sanitizes and normalizes LLM-generated tables (removing accidental blank lines between rows, auto-repairing missing delimiter lines, and preserving fenced code blocks), with native right-to-left (RTL) Arabic column alignment and direction.
  - **Studio Chat Context Window & Cache Token Telemetry:** A live, clickable telemetry badge in the Studio Chat header bar displays active session token usage, context window limits (e.g., `2.4k / 65k ctx`), and KV prompt cache tokens.
  - **Session & Token Inspector Modal:** Clicking the context badge opens a comprehensive 2-column telemetry matrix displaying:
    - **Session & Message Breakdown:** Active Topic Title, Total Message Count, User Messages, Assistant Messages.
    - **Engine Specs:** Local Provider (`Llama.cpp`), Active GGUF Model Name.
    - **Context Utilization:** Total Tokens, Context Window Limit, Usage Percentage with dynamic gradient progress meter.
    - **Granular Token Distribution:** Input (Prompt) Tokens, Output (Completion) Tokens, and Reasoning Tokens (extracted from `<think>` thinking streams).
    - **Performance & Speed Metrics:** Average Generation Speed (`Avg Speed (T/s)` computed across session outputs and reasoning tokens) and Total Generation Time.
    - **KV Cache Telemetry:** Slot Prompt Cache Tokens (`read / write`), Total Cost (`$0.00 / Local Engine`), Session Created & Last Activity timestamps.
    - **Direct Actions:** Instant in-modal **Flush KV Cache** button and 1-click **Copy Stats** summary to clipboard.
  - **Embedded Default Llama Web UI (`tab-llama-web`):** Run and interact with llama.cpp's built-in web client directly inside the desktop application with zero external browser tabs required.
  - **Integrated Web Controls:** Header toolbar with active port/URL display, 1-click clipboard URL copying, iframe reload, quick-jump to Studio Chat, and direct "Open in Browser" button.
  - **Smart Offline Detection & 1-Click Launch:** Automatically detects when the server is offline and displays an interactive overlay with a 1-click "Start LLM Server" button.
  - **Multi-Slot KV Cache Flush Engine:** Iterates across all allocated slots (`GET /slots` -> `POST /slots/{id}?action=erase` & `/slots/0?action=erase`) for bulletproof cache clearing with zero 404 errors, with graceful offline detection.
- **Proxy Slash Commands:** The backend proxy features an internal interception engine that allows you to type slash commands directly into your chat window (or external clients like Cline/Hermes) for instant control:
  - `/think on|off`: Toggle the model thinking and reasoning process on or off. When disabled, models respond directly without internal reasoning blocks.
  - `/fast <prompt>`: Send an immediate prompt in fast mode without reasoning, using assistant prefill and direct system prompt directives.
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
  - `/snippets` (or `/macro`): Open the interactive Prompt Library and Snippet Macros modal, or output a markdown catalog table of available custom instruction templates.
  - Snippet Shortcuts:
    - `/review <code/query>`: Run thorough code review (bugs, edge cases, performance, security).
    - `/summary <text>`: Extract key takeaways and structured executive summary.
    - `/arabic <text>`: Translate text or code explanations to clear, natural Arabic (`العربية`).
    - `/english <text>`: Translate text or code explanations to fluent, professional English.
    - `/explain <concept>`: Explain concepts simply with analogies and progressive breakdown.
    - `/tests <code/function>`: Generate comprehensive unit test suites covering edge cases.
    - `/refactor <code/snippet>`: Refactor for clarity, speed, modularity, and modern conventions.
- **Persona Generator & Presets:** Inject custom system prompts to change AI behavior. Save your favorite personas as persistent presets, delete unused ones, or give the AI a tiny hint (e.g. "Grumpy Pirate") to have it *generate its own rich system prompt* to adopt the persona!
- **Real-Time Thinking & Reasoning Control:**
  - **Live Thinking Stream & Dynamic Accordions:** Native live streaming of model thinking/reasoning processes (for DeepSeek-R1, QwQ, Qwen-distill models) rendered inside expandable `<details>` blocks with live brain indicators and real-time elapsed duration counters (e.g. `Thinking for 4s...` -> `Thought for 4.2s`).
  - **Thinking Toggle & Fast Direct Mode:** Dedicated toolbar toggle in Studio Chat (`Thinking: ON` vs `Direct: Fast`) with `localStorage` memory. When Fast Direct Mode is active, reasoning models respond immediately without generating hundreds of `<think>` tokens.
  - **Dual-Layer Reasoning Suppression:** Injects direct system directives (`Respond directly and concisely...`) and appends an assistant prefill (`<think>\n</think>\n`) to close the reasoning envelope before token generation begins, cutting latency by 50% to 80% while saving compute.
  - **Stray Tag Sanitization:** Automatically detects and strips any residual `<think>` blocks or reasoning chunks during streaming in Fast Direct Mode.
- **External Agent & IDE Compatibility:** Seamlessly connect Cline, Cursor, Open-WebUI, or Continue using standard OpenAI endpoints (`http://127.0.0.1:8080/v1`) with full Private Network Access (PNA) and CORS compliance.

### 📊 System Monitoring
- **Hardware Monitor:** Watch real-time graphical usage metrics for CPU, System RAM, GPU Core Utilization, and Dedicated VRAM (powered by `psutil` and `pynvml`).

### ⚙️ UI & Personalization
- **Modern Aesthetic:** Deeply customized UI featuring glassmorphism, smooth micro-animations, and striking neon accents.
- **Engine Automation & On-Demand Lifecycle:**
  - **Auto Wake LLM on Request (`auto_wake_llm`):** Toggleable setting that automatically starts `llama-server` and loads the model into VRAM on demand when any chat prompt, API completion, or slash command arrives while offline. Actively monitors `/health` model weights readiness with keep-alive heartbeats, and immediately processes and streams the response to the user's prompt without requiring a re-send.
  - **Auto Wake Swarm on Request (`auto_wake_swarm`):** Toggleable setting that automatically launches SwarmUI when `/imagine`, `/draw`, `/art`, or diffusion generation is requested while SwarmUI is offline, probing the port until online before dispatching jobs.
  - **Auto-Sleep LLM on Inactivity (`auto_sleep`):** Toggleable timer that unloads model weights after 10 minutes of idle time to conserve GPU memory and power.
  - **Collapsible Engine Lifecycle & Status Card (`<status>`):** Formats engine wake-up, reload, and restoration notices inside a closeable/openable accordion card with animated pulse indicators and rotating chevron toggles (matching the reasoning process design), keeping chat history clean and organized.
  - **Auto-Save & Instant Feedback:** Toggle settings automatically persist to `config.json` upon change with instant toast confirmation and a dedicated Save Settings action.
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
  2. **AI Chat & Vision (Dual View):** Expandable sidebar accordion featuring **Studio Chat** (markdown, code syntax highlighting, vision attachments, edit/regenerate, slash commands) and **Embedded Llama Web UI** (direct embedded `http://127.0.0.1:8080/` view with reload, external launch, and live offline fallback).
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
  - **Modular Tab Partials (`ui/tabs/*.html`):** 11 isolated HTML views loaded dynamically with zero latency.
  - **Modular Modals (`ui/modals/*.html`):** Dedicated HTML components for Command Palette (`cmd-palette.html`), Quick Model Switcher (`quick-model.html`), Prompt Library & Snippets (`snippets.html`), Session Stats (`session-stats.html`), and PNG Inspector (`image-inspector.html`).
  - **Modular CSS System (`ui/css/*.css`):** 8 focused stylesheets (`base.css`, `layout.css`, `components.css`, `chat.css`, `gallery.css`, `terminal.css`, `modals.css`, `styles.css`) with strict `.tab-pane` visibility (`display: none !important;`) preventing overlapping or stacked views.
  - **Modular ES Modules (`ui/js/*.js`):** 18 decoupled JavaScript controllers covering IPC, global state, telemetry, chat streaming, and media manipulation.
- **SwarmUI Studio & Gallery Enhancements:**
  - **Diffusion Model Auto-Detection & Directory Scanner:** Auto-scans SwarmUI `Models` and `diffusion_models` directories (or custom user-selected folders) for `.gguf`, `.safetensors`, and `.ckpt` files with formatted file size badges.
  - **Active Diffusion Model Picker & Custom Alias:** Dropdown selector and editable model field, defaulting to `qwen-image-2.1-UC-Q6_K.gguf` (Qwen21). Guarantees valid non-empty model payload dispatch to SwarmUI `/API/GenerateText2Image`, eliminating the "No model input given" error.
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
  - **Multiple Chat Conversations & History Drawer:** Sleek, collapsible left sidebar drawer displaying all past conversations with real-time title search, "+ New Chat" action, inline topic renaming, conversation deletion, and 1-click Export to Markdown (`.md`) or JSON (`.json`). Persisted efficiently to `chats.json` with synchronous fallback cache.
  - **Permanent Drawer Toggle & Re-Open Button:** An always-accessible header button (`Chats`) and drawer collapse button allow seamless opening and collapsing of saved chats at any time without ever getting stuck.
  - **Robust Vanilla CSS Split-Layout:** Fully independent layout rules for `#chat-main-area`, `#chat-top-bar`, `#chat-messages`, and `#chat-input-bar`, guaranteeing zero layout collisions, reliable scroll streams, and persistent visibility across offline and local environments.
  - **In-Chat Model Quick-Switcher:** Compact dropdown directly in the Studio Chat header bar displaying discovered local GGUF models. Selecting a new model hot-swaps the active engine in the background without clearing your active conversation.
  - **Message Version Branching (`< 1/3 >`):** Fully preserves prior versions when editing a prompt or regenerating an assistant answer. Displays interactive pagination buttons (`< 1/2 >`) on message cards, allowing you to freely explore alternative response trees without losing earlier turns.
  - **Live Stop Generation Button:** Instant abort of streaming LLM responses via both the transformed send button (red stop square icon) and a floating action pill.
  - **Inline User Message Editing:** Edit prior user prompts in-place with "Save & Submit" and "Cancel", dynamically storing branch history and automatically re-streaming fresh responses.
  - **1-Click Assistant Regeneration:** Re-roll responses from any assistant turn directly using the message action toolbar with version branching.
  - **Live Reasoning Stream & Auto-Collapsing Accordion (`💡 Reasoning`):** Real-time streaming extraction of reasoning tokens (`reasoning_content` / `<think>`) into an interactive disclosure box. Displays live `💡 Thinking...` in an open view while generating thoughts, then automatically collapses when thinking completes to showcase the answer cleanly. Users can click to expand or collapse the reasoning at any time with animated 180° chevron transitions.
  - **Smart Non-Intrusive Auto-Scroll:** Intelligent scroll position tracking while the model generates text or executes agent tools. If you scroll up to inspect previous turns, read reasoning blocks, or review code snippets, auto-scroll pauses immediately so your viewport is never hijacked or yanked back to the bottom. Scrolling back within 80px of the bottom or clicking the floating "Scroll to bottom" button seamlessly re-engages follow-along auto-scroll.
  - **Seamless Clipboard Paste & Drag-and-Drop Image Attachments:** Instant image attachment for vision models by pressing `Ctrl+V`, right-clicking `Paste` from the context menu, or dragging & dropping image files directly onto the chat workspace, complete with thumbnail previews and 1-click removal.
  - **Direct Document & Code Drop (Chat with Files):** Drag-and-drop or file picker attachment for `.txt`, `.md`, `.cs`, `.py`, `.js`, `.ts`, `.json`, `.pdf`, and diverse source code files directly into the chat input rail. Powered by a zero-footprint client-side text extractor that reads file streams in the browser and injects formatted, syntax-highlighted code blocks into the prompt. For `.pdf` files, an integrated zero-dependency Flate decompression engine extracts text streams on-the-fly without external Python libraries or native binary baggage.
  - **Full-Text In-Chat Search (`Ctrl + F`):** Instant search bar overlay directly inside the active conversation. Fast substring search across user prompts, assistant answers, code snippets, and reasoning blocks with bidirectional match navigation (`< 3/12 >`, `Enter` for next, `Shift+Enter` for previous, `Esc` to close). Automatically unfolds collapsed reasoning blocks when queries match inside thinking text, smoothly centers matches in the viewport, and cleanly restores DOM nodes when dismissed.
  - **Prompt Library & Snippet Macros (`/snippets` / `/macro`):** Quick-access modal accessible from the chat header, input toolbar, or `/snippets` / `/macro` slash commands. Features curated preset macros across Coding (Code Review, Unit Tests, Refactoring), Writing (Executive Summary), Translation (Arabic, English), and Learning (Explain Simply), alongside an inline custom snippet builder with persistent `localStorage` storage and 1-click insertion into the composer.
  - **Message Clipboard Copy:** 1-click clipboard export on all chat cards.
  - **Autonomous Coding Agent Mode & Sandboxed Workspace:**
    - **Chat-Scoped Agent Isolation & Persistence:** Agent Mode is strictly configured per conversation rather than globally. Each chat session independently tracks its own Agent status and linked project folder, permanently persisted in `chats.json`. Switching chats or restarting the app automatically restores that specific chat's workspace, while normal chats remain unlinked.
    - **Session Drawer Agent Badge:** Chats with Agent Mode active display a cyan `Agent` badge with a bot icon in the chat history drawer for instant recognition.
    - **Native Workspace Project Selector:** Select any project folder on your PC (e.g. `MyWebsite`, Node.js, Python, or .NET solution) using a native Windows folder picker. The active project name, path, detected frameworks, and discovered file counts are displayed in the chat header and banner.
    - **ReAct Autonomous Tool Calling Loop:** When Agent Mode is toggled on (`Agent: ON`), models can autonomously plan, inspect, create, edit files, and run commands over multi-turn execution loops (up to 10 turns) until tasks are completed.
    - **Reasoning-Style Action Disclosure Boxes:** Tool executions and action results render inside sleek, collapsible disclosure accordions matching the thinking/reasoning design language:
      - Clean header summary with tool icon (`file-plus-2`, `file-edit`, `terminal`, `globe`, etc.), action name, target file path or URL, metrics badge (e.g. `93 lines • 2 KB` or `HTTP 200 • 3.4k chars`), and live status pill (`Running`, `Success`, `Error`).
      - Collapsed by default when finished to keep conversations clean and clutter-free, with 1-click expansion to inspect code previews, command logs, or fetched web documentation.
      - `write_file`: File creation or replacement with lines written, KB metrics, and scrollable code preview.
      - `edit_file`: Surgical search-and-replace with delta lines indicator and replaced/new chunk comparison.
      - `read_file`: Displays lines read and byte counts with content view.
      - `run_command`: Monospace terminal card displaying `$ <command>`, captured `stdout`, `stderr`, exit code, and execution duration in ms.
      - `list_directory`, `create_directory`, `delete_file`: Folder tree and file manipulation badges.
      - `fetch_web`: Sandboxed HTTP GET tool allowing the agent to fetch online docs, npm READMEs, and API specifications.
      - `screenshot_web`: Zero-dependency headless browser screenshot tool capturing full website images.
    - **Real-Time Docs Fetcher (`fetch_web` Tool):**
      - Allows the coding agent to query external URLs in real time when implementing solutions for modern or unfamiliar frameworks.
      - **SSRF Loopback Defense:** Blocks requests targeting localhost (`127.0.0.1`, `::1`), internal subnets (`192.168.*`, `10.*`, `172.16.*`), and local port endpoints (`8080`, `7801`).
      - **Clean HTML-to-Markdown Scraper:** Automatically strips scripts, stylesheets, and HTML tags, delivering concise markdown text capped at 16,000 characters to conserve prompt tokens.
    - **Native Headless Web Screenshot Capture (`screenshot_web` Tool):**
      - Allows any text model (no vision model required) to snapshot live websites and deliver screenshots directly to the user in chat.
      - **Zero-Bloat Architecture:** Uses native Microsoft Edge / Chrome headless CLI (`--headless`) with zero external automation packages, consuming 0 MB idle RAM.
      - **SSRF Loopback Defense:** Actively rejects internal IP subnets, loopback ports, and local services.
      - **Interactive Chat Image Card:** Automatically displays high-resolution 1280x800 PNG previews inside the chat message with click-to-zoom and full-screen view links.
    - **Collapsible Workspace File Explorer Drawer (Closeable / Openable):**
      - **Dual-Mode Drawer Navigation:** A lightweight left-hand secondary panel next to chat sessions featuring segmented `[Chats]` and `[Files]` tabs, allowing users to toggle between conversations and project files effortlessly.
      - **Visual Folder Tree:** Renders the workspace directory tree with folder expand/collapse state memory, item counts, file extension icons, file sizes, and instant filename filtering.
      - **Full-Featured File Preview Modal:** Click any file to view its contents in a syntax-highlighted code inspector modal powered by `highlight.js`.
      - **External Editor Integration:** Quick buttons to open files or the root project folder in VS Code (`code`), open files in Notepad (`notepad.exe`), or reveal items directly in Windows Explorer (`explorer.exe`).
      - **1-Click Insert to Chat:** Inserts the selected file content directly into the chat composer as a formatted markdown code block.
    - **Strict Sandboxed Security:** All file system operations are strictly verified against the workspace root to block path traversal attacks outside the selected directory.
    - **Automated Snapshots & Backups:** Overwritten and edited files are automatically backed up into `.llama_agent/backups/` with timestamped snapshots before modifications occur.
    - **Real-Time Stop Control:** Click Stop Generation at any moment to cleanly abort running terminal processes and break the agent loop.
- **Multi-Source Live Logs Terminal:**
  - **Categorized Source Tabs & Live Counters:** Filter real-time terminal streams seamlessly by **Show All**, **Llama** (llama.cpp engine), **SwarmUI** (diffusion pipeline), and **Other** (reverse proxy, auto-sleep, and system actions) with dynamic counter badges.
  - **Distinct Color Coding & Severity Badges:** Visual differentiation with emerald/mint for Llama, lavender/violet for SwarmUI, sky blue for Proxy/System, warm amber for warnings (`[Warning]`, `W `), and crimson red for errors (`[ERR]`, `E `).
  - **Automated Milestone Readiness Notifications:** Real-time log detection triggers instant notifications when key services are online:
    - `llama_server: model loaded` $\rightarrow$ *"Model Ready: Model started and ready to use!"*
    - `Self-Start ComfyUI-0 on port 7821 started.` $\rightarrow$ *"ComfyUI Started: Self-Start ComfyUI backend started."*
    - `SwarmUI vn.n.n.n - Local is now running.` $\rightarrow$ *"SwarmUI Started: SwarmUI is now running and ready."*
  - **Zero-Lag Bounded DOM Streaming:** Appends new lines in constant time while enforcing a strict 500-line ring buffer to maintain zero CPU/RAM footprint during intensive logging.
  - **1-Click Clipboard Copy & Real-Time Search:** Instant search filter across active source tabs and 1-click clipboard export of visible logs.
- **Universal Kestrel Reverse Proxy & Modular Architecture:**
  - **Modular Handler Decomposition:** The proxy architecture is cleanly separated into specialized subsystems:
    - **`StreamingProxy.cs`**: Handles ASP.NET Kestrel networking, route dispatching, loopback port translation, and upstream client streaming.
    - **`DiffusionOrchestrator.cs`**: Orchestrates VRAM swapping, prompt engineering, SwarmUI API dispatch, keep-alive heartbeats, and model reloading.
    - **`SlashCommandRouter.cs`**: Encapsulates all slash command parsing, system stats output, configuration adjustments, and compacting routines.
  - **GPU Generation Concurrency Lock:** Actively guards against simultaneous VRAM collisions. If any external agent or chat request arrives while an image generation pass is underway (`_isGeneratingImage == true`), the proxy returns an immediate `503 Service Unavailable` with `Retry-After: 5`, completely preventing conflicting model boots.
  - **Hardware-Verified VRAM Drain:** Replaces static sleep timers with dynamic hardware monitoring via Win32/NVML. Actively polls `vram_used` every 250ms until model memory is completely deallocated by the GPU driver before dispatching SwarmUI jobs.
  - **Zero-Bloat Chat Image Disk Cache:** Pasted or attached vision images are automatically extracted and stored to disk in `ui/generated_cache/attachments/` via `save_chat_attachment`, completely stripping multi-megabyte base64 strings from `chats.json` and browser `localStorage`.
  - **Dual Local & LAN Access (`0.0.0.0:{port}`):** High-performance Kestrel reverse proxy listening on all network interfaces without requiring administrator URLACL reservations. Seamlessly serves the native `llama-server` web UI at `http://127.0.0.1:8080/#/` and local LAN access (`http://192.168.1.100:8080/#/`).
  - **Transparent Upstream Gzip Negotiation & Decompression:** Explicitly negotiates `Accept-Encoding: gzip, deflate, br` with upstream `llama-server` and utilizes high-performance `SocketsHttpHandler` automatic decompression while stripping `Content-Encoding` and `Content-Length` headers from relayed responses. Completely resolves the `"Error: gzip is not supported by this browser"` issue when viewing embedded or external web UI clients.
  - **Full Static Asset & SPA Routing (`{*path}`):** Configures ASP.NET Core catch-all endpoint fallback (`{*path}`) and automated 404 upstream fallback middleware, correctly proxying all nested Svelte/Vue bundles, chunks, and CSS assets (`/_app/immutable/bundle.*.js`) rather than returning 404.
  - **COEP / COOP Security Header Sanitization:** Suppresses `Cross-Origin-Embedder-Policy` (`require-corp`), `Cross-Origin-Opener-Policy` (`same-origin`), `X-Frame-Options`, and `Content-Security-Policy` from upstream responses, allowing seamless WebView2 iframe embedding and unrestricted LAN browser rendering (`http://192.168.1.100:8080/`).
  - **Zero-Copy Local Image Endpoint (`/local_image`):** Dynamically resolves SwarmUI gallery assets across Unicode/Arabic paths with automatic query unescaping and CORS compliance, resolving both thumbnail grids and deep metadata inspector views.
  - **Universal Slash Command Interception:** Intercepts slash commands (`/think`, `/fast`, `/imagine`, `/draw`, `/art`, `/guess`, `/yes`, `/cfg`, `/step`, `/res`, `/sys`, `/hw`, `/eject`, `/unload`, `/models`, `/clear`, `/compact`, `/hook`, `/api`, `/help`) across all clients (including the desktop chat tab, the browser web UI, external agents like Cline and Cursor, and mobile devices).
  - **Dual-Engine Auto-VRAM Orchestration & Hot-Reload:** Seamlessly orchestrates LLM and Diffusion workloads without VRAM collisions or CUDA OOM:
    1. **Prompt Engineering:** Llama enhances positive prompt and formats generation directives on the internal port.
    2. **Hardware-Verified VRAM Drain:** Automatically stops `llama-server` and actively verifies GPU driver deallocation so SwarmUI has 100% VRAM headroom.
    3. **SSE Keep-Alive Heartbeat:** Streams empty SSE delta frames every 2 seconds during multi-minute diffusion generations, preventing WebView2 and TCP socket idle timeouts.
    4. **Multi-Tier Image Retrieval:** Resolves generated images using a 3-tier fallback (Base64 decode, instantaneous direct disk copy from SwarmUI local `Output/` storage, and 30-minute resilient HTTP retrieval via `/ViewImage?image=`), guaranteeing the image renders in chat.
    5. **Guaranteed Auto-Reload to VRAM:** Automatically starts `llama-server` and probes the engine port with keep-alive signals until model weights are loaded back into VRAM and ready to chat.

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

