// Optional end-to-end check using a supplied Playwright install and Edge/Chromium.
const {chromium}=require(process.argv[2]||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
(async()=>{
  const {createApp}=await import('../server.mjs');
  const {readConfig}=await import('../src/config.mjs');
  const server=await createApp({config:readConfig({USE_MOCK:'true'})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  let browser;
  try{
    browser=await chromium.launch({headless:true,...(process.argv[3]?{executablePath:process.argv[3]}:{})});
    const page=await browser.newPage({viewport:{width:1280,height:850}});const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await fs.mkdir('test-results',{recursive:true});
    await page.goto(origin);await page.locator('#new-conversation-welcome').waitFor();
    await page.locator('#intro').waitFor({state:'detached'});
    assert.equal(await page.locator('.chat-app').evaluate(el=>el.inert),false,'entry animation must unlock the conversation');
    assert.equal(await page.locator('aside').count(),1);
    assert.equal(await page.locator('select,[role="progressbar"]').count(),0);
    assert.equal(await page.locator('.task-item').count(),0);
    assert.equal(await page.locator('.message').count(),0);
    const sidebar=page.locator('#task-sidebar');
    async function openSidebar(){if(!await sidebar.isVisible())await page.locator('#sidebar-toggle').click();}
    async function switchConversation(id){await openSidebar();await page.locator(`.task-item[data-task-id="${id}"]`).click();}
    await page.locator('#sidebar-close').click();assert.equal(await sidebar.isVisible(),false);
    await openSidebar();assert.equal(await sidebar.isVisible(),true);
    await page.screenshot({path:'test-results/chat-preview.png'});
    const input=page.locator('#message-input');
    async function say(text){const before=await page.locator('.assistant').count();await input.fill(text);await input.press('Enter');await page.waitForFunction(n=>document.querySelectorAll('.assistant').length===n+1,before);return page.locator('.assistant').last().textContent();}
    await input.fill('我喜欢画画。');
    await input.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true});
    assert.equal(await page.locator('.user').count(),0,'IME confirmation must not send');
    await say('我喜欢画画，特别是画小动物。');
    await say('昨天找不到以前画的画纸了。');
    assert.match(await say('我有点饿了'),/肚子/);
    assert.match(await say('我想做一个帮我整理画纸的小工具。'),/我先把听到的拼在一起/);
    await page.waitForFunction(()=>{const s=document.querySelector('#conversation-scroll');return s.scrollHeight-s.clientHeight-s.scrollTop<3;});
    await page.screenshot({path:'test-results/chat-conversation.png'});
    assert.match(await say('不聊画画了，我喜欢篮球。'),/篮球/);
    // Network failure keeps the same pending user message; retry cannot duplicate it.
    const userCount=await page.locator('.user').count();
    await page.route('**/api/chat',route=>route.abort());await input.fill('我想记录投篮次数');await input.press('Enter');
    await page.locator('#error-message:visible').waitFor();assert.equal(await input.inputValue(),'我想记录投篮次数');
    await page.unroute('**/api/chat');await input.press('Enter');
    await page.waitForFunction(()=>!document.querySelector('#chat-form').getAttribute('aria-busy')||document.querySelector('#chat-form').getAttribute('aria-busy')==='false');
    assert.equal(await page.locator('.user').count(),userCount+1);assert.equal(await page.locator('.failed').count(),0);
    await input.fill('<img src=x onerror=alert(1)>');await input.press('Enter');await page.waitForFunction(()=>document.querySelector('#chat-form').getAttribute('aria-busy')==='false');
    assert.equal(await page.locator('.message img').count(),0,'messages must be rendered as text');
    await page.setViewportSize({width:390,height:844});await sidebar.waitFor({state:'hidden'});await page.screenshot({path:'test-results/chat-mobile.png'});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await openSidebar();assert.equal(await page.locator('#chat-main').evaluate(el=>el.inert),true);
    await page.keyboard.press('Escape');await sidebar.waitFor({state:'hidden'});
    assert.equal(await page.locator('#chat-main').evaluate(el=>el.inert),false);
    await page.setViewportSize({width:320,height:740});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.evaluate(()=>document.documentElement.style.fontSize='32px');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.evaluate(()=>document.documentElement.style.fontSize='16px');
    const firstTask=await page.locator('.task-item[aria-current="true"]').getAttribute('data-task-id');
    const firstTaskMessages=await page.locator('.message-content').allTextContents();
    await input.fill('任务一的草稿');
    await openSidebar();await page.locator('#new-task').click();await page.locator('#new-conversation-welcome').waitFor();
    assert.equal(await page.locator('.user').count(),0,'new task has independent context');
    assert.equal(await input.inputValue(),'');
    assert.equal(await page.locator('.task-item').count(),1,'landing does not create an empty task');
    await say('我想学习编程');
    const secondTask=await page.locator('.task-item[aria-current="true"]').getAttribute('data-task-id');assert.notEqual(firstTask,secondTask);
    await input.fill('任务二的草稿');
    await switchConversation(firstTask);
    assert.equal(await input.inputValue(),'任务一的草稿');
    assert.deepEqual(await page.locator('.message-content').allTextContents(),firstTaskMessages);
    await page.reload();await page.locator('#intro-skip').click();await page.locator('#intro').waitFor({state:'detached'});await page.locator('.assistant').waitFor();
    assert.equal(await page.locator('.task-item').count(),2,'tasks survive refresh');
    assert.equal(await input.inputValue(),'任务一的草稿');
    await switchConversation(secondTask);assert.equal(await input.inputValue(),'任务二的草稿');
    await page.reload();await page.keyboard.press('Escape');await page.locator('#intro').waitFor({state:'detached'});
    await page.emulateMedia({reducedMotion:'reduce'});await page.reload();await page.locator('.assistant').waitFor();assert.equal(await page.locator('#intro').count(),0,'reduced motion skips the entry animation');
    // The first submitted question can fail and retry in the same task.
    await page.route('**/api/chat',route=>route.abort());await openSidebar();await page.locator('#new-task').click();await input.fill('第一次问题');await input.press('Enter');await page.locator('#error-message:visible').waitFor();
    assert.equal(await page.locator('#send-button').isEnabled(),true);await page.unroute('**/api/chat');await page.locator('#send-button').click();await page.locator('.assistant').waitFor();
    assert.equal(await input.isEnabled(),true);assert.deepEqual(errors,[]);
    console.log(JSON.stringify({entryAnimation:true,entrySkip:true,reducedMotion:true,opening:true,contextualFollowup:true,detour:true,summary:true,topicChange:true,ime:true,retryWithoutDuplicates:true,openingRetry:true,independentTasks:true,taskDrafts:true,taskReload:true,mobileWidths:[390,320],textEnlargement:'200%',pageErrors:errors},null,2));
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1});
