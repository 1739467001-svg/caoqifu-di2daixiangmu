#!/usr/bin/env python3
"""AI youth archive API. Python 3.9+, standard library only; loopback behind HTTPS."""
import argparse
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import sqlite3
import threading
import time
from contextlib import contextmanager
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, urlparse

ROOT = Path(os.environ.get('ARCHIVE_DATA_DIR', '/var/lib/ai-youth-archive')).resolve()
DB = ROOT / 'archive.sqlite3'
FILE_LIMIT = 10 * 1024 * 1024
QUOTA = int(os.environ.get('ARCHIVE_QUOTA_BYTES', 100 * 1024 * 1024))
TOTAL_QUOTA = int(os.environ.get('ARCHIVE_TOTAL_QUOTA_BYTES', 2 * 1024 * 1024 * 1024))
MAX_ACCOUNTS = int(os.environ.get('ARCHIVE_MAX_ACCOUNTS', 200))
COOKIE_PATH = os.environ.get('ARCHIVE_COOKIE_PATH', '/ai-youth/')
SECURE = os.environ.get('ARCHIVE_SECURE_COOKIE', '1') != '0'
SESSION_AGE = 7 * 24 * 3600
ROUNDS = 600000
RATE = {}
RATE_LOCK = threading.Lock()
UPLOAD_LOCK = threading.Lock()
LARGE_BODY_SLOTS = threading.BoundedSemaphore(2)


class APIError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


@contextmanager
def connection():
    db = sqlite3.connect(str(DB), timeout=15)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def initialize():
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    (ROOT / 'files').mkdir(mode=0o700, exist_ok=True)
    with connection() as db:
        db.execute('PRAGMA journal_mode=WAL')
        db.executescript('''
          CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
            profile TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'creator', created INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
            expires INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY, owner TEXT REFERENCES users(id) ON DELETE CASCADE,
            body TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'private',
            review TEXT NOT NULL DEFAULT 'private', created INTEGER NOT NULL, updated INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS versions (
            id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
            body TEXT NOT NULL, created INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS files (
            id TEXT PRIMARY KEY, owner TEXT REFERENCES users(id) ON DELETE CASCADE,
            name TEXT NOT NULL, size INTEGER NOT NULL, category TEXT NOT NULL,
            project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, created INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS posts (
            id TEXT PRIMARY KEY, owner TEXT REFERENCES users(id) ON DELETE CASCADE,
            body TEXT NOT NULL, kind TEXT NOT NULL, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
            review TEXT NOT NULL DEFAULT 'pending', created INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS reactions (
            user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
            post_id TEXT REFERENCES posts(id) ON DELETE CASCADE, kind TEXT NOT NULL,
            PRIMARY KEY(user_id, post_id, kind));
          CREATE INDEX IF NOT EXISTS projects_owner ON projects(owner);
          CREATE INDEX IF NOT EXISTS files_owner ON files(owner);
          CREATE INDEX IF NOT EXISTS posts_owner ON posts(owner);
        ''')
    if os.name != 'nt':
        os.chmod(DB, 0o600)


def now():
    return int(time.time())


def uid():
    return secrets.token_hex(16)


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def text_field(data, key, maximum, default='', required=False):
    value = data.get(key, default)
    if not isinstance(value, str):
        raise APIError(400, key + ' 必须是文字')
    value = value.strip()
    if len(value) > maximum or (required and not value):
        raise APIError(400, key + ' 为空或超过长度限制')
    # Store plain text. The frontend must use textContent / escape before rendering.
    return ''.join(c for c in value if ord(c) >= 32 or c in '\n\t')


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), ROUNDS).hex()
    return salt + ':' + digest


def user_view(row):
    return {'id': row['id'], 'username': row['username'], 'profile': json.loads(row['profile']), 'role': row['role']}


def project_view(row):
    return dict(json.loads(row['body']), id=row['id'], visibility=row['visibility'], review=row['review'],
                createdAt=row['created'], updatedAt=row['updated'])


