#!/usr/bin/env python3
"""AI youth archive API. Python 3.9+, standard library only; loopback behind HTTPS."""
import argparse
import base64
import hashlib
import hmac
import json
import math
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
from urllib.parse import parse_qs, quote, urlparse
import community_comments

ROOT = Path(os.environ.get('ARCHIVE_DATA_DIR', '/var/lib/ai-youth-archive')).resolve()
DB = ROOT / 'archive.sqlite3'
FILE_LIMIT = 10 * 1024 * 1024
QUOTA = int(os.environ.get('ARCHIVE_QUOTA_BYTES', 100 * 1024 * 1024))
TOTAL_QUOTA = int(os.environ.get('ARCHIVE_TOTAL_QUOTA_BYTES', 2 * 1024 * 1024 * 1024))
MAX_ACCOUNTS = int(os.environ.get('ARCHIVE_MAX_ACCOUNTS', 200))
CHAT_MESSAGE_LIMIT = 2000
CHAT_PAGE_SIZE = 60
CHAT_LIMIT = 200
CHAT_HISTORY_LIMIT = 10000
WORKSPACE_BODY_LIMIT = 4 * 1024 * 1024
WORKSPACE_COVER_LIMIT = 512 * 1024
WORKSPACE_TYPES = ('message', 'note', 'file', 'link', 'mixed', 'event', 'project')
WORKSPACE_ITEM_KINDS = ('note', 'message', 'link', 'file', 'project', 'event')
WORKSPACE_COLORS = ('mint', 'lime', 'sky', 'violet', 'pink', 'sand', 'white')
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
          CREATE TABLE IF NOT EXISTS chats (
            id TEXT PRIMARY KEY,
            user_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            user_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            initiator TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','accepted')),
            created INTEGER NOT NULL, updated INTEGER NOT NULL,
            UNIQUE(user_a,user_b), CHECK(user_a < user_b));
          CREATE TABLE IF NOT EXISTS chat_members (
            chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            read_seq INTEGER NOT NULL DEFAULT 0,
            blocked INTEGER NOT NULL DEFAULT 0 CHECK(blocked IN (0,1)),
            PRIMARY KEY(chat_id,user_id));
          CREATE TABLE IF NOT EXISTS chat_messages (
            id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
            seq INTEGER NOT NULL, sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            body TEXT NOT NULL, created INTEGER NOT NULL,
            UNIQUE(chat_id,seq));
          CREATE TABLE IF NOT EXISTS archive_workspaces (
            owner TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            body TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0),
            updated INTEGER NOT NULL);
          CREATE INDEX IF NOT EXISTS projects_owner ON projects(owner);
          CREATE INDEX IF NOT EXISTS files_owner ON files(owner);
          CREATE INDEX IF NOT EXISTS posts_owner ON posts(owner);
          CREATE INDEX IF NOT EXISTS chats_a ON chats(user_a,updated);
          CREATE INDEX IF NOT EXISTS chats_b ON chats(user_b,updated);
          CREATE INDEX IF NOT EXISTS chats_initiated ON chats(initiator,created);
          CREATE INDEX IF NOT EXISTS chat_messages_sender ON chat_messages(sender_id,created);
        ''')
        community_comments.initialize_comments(db)
        initialize_notifications(db)
    if os.name != 'nt':
        os.chmod(DB, 0o600)


def now():
    return int(time.time())


def uid():
    return secrets.token_hex(16)


def initialize_notifications(db):
    """New activity only: migration never backfills historical reactions/replies.

    Triggers keep activity creation atomic with the original write and also work
    for operator reviews. A source key survives unlikes/reviews so repeatedly
    toggling the same action does not reset an already-read notice.
    """
    db.executescript('''
      CREATE TABLE IF NOT EXISTS activity_notifications (
        id TEXT PRIMARY KEY,
        recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        comment_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('like','reply')),
        source_key TEXT NOT NULL UNIQUE,
        created INTEGER NOT NULL,
        read_at INTEGER,
        CHECK(recipient_id != actor_id),
        CHECK((kind='like' AND comment_id IS NULL) OR (kind='reply' AND comment_id IS NOT NULL)));
      CREATE INDEX IF NOT EXISTS activity_recipient ON activity_notifications(recipient_id,created);
      CREATE TRIGGER IF NOT EXISTS activity_post_like
      AFTER INSERT ON reactions WHEN NEW.kind='like'
      BEGIN
        INSERT OR IGNORE INTO activity_notifications
          (id,recipient_id,actor_id,post_id,comment_id,kind,source_key,created)
        SELECT lower(hex(randomblob(16))),p.owner,NEW.user_id,p.id,NULL,'like',
               'like:' || p.id || ':' || NEW.user_id,CAST(strftime('%s','now') AS INTEGER)
          FROM posts p WHERE p.id=NEW.post_id AND p.review='approved' AND p.owner!=NEW.user_id;
      END;
      CREATE TRIGGER IF NOT EXISTS activity_reply_review
      AFTER UPDATE OF review ON comments WHEN NEW.review='approved' AND OLD.review!='approved'
      BEGIN
        INSERT OR IGNORE INTO activity_notifications
          (id,recipient_id,actor_id,post_id,comment_id,kind,source_key,created)
        SELECT lower(hex(randomblob(16))),p.owner,NEW.owner,p.id,NEW.id,'reply',
               'reply:' || NEW.id,CAST(strftime('%s','now') AS INTEGER)
          FROM posts p WHERE p.id=NEW.post_id AND p.review='approved' AND p.owner!=NEW.owner;
      END;
    ''')


# Never show withdrawn likes, deleted/rejected replies, or hidden parent posts.
# Only a public nickname is projected for the actor, never their login/profile.
NOTIFICATION_SOURCE = '''
  FROM activity_notifications n
  JOIN posts p ON p.id=n.post_id AND p.owner=n.recipient_id AND p.review='approved'
  JOIN users actor ON actor.id=n.actor_id
  LEFT JOIN comments c ON c.id=n.comment_id
  WHERE n.recipient_id=? AND (
    (n.kind='like' AND EXISTS(SELECT 1 FROM reactions r
      WHERE r.post_id=n.post_id AND r.user_id=n.actor_id AND r.kind='like'))
    OR (n.kind='reply' AND c.review='approved' AND c.post_id=n.post_id AND c.owner=n.actor_id))
