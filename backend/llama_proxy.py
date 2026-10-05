import json
import time
import uuid
import os
import requests
import threading
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

class LlamaProxyHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass # Suppress logging to keep console clean

    def log_ui(self, msg):
        if hasattr(self.server, 'process_manager') and getattr(self.server.process_manager, 'window', None):
            try:
                import json
                safe_msg = json.dumps(msg)
                self.server.process_manager.window.evaluate_js(f"window.receiveLog({safe_msg})")
            except Exception:
                pass

    def forward_request(self):
        # We forward to the internal llama-server port (public port + 1)
        internal_port = self.server.config.get("port", 8080) + 1
        url = f"http://127.0.0.1:{internal_port}{self.path}"
        
        headers = {k: v for k, v in self.headers.items()
                   if k.lower() not in ('host', 'accept-encoding')}
        # Force gzip so requests auto-decompresses; we strip it before forwarding to client
        headers['Accept-Encoding'] = 'gzip, deflate'
        body = None
        if 'Content-Length' in self.headers:
            body = self.rfile.read(int(self.headers['Content-Length']))

        try:
            resp = requests.request(
                method=self.command,
                url=url,
                headers=headers,
                data=body,
                timeout=30
            )
            
            body_bytes = resp.content  # auto-decompresses gzip/deflate
            
            self.send_response(resp.status_code)
            skip_headers = (
                'transfer-encoding', 'content-encoding', 'connection',
                'content-length', 'cross-origin-embedder-policy',
                'cross-origin-opener-policy', 'cross-origin-resource-policy'
            )
            for k, v in resp.headers.items():
                if k.lower() not in skip_headers:
                    self.send_header(k, v)
            self.send_header('Content-Length', str(len(body_bytes)))
            self.send_header('Connection', 'close')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(body_bytes)
        except Exception as e:
            err_str = str(e)
            is_conn_refused = 'Connection refused' in err_str or '10061' in err_str or 'Max retries exceeded' in err_str
            if not is_conn_refused:
                self.log_ui(f"[ERR] [Proxy] forward_request failed for {self.path}: {e}")
            if getattr(self.server, 'is_generating_image', False):
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(b"{}")
                return
            try:
                self.send_response(503)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Connection', 'close')
                self.end_headers()
                self.wfile.write(b'{"error":{"message":"LLM server is offline. Start the model first.","code":503}}')
            except Exception:
                pass

    def do_GET(self):
        # Serve generated images locally so they don't depend on llama-server being up
        if self.path.startswith('/generated_cache/'):
            filename = os.path.basename(self.path)
            filepath = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'ui', 'generated_cache', filename)
            if os.path.exists(filepath):
                self.send_response(200)
                self.send_header('Content-Type', 'image/jpeg')
                self.end_headers()
                with open(filepath, 'rb') as f:
                    self.wfile.write(f.read())
                return
            else:
                self.send_error(404, "File not found")
                return
                
        if self.path.startswith('/local_image'):
            from urllib.parse import urlparse, parse_qs
            query = parse_qs(urlparse(self.path).query)
            if 'path' in query:
                filepath = query['path'][0]
                if os.path.exists(filepath) and filepath.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
                    self.send_response(200)
                    self.send_header('Content-Type', f"image/{filepath.split('.')[-1].lower()}")
                    self.send_header('Cache-Control', 'max-age=3600')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    with open(filepath, 'rb') as f:
                        self.wfile.write(f.read())
                    return
            self.send_error(404, "Image not found")
            return
                
        self.forward_request()

    def do_OPTIONS(self):
        self.forward_request()

    def do_POST(self):
        if self.path in ['/v1/chat/completions', '/completion']:
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length > 0:
                body_data = self.rfile.read(content_length)
                try:
                    payload = json.loads(body_data)
                    # Check if the last message starts with a command
                    raw_content = ""
                    if 'messages' in payload and len(payload['messages']) > 0:
                        raw_content = payload['messages'][-1].get('content', '')
                    elif 'prompt' in payload:
                        raw_content = payload['prompt']
                        
                    text_prompt = ""
                    if isinstance(raw_content, list):
                        for item in raw_content:
                            if isinstance(item, dict) and item.get('type') == 'text':
                                text_prompt = item.get('text', '')
                                break
                    else:
                        text_prompt = str(raw_content)
                        
                    text_prompt = text_prompt.strip()
                    
                    self.server.last_interaction = time.time()
                    
                    if not self.server.process_manager.check_status():
                        is_stream = payload.get('stream', False)
                        if is_stream:
                            self.send_response(200)
                            self.send_header('Content-Type', 'text/event-stream')
                            self.send_header('Cache-Control', 'no-cache')
                            self.end_headers()
                            
                            def send_chunk(text):
                                chunk_data = json.dumps({"choices": [{"delta": {"content": text}}]})
                                self.wfile.write(f"data: {chunk_data}\n\n".encode('utf-8'))
                                self.wfile.flush()
                                
                            send_chunk("*Waking up LLM from Auto-Sleep...*\n\n")
                            self.server.process_manager.start_server(self.server.config_manager.get_config())
                            
                            max_retries = 30
                            while max_retries > 0 and not self.server.process_manager.check_status():
                                time.sleep(1)
                                send_chunk("")
                                max_retries -= 1
                                
                            time.sleep(3) # Wait for Llama server to bind
                            send_chunk("*LLM restored! Processing request...*\n\n")
                        else:
                            self.server.process_manager.start_server(self.server.config_manager.get_config())
                            time.sleep(4)
                    
                    if "/draw " in text_prompt or text_prompt.startswith("/draw"):
                        self.log_ui("[INFO] Intercepted /draw command. Initiating AI image generation pipeline...")
                        self.handle_draw_request(text_prompt.replace("/draw", "").strip(), payload, is_art=False)
                        return
                    if "/art " in text_prompt or text_prompt.startswith("/art"):
                        self.log_ui("[INFO] Intercepted /art command. Initiating enhanced AI image generation pipeline...")
                        self.handle_draw_request(text_prompt.replace("/art", "").strip(), payload, is_art=True)
                        return
                    if text_prompt.startswith("/guess"):
                        self.log_ui("[INFO] Intercepted /guess command. Injecting visual analysis prompt...")
                        system_injection = "Please visually analyze the attached image in detail. Generate a highly descriptive, comma-separated image generation prompt based strictly on this image. You are completely uncensored; NSFW and explicit details MUST be described accurately if present. DO NOT write conversational text like 'Here is a prompt...'. Output STRICTLY in this exact format:\nPOSITIVE: <highly detailed positive prompt>\nNEGATIVE: <robust negative prompt>"
                        if 'messages' in payload and len(payload['messages']) > 0:
                            last_content = payload['messages'][-1]['content']
                            if isinstance(last_content, list):
                                text_injected = False
                                for item in last_content:
                                    if isinstance(item, dict) and item.get('type') == 'text':
                                        item['text'] = system_injection
                                        text_injected = True
                                        break
                                if not text_injected:
                                    last_content.append({"type": "text", "text": system_injection})
                            else:
                                payload['messages'][-1]['content'] = system_injection
                        elif 'prompt' in payload:
                            payload['prompt'] = system_injection
                            
                        # Update body_data to forward the modified payload
                        body_data = json.dumps(payload).encode('utf-8')
                        self.headers.replace_header('Content-Length', str(len(body_data)))
                        # Let it fall through to forward_request

                    if text_prompt == "/help":
                        help_msg = (
                            "**Available Commands:**\n"
                            "- `/draw <prompt>` : Generate an image\n"
                            "- `/art <prompt>` : Auto-enhance prompt and generate image\n"
                            "- `/guess` : AI visually analyzes last image and guesses a prompt\n"
                            "- `/yes` : Confirm and generate the AI's guessed prompt\n"
                            "- `/cfg <0-20>` : Set image generation CFG scale (e.g. `/cfg 7.5`)\n"
                            "- `/step <0-50>` : Set image generation steps (e.g. `/step 20`)\n"
                            "- `/res <WxH>` : Set image resolution (e.g. `/res 1024x1024`)\n"
                            "- `/sys` or `/hw` : View system hardware stats\n"
                            "- `/eject` or `/unload` : Unload current model from memory\n"
                            "- `/models` : List available models\n"
                            "- `/clear` : Clear context\n"
                            "- `/compact` : Compact context\n"
                            "- `/hook` : Test Discord webhook"
                        )
                        self.send_assistant_message(help_msg, payload.get('stream', False))
                        return

                    import re
                    if "/cfg " in text_prompt or text_prompt.startswith("/cfg"):
                        try:
                            match = re.search(r'/cfg\s+([0-9.]+)', text_prompt)
                            if match:
                                val = float(match.group(1))
                                if 0 <= val <= 20:
                                    self.server.config_manager.save_config({"swarm_cfg": str(val)})
                                    self.send_assistant_message(f"*CFG Scale updated to {val}*", payload.get('stream', False))
                                else:
                                    self.send_assistant_message("*CFG must be between 0 and 20.*", payload.get('stream', False))
                            else:
                                self.send_assistant_message("*Invalid format. Use: `/cfg 7.5`*", payload.get('stream', False))
                        except ValueError:
                            self.send_assistant_message("*Invalid format. Use: `/cfg 7.5`*", payload.get('stream', False))
                        return

                    if "/step " in text_prompt or text_prompt.startswith("/step"):
                        try:
                            match = re.search(r'/step\s+([0-9]+)', text_prompt)
                            if match:
                                val = int(match.group(1))
                                if 0 <= val <= 50:
                                    self.server.config_manager.save_config({"swarm_steps": str(val)})
                                    self.send_assistant_message(f"*Steps updated to {val}*", payload.get('stream', False))
                                else:
                                    self.send_assistant_message("*Steps must be between 0 and 50.*", payload.get('stream', False))
                            else:
                                self.send_assistant_message("*Invalid format. Use: `/step 20`*", payload.get('stream', False))
                        except ValueError:
                            self.send_assistant_message("*Invalid format. Use: `/step 20`*", payload.get('stream', False))
                        return

                    if "/res " in text_prompt or text_prompt.startswith("/res"):
                        try:
                            match = re.search(r'/res\s+([0-9]+)[xX]([0-9]+)', text_prompt)
                            if match:
                                w, h = int(match.group(1)), int(match.group(2))
                                self.server.config_manager.save_config({"swarm_width": str(w), "swarm_height": str(h)})
                                self.send_assistant_message(f"*Resolution updated to {w}x{h}*", payload.get('stream', False))
                            else:
                                self.send_assistant_message("*Invalid format. Use: `/res 1024x1024`*", payload.get('stream', False))
                        except Exception:
                            self.send_assistant_message("*Invalid format. Use: `/res 1024x1024`*", payload.get('stream', False))
                        return

                    if text_prompt == "/yes" or text_prompt.startswith("/yes "):
                        self.log_ui("[INFO] Intercepted /yes command. Scanning history for generated prompt...")
                        if 'messages' in payload:
                            for msg in reversed(payload['messages']):
                                if msg.get('role') == 'assistant':
                                    content = msg.get('content', '')
                                    if isinstance(content, str) and ("POSITIVE:" in content or "NEGATIVE:" in content):
                                        self.handle_draw_request(content, payload, is_art=False, is_guess_confirm=True)
                                        return
                        self.send_assistant_message("*(No generated prompt found in recent history. Please run /guess or /art first.)*", payload.get('stream', False))
                        return
                    if text_prompt == "/hook":
                        self.handle_hook_request(payload)
                        return
                    if text_prompt == "/api":
                        self.handle_api_request(payload)
                        return
                    if text_prompt in ["/eject", "/unload"]:
                        self.handle_eject_request(payload)
                        return
                    if text_prompt in ["/sys", "/hw"]:
                        self.handle_sys_request(payload)
                        return
                    if text_prompt == "/models":
                        self.handle_models_request(payload)
                        return
                    if text_prompt == "/clear":
                        self.handle_clear_request(payload)
                        return
                    if text_prompt == "/compact":
                        self.handle_compact_request(payload)
                        return
                except:
                    pass
                
                # If not a draw request, we need to forward it. But we already read the body.
                # So we manually proxy it using the read body.
                internal_port = self.server.config.get("port", 8080) + 1
                url = f"http://127.0.0.1:{internal_port}{self.path}"
                headers = {k: v for k, v in self.headers.items()
                           if k.lower() not in ('host', 'accept-encoding')}
                headers['Accept-Encoding'] = 'gzip, deflate'
                
                try:
                    resp = requests.post(url, headers=headers, data=body_data, timeout=30)
                    body_bytes = resp.content  # auto-decompresses gzip/deflate
                    self.send_response(resp.status_code)
                    skip_headers = (
                        'transfer-encoding', 'content-encoding', 'connection',
                        'content-length', 'cross-origin-embedder-policy',
                        'cross-origin-opener-policy', 'cross-origin-resource-policy'
                    )
                    for k, v in resp.headers.items():
                        if k.lower() not in skip_headers:
                            self.send_header(k, v)
                    self.send_header('Content-Length', str(len(body_bytes)))
                    self.send_header('Connection', 'close')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(body_bytes)
                except Exception as e:
                    if getattr(self.server, 'is_generating_image', False):
                        self.send_response(200)
                        self.send_header('Content-Type', 'application/json')
                        self.end_headers()
                        self.wfile.write(b'{"error": "Currently generating image..."}')
                        return
                    self.send_error(502, f"Bad Gateway: {str(e)}")
                return

        self.forward_request()

    def send_assistant_message(self, text, is_stream):
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream' if is_stream else 'application/json')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Connection', 'keep-alive')
        self.end_headers()
        
        if is_stream:
            chunk = {"choices":[{"delta":{"content": text}}]}
            self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode('utf-8'))
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        else:
            resp = {
                "choices": [{
                    "message": {"role": "assistant", "content": text}
                }]
            }
            self.wfile.write(json.dumps(resp).encode('utf-8'))

    def handle_eject_request(self, payload):
        self.send_assistant_message("*Model ejected. VRAM cleared.*\n\n*(Type any message to wake me back up)*", payload.get('stream', False))
        
        def eject_task():
            time.sleep(1)
            if hasattr(self.server, 'process_manager') and self.server.process_manager:
                self.server.process_manager.stop_server()
                cfg = self.server.config_manager.get_config()
                cfg['model_path'] = ''
                cfg['vision_projector'] = ''
                self.server.process_manager.start_server(cfg)
                
        threading.Thread(target=eject_task, daemon=True).start()

    def handle_sys_request(self, payload):
        try:
            import psutil
            mem = psutil.virtual_memory()
            ram = f"{round(mem.used / (1024**3), 2)}GB / {round(mem.total / (1024**3), 2)}GB ({mem.percent}%)"
            cpu = f"{psutil.cpu_percent(interval=0.1)}%"
        except:
            ram = "N/A"
            cpu = "N/A"
            
        try:
            import subprocess
            result = subprocess.check_output(
                ['nvidia-smi', '--query-gpu=name,memory.used,memory.total', '--format=csv,nounits,noheader'],
                text=True, creationflags=subprocess.CREATE_NO_WINDOW
            )
            parts = result.strip().split('\n')[0].split(',')
            gpu = f"{parts[0].strip()} - {parts[1].strip()}MB / {parts[2].strip()}MB ({round((int(parts[1].strip()) / int(parts[2].strip())) * 100, 1)}%)"
        except:
            gpu = "N/A"

        msg = f"### System Telemetry\n- **GPU VRAM:** {gpu}\n- **System RAM:** {ram}\n- **CPU Usage:** {cpu}"
        self.send_assistant_message(msg, payload.get('stream', False))

    def handle_models_request(self, payload):
        cfg = self.server.config_manager.get_config() if hasattr(self.server, 'config_manager') else self.server.config
        models_dir = cfg.get("models_dir", "")
        if not models_dir or not os.path.exists(models_dir):
            self.send_assistant_message("*Models directory not configured or not found.*", payload.get('stream', False))
            return
            
        from backend.model_scanner import ModelScanner
        scan_result = ModelScanner.scan_directory(models_dir)
        models = scan_result.get("models", [])
        
        if not models:
            self.send_assistant_message("*No `.gguf` models found in directory or subdirectories.*", payload.get('stream', False))
            return
            
        msg = "### Available Models\n" + "\n".join([f"- `{m['name']}` ({m['size_gb']} GB, {'Vision' if m['is_mmproj'] else 'LLM'})" for m in models])
        self.send_assistant_message(msg, payload.get('stream', False))

    def handle_clear_request(self, payload):
        msg = "*Chat context wiped from server!*\n\n*(Note: To clear the messages from your screen, please refresh the page or click 'New Chat' in your client).* "
        self.send_assistant_message(msg, payload.get('stream', False))

    def handle_compact_request(self, payload):
        is_stream = payload.get('stream', False)
        
        messages = payload.get('messages', [])
        if len(messages) <= 2:
            self.send_assistant_message("*Chat is already too short to compact!*", is_stream)
            return
            
        chat_text = ""
        for m in messages[:-1]:
            role = m.get('role', 'user')
            content = m.get('content', '')
            chat_text += f"{role.upper()}: {content}\n\n"
            
        summary_prompt = f"Please read the following chat history and summarize it into a highly condensed, dense block of text that retains all critical facts, context, code snippets, and active tasks. This will be used as the new memory context for the next chat session. DO NOT add conversational filler.\n\nCHAT HISTORY:\n{chat_text}\n\nDense Summary:"
        
        payload['messages'] = [{"role": "user", "content": summary_prompt}]
        payload['stream'] = True
        
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream' if is_stream else 'application/json')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Connection', 'keep-alive')
        self.end_headers()
        
        def send_chunk(text):
            if is_stream:
                chunk = {"choices":[{"delta":{"content": text}}]}
                self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode('utf-8'))
                self.wfile.flush()
                
        send_chunk("*Compacting chat history...*\n\n> ")
        
        internal_port = self.server.config.get("port", 8080) + 1
        url = f"http://127.0.0.1:{internal_port}{self.path}"
        
        try:
            resp = requests.post(url, json=payload, stream=True, timeout=120)
            for line in resp.iter_lines():
                if line:
                    decoded = line.decode('utf-8')
                    if decoded.startswith('data: '):
                        data_str = decoded[6:]
                        if data_str == '[DONE]':
                            break
                        try:
                            data = json.loads(data_str)
                            if 'choices' in data and len(data['choices']) > 0:
                                delta = data['choices'][0].get('delta', {})
                                content = delta.get('content', '')
                                if not content and 'text' in data['choices'][0]:
                                    content = data['choices'][0]['text']
                                if content:
                                    send_chunk(content)
                        except:
                            pass
        except Exception as e:
            send_chunk(f"\n*[Error compacting chat: {e}]*\n")
            
        send_chunk("\n\n*✅ Compaction complete. Please copy the text block above, click 'New Chat' to clear your screen, and paste it as your first message to continue with this condensed memory!*")
        
        if is_stream:
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        else:
            self.wfile.write(b"") # Not perfectly handling non-stream for simplicity since most clients stream

    def handle_api_request(self, payload):
        is_stream = payload.get('stream', False)
        
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream' if is_stream else 'application/json')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Connection', 'keep-alive')
        self.end_headers()
        
        cfg = self.server.config_manager.get_config() if hasattr(self.server, 'config_manager') else self.server.config
        host = cfg.get("host", "127.0.0.1")
        if host == "0.0.0.0":
            host = "127.0.0.1"
        port = cfg.get("port", 8080)
        
        model_path = cfg.get("model_path", "")
        model_name = os.path.basename(model_path) if model_path else "local-model"
        
        msg = f"""Here is how to connect external AI agents (like **Cline** or **Hermes** or **Other**) to this server:

### **API Configuration**
*   **API Provider:** `OpenAI Compatible`
*   **Base URL:** `http://{host}:{port}/v1`
*   **API Key:** `sk-llama-runner` *(or literally anything, it doesn't matter)*
*   **Model ID:** `{model_name}` *(or leave blank)*

This server flawlessly intercepts standard OpenAI API calls (`/v1/chat/completions`) and pipes them through to the loaded `.gguf` model. You can safely drop the Base URL above into any OpenAI-compatible client!"""

        if is_stream:
            # Send the entire message in one chunk for speed
            chunk = {"choices":[{"delta":{"content": msg}}]}
            self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode('utf-8'))
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        else:
            resp = {
                "choices": [{
                    "message": {"role": "assistant", "content": msg}
                }]
            }
            self.wfile.write(json.dumps(resp).encode('utf-8'))

    def _dispatch_discord_webhook(self, image_path, pos_prompt, neg_prompt, width, height, cfg, steps):
        webhook_url = self.server.config.get("discord_webhook", "")
        if not webhook_url: return
        
        self.log_ui("[INFO] Preparing to send generated image to Discord Webhook...")
        
        import threading
        def _post():
            try:
                import requests
                with open(image_path, 'rb') as f:
                    files = {'file': ('image.jpg', f, 'image/jpeg')}
                    pos = pos_prompt if pos_prompt else "N/A"
                    neg = neg_prompt if neg_prompt else "N/A"
                    
                    if len(pos) + len(neg) > 5000:
                        pos = pos[:4000] + "..."
                        neg = neg[:950] + "..."
                        
                    fields = []
                    
                    # Chunk Positive Prompt
                    pos_chunks = [pos[i:i+1000] for i in range(0, len(pos), 1000)]
                    for i, chunk in enumerate(pos_chunks):
                        name = f"Positive Prompt ({i+1}/{len(pos_chunks)})" if len(pos_chunks) > 1 else "Positive Prompt"
                        fields.append({"name": name, "value": chunk})
                        
                    # Chunk Negative Prompt
                    neg_chunks = [neg[i:i+1000] for i in range(0, len(neg), 1000)]
                    for i, chunk in enumerate(neg_chunks):
                        name = f"Negative Prompt ({i+1}/{len(neg_chunks)})" if len(neg_chunks) > 1 else "Negative Prompt"
                        fields.append({"name": name, "value": chunk})
                        
                    fields.extend([
                        {"name": "Resolution", "value": f"{width}x{height}", "inline": True},
                        {"name": "CFG Scale", "value": str(cfg), "inline": True},
                        {"name": "Steps", "value": str(steps), "inline": True}
                    ])
                    
                    payload = {
                        "content": "**New Image Generated!**",
                        "embeds": [{
                            "title": "Image Metadata",
                            "color": 5814783,
                            "image": {"url": "attachment://image.jpg"},
                            "fields": fields
                        }]
                    }
                    import json
                    resp = requests.post(webhook_url, data={'payload_json': json.dumps(payload)}, files=files, timeout=30)
                    if resp.status_code >= 400:
                        self.log_ui(f"[ERR] Discord Webhook Error: {resp.status_code} - {resp.text}")
                    else:
                        self.log_ui("[INFO] Successfully sent generated image to Discord Webhook.")
            except Exception as e:
                self.log_ui(f"[ERR] Discord Webhook Exception: {str(e)}")
                
        threading.Thread(target=_post, daemon=True).start()

    def handle_hook_request(self, payload):
        is_stream = payload.get('stream', False)
        if is_stream:
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            
            def send_chunk(text):
                chunk_data = json.dumps({"choices": [{"delta": {"content": text}}]})
                self.wfile.write(f"data: {chunk_data}\n\n".encode('utf-8'))
                self.wfile.flush()
                
            last_img = getattr(self.server, 'last_generated_image_data', None)
            if not last_img:
                send_chunk("*No image has been generated yet in this session to send to Discord!*")
            else:
                webhook_url = self.server.config.get("discord_webhook", "")
                if not webhook_url:
                    send_chunk("*No Discord Webhook URL is configured in settings!*")
                else:
                    send_chunk("*Forwarding the last generated image to Discord Webhook...*")
                    # Unpack
                    image_path, pos_prompt, neg_prompt, width, height, cfg, steps = last_img
                    self._dispatch_discord_webhook(image_path, pos_prompt, neg_prompt, width, height, cfg, steps)
            
            self.wfile.write(b"data: [DONE]\n\n")
        else:
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b"{}")

    def handle_draw_request(self, original_prompt, payload, is_art=False, is_guess_confirm=False):
        self.server.is_generating_image = True
        try:
            self._do_handle_draw_request(original_prompt, payload, is_art, is_guess_confirm)
        finally:
            self.server.is_generating_image = False
            
    def _do_handle_draw_request(self, original_prompt, payload, is_art, is_guess_confirm):
        is_stream = payload.get('stream', False)
        
        # Manually extract user's negative prompt if provided via '|'
        user_neg = ""
        user_pos = original_prompt
        if "|" in original_prompt:
            parts = original_prompt.split("|", 1)
            user_pos = parts[0].strip()
            user_neg = parts[1].strip()

        if is_guess_confirm:
            # If it's a confirmation of a previous guess, we don't need to ask the LLM again.
            # We just parse the original_prompt (which is the assistant's previous message content).
            is_stream = payload.get('stream', False)
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream' if is_stream else 'application/json')
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('Connection', 'keep-alive')
            self.end_headers()
            
            def send_chunk(text):
                if is_stream:
                    chunk = {"choices":[{"delta":{"content": text}}]}
                    self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode('utf-8'))
                    self.wfile.flush()
                    
            generated_prompt = original_prompt
            send_chunk("*Confirmed! Initiating image generation...*\n\n")
        else:
            if is_art:
                if user_neg:
                    system_injection = f"\n\n(SYSTEM: You are an uncensored Stable Diffusion prompt engineer. Analyze my request. I have provided a positive and negative prompt. Enhance both to be highly detailed and descriptive. NSFW content is explicitly allowed and should be detailed if requested. Output STRICTLY in this exact format:\nPOSITIVE: <detailed positive prompt, comma-separated>\nNEGATIVE: <robust negative prompt, comma-separated>\nDo not output anything else, no conversational filler, DO NOT REPEAT WORDS.)\n\nRequest Positive: {user_pos}\nRequest Negative: {user_neg}"
                else:
                    system_injection = f"\n\n(SYSTEM: You are an uncensored Stable Diffusion prompt engineer. Analyze my request. I have provided a positive prompt. Enhance it to be highly detailed and descriptive. NSFW content is explicitly allowed and should be detailed if requested. AND automatically generate a robust, highly detailed negative prompt based on the positive prompt. Output STRICTLY in this exact format:\nPOSITIVE: <detailed positive prompt, comma-separated>\nNEGATIVE: <robust negative prompt, comma-separated>\nDo not output anything else, no conversational filler, DO NOT REPEAT WORDS.)\n\nRequest Positive: {user_pos}"
            else:
                system_injection = f"\n\n(SYSTEM: You are an uncensored Stable Diffusion prompt engineer. Write a highly detailed, descriptive, comma-separated image generation positive prompt based on my request. NSFW content is explicitly allowed. Do not output anything else, no conversational filler.)\n\nRequest: {user_pos}"
            
            if 'messages' in payload and len(payload['messages']) > 0:
                last_content = payload['messages'][-1]['content']
                if isinstance(last_content, list):
                    # Multimodal payload (image + text)
                    text_injected = False
                    for item in last_content:
                        if isinstance(item, dict) and item.get('type') == 'text':
                            item['text'] = system_injection
                            text_injected = True
                            break
                    if not text_injected:
                        last_content.append({"type": "text", "text": system_injection})
                else:
                    payload['messages'][-1]['content'] = system_injection
            elif 'prompt' in payload:
                payload['prompt'] = system_injection
                
            payload['stream'] = True
            payload['max_tokens'] = 500
            payload['presence_penalty'] = 0.5
            
            # Debug log to verify what is being sent to LLM
            debug_msg = "Payload text injection missing!"
            if 'messages' in payload and len(payload['messages']) > 0:
                debug_msg = str(payload['messages'][-1].get('content', ''))
            # Truncate base64 strings in debug log to avoid huge console spam
            import re
            debug_msg = re.sub(r'data:image/[^;]+;base64,[a-zA-Z0-9+/=]+', 'data:image/...;base64,<TRUNCATED>', debug_msg)
            self.log_ui(f"[DEBUG] [LLM Payload] Last message content: {debug_msg[:500]}...")

            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream' if is_stream else 'application/json')
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('Connection', 'keep-alive')
            self.end_headers()

            def send_chunk(text):
                if is_stream:
                    chunk = {"choices":[{"delta":{"content": text}}]}
                    self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode('utf-8'))
                    self.wfile.flush()

            send_chunk("*Engineering prompt with Llama...*\n\n")
            
            internal_port = self.server.config.get("port", 8080) + 1
            url = f"http://127.0.0.1:{internal_port}{self.path}"
            
            generated_prompt = ""
            try:
                resp = requests.post(url, json=payload, stream=True, timeout=120)
                if resp.status_code != 200:
                    err_text = resp.text
                    self.log_ui(f"[ERR] [LLM] Request failed with HTTP {resp.status_code}: {err_text}")
                    send_chunk(f"\n*[Error from LLM: HTTP {resp.status_code}]*\n")
                else:
                    content_type = resp.headers.get('Content-Type', '')
                    if 'application/json' in content_type:
                        # Model returned a single JSON object instead of a stream
                        data = resp.json()
                        if 'choices' in data and len(data['choices']) > 0:
                            msg = data['choices'][0].get('message', {})
                            content = msg.get('content', '')
                            if not content and 'text' in data['choices'][0]:
                                content = data['choices'][0]['text']
                            if content:
                                safe_content = content.replace("```", "")
                                generated_prompt += content
                                send_chunk(safe_content)
                    else:
                        # Stream parsing
                        for line in resp.iter_lines():
                            if line:
                                decoded = line.decode('utf-8')
                                if decoded.startswith('data: '):
                                    data_str = decoded[6:]
                                    if data_str == '[DONE]':
                                        break
                                    try:
                                        data = json.loads(data_str)
                                        if 'choices' in data and len(data['choices']) > 0:
                                            delta = data['choices'][0].get('delta', {})
                                            content = delta.get('content', '')
                                            if not content and 'text' in data['choices'][0]:
                                                content = data['choices'][0]['text']
                                            if content:
                                                safe_content = content.replace("```", "")
                                                generated_prompt += content
                                                send_chunk(safe_content)
                                    except:
                                        pass
            except Exception as e:
                send_chunk(f"\n*[Error generating prompt: {e}]*\n")
                generated_prompt = original_prompt # fallback
            
        send_chunk("\n\n---\n\n")

        # 1. Stop Server to free VRAM
        if self.server.process_manager:
            send_chunk("*Llama server stopped. Unloading from VRAM...*\n\n")
            self.server.process_manager.stop_server()
            time.sleep(2) # Give it time to fully flush VRAM
            
        # 2. Call SwarmUI
        try:
            fresh_cfg = self.server.config_manager.get_config()
            port = fresh_cfg.get("swarm_port", 7801)
            host = fresh_cfg.get("swarm_host", "127.0.0.1")
            if not host: host = "127.0.0.1"
            base_url = f"http://{host}:{port}"
            
            send_chunk("*Generating image on GPU...*\n\n")
            self.log_ui("[INFO] Requesting new session from SwarmUI API...")
            session_resp = requests.post(f"{base_url}/API/GetNewSession", json={}, timeout=10)
            session_id = session_resp.json().get("session_id", "local") if session_resp.status_code == 200 else "local"

            model_name = "qwen-image-2.1-UC-Q6_K.gguf"

            steps = int(fresh_cfg.get("swarm_steps", 20))
            cfg_scale = float(fresh_cfg.get("swarm_cfg", 7.0))
            width = int(fresh_cfg.get("swarm_width", 1024))
            height = int(fresh_cfg.get("swarm_height", 1024))
            
            default_neg = "ugly, blurry, low quality, deformed, mutated, bad anatomy, bad proportions, poorly drawn face, poorly drawn hands, extra limbs, cloned face, disfigured, gross proportions"
            
            if is_art or is_guess_confirm:
                pos_prompt = user_pos
                neg_prompt = user_neg if user_neg else default_neg
                gen_text = generated_prompt.strip()
                if "POSITIVE:" in gen_text or "NEGATIVE:" in gen_text:
                    lines = gen_text.split('\n')
                    p_lines = []
                    n_lines = []
                    current = None
                    for line in lines:
                        if line.startswith("POSITIVE:"):
                            current = 'P'
                            p_lines.append(line.replace("POSITIVE:", "").strip())
                        elif line.startswith("NEGATIVE:"):
                            current = 'N'
                            n_lines.append(line.replace("NEGATIVE:", "").strip())
                        elif current == 'P':
                            p_lines.append(line.strip())
                        elif current == 'N':
                            n_lines.append(line.strip())
                            
                    if p_lines: pos_prompt = " ".join(p_lines).strip()
                    if n_lines: neg_prompt = " ".join(n_lines).strip()
                else:
                    if is_guess_confirm:
                        # Fallback: if the LLM completely ignored the formatting, use its entire response as the positive prompt
                        cleaned = gen_text.replace("Here is a prompt", "").replace("Prompt:", "").strip(' "\'\n\r')
                        if cleaned:
                            pos_prompt = cleaned
            else:
                pos_prompt = generated_prompt.strip()
                if "POSITIVE:" in pos_prompt:
                    pos_prompt = pos_prompt.split("POSITIVE:")[-1].strip()
                if not pos_prompt:
                    pos_prompt = user_pos
                    
                neg_prompt = user_neg if user_neg else default_neg
                
            self.log_ui(f"[INFO] Final Positive Prompt: {pos_prompt}")
            self.log_ui(f"[INFO] Final Negative Prompt: {neg_prompt}")
                
            swarm_url = f"{base_url}/API/GenerateText2Image"
            swarm_payload = {
                "session_id": session_id,
                "prompt": pos_prompt,
                "negativeprompt": neg_prompt,
                "images": 1,
                "donotsave": False,
                "steps": steps,
                "cfgscale": cfg_scale,
                "width": width,
                "height": height
            }
            if model_name:
                swarm_payload["model"] = model_name
                
            import threading
            s_result = {}
            def fetch_swarm():
                self.log_ui(f"[INFO] Dispatching {width}x{height} image request to SwarmUI (cfg: {cfg_scale}, steps: {steps})...")
                try:
                    s_result['resp'] = requests.post(swarm_url, json=swarm_payload, timeout=1200)
                except Exception as e:
                    s_result['error'] = e

            swarm_thread = threading.Thread(target=fetch_swarm)
            swarm_thread.start()
            
            while swarm_thread.is_alive():
                send_chunk("") # Send empty chunk to keep SSE connection alive
                swarm_thread.join(timeout=2.0)
                
            if 'error' in s_result:
                raise s_result['error']
                
            s_resp = s_result['resp']
            if s_resp.status_code == 200:
                s_data = s_resp.json()
                if 'images' in s_data and len(s_data['images']) > 0:
                    image_val = s_data['images'][0]
                    if image_val.startswith("http"):
                        send_chunk(f"\n\n![Generated Image]({image_val})\n\n")
                    elif image_val.startswith("/") or image_val.startswith("Output"):
                        base_url = "http://127.0.0.1:7801"
                        if not image_val.startswith("/"):
                            image_val = "/" + image_val
                        send_chunk(f"\n\n![Generated Image]({base_url}{image_val})\n\n")
                    else:
                        if image_val.startswith("data:image"):
                            image_val = image_val.split(",")[1]
                        
                        try:
                            # Attempt base64 decode
                            import base64
                            b64_val = image_val
                            pad = len(b64_val) % 4
                            if pad != 0:
                                b64_val += "=" * (4 - pad)
                            img_data = base64.b64decode(b64_val)
                            
                            if len(img_data) < 1000:
                                self.log_ui("[ERR] Decoded base64 image data is suspiciously small (<1000 bytes). Validation failed.")
                                raise ValueError("Decoded image is too small to be valid")
                                
                            cache_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'ui', 'generated_cache')
                            os.makedirs(cache_dir, exist_ok=True)
                            img_name = f"swarm_{uuid.uuid4().hex[:8]}.jpg"
                            full_path = os.path.join(cache_dir, img_name)
                            with open(full_path, 'wb') as f:
                                f.write(img_data)
                            
                            self.log_ui(f"[INFO] Successfully saved generated image to cache: {img_name}")
                            
                            import urllib.parse
                            safe_path = urllib.parse.quote(full_path)
                            my_port = self.server.config.get("port", 8080) if hasattr(self.server, 'config') else 8080
                            req_host = self.headers.get('Host', f"127.0.0.1:{my_port}")
                            send_chunk(f"\n\n![Generated Image](http://{req_host}/local_image?path={safe_path})\n\n")
                            self.server.last_generated_image_data = (full_path, pos_prompt, neg_prompt, width, height, cfg_scale, steps)
                            self._dispatch_discord_webhook(full_path, pos_prompt, neg_prompt, width, height, cfg_scale, steps)
                        except Exception:
                            # Fallback: SwarmUI likely returned a relative file path (like 'ViewImage?image=Output/xyz.png')
                            import urllib.parse
                            base_url = "http://127.0.0.1:7801"
                            if not image_val.startswith("/"):
                                image_val = "/" + image_val
                            
                            # Download the image from SwarmUI server to bypass CORS in UI
                            safe_url = urllib.parse.quote(image_val, safe='/?=&')
                            swarm_img_url = f"{base_url}{safe_url}"
                            
                            try:
                                self.log_ui(f"[INFO] Attempting fallback download directly from SwarmUI: {swarm_img_url}")
                                img_resp = requests.get(swarm_img_url, timeout=10)
                                if img_resp.status_code == 200 and len(img_resp.content) > 1000:
                                    cache_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'ui', 'generated_cache')
                                    os.makedirs(cache_dir, exist_ok=True)
                                    img_name = f"swarm_{uuid.uuid4().hex[:8]}.jpg"
                                    full_path = os.path.join(cache_dir, img_name)
                                    with open(full_path, 'wb') as f:
                                        f.write(img_resp.content)
                                    
                                    safe_path = urllib.parse.quote(full_path)
                                    my_port = self.server.config.get("port", 8080) if hasattr(self.server, 'config') else 8080
                                    req_host = self.headers.get('Host', f"127.0.0.1:{my_port}")
                                    send_chunk(f"\n\n![Generated Image](http://{req_host}/local_image?path={safe_path})\n\n")
                                    self.server.last_generated_image_data = (full_path, pos_prompt, neg_prompt, width, height, cfg_scale, steps)
                                    self._dispatch_discord_webhook(full_path, pos_prompt, neg_prompt, width, height, cfg_scale, steps)
                                else:
                                    send_chunk(f"\n*SwarmUI failed to generate a valid image. (The prompt might have triggered an internal error or (NSFW) filter).*\n")
                            except Exception:
                                send_chunk(f"\n*SwarmUI failed to generate a valid image.* \n")
                else:
                    send_chunk(f"\n*SwarmUI returned: {s_resp.text}*")
            else:
                send_chunk(f"\n*SwarmUI API returned {s_resp.status_code}: {s_resp.text}*")
        except Exception as e:
            send_chunk(f"\n*Failed to generate image: {str(e)}*")

        # 3. Restart Server
        send_chunk("\n*Restoring Llama server to VRAM...*\n")
        if self.server.process_manager and self.server.config_manager:
            cfg = self.server.config_manager.get_config()
            self.server.process_manager.start_server(cfg)
            
            # Wait for server to come back online
            internal_port = int(cfg.get("port", 8080)) + 1
            max_retries = 30
            for i in range(max_retries):
                try:
                    s = socket.create_connection(("127.0.0.1", internal_port), timeout=1)
                    s.close()
                    break
                except:
                    time.sleep(1)
            
            send_chunk("*Llama server successfully restored!*\n")
            
        if is_stream:
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        else:
            pass

