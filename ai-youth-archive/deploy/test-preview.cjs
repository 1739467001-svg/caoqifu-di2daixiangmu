/* Offline preview transport checks. Uses temporary loopback ports. */
const assert = require('node:assert/strict');
const http = require('node:http');
const {once} = require('node:events');
const {createPreviewServer} = require('../preview.cjs');
function call(port, pathname, options={}) {
  return new Promise((resolve,reject) => {
    const request = http.request({hostname:'127.0.0.1',port,path:pathname,...options}, response => {
      const chunks=[];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks).toString()}));
    });
    request.on('error',reject);
    request.end(options.body);
  });
}
(async () => {
  const stub = http.createServer((req,res) => {
    let body=''; req.on('data',chunk => body+=chunk);
    req.on('end', () => {
      res.writeHead(200, {'Content-Type':'application/json','Set-Cookie':'stub=1; Path=/ai-youth/; HttpOnly'});
      res.end(JSON.stringify({path:req.url,host:req.headers.host,ip:req.headers['x-real-ip'],body}));
    });
  });
  let preview;
  try {
    stub.listen(0,'127.0.0.1'); await once(stub,'listening');
    preview = createPreviewServer({apiPort:stub.address().port});
    preview.listen(0,'127.0.0.1'); await once(preview,'listening');
    const port=preview.address().port;
    const redirect=await call(port,'/');
    assert.equal(redirect.status,302); assert.equal(redirect.headers.location,'/ai-youth/');
    const index=await call(port,'/ai-youth/');
    assert.equal(index.status,200); assert.match(index.headers['content-type'],/^text\/html/);
    assert.equal(index.headers['cache-control'],'no-store');
    const js=await call(port,'/ai-youth/app.js');
    assert.equal(js.status,200); assert.match(js.headers['content-type'],/^text\/javascript/);
    for(const target of ['/ai-youth/../backend/server.py','/ai-youth/%2e%2e/backend/server.py','/ai-youth/%5c..%5cbackend/server.py']) {
      assert.equal((await call(port,target)).status,400);
    }
    for(const target of ['/ai-youth/backend/server.py','/ai-youth/.private-notes/test.md','/backend/server.py']) {
      assert.equal((await call(port,target)).status,404);
    }
    const body='{"preview":true}';
    const api=await call(port,'/ai-youth/api/example?x=1',{method:'POST',body,headers:{
      Host:'127.0.0.1:4174','X-Real-IP':'203.0.113.2','Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}});
    assert.equal(api.status,200);
    assert.deepEqual(JSON.parse(api.body),{path:'/api/example?x=1',host:'127.0.0.1:4174',ip:'127.0.0.1',body});
    assert.match(api.headers['set-cookie'][0],/Path=\/ai-youth\//);
    console.log('Preview checks passed: redirects, static content, traversal protection, private paths, proxy path/headers/body/cookie.');
  } finally {
    preview?.close(); stub.close();
  }
})().catch(error => {console.error(error.message);process.exitCode=1;});