def project_body(data):
    result = {k: text_field(data, k, n, required=(k == 'title')) for k, n in
              [('title', 120), ('summary', 4000), ('tech', 300), ('role', 1000),
               ('event', 300), ('url', 2000), ('status', 50), ('notes', 6000)]}
    if result['url']:
        try:
            parsed = urlparse(result['url'])
            valid = parsed.scheme in ('http', 'https') and parsed.hostname and not parsed.username and not parsed.password
            parsed.port  # Raises ValueError for malformed ports.
        except ValueError:
            valid = False
        if not valid:
            raise APIError(400, '作品链接须使用 http 或 https，且不能包含登录信息')
    visibility = data.get('visibility', 'private')
    if visibility not in ('private', 'public'):
        raise APIError(400, '请选择私密或公开')
    return result, visibility


class Handler(BaseHTTPRequestHandler):
    server_version = 'ArchiveAPI'
    sys_version = ''

    def setup(self):
        super().setup()
        self.connection.settimeout(20)

    def log_message(self, fmt, *args):
        # Never log bodies, passwords, session cookies, or user filenames.
        print('%s %s %s' % (self.log_date_time_string(), self.command, getattr(self, 'response_code', '-')), flush=True)

    def send_response(self, code, message=None):
        self.response_code = code
        super().send_response(code, message)

    def response(self, value, code=200, cookie=None):
        # A success must be durable before the browser can make its next request.
        if code < 400 and getattr(self, 'active_db', None) is not None:
            self.active_db.commit()
        content = encode(value).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(content)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        if cookie:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()
        self.wfile.write(content)

    def read_json(self, maximum=100000):
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            raise APIError(415, '请使用 JSON 请求')
        if self.headers.get('Transfer-Encoding'):
            raise APIError(400, '不支持分块请求')
        if len(self.headers.get_all('Content-Length', [])) != 1:
            raise APIError(400, '请求长度无效')
        try:
            size = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            raise APIError(400, '请求长度无效')
        if not 0 < size <= maximum:
            raise APIError(413, '内容过大或为空')
        if maximum > 100000:
            if not LARGE_BODY_SLOTS.acquire(blocking=False):
                raise APIError(429, '当前上传较多，请稍后再试')
            self.holds_large_body_slot = True
        try:
            raw = self.rfile.read(size)
            if len(raw) != size:
                raise ValueError()
            result = json.loads(raw)
            if not isinstance(result, dict):
                raise ValueError()
            return result
        except (ValueError, UnicodeDecodeError):
            raise APIError(400, '无法读取提交内容')

    def check_write(self):
        if self.headers.get('X-Archive-Client') != '1':
            raise APIError(403, '请从本站页面提交')
        if len(self.headers.get_all('Host', [])) != 1 or len(self.headers.get_all('Origin', [])) > 1:
            raise APIError(403, '请求来源无效')
        origin = self.headers.get('Origin')
        if origin:
            try:
                parsed = urlparse(origin)
                valid = (parsed.scheme in (('https',) if SECURE else ('http', 'https')) and
                         parsed.netloc.lower() == self.headers.get('Host', '').lower() and
                         not parsed.path and not parsed.query and not parsed.fragment)
            except ValueError:
                valid = False
            if not valid:
                raise APIError(403, '请求来源不匹配')
        self.rate_limit('write', 100, 60)

    def rate_limit(self, kind, limit, seconds, identity=None):
        # Forwarded addresses are trusted only because this server binds loopback.
        ip = self.client_address[0]
        if ip in ('127.0.0.1', '::1'):
            ip = self.headers.get('X-Real-IP', ip)
        key = (identity or ip, kind)
        t = now()
        with RATE_LOCK:
            if len(RATE) >= 10000:
                for old in list(RATE):
                    if not RATE[old] or RATE[old][-1] < t - 3600:
                        del RATE[old]
                if len(RATE) >= 10000 and key not in RATE:
                    raise APIError(429, '请求较多，请稍后重试')
            attempts = RATE.setdefault(key, [])
            attempts[:] = [x for x in attempts if x > t - seconds]
            if len(attempts) >= limit:
                raise APIError(429, '操作太频繁，请稍后再试')
            attempts.append(t)

    def current_user(self, db, required=True):
        try:
            cookies = SimpleCookie(self.headers.get('Cookie', ''))
            token = cookies['ai_youth_session'].value if 'ai_youth_session' in cookies else ''
        except Exception:
            token = ''
        row = db.execute('SELECT users.* FROM users JOIN sessions ON sessions.user_id=users.id '
                         'WHERE token=? AND expires>?', (hashlib.sha256(token.encode()).hexdigest(), now())).fetchone()
        if not row and required:
            raise APIError(401, '请先登录，再保存自己的档案')
        return row

    def session_cookie(self, token, age=SESSION_AGE):
        return 'ai_youth_session=%s; Path=%s; HttpOnly; SameSite=Lax; Max-Age=%d%s' % (
            token, COOKIE_PATH, age, '; Secure' if SECURE else '')

    def new_session(self, db, user_id):
        token = secrets.token_urlsafe(32)
        db.execute('DELETE FROM sessions WHERE expires<?', (now(),))
        db.execute('INSERT INTO sessions VALUES(?,?,?)',
                   (hashlib.sha256(token.encode()).hexdigest(), user_id, now() + SESSION_AGE))
        return self.session_cookie(token)

    def owned(self, db, table, item_id, user):
        if table not in ('projects', 'posts', 'files'):
            raise ValueError('Invalid table')
        if not isinstance(item_id, str) or not re.fullmatch('[a-f0-9]{32}', item_id):
            raise APIError(404, '内容不存在或无权访问')
        row = db.execute('SELECT * FROM ' + table + ' WHERE id=? AND owner=?', (item_id, user['id'])).fetchone()
        if not row:
            raise APIError(404, '内容不存在或无权访问')
        return row

    def dispatch(self):
        path = urlparse(self.path).path.rstrip('/')
        if path.startswith('/ai-youth/api'):
            path = path[len('/ai-youth'):]
        if not path.startswith('/api/'):
            raise APIError(404, '接口不存在')
        parts = path[5:].split('/')
        method = self.command
        if method in ('POST', 'PUT', 'DELETE'):
            self.check_write()
        if parts == ['status'] and method == 'GET':
            return self.response({'ready': True, 'auth': {'password': True, 'sms': False},
                                  'limits': {'fileBytes': FILE_LIMIT, 'storageBytes': QUOTA},
                                  'publishing': 'review-required', 'version': 1})
        with connection() as db:
            self.active_db = db
            if len(parts) == 2 and parts[0] == 'auth':
                return self.auth(db, parts[1])
            if parts == ['feed'] and method == 'GET':
                return self.feed(db)
            if len(parts) == 3 and parts[:2] == ['public', 'projects'] and method == 'GET':
                row = db.execute("SELECT * FROM projects WHERE id=? AND visibility='public' AND review='approved'", (parts[2],)).fetchone()
                if not row:
                    raise APIError(404, '作品未公开、尚待审核，或已经撤回')
                return self.response({'project': self.public_project(db, row)})
            if len(parts) == 2 and parts[0] == 'public' and method == 'GET':
                return self.public_profile(db, parts[1])
            user = self.current_user(db, required=parts != ['me'])
            if parts == ['me'] and method == 'GET':
                used = db.execute('SELECT COALESCE(SUM(size),0) FROM files WHERE owner=?', (user['id'],)).fetchone()[0] if user else 0
                return self.response({'user': user_view(user) if user else None, 'usage': {'used': used, 'limit': QUOTA}})
            if parts == ['profile'] and method == 'PUT':
                data = self.read_json()
                profile = {k: text_field(data, k, n, required=(k == 'name')) for k, n in
                           [('name', 60), ('bio', 600), ('skills', 300), ('intent', 200)]}
                db.execute('UPDATE users SET profile=? WHERE id=?', (encode(profile), user['id']))
                return self.response({'profile': profile})
            if parts[0] == 'projects':
                return self.projects(db, user, parts)
            if parts[0] == 'posts':
                return self.posts(db, user, parts)
            if parts[0] == 'files':
                return self.files(db, user, parts)
            if parts == ['export'] and method == 'GET':
                return self.response({'exportedAt': now(), 'profile': json.loads(user['profile']),
                    'projects': [project_view(x) for x in db.execute('SELECT * FROM projects WHERE owner=?', (user['id'],))],
                    'versions': [dict(x) for x in db.execute('SELECT versions.* FROM versions JOIN projects ON projects.id=versions.project_id WHERE projects.owner=?', (user['id'],))],
                    'posts': [dict(x) for x in db.execute('SELECT id,body,kind,project_id,review,created FROM posts WHERE owner=?', (user['id'],))],
                    'files': [self.file_view(x) for x in db.execute('SELECT * FROM files WHERE owner=?', (user['id'],))],
                    'notice': '此文件包含私人文字资料及附件清单。附件内容请从资料库分别下载。'})
            raise APIError(404, '接口不存在')

    def auth(self, db, action):
        if self.command != 'POST':
            raise APIError(405, '请求方式不支持')
        if action == 'logout':
            cookies = SimpleCookie(self.headers.get('Cookie', ''))
            if 'ai_youth_session' in cookies:
                db.execute('DELETE FROM sessions WHERE token=?', (hashlib.sha256(cookies['ai_youth_session'].value.encode()).hexdigest(),))
            return self.response({'ok': True}, cookie=self.session_cookie('', 0))
        if action not in ('login', 'register'):
            raise APIError(503, '短信服务尚未开通，请使用账号密码登录')
        self.rate_limit(action, 8 if action == 'register' else 20, 3600 if action == 'register' else 600)
        data = self.read_json()
        username = text_field(data, 'username', 32, required=True).lower()
        password = data.get('password', '')
        if not re.fullmatch('[a-z0-9_]{3,32}', username) or not isinstance(password, str) or not 10 <= len(password) <= 128:
            raise APIError(400, '账号请用 3–32 位字母、数字或下划线；密码至少 10 位，最多 128 位')
        if action == 'register':
            db.execute('BEGIN IMMEDIATE')
            if db.execute('SELECT COUNT(*) FROM users').fetchone()[0] >= MAX_ACCOUNTS:
                raise APIError(503, '当前试用名额已满，请联系管理员')
            profile = {'name': text_field(data, 'name', 60) or '创作者', 'bio': '', 'skills': '', 'intent': ''}
            user_id = uid()
            try:
                db.execute('INSERT INTO users(id,username,password,profile,created) VALUES(?,?,?,?,?)',
                           (user_id, username, password_hash(password), encode(profile), now()))
            except sqlite3.IntegrityError:
                raise APIError(409, '这个账号已被使用，请换一个')
            row = db.execute('SELECT * FROM users WHERE id=?', (user_id,)).fetchone()
        else:
            self.rate_limit('login-account', 15, 900, 'account:' + hashlib.sha256(username.encode()).hexdigest())
            row = db.execute('SELECT * FROM users WHERE username=?', (username,)).fetchone()
            saved = row['password'] if row else '0' * 32 + ':' + '0' * 64
            computed = password_hash(password, saved.split(':')[0])
            if not hmac.compare_digest(computed, saved) or not row:
                raise APIError(401, '账号或密码不正确')
        return self.response({'user': user_view(row)}, 201 if action == 'register' else 200,
                             cookie=self.new_session(db, row['id']))

    def projects(self, db, user, parts):
        if len(parts) == 1:
            if self.command == 'GET':
                return self.response({'projects': [project_view(x) for x in db.execute(
                    'SELECT * FROM projects WHERE owner=? ORDER BY updated DESC,rowid DESC', (user['id'],))]})
            if self.command == 'POST':
                if db.execute('SELECT COUNT(*) FROM projects WHERE owner=?', (user['id'],)).fetchone()[0] >= 500:
                    raise APIError(409, '当前账号最多保存 500 件作品')
                body, visibility = project_body(self.read_json())
                item_id, t = uid(), now()
                db.execute('INSERT INTO projects VALUES(?,?,?,?,?,?,?)', (item_id, user['id'], encode(body), visibility,
                           'pending' if visibility == 'public' else 'private', t, t))
                return self.response({'project': project_view(self.owned(db, 'projects', item_id, user))}, 201)
        if len(parts) in (2, 3):
            row = self.owned(db, 'projects', parts[1], user)
            if len(parts) == 3 and parts[2] == 'history' and self.command == 'GET':
                return self.response({'versions': [dict(id=x['id'], createdAt=x['created'], **json.loads(x['body'])) for x in db.execute(
                    'SELECT * FROM versions WHERE project_id=? ORDER BY created DESC,rowid DESC LIMIT 30', (row['id'],))]})
            if len(parts) == 2 and self.command == 'GET':
                return self.response({'project': project_view(row)})
            if len(parts) == 2 and self.command == 'PUT':
                body, visibility = project_body(self.read_json())
                db.execute('INSERT INTO versions VALUES(?,?,?,?)', (uid(), row['id'], row['body'], now()))
                db.execute('DELETE FROM versions WHERE project_id=? AND id NOT IN '
                           '(SELECT id FROM versions WHERE project_id=? ORDER BY created DESC,rowid DESC LIMIT 30)', (row['id'], row['id']))
                db.execute('UPDATE projects SET body=?,visibility=?,review=?,updated=? WHERE id=?',
                           (encode(body), visibility, 'pending' if visibility == 'public' else 'private', now(), row['id']))
                return self.response({'project': project_view(self.owned(db, 'projects', row['id'], user))})
            if len(parts) == 2 and self.command == 'DELETE':
                db.execute('DELETE FROM projects WHERE id=?', (row['id'],))
                return self.response({'ok': True, 'notice': '作品已删除；关联附件仍在资料库中'})
        raise APIError(404, '接口不存在')

    def post_view(self, db, row, viewer=None, public=False):
        author = db.execute('SELECT id,profile FROM users WHERE id=?', (row['owner'],)).fetchone()
        counts = dict(db.execute('SELECT kind,COUNT(*) FROM reactions WHERE post_id=? GROUP BY kind', (row['id'],)).fetchall())
        mine = [x[0] for x in db.execute('SELECT kind FROM reactions WHERE post_id=? AND user_id=?', (row['id'], viewer or ''))]
        project_id = row['project_id']
        if public and project_id:
            visible = db.execute("SELECT id FROM projects WHERE id=? AND visibility='public' AND review='approved'", (project_id,)).fetchone()
            if not visible:
                project_id = None
        return {'id': row['id'], 'body': row['body'], 'kind': row['kind'], 'projectId': project_id,
                'review': row['review'], 'createdAt': row['created'],
                'author': {'id': author['id'], 'name': json.loads(author['profile']).get('name', '创作者')},
                'likes': counts.get('like', 0), 'bookmarks': counts.get('bookmark', 0),
                'liked': 'like' in mine, 'bookmarked': 'bookmark' in mine}

    def posts(self, db, user, parts):
        if len(parts) == 1 and self.command == 'GET':
            return self.response({'posts': [self.post_view(db, x, user['id']) for x in db.execute(
                'SELECT * FROM posts WHERE owner=? ORDER BY created DESC,rowid DESC LIMIT 200', (user['id'],)).fetchall()]})
        if len(parts) == 1 and self.command == 'POST':
            data = self.read_json()
            body = text_field(data, 'body', 2000, required=True)
            kind = data.get('kind', 'update')
            if kind not in ('update', 'question', 'team'):
                raise APIError(400, '动态类型无效')
            project = data.get('projectId') or None
            if project:
                self.owned(db, 'projects', project, user)
            if db.execute('SELECT COUNT(*) FROM posts WHERE owner=?', (user['id'],)).fetchone()[0] >= 500:
                raise APIError(409, '当前账号最多保存 500 条动态')
            item_id = uid()
            db.execute('INSERT INTO posts VALUES(?,?,?,?,?,?,?)', (item_id, user['id'], body, kind, project, 'pending', now()))
            return self.response({'post': self.post_view(db, self.owned(db, 'posts', item_id, user), user['id'])}, 201)
        if len(parts) == 2 and self.command == 'DELETE':
            row = self.owned(db, 'posts', parts[1], user)
            db.execute('DELETE FROM posts WHERE id=?', (row['id'],))
            return self.response({'ok': True})
        if len(parts) == 3 and parts[2] in ('like', 'bookmark') and self.command == 'POST':
            row = db.execute("SELECT * FROM posts WHERE id=? AND review='approved'", (parts[1],)).fetchone()
            if not row:
                raise APIError(404, '公开动态不存在')
            active = self.read_json().get('active')
            if not isinstance(active, bool):
                raise APIError(400, 'active 必须为 true 或 false')
            if active:
                db.execute('INSERT OR IGNORE INTO reactions VALUES(?,?,?)', (user['id'], row['id'], parts[2]))
            else:
                db.execute('DELETE FROM reactions WHERE user_id=? AND post_id=? AND kind=?', (user['id'], row['id'], parts[2]))
            return self.response({'post': self.post_view(db, row, user['id'], public=True)})
        raise APIError(404, '接口不存在')

    def feed(self, db):
        viewer = self.current_user(db, False)
        projects = []
        for row in db.execute("SELECT * FROM projects WHERE visibility='public' AND review='approved' ORDER BY updated DESC LIMIT 100").fetchall():
            projects.append(self.public_project(db, row))
        posts = [self.post_view(db, x, viewer['id'] if viewer else None, public=True) for x in db.execute(
            "SELECT * FROM posts WHERE review='approved' ORDER BY created DESC LIMIT 100").fetchall()]
        return self.response({'projects': projects, 'posts': posts})

    def public_project(self, db, row):
        source = project_view(row)
        public = {k: source[k] for k in ('id', 'title', 'summary', 'tech', 'role', 'url', 'status', 'createdAt', 'updatedAt')}
        author = db.execute('SELECT id,profile FROM users WHERE id=?', (row['owner'],)).fetchone()
        public['author'] = {'id': author['id'], 'name': json.loads(author['profile']).get('name', '创作者')}
        public['notice'] = '作者自述；未代表主办方确认。私人笔记、比赛自述与附件不公开。'
        return public

    def public_profile(self, db, user_id):
        # A public page exists only after at least one project has been approved.
        rows = db.execute("SELECT * FROM projects WHERE owner=? AND visibility='public' AND review='approved' ORDER BY updated DESC", (user_id,)).fetchall()
        if not rows:
            raise APIError(404, '该创作者暂未公开作品')
        user = db.execute('SELECT profile FROM users WHERE id=?', (user_id,)).fetchone()
        # Bios/skills could contain private info or change after moderation. Name only in v1.
        return self.response({'profile': {'id': user_id, 'name': json.loads(user['profile']).get('name', '创作者')},
                              'projects': [self.public_project(db, x) for x in rows]})

    def file_view(self, row):
        return {'id': row['id'], 'name': row['name'], 'size': row['size'], 'category': row['category'],
                'projectId': row['project_id'], 'createdAt': row['created'],
                'downloadUrl': COOKIE_PATH + 'api/files/' + row['id'] + '/download'}

    def files(self, db, user, parts):
        if len(parts) == 1 and self.command == 'GET':
            return self.response({'files': [self.file_view(x) for x in db.execute(
                'SELECT * FROM files WHERE owner=? ORDER BY created DESC,rowid DESC', (user['id'],))]})
        if len(parts) == 1 and self.command == 'POST':
            data = self.read_json(FILE_LIMIT * 4 // 3 + 10000)
            name = text_field(data, 'name', 180, required=True)
            if '/' in name or '\\' in name or name.startswith('.'):
                raise APIError(400, '文件名不能包含路径')
            category = text_field(data, 'category', 50) or '作品资料'
            project = data.get('projectId') or None
            if project:
                self.owned(db, 'projects', project, user)
            try:
                content = base64.b64decode(data.get('content', ''), validate=True)
            except Exception:
                raise APIError(400, '文件数据无效')
            if not 0 < len(content) <= FILE_LIMIT:
                raise APIError(413, '单个文件最多 10MB，且不能是空文件')
            suffix = Path(name).suffix.lower()
            valid = ((suffix == '.pdf' and content.startswith(b'%PDF-')) or
                     (suffix == '.png' and content.startswith(b'\x89PNG\r\n\x1a\n')) or
                     (suffix in ('.jpg', '.jpeg') and content.startswith(b'\xff\xd8\xff')) or
                     (suffix == '.webp' and content[:4] == b'RIFF' and content[8:12] == b'WEBP'))
            if suffix in ('.txt', '.md'):
                try:
                    content.decode('utf-8')
                    valid = b'\x00' not in content
                except UnicodeDecodeError:
                    pass
            if not valid:
                raise APIError(400, '只支持真实的 JPG、PNG、WebP、PDF、UTF-8 TXT 或 Markdown 文件')
            item_id = uid()
            with UPLOAD_LOCK:
                # BEGIN IMMEDIATE serializes quota checks across worker processes too.
                db.execute('BEGIN IMMEDIATE')
                used = db.execute('SELECT COALESCE(SUM(size),0) FROM files WHERE owner=?', (user['id'],)).fetchone()[0]
                if used + len(content) > QUOTA:
                    raise APIError(413, '存储空间不足，请先下载备份并清理文件')
                if db.execute('SELECT COUNT(*) FROM files WHERE owner=?', (user['id'],)).fetchone()[0] >= 1000:
                    raise APIError(409, '当前账号最多保存 1000 个附件')
                total = db.execute('SELECT COALESCE(SUM(size),0) FROM files').fetchone()[0]
                if total + len(content) > TOTAL_QUOTA or shutil.disk_usage(ROOT).free < len(content) + 256 * 1024 * 1024:
                    raise APIError(503, '服务器存储空间暂时不足，请稍后上传或联系管理员')
                target = ROOT / 'files' / item_id
                try:
                    with target.open('xb') as f:
                        f.write(content)
                    if os.name != 'nt':
                        os.chmod(target, 0o600)
                    db.execute('INSERT INTO files VALUES(?,?,?,?,?,?,?)', (item_id, user['id'], name, len(content), category, project, now()))
                    db.commit()
                except Exception:
                    target.unlink(missing_ok=True)
                    raise
            return self.response({'file': self.file_view(self.owned(db, 'files', item_id, user))}, 201)
        if len(parts) in (2, 3):
            row = self.owned(db, 'files', parts[1], user)
            if len(parts) == 3 and parts[2] == 'download' and self.command == 'GET':
                target = ROOT / 'files' / row['id']
                if not target.is_file():
                    raise APIError(404, '附件暂时不可用，请联系管理员恢复备份')
                self.send_response(200)
                self.send_header('Content-Type', 'application/octet-stream')
                self.send_header('Content-Length', str(row['size']))
                self.send_header('Content-Disposition', "attachment; filename=archive-file; filename*=UTF-8''" + quote(row['name']))
                self.send_header('Cache-Control', 'private, no-store')
                self.send_header('X-Content-Type-Options', 'nosniff')
                self.send_header('Content-Security-Policy', "default-src 'none'; sandbox")
                self.end_headers()
                with target.open('rb') as f:
                    while True:
                        block = f.read(65536)
                        if not block:
                            break
                        self.wfile.write(block)
                return
            if len(parts) == 2 and self.command == 'DELETE':
                db.execute('DELETE FROM files WHERE id=?', (row['id'],))
                db.commit()
                (ROOT / 'files' / row['id']).unlink(missing_ok=True)
                return self.response({'ok': True, 'notice': '附件已永久删除，当前版本没有回收站'})
        raise APIError(404, '接口不存在')

    def handle_api(self):
        try:
            self.dispatch()
        except APIError as exc:
            self.response({'error': exc.message}, exc.status)
        except (ConnectionError, TimeoutError):
            pass
        except Exception as exc:
            print('API error: ' + type(exc).__name__, flush=True)
            try:
                self.response({'error': '服务器暂时无法完成操作，请稍后重试'}, 500)
            except ConnectionError:
                pass
        finally:
            if getattr(self, 'holds_large_body_slot', False):
                self.holds_large_body_slot = False
                LARGE_BODY_SLOTS.release()

    do_GET = handle_api
    do_POST = handle_api
    do_PUT = handle_api
    do_DELETE = handle_api

    def do_OPTIONS(self):
        self.response({'error': '不允许跨站请求'}, 403)


class BoundedServer(ThreadingHTTPServer):
    """Bound slow clients and in-memory base64 uploads on the small shared host."""
    daemon_threads = True

    def __init__(self, *args, **kwargs):
        self.slots = threading.BoundedSemaphore(12)
        super().__init__(*args, **kwargs)

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=int(os.environ.get('ARCHIVE_PORT', '8789')))
    args = parser.parse_args()
    if os.name != 'nt':
        os.umask(0o077)
    initialize()
    server = BoundedServer(('127.0.0.1', args.port), Handler)
    print('Archive API listening on loopback port %d' % args.port, flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
