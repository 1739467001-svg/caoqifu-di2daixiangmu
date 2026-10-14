"""Create UI proof records only in the existing isolated, synthetic QA database."""
import sqlite3
import time
import uuid
from pathlib import Path

root = Path(__file__).resolve().parents[2]
target = root / '.private-notes' / 'five-views-ui' / 'archive.sqlite3'
assert target.is_file()
with sqlite3.connect(target) as db:
    db.execute('PRAGMA foreign_keys=ON')
    creator, partner, post = 'a'*32, 'b'*32, 'd'*32
    assert db.execute('SELECT username FROM users WHERE id=?', (creator,)).fetchone()[0] == 'ui_creator'
    assert db.execute('SELECT username FROM users WHERE id=?', (partner,)).fetchone()[0] == 'ui_partner'
    assert db.execute('SELECT owner,review FROM posts WHERE id=?', (post,)).fetchone() == (creator, 'approved')
    db.execute("DELETE FROM reactions WHERE user_id=? AND post_id=? AND kind='like'", (partner,post))
    db.execute('INSERT INTO reactions VALUES(?,?,?)', (partner,post,'like'))
    comment = uuid.uuid4().hex
    db.execute('INSERT INTO comments(id,post_id,owner,body,review,created) VALUES(?,?,?,?,?,?)',
               (comment,post,partner,'【隔离测试回复】我看了这次更新，作品说明整理得更清楚了。','pending',int(time.time())))
    db.execute("UPDATE comments SET review='approved' WHERE id=?", (comment,))
print('Synthetic like and approved reply prepared only in five-views-ui.')
