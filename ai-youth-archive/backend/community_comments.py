"""Reviewed plain-text replies to public posts; no private profile fields exposed."""
import json
import re
from urllib.parse import parse_qs, urlparse


def initialize_comments(db):
    db.executescript('''
      CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,
        post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        review TEXT NOT NULL DEFAULT 'pending' CHECK(review IN ('pending','approved','rejected')),
        created INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS comments_post ON comments(post_id,created);
      CREATE INDEX IF NOT EXISTS comments_owner ON comments(owner,created);
    ''')


def comment_view(db, row):
    author = db.execute('SELECT id,profile FROM users WHERE id=?', (row['owner'],)).fetchone()
    return {'id': row['id'], 'postId': row['post_id'], 'body': row['body'],
            'review': row['review'], 'createdAt': row['created'],
            'author': {'id': author['id'], 'name': json.loads(author['profile']).get('name', '创作者')}}


def dispatch_comments(handler, db, parts, APIError, text_field, now, uid):
    """Called before the server's default authenticated route dispatch.

    The server applies the normal origin/client-header checks to mutations.
    Public reads may be anonymous; pending/rejected replies are owner-only.
    """
    method = handler.command
    user = handler.current_user(db, required=method != 'GET')
    viewer = user['id'] if user else None

    def valid_id(value):
        return isinstance(value, str) and re.fullmatch('[a-f0-9]{32}', value)

    def public_post(post_id):
        if not valid_id(post_id):
            raise APIError(404, '公开帖子不存在')
        row = db.execute("SELECT * FROM posts WHERE id=? AND review='approved'", (post_id,)).fetchone()
        if not row:
            raise APIError(404, '公开帖子不存在')
        return row

    if parts == ['comments', 'mine'] and method == 'GET':
        if not user:
            raise APIError(401, '请先登录，再查看自己的回复')
        rows = db.execute('SELECT * FROM comments WHERE owner=? ORDER BY created DESC,rowid DESC LIMIT 200',
                          (viewer,)).fetchall()
        return handler.response({'comments': [comment_view(db, row) for row in rows]})

    if parts == ['comments'] and method == 'GET':
        query = parse_qs(urlparse(handler.path).query, keep_blank_values=True)
        ids = query.get('postId', [])
        if len(ids) != 1:
            raise APIError(400, '请选择一个帖子')
        post = public_post(ids[0])
        rows = db.execute(
            "SELECT * FROM comments WHERE post_id=? AND (review='approved' OR owner=?) "
            'ORDER BY created DESC,rowid DESC LIMIT 100', (post['id'], viewer)).fetchall()
        return handler.response({'post': handler.post_view(db, post, viewer, public=True),
                                 'comments': [comment_view(db, row) for row in reversed(rows)]})

    if parts == ['comments'] and method == 'POST':
        data = handler.read_json()
        post = public_post(data.get('postId'))
        body = text_field(data, 'body', 1000, required=True)
        if not body.strip():
            raise APIError(400, '回复不能为空')
        handler.rate_limit('comment', 30, 3600, identity=viewer)
        if db.execute('SELECT COUNT(*) FROM comments WHERE owner=?', (viewer,)).fetchone()[0] >= 2000:
            raise APIError(409, '当前账号最多保存 2000 条回复，请先删除不需要的回复')
        item_id = uid()
        db.execute('INSERT INTO comments(id,post_id,owner,body,review,created) VALUES(?,?,?,?,?,?)',
                   (item_id, post['id'], viewer, body, 'pending', now()))
        row = db.execute('SELECT * FROM comments WHERE id=?', (item_id,)).fetchone()
        return handler.response({'comment': comment_view(db, row)}, 201)

    if len(parts) == 2 and method == 'DELETE':
        item_id = parts[1]
        if not valid_id(item_id):
            raise APIError(404, '回复不存在或无权删除')
        row = db.execute('SELECT id FROM comments WHERE id=? AND owner=?', (item_id, viewer)).fetchone()
        if not row:
            raise APIError(404, '回复不存在或无权删除')
        db.execute('DELETE FROM comments WHERE id=? AND owner=?', (item_id, viewer))
        return handler.response({'ok': True})

    raise APIError(404, '接口不存在')
