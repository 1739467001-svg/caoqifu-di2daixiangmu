/* Isolated local preview only. Production uses Nginx; this file is not deployed. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = fs.realpathSync(path.join(__dirname, 'dist'));
const staticFiles = new Map();
function collect(directory, prefix = '') {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    const relative = prefix + entry.name;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(full, relative + '/');
    else if (entry.isFile()) staticFiles.set(relative, full);
  }
}
collect(root);
const types = {'.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png',
  '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.ico':'image/x-icon',
  '.woff2':'font/woff2', '.json':'application/json; charset=utf-8'};
const hopHeaders = ['connection', 'proxy-connection', 'keep-alive', 'transfer-encoding',
  'upgrade', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer'];
function headersWithoutHop(headers) {
  const output = {...headers};
  for (const name of hopHeaders) delete output[name];
  return output;
}
function respond(res, status, message) {
  res.writeHead(status, {'Content-Type':'text/plain; charset=utf-8', 'Cache-Control':'no-store'});
  res.end(message);
}
function createPreviewServer({apiPort = 8789} = {}) {
  return http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const rawPath = (req.url || '/').split('?')[0];
    let pathname;
    try { pathname = decodeURIComponent(rawPath); }
    catch { respond(res, 400, 'Invalid URL'); return; }
    // Validate before URL normalization can erase traversal segments.
    if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0') ||
        pathname.split('/').some(segment => segment === '..' || segment === '.')) {
      respond(res, 400, 'Invalid path'); return;
    }
    if (pathname === '/' || pathname === '/ai-youth') {
      res.writeHead(302, {'Location':'/ai-youth/'}); res.end(); return;
    }
    if (pathname.startsWith('/ai-youth/api/')) {
      const headers = headersWithoutHop(req.headers);
      // Preserve origin checks including the local port; do not trust client forwarding headers.
      headers.host = req.headers.host || '127.0.0.1:4174';
      headers['x-real-ip'] = '127.0.0.1';
      headers['x-forwarded-proto'] = 'http';
      delete headers['x-forwarded-for'];
      const upstream = http.request({hostname:'127.0.0.1', port:apiPort, method:req.method,
        path:req.url.slice('/ai-youth'.length), headers}, proxy => {
        res.writeHead(proxy.statusCode, {...headersWithoutHop(proxy.headers), 'Cache-Control':'no-store'});
        proxy.pipe(res);
      });
      upstream.setTimeout(30000, () => upstream.destroy(new Error('API timeout')));
      upstream.on('error', () => {
        if (!res.headersSent) respond(res, 502, 'Local API is not running on 127.0.0.1:' + apiPort);
        else res.destroy();
      });
      req.on('aborted', () => upstream.destroy());
      req.pipe(upstream);
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.setHeader('Allow', 'GET, HEAD'); respond(res, 405, 'Method not allowed'); return;
    }
    if (!pathname.startsWith('/ai-youth/')) { respond(res, 404, 'Not found'); return; }
    const name = pathname === '/ai-youth/' ? 'index.html' : pathname.slice('/ai-youth/'.length);
    const file = staticFiles.get(name);
    if (!file) { respond(res, 404, 'Not found'); return; }
    try {
      const current = fs.realpathSync(file);
      if (current !== file || !current.startsWith(root + path.sep)) throw Error('Unsafe asset');
      const stat = fs.statSync(current);
      if (!stat.isFile()) throw Error('Not a file');
      res.writeHead(200, {'Content-Type':types[path.extname(name).toLowerCase()] || 'application/octet-stream',
        'Content-Length':stat.size});
      if (req.method === 'HEAD') res.end();
      else fs.createReadStream(current).on('error', () => res.destroy()).pipe(res);
    } catch { if (!res.headersSent) respond(res, 404, 'Not found'); else res.destroy(); }
  });
}
if (require.main === module) {
  createPreviewServer().listen(4174, '127.0.0.1', () => console.log('Preview: http://127.0.0.1:4174/ai-youth/'));
}
module.exports = {createPreviewServer};