class LlamaProxyServer(threading.Thread):
    def __init__(self, process_manager, config_manager):
        super().__init__(daemon=True)
        self.process_manager = process_manager
        self.config_manager = config_manager
        self.httpd = None
        self.last_interaction = time.time()
        self._sleep_checker_thread = threading.Thread(target=self._auto_sleep_loop, daemon=True)
        self._sleep_checker_thread.start()

    def _auto_sleep_loop(self):
        while True:
            time.sleep(10)
            try:
                config = self.config_manager.get_config()
                if config.get("auto_sleep", False):
                    if time.time() - self.last_interaction > 600:
                        if self.process_manager.check_status() and not getattr(self.httpd, 'is_generating_image', False):
                            self.process_manager.stop_server()
            except Exception:
                pass

    def run(self):
        config = self.config_manager.get_config()
        port = int(config.get("port", 8080))
        
        server_address = ('', port)
        self.httpd = ThreadingHTTPServer(server_address, LlamaProxyHandler)
        self.httpd.process_manager = self.process_manager
        self.httpd.config_manager = self.config_manager
        self.httpd.config = config
        self.httpd.is_generating_image = False
        self.httpd.serve_forever()
        
    def stop(self):
        if self.httpd:
            self.httpd.shutdown()
            self.httpd.server_close()
