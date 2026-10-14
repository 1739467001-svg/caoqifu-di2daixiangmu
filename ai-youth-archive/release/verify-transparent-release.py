#!/usr/bin/env python3
"""Read-only HTTPS release checks. No accounts, cookies, writes, or TLS bypass."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path, PurePosixPath
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request

HERE = Path(__file__).resolve().parent
ORIGIN = 'https://112.74.63.237'
BASELINE = HERE / 'transparent-deployment-baseline-20261011.json'
MANIFEST = HERE.parent / 'deploy' / 'generated' / 'manifest.json'


class SameOriginHTTPSRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        url = urllib.parse.urlparse(newurl)
        if url.scheme != 'https' or url.netloc != '112.74.63.237':
            raise RuntimeError('Refusing redirect outside the verified HTTPS origin')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch(path):
    # An independent opener per concurrent request; the system trust store and
    # hostname verification remain enabled. No Cookie header is ever supplied.
    opener = urllib.request.build_opener(
        urllib.request.HTTPSHandler(context=ssl.create_default_context()),
        SameOriginHTTPSRedirect())
    request = urllib.request.Request(ORIGIN + path, headers={
        'User-Agent': 'AI-Youth-Release-ReadOnly-Verification/1',
        'Cache-Control': 'no-cache'})
    try:
        with opener.open(request, timeout=20) as response:
            status, raw = response.status, response.read(16 * 1024 * 1024 + 1)
    except urllib.error.HTTPError as exc:
        status, raw = exc.code, exc.read(16 * 1024 * 1024 + 1)
    if len(raw) > 16 * 1024 * 1024:
        raise RuntimeError('Unexpected oversized verification response')
    result = {'path': path, 'status': status, 'bytes': len(raw),
              'sha256': hashlib.sha256(raw).hexdigest()}
    if path == '/ai-youth/api/status' and status == 200:
        # Only report availability metadata, never user or account content.
        value = json.loads(raw)
        result['ready'] = value.get('ready') is True
    return result


def record_baseline():
    paths = ['/', '/ai-youth/', '/ai-youth/api/status']
    with ThreadPoolExecutor(max_workers=3) as workers:
        results = list(workers.map(fetch, paths))
    # The existing HTTPS root may intentionally return 410. Preserve its exact
    # original response rather than demanding an unrelated site's status change.
    if results[1]['status'] != 200 or results[2]['status'] != 200 or not results[2].get('ready'):
        raise RuntimeError('Baseline site or API is not available; baseline not saved')
    value = {'origin': ORIGIN, 'checkedAt': datetime.now(timezone.utc).isoformat(),
             'tlsVerified': True, 'checks': results}
    BASELINE.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'status': 'baseline-recorded', 'path': str(BASELINE),
                      'checks': results}, ensure_ascii=False, indent=2))


def verify():
    baseline = json.loads(BASELINE.read_text(encoding='utf-8'))
    if baseline.get('origin') != ORIGIN or baseline.get('tlsVerified') is not True:
        raise RuntimeError('Unexpected or unverified baseline')
    root_before = next(item for item in baseline['checks'] if item['path'] == '/')
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
    if manifest.get('target') != '112.74.63.237':
        raise RuntimeError('Unexpected deployment target')
    files = {}
    for name, expected in manifest['files'].items():
        if not name.startswith('dist/'):
            continue
        part = PurePosixPath(name)
        if str(part) != name or '..' in part.parts or part.is_absolute() or any(x.startswith('.') for x in part.parts):
            raise RuntimeError('Unsafe public asset path in manifest')
        files['/ai-youth/' + urllib.parse.quote(name[5:], safe='/')] = expected
    if not {'/ai-youth/index.html', '/ai-youth/home-theme.css', '/ai-youth/aux-theme.css'} <= set(files):
        raise RuntimeError('The new transparent-theme release is absent from the manifest')

    # These are actual authenticated routes in server.py, not guessed API names.
    protected = ['/ai-youth/api/' + x for x in
                 ('projects', 'files', 'posts', 'notifications', 'chats', 'export', 'comments/mine')]
    private = ['/ai-youth/' + x for x in
               ('backend/server.py', 'server.py', 'backend/manage.py', 'manage.py',
                'community_comments.py', '.private-notes/', 'AGENTS.md', '.env',
                'runtime.env', 'archive.sqlite3', 'deploy/generated/manifest.json')]
    paths = ['/', '/ai-youth/api/status', *files, *protected, *private]
    with ThreadPoolExecutor(max_workers=4) as workers:
        results = list(workers.map(fetch, paths))
    for item in results:
        path = item['path']
        if path == '/':
            item['ok'] = item['status'] == root_before['status'] and item['sha256'] == root_before['sha256']
        elif path == '/ai-youth/api/status':
            item['ok'] = item['status'] == 200 and item.get('ready') is True
        elif path in files:
            item['ok'] = item['status'] == 200 and item['sha256'] == files[path]
        elif path in protected:
            item['ok'] = item['status'] in (401, 403)
        elif path in private:
            item['ok'] = item['status'] in (403, 404)
    value = {'origin': ORIGIN, 'checkedAt': datetime.now(timezone.utc).isoformat(),
             'tlsVerified': True, 'bundleSha256': manifest.get('bundleSha256'),
             'publicAssetsChecked': len(files), 'ok': all(item['ok'] for item in results),
             'checks': results}
    output = HERE / 'transparent-deployment-verification-20261011.json'
    output.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'status': 'verified' if value['ok'] else 'verification-failed',
                      'publicAssetsChecked': len(files), 'path': str(output),
                      'failed': [item for item in results if not item['ok']]},
                     ensure_ascii=False, indent=2))
    return 0 if value['ok'] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--record-baseline', action='store_true',
                        help='Record pre-deployment hashes; otherwise verify the newly generated release')
    args = parser.parse_args()
    try:
        if args.record_baseline:
            record_baseline()
            return 0
        return verify()
    except Exception as exc:
        print(json.dumps({'status': 'check-error', 'type': type(exc).__name__,
                          'error': str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
