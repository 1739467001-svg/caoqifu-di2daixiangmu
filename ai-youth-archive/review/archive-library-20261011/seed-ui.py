"""Create private, fictional fixtures only in the isolated localhost:8788 QA service."""
import base64
import http.client
import json

cookie = None

def call(path, data):
    global cookie
    client = http.client.HTTPConnection('127.0.0.1', 8788, timeout=15)
    headers = {'Content-Type': 'application/json', 'X-Archive-Client': '1'}
    if cookie:
        headers['Cookie'] = cookie
    client.request('POST', '/api' + path, json.dumps(data, ensure_ascii=False).encode(), headers)
    response = client.getresponse()
    result = json.loads(response.read())
    if response.status >= 400:
        raise RuntimeError(result.get('error', response.status))
    if response.getheader('Set-Cookie'):
        cookie = response.getheader('Set-Cookie').split(';')[0]
    client.close()
    return result

call('/auth/register', {'username': 'library_ui_demo', 'password': 'fictional-qa-password', 'name': '档案馆演示账号'})
call('/projects', {'title': '演示 · AI小游戏', 'summary': '用AI做了一款找星星的小工具，记录第一版到第二版的变化。', 'tech': 'HTML、AI', 'role': '整理想法、制作页面和测试', 'event': '演示 · 周末黑客松', 'status': '进行中', 'visibility': 'private', 'url': '', 'notes': '仅用于界面测试，不是真实参赛作品。'})
call('/files', {'name': '演示-路演提纲.txt', 'content': base64.b64encode('演示资料：问题、作品使用过程、我做了什么。'.encode()).decode(), 'category': '参赛材料'})
print('Isolated fictional account, private project and attachment ready.')
