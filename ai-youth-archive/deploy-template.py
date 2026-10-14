import base64, gzip, json, pathlib, hashlib, os, datetime, subprocess, urllib.request, time

bundle = json.loads(gzip.decompress(base64.b64decode('__BUNDLE__')))
conf = pathlib.Path('/etc/nginx/sites-available/tanxun')
original = conf.read_bytes()
assert hashlib.sha256(original).hexdigest() == '__CONFIG_SHA__', 'Nginx configuration changed; inspect before deploying'
text = original.decode()
anchor = '    location / {'
assert text.count(anchor) == 2 and 'server_name 112.74.63.237;' in text
assert '/ai-youth' not in text, 'Existing youth route needs separate review'
base = pathlib.Path('/var/www/ai-youth-archive')
target = base / 'current'
assert not base.is_symlink(), 'Unexpected base symlink'
assert not target.exists() and not target.is_symlink(), 'Existing deployment needs separate review'
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S')
release = base / 'releases' / stamp
backup = pathlib.Path('/var/backups/ai-youth-archive') / stamp
release.mkdir(parents=True, mode=0o755)
backup.mkdir(parents=True, mode=0o700)
(backup / 'tanxun.nginx.conf').write_bytes(original)
assert set(bundle['files']) == {'index.html','app.js','style.css','hash.js'}
for name, content in bundle['files'].items():
    raw = content.encode()
    assert hashlib.sha256(raw).hexdigest() == bundle['hashes'][name]
    (release / name).write_bytes(raw)
    (release / name).chmod(0o644)
base.chmod(0o755)
(base / 'releases').chmod(0o755)
release.chmod(0o755)

def get(path):
    req = urllib.request.Request('http://127.0.0.1'+path, headers={'Host':'112.74.63.237'})
    with urllib.request.urlopen(req, timeout=10) as response:
        assert response.status == 200
        return response.read()

before = hashlib.sha256(get('/')).hexdigest()
addition = '''    # Super AI Youth Archive: static site, no additional application process.
    location = /ai-youth { return 301 /ai-youth/; }
    location ^~ /ai-youth/ {
        alias /var/www/ai-youth-archive/current/;
        index index.html;
        autoindex off;
    }

'''
updated = text.replace(anchor, addition + anchor).encode()
stat = conf.stat()
def write_config(data):
    temp = conf.with_name('tanxun.ai-youth-'+stamp+'.tmp')
    with temp.open('xb') as handle:
        handle.write(data)
    os.chmod(temp, stat.st_mode & 0o777)
    os.chown(temp, stat.st_uid, stat.st_gid)
    os.replace(temp, conf)

target.symlink_to(release, target_is_directory=True)
changed = False
try:
    write_config(updated)
    changed = True
    subprocess.run(['nginx','-t'], check=True)
    subprocess.run(['systemctl','reload','nginx'], check=True)
    # Reload is asynchronous; check the actual responses before recording success.
    for attempt in range(10):
        try:
            for name, digest in bundle['hashes'].items():
                assert hashlib.sha256(get('/ai-youth/'+name)).hexdigest() == digest, name
            assert hashlib.sha256(get('/ai-youth/')).hexdigest() == bundle['hashes']['index.html']
            assert hashlib.sha256(get('/')).hexdigest() == before, 'Existing website changed'
            break
        except Exception:
            if attempt == 9:
                raise
            time.sleep(0.5)
except Exception:
    if changed:
        write_config(original)
        subprocess.run(['nginx','-t'], check=True)
        subprocess.run(['systemctl','reload','nginx'], check=True)
    if target.is_symlink() and target.resolve() == release:
        target.unlink()
    raise
result = {'status':'deployed','url':'https://112.74.63.237/ai-youth/','release':str(release),'backup':str(backup),'hashes':bundle['hashes'],'existing_home_sha256':before,'new_nginx_sha256':hashlib.sha256(updated).hexdigest()}
(backup / 'receipt.json').write_text(json.dumps(result, indent=2))
print(json.dumps(result))
