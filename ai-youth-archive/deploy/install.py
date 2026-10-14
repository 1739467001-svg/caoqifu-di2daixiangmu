#!/usr/bin/env python3
"""Prepare a release, or explicitly --apply it. Run only on the existing target host."""
import argparse
import base64
import datetime
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

CONF = Path('/etc/nginx/sites-available/tanxun')
STATIC = Path('/var/www/ai-youth-archive')
BACKEND = Path('/opt/ai-youth-archive')
DATA = Path('/var/lib/ai-youth-archive')
UNIT = Path('/etc/systemd/system/ai-youth-archive.service')
SERVICE = 'ai-youth-archive.service'
BEGIN = '# BEGIN AI-YOUTH API (managed)'
END = '# END AI-YOUTH API (managed)'
ROUTE = '''    # BEGIN AI-YOUTH API (managed)
    location ^~ /ai-youth/api/ {
        if ($scheme = http) { return 308 https://112.74.63.237$request_uri; }
        client_max_body_size 15m;
        proxy_pass http://127.0.0.1:8789/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        proxy_connect_timeout 5s;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
        proxy_buffering off;
    }
    # END AI-YOUTH API (managed)

'''


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def run(args, check=True):
    result = subprocess.run(args, capture_output=True, text=True, timeout=60)
    if check and result.returncode:
        # Commands used here have no secret arguments; do not dump unrelated service logs.
        raise RuntimeError('%s failed: %s' % (' '.join(args), (result.stderr + result.stdout)[-3000:]))
    return result


def get(path, direct=False, secure=False):
    base = 'http://127.0.0.1:8789' if direct else ('https://112.74.63.237' if secure else 'http://127.0.0.1')
    req = urllib.request.Request(base + path, headers={'Host': '112.74.63.237'})
    with urllib.request.urlopen(req, timeout=10) as response:
        if response.status != 200:
            raise RuntimeError('Unexpected response status')
        return response.read()


def existing_home_snapshot():
    """Preserve the unrelated site's root, including its intentional 410 page."""
    req = urllib.request.Request('http://127.0.0.1/', headers={'Host': '112.74.63.237'})
    try:
        response = urllib.request.urlopen(req, timeout=10)
    except urllib.error.HTTPError as error:
        if error.code != 410:
            raise RuntimeError('Unexpected existing home status: ' + str(error.code)) from error
        response = error
    with response:
        if response.status not in (200, 410):
            raise RuntimeError('Unexpected existing home status: ' + str(response.status))
        return {'status': response.status, 'sha256': sha(response.read())}


def safe_base(path):
    for item in (path, *path.parents):
        if item.is_symlink():
            raise RuntimeError('Unexpected symlink: ' + str(item))


def acquire_lock():
    import fcntl
    lock_path = Path('/run/lock/ai-youth-archive.deploy.lock')
    safe_base(lock_path)
    descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    handle = os.fdopen(descriptor, 'a+')
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        raise RuntimeError('Another archive deployment is running')
    return handle


def link_snapshot(link, base):
    if not link.exists() and not link.is_symlink():
        return None
    if not link.is_symlink():
        raise RuntimeError('Expected release symlink: ' + str(link))
    target = link.resolve(strict=True)
    if not target.is_dir():
        raise RuntimeError('Release target must be a directory')
    try:
        target.relative_to(base / 'releases')
    except ValueError:
        raise RuntimeError('Release target outside expected directory')
    return str(target)


def atomic_bytes(path, data, mode=0o644):
    temp = path.with_name(path.name + '.ai-youth-' + uuid.uuid4().hex + '.tmp')
    try:
        with temp.open('xb') as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temp, mode)
        os.replace(temp, path)
    finally:
        if temp.exists():
            temp.unlink()


def switch(link, target):
    temp = link.with_name('.current-' + uuid.uuid4().hex)
    try:
        temp.symlink_to(target, target_is_directory=True)
        os.replace(temp, link)
    finally:
        if temp.is_symlink():
            temp.unlink()


