/* Isolated checks of the actual library's persistence queue and account lifecycle. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../dist/archive-library.js'), 'utf8');
function fixture() {
  const timers = new Map(), storage = new Map(); let nextTimer = 0;
  const context = vm.createContext({ console, URL, TextEncoder, Blob, window: {}, setTimeout: (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id), localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) } });
  const instrumented = source.replace('window.ArchiveLibrary = { markup, mount, destroy, flush, resetSession };', 'window.ArchiveLibrary = { markup, mount, destroy, flush, resetSession }; globalThis.audit = { getSession, persist, changed, load, sessions, normalize, spaceOf, spaceFolders, spaces, setActive: value => active = value };');
  vm.runInContext(instrumented, context);
  return { context, audit: context.audit, library: context.window.ArchiveLibrary, timers, storage };
}
const clean = () => ({ version: 1, folders: [], selected: null, canvasHeight: 540 });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
async function main() {
  {
    const f = fixture(), nodes = new Map(), eventHandlers = new Map();
    function element(selector) {
      if (nodes.has(selector)) return nodes.get(selector);
      const value = { dataset: {}, style: {}, attributes: {}, value: '', hidden: false, disabled: false, open: false, isConnected: true, innerHTML: '', textContent: '', clientWidth: 615, clientHeight: 540, offsetHeight: 20, scrollTop: 0, classList: { toggle() {}, add() {}, remove() {} }, setAttribute(name, value) { this.attributes[name] = value; }, getBoundingClientRect: () => ({ top: 0, bottom: 540 }), addEventListener: (type, handler) => eventHandlers.set(selector + ':' + type, handler), removeEventListener: type => eventHandlers.delete(selector + ':' + type), querySelector: child => element(selector + ' ' + child), querySelectorAll: () => [], close() { this.open = false; }, focus() {} };
      nodes.set(selector, value); return value;
    }
    const root = element('root'); root.querySelector = element; root.querySelectorAll = selector => selector === '.acs-editor-toggle' ? [element('.acs-editor-toggle')] : []; root.contains = () => true;
    f.context.window.addEventListener = () => {}; f.context.window.removeEventListener = () => {};
    const initial = { version: 1, folders: [{ id: 'mixed-folder', name: '参赛资料', type: 'mixed', purpose: '', cover: null, x: 0, y: 0, items: [] }, { id: 'brain-note', name: '我的想法', type: 'note', purpose: '', cover: null, x: 0, y: 0, items: [{ kind: 'note', text: '我喜欢做小游戏', public: false }] }], selected: 'mixed-folder', canvasHeight: 540 };
    const writes = [], navigation = []; let exits = 0;
    const libraryContext = { user: { id: 'detail-owner' }, files: [{ id: 'f1', name: '私人说明.txt' }], projects: [{ id: 'p1', title: '测试作品', summary: '自己的作品摘要' }], api: async (_route, method, payload) => { if (method === 'PUT') { writes.push(payload); return { workspace: payload.workspace, revision: writes.length }; } return { workspace: initial, revision: 0 }; }, toast() {}, nav(route) { navigation.push(route); }, async onExit() { await f.library.flush(); exits++; } };
    f.library.mount(root, libraryContext);
    for (let tick = 0; tick < 10 && f.audit.sessions.get('detail-owner').loading; tick++) await Promise.resolve();
    assert.equal(f.audit.sessions.get('detail-owner').loading, false);
    const detail = element('.acs-detail');
    function click(action, extra = {}) {
      const target = { dataset: { libraryAction: action, ...extra }, closest(selector) { if (selector === '[data-library-action]') return this; if (selector === '[data-folder]' && Object.hasOwn(detail.dataset, 'folder')) return detail; return null; } };
      return eventHandlers.get('root:click')({ target, stopPropagation() {} });
    }
    assert.equal(f.audit.sessions.get('detail-owner').workspace.folders[0].color, 'mint', 'Existing folders receive the compatible default palette color');
    assert.equal(root.dataset.editorOpen, 'false');
    await click('toggle-editor');
    assert.equal(root.dataset.editorOpen, 'true', 'The 615px computer editor opens on its first click');
    assert.equal(element('.acs-editor-toggle').attributes['aria-expanded'], 'true');
    await click('toggle-editor');
    assert.equal(root.dataset.editorOpen, 'false', 'The same editor toggle can close the panel');
    assert.equal(element('.acs-editor-toggle').attributes['aria-expanded'], 'false');
    element('.acs-detail textarea').value = '尚未提交的笔记';
    const beforeSwitch = JSON.stringify(f.audit.sessions.get('detail-owner').workspace);
    await click('switch-space', { space: 'notes' });
    assert.equal(element('.acs-space-title').textContent, '脑洞手记');
    assert.ok(element('.acs-canvas').innerHTML.includes('我的想法')); assert.ok(!element('.acs-canvas').innerHTML.includes('参赛资料'));
    assert.equal(writes.length, 0, 'Switching content spaces cannot trigger a private data write');
    assert.equal(JSON.stringify(f.audit.sessions.get('detail-owner').workspace), beforeSwitch, 'Switching content spaces cannot change the selected stored folder or move records');
    element('.acs-detail textarea').value = '';
    await click('switch-space', { space: 'high' });
    assert.equal(element('.acs-space-title').textContent, '高能档案');
    assert.ok(element('.acs-canvas').innerHTML.includes('参赛资料')); assert.ok(!element('.acs-canvas').innerHTML.includes('我的想法'));
    assert.equal(element('.acs-detail textarea').value, '尚未提交的笔记', 'Returning to a content space restores the unsubmitted text');
    const form = element('.acs-form'); form.elements = { kind: { value: '' }, appearance: { value: 'folder' } };
    await click('choose-kind', { kind: 'link' }); assert.equal(form.elements.kind.value, '', 'A new folder cannot select a type from the other space');
    await click('choose-kind', { kind: 'mixed' }); assert.equal(form.elements.kind.value, 'mixed');
    await click('change-color', { color: 'violet' });
    assert.equal(element('.acs-detail textarea').value, '尚未提交的笔记', 'Changing folder color must not erase a note being edited');
    await click('change-color', { color: 'url(javascript:evil)' });
    assert.equal(f.audit.sessions.get('detail-owner').workspace.folders[0].color, 'violet', 'Unknown palette input is ignored');
    element('.acs-detail [data-reference="file"]').value = 'f1'; await click('add-reference', { referenceKind: 'file' });
    element('.acs-detail [data-reference="project"]').value = 'p1'; await click('add-reference', { referenceKind: 'project' });
    element('.acs-detail textarea').value = '这次参赛负责交互设计。'; await click('add');
    await click('toggle-editor');
    await f.library.flush();
    assert.equal(root.dataset.editorOpen, 'true', 'Saving content cannot collapse an opened editor');
    const items = writes.at(-1).workspace.folders[0].items;
    assert.equal(items.length, 3, 'Clicks inside the detail panel must reach their action handler rather than reselect a folder: ' + JSON.stringify(items) + ' / ' + element('.acs-status').textContent);
    assert.deepEqual(Array.from(items, item => item.kind), ['file', 'project', 'note']);
    assert.equal(items[0].public, false); assert.equal(items[0].refId, 'f1'); assert.equal(items[1].refId, 'p1');
    assert.equal(writes.at(-1).workspace.folders[0].color, 'violet', 'The selected color travels with the saved workspace');
    const stored = f.audit.normalize(writes.at(-1).workspace);
    assert.equal(stored.folders[0].color, 'violet', 'Reading saved records preserves the palette key');
    assert.ok(detail.innerHTML.includes('私密文件不进入公开预览'));
    await click('exit');
    assert.equal(exits, 1, 'Return to My uses the internal view exit callback');
    assert.equal(navigation.length, 0, 'An internal exit does not change the route');
    delete libraryContext.onExit; await click('exit');
    assert.deepEqual(navigation, ['archive'], 'The exit retains the fallback for a standalone host');
    f.library.destroy();
    console.log('PASS two spaces without writes; drafts and colors persist; editor toggle survives save; internal exit and fallback');
  }
  {
    const f = fixture(), calls = [], first = deferred();
    const session = f.audit.getSession({ user: { id: 'a' }, api: async (route, method, payload) => { calls.push({ route, method, payload }); if (calls.length === 1) return first.promise; return { workspace: payload.workspace, revision: 2 }; } });
    session.loaded = true; session.workspace.folders = [{ id: 'f1', name: '初稿', type: 'note', purpose: '', x: 0, y: 0, cover: null, items: [] }];
    f.audit.changed(session); const save1 = f.audit.persist(session); assert.equal(calls.length, 1);
    session.workspace.folders[0].name = '第二次修改'; f.audit.changed(session); await f.audit.persist(session); assert.equal(calls.length, 1, 'Do not send a second PUT before the first revision returns');
    first.resolve({ workspace: calls[0].payload.workspace, revision: 1 }); await save1;
    assert.equal(session.workspace.folders[0].name, '第二次修改', 'A late save cannot overwrite newer local edits'); assert.equal(session.dirty, true);
    await f.audit.persist(session); assert.equal(calls[1].payload.revision, 1); assert.equal(calls[1].payload.workspace.folders[0].name, '第二次修改'); assert.equal(session.dirty, false);
    console.log('PASS queued edits retain newer text and use the returned revision');
  }
  {
    const f = fixture(); let puts = 0;
    const session = f.audit.getSession({ user: { id: 'a' }, api: async () => { puts++; throw Error('版本发生变化，请重新读取'); } });
    session.loaded = true; session.workspace.folders = [{ id: 'f1', name: '我的未保存版本', type: 'note', purpose: '', x: 0, y: 0, cover: null, items: [] }];
    f.audit.changed(session); await f.audit.persist(session); assert.equal(session.blocked, true); assert.equal(session.workspace.folders[0].name, '我的未保存版本');
    f.audit.changed(session); await f.audit.persist(session); assert.equal(puts, 1, 'Conflicts pause retries rather than silently overwrite');
    await assert.rejects(f.library.flush(), /未保存/, 'An unmounted blocked account must still prevent silent loss at login');
    console.log('PASS conflicts keep the exportable draft and stop automatic retries');
  }
  {
    const f = fixture(), waiting = deferred(); let puts = 0;
    const old = f.audit.getSession({ user: { id: 'old' }, api: async () => { puts++; return waiting.promise; } }); old.loaded = true;
    f.audit.changed(old); const prior = f.audit.persist(old); f.library.resetSession();
    const current = f.audit.getSession({ user: { id: 'new' }, api: async () => { throw Error('Unexpected old write using new account'); } });
    waiting.resolve({ workspace: { ...clean(), selected: 'private-old' }, revision: 99 }); await prior;
    assert.equal(current.revision, 0); assert.equal(current.workspace.folders.length, 0); assert.equal(old.valid, false); assert.equal(f.audit.sessions.size, 1);
    await f.audit.persist(old); assert.equal(puts, 1, 'Old queued writes never reuse a new account cookie');
    console.log('PASS logout/reset clears private caches and invalidates old async callbacks');
  }
  {
    const f = fixture(), session = f.audit.getSession({ user: null, api: null });
    session.workspace.folders.push({ id: 'n', name: '本机记录', type: 'note', purpose: '', x: 0, y: 0, cover: null, items: [] }); f.audit.changed(session); await f.audit.persist(session);
    assert.ok(f.storage.has('discovery-archive-library-draft-v1')); assert.equal(f.storage.has('youth-archive-workspace-draft-v1'), false, 'Never change the second-part prototype key');
    assert.equal(session.dirty, false); console.log('PASS browser drafts use a separate key');
  }
  {
    const f = fixture(), normalized = f.audit.normalize({ version: 1, folders: [{ id: 'file1', name: '<b>name</b>', type: 'file', items: [{ kind: 'file', refId: 'foreign-file', text: 'secret', public: true }, { kind: 'project', refId: 'gone', text: 'old summary', public: true, unavailable: true }] }], canvasHeight: 20000 });
    assert.equal(normalized.folders[0].items[0].public, false); assert.equal(normalized.folders[0].items[1].public, false); assert.equal(normalized.canvasHeight, 12000);
    const html = f.library.markup(); assert.ok(html.includes('data-library-action="new"')); assert.ok(!html.includes('data-action=')); assert.ok(html.includes('参赛历程'));
    assert.equal((html.match(/data-library-action="switch-space"/g) || []).length, 2, 'The left rail exposes exactly two content entries');
    assert.ok(!html.includes('data-library-action="filter-kind"'), 'Fine-grained types are not extra left navigation entries');
    assert.ok(html.includes('data-library-action="exit"'), 'The private workspace has an internal return-to-profile action');
    assert.ok(!html.includes('href="#archive"'), 'Returning to My uses an action even while the current route is already archive');
    assert.ok(html.includes('aria-controls="acs-inspector"'));
    const css = fs.readFileSync(path.resolve(__dirname, '../dist/archive-library.css'), 'utf8');
    assert.ok(css.includes('#archive-canvas-studio[data-editor-open="true"] .acs-inspector { display: flex; }'), 'The open editor explicitly restores display in narrow computer windows');
    assert.ok(css.includes('position: absolute; grid-column: auto; grid-row: auto;'), 'The narrow editor cannot inherit a nonexistent third grid column');
    const inspector = html.indexOf('class="acs-inspector"');
    assert.ok(inspector > html.indexOf('class="acs-stage"'), 'The editor follows the canvas, as a separate right panel');
    assert.ok(html.indexOf('class="acs-detail"') > inspector, 'Folder editing is not embedded in the left tool rail');
    console.log('PASS private/deleted references are never selected for preview; actions do not collide');
  }
  {
    const f = fixture(), legacy = ['file', 'project', 'event', 'mixed', 'message', 'note', 'link'].map((type, index) => ({ id: 'legacy' + index, name: '旧文件夹' + index, type, items: [{ kind: 'note', text: '原有文字' + index }] }));
    const workspace = f.audit.normalize({ version: 1, folders: legacy, selected: 'legacy5', canvasHeight: 540 });
    assert.equal(workspace.folders.length, legacy.length, 'Grouping does not migrate or drop legacy folders');
    assert.deepEqual(Array.from(f.audit.spaceFolders(workspace.folders, 'high'), folder => folder.type), ['file', 'project', 'event', 'mixed']);
    assert.deepEqual(Array.from(f.audit.spaceFolders(workspace.folders, 'notes'), folder => folder.type), ['message', 'note', 'link']);
    assert.equal(f.audit.spaceOf(workspace.folders.find(folder => folder.id === workspace.selected).type), 'notes', 'The saved selected old folder determines the initial content space');
    assert.equal(f.audit.spaceFolders(workspace.folders, 'high')[3].items[0].text, '原有文字3', 'Mixed folders keep their existing text in the works space');
    console.log('PASS all seven legacy folder types map once to two spaces; mixed-folder text remains intact');
  }
  {
    const f = fixture(), palette = ['mint', 'lime', 'sky', 'violet', 'pink', 'sand', 'white'];
    const normalized = f.audit.normalize({ version: 1, folders: [...palette, 'invalid', 'white" style="background:red'].map((color, index) => ({ id: 'color' + index, name: 'color check', type: 'note', color, items: [] })) });
    assert.deepEqual(Array.from(normalized.folders.slice(0, 7), folder => folder.color), palette);
    assert.equal(normalized.folders[7].color, 'mint'); assert.equal(normalized.folders[8].color, 'mint');
    const css = fs.readFileSync(path.resolve(__dirname, '../dist/archive-library.css'), 'utf8');
    for (const color of palette) assert.ok(css.includes('[data-color="' + color + '"]'), 'Every stored palette color has a fixed CSS rule');
    console.log('PASS seven fixed folder colors; invalid stored colors normalize to mint');
  }
  {
    const f = fixture(), wait = deferred(), session = f.audit.getSession({ user: { id: 'a' }, api: async () => wait.promise });
    const loading = f.audit.load(session); f.library.resetSession(); wait.resolve({ workspace: { ...clean(), folders: [{ id: 'secret', type: 'note', name: 'old private', items: [] }] }, revision: 8 }); await loading;
    assert.equal(session.loaded, false); assert.equal(f.audit.sessions.size, 0);
    console.log('PASS late private reads after account reset cannot repopulate a cache');
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
