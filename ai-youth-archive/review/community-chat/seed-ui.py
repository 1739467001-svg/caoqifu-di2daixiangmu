"""Clearly labelled synthetic UI fixtures, never production or the user's preview DB."""
import os
import sys
from pathlib import Path
root = Path(__file__).resolve().parents[2]
data = root / '.private-notes' / 'community-chat-ui'
os.environ['ARCHIVE_DATA_DIR'] = str(data)
os.environ['ARCHIVE_SECURE_COOKIE'] = '0'
sys.path.insert(0, str(root / 'backend'))
import server
server.initialize()
assert server.ROOT == data.resolve()
with server.connection() as db:
    for letter,username,name in [('a','ui_creator','测试创作者'),('b','ui_partner','测试伙伴')]:
        ident = letter * 32
        db.execute('INSERT OR IGNORE INTO users(id,username,password,profile,created) VALUES(?,?,?,?,?)',
                   (ident,username,server.password_hash('TestingChatOnly2026'),server.encode({'name':name,'bio':'','skills':'','intent':''}),server.now()))
    examples = [
        ('d','a','update','【测试帖子】我的游戏加入了新的关卡\n这周做完了地图切换，正在调整角色移动。这里是独立测试资料，用于检查帖子标题、正文和回复的显示。'),
        ('e','b','question','【测试帖子】想请大家看看交互是否清楚\n我在做一个作品展示页，准备把提交步骤减到三步。这里是测试内容，不是真实社区用户。'),
        ('f','b','team','【测试帖子】寻找一起做小游戏的伙伴\n想找喜欢关卡设计的人，一起讨论玩法。只用于本地功能验收。')]
    for ident,owner,kind,body in examples:
        db.execute('INSERT OR IGNORE INTO posts VALUES(?,?,?,?,?,?,?)',
                   (ident*32,owner*32,body,kind,None,'approved',server.now()))
print('Synthetic QA fixtures are isolated from 4174 and production.')