def restore_link(link, old, new):
    if not link.is_symlink() or str(link.resolve()) != str(new):
        if old is not None and link.is_symlink() and str(link.resolve()) == old:
            return
        if old is None and not link.exists() and not link.is_symlink():
            return
        raise RuntimeError('Current link was changed externally; refusing to overwrite it')
    if old is not None:
        switch(link, old)
    elif link.is_symlink() and str(link.resolve()) == str(new):
        link.unlink()


def patch_nginx(raw):
    text = raw.decode('utf-8')
    if 'server_name 112.74.63.237;' not in text:
        raise RuntimeError('This is not the expected Nginx virtual host')
    if text.count(BEGIN) != text.count(END):
        raise RuntimeError('Incomplete managed Nginx block')
    cleaned = re.sub(r'(?m)^    # BEGIN AI-YOUTH API \(managed\)\n.*?^    # END AI-YOUTH API \(managed\)\n\n?', '', text, flags=re.S)
    if '/ai-youth/api' in cleaned:
        raise RuntimeError('Existing unmanaged API route must be reviewed first')
    marker = re.compile(r'(?m)^    location \^~ /ai-youth/ \{\s*$')
    if len(marker.findall(cleaned)) != 2:
        raise RuntimeError('Expected exactly two existing static routes; inspect Nginx first')
    return marker.sub(lambda match: ROUTE + match.group(0), cleaned).encode('utf-8')


