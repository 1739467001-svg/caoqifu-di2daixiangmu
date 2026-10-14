const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const files = {}, hashes = {};
for (const name of ['index.html','app.js','style.css','hash.js']) {
  files[name] = fs.readFileSync(path.join(__dirname,'dist',name),'utf8');
  hashes[name] = sha(files[name]);
}
const bundle = zlib.gzipSync(JSON.stringify({files,hashes})).toString('base64');
const script = fs.readFileSync(path.join(__dirname,'deploy-template.py'),'utf8')
  .replace('__BUNDLE__',bundle)
  .replace('__CONFIG_SHA__','94afd05071c2b3cc1a902e08e7ebfc399f30a2362808ce9bd0b469a4fdff6bc5');
const encoded = zlib.gzipSync(script).toString('base64');
const digest = sha(encoded);
const tmp = `/tmp/ai-youth-${digest.slice(0,16)}.b64`;
const midpoint = Math.ceil(encoded.length/2);
const stage = `#!/bin/bash\nset -e\npython3 - <<'PY'\nimport os,pathlib\np=pathlib.Path('${tmp}')\ndata='${encoded.slice(0,midpoint)}'\nif p.exists():\n    assert not p.is_symlink() and p.read_text()==data, 'Unexpected staging file'\nelse:\n    fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)\n    with os.fdopen(fd,'w') as f: f.write(data)\nprint('YOUTH_STAGE_OK')\nPY\n`;
const finish = `#!/bin/bash\nset -e\npython3 - <<'PY'\nimport pathlib,hashlib,base64,gzip\np=pathlib.Path('${tmp}')\nassert not p.is_symlink()\nencoded=p.read_text()+'${encoded.slice(midpoint)}'\nassert hashlib.sha256(encoded.encode()).hexdigest()=='${digest}', 'Upload checksum mismatch'\nexec(compile(gzip.decompress(base64.b64decode(encoded)),'youth-deploy','exec'))\np.unlink()\nPY\n`;
const out = path.join(__dirname,'release');
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'deploy.py'),script);
fs.writeFileSync(path.join(out,'stage-command.sh'),stage);
fs.writeFileSync(path.join(out,'finish-command.sh'),finish);
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({target:'112.74.63.237',url:'https://112.74.63.237/ai-youth/',hashes,stageBytes:Buffer.byteLength(stage),finishBytes:Buffer.byteLength(finish)},null,2));
console.log(JSON.stringify({stageBytes:Buffer.byteLength(stage),finishBytes:Buffer.byteLength(finish),hashes}));
