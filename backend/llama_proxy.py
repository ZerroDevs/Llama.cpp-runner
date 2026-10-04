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

    def forward_request(self):
        # We forward to the internal llama-server port (public port + 1)
        internal_port = self.server.config.get("port", 8080) + 1
        url = f"http://127.0.0.1:{internal_port}{self.path}"
        
        headers = {k: v for k, v in self.headers.items() if k.lower() not in ('host', 'content-length')}
        body = None
        if 'Content-Length' in self.headers:
            body = self.rfile.read(int(self.headers['Content-Length']))

        try:
            resp = requests.request(
                method=self.command,
                url=url,
                headers=headers,
                data=body,
                stream=True,
                timeout=30
            )
            
            self.send_response(resp.status_code)
            for k, v in resp.headers.items():
                if k.lower() not in ('transfer-encoding', 'content-encoding', 'connection'):
                    self.send_header(k, v)
            self.end_headers()
            
            for chunk in resp.iter_content(chunk_size=4096):
                if chunk:
                    self.wfile.write(chunk)
                    self.wfile.flush()
        except Exception as e:
            if getattr(self.server, 'is_generating_image', False):
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(b"{}")
                return
            self.send_error(502, f"Bad Gateway: {str(e)}")

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
                    # Check if the last message starts with /draw
                    prompt = ""
                    if 'messages' in payload and len(payload['messages']) > 0:
                        prompt = payload['messages'][-1].get('content', '')
                    elif 'prompt' in payload:
                        prompt = payload['prompt']
                    
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
                    
                    if "/draw " in prompt or prompt.startswith("/draw"):
                        self.handle_draw_request(prompt.replace("/draw", "").strip(), payload)
                        return
                    if prompt.strip() == "/api":
                        self.handle_api_request(payload)
                        return
                except:
                    pass
                
                # If not a draw request, we need to forward it. But we already read the body.
                # So we manually proxy it using the read body.
                internal_port = self.server.config.get("port", 8080) + 1
                url = f"http://127.0.0.1:{internal_port}{self.path}"
                headers = {k: v for k, v in self.headers.items() if k.lower() not in ('host', 'content-length')}
                
                try:
                    resp = requests.post(url, headers=headers, data=body_data, stream=True, timeout=30)
                    self.send_response(resp.status_code)
                    for k, v in resp.headers.items():
                        if k.lower() not in ('transfer-encoding', 'content-encoding', 'connection'):
                            self.send_header(k, v)
                    self.end_headers()
                    for chunk in resp.iter_content(chunk_size=4096):
                        if chunk:
                            self.wfile.write(chunk)
                            self.wfile.flush()
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
        
        msg = f"""Here is how to connect external AI agents (like **Cline** or **Hermes**) to this server:

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

    def handle_draw_request(self, original_prompt, payload):
        self.server.is_generating_image = True
        try:
            self._do_handle_draw_request(original_prompt, payload)
        finally:
            self.server.is_generating_image = False
            
    def _do_handle_draw_request(self, original_prompt, payload):
        is_stream = payload.get('stream', False)
        
        # Modify payload to ask LLM for prompt safely without breaking chat templates
        if 'messages' in payload and len(payload['messages']) > 0:
            payload['messages'][-1]['content'] += "\n\n(SYSTEM: You are a Stable Diffusion prompt engineer. Write ONLY a highly detailed, descriptive, comma-separated image generation prompt based on my request. Do not output anything else, no conversational text, ONLY the prompt itself.)"
        elif 'prompt' in payload:
            payload['prompt'] += "\n\n(SYSTEM: Write a highly detailed Stable Diffusion prompt for the above request, comma-separated, no conversational text.)"
            
        payload['stream'] = True # Force internal stream so we can intercept it
        
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

        send_chunk("*Engineering prompt with Llama...*\n\n> ")
        
        internal_port = self.server.config.get("port", 8080) + 1
        url = f"http://127.0.0.1:{internal_port}{self.path}"
        
        generated_prompt = ""
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
                                    generated_prompt += content
                                    send_chunk(content)
                        except:
                            pass
        except Exception as e:
            send_chunk(f"\n*[Error generating prompt: {e}]*\n")
            generated_prompt = original_prompt # fallback
            
        send_chunk("\n\n")

        # 1. Stop Server to free VRAM
        if self.server.process_manager:
            send_chunk("*Llama server stopped. Unloading from VRAM...*\n")
            self.server.process_manager.stop_server()
            time.sleep(2) # Give it time to fully flush VRAM
            
        # 2. Call SwarmUI
        try:
            fresh_cfg = self.server.config_manager.get_config()
            port = fresh_cfg.get("swarm_port", 7801)
            host = fresh_cfg.get("swarm_host", "127.0.0.1")
            if not host: host = "127.0.0.1"
            base_url = f"http://{host}:{port}"
            
            send_chunk("*Generating image on GPU...*\n")
            session_resp = requests.post(f"{base_url}/API/GetNewSession", json={}, timeout=10)
            session_id = session_resp.json().get("session_id", "local") if session_resp.status_code == 200 else "local"

            model_name = "qwen-image-2.1-UC-Q6_K.gguf"

            steps = int(fresh_cfg.get("swarm_steps", 20))
            cfg_scale = float(fresh_cfg.get("swarm_cfg", 7.0))
            width = int(fresh_cfg.get("swarm_width", 1024))
            height = int(fresh_cfg.get("swarm_height", 1024))
            
            swarm_url = f"{base_url}/API/GenerateText2Image"
            swarm_payload = {
                "session_id": session_id,
                "prompt": generated_prompt.strip() if generated_prompt.strip() else original_prompt,
                "negativeprompt": "ugly, blurry, low quality",
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
                            
                            cache_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'ui', 'generated_cache')
                            os.makedirs(cache_dir, exist_ok=True)
                            img_name = f"swarm_{uuid.uuid4().hex[:8]}.jpg"
                            full_path = os.path.join(cache_dir, img_name)
                            with open(full_path, 'wb') as f:
                                f.write(img_data)
                            
                            import urllib.parse
                            safe_path = urllib.parse.quote(full_path)
                            send_chunk(f"\n\n![Generated Image](/local_image?path={safe_path})\n\n")
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
                                img_resp = requests.get(swarm_img_url, timeout=10)
                                if img_resp.status_code == 200:
                                    cache_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'ui', 'generated_cache')
                                    os.makedirs(cache_dir, exist_ok=True)
                                    img_name = f"swarm_{uuid.uuid4().hex[:8]}.jpg"
                                    full_path = os.path.join(cache_dir, img_name)
                                    with open(full_path, 'wb') as f:
                                        f.write(img_resp.content)
                                    
                                    safe_path = urllib.parse.quote(full_path)
                                    send_chunk(f"\n\n![Generated Image](/local_image?path={safe_path})\n\n")
                                else:
                                    send_chunk(f"\n\n![Generated Image]({swarm_img_url})\n\n")
                            except Exception:
                                send_chunk(f"\n\n![Generated Image]({swarm_img_url})\n\n")
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
