"""Actual HTTP/SQLite checks for moderated replies, using a disposable service."""
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


class CommentsIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Keep SQLite's WAL files inside the writable checkout, not the Windows
        # sandbox's virtual temp directory (child processes cannot reopen it).
        cls.temp = tempfile.TemporaryDirectory(prefix='archive-comments-test-', dir=Path(__file__).resolve().parent)
        cls.db_path = Path(cls.temp.name) / 'archive.sqlite3'
        cls.env = dict(os.environ, ARCHIVE_DATA_DIR=cls.temp.name, ARCHIVE_SECURE_COOKIE='0', ARCHIVE_COOKIE_PATH='/',
                       PYTHONIOENCODING='utf-8')
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            cls.port = sock.getsockname()[1]
        cls.start()
        for key, name in [('a', '甲公开昵称'), ('b', '乙公开昵称'), ('c', '丙公开昵称')]:
            status, data, headers = cls.call('POST', '/auth/register',
                {'username': 'comments_test_' + key, 'password': 'test-comments-password-' + key, 'name': name})
            assert status == 201, data
            setattr(cls, key, headers['Set-Cookie'].split(';')[0])
            setattr(cls, key + '_id', data['user']['id'])
        cls.call('PUT', '/profile', {'name': '乙公开昵称', 'bio': '私人简介-不得公开',
                                      'skills': '私人技能-不得公开'}, cls.b)
        _, project, _ = cls.call('POST', '/projects', {'title': '私人项目-不得公开'}, cls.a)
        cls.private_project = project['project']['id']
        _, pending, _ = cls.call('POST', '/posts', {'body': '待审帖子-不得公开'}, cls.a)
        cls.pending_post = pending['post']['id']
        _, approved, _ = cls.call('POST', '/posts', {'body': '公开交流帖', 'projectId': cls.private_project}, cls.a)
        cls.post_id = approved['post']['id']
        operator = cls.manage('review', 'post', cls.post_id, 'approve')
        assert operator.returncode == 0, operator.stderr

    @classmethod
    def start(cls):
        cls.proc = subprocess.Popen([sys.executable, str(Path(__file__).with_name('server.py')), '--port', str(cls.port)],
                                    env=cls.env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        for _ in range(150):
            if cls.proc.poll() is not None:
                detail = cls.proc.stderr.read().decode('utf-8', errors='replace')
                cls.proc.stderr.close()
                raise RuntimeError('isolated comments server failed: ' + detail)
            try:
                if cls.call('GET', '/status')[0] == 200:
                    return
            except OSError:
                time.sleep(.05)
        cls.proc.terminate()
        cls.proc.wait(timeout=10)
        detail = cls.proc.stderr.read().decode('utf-8', errors='replace')
        cls.proc.stderr.close()
        raise RuntimeError('isolated comments server failed to start: ' + detail)

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
    def manage(cls, *args):
        return subprocess.run([sys.executable, str(Path(__file__).with_name('manage.py')), *args],
                              env=cls.env, capture_output=True, text=True, encoding='utf-8', timeout=15)

    def create(self, body='回复内容', cookie=None, post_id=None):
        status, data, _ = self.call('POST', '/comments', {'postId': post_id or self.post_id, 'body': body}, cookie or self.b)
        self.assertEqual(status, 201, data)
        return data['comment']

    def replies(self, cookie=None, post_id=None):
        status, data, headers = self.call('GET', '/comments?postId=' + (post_id or self.post_id), cookie=cookie)
        self.assertEqual(status, 200, data)
        self.assertEqual(headers['Cache-Control'], 'no-store')
        return data

    def test_01_post_visibility_and_login(self):
        self.assertEqual(self.call('GET', '/comments/mine')[0], 401)
        self.assertEqual(self.call('POST', '/comments', {'postId': self.post_id, 'body': '未登录'})[0], 401)
        for cookie in (None, self.a, self.b):
            for post in (self.pending_post, 'f' * 32, 'bad-id'):
                self.assertEqual(self.call('GET', '/comments?postId=' + post, cookie=cookie)[0], 404)
        for post in (self.pending_post, 'f' * 32, None, {'id': self.post_id}):
            self.assertEqual(self.call('POST', '/comments', {'postId': post, 'body': '不能回复'}, self.b)[0], 404)
        for query in ('', '?postId=', '?postId=' + self.post_id + '&postId=' + self.post_id):
            self.assertIn(self.call('GET', '/comments' + query)[0], (400, 404))
        self.assertEqual(self.replies()['comments'], [])
        self.assertIsNone(self.replies()['post']['projectId'])

    def test_02_pending_replies_are_owner_only(self):
        literal = '<img src=x onerror=alert(1)> 文字回复'
        comment = self.create(literal)
        type(self).comment_id = comment['id']
        self.assertEqual(comment['body'], literal)
        self.assertEqual(comment['review'], 'pending')
        self.assertEqual(comment['author'], {'id': self.b_id, 'name': '乙公开昵称'})
        self.assertEqual(self.replies(self.b)['comments'], [comment])
        for cookie in (None, self.a, self.c):
            self.assertEqual(self.replies(cookie)['comments'], [])
        self.assertEqual(self.call('GET', '/comments/mine', cookie=self.b)[1]['comments'], [comment])
        self.assertEqual(self.call('GET', '/comments/mine', cookie=self.a)[1]['comments'], [])
        payload = json.dumps(self.replies(self.b), ensure_ascii=False)
        for secret in ('comments_test_b', '私人简介-不得公开', '私人技能-不得公开', '私人项目-不得公开'):
            self.assertNotIn(secret, payload)

    def test_03_actual_operator_review(self):
        queue = self.manage('pending')
        self.assertEqual(queue.returncode, 0, queue.stderr)
        self.assertIn(self.comment_id, [x['id'] for x in json.loads(queue.stdout)['comments']])
        self.assertEqual(self.manage('review', 'comment', self.comment_id, 'approve').returncode, 0)
        self.assertEqual(self.replies()['comments'][0]['review'], 'approved')
        rejected = self.create('被拒绝回复')
        self.assertEqual(self.manage('review', 'comment', rejected['id'], 'reject').returncode, 0)
        mine = self.replies(self.b)['comments']
        self.assertEqual(next(x for x in mine if x['id'] == rejected['id'])['review'], 'rejected')
        for cookie in (None, self.a, self.c):
            self.assertNotIn(rejected['id'], [x['id'] for x in self.replies(cookie)['comments']])

    def test_04_validation_and_origin(self):
        for body in ('', '  ', '\x00', '\x01', 'x' * 1001, 12, None):
            self.assertEqual(self.call('POST', '/comments', {'postId': self.post_id, 'body': body}, self.b)[0], 400)
        self.assertEqual(self.create('x' * 1000)['body'], 'x' * 1000)
        data = {'postId': self.post_id, 'body': '来源校验'}
        for extra in ({'Origin': 'https://evil.invalid'}, {'X-Archive-Client': ''}):
            self.assertEqual(self.call('POST', '/comments', data, self.b, extra)[0], 403)
        self.assertEqual(self.call('POST', '/comments', data, self.b,
            {'Origin': 'http://127.0.0.1:' + str(self.port)})[0], 201)
        self.assertEqual(self.call('OPTIONS', '/comments')[0], 403)
        self.assertEqual(self.call('PUT', '/comments', data, self.b)[0], 404)

    def test_05_delete_is_owner_only_and_parent_cascades(self):
        comment = self.create('可删除回复')
        path = '/comments/' + comment['id']
        self.assertEqual(self.call('DELETE', path)[0], 401)
        for cookie in (self.a, self.c):
            self.assertEqual(self.call('DELETE', path, cookie=cookie)[0], 404)
        self.assertEqual(self.call('DELETE', path, cookie=self.b, extra={'Origin': 'https://evil.invalid'})[0], 403)
        self.assertEqual(self.call('DELETE', path, cookie=self.b)[0], 200)
        self.assertEqual(self.call('DELETE', path, cookie=self.b)[0], 404)
        _, post, _ = self.call('POST', '/posts', {'body': '稍后删除的帖子'}, self.a)
        post_id = post['post']['id']
        self.manage('review', 'post', post_id, 'approve')
        child = self.create('跟随帖子删除', post_id=post_id)
        self.assertEqual(self.call('DELETE', '/posts/' + post_id, cookie=self.a)[0], 200)
        with closing(sqlite3.connect(self.db_path)) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM comments WHERE id=?', (child['id'],)).fetchone()[0], 0)

    def test_06_hidden_parent_blocks_public_and_approval(self):
        self.assertEqual(self.manage('review', 'post', self.post_id, 'reject').returncode, 0)
        for cookie in (None, self.a, self.b):
            self.assertEqual(self.call('GET', '/comments?postId=' + self.post_id, cookie=cookie)[0], 404)
        self.assertNotEqual(self.manage('review', 'comment', self.comment_id, 'approve').returncode, 0)
        self.assertIn(self.comment_id, [x['id'] for x in self.call('GET', '/comments/mine', cookie=self.b)[1]['comments']])
        self.assertEqual(self.manage('review', 'post', self.post_id, 'approve').returncode, 0)

    def test_07_restart_durability_and_bounded_list(self):
        before = self.replies(self.b)
        self.restart()
        self.assertEqual(self.replies(self.b), before)
        with closing(sqlite3.connect(self.db_path)) as db:
            for index in range(110):
                db.execute('INSERT INTO comments VALUES(?,?,?,?,?,?)',
                    ('%032x' % (index + 100), self.post_id, self.a_id, '历史回复' + str(index), 'approved', 1))
            db.commit()
        public = self.replies()['comments']
        self.assertEqual(len(public), 100)
        self.assertEqual(len({x['id'] for x in public}), 100)
        self.assertEqual([x['createdAt'] for x in public], sorted(x['createdAt'] for x in public))
        for payload in (self.call('GET', '/feed')[1], self.call('GET', '/public/' + self.a_id)[1]):
            text = json.dumps(payload, ensure_ascii=False)
            self.assertNotIn('被拒绝回复', text)
            self.assertNotIn('待审帖子-不得公开', text)

    def test_08_account_specific_rate_limit(self):
        # A fresh account's requests do not consume the reply author's allowance.
        for index in range(30):
            self.create('频率测试' + str(index), cookie=self.c)
        self.assertEqual(self.call('POST', '/comments', {'postId': self.post_id, 'body': '第31条'}, self.c)[0], 429)
        self.assertEqual(self.call('POST', '/comments', {'postId': self.post_id, 'body': '另一账号'}, self.a)[0], 201)


if __name__ == '__main__':
    unittest.main(verbosity=2)