'''


def unread_notifications(db, user_id):
    return db.execute('SELECT COUNT(*) ' + NOTIFICATION_SOURCE + ' AND n.read_at IS NULL',
                      (user_id,)).fetchone()[0]


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


def empty_workspace():
    return {'version': 1, 'folders': [], 'selected': None, 'canvasHeight': 540}


def workspace_ref_exists(db, user_id, kind, ref_id):
    # The table name only comes from this closed mapping, never user input.
    table = {'file': 'files', 'project': 'projects'}.get(kind)
    if not table or not isinstance(ref_id, str) or not re.fullmatch('[a-f0-9]{32}', ref_id):
        return False
    row = db.execute('SELECT id FROM ' + table + ' WHERE id=? AND owner=?', (ref_id, user_id)).fetchone()
    return bool(row) and (kind != 'file' or (ROOT / 'files' / ref_id).is_file())


def workspace_view(db, user_id):
    row = db.execute('SELECT * FROM archive_workspaces WHERE owner=?', (user_id,)).fetchone()
    result = {'workspace': json.loads(row['body']) if row else empty_workspace(),
              'revision': row['revision'] if row else 0, 'updatedAt': row['updated'] if row else None}
    # Removing a referenced attachment never removes the user's own written note.
    # A missing item cannot remain selected for sharing, and no foreign metadata is joined.
    for folder in result['workspace']['folders']:
        # Previous saved workspaces had no color. Read them without changing their revision.
        folder.setdefault('color', 'mint')
        for item in folder['items']:
            if item.get('kind') in ('file', 'project'):
                item['unavailable'] = not workspace_ref_exists(db, user_id, item['kind'], item['refId'])
                if item['unavailable'] or item['kind'] == 'file':
                    item['public'] = False
    return result


def workspace_cover(value):
    if value is None or value == 'sample':
        return value
    if not isinstance(value, str) or len(value) > WORKSPACE_COVER_LIMIT * 4 // 3 + 100:
        raise APIError(413, '每张文件夹封面最多 512KB')
    match = re.fullmatch(r'data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/]*={0,2})', value)
    if not match:
        raise APIError(400, '封面只支持 PNG、JPG 或 WebP 图片')
    try:
        content = base64.b64decode(match.group(2), validate=True)
    except ValueError:
        raise APIError(400, '封面图片数据无效')
    if not 0 < len(content) <= WORKSPACE_COVER_LIMIT:
        raise APIError(413, '每张文件夹封面最多 512KB，且不能是空图片')
    valid = ((match.group(1) == 'png' and content.startswith(b'\x89PNG\r\n\x1a\n')) or
             (match.group(1) == 'jpeg' and content.startswith(b'\xff\xd8\xff')) or
             (match.group(1) == 'webp' and content[:4] == b'RIFF' and content[8:12] == b'WEBP'))
    if not valid:
        raise APIError(400, '封面内容与图片类型不一致')
    return value


def workspace_body(db, user_id, data, previous):
    if not isinstance(data, dict) or type(data.get('version')) is not int or data['version'] != 1:
        raise APIError(400, '档案馆版本无效，请更新页面')
    folders = data.get('folders')
    if not isinstance(folders, list) or len(folders) > 40:
        raise APIError(400, '档案馆最多保存 40 个文件夹')
    old_refs = {(folder['id'], item.get('kind'), item.get('refId'))
                for folder in previous['folders'] for item in folder['items']
                if item.get('kind') in ('file', 'project')}
    result, folder_ids = [], set()
    for folder in folders:
        if not isinstance(folder, dict):
            raise APIError(400, '文件夹内容无效')
        folder_id = folder.get('id')
        if not isinstance(folder_id, str) or not re.fullmatch('[a-zA-Z0-9_-]{1,40}', folder_id) or folder_id in folder_ids:
            raise APIError(400, '文件夹编号无效或重复')
        folder_ids.add(folder_id)
        folder_type = folder.get('type')
        if folder_type not in WORKSPACE_TYPES:
            raise APIError(400, '请选择文件夹保存类型')
        color = folder.get('color', 'mint')
        if not isinstance(color, str) or color not in WORKSPACE_COLORS:
            raise APIError(400, '请选择提供的文件夹颜色')
        coordinates = {}
        for axis in ('x', 'y'):
            coordinate = folder.get(axis)
            if type(coordinate) not in (int, float) or not 0 <= coordinate <= 1 or not math.isfinite(coordinate):
                raise APIError(400, '文件夹位置无效')
            coordinates[axis] = coordinate
        items = folder.get('items')
        if not isinstance(items, list) or len(items) > 60:
            raise APIError(400, '每个文件夹最多保存 60 条内容')
        clean_items = []
        for item in items:
            if not isinstance(item, dict):
                raise APIError(400, '文件夹内的内容无效')
            kind, ref_id = item.get('kind', 'note'), item.get('refId', '')
            if kind not in WORKSPACE_ITEM_KINDS or not isinstance(ref_id, str):
                raise APIError(400, '档案内容类型或引用无效')
            clean = {'text': text_field(item, 'text', 4000, required=True),
                     'source': text_field(item, 'source', 300), 'kind': kind, 'refId': ref_id}
            for flag in ('public', 'picture'):
                value = item.get(flag, False)
                if type(value) is not bool:
                    raise APIError(400, '公开预览和图片选项必须是勾选状态')
                clean[flag] = value
            if kind in ('file', 'project'):
                valid_ref = workspace_ref_exists(db, user_id, kind, ref_id)
                if not valid_ref and (folder_id, kind, ref_id) not in old_refs:
                    raise APIError(404, '关联资料不存在或无权访问')
                if not valid_ref or kind == 'file':
                    clean['public'] = False
            elif ref_id:
                raise APIError(400, '此类内容不能带附件或作品编号')
            clean_items.append(clean)
        result.append({'id': folder_id, 'name': text_field(folder, 'name', 60, required=True),
                       'type': folder_type, 'purpose': text_field(folder, 'purpose', 1000),
                       'color': color,
                       'cover': workspace_cover(folder.get('cover')), **coordinates, 'items': clean_items})
    selected = data.get('selected')
    if selected is not None and (not isinstance(selected, str) or selected not in folder_ids):
        raise APIError(400, '选中的文件夹不存在')
    height = data.get('canvasHeight', 540)
    if type(height) not in (int, float) or not 540 <= height <= 12000 or not math.isfinite(height):
        raise APIError(400, '档案画布高度无效')
    return {'version': 1, 'folders': result, 'selected': selected, 'canvasHeight': height}


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
            if parts[0] == 'comments':
                return community_comments.dispatch_comments(self, db, parts, APIError, text_field, now, uid)
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
            if parts[0] == 'chats':
                return self.chats(db, user, parts)
            if parts[0] == 'notifications':
                return self.notifications(db, user, parts)
            if parts == ['archive-workspace']:
                return self.archive_workspace(db, user)
            if parts == ['export'] and method == 'GET':
                return self.response({'exportedAt': now(), 'profile': json.loads(user['profile']),
                    'projects': [project_view(x) for x in db.execute('SELECT * FROM projects WHERE owner=?', (user['id'],))],
                    'versions': [dict(x) for x in db.execute('SELECT versions.* FROM versions JOIN projects ON projects.id=versions.project_id WHERE projects.owner=?', (user['id'],))],
                    'posts': [dict(x) for x in db.execute('SELECT id,body,kind,project_id,review,created FROM posts WHERE owner=?', (user['id'],))],
                    'comments': [dict(x) for x in db.execute('SELECT * FROM comments WHERE owner=?', (user['id'],))],
                    'files': [self.file_view(x) for x in db.execute('SELECT * FROM files WHERE owner=?', (user['id'],))],
                    'archiveWorkspace': workspace_view(db, user['id']),
                    'chats': [dict(self.chat_view(db, x, user['id']), messages=self.chat_messages(db, x['id']))
                              for x in db.execute('SELECT * FROM chats WHERE user_a=? OR user_b=? ORDER BY updated DESC,id',
                                                  (user['id'], user['id'])).fetchall()],
                    'notice': '此文件包含私人文字资料、本人对话及附件清单。请妥善保管；附件内容请从资料库分别下载。'})
            raise APIError(404, '接口不存在')

    def archive_workspace(self, db, user):
        if self.command == 'GET':
            return self.response(workspace_view(db, user['id']))
        if self.command != 'PUT':
            raise APIError(405, '档案馆只支持读取和保存')
        data = self.read_json(WORKSPACE_BODY_LIMIT)
        revision = data.get('revision')
        if type(revision) is not int or not 0 <= revision < 9007199254740991:
            raise APIError(400, '保存版本无效，请重新打开档案馆')
        # Serialize both revision checking and the write. Two tabs must not silently
        # overwrite each other, including their first save before a row exists.
        db.execute('BEGIN IMMEDIATE')
        previous = db.execute('SELECT * FROM archive_workspaces WHERE owner=?', (user['id'],)).fetchone()
        if revision != (previous['revision'] if previous else 0):
            raise APIError(409, '档案馆已在其他页面更新，请重新加载后再保存；本次修改没有覆盖旧记录')
        body = workspace_body(db, user['id'], data.get('workspace'),
                              json.loads(previous['body']) if previous else empty_workspace())
        encoded = encode(body)
        if len(encoded.encode('utf-8')) > WORKSPACE_BODY_LIMIT:
            raise APIError(413, '档案馆文字和封面合计最多 4MB，请减少封面大小或下载整理')
        if shutil.disk_usage(ROOT).free < 256 * 1024 * 1024 + len(encoded.encode('utf-8')):
            raise APIError(503, '服务器存储空间暂时不足，请稍后保存或联系管理员')
        db.execute('INSERT INTO archive_workspaces(owner,body,revision,updated) VALUES(?,?,?,?) '
                   'ON CONFLICT(owner) DO UPDATE SET body=excluded.body,revision=excluded.revision,updated=excluded.updated',
                   (user['id'], encoded, revision + 1, now()))
        return self.response(workspace_view(db, user['id']))

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

    def public_contact(self, db, user_id):
        # A search or invitation never reveals a private account or login identifier.
        if not isinstance(user_id, str) or not re.fullmatch('[a-f0-9]{32}', user_id):
            return None
        return db.execute("SELECT id,profile FROM users u WHERE id=? AND ("
                          "EXISTS(SELECT 1 FROM projects p WHERE p.owner=u.id AND p.visibility='public' AND p.review='approved') "
                          "OR EXISTS(SELECT 1 FROM posts p WHERE p.owner=u.id AND p.review='approved'))", (user_id,)).fetchone()

    def owned_chat(self, db, chat_id, user_id):
        if not isinstance(chat_id, str) or not re.fullmatch('[a-f0-9]{32}', chat_id):
            raise APIError(404, '对话不存在或无权访问')
        row = db.execute('SELECT * FROM chats WHERE id=? AND (user_a=? OR user_b=?)',
                         (chat_id, user_id, user_id)).fetchone()
        if not row:
            raise APIError(404, '对话不存在或无权访问')
        return row

    def chat_view(self, db, row, user_id):
        peer_id = row['user_b'] if row['user_a'] == user_id else row['user_a']
        peer = db.execute('SELECT id,profile FROM users WHERE id=?', (peer_id,)).fetchone()
        members = {x['user_id']: x for x in db.execute('SELECT * FROM chat_members WHERE chat_id=?', (row['id'],))}
        latest = db.execute('SELECT body FROM chat_messages WHERE chat_id=? ORDER BY seq DESC LIMIT 1', (row['id'],)).fetchone()
        unread = db.execute('SELECT COUNT(*) FROM chat_messages WHERE chat_id=? AND sender_id!=? AND seq>?',
                            (row['id'], user_id, members[user_id]['read_seq'])).fetchone()[0]
        return {'id': row['id'], 'peer': {'id': peer_id, 'name': json.loads(peer['profile']).get('name', '创作者')},
                'preview': latest['body'][:120] if latest else '', 'updatedAt': row['updated'], 'unread': unread,
                'state': row['state'], 'incoming': row['initiator'] != user_id,
                'blockedByMe': bool(members[user_id]['blocked']), 'blockedByPeer': bool(members[peer_id]['blocked'])}

    def chat_messages(self, db, chat_id):
        return [{'id': x['id'], 'seq': x['seq'], 'senderId': x['sender_id'], 'body': x['body'], 'createdAt': x['created']}
                for x in db.execute('SELECT * FROM chat_messages WHERE chat_id=? ORDER BY seq', (chat_id,))]

    def chat_page(self, db, row, user_id):
        query = parse_qs(urlparse(self.path).query, keep_blank_values=True)
        before = query.get('before', [None])
        if len(before) != 1 or (before[0] is not None and not re.fullmatch('[1-9][0-9]{0,9}', before[0])):
            raise APIError(400, '消息分页位置无效')
        limit = int(before[0]) if before[0] is not None else 2147483647
        rows = db.execute('SELECT * FROM chat_messages WHERE chat_id=? AND seq<? ORDER BY seq DESC LIMIT ?',
                          (row['id'], limit, CHAT_PAGE_SIZE)).fetchall()
        rows.reverse()
        messages = [{'id': x['id'], 'seq': x['seq'], 'senderId': x['sender_id'], 'body': x['body'], 'createdAt': x['created']}
                    for x in rows]
        older = rows[0]['seq'] if rows and db.execute('SELECT 1 FROM chat_messages WHERE chat_id=? AND seq<? LIMIT 1',
                                                    (row['id'], rows[0]['seq'])).fetchone() else None
        return {'chat': self.chat_view(db, row, user_id), 'messages': messages, 'olderCursor': older}

    def chat_body(self, data):
        body = text_field(data, 'body', CHAT_MESSAGE_LIMIT, required=True)
        if not body.strip():
            raise APIError(400, '消息不能为空')
        return body

    def chat_can_send(self, db, row):
        if db.execute('SELECT 1 FROM chat_members WHERE chat_id=? AND blocked=1 LIMIT 1', (row['id'],)).fetchone():
            raise APIError(403, '这段对话已被屏蔽，无法发送消息')
        if row['state'] != 'accepted':
            raise APIError(409, '邀请尚未接受，请等待对方确认')

    def chat_send_limit(self, db, user_id):
        self.rate_limit('chat-send', 30, 60, 'chat-user:' + user_id)
        # These counts persist across service restarts and source address changes.
        for seconds, cap in ((60, 30), (3600, 500)):
            count = db.execute('SELECT COUNT(*) FROM chat_messages WHERE sender_id=? AND created>?',
                               (user_id, now() - seconds)).fetchone()[0]
            if count >= cap:
                raise APIError(429, '消息发送过于频繁，请稍后再试')

    def chat_insert_message(self, db, row, user_id, body):
        seq = db.execute('SELECT COALESCE(MAX(seq),0)+1 FROM chat_messages WHERE chat_id=?', (row['id'],)).fetchone()[0]
        if seq > CHAT_HISTORY_LIMIT:
            raise APIError(409, '这段对话已达到 10000 条消息上限，请先导出保存记录')
        message_id, created = uid(), now()
        db.execute('INSERT INTO chat_messages VALUES(?,?,?,?,?,?)', (message_id, row['id'], seq, user_id, body, created))
        db.execute('UPDATE chats SET updated=? WHERE id=?', (created, row['id']))
        return {'id': message_id, 'seq': seq, 'senderId': user_id, 'body': body, 'createdAt': created}

    def chats(self, db, user, parts):
        user_id = user['id']
        if parts == ['chats', 'contacts'] and self.command == 'GET':
            self.rate_limit('chat-search', 60, 60, 'chat-user:' + user_id)
            query = parse_qs(urlparse(self.path).query, keep_blank_values=True).get('q', [''])
            if len(query) != 1 or len(query[0]) > 60:
                raise APIError(400, '搜索文字最多 60 字')
            term = query[0].strip().casefold()
            rows = db.execute("SELECT id,profile FROM users u WHERE id!=? AND ("
                              "EXISTS(SELECT 1 FROM projects p WHERE p.owner=u.id AND p.visibility='public' AND p.review='approved') "
                              "OR EXISTS(SELECT 1 FROM posts p WHERE p.owner=u.id AND p.review='approved')) ORDER BY created DESC,id",
                              (user_id,)).fetchall()
            users = []
            for row in rows:
                name = json.loads(row['profile']).get('name', '创作者')
                if not term or term in name.casefold():
                    users.append({'id': row['id'], 'name': name})
                    if len(users) == 30:
                        break
            return self.response({'users': users})
        if len(parts) == 1 and self.command == 'GET':
            rows = db.execute('SELECT * FROM chats WHERE user_a=? OR user_b=? ORDER BY updated DESC,id LIMIT ?',
                              (user_id, user_id, CHAT_LIMIT)).fetchall()
            chats = [self.chat_view(db, x, user_id) for x in rows]
            return self.response({'chats': chats, 'unreadTotal': sum(x['unread'] for x in chats)})
        if len(parts) == 1 and self.command == 'POST':
            data = self.read_json(20000)
            recipient = data.get('recipientId')
            body = self.chat_body(data)
            if recipient == user_id:
                raise APIError(400, '不能给自己发送对话邀请')
            if not isinstance(recipient, str) or not re.fullmatch('[a-f0-9]{32}', recipient):
                raise APIError(404, '该创作者暂不可联系')
            pair = sorted((user_id, recipient))
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM chats WHERE user_a=? AND user_b=?', pair).fetchone()
            if row:
                # A retry opens the original conversation without resending its invitation.
                return self.response(self.chat_page(db, row, user_id))
            if not self.public_contact(db, recipient):
                raise APIError(404, '该创作者暂不可联系')
            for member in pair:
                if db.execute('SELECT COUNT(*) FROM chats WHERE user_a=? OR user_b=?', (member, member)).fetchone()[0] >= CHAT_LIMIT:
                    raise APIError(409, '当前对话数量已达到上限，暂时无法发起新对话')
            self.rate_limit('chat-invite', 5, 3600, 'chat-user:' + user_id)
            for seconds, cap in ((3600, 5), (86400, 20)):
                if db.execute('SELECT COUNT(*) FROM chats WHERE initiator=? AND created>?',
                              (user_id, now() - seconds)).fetchone()[0] >= cap:
                    raise APIError(429, '对话邀请过于频繁，请稍后再试')
            self.chat_send_limit(db, user_id)
            chat_id, created = uid(), now()
            db.execute('INSERT INTO chats VALUES(?,?,?,?,?,?,?)', (chat_id, pair[0], pair[1], user_id, 'pending', created, created))
            for member in pair:
                db.execute('INSERT INTO chat_members(chat_id,user_id) VALUES(?,?)', (chat_id, member))
            row = self.owned_chat(db, chat_id, user_id)
            self.chat_insert_message(db, row, user_id, body)
            return self.response(self.chat_page(db, self.owned_chat(db, chat_id, user_id), user_id), 201)
        if len(parts) == 2 and self.command == 'GET':
            return self.response(self.chat_page(db, self.owned_chat(db, parts[1], user_id), user_id))
        if len(parts) == 3 and self.command == 'POST' and parts[2] in ('messages', 'accept', 'read', 'block'):
            data = self.read_json(20000)
            db.execute('BEGIN IMMEDIATE')
            row = self.owned_chat(db, parts[1], user_id)
            action = parts[2]
            if action == 'messages':
                body = self.chat_body(data)
                self.chat_can_send(db, row)
                self.chat_send_limit(db, user_id)
                message = self.chat_insert_message(db, row, user_id, body)
                return self.response({'chat': self.chat_view(db, self.owned_chat(db, row['id'], user_id), user_id), 'message': message}, 201)
            if action == 'accept':
                if row['initiator'] == user_id:
                    raise APIError(403, '只有收到邀请的人可以接受')
                if db.execute('SELECT 1 FROM chat_members WHERE chat_id=? AND blocked=1 LIMIT 1', (row['id'],)).fetchone():
                    raise APIError(403, '这段对话已被屏蔽，无法接受邀请')
                db.execute("UPDATE chats SET state='accepted',updated=? WHERE id=?", (now(), row['id']))
            if action in ('read', 'accept'):
                seq = db.execute('SELECT COALESCE(MAX(seq),0) FROM chat_messages WHERE chat_id=?', (row['id'],)).fetchone()[0]
                db.execute('UPDATE chat_members SET read_seq=? WHERE chat_id=? AND user_id=?', (seq, row['id'], user_id))
            if action == 'block':
                blocked = data.get('blocked')
                if not isinstance(blocked, bool):
                    raise APIError(400, 'blocked 必须为 true 或 false')
                db.execute('UPDATE chat_members SET blocked=? WHERE chat_id=? AND user_id=?', (int(blocked), row['id'], user_id))
            return self.response({'chat': self.chat_view(db, self.owned_chat(db, row['id'], user_id), user_id)})
        raise APIError(404, '接口不存在')

    def notifications(self, db, user, parts):
        user_id = user['id']
        if parts == ['notifications'] and self.command == 'GET':
            rows = db.execute('SELECT n.*,p.body AS post_body,c.body AS comment_body,actor.profile AS actor_profile ' +
                              NOTIFICATION_SOURCE + ' ORDER BY n.created DESC,n.rowid DESC LIMIT 200', (user_id,)).fetchall()
            items = []
            for row in rows:
                item = {'id': row['id'], 'kind': row['kind'],
                        'actor': {'id': row['actor_id'], 'name': json.loads(row['actor_profile']).get('name', '创作者')},
                        'targetKind': 'post', 'targetId': row['post_id'], 'title': row['post_body'].strip()[:80],
                        'createdAt': row['created'], 'read': row['read_at'] is not None}
                if row['kind'] == 'reply':
                    item.update(body=row['comment_body'][:240], commentId=row['comment_id'])
                items.append(item)
            return self.response({'notifications': items, 'unreadTotal': unread_notifications(db, user_id)})
        if parts == ['notifications', 'read'] and self.command == 'POST':
            data = self.read_json(20000)
            visible = 'SELECT n.id ' + NOTIFICATION_SOURCE
            values = [now(), user_id]
            if set(data) == {'all'} and data['all'] is True:
                pass
            elif set(data) == {'ids'} and isinstance(data['ids'], list) and 0 < len(data['ids']) <= 200 and all(
                    isinstance(item, str) and re.fullmatch('[a-f0-9]{32}', item) for item in data['ids']):
                ids = list(dict.fromkeys(data['ids']))
                visible += ' AND n.id IN (' + ','.join('?' for _ in ids) + ')'
                values.extend(ids)
            else:
                raise APIError(400, '请选择全部已读，或提供最多 200 条消息编号')
            db.execute('UPDATE activity_notifications SET read_at=? WHERE read_at IS NULL AND id IN (' + visible + ')', values)
            return self.response({'ok': True, 'unreadTotal': unread_notifications(db, user_id)})
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
                'comments': db.execute("SELECT COUNT(*) FROM comments WHERE post_id=? AND review='approved'", (row['id'],)).fetchone()[0],
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
        # An approved post also gives its author a public page. No private fields
        # or pending posts are projected into this page.
        viewer = self.current_user(db, False)
        rows = db.execute("SELECT * FROM projects WHERE owner=? AND visibility='public' AND review='approved' ORDER BY updated DESC", (user_id,)).fetchall()
        posts = db.execute("SELECT * FROM posts WHERE owner=? AND review='approved' ORDER BY created DESC LIMIT 100", (user_id,)).fetchall()
        if not rows and not posts:
            raise APIError(404, '该创作者暂未公开作品或帖子')
        user = db.execute('SELECT profile FROM users WHERE id=?', (user_id,)).fetchone()
        # Bios/skills could contain private info or change after moderation. Name only in v1.
        return self.response({'profile': {'id': user_id, 'name': json.loads(user['profile']).get('name', '创作者')},
                              'projects': [self.public_project(db, x) for x in rows],
                              'posts': [self.post_view(db, x, viewer['id'] if viewer else None, public=True) for x in posts]})

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
