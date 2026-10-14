/* Independent private archive workspace. No chain/publication is performed. */
(function () {
  'use strict';
  const DRAFT_KEY = 'discovery-archive-library-draft-v1';
  const OLD_KEY = 'youth-archive-workspace-draft-v1';
  const kinds = { message: '消息与对话', note: '制作笔记', file: '图片与文件', link: '参考链接', project: '作品档案', event: '参赛历程', mixed: '混合资料' };
  const colors = { mint: '薄荷绿', lime: '黄绿色', sky: '浅蓝色', violet: '浅紫色', pink: '浅粉色', sand: '浅砂色', white: '白色' };
  const safeColor = value => Object.hasOwn(colors, value) ? value : 'mint';
  const spaces = {
    high: { name: '高能档案', note: '作品 · 文件 · 参赛经历', types: ['file', 'project', 'event', 'mixed'], empty: '保存作品、资料文件和参赛经历', example: '建一个“我的作品集”或“这次黑客松”，把相关资料收在一起。' },
    notes: { name: '脑洞手记', note: '文字 · 想法 · 自我介绍', types: ['message', 'note', 'link'], empty: '留下想法，也记录你自己', example: '新建一份想法笔记、自我介绍，或保存交流中的建议和参考链接。' }
  };
  const spaceOf = type => spaces.notes.types.includes(type) ? 'notes' : 'high';
  const spaceFolders = (folders, space) => folders.filter(folder => spaceOf(folder.type) === space);
  const spaceIcon = space => space === 'high' ? '<svg viewBox="0 0 48 48" aria-hidden="true"><ellipse cx="24" cy="25" rx="22" ry="12" transform="rotate(-20 24 25)" fill="none" stroke="currentColor" stroke-opacity=".35" stroke-width="1.5"/><path d="M10 25h4v-4h5v-4h14v4h5v4h3v7h-5v4H17v-4h-7Z" fill="#b8e675" stroke="currentColor" stroke-width="1.6"/><path d="M21 12h9v10h-9Z" fill="#fff" stroke="currentColor" stroke-width="1.6"/><path d="m19 13 6-5 7 5M25 17v5M17 29h15" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M38 5v6M35 8h6" stroke="#2a9272" stroke-width="1.5"/></svg>' : '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M12 16h24v24H12Z" fill="#b8e675" stroke="currentColor" stroke-width="1.6" transform="rotate(6 24 28)"/><rect x="8" y="7" width="28" height="26" rx="3" fill="#fff" stroke="currentColor" stroke-width="1.6" transform="rotate(-6 22 20)"/><path d="M15 15h9M15 21h15M15 27h11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M31 4h7v5" fill="none" stroke="#2a9272" stroke-width="1.5" stroke-dasharray="2 2"/></svg>';
  const sessions = new Map();
  let active = null, authOwner = null;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = value => Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : 0;
  const copy = value => JSON.parse(JSON.stringify(value));
  const empty = () => ({ version: 1, folders: [], selected: null, canvasHeight: 540 });
  const validCover = value => value === 'sample' || typeof value === 'string' && value.length <= 720000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value);
  function safeLink(value) {
    try { const url = new URL(String(value)); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
  }
  function normalize(input) {
    if (!input || input.version !== 1 || !Array.isArray(input.folders)) return empty();
    const ids = new Set();
    const folders = input.folders.slice(0, 40).filter(f => f && typeof f.id === 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(f.id) && !ids.has(f.id) && ids.add(f.id) && Object.hasOwn(kinds, f.type)).map(f => ({
      id: f.id, name: String(f.name || '文件夹').slice(0, 60), type: f.type, purpose: String(f.purpose || '').slice(0, 1000), cover: validCover(f.cover) ? f.cover : null, color: safeColor(f.color),
      x: clamp(f.x), y: clamp(f.y), items: (Array.isArray(f.items) ? f.items : []).slice(0, 60).filter(i => i && typeof i === 'object').map(i => {
        const kind = ['message', 'note', 'file', 'link', 'project', 'event'].includes(i.kind) ? i.kind : 'note';
        return { kind, text: String(i.text || '').slice(0, 4000), source: String(i.source || '本人整理').slice(0, 300), refId: String(i.refId || '').slice(0, 100), picture: i.picture === true, public: kind !== 'file' && !i.unavailable && i.public === true, unavailable: i.unavailable === true };
      })
    }));
    return { version: 1, folders, selected: folders.some(f => f.id === input.selected) ? input.selected : null, canvasHeight: Math.max(540, Math.min(12000, Number(input.canvasHeight) || 540)) };
  }
  const button = (action, text, extra = '') => '<button type="button" data-library-action="' + action + '" ' + extra + '>' + text + '</button>';
  function markup() {
    const choices = Object.entries(kinds).map(([kind, label]) => button('choose-kind', '<b>' + label + '</b><span>' + ({ message: '留下交流和建议', note: '记录文字、想法和自我介绍', file: '放入已上传的私人文件', link: '保存网页或作品网址', project: '关联自己的作品档案', event: '记录比赛、日期和个人贡献', mixed: '围绕一个作品整理资料' }[kind]) + '</span>', 'class="acs-choice" data-kind="' + kind + '" aria-pressed="false"')).join('');
    const filters = Object.entries(spaces).map(([space, value]) => button('switch-space', '<span class="acs-space-art" aria-hidden="true"></span><span class="acs-space-copy"><b>' + value.name + '</b><small>' + value.note + '</small></span><span class="acs-space-count" data-space-count="' + space + '">0</span>', 'class="acs-space" data-space="' + space + '" aria-pressed="' + (space === 'high') + '"')).join('');
    return '<section id="archive-canvas-studio" aria-label="我的创作档案馆"><div class="acs-shell"><header class="acs-chrome"><div class="acs-title-group">' + button('exit', '← 返回我的', 'class="acs-back"') + '<span class="acs-chrome-divider" aria-hidden="true"></span><div><h2>创作档案馆</h2><span class="acs-small acs-title-note">把作品和资料放好，也把新想法留下。</span></div></div><div class="acs-chrome-meta"><span class="acs-badge">私人空间</span>' + button('toggle-editor', '资料编辑', 'class="acs-quiet-button acs-editor-toggle" aria-expanded="false" aria-controls="acs-inspector"') + button('export', '导出记录', 'class="acs-quiet-button" aria-label="导出整理记录"') + '</div></header>' +
      '<section class="acs-layout" aria-label="左侧工具、中间画布、右侧资料编辑"><aside class="acs-rail" aria-label="档案馆工具"><div class="acs-tools-head"><span class="acs-section-label">我的两个空间</span></div><div class="acs-tools"><div class="acs-spaces" role="group" aria-label="选择档案空间">' + filters + '</div>' + button('new', '<span aria-hidden="true">＋</span> 新建文件夹', 'class="acs-wide acs-primary acs-new-button"') + '<hr><div class="acs-utility-tools">' + button('files', '上传与管理文件', 'class="acs-wide"') + button('import', '导入旧浏览器草稿', 'class="acs-wide"') + '</div><details class="acs-plan acs-help"><summary>存储与隐私说明</summary><p>登录后，文件夹和文字保存在账号中；未登录只保存在此浏览器。私密附件不会公开。</p><p>旧草稿只能从当前网址读取，不会自动迁移其他网址的记录。</p><p>导出包含布局、文字和引用；附件需要另行下载。尚未提供自动备份或链上记录。</p></details>' + button('reload', '重新读取保存记录', 'class="acs-wide acs-reload" hidden') + '</div></aside><div class="acs-stage"><div class="acs-canvas-head"><div class="acs-canvas-title"><span class="acs-grid-mark" aria-hidden="true">▦</span><span class="acs-space-title">高能档案</span><span class="acs-canvas-count">0 个文件夹</span></div><span class="acs-canvas-hint">拖动摆放 · 点击整理</span></div><div class="acs-canvas" role="group" aria-label="私人文件夹画布"></div><section class="acs-public" aria-label="选中内容公开预览" hidden></section><div class="acs-stage-foot"><span>内容默认私人，仅自己可见</span><span>方向键也能移动</span></div></div><aside class="acs-inspector" id="acs-inspector" aria-label="文件夹资料编辑"><div class="acs-inspector-head"><h3>资料编辑</h3>' + button('toggle-editor', '×', 'class="acs-quiet-button acs-inspector-close" aria-label="收起资料编辑"') + '</div><div class="acs-detail"></div></aside></section><footer class="acs-workspace-foot"><p class="acs-status" role="status" aria-live="polite">正在读取资料…</p><span>私人整理 · 未上链</span></footer></div>' +
      '<dialog class="acs-wizard" aria-labelledby="acs-question-0"><form class="acs-form" novalidate hidden><div class="acs-wizard-head"><span class="acs-form-title">新建文件夹</span>' + button('cancel', '×', 'class="acs-quiet-button" aria-label="关闭文件夹设置"') + '</div><div class="acs-step-meta"><span class="acs-step-count" aria-live="polite">第 1 / 4 步</span><div class="acs-step-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></div></div>' +
      '<div class="acs-question" data-step="0"><h3 id="acs-question-0">这个文件夹叫什么？</h3><p class="acs-small">例如“这次黑客松”或“我的小游戏”。</p><label class="acs-field">文件夹名称<input name="folderName" aria-label="文件夹名称" maxlength="60" required placeholder="起一个容易找的名字"></label></div>' +
      '<div class="acs-question" data-step="1" hidden><h3 id="acs-question-1">你想用它保存什么？</h3><p class="acs-small">选一个主要类型，之后可以修改。</p><input type="hidden" name="kind"><div class="acs-choice-list" role="group" aria-label="保存内容类型">' + choices + '</div></div>' +
      '<div class="acs-question" data-step="2" hidden><h3 id="acs-question-2">它主要用来做什么？</h3><p class="acs-small">写一句用途，也可以先空着。</p><label class="acs-field">文件夹用途<textarea name="purpose" aria-label="文件夹用途" maxlength="1000" placeholder="例如：收集参赛作品、路演材料和伙伴建议"></textarea></label></div>' +
      '<div class="acs-question" data-step="3" hidden><h3 id="acs-question-3">要放一张封面吗？</h3><p class="acs-small">不放图片，就显示文件夹里的内容。</p><input type="hidden" name="appearance" value="folder"><div class="acs-choice-list acs-cover-choice" role="group" aria-label="封面选择">' + button('choose-cover', '<b>暂时不放</b><span>显示里面的内容</span>', 'class="acs-choice" data-cover="folder" aria-pressed="true"') + button('choose-cover', '<b>放一张图片</b><span>使用自己的封面</span>', 'class="acs-choice" data-cover="cover" aria-pressed="false"') + '</div><div class="acs-cover-fields" hidden><label class="acs-field">选择封面图片<input type="file" name="coverFile" aria-label="选择封面图片" accept="image/png,image/jpeg,image/webp"></label>' + button('sample-cover', '试用几何示例封面', 'class="acs-wide"') + '<div class="acs-cover-preview" hidden></div><p class="acs-small">PNG、JPG、WebP，512KB以内。登录时随私人文件夹记录保存。</p></div></div><p class="acs-wizard-message" role="alert" hidden></p><div class="acs-wizard-foot">' + button('cancel', '取消') + '<div class="acs-row">' + button('step-back', '上一步', 'hidden') + '<button type="submit" class="acs-primary acs-step-next">下一步</button></div></div></form></dialog></section>';
  }
  function announce(session) { session.listeners.forEach(listener => listener()); }
  function statusText(session) {
    if (session.loading) return '正在读取账号中的文件夹…';
    if (session.error) return session.error + ' 当前内容仍在本页，可先导出记录。';
    if (session.busy || session.dirty) return session.account ? '正在保存私人整理记录…' : '正在保存到此浏览器…';
    if (session.account && session.revision === 0 && !session.workspace.folders.length) return '账号档案馆已打开 · 可新建文件夹';
    if (!session.account && !session.hasDraft && !session.workspace.folders.length) return '本浏览器草稿 · 新建后保存';
    return session.account ? '已保存到此账号 · 私人资料 · 未上链' : '已保存在此浏览器 · 不是云端备份';
  }
  async function persist(session, keepalive = false) {
    clearTimeout(session.timer);
    if (!session.valid || !session.dirty || session.busy || session.blocked || session.loading) return;
    if (!session.account) {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(session.workspace)); session.dirty = false; session.error = ''; session.hasDraft = true; }
      catch { session.error = '此浏览器保存失败。请导出记录，或减少封面图片'; session.blocked = true; }
      announce(session); return;
    }
    if (authOwner !== session.key) return;
    const serial = session.serial, payload = { workspace: copy(session.workspace), revision: session.revision };
    const encoded = JSON.stringify(payload);
    if (keepalive && new TextEncoder().encode(encoded).length > 60000) return;
    session.busy = true; announce(session);
    const operation = (async () => {
      try {
        let response;
        if (keepalive) {
          const result = await fetch('api/archive-workspace', { method: 'PUT', credentials: 'same-origin', cache: 'no-store', keepalive: true, headers: { 'Content-Type': 'application/json', 'X-Archive-Client': '1' }, body: encoded });
          response = await result.json(); if (!result.ok) throw Error(response.error || '保存未完成');
        } else response = await session.api('/archive-workspace', 'PUT', payload);
        if (!session.valid) return;
        session.revision = response.revision;
        // Keep live folder objects and input focus stable while a save finishes.
        // Canonical server data is read on the next mount/reload, never mid-drag.
        if (serial === session.serial) session.dirty = false;
        session.error = '';
      } catch (error) {
        if (!session.valid) return;
        session.blocked = true;
        const reason = String(error.message || '保存失败');
        session.error = /版本|冲突|其他|重新读取|更新/.test(reason) ? '保存记录已变化，为避免覆盖，自动保存已暂停' : reason + '；自动保存已暂停';
      } finally {
        session.busy = false; session.pending = null; announce(session);
        if (session.valid && session.dirty && !session.blocked && authOwner === session.key) session.timer = setTimeout(() => persist(session), 100);
      }
    })();
    session.pending = operation; return operation;
  }
  function changed(session) {
    session.serial++; session.dirty = true; announce(session);
    clearTimeout(session.timer);
    if (!session.blocked) session.timer = setTimeout(() => persist(session), 180);
  }
  function getSession(context) {
    const key = context.user ? String(context.user.id) : 'guest';
    authOwner = key;
    let session = sessions.get(key);
    if (!session) {
      session = { key, account: !!context.user, api: context.api, workspace: empty(), revision: 0, serial: 0, dirty: false, busy: false, loading: false, loaded: false, hasDraft: false, blocked: false, error: '', valid: true, listeners: new Set(), timer: null, pending: null, loadSerial: 0 };
      sessions.set(key, session);
      if (!context.user) {
        try { const stored = localStorage.getItem(DRAFT_KEY); session.workspace = normalize(JSON.parse(stored || 'null')); session.hasDraft = !!stored; }
        catch { session.error = '本浏览器记录无法读取，原记录没有被改动'; session.blocked = true; }
        session.loaded = true;
      }
    }
    session.api = context.api; return session;
  }
  async function load(session, discard = false) {
    if (!session.account || session.busy || session.loading || !discard && session.dirty) return;
    const token = ++session.loadSerial;
    session.loading = true; announce(session);
    try {
      const result = await session.api('/archive-workspace');
      if (!session.valid || token !== session.loadSerial || authOwner !== session.key) return;
      session.workspace = normalize(result.workspace); session.revision = result.revision; session.loaded = true; session.dirty = false; session.blocked = false; session.error = '';
    } catch (error) {
      if (!session.valid || token !== session.loadSerial) return;
      session.error = String(error.message || '记录读取失败'); session.blocked = true;
    } finally { if (session.valid && token === session.loadSerial) { session.loading = false; announce(session); } }
  }
  function mount(root, context) {
    destroy();
    const session = getSession(context), handlers = [];
    let alive = true, mode = 'canvas', currentSpace = 'high', spaceInitialized = false, viewSelected = null, editing = null, wizardStep = 0, coverDraft = null, coverRequest = 0, coverBusy = false, formTrigger = null, drag = null, skipClick = false;
    const editorDrafts = new Map(), spaceSelections = new Map();
    let renderedWorkspace = null;
    const q = selector => root.querySelector(selector), canvas = q('.acs-canvas'), detail = q('.acs-detail'), stage = q('.acs-stage'), publicView = q('.acs-public'), dialog = q('.acs-wizard'), form = q('.acs-form'), nextButton = q('.acs-step-next'), status = q('.acs-status');
    const workspace = () => session.workspace, folders = () => workspace().folders, chosen = () => folders().find(f => f.id === viewSelected && spaceOf(f.type) === currentSpace);
    const listen = (target, type, handler) => { target.addEventListener(type, handler); handlers.push(() => target.removeEventListener(type, handler)); };
    const message = text => { status.textContent = text; };
    const ready = () => { if (session.loading || session.account && !session.loaded) { message('先等账号资料读取完成；读取失败时请重新读取。'); return false; } return true; };
    function setEditor(open) {
      root.dataset.editorOpen = String(open);
      root.querySelectorAll('.acs-editor-toggle').forEach(element => element.setAttribute('aria-expanded', String(open)));
    }
    setEditor(false);
    const scene = () => '<div class="acs-scene"><b>创作资料</b></div>';
    const coverMarkup = cover => cover === 'sample' ? scene() : '<img alt="文件夹封面" src="' + esc(cover) + '">';
    function place() {
      if (!alive) return;
      const columns = canvas.clientWidth < 480 ? 2 : 3;
      canvas.style.minHeight = Math.max(workspace().canvasHeight, Math.ceil(folders().length / columns) * 195) + 'px';
      for (const folder of folders()) {
        const element = Array.from(canvas.querySelectorAll('[data-folder]')).find(el => el.dataset.folder === folder.id); if (!element) continue;
        element.style.left = 12 + folder.x * Math.max(0, canvas.clientWidth - element.offsetWidth - 24) + 'px';
        element.style.top = 24 + folder.y * Math.max(0, canvas.clientHeight - element.offsetHeight - 42) + 'px';
      }
    }
    function drawCanvas() {
      const visible = spaceFolders(folders(), currentSpace);
      root.querySelectorAll('[data-space-count]').forEach(element => { element.textContent = spaceFolders(folders(), element.dataset.spaceCount).length; });
      root.querySelectorAll('[data-space]').forEach(element => element.setAttribute('aria-pressed', String(element.dataset.space === currentSpace)));
      root.dataset.space = currentSpace;
      q('.acs-space-title').textContent = spaces[currentSpace].name;
      q('.acs-canvas-count').textContent = visible.length + ' 个文件夹';
      canvas.innerHTML = visible.length ? visible.map(f => '<button type="button" class="acs-folder" data-folder="' + esc(f.id) + '" data-color="' + safeColor(f.color) + '" aria-pressed="' + (f.id === viewSelected) + '" aria-label="打开' + esc(f.name) + '，可拖动或用方向键移动">' +
        (f.cover ? '<div class="acs-cover">' + coverMarkup(f.cover) + '</div>' : '<div class="acs-thumbs">' + (f.items.length ? f.items.slice(0, 2).map(i => '<div class="acs-thumb"><span class="acs-thumb-kind">' + esc(kinds[i.kind] || kinds[f.type]) + '</span>' + esc(i.text) + '</div>').join('') : '<div class="acs-thumb"><span class="acs-thumb-kind">文件夹</span>还没放内容</div>') + '</div>') + '<span class="acs-folder-name" title="' + esc(f.name) + '">' + esc(f.name) + '</span><span class="acs-folder-meta">' + kinds[f.type] + ' · ' + f.items.length + '条</span></button>').join('') : '<div class="acs-empty-canvas"><span class="acs-empty-icon">' + spaceIcon(currentSpace) + '</span><h3>' + spaces[currentSpace].empty + '</h3><p>' + spaces[currentSpace].example + '</p>' + button('new', '＋ 新建文件夹', 'class="acs-primary"') + '</div>';
      place();
    }
    function revealFolder() {
      const element = Array.from(canvas.querySelectorAll('[data-folder]')).find(el => el.dataset.folder === viewSelected); if (!element) return;
      const box = element.getBoundingClientRect(), viewport = stage.getBoundingClientRect(), head = q('.acs-canvas-head').offsetHeight, foot = q('.acs-stage-foot').offsetHeight;
      if (box.bottom > viewport.bottom - foot - 16) stage.scrollTop += box.bottom - viewport.bottom + foot + 16;
      else if (box.top < viewport.top + head + 16) stage.scrollTop -= viewport.top + head + 16 - box.top;
    }
    function references(kind) {
      const values = kind === 'file' ? (context.files || []) : (context.projects || []);
      return '<label class="acs-field">' + (kind === 'file' ? '选择已上传的私密文件' : '选择自己的作品') + '<select class="acs-reference-select" data-reference="' + kind + '" aria-label="' + (kind === 'file' ? '选择已上传的私密文件' : '选择自己的作品') + '"><option value="">请选择</option>' + values.map(value => '<option value="' + esc(value.id) + '">' + esc(value.name || value.title) + '</option>').join('') + '</select></label>' + button('add-reference', kind === 'file' ? '放入这个文件' : '放入这件作品', 'class="acs-wide" data-reference-kind="' + kind + '"');
    }
    function itemMarkup(item, index) {
      let destination = '';
      if (!item.unavailable && item.kind === 'file' && context.user && (context.files || []).some(f => String(f.id) === item.refId)) destination = '<a class="acs-quiet-button" href="api/files/' + encodeURIComponent(item.refId) + '/download" download>下载私密文件</a>';
      if (!item.unavailable && item.kind === 'project' && (context.projects || []).some(p => String(p.id) === item.refId)) destination = '<a class="acs-quiet-button" href="#project/' + encodeURIComponent(item.refId) + '">查看作品档案</a>';
      if (item.kind === 'link' && safeLink(item.text)) destination = '<a class="acs-quiet-button" href="' + esc(safeLink(item.text)) + '" target="_blank" rel="noopener noreferrer">打开链接 ↗</a>';
      return '<div class="acs-item"><p>' + esc(item.text) + '</p><small>' + esc(item.source) + '</small>' + (item.kind === 'event' ? '<p class="acs-small">本人填写，未经过比赛方确认。</p>' : '') + (item.unavailable ? '<p class="acs-small">原资料已删除，仍保留此文字记录。</p>' : '') + '<div class="acs-row">' + destination + button('remove-item', '移出', 'class="acs-quiet-button acs-delete" data-item="' + index + '" aria-label="移出第' + (index + 1) + '条内容"') + '</div>' + (item.kind === 'file' || item.unavailable ? '<p class="acs-small">' + (item.kind === 'file' ? '私密文件不进入公开预览。' : '已删除的原资料不进入公开预览。') + '</p>' : '<label class="acs-check"><input type="checkbox" data-share="' + index + '" ' + (item.public ? 'checked' : '') + '>放进公开预览（不会发布）</label>') + '</div>';
    }
    function drawDetail() {
      const folder = chosen();
      detail.dataset.activeFolder = folder?.id || '';
      if (!folder) { detail.innerHTML = '<div class="acs-inspector-empty"><span aria-hidden="true">▤</span><h3>选择一个文件夹</h3><p>点击画布中的文件夹，在这里添加笔记、整理资料或修改颜色。</p></div>'; return; }
      const textLabel = folder.type === 'event' ? '参赛笔记（本人填写）' : folder.type === 'message' ? '保存一段交流或建议' : folder.type === 'link' ? '网页链接' : folder.type === 'note' ? '添加文字、想法或自我介绍' : '添加一条制作笔记';
      const placeholder = folder.type === 'event' ? '比赛名称、参加日期、你的贡献和材料链接。获奖情况请标明来源。' : folder.type === 'link' ? 'https://…' : folder.type === 'note' ? '可以写一个新想法、今天的进展，或介绍你喜欢做什么。' : '写下内容，或粘贴一段你想保存的消息';
      let inputs = '';
      if (folder.type === 'file' || folder.type === 'mixed') inputs += context.user ? references('file') : '<p class="acs-small">登录后，才能关联账号中的资料文件。</p>';
      if (folder.type === 'project' || folder.type === 'mixed') inputs += references('project');
      if (folder.type !== 'file') inputs += '<label class="acs-field">' + textLabel + '<textarea aria-label="新增文件夹内容" maxlength="4000" placeholder="' + placeholder + '"></textarea></label>' + button('add', '放进文件夹', 'class="acs-wide"');
      const palette = Object.entries(colors).map(([color, label]) => button('change-color', '<span aria-hidden="true">' + (safeColor(folder.color) === color ? '✓' : '') + '</span>', 'class="acs-color" data-color="' + color + '" aria-label="文件夹颜色：' + label + '" title="' + label + '" aria-pressed="' + (safeColor(folder.color) === color) + '"')).join('');
      detail.innerHTML = '<div class="acs-detail-heading"><h3>' + esc(folder.name) + '</h3><div class="acs-small">' + kinds[folder.type] + ' · 私人整理</div></div><p class="acs-purpose">' + esc(folder.purpose || '还没有填写用途') + '</p><div class="acs-color-field"><span>文件夹颜色</span><div class="acs-palette" role="group" aria-label="选择文件夹颜色">' + palette + '</div></div>' + button('edit', '修改名称、类型与封面', 'class="acs-wide"') + '<section class="acs-add-section"><h4>放入资料</h4>' + inputs + '</section><section class="acs-content-section"><h4>已收录 · ' + folder.items.length + ' 条</h4><div class="acs-items">' + (folder.items.length ? folder.items.map(itemMarkup).join('') : '<div class="acs-empty">这个文件夹还空着。</div>') + '</div></section>' + button('preview', mode === 'canvas' ? '预览选中的公开文字' : '返回私人画布', 'class="acs-wide acs-preview-button"') + button('remove-folder', '移出这个文件夹', 'class="acs-wide acs-delete"');
      restoreEditorDraft();
    }
    function renderPublic() {
      const folder = chosen(); if (!folder) return;
      const items = folder.items.filter(item => item.public && item.kind !== 'file' && !item.unavailable);
      publicView.innerHTML = '<div class="acs-row"><h3>选中内容预览</h3>' + button('preview', '返回私人画布', 'class="acs-quiet-button"') + '</div><p class="acs-small">这里只展示你勾选的文字；没有发布到社区，没有上链，不包含附件或封面。</p><h3 class="acs-public-title">' + esc(folder.name) + '</h3>' + (items.length ? items.map(item => '<div class="acs-item"><p>' + esc(item.text) + '</p><small>' + esc(item.source) + '</small>' + (item.kind === 'event' ? '<p class="acs-small">参赛情况由本人填写，未经过比赛方确认。</p>' : '') + '</div>').join('') : '<p class="acs-small">还没有选内容，请在资料编辑区勾选想展示的文字。</p>') + '<p class="acs-plan">只预览这' + items.length + '条文字 · 尚未发布</p>';
    }
    function showCanvas() { mode = 'canvas'; canvas.hidden = false; publicView.hidden = true; q('.acs-canvas-head').hidden = false; }
    function rememberEditorDraft() {
      const id = detail.dataset.activeFolder; if (!id) return;
      editorDrafts.set(id, { text: detail.querySelector('textarea')?.value, selections: Array.from(detail.querySelectorAll('[data-reference]')).map(element => [element.dataset.reference, element.value]) });
    }
    function restoreEditorDraft() {
      const draft = editorDrafts.get(detail.dataset.activeFolder); if (!draft) return;
      const input = detail.querySelector('textarea'); if (input && draft.text !== undefined) input.value = draft.text;
      draft.selections.forEach(([kind, value]) => { const select = detail.querySelector('[data-reference="' + kind + '"]'); if (select) select.value = value; });
    }
    function switchSpace(space) {
      if (!Object.hasOwn(spaces, space) || space === currentSpace) return;
      rememberEditorDraft(); spaceSelections.set(currentSpace, viewSelected);
      currentSpace = space; spaceInitialized = true;
      const remembered = spaceSelections.get(space);
      viewSelected = spaceFolders(folders(), space).some(folder => folder.id === remembered) ? remembered : null;
      showCanvas(); drawCanvas(); drawDetail(); setEditor(false);
      // Switching spaces is a local view change, never a write to private records.
    }
    function redraw() {
      if (!alive || !root.isConnected) return;
      status.textContent = statusText(session); status.dataset.state = session.error ? 'error' : 'saved';
      root.querySelectorAll('[data-library-action="new"]').forEach(element => { element.disabled = session.loading || session.account && !session.loaded; });
      q('.acs-reload').hidden = !session.blocked;
      const changedWorkspace = renderedWorkspace !== session.workspace;
      if (changedWorkspace) {
        if (!spaceInitialized && session.loaded) {
          const selected = folders().find(folder => folder.id === workspace().selected);
          currentSpace = selected ? spaceOf(selected.type) : 'high'; viewSelected = selected?.id || null; spaceInitialized = true;
        }
        const priorFolder = detail.dataset.activeFolder, draft = detail.querySelector('textarea')?.value;
        const selections = Array.from(detail.querySelectorAll('[data-reference]')).map(element => [element.dataset.reference, element.value]);
        renderedWorkspace = session.workspace; drawCanvas(); drawDetail();
        if (priorFolder && priorFolder === detail.dataset.activeFolder) {
          const input = detail.querySelector('textarea'); if (input && draft !== undefined) input.value = draft;
          selections.forEach(([kind, value]) => { const select = detail.querySelector('[data-reference="' + kind + '"]'); if (select) select.value = value; });
        }
        if (mode === 'public') renderPublic();
      }
    }
    function selectFolder(id, record = true) {
      rememberEditorDraft(); viewSelected = id; spaceSelections.set(currentSpace, id); workspace().selected = id; showCanvas();
      canvas.querySelectorAll('[data-folder]').forEach(element => element.setAttribute('aria-pressed', String(element.dataset.folder === id)));
      drawDetail(); setEditor(true); if (record) changed(session);
    }
    function coverPreview() { const box = q('.acs-cover-preview'); box.hidden = !coverDraft; box.innerHTML = coverDraft ? coverMarkup(coverDraft) : ''; }
    function formMessage(text = '', error = false) { const box = q('.acs-wizard-message'); box.hidden = !text; box.textContent = text; box.classList.toggle('is-error', error); }
    function choices() {
      form.querySelectorAll('[data-kind]').forEach(element => { element.hidden = !editing && !spaces[currentSpace].types.includes(element.dataset.kind); element.setAttribute('aria-pressed', String(element.dataset.kind === form.elements.kind.value)); });
      form.querySelectorAll('[data-cover]').forEach(element => element.setAttribute('aria-pressed', String(element.dataset.cover === form.elements.appearance.value)));
      q('.acs-cover-fields').hidden = form.elements.appearance.value !== 'cover';
    }
    function showStep(step) {
      wizardStep = step; formMessage();
      form.querySelectorAll('[data-step]').forEach(element => { element.hidden = Number(element.dataset.step) !== step; });
      q('.acs-step-count').textContent = '第 ' + (step + 1) + ' / 4 步';
      q('.acs-step-bars').querySelectorAll('i').forEach((element, index) => element.classList.toggle('is-current', index <= step));
      q('[data-library-action="step-back"]').hidden = step === 0; dialog.setAttribute('aria-labelledby', 'acs-question-' + step);
      nextButton.textContent = step === 3 ? (editing ? '保存设置' : '建到画布') : '下一步'; nextButton.disabled = coverBusy;
      choices(); const target = Array.from(q('[data-step="' + step + '"]').querySelectorAll('input:not([type="hidden"]),textarea,button')).find(element => !element.hidden && !element.closest('[hidden]')); if (target) target.focus(); dialog.scrollTop = 0;
    }
    function openForm(id = null) {
      if (!ready()) return;
      if (!id && folders().length >= 40) { message('最多放40个文件夹；可以先合并或移出一个。'); return; }
      const folder = id ? folders().find(f => f.id === id) : null;
      formTrigger = document.activeElement; coverRequest++; coverBusy = false; editing = id; coverDraft = folder?.cover || null;
      form.dataset.space = currentSpace; form.dataset.mode = folder ? 'edit' : 'new';
      form.reset(); form.elements.folderName.value = folder?.name || ''; form.elements.kind.value = folder?.type || ''; form.elements.purpose.value = folder?.purpose || ''; form.elements.appearance.value = folder?.cover ? 'cover' : 'folder';
      q('.acs-form-title').textContent = folder ? '文件夹设置' : '新建文件夹'; form.hidden = false; coverPreview(); dialog.showModal(); showStep(0);
    }
    function endForm() {
      coverRequest++; coverBusy = false; form.hidden = true; coverDraft = null; editing = null;
      if (dialog.open) dialog.close(); if (formTrigger?.isConnected) formTrigger.focus(); formTrigger = null;
    }
    function freeSpot() {
      const first = canvas.querySelector('[data-folder]'), width = first?.offsetWidth || 164, height = first?.offsetHeight || 158;
      const boxes = Array.from(canvas.querySelectorAll('[data-folder]')).map(element => ({ x: element.offsetLeft, y: element.offsetTop, w: element.offsetWidth, h: element.offsetHeight }));
      for (let y = 24; y + height <= canvas.clientHeight - 18; y += 10) for (let x = 12; x + width <= canvas.clientWidth - 12; x += width + 24) if (boxes.every(box => x + width + 12 <= box.x || x >= box.x + box.w + 12 || y + height + 16 <= box.y || y >= box.y + box.h + 16)) return { x: clamp((x - 12) / Math.max(1, canvas.clientWidth - width - 24)), y: clamp((y - 24) / Math.max(1, canvas.clientHeight - height - 42)) };
      return null;
    }
    function makeSpace() {
      const spot = freeSpot(); if (spot) return spot;
      if (canvas.clientHeight >= 12000) return null;
      const positions = spaceFolders(folders(), currentSpace).map(folder => { const element = Array.from(canvas.querySelectorAll('[data-folder]')).find(el => el.dataset.folder === folder.id); return { folder, x: element.offsetLeft, y: element.offsetTop, w: element.offsetWidth, h: element.offsetHeight }; });
      workspace().canvasHeight = Math.min(12000, canvas.clientHeight + 195); canvas.style.minHeight = workspace().canvasHeight + 'px';
      positions.forEach(position => { position.folder.x = clamp((position.x - 12) / Math.max(1, canvas.clientWidth - position.w - 24)); position.folder.y = clamp((position.y - 24) / Math.max(1, canvas.clientHeight - position.h - 42)); });
      place(); return freeSpot();
    }
    function exportWorkspace() {
      const data = { format: '发现-私人档案馆整理记录', exportedAt: new Date().toISOString(), note: '仅含布局、文字和引用；不包含附件正文，不是文件备份或区块链记录。', workspace: copy(workspace()) };
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = '发现-档案馆整理记录-' + new Date().toISOString().slice(0, 10) + '.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      message('已导出文件夹布局和文字；附件需要在资料文件里另行下载。');
    }
    function importOld() {
      if (!ready()) return;
      let old; try { old = JSON.parse(localStorage.getItem(OLD_KEY) || 'null'); } catch { message('第二部分草稿无法读取；原记录没有被修改。'); return; }
      if (!old || old.version !== 1 || !Array.isArray(old.folders) || !old.folders.length) { message('当前网址里没有第二部分草稿。其他网址或端口的草稿不会自动迁移；原记录没有被改动。'); return; }
      const imported = normalize(old).folders;
      if (folders().length + imported.length > 40) { message('导入后会超过40个文件夹，请先整理当前画布。'); return; }
      if (!window.confirm('把第二部分的' + imported.length + '个文件夹复制到' + (context.user ? '当前登录账号' : '此浏览器的新档案馆') + '？原草稿仍保留；导入内容全部按私人资料保存。')) return;
      imported.forEach(folder => { folder.id = 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9); folder.items.forEach(item => { item.public = false; if (!item.refId) item.kind = 'note'; }); });
      const previous = folders().length; folders().push(...imported); workspace().selected = imported[0]?.id || workspace().selected; workspace().canvasHeight = Math.max(workspace().canvasHeight, 540, Math.ceil(folders().length / 2) * 195);
      imported.forEach((folder, index) => { const position = previous + index; folder.x = position % 2 ? .62 : .04; folder.y = clamp((24 + Math.floor(position / 2) * 195) / Math.max(1, workspace().canvasHeight - 200)); });
      rememberEditorDraft(); viewSelected = workspace().selected; currentSpace = imported[0] ? spaceOf(imported[0].type) : currentSpace; spaceSelections.set(currentSpace, viewSelected);
      showCanvas(); drawCanvas(); drawDetail(); setEditor(true); revealFolder(); changed(session);
      context.toast?.('已复制第二部分草稿，原草稿仍保留；没有公开或上链');
    }
    function addItem(item) {
      const folder = chosen(); if (!folder || !ready()) return;
      if (folder.items.length >= 60) { message('每个文件夹最多60条，请另建文件夹。'); return; }
      rememberEditorDraft();
      folder.items.push(item); showCanvas(); drawCanvas(); drawDetail(); changed(session);
    }
    async function onClick(event) {
      const target = event.target.closest('.acs-folder[data-folder]');
      if (target && root.contains(target)) { event.stopPropagation(); if (skipClick) { skipClick = false; return; } if (ready()) selectFolder(target.dataset.folder); return; }
      const actionNode = event.target.closest('[data-library-action]'); if (!actionNode || !root.contains(actionNode)) return;
      event.stopPropagation(); const action = actionNode.dataset.libraryAction;
      if (action === 'new') { showCanvas(); openForm(); }
      else if (action === 'edit') openForm(viewSelected);
      else if (action === 'exit') {
        try { if (context.onExit) await context.onExit(); else context.nav('archive'); }
        catch (error) { message(String(error.message || '返回失败，请先导出当前记录。')); }
      }
      else if (action === 'toggle-editor') setEditor(root.dataset.editorOpen !== 'true');
      else if (action === 'switch-space') switchSpace(actionNode.dataset.space);
      else if (action === 'change-color' && ready()) {
        const folder = chosen(), color = actionNode.dataset.color;
        if (!folder || !Object.hasOwn(colors, color)) return;
        folder.color = color;
        canvas.querySelectorAll('[data-folder]').forEach(element => { if (element.dataset.folder === folder.id) element.dataset.color = color; });
        detail.querySelectorAll('.acs-color').forEach(element => { const selected = element.dataset.color === color; element.setAttribute('aria-pressed', String(selected)); element.querySelector('span').textContent = selected ? '✓' : ''; });
        changed(session);
      }
      else if (action === 'cancel') endForm();
      else if (action === 'step-back') showStep(Math.max(0, wizardStep - 1));
      else if (action === 'choose-kind') { const kind = actionNode.dataset.kind; if (!Object.hasOwn(kinds, kind) || !editing && !spaces[currentSpace].types.includes(kind)) return; form.elements.kind.value = kind; choices(); formMessage(); }
      else if (action === 'choose-cover') { coverRequest++; coverBusy = false; nextButton.disabled = false; form.elements.appearance.value = actionNode.dataset.cover; choices(); formMessage(); }
      else if (action === 'sample-cover') { coverRequest++; coverBusy = false; nextButton.disabled = false; coverDraft = 'sample'; coverPreview(); formMessage('示例封面已准备好。'); }
      else if (action === 'files') context.nav('archive/files');
      else if (action === 'export') exportWorkspace();
      else if (action === 'import') importOld();
      else if (action === 'reload') {
        if (!session.account) { message('请先导出当前记录，再换浏览器或登录账号整理。'); return; }
        if (session.dirty && !window.confirm('重新读取会放弃当前未保存的修改。建议先点“导出整理记录”。确定重新读取吗？')) return;
        await load(session, true);
      } else if (action === 'preview') {
        if (!chosen()) return;
        rememberEditorDraft();
        if (mode === 'public') { showCanvas(); drawDetail(); }
        else { mode = 'public'; canvas.hidden = true; q('.acs-canvas-head').hidden = true; publicView.hidden = false; renderPublic(); drawDetail(); message('只预览选中的文字，没有发布、上传附件或发送交易。'); }
      } else if (action === 'add' && ready()) {
        const folder = chosen(), input = detail.querySelector('textarea'), text = input?.value.trim(); if (!folder) return;
        if (!text) { message('先写下要保存的内容。'); input?.focus(); return; }
        if (folder.type === 'link' && !safeLink(text)) { message('链接需以 https:// 或 http:// 开头。'); input.focus(); return; }
        if (folder.items.length >= 60) { message('每个文件夹最多60条，请另建文件夹。'); return; }
        const kind = ['message', 'link', 'event'].includes(folder.type) ? folder.type : 'note';
        input.value = '';
        addItem({ kind, text, source: kind === 'event' ? '参赛记录 · 本人填写，未获官方确认' : kind === 'message' ? '本人粘贴的交流记录' : '本人整理', refId: '', picture: false, public: false });
      } else if (action === 'add-reference' && ready()) {
        const kind = actionNode.dataset.referenceKind, selection = detail.querySelector('[data-reference="' + kind + '"]'), id = selection?.value;
        const entry = (kind === 'file' ? context.files || [] : context.projects || []).find(value => String(value.id) === id);
        if (!entry) { message('先选一项自己的资料。'); selection?.focus(); return; }
        if (chosen().items.some(item => item.kind === kind && item.refId === id)) { message('这份资料已经在这个文件夹里了。'); return; }
        addItem({ kind, refId: id, text: kind === 'file' ? entry.name : (entry.title + (entry.summary ? '\n' + entry.summary : '')).slice(0, 4000), source: kind === 'file' ? '账号中的私密文件 · 不公开附件' : '自己的作品 · 文字摘要', picture: false, public: false });
      } else if (action === 'remove-item' && ready()) {
        const folder = chosen(), index = Number(actionNode.dataset.item); if (!folder?.items[index]) return;
        if (!window.confirm('只从这个文件夹移出这条记录，不会删除资料库中的原文件或作品。确定移出？')) return;
        rememberEditorDraft(); folder.items.splice(index, 1); drawCanvas(); drawDetail(); if (mode === 'public') renderPublic(); changed(session);
      } else if (action === 'remove-folder' && ready()) {
        const folder = chosen(); if (!folder) return;
        if (!window.confirm('移出“' + folder.name + '”及其中的文字记录？资料库里的原文件和作品不会删除。需要保留整理记录，可以先导出。')) return;
        session.workspace.folders = folders().filter(item => item.id !== folder.id); workspace().selected = null; viewSelected = null; editorDrafts.delete(folder.id); spaceSelections.delete(currentSpace); showCanvas(); drawCanvas(); drawDetail(); changed(session);
      }
    }
    listen(root, 'click', onClick);
    listen(dialog, 'cancel', event => { event.preventDefault(); endForm(); });
    listen(form, 'submit', event => {
      event.preventDefault(); event.stopPropagation(); if (coverBusy || !ready()) return;
      const name = form.elements.folderName.value.trim(), type = form.elements.kind.value, purpose = form.elements.purpose.value.trim();
      if (!name) { showStep(0); formMessage('先给文件夹起一个名字。', true); return; }
      if (wizardStep === 0) { showStep(1); return; }
      if (!Object.hasOwn(kinds, type) || !editing && !spaces[currentSpace].types.includes(type)) { showStep(1); formMessage('先选一个保存类型。', true); return; }
      if (wizardStep < 3) { showStep(wizardStep + 1); return; }
      const cover = form.elements.appearance.value === 'cover' ? coverDraft : null;
      if (form.elements.appearance.value === 'cover' && !cover) { formMessage('选择图片，或选择暂时不放。', true); return; }
      if (editing) { const folder = folders().find(item => item.id === editing); if (!folder) { endForm(); return; } Object.assign(folder, { name, type, purpose, cover }); workspace().selected = editing; }
      else {
        if (folders().length >= 40) { formMessage('最多放40个文件夹。', true); return; }
        const spot = makeSpace(); if (!spot) { formMessage('画布暂时没有空位，请取消后挪开一个文件夹再试。', true); return; }
        const id = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9); folders().push({ id, name, type, purpose, cover, color: 'mint', ...spot, items: [] }); workspace().selected = id;
      }
      rememberEditorDraft(); viewSelected = workspace().selected; currentSpace = spaceOf(type); spaceSelections.set(currentSpace, viewSelected);
      endForm(); showCanvas(); drawCanvas(); drawDetail(); setEditor(true); revealFolder(); changed(session);
    });
    listen(form, 'change', event => {
      if (event.target !== form.elements.coverFile) return;
      const file = event.target.files[0]; if (!file) return;
      const request = ++coverRequest; coverBusy = false; nextButton.disabled = false;
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 512 * 1024) { formMessage('请选512KB以内的PNG、JPG或WebP。', true); event.target.value = ''; return; }
      const reader = new FileReader(); coverBusy = true; nextButton.disabled = true; formMessage('正在读取封面图片…');
      reader.onload = () => {
        if (!alive || form.hidden || request !== coverRequest) return;
        const image = new Image(); image.onload = () => { if (!alive || form.hidden || request !== coverRequest) return; coverBusy = false; nextButton.disabled = false; coverDraft = reader.result; coverPreview(); formMessage('图片已准备好，完成设置后才保存。'); };
        image.onerror = () => { if (!alive || form.hidden || request !== coverRequest) return; coverBusy = false; nextButton.disabled = false; formMessage('图片无法打开，请换一张。', true); }; image.src = reader.result;
      };
      reader.onerror = () => { if (!alive || form.hidden || request !== coverRequest) return; coverBusy = false; nextButton.disabled = false; formMessage('图片读取失败，请重新选择。', true); }; reader.readAsDataURL(file);
    });
    listen(detail, 'change', event => {
      if (!event.target.matches('[data-share]') || !ready()) return;
      const item = chosen()?.items[Number(event.target.dataset.share)]; if (!item || item.kind === 'file' || item.unavailable) return;
      item.public = event.target.checked; if (mode === 'public') renderPublic(); changed(session);
    });
    listen(canvas, 'pointerdown', event => {
      const element = event.target.closest('[data-folder]'); if (!element || event.button !== 0 || !ready()) return;
      const folder = folders().find(item => item.id === element.dataset.folder); skipClick = false;
      drag = { element, folder, x: event.clientX, y: event.clientY, startX: folder.x, startY: folder.y, moved: false, pointerId: event.pointerId }; element.setPointerCapture(event.pointerId);
    });
    listen(canvas, 'pointermove', event => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 5) { drag.moved = true; drag.element.classList.add('acs-moving'); }
      if (!drag.moved) return;
      drag.folder.x = clamp(drag.startX + dx / Math.max(1, canvas.clientWidth - drag.element.offsetWidth - 24)); drag.folder.y = clamp(drag.startY + dy / Math.max(1, canvas.clientHeight - drag.element.offsetHeight - 42)); place();
    });
    function finishDrag() {
      if (!drag) return; const done = drag; drag = null; done.element.classList.remove('acs-moving');
      if (done.moved) { skipClick = true; selectFolder(done.folder.id, false); changed(session); setTimeout(() => { skipClick = false; }, 0); }
    }
    listen(canvas, 'pointerup', finishDrag); listen(canvas, 'pointercancel', finishDrag); listen(canvas, 'lostpointercapture', finishDrag);
    listen(canvas, 'keydown', event => {
      const element = event.target.closest('[data-folder]'), steps = { ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12] };
      if (!element || !Object.hasOwn(steps, event.key) || !ready()) return; event.preventDefault();
      const folder = folders().find(item => item.id === element.dataset.folder), step = steps[event.key];
      folder.x = clamp(folder.x + step[0] / Math.max(1, canvas.clientWidth - element.offsetWidth - 24)); folder.y = clamp(folder.y + step[1] / Math.max(1, canvas.clientHeight - element.offsetHeight - 42)); place(); selectFolder(folder.id, false); changed(session);
    });
    listen(window, 'pagehide', () => { if (session.account) persist(session, true); else persist(session); });
    let observer = null; if (typeof ResizeObserver !== 'undefined') { observer = new ResizeObserver(place); observer.observe(canvas); }
    session.listeners.add(redraw); renderedWorkspace = null; redraw();
    active = { session, root, destroy: flush => { alive = false; finishDrag(); coverRequest++; if (dialog.open) dialog.close(); observer?.disconnect(); handlers.forEach(remove => remove()); session.listeners.delete(redraw); if (flush) persist(session); } };
    if (session.account && !session.busy && !session.dirty && !session.loading && !session.blocked) load(session);
    if (workspace().selected) revealFolder();
  }
  function destroy() { if (!active) return; const prior = active; active = null; prior.destroy(true); }
  async function flush() {
    // The canvas may already have been unmounted when the user reaches login.
    // Flush the current account's cached queue before its cookie is changed.
    const session = sessions.get(authOwner); if (!session || !session.valid) return;
    if (session.pending) await session.pending;
    if (session.dirty && !session.blocked) await persist(session);
    if (session.dirty || session.blocked) throw Error('档案馆还有未保存的整理记录，请先导出记录或重新读取。');
  }
  function resetSession() {
    if (active) { const prior = active; active = null; prior.destroy(false); }
    authOwner = null;
    sessions.forEach(session => { clearTimeout(session.timer); session.valid = false; session.listeners.clear(); }); sessions.clear();
  }
  window.ArchiveLibrary = { markup, mount, destroy, flush, resetSession };
})();
