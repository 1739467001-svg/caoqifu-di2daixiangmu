/* Generate reviewed code-only transfer chunks. This does not contact the server. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const root = path.resolve(__dirname, '..');
const out = path.join(__dirname, 'generated');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const files = {};
const extensions = new Set(['.html', '.js', '.css', '.svg', '.png', '.jpg', '.webp', '.ico', '.woff2']);
function encodedItem(content) {
  const text = content.toString('utf8');
  return Buffer.from(text, 'utf8').equals(content)
    ? {sha256:sha(content), encoding:'utf8', text}
    : {sha256:sha(content), encoding:'base64', data:content.toString('base64')};
}
function add(relative) {
  const source = path.join(root, ...relative.split('/'));
  if (fs.lstatSync(source).isSymbolicLink()) throw Error(`Do not bundle symlink: ${relative}`);
  const content = fs.readFileSync(source);
  files[relative] = encodedItem(content);
}
function walk(dir, relative = 'dist') {
  for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) throw Error('Hidden files or symlinks are not allowed in dist');
    if (entry.isDirectory()) walk(path.join(dir, entry.name), `${relative}/${entry.name}`);
    else if (extensions.has(path.extname(entry.name).toLowerCase())) add(`${relative}/${entry.name}`);
    else throw Error(`Unexpected public asset: ${entry.name}`);
  }
}
walk(path.join(root, 'dist'));
add('backend/server.py');
add('backend/manage.py');
add('backend/community_comments.py');
add('deploy/ai-youth-archive.service');
const bundle = zlib.gzipSync(Buffer.from(JSON.stringify({format:1, files})), {level:9});
const envelope = {};
for (const name of ['install.py', 'preflight.py']) {
  const content = fs.readFileSync(path.join(__dirname, name));
  envelope[name] = encodedItem(content);
}
envelope['bundle.json.gz'] = {sha256:sha(bundle), data:bundle.toString('base64')};
const transfer = zlib.gzipSync(Buffer.from(JSON.stringify(envelope)), {level:9}).toString('base64');
const transferHash = sha(transfer);
const stage = `/tmp/ai-youth-upload-${transferHash.slice(0,24)}`;
fs.mkdirSync(out, {recursive:true});
fs.writeFileSync(path.join(out, 'bundle.json.gz'), bundle);
// Keep the entire shell command below 16 KiB even after Aliyun Base64 encoding.
const chunks = transfer.match(/.{1,11500}/g);
const guard = `p=pathlib.Path('${stage}')\nassert p.parent==pathlib.Path('/tmp')\nif not p.exists():\n    p.mkdir(mode=0o700)\nassert p.is_dir() and not p.is_symlink() and p.stat().st_uid==0\nassert p.stat().st_mode & 0o077 == 0\n`;
const commands = [];
chunks.forEach((chunk, index) => {
  const filename = `part-${String(index+1).padStart(3,'0')}.b64`;
  const command = `#!/bin/bash\nset -eu\npython3 - <<'PY'\nimport pathlib,hashlib\n${guard}f=p/'${filename}'\ndata='${chunk}'\nassert hashlib.sha256(data.encode()).hexdigest()=='${sha(chunk)}'\nif f.exists() or f.is_symlink():\n    assert not f.is_symlink() and f.read_text()==data, 'Unexpected transfer part'\nelse:\n    with f.open('x') as out: out.write(data)\n    f.chmod(0o600)\nprint('AI_YOUTH_PART_${index+1}_OF_${chunks.length}_OK')\nPY\n`;
  const name = `${String(index+1).padStart(3,'0')}-upload.sh`;
  if (Buffer.byteLength(Buffer.from(command).toString('base64')) > 16384) throw Error('Aliyun encoded command exceeds 16 KiB');
  fs.writeFileSync(path.join(out,name),command);
  commands.push({name, bytes:Buffer.byteLength(command)});
});
const finish = `#!/bin/bash\nset -eu\npython3 - <<'PY'\nimport pathlib,hashlib,json,gzip,base64,subprocess\n${guard}text=''.join((p/('part-%03d.b64'%i)).read_text() for i in range(1,${chunks.length+1}))\nassert hashlib.sha256(text.encode()).hexdigest()=='${transferHash}', 'Incomplete transfer'\nfiles=json.loads(gzip.decompress(base64.b64decode(text,validate=True)))\nassert set(files)=={'install.py','preflight.py','bundle.json.gz'}\nfor name,item in files.items():\n    data=item['text'].encode('utf-8') if item.get('encoding')=='utf8' else base64.b64decode(item['data'],validate=True)\n    assert hashlib.sha256(data).hexdigest()==item['sha256']\n    dest=p/name\n    if dest.exists() or dest.is_symlink():\n        assert not dest.is_symlink() and dest.read_bytes()==data\n    else:\n        with dest.open('xb') as out: out.write(data)\n        dest.chmod(0o600)\nsubprocess.run(['python3',str(p/'preflight.py')],check=True)\nsubprocess.run(['python3',str(p/'install.py'),'--bundle',str(p/'bundle.json.gz'),'--sha256','${sha(bundle)}'],check=True)\nprint('TRANSFER_VERIFIED_READ_ONLY_PLAN_COMPLETE')\nPY\n`;
fs.writeFileSync(path.join(out,'verify-and-plan.sh'),finish);
const apply = `#!/bin/bash\nset -eu\npython3 '${stage}/install.py' --bundle '${stage}/bundle.json.gz' --sha256 '${sha(bundle)}' --apply\n`;
fs.writeFileSync(path.join(out,'apply-release.sh'),apply);
const preflight = fs.readFileSync(path.join(__dirname,'preflight.py'));
fs.writeFileSync(path.join(out,'preflight-command.sh'),`#!/bin/bash\nset -eu\npython3 - <<'PY'\nimport base64\nexec(compile(base64.b64decode('${preflight.toString('base64')}'),'archive-preflight','exec'))\nPY\n`);
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({target:'112.74.63.237',stagingDirectory:stage,bundleSha256:sha(bundle),transferSha256:transferHash,commands,files:Object.fromEntries(Object.entries(files).map(([name,item])=>[name,item.sha256]))},null,2));
console.log(JSON.stringify({output:out,stagingDirectory:stage,uploadCommands:commands,bundleBytes:bundle.length,bundleSha256:sha(bundle)},null,2));
