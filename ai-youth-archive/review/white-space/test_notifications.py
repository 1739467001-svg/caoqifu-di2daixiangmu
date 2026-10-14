"""Notifications checks against an isolated HTTP service, never the preview DB."""
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

APP = Path(__file__).resolve().parents[2]
BACKEND = APP / 'backend'


class ActivityNotifications(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='activity-test-', dir=Path(__file__).parent)
        cls.db_path = Path(cls.temp.name) / 'archive.sqlite3'
        cls.env = dict(os.environ, ARCHIVE_DATA_DIR=cls.temp.name, ARCHIVE_SECURE_COOKIE='0',
                       ARCHIVE_COOKIE_PATH='/', PYTHONIOENCODING='utf-8')
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            cls.port = sock.getsockname()[1]
        cls.start()
        for key in ('a', 'b', 'c'):
            status, data, headers = cls.call('POST', '/auth/register',
                {'username': 'activity_' + key, 'password': 'synthetic-password-' + key, 'name': '公开昵称' + key})
            assert status == 201, data
            setattr(cls, key, headers['Set-Cookie'].split(';')[0])
            setattr(cls, key + '_id', data['user']['id'])
        cls.call('PUT', '/profile', {'name': '公开昵称b', 'bio': '不得输出私人简介',
                                    'skills': '不得输出私人技能'}, cls.b)

    @classmethod
    def start(cls):
        cls.proc = subprocess.Popen([sys.executable, str(BACKEND / 'server.py'), '--port', str(cls.port)],
                                    env=cls.env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        for _ in range(150):
            if cls.proc.poll() is not None:
                detail = cls.proc.stderr.read().decode('utf-8', errors='replace')
                cls.proc.stderr.close()
                raise RuntimeError(detail)
            try:
                if cls.call('GET', '/status')[0] == 200:
                    return
            except OSError:
                time.sleep(.04)
        cls.proc.terminate()
        cls.proc.wait(timeout=10)
        detail = cls.proc.stderr.read().decode('utf-8', errors='replace')
        cls.proc.stderr.close()
        raise RuntimeError('isolated notifications service failed to start: ' + detail)

    @classmethod
    def restart(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=10)
        cls.proc.stderr.close()
        cls.start()

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=10)
        cls.proc.stderr.close()
        # Only the known disposable directory under this test's folder is removed.
        assert Path(cls.temp.name).resolve().parent == Path(__file__).resolve().parent
        cls.temp.cleanup()

    @classmethod
    def call(cls, method, path, data=None, cookie=None, extra=None):
        conn = http.client.HTTPConnection('127.0.0.1', cls.port, timeout=15)
        headers = {'X-Archive-Client': '1', 'Content-Type': 'application/json'}
        if cookie:
            headers['Cookie'] = cookie
        headers.update(extra or {})
        conn.request(method, '/api' + path, body=json.dumps(data).encode() if data is not None else None, headers=headers)
        response = conn.getresponse()
        result = (response.status, json.loads(response.read()), dict(response.getheaders()))
        conn.close()
        return result

    @classmethod
    def review(cls, kind, item_id, decision='approve'):
        result = subprocess.run([sys.executable, str(BACKEND / 'manage.py'), 'review', kind, item_id, decision],
                                env=cls.env, capture_output=True, text=True, encoding='utf-8', timeout=15)
        if result.returncode:
            raise AssertionError(result.stderr)

    def post(self, cookie=None, body='公开帖子标题\n正文内容'):
        status, result, _ = self.call('POST', '/posts', {'body': body}, cookie or self.a)
        self.assertEqual(status, 201, result)
        item_id = result['post']['id']
        self.review('post', item_id)
        return item_id

    def items(self, cookie=None, post_id=None):
        status, result, headers = self.call('GET', '/notifications', cookie=cookie or self.a)
        self.assertEqual(status, 200, result)
        self.assertEqual(headers['Cache-Control'], 'no-store')
        return [x for x in result['notifications'] if not post_id or x['targetId'] == post_id]

    def like(self, post_id, cookie=None, active=True, kind='like'):
        status, result, _ = self.call('POST', '/posts/' + post_id + '/' + kind, {'active': active}, cookie or self.b)
        self.assertEqual(status, 200, result)

    def comment(self, post_id, cookie=None, body='已审核才允许输出的回复'):
        status, result, _ = self.call('POST', '/comments', {'postId': post_id, 'body': body}, cookie or self.b)
        self.assertEqual(status, 201, result)
        return result['comment']['id']

    def test_01_permissions_no_private_chat_and_no_auto_read(self):
        self.assertEqual(self.call('GET', '/notifications')[0], 401)
        self.assertEqual(self.call('POST', '/notifications/read', {'all': True})[0], 401)
        post_id = self.post()
        self.like(post_id)
        item = self.items(post_id=post_id)[0]
        self.assertEqual(item['actor'], {'id': self.b_id, 'name': '公开昵称b'})
        self.assertEqual(item['kind'], 'like')
        self.assertEqual(item['targetKind'], 'post')
        self.assertFalse(item['read'])
        self.assertFalse(self.items(post_id=post_id)[0]['read'])
        self.assertEqual(self.items(self.b, post_id), [])
        self.assertEqual(self.items(self.c, post_id), [])
        payload = json.dumps(item, ensure_ascii=False)
        for secret in ('activity_b', '不得输出私人简介', '不得输出私人技能'):
            self.assertNotIn(secret, payload)
        self.assertNotIn('body', item)
        # Private chat invitations stay in the chat API, without notice content.
        self.post(self.b, '提供公开联系入口')
        before = self.items(self.b)
        status, _, _ = self.call('POST', '/chats', {'recipientId': self.b_id, 'body': '私聊秘密正文'}, self.a)
        self.assertEqual(status, 201)
        self.assertEqual(self.items(self.b), before)
        self.assertNotIn('私聊秘密正文', json.dumps(self.items(), ensure_ascii=False))

    def test_02_like_dedup_self_bookmarks_withdrawal_and_restart(self):
        post_id = self.post()
        self.like(post_id, self.a)
        self.like(post_id, kind='bookmark')
        self.assertEqual(self.items(post_id=post_id), [])
        self.like(post_id)
        self.like(post_id)
        item = self.items(post_id=post_id)[0]
        self.assertEqual(len(self.items(post_id=post_id)), 1)
        status, result, _ = self.call('POST', '/notifications/read', {'ids': [item['id']]}, self.a)
        self.assertEqual(status, 200, result)
        self.like(post_id, active=False)
        self.assertEqual(self.items(post_id=post_id), [])
        self.like(post_id)
        restored = self.items(post_id=post_id)[0]
        self.assertEqual(restored['id'], item['id'])
        self.assertTrue(restored['read'])
        self.restart()
        self.assertEqual(self.items(post_id=post_id), [restored])
        self.review('post', post_id, 'reject')
        self.assertEqual(self.items(post_id=post_id), [])
        self.review('post', post_id)
        self.assertEqual(self.items(post_id=post_id), [restored])
        self.call('DELETE', '/posts/' + post_id, cookie=self.a)
        self.assertEqual(self.items(post_id=post_id), [])
        with closing(sqlite3.connect(self.db_path)) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM activity_notifications WHERE post_id=?', (post_id,)).fetchone()[0], 0)

    def test_03_reply_only_after_approval_and_hidden_deleted_content(self):
        post_id = self.post()
        own = self.comment(post_id, self.a)
        self.review('comment', own)
        self.assertEqual(self.items(post_id=post_id), [])
        literal = '<img src=x onerror=alert(1)> 尚待批准的回复'
        reply_id = self.comment(post_id, body=literal)
        self.assertEqual(self.items(post_id=post_id), [])
        self.review('comment', reply_id, 'reject')
        self.assertEqual(self.items(post_id=post_id), [])
        self.review('comment', reply_id)
        item = self.items(post_id=post_id)[0]
        self.assertEqual(item['kind'], 'reply')
        self.assertEqual(item['commentId'], reply_id)
        self.assertEqual(item['body'], literal)
        self.call('POST', '/notifications/read', {'ids': [item['id']]}, self.a)
        self.review('comment', reply_id, 'reject')
        self.assertEqual(self.items(post_id=post_id), [])
        self.review('comment', reply_id)
        self.assertTrue(self.items(post_id=post_id)[0]['read'])
        self.assertEqual(len(self.items(post_id=post_id)), 1)
        self.call('DELETE', '/comments/' + reply_id, cookie=self.b)
        self.assertEqual(self.items(post_id=post_id), [])
        with closing(sqlite3.connect(self.db_path)) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM activity_notifications WHERE comment_id=?', (reply_id,)).fetchone()[0], 0)

    def test_04_read_owner_all_validation_and_csrf(self):
        post_id = self.post()
        self.like(post_id)
        item = self.items(post_id=post_id)[0]
        self.call('POST', '/notifications/read', {'ids': [item['id']]}, self.c)
        self.assertFalse(self.items(post_id=post_id)[0]['read'])
        for bad in ({}, {'all': False}, {'all': 1}, {'ids': []}, {'ids': 'x'}, {'ids': ['bad']},
                    {'ids': [None]}, {'ids': ['f' * 32] * 201}, {'all': True, 'ids': [item['id']]}):
            self.assertEqual(self.call('POST', '/notifications/read', bad, self.a)[0], 400, bad)
        for extra in ({'X-Archive-Client': ''}, {'Origin': 'https://evil.invalid'}):
            self.assertEqual(self.call('POST', '/notifications/read', {'all': True}, self.a, extra)[0], 403)
        status, result, _ = self.call('POST', '/notifications/read', {'all': True}, self.a)
        self.assertEqual(status, 200)
        self.assertEqual(result['unreadTotal'], 0)
        self.assertTrue(self.items(post_id=post_id)[0]['read'])
        self.assertEqual(self.call('GET', '/notifications', cookie=self.a)[1]['unreadTotal'], 0)

    def test_99_upgrade_does_not_replay_historical_actions(self):
        post_id = self.post()
        self.like(post_id)
        reply_id = self.comment(post_id)
        self.review('comment', reply_id)
        self.proc.terminate()
        self.proc.wait(timeout=10)
        self.proc.stderr.close()
        with closing(sqlite3.connect(self.db_path)) as db:
            db.execute('DROP TRIGGER activity_post_like')
            db.execute('DROP TRIGGER activity_reply_review')
            db.execute('DROP TABLE activity_notifications')
            db.commit()
        self.start()
        self.assertEqual(self.items(), [])
        self.assertEqual(self.call('GET', '/notifications', cookie=self.a)[1]['unreadTotal'], 0)
        self.like(post_id)  # Existing like is not a new activity.
        self.review('comment', reply_id)  # Re-approving already approved reply is not new.
        self.assertEqual(self.items(), [])
        self.like(post_id, self.c)
        self.assertEqual(len(self.items(post_id=post_id)), 1)
        public = next(x for x in self.call('GET', '/feed')[1]['posts'] if x['id'] == post_id)
        self.assertEqual(public['likes'], 2)
        self.assertEqual(public['comments'], 1)


if __name__ == '__main__':
    unittest.main(verbosity=2)
