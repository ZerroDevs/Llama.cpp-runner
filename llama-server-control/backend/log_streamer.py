import threading
import queue

class LogStreamer:
    def __init__(self, stream, window):
        self.stream = stream
        self.window = window
        self.running = False
        self.thread = None

    def start(self):
        self.running = True
        self.thread = threading.Thread(target=self._stream_logs, daemon=True)
        self.thread.start()

    def _stream_logs(self):
        for line in iter(self.stream.readline, ''):
            if not self.running:
                break
            if line:
                cleaned_line = line.strip()
                if self.window:
                    import json
                    try:
                        self.window.evaluate_js(f"window.receiveLog({json.dumps(cleaned_line)})")
                    except Exception as e:
                        pass
        self.stream.close()

    def stop(self):
        self.running = False
