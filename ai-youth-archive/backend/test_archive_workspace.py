"""Archive workspace: real HTTP, isolated SQLite, account privacy and safe saves."""
import base64
import copy
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
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path


class WorkspaceIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        private_tests = Path(__file__).resolve().parent.parent / '.private-notes' / 'integration-tests'
        private_tests.mkdir(parents=True, exist_ok=True)
        cls.temp = tempfile.TemporaryDirectory(prefix='private-workspace-test-', dir=private_tests)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            cls.port = sock.getsockname()[1]
        cls.env = dict(os.environ, ARCHIVE_DATA_DIR=cls.temp.name,
                       ARCHIVE_SECURE_COOKIE='0', ARCHIVE_COOKIE_PATH='/')
        cls.start()
        status, a, headers = cls.call('POST', '/auth/register',
                                    {'username': 'workspace_a', 'password': 'test-secret-aaa', 'name': '甲'})
        assert status == 201
        cls.a_id, cls.a = a['user']['id'], headers['Set-Cookie'].split(';')[0]
        status, b, headers = cls.call('POST', '/auth/register',
                                    {'username': 'workspace_b', 'password': 'test-secret-bbb', 'name': '乙'})
        assert status == 201
        cls.b_id, cls.b = b['user']['id'], headers['Set-Cookie'].split(';')[0]

    @classmethod
    def start(cls):
        cls.proc = subprocess.Popen([sys.executable, str(Path(__file__).with_name('server.py')),
                                     '--port', str(cls.port)], env=cls.env,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            try:
                if cls.call('GET', '/status')[0] == 200:
                    return
            except OSError:
                time.sleep(.05)
        raise RuntimeError('test API did not start')

    @classmethod
    def restart(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=10)
        cls.start()

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=10)
        cls.temp.cleanup()

    def setUp(self):
        with self.database() as db:
            db.execute('DELETE FROM archive_workspaces')

    @contextmanager
    def database(self):
        db = sqlite3.connect(Path(self.temp.name) / 'archive.sqlite3')
        try:
            yield db
            db.commit()
        finally:
            db.close()

    @classmethod
    def call(cls, method, path, data=None, cookie=None, extra=None):
        connection = http.client.HTTPConnection('127.0.0.1', cls.port, timeout=15)
        headers = {'X-Archive-Client': '1', 'Content-Type': 'application/json'}
        if cookie:
            headers['Cookie'] = cookie
        if extra:
            headers.update(extra)
        body = json.dumps(data).encode('utf-8') if data is not None else None
        connection.request(method, '/api' + path, body=body, headers=headers)
        response = connection.getresponse()
        content, status, response_headers = response.read(), response.status, dict(response.getheaders())
        connection.close()
        return status, json.loads(content), response_headers

    def workspace(self, kind='note', ref_id=''):
        return {'version': 1, 'folders': [{'id': 'folder-one', 'name': '我的参赛资料',
                'type': 'event', 'purpose': '整理自己填写的参赛历程', 'cover': None,
                'x': .1, 'y': .2, 'items': [{'text': '私人说明', 'source': '本人填写 · 未经主办方确认',
                'public': False, 'picture': False, 'kind': kind, 'refId': ref_id}]}],
                'selected': 'folder-one', 'canvasHeight': 640}

    def save(self, workspace=None, revision=0, cookie=None):
        return self.call('PUT', '/archive-workspace',
                         {'workspace': self.workspace() if workspace is None else workspace,
                          'revision': revision}, cookie or self.a)

    def project(self, cookie=None):
        result = self.call('POST', '/projects', {'title': '私人作品', 'notes': '不公开'}, cookie or self.a)
        self.assertEqual(result[0], 201)
        return result[1]['project']['id']

    def file(self, cookie=None):
        result = self.call('POST', '/files', {'name': '私人材料.txt',
                         'content': base64.b64encode(b'private contents').decode('ascii')}, cookie or self.a)
        self.assertEqual(result[0], 201)
        return result[1]['file']['id']

    def test_01_auth_and_empty_workspace(self):
        self.assertEqual(self.call('GET', '/archive-workspace')[0], 401)
        self.assertEqual(self.call('PUT', '/archive-workspace', {'revision': 0})[0], 401)
        self.assertEqual(self.call('PUT', '/archive-workspace', {'revision': 0}, self.a,
                                   {'X-Archive-Client': ''})[0], 403)
        self.assertEqual(self.call('PUT', '/archive-workspace', {'revision': 0}, self.a,
                                   {'Origin': 'https://foreign.invalid'})[0], 403)
        status, body, headers = self.call('GET', '/archive-workspace', cookie=self.a)
        self.assertEqual(status, 200)
        self.assertEqual(body, {'workspace': {'version': 1, 'folders': [], 'selected': None,
                                             'canvasHeight': 540}, 'revision': 0, 'updatedAt': None})
        self.assertEqual(headers['Cache-Control'], 'no-store')
        self.assertEqual(self.call('POST', '/archive-workspace', {}, self.a)[0], 405)

    def test_02_private_roundtrip_export_and_no_publication(self):
        workspace = self.workspace()
        workspace['folders'][0]['items'][0]['kind'] = 'message'
        workspace['folders'][0]['items'][0]['public'] = True
        workspace['owner'] = self.b_id  # Ignored: ownership always comes from the session.
        status, saved, _ = self.save(workspace)
        self.assertEqual(status, 200)
        self.assertEqual(saved['revision'], 1)
        self.assertEqual(saved['workspace']['folders'][0]['items'][0]['kind'], 'message')
        self.assertIsInstance(saved['updatedAt'], int)
        self.assertNotIn('owner', saved['workspace'])
        self.assertEqual(self.call('GET', '/archive-workspace', cookie=self.a)[1], saved)
        self.assertEqual(self.call('GET', '/archive-workspace', cookie=self.b)[1]['revision'], 0)
        exported = self.call('GET', '/export', cookie=self.a)[1]
        self.assertEqual(exported['archiveWorkspace'], saved)
        self.assertEqual(self.call('GET', '/export', cookie=self.b)[1]['archiveWorkspace']['revision'], 0)
        public = json.dumps(self.call('GET', '/feed')[1], ensure_ascii=False)
        self.assertNotIn('私人说明', public)
        self.assertEqual(self.call('GET', '/public/' + self.a_id)[0], 404)

    def test_03_revision_conflict_and_concurrent_saves(self):
        saved = self.save()[1]
        changed = self.workspace()
        changed['folders'][0]['name'] = '新的文件夹'
        self.assertEqual(self.save(changed, 0)[0], 409)
        self.assertEqual(self.call('GET', '/archive-workspace', cookie=self.a)[1], saved)
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(lambda _: self.save(changed, 1), range(2)))
        self.assertEqual(sorted(response[0] for response in responses), [200, 409])
        latest = self.call('GET', '/archive-workspace', cookie=self.a)[1]
        self.assertEqual(latest['revision'], 2)
        self.assertEqual(latest['workspace']['folders'][0]['name'], '新的文件夹')

    def test_04_references_require_ownership(self):
        for kind, ref_id in [('file', self.file(self.b)), ('project', self.project(self.b)),
                             ('file', 'a' * 32), ('project', '../database')]:
            with self.subTest(kind=kind):
                data = self.workspace(kind, ref_id)
                data['folders'][0]['items'][0]['unavailable'] = True
                self.assertEqual(self.save(data)[0], 404)
        self.assertEqual(self.call('GET', '/archive-workspace', cookie=self.a)[1]['revision'], 0)
        project_id = self.project()
        file_id = self.file()
        data = self.workspace('file', file_id)
        data['folders'][0]['items'][0]['public'] = True  # Client cannot publish a private attachment.
        data['folders'][0]['items'].append({'text': '我的作品引用', 'source': '本人作品',
                                           'kind': 'project', 'refId': project_id, 'public': True})
        status, saved, _ = self.save(data)
        self.assertEqual(status, 200)
        self.assertTrue(all(item['unavailable'] is False for item in saved['workspace']['folders'][0]['items']))
        self.assertFalse(saved['workspace']['folders'][0]['items'][0]['public'])
        self.assertEqual(self.call('GET', '/files/' + file_id + '/download', cookie=self.b)[0], 404)

    def test_05_deleted_references_keep_notes_but_cannot_share(self):
        ref_id = self.file()
        data = self.workspace('file', ref_id)
        data['folders'][0]['items'][0]['public'] = True
        self.assertEqual(self.save(data)[0], 200)
        self.assertEqual(self.call('DELETE', '/files/' + ref_id, cookie=self.a)[0], 200)
        loaded = self.call('GET', '/archive-workspace', cookie=self.a)[1]
        item = loaded['workspace']['folders'][0]['items'][0]
        self.assertEqual(item['text'], '私人说明')
        self.assertTrue(item['unavailable'])
        self.assertFalse(item['public'])
        self.assertEqual(self.save(loaded['workspace'], loaded['revision'])[0], 200)
        moved = copy.deepcopy(loaded['workspace'])
        moved['folders'][0]['id'] = 'different-folder'
        moved['selected'] = 'different-folder'
        self.assertEqual(self.save(moved, 2)[0], 404)
        # Removing an old broken reference is allowed; no unrelated private file is deleted.
        loaded['workspace']['folders'][0]['items'] = []
        self.assertEqual(self.save(loaded['workspace'], 2)[0], 200)
        project_id = self.project()
        self.assertEqual(self.save(self.workspace('project', project_id), 3)[0], 200)
        self.assertEqual(self.call('DELETE', '/projects/' + project_id, cookie=self.a)[0], 200)
        self.assertTrue(self.call('GET', '/archive-workspace', cookie=self.a)[1]['workspace']['folders'][0]['items'][0]['unavailable'])

    def test_06_real_cover_validation(self):
        png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF9sAAAAASUVORK5CYII=')
        valid = 'data:image/png;base64,' + base64.b64encode(png).decode('ascii')
        data = self.workspace()
        data['folders'][0]['cover'] = valid
        self.assertEqual(self.save(data)[0], 200)
        for cover, code in [('data:image/svg+xml;base64,' + base64.b64encode(b'<svg/>').decode(), 400),
                            ('data:image/jpeg;base64,' + base64.b64encode(png).decode(), 400),
                            ('https://remote.invalid/cover.png', 400),
                            ('data:image/png;base64,', 413),
                            ('data:image/png;base64,' + base64.b64encode(b'\x89PNG\r\n\x1a\n' + b'a' * (512 * 1024)).decode(), 413)]:
            with self.subTest(code=code):
                data['folders'][0]['cover'] = cover
                self.assertEqual(self.save(data, 1)[0], code)
        self.assertEqual(self.call('GET', '/archive-workspace', cookie=self.a)[1]['workspace']['folders'][0]['cover'], valid)

    def test_07_invalid_data_does_not_overwrite(self):
        self.assertEqual(self.save()[0], 200)
        mutations = [lambda w: w.update(version=True), lambda w: w.update(selected='missing'),
                     lambda w: w.update(canvasHeight=539), lambda w: w.update(canvasHeight=float('nan')),
                     lambda w: w['folders'][0].update(id='../x'), lambda w: w['folders'][0].update(name=''),
                     lambda w: w['folders'][0].update(type='wallet'), lambda w: w['folders'][0].update(x=True),
                     lambda w: w['folders'][0].update(y=float('inf')), lambda w: w['folders'][0].update(x=10 ** 300),
                     lambda w: w['folders'][0]['items'][0].update(public='yes'),
                     lambda w: w['folders'][0]['items'][0].update(picture=1),
                     lambda w: w['folders'][0]['items'][0].update(kind='credential'),
                     lambda w: w['folders'][0]['items'][0].update(text='x' * 4001),
                     lambda w: w['folders'][0]['items'][0].update(refId='unrelated')]
        for mutate in mutations:
            data = self.workspace()
            mutate(data)
            self.assertEqual(self.save(data, 1)[0], 400)
        self.assertEqual(self.save(revision=True)[0], 400)
        self.assertEqual(self.save(revision=-1)[0], 400)
        latest = self.call('GET', '/archive-workspace', cookie=self.a)[1]
        self.assertEqual(latest['revision'], 1)
        self.assertEqual(latest['workspace']['folders'][0]['name'], '我的参赛资料')

    def test_08_count_and_total_payload_limits(self):
        data = self.workspace()
        data['folders'] = [dict(copy.deepcopy(data['folders'][0]), id='folder-' + str(i)) for i in range(40)]
        data['selected'] = 'folder-0'
        data['folders'][0]['items'] *= 60
        self.assertEqual(self.save(data)[0], 200)
        too_many = copy.deepcopy(data)
        too_many['folders'].append(dict(copy.deepcopy(data['folders'][0]), id='folder-41'))
        self.assertEqual(self.save(too_many, 1)[0], 400)
        too_many = copy.deepcopy(data)
        too_many['folders'][0]['items'].append(dict(too_many['folders'][0]['items'][0]))
        self.assertEqual(self.save(too_many, 1)[0], 400)
        duplicate = self.workspace()
        duplicate['folders'] *= 2
        self.assertEqual(self.save(duplicate, 1)[0], 400)
        # The server rejects an oversized announced body before reading it. Do not
        # continue streaming MBs into a correctly closed connection on Windows.
        self.assertEqual(self.call('PUT', '/archive-workspace',
                                   {'workspace': self.workspace(), 'revision': 1}, self.a,
                                   {'Content-Length': str(5 * 1024 * 1024)})[0], 413)
        self.assertEqual(self.call('GET', '/archive-workspace', cookie=self.a)[1]['revision'], 1)

    def test_09_restart_persistence_and_account_delete_cascade(self):
        saved = self.save()[1]
        self.restart()
        self.assertEqual(self.call('GET', '/archive-workspace', cookie=self.a)[1], saved)
        self.assertEqual(self.call('GET', '/archive-workspace', cookie=self.b)[1]['revision'], 0)
        # There is no public account-deletion endpoint. Operator deletion uses FK cascade.
        with self.database() as db:
            db.execute('PRAGMA foreign_keys=ON')
            db.execute('INSERT INTO users VALUES(?,?,?,?,?,?)',
                       ('f' * 32, 'cascade_test', 'not-a-live-password', '{}', 'creator', 1))
            db.execute('INSERT INTO archive_workspaces VALUES(?,?,?,?)', ('f' * 32, '{}', 1, 1))
            db.execute('DELETE FROM users WHERE id=?', ('f' * 32,))
            self.assertEqual(db.execute('SELECT COUNT(*) FROM archive_workspaces WHERE owner=?', ('f' * 32,)).fetchone()[0], 0)

    def test_10_additive_upgrade_preserves_existing_records(self):
        project_id = self.project()
        file_id = self.file()
        with self.database() as db:
            db.execute('DROP TABLE archive_workspaces')
        self.restart()
        self.assertEqual(self.call('GET', '/projects/' + project_id, cookie=self.a)[0], 200)
        self.assertEqual(self.call('GET', '/files', cookie=self.a)[0], 200)
        with self.database() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM files WHERE id=?', (file_id,)).fetchone()[0], 1)
        self.assertEqual(self.call('GET', '/archive-workspace', cookie=self.a)[1]['revision'], 0)
        self.assertEqual(self.save()[0], 200)

    def test_11_folder_colors_roundtrip_export_and_restart(self):
        colors = ['mint', 'lime', 'sky', 'violet', 'pink', 'sand', 'white']
        data = self.workspace()
        data['folders'] = [dict(copy.deepcopy(data['folders'][0]), id='color-' + color, color=color)
                           for color in colors]
        data['selected'] = 'color-mint'
        status, saved, _ = self.save(data)
        self.assertEqual(status, 200)
        self.assertEqual([folder['color'] for folder in saved['workspace']['folders']], colors)
        changed = copy.deepcopy(saved['workspace'])
        changed['folders'][0]['color'] = 'violet'
        status, updated, _ = self.save(changed, saved['revision'])
        self.assertEqual(status, 200)
        self.assertEqual(updated['revision'], 2)
        self.assertEqual(updated['workspace']['folders'][0]['color'], 'violet')
        self.restart()
        self.assertEqual(self.call('GET', '/archive-workspace', cookie=self.a)[1], updated)
        self.assertEqual(self.call('GET', '/export', cookie=self.a)[1]['archiveWorkspace'], updated)
        self.assertEqual(self.call('GET', '/archive-workspace', cookie=self.b)[1]['workspace']['folders'], [])

    def test_12_legacy_folders_get_default_without_rewriting(self):
        legacy = self.workspace()
        self.assertNotIn('color', legacy['folders'][0])
        encoded = json.dumps(legacy, ensure_ascii=False)
        with self.database() as db:
            db.execute('INSERT INTO archive_workspaces(owner,body,revision,updated) VALUES(?,?,?,?)',
                       (self.a_id, encoded, 7, 1234567890))
        status, loaded, _ = self.call('GET', '/archive-workspace', cookie=self.a)
        self.assertEqual(status, 200)
        self.assertEqual(loaded['workspace']['folders'][0]['color'], 'mint')
        self.assertEqual((loaded['revision'], loaded['updatedAt']), (7, 1234567890))
        self.assertEqual(self.call('GET', '/export', cookie=self.a)[1]['archiveWorkspace'], loaded)
        with self.database() as db:
            self.assertEqual(db.execute('SELECT body FROM archive_workspaces WHERE owner=?',
                                        (self.a_id,)).fetchone()[0], encoded)
        # An old browser may still send no color; saving must stay compatible.
        status, saved, _ = self.save(legacy, 7)
        self.assertEqual(status, 200)
        self.assertEqual(saved['workspace']['folders'][0]['color'], 'mint')
        self.assertEqual(saved['revision'], 8)
        self.assertEqual(saved['workspace']['folders'][0]['items'], loaded['workspace']['folders'][0]['items'])

    def test_13_invalid_folder_colors_do_not_overwrite(self):
        data = self.workspace()
        data['folders'][0]['color'] = 'pink'
        saved = self.save(data)[1]
        invalid = [None, True, 1, [], {}, '', 'Mint', '#b7ead1',
                   'mint; background: url(https://foreign.invalid)', 'var(--custom)']
        for color in invalid:
            with self.subTest(color=color):
                changed = copy.deepcopy(data)
                changed['folders'][0]['color'] = color
                status, body, _ = self.save(changed, saved['revision'])
                self.assertEqual(status, 400)
                self.assertEqual(body['error'], '请选择提供的文件夹颜色')
        self.assertEqual(self.call('GET', '/archive-workspace', cookie=self.a)[1], saved)


if __name__ == '__main__':
    unittest.main(verbosity=2)
