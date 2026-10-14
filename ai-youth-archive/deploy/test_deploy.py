"""Offline deployment checks: do not connect to or alter any server."""
import base64
import gzip
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import MagicMock, patch
import urllib.error

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location('archive_installer', HERE / 'install.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class DeploymentTests(unittest.TestCase):
    def root_response(self, status, content):
        response = MagicMock()
        response.status = status
        response.read.return_value = content
        response.__enter__.return_value = response
        return response

    def test_existing_root_snapshots_200_and_410(self):
        raw = b'existing root page'
        expected_hash = hashlib.sha256(raw).hexdigest()
        with patch.object(installer.urllib.request, 'urlopen', return_value=self.root_response(200, raw)):
            self.assertEqual(installer.existing_home_snapshot(), {'status': 200, 'sha256': expected_hash})
        error = urllib.error.HTTPError('http://127.0.0.1/', 410, 'Gone', {}, io.BytesIO(raw))
        with patch.object(installer.urllib.request, 'urlopen', side_effect=error):
            self.assertEqual(installer.existing_home_snapshot(), {'status': 410, 'sha256': expected_hash})
        error = urllib.error.HTTPError('http://127.0.0.1/', 500, 'Failure', {}, io.BytesIO(raw))
        with patch.object(installer.urllib.request, 'urlopen', side_effect=error):
            with self.assertRaises(RuntimeError):
                installer.existing_home_snapshot()
        with patch.object(installer.urllib.request, 'urlopen', return_value=self.root_response(500, raw)):
            with self.assertRaises(RuntimeError):
                installer.existing_home_snapshot()

    def test_existing_root_comparison_rejects_status_or_content_changes(self):
        with patch.object(installer.urllib.request, 'urlopen', return_value=self.root_response(200, b'original')):
            original = installer.existing_home_snapshot()
        for status, raw in ((410, b'original'), (200, b'changed')):
            with patch.object(installer.urllib.request, 'urlopen', return_value=self.root_response(status, raw)):
                with self.assertRaises(AssertionError):
                    assert installer.existing_home_snapshot() == original, 'Existing site status or content changed'

    def config(self):
        return ('''server {
    listen 80;
    server_name 112.74.63.237;
    location ^~ /ai-youth/ {
        alias /var/www/ai-youth-archive/current/;
        index index.html;
    }
    location / { proxy_pass http://127.0.0.1:3210; }
}
server {
    listen 443 ssl;
    server_name 112.74.63.237;
    ssl_certificate /certificate/example.pem;
    location ^~ /ai-youth/ {
        alias /var/www/ai-youth-archive/current/;
        index index.html;
    }
    location / { proxy_pass http://127.0.0.1:3210; }
}
''').encode()

    def test_adds_only_owned_route_and_is_idempotent(self):
        original = self.config()
        updated = installer.patch_nginx(original)
        self.assertEqual(updated.count(b'proxy_pass http://127.0.0.1:8789/api/;'), 2)
        self.assertEqual(updated.count(b'client_max_body_size 15m;'), 2)
        self.assertEqual(updated.count(b'return 308 https://112.74.63.237$request_uri;'), 2)
        self.assertEqual(updated.replace(installer.ROUTE.encode(), b''), original)
        self.assertEqual(installer.patch_nginx(updated), updated)

    def test_unknown_route_or_server_shape_is_rejected(self):
        for raw in (self.config().replace(b'112.74.63.237', b'example.com'),
                    self.config() + b'location /ai-youth/api/ { }\n',
                    self.config().replace(b'location ^~ /ai-youth/', b'location /ai-youth/'),
                    self.config() + b'# BEGIN AI-YOUTH API (managed)\n'):
            with self.assertRaises(RuntimeError):
                installer.patch_nginx(raw)

    def test_generated_bundle_whitelist_and_hashes(self):
        path = HERE / 'generated' / 'bundle.json.gz'
        raw = path.read_bytes()
        files = installer.read_bundle(path, hashlib.sha256(raw).hexdigest())
        self.assertIn('backend/server.py', files)
        self.assertIn('backend/manage.py', files)
        self.assertIn('backend/community_comments.py', files)
        self.assertNotIn('.private-notes', ' '.join(files))
        self.assertNotIn('runtime.env', ' '.join(files))
        with self.assertRaises(RuntimeError):
            installer.read_bundle(path, '0' * 64)
        value = json.loads(gzip.decompress(raw))
        value['files']['dist/../private.txt'] = {'data': base64.b64encode(b'no').decode(),
                                               'sha256': hashlib.sha256(b'no').hexdigest()}
        with tempfile.TemporaryDirectory() as directory:
            evil = Path(directory) / 'tampered.gz'
            evil.write_bytes(gzip.compress(json.dumps(value).encode()))
            with self.assertRaises(RuntimeError):
                installer.read_bundle(evil, hashlib.sha256(evil.read_bytes()).hexdigest())

    def test_all_transfer_parts_reassemble_without_execution(self):
        directory = HERE / 'generated'
        manifest = json.loads((directory / 'manifest.json').read_text())
        chunks = []
        for item in manifest['commands']:
            command = (directory / item['name']).read_text()
            match = re.search(r"^data='([A-Za-z0-9+/=]+)'$", command, re.M)
            self.assertIsNotNone(match)
            chunks.append(match.group(1))
        assembled = ''.join(chunks)
        self.assertEqual(hashlib.sha256(assembled.encode()).hexdigest(), manifest['transferSha256'])
        envelope = json.loads(gzip.decompress(base64.b64decode(assembled)))
        self.assertEqual(set(envelope), {'install.py', 'preflight.py', 'bundle.json.gz'})
        for name, item in envelope.items():
            data = item['text'].encode('utf-8') if item.get('encoding') == 'utf8' else base64.b64decode(item['data'])
            self.assertEqual(hashlib.sha256(data).hexdigest(), item['sha256'])
            if name.endswith('.py'):
                compile(data, name, 'exec')
        for item in manifest['commands']:
            command = (directory / item['name']).read_bytes()
            self.assertLessEqual(len(base64.b64encode(command)), 16384)


if __name__ == '__main__':
    unittest.main()
