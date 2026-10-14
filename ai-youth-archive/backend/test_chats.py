"""Private chat integration checks against an isolated real HTTP service and SQLite."""
import http.client
import json
import os
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import closing
from pathlib import Path


class ChatIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Windows sandbox temporary paths may not support SQLite. Keep isolated
        # disposable data under this workspace's ignored private test directory.
        test_parent = Path(__file__).resolve().parent.parent / '.private-notes' / 'integration-tests'
        test_parent.mkdir(parents=True, exist_ok=True)
        cls.temp = tempfile.TemporaryDirectory(prefix='archive-chat-test-', dir=test_parent)
        cls.proc = None
        cls.addClassCleanup(cls.cleanup)
        cls.db_path = Path(cls.temp.name) / 'archive.sqlite3'
        # Simulate an existing install: initialize old tables and a private project
        # before the revised server adds chat tables. No production directory is used.
        with closing(sqlite3.connect(cls.db_path)) as db:
            db.executescript('''
                CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,password TEXT NOT NULL,
                  profile TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'creator',created INTEGER NOT NULL);
                CREATE TABLE projects(id TEXT PRIMARY KEY,owner TEXT REFERENCES users(id) ON DELETE CASCADE,
                  body TEXT NOT NULL,visibility TEXT NOT NULL DEFAULT 'private',review TEXT NOT NULL DEFAULT 'private',
                  created INTEGER NOT NULL,updated INTEGER NOT NULL);
            ''')
            db.execute('INSERT INTO users VALUES(?,?,?,?,?,?)', ('e' * 32, 'existing_private', 'not-a-login-hash',
                        json.dumps({'name': '原有私人用户'}), 'creator', 1))
            db.execute('INSERT INTO projects VALUES(?,?,?,?,?,?,?)', ('f' * 32, 'e' * 32,
                        json.dumps({'title': '原有私人作品'}), 'private', 'private', 1, 1))
            db.commit()
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            cls.port = sock.getsockname()[1]
        cls.env = dict(os.environ, ARCHIVE_DATA_DIR=cls.temp.name, ARCHIVE_SECURE_COOKIE='0', ARCHIVE_COOKIE_PATH='/')
        cls.start()
        for key, name in [('a', '甲公开昵称'), ('b', '乙公开昵称'), ('c', '丙私人昵称')]:
            status, data, headers = cls.call('POST', '/auth/register',
                {'username': 'chat_test_' + key, 'password': 'test-chat-password-' + key, 'name': name})
            assert status == 201, data
            setattr(cls, key, headers['Set-Cookie'].split(';')[0])
            setattr(cls, key + '_id', data['user']['id'])
        cls.call('PUT', '/profile', {'name': '乙公开昵称', 'bio': '私人简介秘密', 'skills': '私人技能秘密'}, cls.b)
        _, project, _ = cls.call('POST', '/projects', {'title': '乙公开作品', 'visibility': 'public'}, cls.b)
        cls.b_project = project['project']['id']
        _, post, _ = cls.call('POST', '/posts', {'body': '甲公开帖子', 'kind': 'update'}, cls.a)
        cls.a_post = post['post']['id']

    @classmethod
    def start(cls):
        log = Path(cls.temp.name) / 'test-server.log'
        with log.open('ab') as output:
            cls.proc = subprocess.Popen([sys.executable, str(Path(__file__).with_name('server.py')), '--port', str(cls.port)],
                                        env=cls.env, stdout=output, stderr=output)
        for _ in range(150):
            try:
                if cls.call('GET', '/status')[0] == 200:
                    return
            except OSError:
                time.sleep(.05)
            if cls.proc.poll() is not None:
                break
        raise RuntimeError('isolated chat server failed to start: ' + log.read_text(errors='replace')[-2000:])

    @classmethod
    def restart(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=10)
        cls.start()

    @classmethod
    def cleanup(cls):
        if cls.proc is not None:
            cls.proc.terminate()
            cls.proc.wait(timeout=10)
        cls.temp.cleanup()

    @classmethod
    def call(cls, method, path, data=None, cookie=None, extra=None):
        conn = http.client.HTTPConnection('127.0.0.1', cls.port, timeout=15)
        headers = {'X-Archive-Client': '1', 'Content-Type': 'application/json'}
        if cookie:
            headers['Cookie'] = cookie
        if extra:
            headers.update(extra)
        conn.request(method, '/api' + path, body=json.dumps(data).encode() if data is not None else None, headers=headers)
        response = conn.getresponse()
        result = (response.status, json.loads(response.read()), dict(response.getheaders()))
        conn.close()
        return result

    @classmethod
    def approve(cls):
        with closing(sqlite3.connect(cls.db_path)) as db:
            db.execute("UPDATE projects SET review='approved' WHERE id=?", (cls.b_project,))
            db.execute("UPDATE posts SET review='approved' WHERE id=?", (cls.a_post,))
            db.commit()

    def test_01_contacts_and_account_enumeration(self):
        self.assertEqual(self.call('GET', '/chats')[0], 401)
        self.assertEqual(self.call('GET', '/chats/contacts')[0], 401)
        self.assertEqual(self.call('GET', '/chats/contacts', cookie=self.a)[1]['users'], [])
        for recipient in [self.b_id, self.c_id, 'd' * 32, 'bad-id', {'id': self.b_id}]:
            self.assertEqual(self.call('POST', '/chats', {'recipientId': recipient, 'body': '想交流'}, self.a)[0], 404)
        self.assertEqual(self.call('POST', '/chats', {'recipientId': self.a_id, 'body': '自己'}, self.a)[0], 400)
        self.approve()
        status, data, headers = self.call('GET', '/chats/contacts', cookie=self.a)
        self.assertEqual(status, 200)
        self.assertEqual(data['users'], [{'id': self.b_id, 'name': '乙公开昵称'}])
        self.assertEqual(headers['Cache-Control'], 'no-store')
        self.assertEqual(self.call('GET', '/chats/contacts?q=chat_test_b', cookie=self.a)[1]['users'], [])
        self.assertEqual(self.call('GET', '/chats/contacts?q=' + 'x' * 61, cookie=self.a)[0], 400)
        # The second creator has an approved post but no approved project.
        self.assertIn(self.a_id, [x['id'] for x in self.call('GET', '/chats/contacts', cookie=self.b)[1]['users']])
        public = self.call('GET', '/public/' + self.a_id)[1]
        self.assertEqual(public['profile'], {'id': self.a_id, 'name': '甲公开昵称'})
        self.assertEqual(public['projects'], [])
        self.assertEqual([x['id'] for x in public['posts']], [self.a_post])

    def test_02_invitation_consent_and_retry(self):
        payload = {'recipientId': self.b_id, 'body': '私聊邀请标记-只在两人对话中保存'}
        status, data, headers = self.call('POST', '/chats', payload, self.a)
        self.assertEqual(status, 201)
        self.assertEqual(headers['Cache-Control'], 'no-store')
        type(self).chat_id = data['chat']['id']
        path = '/chats/' + self.chat_id
        self.assertEqual(data['chat']['state'], 'pending')
        self.assertFalse(data['chat']['incoming'])
        self.assertEqual(len(data['messages']), 1)
        self.assertEqual(self.call('POST', '/chats', payload, self.a)[1]['chat']['id'], self.chat_id)
        self.assertEqual(len(self.call('GET', path, cookie=self.a)[1]['messages']), 1)
        for cookie in (self.a, self.b):
            self.assertEqual(self.call('POST', path + '/messages', {'body': '禁止追加'}, cookie)[0], 409)
        self.assertEqual(self.call('POST', path + '/accept', {}, self.a)[0], 403)
        incoming = self.call('GET', '/chats', cookie=self.b)[1]
        self.assertEqual(incoming['unreadTotal'], 1)
        self.assertTrue(incoming['chats'][0]['incoming'])
        self.call('GET', path, cookie=self.b)
        self.assertEqual(self.call('GET', '/chats', cookie=self.b)[1]['unreadTotal'], 1)
        status, accepted, _ = self.call('POST', path + '/accept', {}, self.b)
        self.assertEqual(status, 200)
        self.assertEqual(accepted['chat']['state'], 'accepted')
        self.assertEqual(accepted['chat']['unread'], 0)

    def test_03_real_messages_unread_and_length(self):
        path = '/chats/' + self.chat_id
        literal = '<img src=x onerror=alert(1)> 私聊内容标记'
        for body in ['', '  ', '\x00', 'x' * 2001, 123]:
            self.assertEqual(self.call('POST', path + '/messages', {'body': body}, self.b)[0], 400)
        status, message, _ = self.call('POST', path + '/messages', {'body': literal}, self.b)
        self.assertEqual(status, 201)
        self.assertEqual(message['message']['body'], literal)
        self.assertEqual(message['message']['senderId'], self.b_id)
        status, detail, headers = self.call('GET', path, cookie=self.a)
        self.assertEqual(status, 200)
        self.assertEqual(headers['Cache-Control'], 'no-store')
        self.assertEqual(detail['messages'][-1]['body'], literal)
        self.assertEqual(detail['chat']['unread'], 1)
        self.assertEqual(self.call('POST', path + '/read', {}, self.a)[1]['chat']['unread'], 0)
        self.assertEqual(self.call('GET', '/chats', cookie=self.a)[1]['unreadTotal'], 0)
        self.assertEqual(self.call('POST', path + '/messages', {'body': 'x' * 2000}, self.a)[0], 201)
        for query in ['?before=0', '?before=-1', '?before=1&before=2', '?before=nan']:
            self.assertEqual(self.call('GET', path + query, cookie=self.a)[0], 400)

    def test_04_ownership_origin_and_private_public_boundary(self):
        path = '/chats/' + self.chat_id
        self.assertEqual(self.call('GET', path, cookie=self.c)[0], 404)
        self.assertEqual(self.call('GET', path)[0], 401)
        for action, body in [('messages', {'body': '越权'}), ('read', {}), ('accept', {}), ('block', {'blocked': True})]:
            self.assertEqual(self.call('POST', path + '/' + action, body, self.c)[0], 404)
            self.assertEqual(self.call('POST', path + '/' + action, body)[0], 401)
            self.assertEqual(self.call('POST', path + '/' + action, body, self.a, {'Origin': 'https://evil.invalid'})[0], 403)
            self.assertEqual(self.call('POST', path + '/' + action, body, self.a, {'X-Archive-Client': ''})[0], 403)
        self.assertEqual(self.call('OPTIONS', path)[0], 403)
        self.assertEqual(self.call('POST', path + '/messages', {'body': '正常同源'}, self.a,
            {'Origin': 'http://127.0.0.1:' + str(self.port)})[0], 201)
        for public in ['/feed', '/public/' + self.b_id, '/public/projects/' + self.b_project]:
            data = json.dumps(self.call('GET', public)[1], ensure_ascii=False)
            for secret in ['私聊邀请标记', '私聊内容标记', '私人简介秘密', '私人技能秘密', 'chat_test_b']:
                self.assertNotIn(secret, data)
        self.assertEqual(self.call('GET', '/chats', cookie=self.c)[1]['chats'], [])

    def test_05_blocking_and_restart_durability(self):
        path = '/chats/' + self.chat_id
        self.assertEqual(self.call('POST', path + '/block', {'blocked': 'true'}, self.a)[0], 400)
        self.assertTrue(self.call('POST', path + '/block', {'blocked': True}, self.b)[1]['chat']['blockedByMe'])
        self.assertTrue(self.call('GET', path, cookie=self.a)[1]['chat']['blockedByPeer'])
        previous = self.call('GET', path, cookie=self.a)[1]['messages']
        self.restart()
        self.assertEqual(self.call('GET', path, cookie=self.a)[1]['messages'], previous)
        self.assertEqual(self.call('GET', path, cookie=self.a)[1]['chat']['state'], 'accepted')
        for cookie in (self.a, self.b):
            self.assertEqual(self.call('POST', path + '/messages', {'body': '屏蔽后禁止'}, cookie)[0], 403)
        self.assertEqual(self.call('POST', path + '/block', {'blocked': False}, self.a)[0], 200)
        self.assertEqual(self.call('POST', path + '/messages', {'body': '不能替对方解屏蔽'}, self.a)[0], 403)
        self.assertEqual(self.call('POST', path + '/block', {'blocked': False}, self.b)[0], 200)
        self.assertEqual(self.call('POST', path + '/messages', {'body': '解屏蔽后恢复发送'}, self.a)[0], 201)
        _, invitation, _ = self.call('POST', '/chats', {'recipientId': self.a_id, 'body': '丙给甲的独立邀请'}, self.c)
        type(self).other_chat_id = invitation['chat']['id']
        other_path = '/chats/' + self.other_chat_id
        self.call('POST', other_path + '/block', {'blocked': True}, self.a)
        self.assertEqual(self.call('POST', other_path + '/accept', {}, self.a)[0], 403)
        self.call('POST', other_path + '/block', {'blocked': False}, self.a)
        self.assertEqual(self.call('POST', other_path + '/accept', {}, self.a)[0], 200)

    def test_06_pagination_and_private_export(self):
        # Preload additional old records only to test pagination without sending spam.
        with closing(sqlite3.connect(self.db_path)) as db:
            seq = db.execute('SELECT MAX(seq) FROM chat_messages WHERE chat_id=?', (self.chat_id,)).fetchone()[0]
            for index in range(75):
                db.execute('INSERT INTO chat_messages VALUES(?,?,?,?,?,?)',
                    ('%032x' % (index + 100), self.chat_id, seq + index + 1, self.a_id, '分页旧消息' + str(index), 1))
            db.commit()
        path = '/chats/' + self.chat_id
        recent = self.call('GET', path, cookie=self.b)[1]
        self.assertEqual(len(recent['messages']), 60)
        self.assertIsNotNone(recent['olderCursor'])
        earlier = self.call('GET', path + '?before=' + str(recent['olderCursor']), cookie=self.b)[1]
        combined = earlier['messages'] + recent['messages']
        self.assertEqual([x['seq'] for x in combined], sorted(x['seq'] for x in combined))
        self.assertEqual(len(combined), len({x['seq'] for x in combined}))
        self.assertEqual(combined[0]['seq'], 1)
        self.assertIsNone(earlier['olderCursor'])
        a = self.call('GET', '/export', cookie=self.a)[1]
        b = self.call('GET', '/export', cookie=self.b)[1]
        c = self.call('GET', '/export', cookie=self.c)[1]
        self.assertEqual({x['id'] for x in a['chats']}, {self.chat_id, self.other_chat_id})
        self.assertEqual([x['id'] for x in b['chats']], [self.chat_id])
        self.assertEqual([x['id'] for x in c['chats']], [self.other_chat_id])
        for export in (a, b, c):
            text = json.dumps(export, ensure_ascii=False)
            self.assertNotIn('chat_test_', text)
            self.assertNotIn('password', text)
            self.assertNotIn('ai_youth_session', text)
        self.assertNotIn('丙给甲的独立邀请', json.dumps(b, ensure_ascii=False))
        self.assertNotIn('私聊邀请标记', json.dumps(c, ensure_ascii=False))

    def test_07_persistent_message_and_invitation_limits(self):
        path = '/chats/' + self.chat_id
        # A recent persisted count is enforced even after restart and source IP change.
        with closing(sqlite3.connect(self.db_path)) as db:
            seq = db.execute('SELECT MAX(seq) FROM chat_messages WHERE chat_id=?', (self.chat_id,)).fetchone()[0]
            for index in range(30):
                db.execute('INSERT INTO chat_messages VALUES(?,?,?,?,?,?)',
                    ('%032x' % (index + 1000), self.chat_id, seq + index + 1, self.b_id, '限流样本', int(time.time())))
            db.commit()
        self.restart()
        self.assertEqual(self.call('POST', path + '/messages', {'body': '越过限流'}, self.b,
            {'X-Real-IP': '192.0.2.222'})[0], 429)
        # Seed prior sent invitations; their targets are not surfaced as fake users.
        with closing(sqlite3.connect(self.db_path)) as db:
            profile = json.dumps({'name': '限流测试联系人'})
            for index in range(5):
                member = '%032x' % (index + 3000)
                chat_id = '%032x' % (index + 4000)
                pair = sorted((self.b_id, member))
                db.execute('INSERT INTO users VALUES(?,?,?,?,?,?)', (member, 'limit_fixture_' + str(index), 'invalid', profile, 'creator', 1))
                db.execute('INSERT INTO chats VALUES(?,?,?,?,?,?,?)', (chat_id, pair[0], pair[1], self.b_id, 'pending', int(time.time()), 1))
                for user_id in pair:
                    db.execute('INSERT INTO chat_members(chat_id,user_id) VALUES(?,?)', (chat_id, user_id))
            # C is independently approved only so invitation throttling is exercised.
            db.execute('INSERT INTO posts VALUES(?,?,?,?,?,?,?)', ('a' * 32, self.c_id, '限流测试公开帖', 'update', None, 'approved', 1))
            db.commit()
        self.restart()
        self.assertEqual(self.call('POST', '/chats', {'recipientId': self.c_id, 'body': '禁止继续邀请'}, self.b,
            {'X-Real-IP': '192.0.2.223'})[0], 429)
        self.assertEqual(self.call('GET', '/chats/' + self.chat_id, cookie=self.c)[0], 404)

    def test_08_old_install_and_existing_features(self):
        with closing(sqlite3.connect(self.db_path)) as db:
            self.assertEqual(db.execute("SELECT body FROM projects WHERE id=?", ('f' * 32,)).fetchone()[0],
                             json.dumps({'title': '原有私人作品'}))
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])
        self.assertEqual(self.call('GET', '/status')[1]['auth']['sms'], False)
        self.assertEqual(self.call('GET', '/me', cookie=self.a)[1]['user']['id'], self.a_id)
        _, project, _ = self.call('POST', '/projects', {'title': '私聊加入后原作品功能', 'notes': '仍然私密'}, self.a)
        project_id = project['project']['id']
        self.assertEqual(self.call('GET', '/projects/' + project_id, cookie=self.b)[0], 404)
        self.assertEqual(self.call('PUT', '/projects/' + project_id, {'title': '修改后仍可保存'}, self.a)[0], 200)
        self.assertEqual(self.call('GET', '/projects/' + project_id + '/history', cookie=self.a)[1]['versions'][0]['title'],
                         '私聊加入后原作品功能')


if __name__ == '__main__':
    unittest.main(verbosity=2)