def read_bundle(path, expected):
    raw = path.read_bytes()
    if sha(raw) != expected:
        raise RuntimeError('Bundle checksum does not match')
    value = json.loads(gzip.decompress(raw))
    if value.get('format') != 1 or not isinstance(value.get('files'), dict):
        raise RuntimeError('Unsupported deployment bundle')
    files = {}
    for name, item in value['files'].items():
        part = PurePosixPath(name)
        if str(part) != name or '..' in part.parts or part.is_absolute():
            raise RuntimeError('Unsafe bundle path')
        allowed = name in ('backend/server.py', 'backend/manage.py', 'backend/community_comments.py', 'deploy/ai-youth-archive.service')
        if part.parts[0] == 'dist' and len(part.parts) > 1:
            allowed = all(not segment.startswith('.') for segment in part.parts)
            allowed = allowed and part.suffix.lower() in ('.html', '.js', '.css', '.svg', '.png', '.jpg', '.webp', '.ico', '.woff2')
        if not allowed:
            raise RuntimeError('Unexpected file in deployment bundle: ' + name)
        if item.get('encoding') == 'utf8':
            content = item['text'].encode('utf-8')
        elif item.get('encoding') in (None, 'base64'):
            content = base64.b64decode(item['data'], validate=True)
        else:
            raise RuntimeError('Unsupported file encoding')
        if sha(content) != item['sha256']:
            raise RuntimeError('File checksum mismatch: ' + name)
        files[name] = content
    if not {'dist/index.html', 'dist/app.js', 'dist/style.css', 'backend/server.py', 'backend/manage.py', 'deploy/ai-youth-archive.service'} <= set(files):
        raise RuntimeError('Required release files missing')
    compile(files['backend/server.py'], 'server.py', 'exec')
    compile(files['backend/manage.py'], 'manage.py', 'exec')
    if 'backend/community_comments.py' in files:
        compile(files['backend/community_comments.py'], 'community_comments.py', 'exec')
    return files


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--apply', action='store_true', help='Actually deploy; omission is a read-only plan')
    args = parser.parse_args()
    if os.name != 'posix' or sys.version_info < (3, 9):
        raise RuntimeError('Requires Linux Python 3.9+')
    if args.apply and os.geteuid() != 0:
        raise RuntimeError('Deployment requires root')
    lock_handle = acquire_lock() if args.apply else None  # Retained until main exits.
    files = read_bundle(args.bundle, args.sha256)
    for base in (STATIC, STATIC / 'releases', BACKEND, BACKEND / 'releases', DATA, CONF, UNIT):
        safe_base(base)
    original = CONF.read_bytes()
    config_mode = CONF.stat().st_mode & 0o777
    updated = patch_nginx(original)
    old_static = link_snapshot(STATIC / 'current', STATIC)
    if old_static is None:
        raise RuntimeError('Existing static deployment not found')
    old_backend = link_snapshot(BACKEND / 'current', BACKEND)
    old_unit = UNIT.read_bytes() if UNIT.exists() else None
    active_before = run(['systemctl', 'is-active', '--quiet', SERVICE], check=False).returncode == 0
    enabled_before = run(['systemctl', 'is-enabled', '--quiet', SERVICE], check=False).returncode == 0
    if not active_before:
        with socket.socket() as probe:
            try:
                probe.bind(('127.0.0.1', 8789))
            except OSError:
                raise RuntimeError('Port 8789 is occupied by another service')
    data_bytes = 0
    if DATA.exists():
        for path in DATA.rglob('*'):
            if path.is_symlink():
                raise RuntimeError('Unexpected symlink in private data directory')
            if path.is_file():
                data_bytes += path.stat().st_size
    if shutil.disk_usage('/var').free < data_bytes + 512 * 1024 * 1024:
        raise RuntimeError('Not enough space for private-data backup and 512 MiB safety margin')
    run(['nginx', '-t'])
    before_home = existing_home_snapshot()
    plan = {'mode': 'apply' if args.apply else 'read-only-plan', 'current_static': old_static,
            'current_backend': old_backend, 'nginx_before_sha256': sha(original),
            'nginx_after_sha256': sha(updated), 'files': list(files),
            'data_directory': str(DATA), 'backend_address': '127.0.0.1:8789',
            'existing_home_status': before_home['status'],
            'existing_home_sha256': before_home['sha256']}
    if not args.apply:
        print(json.dumps(plan, ensure_ascii=False, indent=2))
        return
    import pwd
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:6]
    release = STATIC / 'releases' / stamp
    backend_release = BACKEND / 'releases' / stamp
    backup = Path('/var/backups/ai-youth-archive') / stamp
    safe_base(backup.parent)
    backup.mkdir(mode=0o700, parents=True)
    (backup / 'nginx.conf').write_bytes(original)
    if old_unit is not None:
        (backup / 'ai-youth-archive.service').write_bytes(old_unit)
    (backup / 'previous.json').write_text(json.dumps({**plan, 'active_before': active_before,
                                                    'enabled_before': enabled_before}, indent=2))
    # A restrictive root umask must not prevent Nginx or the service account reading code.
    for base in (STATIC, BACKEND):
        for directory in (base, base / 'releases'):
            directory.mkdir(mode=0o755, parents=True, exist_ok=True)
            directory.chmod(0o755)
    for directory in (release, backend_release):
        directory.mkdir(mode=0o755)
        directory.chmod(0o755)
    for name, content in files.items():
        if name.startswith('dist/'):
            destination = release / name[5:]
        elif name in ('backend/server.py', 'backend/manage.py', 'backend/community_comments.py'):
            destination = backend_release / name.split('/')[1]
        else:
            continue
        destination.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        for parent in destination.parents:
            if parent in (STATIC, BACKEND):
                break
            parent.chmod(0o755)
        destination.write_bytes(content)
        destination.chmod(0o644)
    try:
        account = pwd.getpwnam('ai-youth')
    except KeyError:
        run(['useradd', '--system', '--user-group', '--home-dir', str(DATA), '--no-create-home', '--shell', '/usr/sbin/nologin', 'ai-youth'])
        account = pwd.getpwnam('ai-youth')
    if account.pw_uid == 0:
        raise RuntimeError('Service account cannot be root')
    if DATA.exists() and DATA.stat().st_uid != account.pw_uid:
        raise RuntimeError('Existing data directory has unexpected owner; inspect before deployment')
    touched = False
    unit_written = backend_switched = static_switched = config_written = False
    try:
        # Recheck snapshots immediately before modifying the active system.
        current_unit = UNIT.read_bytes() if UNIT.exists() else None
        if CONF.read_bytes() != original or current_unit != old_unit or link_snapshot(STATIC / 'current', STATIC) != old_static or link_snapshot(BACKEND / 'current', BACKEND) != old_backend:
            raise RuntimeError('Another deployment changed current state; run inspection again')
        touched = True
        if active_before:
            run(['systemctl', 'stop', SERVICE])
        if DATA.exists():
            if any(path.is_symlink() for path in DATA.rglob('*')):
                raise RuntimeError('Unexpected symlink in private data directory')
            shutil.copytree(DATA, backup / 'data', copy_function=shutil.copy2)
        DATA.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chown(DATA, account.pw_uid, account.pw_gid)
        DATA.chmod(0o700)
        atomic_bytes(UNIT, files['deploy/ai-youth-archive.service'])
        unit_written = True
        switch(BACKEND / 'current', backend_release)
        backend_switched = True
        run(['systemctl', 'daemon-reload'])
        run(['systemctl', 'start', SERVICE])
        for attempt in range(20):
            try:
                assert json.loads(get('/api/status', direct=True))['ready'] is True
                break
            except Exception:
                if attempt == 19:
                    raise
                time.sleep(0.3)
        # Backend code is deliberately outside the Nginx static tree.
        if CONF.read_bytes() != original or link_snapshot(STATIC / 'current', STATIC) != old_static:
            raise RuntimeError('Another process changed site configuration during API startup')
        switch(STATIC / 'current', release)
        static_switched = True
        atomic_bytes(CONF, updated, config_mode)
        config_written = True
        run(['nginx', '-t'])
        run(['systemctl', 'reload', 'nginx'])
        for attempt in range(20):
            try:
                assert json.loads(get('/ai-youth/api/status', secure=True))['ready'] is True
                for name, content in files.items():
                    if name.startswith('dist/'):
                        assert sha(get('/ai-youth/' + name[5:])) == sha(content), name
                assert existing_home_snapshot() == before_home, 'Existing site status or content changed'
                break
            except Exception:
                if attempt == 19:
                    raise
                time.sleep(0.3)
        run(['systemctl', 'enable', SERVICE])
    except Exception:
        if touched:
            run(['systemctl', 'stop', SERVICE], check=False)
            if static_switched:
                restore_link(STATIC / 'current', old_static, release)
            if backend_switched:
                restore_link(BACKEND / 'current', old_backend, backend_release)
            if config_written:
                if CONF.read_bytes() != updated:
                    raise RuntimeError('Nginx config changed externally after deployment; preserve it and inspect backup at ' + str(backup))
                atomic_bytes(CONF, original, config_mode)
            if unit_written:
                if UNIT.read_bytes() != files['deploy/ai-youth-archive.service']:
                    raise RuntimeError('Service unit changed externally; manual rollback review required')
                if old_unit is not None:
                    atomic_bytes(UNIT, old_unit)
                elif UNIT.exists():
                    UNIT.unlink()
            run(['systemctl', 'daemon-reload'], check=False)
            if not enabled_before:
                run(['systemctl', 'disable', SERVICE], check=False)
            if active_before:
                run(['systemctl', 'start', SERVICE], check=False)
            run(['nginx', '-t'])
            run(['systemctl', 'reload', 'nginx'])
            print(json.dumps({'status': 'rolled-back-code-and-routing', 'backup': str(backup),
                              'note': 'Private data retained; no automatic destructive database rollback'}))
        raise
    receipt = {**plan, 'status': 'deployed', 'static_release': str(release),
               'backend_release': str(backend_release), 'backup': str(backup),
               'existing_home_status': before_home['status'],
               'existing_home_sha256': before_home['sha256'],
               'static_hashes': {name[5:]: sha(raw) for name, raw in files.items() if name.startswith('dist/')}}
    (backup / 'receipt.json').write_text(json.dumps(receipt, indent=2))
    print(json.dumps(receipt, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
