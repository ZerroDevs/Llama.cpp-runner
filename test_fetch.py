import requests, json
url = 'http://127.0.0.1:8080/v1/chat/completions'
headers = {'Content-Type': 'application/json'}
data = {'messages': [{'role': 'user', 'content': 'test'}], 'stream': True}
try:
    resp = requests.post(url, headers=headers, json=data, stream=True)
    print('Status:', resp.status_code)
    print('Headers:', dict(resp.headers))
    for chunk in resp.iter_content(chunk_size=1024):
        print('Chunk:', chunk)
        break
except Exception as e:
    print('Error:', e)