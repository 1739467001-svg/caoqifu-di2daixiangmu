/* Retained local preview session. Private data stays outside the public dist. */
const {spawn} = require('node:child_process');
const path = require('node:path');
const {createPreviewServer} = require('../../preview.cjs');
const root = path.resolve(__dirname, '../..');
const python = 'C:/Users/xyzaa/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
const children = [];
for (const [apiPort, previewPort, dataName] of [[8789, 4174, 'local-preview-test-data'], [8788, 4184, 'library-ui-test-data']]) {
  children.push(spawn(python, ['backend/server.py', '--port', String(apiPort)], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'ignore', 'inherit'],
    env: {...process.env, ARCHIVE_DATA_DIR:path.join(root, '.private-notes', dataName), ARCHIVE_SECURE_COOKIE:'0', ARCHIVE_COOKIE_PATH:'/ai-youth/'}
  }));
  createPreviewServer({apiPort}).listen(previewPort, '127.0.0.1', () => console.log('Local preview http://127.0.0.1:' + previewPort + '/ai-youth/'));
}
function stop() { children.forEach(child => child.kill()); process.exit(0); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
