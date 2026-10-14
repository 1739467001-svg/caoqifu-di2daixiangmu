(() => {
  'use strict';
  const root = document.getElementById('archive-canvas-studio');
  if (!root) return;
  const canvas = root.querySelector('.acs-canvas');
  const detail = root.querySelector('.acs-detail');
  const form = root.querySelector('.acs-form');
  const formDialog = root.querySelector('.acs-wizard');
  const nextButton = form.querySelector('.acs-step-next');
  const questions = [...form.querySelectorAll('[data-step]')];
  const layout = root.querySelector('.acs-layout');
  const status = root.querySelector('.acs-status');
  const publicView = root.querySelector('.acs-public');
  const stage = root.querySelector('.acs-stage');
  const storageKey = 'youth-archive-workspace-draft-v1';
  const kinds = { message: '消息', note: '笔记', file: '文件', link: '链接', mixed: '混合资料' };
  const seed = [
    { id: 'm1', name: '伙伴的建议', type: 'message', purpose: '收集大家给第一关的建议', cover: null, x: .06, y: .08, items: [{ text: '先把一个关卡跑通，再加道具。', source: '示例 · 伙伴消息' }, { text: '跳跃动作可以再轻快一点。', source: '示例 · AI对话片段' }] },
    { id: 'f1', name: '作品图片', type: 'file', purpose: '留住每一版游戏画面', cover: null, x: .68, y: .10, items: [{ text: '第一关.png', source: '示例图片', picture: true }, { text: '角色草图.png', source: '示例图片', picture: true }] },
    { id: 'n1', name: '制作笔记', type: 'note', purpose: '记录下一步要做什么', cover: 'sample', x: .12, y: .69, items: [{ text: '今天先补开始和结束画面。', source: '示例 · 制作笔记' }] }
  ];
  let folders = seed.map(f => ({ ...f, items: f.items.map(i => ({ ...i, public: false })) }));
  let selected = null, editing = null, coverDraft = null, mode = 'canvas', drag = null, skipClick = false, serial = 1;
  let restored = false, coverRequest = 0, wizardStep = 0, coverBusy = false, formTrigger = null, canvasMinHeight = 540;
  function coverLoading(loading) { coverBusy = loading; nextButton.disabled = loading; }
  function formMessage(message = '', error = false) {
    const box = form.querySelector('.acs-wizard-message');
    box.hidden = !message; box.textContent = message; box.classList.toggle('is-error', error);
  }
  const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (value, fallback = 0) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : fallback;
  const chosen = () => folders.find(f => f.id === selected);
  const scene = () => '<div class="acs-scene"><b>AI小游戏</b></div>';
  const validCover = value => value === 'sample' || (typeof value === 'string' && value.length < 720000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value));

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (saved?.version === 1 && Array.isArray(saved.folders) && saved.folders.length && saved.folders.length <= 12) {
      const ids = new Set();
      const clean = saved.folders.filter(f => f && /^[a-zA-Z0-9_-]{1,40}$/.test(f.id) && !ids.has(f.id) && ids.add(f.id) && Object.hasOwn(kinds, f.type)).map(f => ({
        id: f.id, name: String(f.name || '新文件夹').slice(0, 18), type: f.type,
        purpose: String(f.purpose || '').slice(0, 100), cover: validCover(f.cover) ? f.cover : null,
        x: clamp(f.x), y: clamp(f.y),
        items: Array.isArray(f.items) ? f.items.slice(0, 12).map(i => ({ text: String(i?.text || '').slice(0, 300), source: String(i?.source || '本机草稿').slice(0, 100), public: i?.public === true, picture: i?.picture === true })) : []
      }));
      if (clean.length) { folders = clean; selected = clean.some(f => f.id === saved.selected) ? saved.selected : null; canvasMinHeight = Math.max(540, Math.min(3000, Number(saved.canvasHeight) || 540)); restored = true; }
    }
  } catch { /* 浏览器不允许本机存储时，仍能操作当前窗口。 */ }

  function saveDraft(message = '已保存到此浏览器 · 未接云端或链') {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ version: 1, folders, selected, canvasHeight: canvasMinHeight }));
      status.textContent = message;
      return true;
    } catch {
      status.textContent = '本机保存失败，内容仍在当前窗口。请减少封面图片大小。';
      return false;
    }
  }
  function place(count = folders.length) {
    const columns = canvas.clientWidth < 480 ? 2 : 3;
    canvas.style.minHeight = Math.max(canvasMinHeight, Math.ceil(count / columns) * 195) + 'px';
    for (const f of folders) {
      const el = canvas.querySelector('[data-folder="' + f.id + '"]');
      if (!el) continue;
      el.style.left = 12 + f.x * Math.max(0, canvas.clientWidth - el.offsetWidth - 24) + 'px';
      el.style.top = 24 + f.y * Math.max(0, canvas.clientHeight - el.offsetHeight - 42) + 'px';
    }
  }
  function coverMarkup(cover) { return cover === 'sample' ? scene() : '<img alt="文件夹封面" src="' + esc(cover) + '">'; }
  function drawCanvas() {
    canvas.innerHTML = folders.map(f => '<button type="button" class="acs-folder" data-folder="' + f.id + '" aria-pressed="' + (f.id === selected) + '" aria-label="打开' + esc(f.name) + '；可拖动或用方向键移动">' +
      (f.cover ? '<div class="acs-cover">' + coverMarkup(f.cover) + '</div>' : '<div class="acs-thumbs">' +
        (f.items.length ? f.items.slice(0, 2).map(i => '<div class="acs-thumb">' + (i.picture ? scene() : '<span class="acs-thumb-kind">' + kinds[f.type] + '</span>' + esc(i.text)) + '</div>').join('') : '<div class="acs-thumb"><span class="acs-thumb-kind">文件夹</span>还没放内容</div>') + '</div>') +
      '<span class="acs-folder-name" title="' + esc(f.name) + '">' + esc(f.name) + '</span><span class="acs-folder-meta">' + kinds[f.type] + ' · ' + f.items.length + '条</span></button>').join('');
    place();
  }
  function revealFolder() {
    const el = canvas.querySelector('[data-folder="' + selected + '"]');
    if (!el) return;
    const folderBox = el.getBoundingClientRect(), stageBox = stage.getBoundingClientRect();
    const head = root.querySelector('.acs-canvas-head').offsetHeight;
    const foot = root.querySelector('.acs-stage-foot').offsetHeight;
    if (folderBox.bottom > stageBox.bottom - foot - 16) stage.scrollTop += folderBox.bottom - stageBox.bottom + foot + 16;
    else if (folderBox.top < stageBox.top + head + 16) stage.scrollTop -= stageBox.top + head + 16 - folderBox.top;
  }
  function drawDetail() {
    const f = chosen();
    if (!f) { detail.innerHTML = '<div class="acs-empty">选中画布上的文件夹，<br>在这里查看内容和设置。</div>'; return; }
    detail.innerHTML = '<h3>' + esc(f.name) + '</h3><div class="acs-small">' + kinds[f.type] + ' · 私人资料</div><p class="acs-purpose">' + esc(f.purpose || '还没有填写用途') + '</p><button type="button" class="acs-wide cursor-interaction" data-action="edit">名称与封面设置</button><div class="acs-items">' +
      (f.items.length ? f.items.map((i, n) => '<div class="acs-item"><p>' + esc(i.text) + '</p><small>' + esc(i.source) + '</small><label class="acs-check"><input type="checkbox" data-share="' + n + '" ' + (i.public ? 'checked' : '') + '>放进公开预览</label></div>').join('') : '<div class="acs-empty">这个文件夹还空着。</div>') + '</div>' +
      (f.type === 'file' ? '<button type="button" class="acs-wide cursor-interaction acs-add-file" data-action="sample-file">放入示例图片</button>' : '<label class="acs-field">' + (f.type === 'message' ? '放入一段消息' : f.type === 'link' ? '留下一个链接' : '放入一条内容') + '<textarea aria-label="新增文件夹内容" maxlength="300" placeholder="输入后保存在此浏览器"></textarea></label><button type="button" class="acs-wide cursor-interaction" data-action="add">放进文件夹</button>') +
      '<button type="button" class="acs-wide cursor-interaction acs-preview-button" data-action="preview">' + (mode === 'canvas' ? '公开预览' : '返回画布') + '</button>';
  }
  function showCanvas() { mode = 'canvas'; canvas.hidden = false; publicView.hidden = true; root.querySelector('.acs-canvas-head').hidden = false; drawDetail(); }
  function selectFolder(id) {
    selected = id; showCanvas();
    canvas.querySelectorAll('[data-folder]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.folder === id)));
    drawDetail();
  }
  function coverPreview() { const box = form.querySelector('.acs-cover-preview'); box.hidden = !coverDraft; box.innerHTML = coverDraft ? coverMarkup(coverDraft) : ''; }
  function refreshChoices() {
    form.querySelectorAll('[data-kind]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.kind === form.elements.kind.value)));
    form.querySelectorAll('[data-cover]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.cover === form.elements.appearance.value)));
    form.querySelector('.acs-cover-fields').hidden = form.elements.appearance.value !== 'cover';
  }
  function showStep(step) {
    wizardStep = step; formMessage();
    questions.forEach((question, i) => { question.hidden = i !== step; });
    form.querySelector('.acs-step-count').textContent = '第 ' + (step + 1) + ' / 4 步';
    form.querySelectorAll('.acs-step-bars i').forEach((bar, i) => bar.classList.toggle('is-current', i <= step));
    form.querySelector('[data-action="step-back"]').hidden = step === 0;
    formDialog.setAttribute('aria-labelledby', 'acs-question-' + step);
    questions[step].querySelector('h3').id = 'acs-question-' + step;
    nextButton.textContent = step === 3 ? (editing ? '保存设置' : '建到画布') : '下一步';
    nextButton.disabled = coverBusy;
    refreshChoices();
    const focusTarget = questions[step].querySelector('input:not([type="hidden"]), textarea, button');
    if (focusTarget) focusTarget.focus();
    formDialog.scrollTop = 0;
  }
  function openForm(id = null) {
    formTrigger = document.activeElement;
    coverRequest++; coverLoading(false); editing = id; const f = id ? folders.find(folder => folder.id === id) : null; coverDraft = f?.cover || null;
    form.reset(); form.elements.folderName.value = f?.name || ''; form.elements.kind.value = f?.type || ''; form.elements.purpose.value = f?.purpose || '';
    form.elements.appearance.value = f?.cover ? 'cover' : 'folder';
    form.querySelector('.acs-form-title').textContent = f ? '文件夹设置' : '新建文件夹';
    form.hidden = false; coverPreview(); formDialog.showModal(); showStep(0);
  }
  function endForm() {
    coverRequest++; coverLoading(false); form.hidden = true; coverDraft = null; editing = null;
    if (formDialog.open) formDialog.close();
    if (formTrigger?.isConnected) formTrigger.focus();
    formTrigger = null; drawDetail();
  }
  formDialog.addEventListener('cancel', event => { event.preventDefault(); endForm(); });
  function freeSpot() {
    const first = canvas.querySelector('[data-folder]'), w = first?.offsetWidth || 142, h = first?.offsetHeight || 138;
    const boxes = Array.from(canvas.querySelectorAll('[data-folder]')).map(el => ({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }));
    for (let y = 24; y + h <= canvas.clientHeight - 18; y += 10) {
      for (let x = 12; x + w <= canvas.clientWidth - 12; x += w + 24) {
        if (boxes.every(b => x + w + 12 <= b.x || x >= b.x + b.w + 12 || y + h + 16 <= b.y || y >= b.y + b.h + 16)) return { x: clamp((x - 12) / Math.max(1, canvas.clientWidth - w - 24)), y: clamp((y - 24) / Math.max(1, canvas.clientHeight - h - 42)) };
      }
    }
    return null;
  }
  function makeSpace() {
    let spot = freeSpot(); if (spot) return spot;
    const positions = folders.map(f => {
      const el = canvas.querySelector('[data-folder="' + f.id + '"]');
      return { f, x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
    });
    canvasMinHeight = canvas.clientHeight + 195;
    canvas.style.minHeight = canvasMinHeight + 'px';
    for (const p of positions) {
      p.f.x = clamp((p.x - 12) / Math.max(1, canvas.clientWidth - p.w - 24));
      p.f.y = clamp((p.y - 24) / Math.max(1, canvas.clientHeight - p.h - 42));
    }
    place(); spot = freeSpot(); return spot;
  }
  form.addEventListener('submit', event => {
    event.preventDefault(); if (coverBusy) return;
    const name = form.elements.folderName.value.trim(), type = form.elements.kind.value, purpose = form.elements.purpose.value.trim(), cover = form.elements.appearance.value === 'cover' ? coverDraft : null;
    if (!name) { showStep(0); formMessage('先给文件夹起个名字。', true); return; }
    if (wizardStep === 0) { showStep(1); return; }
    if (!Object.hasOwn(kinds, type)) { showStep(1); formMessage('选一下这个文件夹主要保存什么。', true); return; }
    if (wizardStep < 3) { showStep(wizardStep + 1); return; }
    if (form.elements.appearance.value === 'cover' && !cover) { formMessage('选一张图片，或试用示例封面。', true); return; }
    if (editing) {
      const target = folders.find(f => f.id === editing);
      if (!target) { endForm(); return; }
      Object.assign(target, { name, type, purpose, cover }); selected = editing;
    }
    else {
      if (folders.length >= 12) { formMessage('这版演示最多放12个文件夹。', true); return; }
      const spot = makeSpace();
      if (!spot) { formMessage('暂时没有空位，取消后挪开一个文件夹再试。', true); return; }
      let id; do { id = 'u' + serial++; } while (folders.some(f => f.id === id));
      folders.push({ id, name, type, purpose, cover, ...spot, items: [] }); selected = id;
    }
    endForm(); showCanvas(); drawCanvas(); drawDetail(); revealFolder(); saveDraft();
  });
  form.addEventListener('change', event => {
    if (event.target !== form.elements.coverFile) return;
    const file = event.target.files[0]; if (!file) return;
    coverRequest++; coverLoading(false);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 512 * 1024) { formMessage('演示版请选512KB以内的PNG、JPG或WebP图片。', true); event.target.value = ''; return; }
    const request = ++coverRequest, reader = new FileReader(); coverLoading(true); formMessage('正在读取封面图片…');
    reader.onload = () => {
      if (form.hidden || request !== coverRequest) return;
      const image = new Image();
      image.onload = () => { if (form.hidden || request !== coverRequest) return; coverLoading(false); coverDraft = reader.result; coverPreview(); formMessage('图片已准备好，完成后才保存。'); };
      image.onerror = () => { if (form.hidden || request !== coverRequest) return; coverLoading(false); formMessage('这张图片无法打开，请换一张图片。', true); };
      image.src = reader.result;
    };
    reader.onerror = () => { if (form.hidden || request !== coverRequest) return; coverLoading(false); formMessage('图片没能读取，可以试用示例封面。', true); };
    reader.readAsDataURL(file);
  });
  function renderPublic() {
    const f = chosen(); if (!f) return; const items = f.items.filter(i => i.public);
    publicView.innerHTML = '<h3>个人介绍页 · 公开预览</h3><div class="acs-small">示例创作者 / AI小游戏</div><h3 class="acs-public-title">' + esc(f.name) + '</h3>' +
      (items.length ? items.map(i => '<div class="acs-item"><p>' + esc(i.text) + '</p><small>' + esc(i.source) + '</small></div>').join('') : '<p class="acs-small">还没选公开内容，请先在左侧勾选。</p>') + '<div class="acs-plan">仅预览选中的' + items.length + '条内容 · 尚未发布</div>';
  }
  function publicPreview() {
    if (!chosen()) return;
    if (mode !== 'canvas') { showCanvas(); return; }
    mode = 'public'; canvas.hidden = true; root.querySelector('.acs-canvas-head').hidden = true; renderPublic(); publicView.hidden = false; drawDetail(); status.textContent = '这里只预览勾选的内容，没有发布到社区。';
  }
  root.addEventListener('click', event => {
    const node = event.target.closest('[data-folder]');
    if (node) { if (skipClick) { skipClick = false; return; } selectFolder(node.dataset.folder); return; }
    const action = event.target.closest('[data-action]')?.dataset.action; if (!action) return;
    if (action === 'new') { showCanvas(); openForm(); }
    else if (action === 'edit') openForm(selected);
    else if (action === 'cancel') endForm();
    else if (action === 'step-back') showStep(Math.max(0, wizardStep - 1));
    else if (action === 'choose-kind') { form.elements.kind.value = event.target.closest('[data-kind]').dataset.kind; refreshChoices(); formMessage(); }
    else if (action === 'choose-cover') { coverRequest++; coverLoading(false); form.elements.appearance.value = event.target.closest('[data-cover]').dataset.cover; refreshChoices(); formMessage(); }
    else if (action === 'sample-cover') { coverRequest++; coverLoading(false); coverDraft = 'sample'; coverPreview(); formMessage('示例封面已准备好。'); }
    else if (action === 'close') { if (formDialog.open) endForm(); layout.hidden = true; root.querySelector('.acs-home').hidden = false; root.querySelector('[data-action="open"]').focus(); }
    else if (action === 'open') { root.querySelector('.acs-home').hidden = true; root.querySelector('.acs-layout').hidden = false; place(); }
    else if (action === 'preview') publicPreview();
    else if (action === 'add' || action === 'sample-file') {
      const f = chosen(); if (f.items.length >= 12) { status.textContent = '演示版每夹最多放12条。'; return; }
      const text = action === 'sample-file' ? '游戏画面-' + (f.items.length + 1) + '.png' : detail.querySelector('textarea').value.trim(); if (!text) { status.textContent = '先写下一条内容。'; return; }
      f.items.push({ text, source: action === 'sample-file' ? '示例图片 · 不是真实上传' : f.type === 'message' ? '来源：手动粘贴的对话' : '本机草稿', picture: action === 'sample-file', public: false });
      showCanvas(); drawCanvas(); drawDetail(); saveDraft();
    } else if (action === 'backup' || action === 'chain') status.textContent = action === 'chain' ? '存证示意：选定版本 → 钱包确认 → 查询记录。未接入，未发送交易。' : '备份示意：保存另一份副本 → 检查恢复。未接入，当前只有本浏览器草稿。';
  });
  detail.addEventListener('change', event => {
    if (!event.target.matches('[data-share]')) return;
    chosen().items[Number(event.target.dataset.share)].public = event.target.checked;
    if (mode === 'public') renderPublic();
    saveDraft('预览选择已保存到本机 · 没有公开');
  });
  canvas.addEventListener('pointerdown', event => {
    const el = event.target.closest('[data-folder]'); if (!el || event.button !== 0) return;
    const f = folders.find(f => f.id === el.dataset.folder); skipClick = false;
    drag = { el, f, x: event.clientX, y: event.clientY, startX: f.x, startY: f.y, moved: false }; el.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    if (!drag) return; const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) { drag.moved = true; drag.el.classList.add('acs-moving'); }
    if (!drag.moved) return;
    drag.f.x = clamp(drag.startX + dx / Math.max(1, canvas.clientWidth - drag.el.offsetWidth - 24));
    drag.f.y = clamp(drag.startY + dy / Math.max(1, canvas.clientHeight - drag.el.offsetHeight - 42)); place();
  });
  function finishDrag() {
    if (!drag) return; const done = drag; drag = null; done.el.classList.remove('acs-moving');
    if (done.moved) { skipClick = true; selectFolder(done.f.id); saveDraft('文件夹位置已保存到此浏览器'); setTimeout(() => { skipClick = false; }, 0); }
  }
  canvas.addEventListener('pointerup', finishDrag); canvas.addEventListener('pointercancel', finishDrag);
  canvas.addEventListener('keydown', event => {
    const el = event.target.closest('[data-folder]'), steps = { ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12] };
    if (!el || !Object.hasOwn(steps, event.key)) return; event.preventDefault();
    const f = folders.find(f => f.id === el.dataset.folder), s = steps[event.key];
    f.x = clamp(f.x + s[0] / Math.max(1, canvas.clientWidth - el.offsetWidth - 24)); f.y = clamp(f.y + s[1] / Math.max(1, canvas.clientHeight - el.offsetHeight - 42)); place(); selectFolder(f.id); saveDraft('文件夹位置已保存到此浏览器');
  });
  drawCanvas(); drawDetail(); if (selected) revealFolder();
  status.textContent = restored ? '本浏览器草稿已恢复 · 未接云端或链' : '示例内容 · 修改后保存在此浏览器';
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => place()).observe(canvas);
})();
