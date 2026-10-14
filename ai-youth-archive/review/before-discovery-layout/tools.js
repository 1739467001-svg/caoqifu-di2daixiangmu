/* Existing local preparation and credential tools, separated from page navigation. */
(function () {
  'use strict';
  const storageKey = 'super-ai-youth-v1';
  let preparation = { interests: '', skills: '', time: '1 周', event: '' };
  let report = '';
  let memoryDraft = null;
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const textList = value => Array.isArray(value) ? value.join('、') : String(value == null ? '' : value);
  const announce = (context, message) => { if (typeof context.toast === 'function') context.toast(message); };
  function safeUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
    } catch (_) { return ''; }
  }
  function legacyState() {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (_) { return {}; }
  }
  function currentDraft() {
    const draft = memoryDraft || legacyState().draft;
    return draft && draft.payload && typeof draft.payload === 'object' && typeof draft.hash === 'string' ? draft : null;
  }
  function download(filename, value, type) {
    const objectUrl = URL.createObjectURL(new Blob([value], { type }));
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
  function profileOf(context) {
    const user = context.user || {};
    return user.profile || user;
  }
  function draftHtml() {
    const draft = currentDraft();
    if (!draft) return '<div class="tool-empty"><p class="muted">填写左侧活动信息，即可生成一份可下载的草稿。这里只保留最新一份，请及时下载。</p></div>';
    return `<div class="notice">草稿 · 未签名 · 未上链</div>
      <h3>${esc(draft.payload.eventName)}</h3>
      <p>创作者昵称：${esc(draft.payload.alias)}<br>自行填写的组织者：${esc(draft.payload.issuer)}<br>记录类型：${esc(draft.payload.kind)}</p>
      <p class="muted">内容摘要（SHA-256，用于检查内容是否变化）</p>
      <p class="tool-hash" style="overflow-wrap:anywhere">${esc(draft.hash)}</p>
      <button type="button" class="btn" id="downloadDraft">下载草稿文件（JSON）</button>`;
  }
  function render(kind, context = {}) {
    if (kind === 'prepare') {
      return `<div class="page-heading"><div><h1>生成参赛准备建议</h1><p class="muted">填兴趣、技能和赛事要求，得到作品方向、时间安排和提交清单。</p></div></div>
        <div class="notice"><strong>按本地规则生成，未接入大模型。</strong>程序只检查赛事资料中的关键词，参赛资格和要求请以主办方原文为准。</div>
        <div class="tool-grid">
          <form class="card form-grid" id="prepareForm"><h2>填写准备信息</h2>
            <label class="field" for="toolInterests">你感兴趣的问题或领域<input id="toolInterests" name="interests" required maxlength="300" value="${esc(preparation.interests)}" placeholder="例如：环保、游戏、帮助同学学习"></label>
            <label class="field" for="toolSkills">已经掌握的技能<input id="toolSkills" name="skills" required maxlength="300" value="${esc(preparation.skills)}" placeholder="例如：Python 入门、绘画、提示词设计"></label>
            <label class="field" for="toolTime">可投入的时间<select id="toolTime" name="time">${['2 天', '1 周', '2 周及以上'].map(value => `<option${preparation.time === value ? ' selected' : ''}>${value}</option>`).join('')}</select></label>
            <label class="field" for="toolEvent">赛事要求<textarea id="toolEvent" name="event" required maxlength="6000" rows="7" placeholder="粘贴赛事主题、资格、截止日期、提交材料和评分标准……">${esc(preparation.event)}</textarea></label>
            <p class="muted">请粘贴正文，程序不会读取网址。表单和建议只在本次打开期间保留，不上传服务器。</p>
            <button class="btn primary" type="submit">生成参赛建议</button>
          </form>
          <section class="card" id="toolReport" aria-live="polite">${report || '<h2>建议会显示在这里</h2><p class="muted">先填写表单，再点“生成参赛建议”。</p>'}</section>
        </div>`;
    }
    if (kind === 'credential') {
      const profile = profileOf(context);
      return `<div class="page-heading"><div><h1>生成活动凭证草稿</h1><p class="muted">整理参赛或获奖信息，生成内容摘要并下载草稿。</p></div></div>
        <div class="notice"><strong>这不是官方证明。</strong>目前未接入组织者签名，也不会写入 Solana。内容摘要只能检查内容是否变化，不能证明参赛或获奖。</div>
        <div class="tool-grid">
          <form class="card form-grid" id="credentialForm"><h2>填写活动信息</h2>
            <label class="field" for="toolAlias">创作者昵称<input id="toolAlias" name="alias" required maxlength="60" value="${esc(profile.name || profile.nickname || profile.display_name || '')}"></label>
            <label class="field" for="toolEventName">活动名称<input id="toolEventName" name="eventName" required maxlength="150" placeholder="例如：少年 AI 创造黑客松"></label>
            <label class="field" for="toolIssuer">组织者名称<input id="toolIssuer" name="issuer" required maxlength="150" placeholder="填写实际组织者，仍需对方确认"></label>
            <label class="field" for="toolKind">记录类型<select id="toolKind" name="kind"><option>活动参与</option><option>作品提交</option><option>获奖记录（待组织者确认）</option></select></label>
            <p class="muted">不要填写身份证、学校、地址等敏感信息。草稿只存在当前浏览器，不会同步到账户。未来若上链，链上数据难以删除。</p>
            <button class="btn primary" type="submit">生成凭证草稿</button>
          </form>
          <section class="card"><h2>查看与下载</h2><div id="toolDraft" aria-live="polite">${draftHtml()}</div>
            <hr><form id="explorerForm" class="form-grid">
              <label class="field" for="toolSignature">查询已有的 Solana 测试网交易<input id="toolSignature" name="signature" required pattern="[1-9A-HJ-NP-Za-km-z]{64,88}" maxlength="88" placeholder="粘贴 Devnet 交易签名"></label>
              <button class="btn" type="submit">打开区块浏览器</button>
              <p class="muted">在新窗口查看交易状态和签名账户。本网站不会自动确认组织者身份。</p>
            </form>
          </section>
        </div>`;
    }
    return '';
  }
  function buildReport(data) {
    const canCode = /python|编程|javascript|代码/i.test(data.skills);
    const schedule = data.time === '2 天'
      ? '第 1 天：确认要求，确定一个核心功能，完成原型。<br>第 2 天：测试流程，录制演示，准备答辩并提交。'
      : data.time === '1 周'
        ? '第 1–2 天：阅读规则，选择问题，与潜在用户交流。<br>第 3–5 天：制作并测试一个核心功能。<br>第 6–7 天：完善作品页，录制演示并提交。'
        : '第一周：确认资格与主题，了解用户需求，制作原型。<br>第二周：完成核心功能，邀请测试，整理演示与提交材料。';
    return `<h2>你的参赛准备建议</h2><p class="muted">本地规则建议 · ${esc(data.time)}计划</p>
      <section class="tool-result"><h3>适合你的作品方向</h3><p>围绕“${esc(data.interests)}”选择一个具体使用场景，制作${canCode ? '一个可交互的小工具' : '一个可点击的产品原型'}。用“${esc(data.skills)}”完成你最擅长的部分，再寻找互补的队友。</p></section>
      <section class="tool-result"><h3>赛事资料核对</h3><p>${['主题', '资格', '截止', '提交', '评分'].map(keyword => `${data.event.includes(keyword) ? '已提及' : '请补充'}：${keyword}`).join(' · ')}</p><p class="muted">这里只检查关键词，仍需以主办方原文为准。</p><details><summary>查看你粘贴的赛事原文</summary><p style="white-space:pre-wrap">${esc(data.event)}</p></details></section>
      <section class="tool-result"><h3>${esc(data.time)}行动路线</h3><p>${schedule}</p></section>
      <section class="tool-result"><h3>提交前准备</h3><ul><li>可访问的作品或演示链接</li><li>问题、解决方案与个人贡献说明</li><li>按赛事要求标注 AI 工具使用情况</li><li>检查截止时间、文件格式与团队资格</li></ul></section>
      <p class="muted">生成建议不代表已确认符合赛事要求；不明确的条款请向组织者核对。</p>`;
  }
  function bindDraftDownload(context) {
    const button = document.getElementById('downloadDraft');
    if (button) button.onclick = () => {
      const draft = currentDraft();
      if (draft) {
        download('参与凭证草稿.json', JSON.stringify(draft, null, 2), 'application/json;charset=utf-8');
        announce(context, '已下载凭证草稿，未签名、未上链');
      }
    };
  }
  function bind(kind, context = {}) {
    if (kind === 'prepare') {
      const form = document.getElementById('prepareForm');
      if (!form) return;
      form.oninput = () => { preparation = Object.fromEntries(new FormData(form)); };
      form.onsubmit = event => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        preparation = Object.fromEntries(new FormData(form));
        report = buildReport(preparation);
        document.getElementById('toolReport').innerHTML = report;
        announce(context, '参赛建议已生成');
      };
    }
    if (kind === 'credential') {
      bindDraftDownload(context);
      const form = document.getElementById('credentialForm');
      if (form) form.onsubmit = async event => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        const button = form.querySelector('button[type="submit"]');
        if (button.disabled) return;
        button.disabled = true;
        const payload = { ...Object.fromEntries(new FormData(form)), network: 'devnet', status: 'unsigned-draft', createdAt: new Date().toISOString() };
        try {
          const bytes = new TextEncoder().encode(JSON.stringify(payload));
          const hash = Array.from(new Uint8Array(await draftDigest(bytes))).map(value => value.toString(16).padStart(2, '0')).join('');
          memoryDraft = { payload, hash, hashAlgorithm: 'SHA-256', canonicalization: 'JSON.stringify(payload), UTF-8', onChain: false };
          let saved = true;
          try { localStorage.setItem(storageKey, JSON.stringify({ ...legacyState(), draft: memoryDraft })); } catch (_) { saved = false; }
          const holder = document.getElementById('toolDraft');
          if (holder) { holder.innerHTML = draftHtml(); bindDraftDownload(context); }
          announce(context, saved ? '草稿已生成，未签名、未上链' : '草稿已生成，但浏览器无法保存，请立即下载');
        } catch (_) {
          announce(context, '草稿生成失败，请刷新后重试');
        } finally { button.disabled = false; }
      };
      const explorerForm = document.getElementById('explorerForm');
      if (explorerForm) explorerForm.onsubmit = event => {
        event.preventDefault();
        if (!explorerForm.reportValidity()) return;
        const signature = document.getElementById('toolSignature').value.trim();
        if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) return;
        window.open('https://explorer.solana.com/tx/' + encodeURIComponent(signature) + '?cluster=devnet', '_blank', 'noopener,noreferrer');
      };
    }
  }
  function exportPortfolio(profile = {}, projects = []) {
    const name = profile.name || profile.nickname || profile.display_name || '创作者';
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(name)}的作品档案</title><style>body{font-family:system-ui,sans-serif;max-width:850px;margin:50px auto;padding:25px;background:#f7f8f2;color:#25311d}article{border-top:1px solid #cbd6bc;padding:25px 0}p{line-height:1.9;white-space:pre-wrap;overflow-wrap:anywhere}a{color:#52762b}small{color:#56634b}h1,h2{overflow-wrap:anywhere}@media(max-width:600px){body{margin:12px auto;padding:20px}}</style></head><body><h1>${esc(name)}的作品档案</h1><p>${esc(profile.bio)}</p><small>${esc(textList(profile.skills))}</small>${projects.map(work => {
      const url = safeUrl(work.url || work.demo_url || work.demoUrl);
      return `<article><small>${esc(work.status || '')} · ${esc(textList(work.tech || work.tags || work.skills))}</small><h2>${esc(work.title)}</h2><p>${esc(work.summary || work.description)}</p><p>我的贡献：${esc(work.role || work.contribution || '')}</p><p>${esc(work.event || work.event_name || '')}</p>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">查看作品</a>` : ''}</article>`;
    }).join('')}<hr><small>由 AI少年档案生成 · 内容由创作者自述，未经活动组织者认证</small></body></html>`;
    download('少年作品档案.html', html, 'text/html;charset=utf-8');
    return html;
  }
  window.ArchiveTools = { render, bind, exportPortfolio };
})();
