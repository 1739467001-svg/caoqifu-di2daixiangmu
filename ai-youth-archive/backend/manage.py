#!/usr/bin/env python3
"""Operator-only commands; run as the service user with ARCHIVE_DATA_DIR set."""
import argparse
import json
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
import server


def main():
    parser = argparse.ArgumentParser(description='档案馆人工审核与备份，不提供公开管理员注册接口')
    actions = parser.add_subparsers(dest='action', required=True)
    actions.add_parser('pending')
    review = actions.add_parser('review')
    review.add_argument('type', choices=['project', 'post', 'comment'])
    review.add_argument('id')
    review.add_argument('decision', choices=['approve', 'reject'])
    backup = actions.add_parser('backup')
    backup.add_argument('destination', help='Web 根目录以外的备份父目录')
    args = parser.parse_args()
    server.initialize()
    if args.action == 'pending':
        with server.connection() as db:
            output = {'projects': [dict(x) for x in db.execute("SELECT id,body FROM projects WHERE review='pending'")],
                      'posts': [dict(x) for x in db.execute("SELECT id,body,kind FROM posts WHERE review='pending'")],
                      'comments': [dict(x) for x in db.execute("SELECT id,post_id,body FROM comments WHERE review='pending'")]}
            print(json.dumps(output, ensure_ascii=False, indent=2))
    elif args.action == 'review':
        table = {'project': 'projects', 'post': 'posts', 'comment': 'comments'}[args.type]
        with server.connection() as db:
            row = db.execute('SELECT * FROM ' + table + ' WHERE id=?', (args.id,)).fetchone()
            if not row:
                parser.error('找不到记录')
            if args.type == 'project' and row['visibility'] != 'public':
                parser.error('不能公开作者设为私密的作品')
            if args.type == 'comment' and args.decision == 'approve':
                post = db.execute("SELECT id FROM posts WHERE id=? AND review='approved'", (row['post_id'],)).fetchone()
                if not post:
                    parser.error('只能批准公开且已审核帖子的回复')
            db.execute('UPDATE ' + table + ' SET review=? WHERE id=?',
                       ('approved' if args.decision == 'approve' else 'rejected', args.id))
        print('审核状态已更新。审核只是内容审核，不是参赛或原创认证。')
    elif args.action == 'backup':
        # Stop the service for a consistent database+attachment snapshot.
        destination = Path(args.destination).resolve() / datetime.now(timezone.utc).strftime('archive-%Y%m%dT%H%M%SZ')
        destination.mkdir(mode=0o700, parents=True, exist_ok=False)
        with server.connection() as source:
            target = sqlite3.connect(str(destination / 'archive.sqlite3'))
            source.backup(target)
            target.close()
        shutil.copytree(server.ROOT / 'files', destination / 'files')
        print(str(destination))


if __name__ == '__main__':
    main()
