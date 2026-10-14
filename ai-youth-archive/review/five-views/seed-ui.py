"""Disposable synthetic records for desktop UI verification, never the main DB."""
import os
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[2]
data = root / '.private-notes' / 'five-views-ui'
os.environ['ARCHIVE_DATA_DIR'] = str(data)
os.environ['ARCHIVE_SECURE_COOKIE'] = '0'
sys.path.insert(0, str(root / 'backend'))
import server
server.initialize()
assert server.ROOT == data.resolve()
with server.connection() as db:
    for letter, username, name in [('a', 'ui_creator', '测试创作者'), ('b', 'ui_partner', '测试伙伴')]:
        profile = {'name': name, 'bio': '独立验收资料，用来检查个人中心和社区排版。', 'skills': '游戏设计、网页制作', 'intent': '希望交流作品进展'}
        db.execute('INSERT OR IGNORE INTO users(id,username,password,profile,created) VALUES(?,?,?,?,?)',
                   (letter*32, username, server.password_hash('TestingChatOnly2026'), server.encode(profile), server.now()))
    for letter, title in [('c', '【测试作品】我的关卡编辑器'), ('g', '【测试作品】校园问答助手')]:
        body = {'title': title, 'summary': '隔离测试作品，用于验证关联作品与个人资料管理。', 'tech': '网页、AI', 'role': '交互和开发', 'url': '', 'event': '测试黑客松', 'status': '进行中', 'notes': '私人记录不会出现在公开内容中。'}
        db.execute('INSERT OR IGNORE INTO projects VALUES(?,?,?,?,?,?,?)',
                   (letter*32, 'a'*32, server.encode(body), 'private', 'private', server.now(), server.now()))
    for ident, owner, kind, body in [
        ('d', 'a', 'update', '【测试帖子】我的游戏加入了新的关卡\n这周做完了地图切换，正在调整角色移动。希望大家帮我看看操作是否容易理解。'),
        ('e', 'b', 'question', '【测试帖子】想请大家看看交互是否清楚\n我在做一个作品展示页，准备把提交步骤减到三步。这里是测试内容，不是真实社区用户。'),
        ('f', 'b', 'team', '【测试帖子】寻找一起做小游戏的伙伴\n想找喜欢关卡设计的人，一起讨论玩法。只用于本地功能验收。')]:
        db.execute('INSERT OR IGNORE INTO posts VALUES(?,?,?,?,?,?,?)',
                   (ident*32, owner*32, body, kind, None, 'approved', server.now()))
print('Synthetic UI fixtures prepared only in .private-notes/five-views-ui.')
