"""Integration tests: actual HTTP, actual SQLite, temporary private files."""
import base64
import http.client
import json
import os
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import closing
from pathlib import Path


class ArchiveIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='archive-api-test-')
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            cls.port = sock.getsockname()[1]
        env = dict(os.environ, ARCHIVE_DATA_DIR=cls.temp.name, ARCHIVE_SECURE_COOKIE='0', ARCHIVE_COOKIE_PATH='/')
        cls.env = env
        cls.proc = subprocess.Popen([sys.executable, str(Path(__file__).with_name('server.py')), '--port', str(cls.port)],
                                    env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            try:
                if cls.call('GET', '/status')[0] == 200:
                    break
            except OSError:
                time.sleep(.05)
        else:
            raise RuntimeError('test API failed to start')
        _, result, headers = cls.call('POST', '/auth/register', {'username': 'creator_one', 'password': 'test-password-a', 'name': '甲'})
        cls.a_id = result['user']['id']
        cls.a = headers['Set-Cookie'].split(';')[0]
        _, _, headers = cls.call('POST', '/auth/register', {'username': 'creator_two', 'password': 'test-password-b', 'name': '乙', 'role': 'organizer'})
        cls.b = headers['Set-Cookie'].split(';')[0]

    @classmethod
    def tearDownClass(cls):
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
        body = json.dumps(data).encode() if data is not None else None
        conn.request(method, '/api' + path, body=body, headers=headers)
        response = conn.getresponse()
        raw = response.read()
        result_headers = dict(response.getheaders())
        content = json.loads(raw) if 'application/json' in result_headers.get('Content-Type', '') else raw
        status = response.status
        conn.close()
        return status, content, result_headers

    def create(self, visibility='private'):
        status, body, _ = self.call('POST', '/projects', {'title': '真实项目', 'summary': '<img src=x onerror=alert(1)>',
            'notes': '私人记录', 'event': '未认证自述', 'visibility': visibility}, self.a)
        self.assertEqual(status, 201)
        return body['project']

    def test_01_login_security(self):
        status, me, _ = self.call('GET', '/me', cookie=self.b)
        self.assertEqual(status, 200)
        self.assertEqual(me['user']['role'], 'creator')
        self.assertEqual(self.call('POST', '/auth/login', {'username': 'creator_one', 'password': 'bad-password'})[0], 401)
        self.assertEqual(self.call('POST', '/auth/login', {'username': 'creator_one', 'password': 'test-password-a'})[0], 200)
        self.assertEqual(self.call('POST', '/auth/sms', {'phone': 'not-real'})[0], 503)
        status, _, headers = self.call('POST', '/auth/login', {'username': 'creator_two', 'password': 'test-password-b'})
        self.assertIn('HttpOnly', headers['Set-Cookie'])
        self.assertIn('SameSite=Lax', headers['Set-Cookie'])
        with closing(sqlite3.connect(Path(self.temp.name) / 'archive.sqlite3')) as db:
            hashed = db.execute('SELECT password FROM users WHERE username=?', ('creator_one',)).fetchone()[0]
        self.assertNotIn('test-password-a', hashed)
        self.assertEqual(len(hashed), 97)

    def test_02_unauthenticated_and_csrf(self):
        self.assertEqual(self.call('GET', '/projects')[0], 401)
        self.assertEqual(self.call('POST', '/projects', {'title': 'x'}, self.a, {'X-Archive-Client': ''})[0], 403)
        self.assertEqual(self.call('POST', '/projects', {'title': 'x'}, self.a, {'Origin': 'https://evil.invalid'})[0], 403)
        self.assertEqual(self.call('OPTIONS', '/projects')[0], 403)

    def test_03_ownership_and_history(self):
        project = self.create()
        path = '/projects/' + project['id']
        for method, data in [('GET', None), ('PUT', {'title': 'overwrite'}), ('DELETE', None)]:
            self.assertEqual(self.call(method, path, data, self.b)[0], 404)
        self.assertEqual(self.call('GET', path + '/history', cookie=self.b)[0], 404)
        status, result, _ = self.call('PUT', path, {'title': '第二版', 'notes': '新笔记'}, self.a)
        self.assertEqual(status, 200)
        history = self.call('GET', path + '/history', cookie=self.a)[1]['versions']
        self.assertEqual(history[0]['title'], '真实项目')
        self.assertEqual(self.call('POST', '/projects', {'title': 'unsafe', 'url': 'javascript:alert(1)'}, self.a)[0], 400)
        self.assertEqual(self.call('POST', '/projects', {'title': 'unsafe', 'url': 'https://user:password@example.com'}, self.a)[0], 400)

    def test_04_public_opt_in_review_and_projection(self):
        project = self.create('public')
        self.assertEqual(project['review'], 'pending')
        self.assertEqual(self.call('GET', '/public/projects/' + project['id'])[0], 404)
        self.assertNotIn(project['id'], [x['id'] for x in self.call('GET', '/feed')[1]['projects']])
        with closing(sqlite3.connect(Path(self.temp.name) / 'archive.sqlite3')) as db:
            db.execute("UPDATE projects SET review='approved' WHERE id=?", (project['id'],))
            db.commit()
        feed = self.call('GET', '/feed')[1]
        public = next(x for x in feed['projects'] if x['id'] == project['id'])
        self.assertNotIn('notes', public)
        self.assertNotIn('event', public)
        self.assertNotIn('username', public['author'])
        direct = self.call('GET', '/public/projects/' + project['id'])
        self.assertEqual(direct[0], 200)
        self.assertEqual(direct[1]['project'], public)
        self.assertEqual(direct[2]['Cache-Control'], 'no-store')
        # Input remains plain JSON text, not HTML content. UI must escape it.
        self.assertEqual(public['summary'], '<img src=x onerror=alert(1)>')
        self.assertEqual(self.call('GET', '/public/' + self.a_id)[0], 200)
        self.call('PUT', '/projects/' + project['id'], {'title': 'changed', 'visibility': 'public'}, self.a)
        self.assertEqual(self.call('GET', '/public/projects/' + project['id'])[0], 404)
        self.assertNotIn(project['id'], [x['id'] for x in self.call('GET', '/feed')[1]['projects']])
        self.call('PUT', '/projects/' + project['id'], {'title': 'withdrawn', 'visibility': 'private'}, self.a)
        self.assertNotIn(project['id'], [x['id'] for x in self.call('GET', '/feed')[1]['projects']])

    def test_05_file_private_download_and_validation(self):
        project = self.create()
        payload = {'name': '笔记.md', 'content': base64.b64encode('私密内容'.encode()).decode(), 'projectId': project['id']}
        self.assertEqual(self.call('POST', '/files', payload, self.b)[0], 404)
        status, response, _ = self.call('POST', '/files', payload, self.a)
        self.assertEqual(status, 201)
        path = '/files/' + response['file']['id']
        self.assertEqual(self.call('GET', path + '/download')[0], 401)
        self.assertEqual(self.call('GET', path + '/download', cookie=self.b)[0], 404)
        status, data, headers = self.call('GET', path + '/download', cookie=self.a)
        self.assertEqual(data.decode(), '私密内容')
        self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
        self.assertTrue(headers['Content-Disposition'].startswith('attachment;'))
        self.assertEqual(self.call('DELETE', path, cookie=self.b)[0], 404)
        for filename in ['../escape.txt', 'bad.html', 'fake.png']:
            self.assertEqual(self.call('POST', '/files', dict(payload, name=filename), self.a)[0], 400)
        self.assertEqual(self.call('DELETE', '/projects/' + project['id'], cookie=self.a)[0], 200)
        self.assertEqual(self.call('GET', path + '/download', cookie=self.a)[0], 200)
        self.assertEqual(self.call('DELETE', path, cookie=self.a)[0], 200)
        self.assertEqual(self.call('GET', path + '/download', cookie=self.a)[0], 404)

    def test_06_posts_moderation_unique_reactions(self):
        private_project = self.create()
        status, response, _ = self.call('POST', '/posts', {'body': '本次更新', 'kind': 'update', 'projectId': private_project['id']}, self.a)
        self.assertEqual(status, 201)
        post_id = response['post']['id']
        path = '/posts/' + post_id
        self.assertEqual(self.call('POST', path + '/like', {'active': True}, self.b)[0], 404)
        with closing(sqlite3.connect(Path(self.temp.name) / 'archive.sqlite3')) as db:
            db.execute("UPDATE posts SET review='approved' WHERE id=?", (post_id,))
            db.commit()
        public = next(x for x in self.call('GET', '/feed')[1]['posts'] if x['id'] == post_id)
        self.assertIsNone(public['projectId'])
        for _ in range(2):
            result = self.call('POST', path + '/like', {'active': True}, self.b)
        self.assertEqual(result[1]['post']['likes'], 1)
        self.assertIsNone(result[1]['post']['projectId'])
        self.assertEqual(self.call('POST', path + '/bookmark', {'active': True}, self.b)[1]['post']['bookmarks'], 1)
        self.assertEqual(self.call('POST', path + '/like', {'active': False}, self.b)[1]['post']['likes'], 0)
        self.assertEqual(self.call('DELETE', path, cookie=self.b)[0], 404)
        self.assertEqual(self.call('DELETE', path, cookie=self.a)[0], 200)

    def test_06a_public_profile_reactions_are_viewer_specific(self):
        status, response, _ = self.call('POST', '/posts', {'body': '公开主页上的交流帖子'}, self.a)
        self.assertEqual(status, 201)
        post_id = response['post']['id']
        with closing(sqlite3.connect(Path(self.env['ARCHIVE_DATA_DIR']) / 'archive.sqlite3')) as db:
            db.execute("UPDATE posts SET review='approved' WHERE id=?", (post_id,))
            db.commit()
        for reaction in ('like', 'bookmark'):
            self.assertEqual(self.call('POST', '/posts/' + post_id + '/' + reaction,
                                      {'active': True}, self.b)[0], 200)

        profile_path = '/public/' + self.a_id
        status, response, headers = self.call('GET', profile_path, cookie=self.b)
        self.assertEqual(status, 200)
        self.assertEqual(headers['Cache-Control'], 'no-store')
        reacted = next(post for post in response['posts'] if post['id'] == post_id)
        self.assertTrue(reacted['liked'])
        self.assertTrue(reacted['bookmarked'])
        # Aggregate counts are public; this viewer's selected states are not.
        for cookie in (None, self.a):
            status, other, _ = self.call('GET', profile_path, cookie=cookie)
            self.assertEqual(status, 200)
            post = next(item for item in other['posts'] if item['id'] == post_id)
            self.assertFalse(post['liked'])
            self.assertFalse(post['bookmarked'])
            self.assertEqual((post['likes'], post['bookmarks']), (1, 1))

        # Use the returned states as the actual UI does when toggling off.
        for reaction, state in (('like', 'liked'), ('bookmark', 'bookmarked')):
            self.assertEqual(self.call('POST', '/posts/' + post_id + '/' + reaction,
                                      {'active': not reacted[state]}, self.b)[0], 200)
        final = next(post for post in self.call('GET', profile_path, cookie=self.b)[1]['posts']
                     if post['id'] == post_id)
        self.assertEqual((final['liked'], final['bookmarked']), (False, False))
        self.assertEqual((final['likes'], final['bookmarks']), (0, 0))
        self.assertEqual(self.call('DELETE', '/posts/' + post_id, cookie=self.a)[0], 200)

    def test_07_export_isolation(self):
        self.create()
        mine = self.call('GET', '/export', cookie=self.a)
        other = self.call('GET', '/export', cookie=self.b)
        self.assertEqual(mine[0], 200)
        self.assertTrue(mine[1]['projects'])
        self.assertFalse(other[1]['projects'])
        serialized = json.dumps(mine[1])
        self.assertNotIn('password', serialized)
        self.assertNotIn('ai_youth_session', serialized)
        self.assertEqual(mine[2]['Cache-Control'], 'no-store')

    def test_08_logout_invalidates_cookie(self):
        _, _, headers = self.call('POST', '/auth/login', {'username': 'creator_two', 'password': 'test-password-b'})
        token = headers['Set-Cookie'].split(';')[0]
        self.assertEqual(self.call('POST', '/auth/logout', {}, token)[0], 200)
        self.assertIsNone(self.call('GET', '/me', cookie=token)[1]['user'])

    def test_09_restart_preserves_account_and_private_projects(self):
        project = self.create()
        type(self).proc.terminate()
        type(self).proc.wait(timeout=10)
        type(self).proc = subprocess.Popen([sys.executable, str(Path(__file__).with_name('server.py')), '--port', str(self.port)],
            env=self.env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            try:
                if self.call('GET', '/status')[0] == 200:
                    break
            except OSError:
                time.sleep(.05)
        self.assertEqual(self.call('GET', '/me', cookie=self.a)[1]['user']['id'], self.a_id)
        self.assertEqual(self.call('GET', '/projects/' + project['id'], cookie=self.a)[1]['project']['title'], '真实项目')
        self.assertEqual(self.call('GET', '/projects/' + project['id'], cookie=self.b)[0], 404)

    def test_10_account_guessing_limit_across_addresses(self):
        # Distinct trusted-proxy source addresses do not bypass the account limit.
        for attempt in range(15):
            status, _, _ = self.call('POST', '/auth/login', {'username': 'unknown_account', 'password': 'wrong-password'},
                extra={'X-Real-IP': '192.0.2.' + str(attempt + 1)})
            self.assertEqual(status, 401)
        status, _, _ = self.call('POST', '/auth/login', {'username': 'unknown_account', 'password': 'wrong-password'},
            extra={'X-Real-IP': '192.0.2.200'})
        self.assertEqual(status, 429)

    def test_11_proxy_origin_and_oversized_body(self):
        self.assertEqual(self.call('PUT', '/profile', {'name': '代理来源测试'}, self.a,
            {'Origin': 'http://127.0.0.1:' + str(self.port)})[0], 200)
        self.assertEqual(self.call('PUT', '/profile', {'name': '不允许'}, self.a,
            {'Origin': 'null'})[0], 403)
        self.assertEqual(self.call('POST', '/projects', {'title': 'x' * 100001}, self.a)[0], 413)
        self.assertEqual(self.call('POST', '/projects', {'title': 'bad URL', 'url': 'https://[invalid'}, self.a)[0], 400)
        self.assertEqual(self.call('POST', '/posts', {'body': 'bad reference', 'projectId': {'id': 'wrong'}}, self.a)[0], 404)

    def test_12_backup_restore_with_real_login_and_attachment(self):
        project = self.create()
        content = '需要在备份恢复后完整找回的私人文件'.encode('utf-8')
        status, upload, _ = self.call('POST', '/files', {'name': 'restore.md', 'content': base64.b64encode(content).decode(),
            'projectId': project['id']}, self.a)
        self.assertEqual(status, 201)
        file_id = upload['file']['id']
        type(self).proc.terminate()
        type(self).proc.wait(timeout=10)
        backup_parent = Path(self.temp.name) / 'snapshots'
        result = subprocess.run([sys.executable, str(Path(__file__).with_name('manage.py')), 'backup', str(backup_parent)],
            env=self.env, capture_output=True, text=True, check=True, timeout=20)
        snapshot = Path(result.stdout.strip())
        self.assertEqual((snapshot / 'files' / file_id).read_bytes(), content)
        with closing(sqlite3.connect(snapshot / 'archive.sqlite3')) as db:
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
        restored = Path(self.temp.name) / 'restored'
        restored.mkdir()
        shutil.copy2(snapshot / 'archive.sqlite3', restored / 'archive.sqlite3')
        shutil.copytree(snapshot / 'files', restored / 'files')
        type(self).env = dict(self.env, ARCHIVE_DATA_DIR=str(restored))
        type(self).proc = subprocess.Popen([sys.executable, str(Path(__file__).with_name('server.py')), '--port', str(self.port)],
            env=self.env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            try:
                if self.call('GET', '/status')[0] == 200:
                    break
            except OSError:
                time.sleep(.05)
        status, login, headers = self.call('POST', '/auth/login', {'username': 'creator_one', 'password': 'test-password-a'})
        self.assertEqual(status, 200)
        token = headers['Set-Cookie'].split(';')[0]
        self.assertEqual(login['user']['id'], self.a_id)
        self.assertEqual(self.call('GET', '/projects/' + project['id'], cookie=token)[1]['project']['notes'], '私人记录')
        self.assertEqual(self.call('GET', '/files/' + file_id + '/download', cookie=token)[1], content)
        self.assertEqual(self.call('GET', '/files/' + file_id + '/download', cookie=self.b)[0], 404)


if __name__ == '__main__':
    unittest.main(verbosity=2)
