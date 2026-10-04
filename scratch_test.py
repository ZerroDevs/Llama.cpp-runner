import webview
import time

def on_min():
    print("Hiding window")
    window.hide()
    print("Hidden")
    time.sleep(2)
    print("Restoring")
    window.show()

window = webview.create_window('T', html='<button onclick="pywebview.api.test()">Minimize</button>')

class Api:
    def test(self):
        on_min()

window._js_api = Api()
webview.start()
