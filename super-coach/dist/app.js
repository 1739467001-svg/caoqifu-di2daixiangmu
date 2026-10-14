import {TaskStore} from './task-store.js';
import {getReplyPrompts} from './reply-prompts.js';
import {splitPopup,readableMessage} from './coach-protocol.js';
import {normalizeHighlights,highlightedSegments,replyParagraphs} from './message-presentation.js';
import {VoiceInput} from './voice-input.js';
import {receiveUpgrade,openSecurePage} from './secure-upgrade.js';
// Presentation and transport only. Coaching strategy lives on the server.
const log=document.querySelector('#conversation');
const scroller=document.querySelector('#conversation-scroll');
const form=document.querySelector('#chat-form');
const input=document.querySelector('#message-input');
const send=document.querySelector('#send-button');
const deliveryControls=document.querySelector('#delivery-controls');
const deliveryStatus=document.querySelector('#delivery-status');
const queueButton=document.querySelector('#queue-button');
const queuedMessage=document.querySelector('#queued-message');
const queuedText=document.querySelector('#queued-text');
const cancelQueued=document.querySelector('#cancel-queued');
const sendQueued=document.querySelector('#send-queued');
const voiceButton=document.querySelector('#voice-button');
const voiceStatus=document.querySelector('#voice-status');
const securePageButton=document.querySelector('#secure-page-button');
let secureOrigin='';
let serverMode=null;
function updateModelLabels(){
  const mode=serverMode||store.active?.mode;
  const note=document.querySelector('.note-mode');
  note.textContent=mode==='mock'?'模拟回复':'AI 回复';
  note.title=mode==='live'?'当前对话内容会发送给豆包，用于生成回复。':'';
}
function voiceNotice(text='',reason=''){
  updateNotice(voiceStatus,text);voiceStatus.dataset.reason=reason;
  securePageButton.hidden=reason!=='https'||!secureOrigin;
}
const errorBox=document.querySelector('#error-message');
const taskList=document.querySelector('#task-list');
const sidebar=document.querySelector('#task-sidebar');
const sidebarShell=document.querySelector('#sidebar-shell');
const sidebarToggle=document.querySelector('#sidebar-toggle');
const sidebarClose=document.querySelector('#sidebar-close');
const sidebarBackdrop=document.querySelector('#sidebar-backdrop');
const main=document.querySelector('#chat-main');
const mobileLayout=window.matchMedia('(max-width: 640px)');
// iOS and embedded browsers may resize only the visual viewport when the
// keyboard opens. Size the phone layout to that area without disabling zoom.
const visualViewport=window.visualViewport;
let viewportFrame=0;
function syncMobileViewport(){
  viewportFrame=0;
  const root=document.documentElement;
  if(!mobileLayout.matches||!visualViewport||Math.abs(visualViewport.scale-1)>.02){
    root.style.removeProperty('--app-height');root.style.removeProperty('--app-top');return;
  }
  root.style.setProperty('--app-height',`${visualViewport.height}px`);
  root.style.setProperty('--app-top',`${visualViewport.offsetTop}px`);
}
function queueMobileViewport(){if(!viewportFrame)viewportFrame=requestAnimationFrame(syncMobileViewport);}
visualViewport?.addEventListener('resize',queueMobileViewport);
visualViewport?.addEventListener('scroll',queueMobileViewport);
mobileLayout.addEventListener('change',queueMobileViewport);
syncMobileViewport();
let sidebarOpen=false;
const newTaskButton=document.querySelector('#new-task');
const storageNotice=document.querySelector('#storage-notice');
const announcement=document.querySelector('#task-announcement');
const archiveToggle=document.querySelector('#archive-toggle');
const taskFeedback=document.querySelector('#task-feedback');
const messageFeedback=document.querySelector('#message-feedback');
const deleteDialog=document.querySelector('#delete-dialog');
const messageDeleteDialog=document.querySelector('#message-delete-dialog');
const modeTrigger=document.querySelector('#interaction-mode-trigger');
const modeBar=document.querySelector('#interaction-mode-bar');
const composerShell=document.querySelector('#composer-shell');
const promptPanel=document.querySelector('#composer-prompts');
const promptList=document.querySelector('#prompt-list');
const promptToggle=document.querySelector('#prompt-toggle');
const openAnswerGuide=document.querySelector('#open-answer-guide');
const retryAction=document.querySelector('#retry-action');
const promptStates=new Map();
let promptViewKey='',currentPrompts=null;
const modeNames={choice:'选项辅助',open:'自由表达'};
const landingCoach={id:'landing',requiresInteractionMode:false,interactionMode:null,messages:[]};
let pendingMessageDelete=null;
let pendingDeleteId=null;
let showArchived=false,renameTaskId=null;
let composing=false,renderedTaskId=null;
const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
const activeMotions=new Set();
const easeOut='cubic-bezier(.22,.8,.3,1)';
let sidebarMotions=[],sidebarSequence=0,conversationMotion=null,inputMotion=null;
function animateUI(element,keyframes,options={},cleanup=()=>{}){
  if(reducedMotion.matches||!element.animate){cleanup();return null;}
  const animation=element.animate(keyframes,{duration:260,easing:easeOut,...options});
  activeMotions.add(animation);
  const done=()=>{activeMotions.delete(animation);cleanup();};
  animation.finished.then(done,done);return animation;
}
reducedMotion.addEventListener('change',event=>{if(event.matches)for(const animation of activeMotions)animation.finish();});
function revealUI(element,delay=0){return animateUI(element,[{opacity:0,transform:'translateY(9px)'},{opacity:1,transform:'translateY(0)'}],{duration:300,delay,fill:'backwards'});}
function fadeRemoved(element){
  if(reducedMotion.matches||!element.getClientRects().length)return;
  const ghost=element.cloneNode(true);ghost.classList.add('motion-ghost');ghost.inert=true;ghost.setAttribute('aria-hidden','true');
  ghost.removeAttribute('data-message-id');ghost.removeAttribute('data-task-id');
  for(const current of ghost.querySelectorAll('[aria-current]'))current.removeAttribute('aria-current');
  Object.assign(ghost.style,{left:element.offsetLeft+'px',top:element.offsetTop+'px',width:element.offsetWidth+'px',height:element.offsetHeight+'px'});
  element.parentElement.append(ghost);
  animateUI(ghost,[{opacity:.7,transform:'translateX(0) scale(1)'},{opacity:0,transform:'translateX(-10px) scale(.97)'}],{duration:160},()=>ghost.remove());
}
function moveUI(element,previousTop){
  const distance=previousTop-element.offsetTop;
  if(Math.abs(distance)>1&&Math.abs(distance)<300)animateUI(element,[{transform:`translateY(${distance}px)`},{transform:'translateY(0)'}],{duration:280});
}
function updateNotice(element,text){
  const changed=element.textContent!==text,wasHidden=element.hidden;
  element.textContent=text;element.hidden=!text;
  if(text&&(wasHidden||changed))revealUI(element);
}
let storage;
try{storage=window.localStorage;}catch{storage=null;}
const upgradeNotice=await receiveUpgrade(storage);
const store=new TaskStore({reply:requestReply,storage,onChange:onStoreChange});
showArchived=store.active?.archived===true;
const voice=new VoiceInput({
  Recognition:window.SpeechRecognition||window.webkitSpeechRecognition,
  secureContext:window.isSecureContext,
  onDraft:(text,caret,id)=>{
    if(store.activeId!==id||store.active?.archived)return;
    input.value=text;input.setSelectionRange(caret,caret);store.setDraft(text);
    renderStorageNotice();resizeInput();updateSend();
  },
  onState:state=>{
    const active=state!=='idle',listening=state==='listening';
    form.classList.toggle('is-voice-active',active);form.classList.toggle('is-listening',listening);form.dataset.voiceState=state;
    input.readOnly=active||store.active?.requiresInteractionMode===true;
    voiceButton.setAttribute('aria-pressed',String(listening));voiceButton.setAttribute('aria-busy',String(state==='starting'||state==='stopping'));
    const label=state==='starting'?'取消语音输入':active?'停止语音输入':'语音输入';voiceButton.setAttribute('aria-label',label);voiceButton.title=label;
    updateSend();
  },
  onNotice:voiceNotice,
});
void fetch('/api/config').then(response=>response.ok?response.json():null).then(config=>{
  if(typeof config?.useMock==='boolean'){serverMode=config.useMock?'mock':'live';updateModelLabels();}
  if(!config?.secureOrigin||location.protocol!=='http:')return;
  const target=new URL(config.secureOrigin);
  if(target.protocol==='https:'&&target.host===location.host){
    secureOrigin=target.origin;
    if(voiceStatus.dataset.reason==='https')voiceNotice('安全连接已就绪，进入安全页面后即可申请麦克风权限。原网址的记录会保留。','https');
  }
}).catch(()=>{});
securePageButton.addEventListener('click',()=>{
  store.setDraft(input.value);
  const raw=JSON.stringify({version:2,activeId:store.activeId,newDraft:store.newDraft,tasks:store.tasks});
  openSecurePage(secureOrigin,raw,text=>voiceNotice(text,'https'));
});
voiceButton.addEventListener('click',()=>{
  if(messageDeleteDialog.open)return;
  if(voice.active){voice.stop();return;}
  if(input.disabled||input.readOnly)return;
  if(!window.isSecureContext&&secureOrigin){voiceNotice('语音需要安全连接。点击下方进入安全页面，会带上当前对话；原网址的记录也会保留。','https');return;}
  if(input.value.length>=input.maxLength){updateNotice(voiceStatus,'输入框已满，请先修改文字或发送这条消息。');return;}
  const started=voice.start({contextId:store.activeId,text:input.value,selectionStart:input.selectionStart,selectionEnd:input.selectionEnd,maxLength:input.maxLength});
  // Keep typing available in embedded browsers without SpeechRecognition.
  // Focus inside the user's click so mobile keyboards can open naturally.
  if(!started&&voiceStatus.dataset.reason==='unsupported')input.focus({preventScroll:true});
});
form.addEventListener('click',event=>{if(event.target===form&&!input.disabled)input.focus();});
form.addEventListener('keydown',event=>{if(event.key==='Escape'&&voice.active){event.preventDefault();voice.stop();}});

// The entry sequence is a short brand animation, not model/network progress.
// It runs independently of connect(), so a slow or failed API never traps users.
function playIntro(){
  const intro=document.querySelector('#intro');
  const app=document.querySelector('.chat-app');
  const skipLink=document.querySelector('.skip-link');
  const skip=document.querySelector('#intro-skip');
  const fill=document.querySelector('#intro-fill');
  const percent=document.querySelector('#intro-percent');
  const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
  if(reducedMotion.matches){intro.remove();return;}
  let frame=0,finished=false,exitTimer=0;
  const started=performance.now();
  const previousFocus=document.activeElement;
  function cleanUp(){
    clearTimeout(exitTimer);intro.remove();app.inert=false;skipLink.inert=false;
    document.removeEventListener('keydown',onKey);reducedMotion.removeEventListener('change',onMotionChange);
    if(previousFocus instanceof HTMLElement&&previousFocus!==document.body)previousFocus.focus({preventScroll:true});
    else document.querySelector('.page-header h1').focus({preventScroll:true});
    renderModeControls();
  }
  function finish(immediate=false){
    if(finished)return;finished=true;cancelAnimationFrame(frame);clearTimeout(safetyTimer);
    fill.style.transform='scaleX(1)';percent.textContent='100%';
    if(immediate){cleanUp();return;}
    intro.classList.add('is-leaving');
    // Timeout cleanup also works if CSS animations are disabled or interrupted.
    exitTimer=setTimeout(cleanUp,620);
  }
  function onKey(event){
    if(event.key==='Escape'){event.preventDefault();finish(true);}
    if(event.key==='Tab'){event.preventDefault();skip.focus({preventScroll:true});}
  }
  function onMotionChange(event){if(event.matches)finish(true);}
  function tick(now){
    const progress=Math.min((now-started)/1900,1);
    const eased=1-Math.pow(1-progress,1.5);
    fill.style.transform=`scaleX(${eased})`;percent.textContent=`${Math.floor(eased*100)}%`;
    if(progress<1)frame=requestAnimationFrame(tick);else finish();
  }
  const safetyTimer=setTimeout(()=>finish(true),3000);
  intro.hidden=false;app.inert=true;skipLink.inert=true;
  document.querySelector('.page-header h1').tabIndex=-1;
  intro.tabIndex=-1;intro.focus({preventScroll:true});
  intro.addEventListener('click',()=>finish(true));
  document.addEventListener('keydown',onKey);reducedMotion.addEventListener('change',onMotionChange);
  frame=requestAnimationFrame(tick);
}

function resizeInput(){
  const previous=input.getBoundingClientRect().height;inputMotion?.cancel();
  input.style.height='auto';const height=Math.min(input.scrollHeight,parseFloat(getComputedStyle(input).maxHeight)||180);input.style.height=`${height}px`;
  if(previous&&height&&Math.abs(previous-height)>2)inputMotion=animateUI(input,[{height:previous+'px'},{height:height+'px'}],{duration:160});
}
function updateSend(){
  const task=store.active,hasDraft=!!input.value.trim(),controlled=!!task?.pending&&task.waiting;
  send.classList.toggle('is-processing',controlled);
  send.classList.toggle('is-paused',!!task?.stopped&&!hasDraft);
  deliveryControls.hidden=!(task?.waiting||task?.stopped)||task?.archived===true;
  const status=task?.stopped?'当前对话已被暂停':hasDraft?'点方块停止本段，或排队发送':'回复中 · 点方块停止本段';
  if(deliveryStatus.textContent!==status)deliveryStatus.textContent=status;
  queueButton.hidden=!task?.waiting||!hasDraft;queueButton.disabled=!!task?.queued||voice.active;
  queueButton.textContent=task?.queued?'已有一条排队':'排队发送';
  queuedMessage.hidden=!task?.queued||task?.archived===true;
  sendQueued.hidden=!task?.queued||task.waiting||!!task.pending||task.stopped;
  queuedText.textContent=task?.queued?(task.stopped?'未发送：':'待发送：')+task.queued.content:'';queuedText.title=task?.queued?.content||'';
  voiceButton.disabled=!voice.active&&(input.disabled||input.readOnly);
  if(voice.active){send.disabled=true;return;}
  if(!task){send.disabled=!hasDraft;send.setAttribute('aria-label','发送消息');send.title='发送消息';return;}
  send.disabled=task.archived||task.requiresInteractionMode||(task.stopped?!hasDraft:!controlled&&!task.openingError&&(!task.connected||!hasDraft&&!task.pending));
  const label=controlled?'停止本段对话':task.stopped?(hasDraft?'发送新话题':'当前对话已被暂停'):task.openingError?'重试连接':task.pending&&!hasDraft?'重试本条':'发送消息';
  send.setAttribute('aria-label',label);send.title=label;
}
function promptState(task){
  if(!promptStates.has(task.id))promptStates.set(task.id,{choosingMode:false,collapsed:false,replyId:null});
  return promptStates.get(task.id);
}
function renderModeControls(){
  const task=store.active||landingCoach;
  composerShell.hidden=task?.archived===true;
  openAnswerGuide.hidden=true;
  input.setAttribute('aria-describedby','composer-note');
  retryAction.hidden=!task?.error||!task.pending||task.archived||task.waiting||task.stopped;
  retryAction.textContent=task?.pending?.action==='mode'?'重试切换模式':task?.pending?.action==='choice'?'重试这次选择':'重试本条';
  if(task.archived){
    modeBar.hidden=true;promptPanel.hidden=true;composerShell.classList.remove('has-prompts');currentPrompts=null;promptViewKey='';promptList.replaceChildren();return;
  }
  const state=promptState(task),latest=task.messages.at(-1);
  if(latest?.id!==state.replyId){state.replyId=latest?.id;state.collapsed=false;state.freeInput=false;}
  const selecting=task.requiresInteractionMode||state.choosingMode;
  const replyPrompts=!selecting&&!task.waiting?getReplyPrompts(latest,task.interactionMode):null;
  currentPrompts=!task.pending&&replyPrompts?.kind==='choice'?replyPrompts:null;
  openAnswerGuide.hidden=!!task.pending||replyPrompts?.kind!=='open';
  modeBar.hidden=!!task.waiting||!!task.stopped;
  modeTrigger.textContent=task.pending?.action==='mode'&&(task.waiting||task.error)?(task.waiting?'正在切换 · ':'切换待重试 · ')+modeNames[task.interactionMode]:task.interactionMode?modeNames[task.interactionMode]+' · 更换':'聊天方式 · 可选';
  modeTrigger.disabled=task.waiting||task.stopped;
  input.placeholder=task.requiresInteractionMode?'请先在上方选择一种聊天方式…':state.freeInput?'说说你自己的想法…':task.coachState?.phase==='topic'?'用一两句话，说说你想解决的事…':'想到什么，就慢慢说…';
  input.setAttribute('aria-describedby',openAnswerGuide.hidden?'composer-note':'open-answer-guide composer-note');
  if(task.requiresInteractionMode){
    input.readOnly=true;voiceButton.disabled=true;send.disabled=true;
    if(document.activeElement===input)input.blur();
  }
  const visible=!task.waiting&&(selecting||!!currentPrompts);
  const expanded=visible&&!state.collapsed;
  modeTrigger.setAttribute('aria-expanded',String(selecting&&expanded));
  promptToggle.hidden=!visible;
  promptToggle.setAttribute('aria-expanded',String(expanded));
  document.querySelector('#prompt-toggle-label').textContent=(selecting?'2 种偏好':currentPrompts?currentPrompts.items.length+' 个选项':'')+' · '+(expanded?'收起':'展开');
  if(!expanded&&promptPanel.contains(document.activeElement))(visible?promptToggle:modeTrigger).focus({preventScroll:true});
  if(promptPanel.hidden){promptPanel.hidden=false;promptPanel.classList.remove('is-expanded');void promptPanel.offsetHeight;}
  promptPanel.inert=!expanded;promptPanel.setAttribute('aria-hidden',String(!expanded));
  promptPanel.classList.toggle('is-expanded',expanded);
  composerShell.classList.toggle('has-prompts',visible);
  if(!visible){promptViewKey='';promptList.replaceChildren();return;}
  const key=task.id+':'+(selecting?'modes':latest.id+':'+task.interactionMode);
  if(promptViewKey!==key){
    promptViewKey=key;promptList.replaceChildren();
    const heading=document.querySelector('#prompt-heading'),hint=document.querySelector('#prompt-hint');
    heading.textContent=selecting?'按你舒服的方式聊。':currentPrompts.title;
    heading.hidden=false;
    hint.textContent=selecting?'只是偏好，也可以不选，直接说。':'点选回答，也可以自己说。';
    const items=selecting?[
      {key:'choice',label:'A',text:'选项辅助',detail:'需要时给几个选项，也能直接说'},
      {key:'open',label:'B',text:'自由表达',detail:'自然地聊，先问清楚，再一起找办法'},
    ]:currentPrompts.items;
    items.forEach((item,index)=>{
      const button=document.createElement('button');button.type='button';button.className='prompt-option';
      button.dataset.taskId=task.id;
      if(selecting){button.dataset.chooseMode=item.key;button.setAttribute('aria-pressed',String(task.interactionMode===item.key));}
      else{button.dataset.promptKey=item.key;button.dataset.replyId=latest.id;}
      const label=document.createElement('span');label.className='prompt-option-label';label.textContent=item.label;
      const body=document.createElement('span');body.className='prompt-option-body';
      const title=document.createElement('span');title.textContent=item.text;body.append(title);
      if(item.detail){const detail=document.createElement('small');detail.textContent=item.detail;body.append(detail);}
      button.append(label,body);promptList.append(button);revealUI(button,Math.min(index,5)*45);
    });
    document.querySelector('#prompt-scroll').scrollTop=0;
  }
}
function openModeChoices(){
  const task=store.active||landingCoach;if(task.archived||task.waiting)return;
  voice.cancel();const state=promptState(task);
  state.choosingMode=task.requiresInteractionMode||!state.choosingMode||state.collapsed;
  state.collapsed=false;renderModeControls();
}
modeTrigger.addEventListener('click',openModeChoices);
promptToggle.addEventListener('click',()=>{
  const task=store.active||landingCoach;
  promptState(task).collapsed=!promptState(task).collapsed;renderModeControls();
});
promptPanel.addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();promptState(store.active||landingCoach).collapsed=true;renderModeControls();}
});
promptList.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button||!promptList.contains(button))return;
  const task=store.active||landingCoach;if(button.dataset.taskId!==task.id||task.waiting||task.archived)return;
  const state=promptState(task),mode=button.dataset.chooseMode;
  if(mode){
    if(task===landingCoach){voice.cancel();await store.beginCoach(mode);return;}
    const wasChoosing=state.choosingMode;
    state.choosingMode=false;state.collapsed=false;
    voice.cancel();
    const changed=await store.changeInteractionMode(task.id,mode);
    if(store.activeId!==task.id)return;
    if(!changed&&!task.error){state.choosingMode=wasChoosing;renderModeControls();showMessageFeedback('选择暂未保存，请稍后重试。');return;}
    renderModeControls();
    if(changed)announcement.textContent='聊天偏好已改为'+modeNames[mode]+'。';
    return;
  }
  if(task.pending||task.requiresInteractionMode||task.messages.at(-1)?.id!==button.dataset.replyId||currentPrompts?.kind!=='choice')return;
  const item=currentPrompts.items.find(item=>item.key===button.dataset.promptKey);if(!item)return;
  voice.cancel();
  if(item.requiresText){state.freeInput=true;state.collapsed=true;renderModeControls();input.focus({preventScroll:true});announcement.textContent='在输入框里说说你的想法。';return;}
  if(item.draft.length>6000){showMessageFeedback('这一项较长，可以在输入框中说说你的选择。');return;}
  void store.submit(task.id,item.draft,{preserveDraft:true,action:item.action||'choice'});
});
retryAction.addEventListener('click',()=>{void store.retryAction(store.activeId);});
function renderStorageNotice(){updateNotice(storageNotice,store.storageWarning);}
function showTaskFeedback(message=''){updateNotice(taskFeedback,message);}
const actionPaths={
  rename:'<path d="m15 5 4 4M4 20l4-1 12-12a2.8 2.8 0 0 0-4-4L4 15v5Z"/>',
  archive:'<path d="M5 9v11h14V9M9 13h6"/><rect x="3" y="4" width="18" height="5" rx="1"/>',
  restore:'<path d="M5 10v10h14V10M8 8l4-4 4 4m-4-4v11"/>',
  delete:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  save:'<path d="m5 12 4 4L19 6"/>',
  cancel:'<path d="m6 6 12 12M6 18 18 6"/>',
  copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
  branch:'<path d="m8 5-4 4 4 4M4 9h10a6 6 0 0 1 0 12"/>',
};
function setTaskAction(button,action,label,title){
  if(button.dataset.taskAction!==action){
    button.dataset.taskAction=action;
    // Icons are fixed markup; conversation names are assigned as text attributes.
    button.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+actionPaths[action]+'</svg>';
  }
  button.title=label;button.setAttribute('aria-label',label+'：'+title);
}
function renderTaskList(){
  sidebar.classList.toggle('is-archive-view',showArchived);
  // Keep existing buttons in place so background replies do not steal keyboard focus.
  const rows=new Map([...taskList.children].filter(row=>!row.classList.contains('motion-ghost')).map(row=>[row.dataset.taskId,row]));
  const positions=new Map([...rows].map(([id,row])=>[id,row.offsetTop]));
  const entering=[];
  const visibleTasks=[...store.tasks].reverse().filter(task=>task.archived===showArchived);
  visibleTasks.forEach((task,index)=>{
    let row=rows.get(task.id);
    if(!row){
      row=document.createElement('li');row.dataset.taskId=task.id;row.className='task-row';
      entering.push(row);
      const button=document.createElement('button');button.type='button';button.className='task-item';button.dataset.taskId=task.id;
      const title=document.createElement('span');title.className='task-title';
      const status=document.createElement('span');status.className='task-status';
      button.append(title,status);
      const name=document.createElement('input');name.type='text';name.className='task-name-input';name.maxLength=60;name.autocomplete='off';name.hidden=true;
      name.setAttribute('aria-label','对话 '+task.number+' 的名称');name.setAttribute('aria-describedby','task-name-hint');
      const actions=document.createElement('div');actions.className='task-actions';
      for(let index=0;index<3;index++){
        const action=document.createElement('button');action.type='button';action.className='task-action';actions.append(action);
      }
      row.append(button,name,actions);
    }
    const button=row.firstElementChild,title=store.title(task);
    const status=task.waiting?'认真倾听中':task.stopped?'已暂停':task.error?'待重试':task.unread?'新回复':'';
    button.querySelector('.task-title').textContent=title;
    button.querySelector('.task-status').textContent=status;
    button.querySelector('.task-status').hidden=!status;
    button.querySelector('.task-status').title=status;
    button.title=`对话 ${task.number} · ${title}`;
    button.setAttribute('aria-label',`${title}，对话 ${task.number}${status?'，'+status:''}`);
    row.classList.toggle('is-current',task.id===store.activeId);
    row.classList.toggle('is-archived',task.archived);
    const editing=renameTaskId===task.id;row.classList.toggle('is-editing',editing);
    button.hidden=editing;row.querySelector('.task-name-input').hidden=!editing;
    const actions=row.querySelector('.task-actions').children;
    setTaskAction(actions[0],editing?'save':'rename',editing?'保存名称':'重命名',title);
    setTaskAction(actions[1],editing?'cancel':task.archived?'restore':'archive',editing?'取消':task.archived?'恢复对话':'归档',title);
    actions[2].hidden=!task.archived||editing;
    setTaskAction(actions[2],'delete','彻底删除',title);
    actions[2].title='彻底删除，无法恢复';
    if(task.id===store.activeId)button.setAttribute('aria-current','true');else button.removeAttribute('aria-current');
    if(taskList.children[index]!==row)taskList.insertBefore(row,taskList.children[index]||null);
    rows.delete(task.id);
  });
  for(const row of rows.values()){fadeRemoved(row);row.remove();}
  for(const row of [...taskList.children].filter(row=>!row.classList.contains('motion-ghost'))){
    if(positions.has(row.dataset.taskId))moveUI(row,positions.get(row.dataset.taskId));
  }
  entering.forEach((row,index)=>revealUI(row,Math.min(index,4)*20));
  document.querySelector('#task-list-label').textContent=showArchived?'已归档对话':'你的对话';
  const empty=document.querySelector('#task-list-empty');empty.hidden=visibleTasks.length>0;empty.textContent=showArchived?'还没有归档对话。':'还没有对话，点击上方开始聊聊。';
  archiveToggle.textContent=showArchived?'← 返回对话列表':`已归档（${store.tasks.filter(task=>task.archived).length}）`;
  archiveToggle.setAttribute('aria-pressed',String(showArchived));
  const heading=document.querySelector('#current-task-name');
  const previousTitle=heading.textContent;
  heading.textContent=store.title(store.active);heading.title=store.title(store.active);
  if(previousTitle!==heading.textContent)animateUI(heading,[{opacity:.25,transform:'translateY(-3px)'},{opacity:1,transform:'translateY(0)'}],{duration:200});
  if(renderedTaskId!==store.activeId)taskList.querySelector('[aria-current="true"]')?.scrollIntoView({block:'nearest'});
}

function setSidebar(open,{focus=true,animate=true}={}){
  finishRename();
  const sequence=++sidebarSequence,wasHidden=sidebar.hidden;
  const width=sidebarShell.getBoundingClientRect().width;
  const previousStyle=getComputedStyle(sidebar),fromTransform=wasHidden?'translateX(-100%)':previousStyle.transform,fromOpacity=wasHidden?0:previousStyle.opacity;
  const backdropOpacity=sidebarBackdrop.hidden?0:getComputedStyle(sidebarBackdrop).opacity;
  for(const animation of sidebarMotions)animation?.cancel();sidebarMotions=[];
  sidebarOpen=open;sidebar.hidden=false;sidebar.inert=!open;
  sidebarShell.classList.toggle('is-collapsed',!open);
  document.querySelector('.chat-app').classList.toggle('sidebar-visible',open);
  const modal=mobileLayout.matches&&open;
  main.inert=modal;document.querySelector('.skip-link').inert=modal;
  sidebarBackdrop.classList.toggle('is-visible',modal);
  sidebarBackdrop.setAttribute('aria-hidden',String(!modal));
  sidebarToggle.setAttribute('aria-expanded',String(open));
  const label=open?'收起对话列表':'展开对话列表';sidebarToggle.setAttribute('aria-label',label);sidebarToggle.title=label;
  if(modal){sidebar.setAttribute('role','dialog');sidebar.setAttribute('aria-modal','true');}
  else{sidebar.removeAttribute('role');sidebar.removeAttribute('aria-modal');}
  if(animate&&!reducedMotion.matches){
    if(!mobileLayout.matches)sidebarMotions.push(animateUI(sidebarShell,[{width:width+'px'},{width:sidebarShell.getBoundingClientRect().width+'px'}],{duration:320},()=>{if(sequence===sidebarSequence)resizeInput();}));
    sidebarMotions.push(animateUI(sidebar,[{transform:fromTransform,opacity:fromOpacity},{transform:open?'translateX(0)':'translateX(-100%)',opacity:open?1:0}],{duration:320},()=>{
      if(sequence===sidebarSequence&&!sidebarOpen)sidebar.hidden=true;
    }));
    if(modal||!sidebarBackdrop.hidden){
      sidebarBackdrop.hidden=false;
      sidebarMotions.push(animateUI(sidebarBackdrop,[{opacity:backdropOpacity},{opacity:modal?1:0}],{duration:260},()=>{
        if(sequence===sidebarSequence&&!modal)sidebarBackdrop.hidden=true;
      }));
    }
  }else{sidebar.hidden=!open;sidebarBackdrop.hidden=!modal;}
  if(focus){if(modal)newTaskButton.focus({preventScroll:true});else if(open)sidebarClose.focus({preventScroll:true});else sidebarToggle.focus({preventScroll:true});}
}
function closeMobileSidebar(){if(mobileLayout.matches&&sidebarOpen)setSidebar(false);}
sidebarToggle.addEventListener('click',()=>setSidebar(!sidebarOpen));
sidebarClose.addEventListener('click',()=>setSidebar(false));
sidebarBackdrop.addEventListener('click',()=>setSidebar(false));
mobileLayout.addEventListener('change',()=>setSidebar(!mobileLayout.matches,{focus:sidebar.contains(document.activeElement),animate:false}));
document.addEventListener('keydown',event=>{
  if(deleteDialog.open||messageDeleteDialog.open||!mobileLayout.matches||!sidebarOpen)return;
  if(event.key==='Escape'){event.preventDefault();setSidebar(false);return;}
  if(event.key!=='Tab')return;
  const controls=[...sidebar.querySelectorAll('button:not(:disabled),input:not(:disabled)')].filter(control=>control.getClientRects().length);
  const first=controls[0],last=controls.at(-1);
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
});
function finishRename(save=true,focus=false){
  if(!renameTaskId)return;
  const id=renameTaskId,row=[...taskList.children].find(item=>item.dataset.taskId===id);
  const value=row?.querySelector('.task-name-input').value;
  renameTaskId=null;
  if(save&&store.renameTask(id,value))announcement.textContent='对话已重命名为：'+store.title(store.getTask(id));
  else{renderTaskList();announcement.textContent=save?'名称未更改，请输入非空名称。':'已取消重命名。';}
  if(row?.isConnected)animateUI(row.querySelector('.task-item'),[{opacity:.2},{opacity:1}],{duration:180});
  if(focus)row?.querySelector('[data-task-action="rename"]').focus({preventScroll:true});
}
function startRename(id){
  finishRename();showTaskFeedback();const task=store.getTask(id);if(!task)return;
  renameTaskId=id;renderTaskList();
  const name=taskList.querySelector('.is-editing .task-name-input');
  name.value=store.title(task);name.focus({preventScroll:true});name.select();
  animateUI(name,[{opacity:.2,transform:'translateX(-4px)'},{opacity:1,transform:'translateX(0)'}],{duration:180});
}
taskList.addEventListener('keydown',event=>{
  if(!renameTaskId||event.target.closest('.task-row')?.dataset.taskId!==renameTaskId)return;
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();finishRename(false,true);}
  else if(event.target.matches('.task-name-input')&&event.key==='Enter'&&!event.isComposing&&event.keyCode!==229){
    event.preventDefault();finishRename(true,true);
  }
});
taskList.addEventListener('focusout',event=>{
  const row=event.target.closest('.task-row');
  if(renameTaskId&&row?.dataset.taskId===renameTaskId&&!row.contains(event.relatedTarget))finishRename();
});
document.addEventListener('pointerdown',event=>{
  if(renameTaskId&&event.target.closest('.task-row')?.dataset.taskId!==renameTaskId)finishRename();
});
function restoreConversation(id){
  rememberView();finishRename();showTaskFeedback();showArchived=false;
  if(!store.restoreTask(id))return;
  if(store.activeId!==id)store.switchTask(id);
  announcement.textContent=`已恢复对话：${store.title(store.active)}`;
  closeMobileSidebar();
  if(!store.active.connected&&!store.active.waiting&&!store.active.openingError)void store.connect(id);
  else if(!input.disabled)input.focus({preventScroll:true});
}
function archiveConversation(id){
  const task=store.getTask(id);if(!task)return;
  if(task.archived){restoreConversation(id);return;}
  const title=store.title(task);rememberView();finishRename();
  if(!store.archiveTask(id)){showTaskFeedback('这是最后一个对话，不能再归档。');return;}
  showTaskFeedback();
  if(sidebarOpen)(taskList.querySelector('[aria-current="true"]')||archiveToggle).focus({preventScroll:true});
  announcement.textContent=`已归档“${title}”，可从“已归档”中查看和恢复。`;
}
function deleteConversation(id){
  const task=store.getTask(id);if(!task?.archived||deleteDialog.open)return;
  finishRename();pendingDeleteId=id;deleteDialog.returnValue='cancel';
  document.querySelector('#delete-dialog-name').textContent=store.title(task);
  deleteDialog.showModal();deleteDialog.querySelector('[value="cancel"]').focus();
}
deleteDialog.addEventListener('close',()=>{
  const id=pendingDeleteId;pendingDeleteId=null;
  if(deleteDialog.returnValue==='delete'&&id)performDeleteConversation(id);
  else announcement.textContent='已取消删除，对话记录保留。';
});
function performDeleteConversation(id){
  const task=store.getTask(id);if(!task?.archived)return;
  const title=store.title(task);rememberView();finishRename();
  if(!store.deleteTask(id)){showTaskFeedback('删除未完成，本地保存暂不可用，请稍后重试。');return;}
  showTaskFeedback();announcement.textContent=`已彻底删除“${title}”。`;
  (taskList.querySelector('[aria-current="true"]')||taskList.querySelector('.task-item')||archiveToggle).focus({preventScroll:true});
}
archiveToggle.addEventListener('click',()=>{finishRename();showTaskFeedback();showArchived=!showArchived;renderTaskList();});
document.querySelector('#restore-current').addEventListener('click',()=>restoreConversation(store.activeId));
const messageDateFormat=new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function showMessageFeedback(text=''){updateNotice(messageFeedback,text);}
function durationLabel(ms){return ms<10?'处理 <0.01 秒':`处理 ${(ms/1000).toFixed(2)} 秒`;}
function appendMessageText(element,message){
  // Coach questions and options share one green marker. Model text is never HTML.
  if(message.role!=='assistant'){element.textContent=message.content;return;}
  // Old summary records stay readable inline, without a confirmation gate.
  const parts=splitPopup(message.content);
  const hasChoices=getReplyPrompts(message,message.interactionMode)?.kind==='choice';
  message={...message,content:hasChoices?parts.text:readableMessage(message.content)};
  let highlights=normalizeHighlights(message.content,message.highlights);
  // Old messages keep their question emphasis; new answers use model-selected key points.
  if(!highlights.length)highlights=[...message.content.matchAll(/[^\n。！？!?]+[？?]/gu)].filter(m=>m[0].trim().length<=90).slice(0,3).map(m=>m[0].trim().slice(-34));
  for(const paragraph of replyParagraphs(message.content)){
    const p=document.createElement('p');p.className='message-paragraph';
    for(const segment of highlightedSegments(paragraph,highlights)){
      if(segment.marked){const mark=document.createElement('span');mark.className='brush-mark';mark.textContent=segment.text;p.append(mark);}
      else p.append(document.createTextNode(segment.text));
    }
    element.append(p);
  }
}
function messageElement(message,task,failed=false,pending=false){
  const article=document.createElement('article');article.className=`message ${message.role}${failed?' failed':''}`;
  article.dataset.messageId=message.id;article.dataset.taskId=task.id;

  const bubble=document.createElement('div');bubble.className='message-bubble';
  const label=document.createElement('div');label.className='message-author';
  const content=document.createElement(message.role==='assistant'?'div':'p');content.className='message-content';appendMessageText(content,message);
  if(message.role==='assistant')bubble.append(label);
  bubble.append(content);
  const popup=message.role==='assistant'?splitPopup(message.content).popup:null;
  if(popup&&getReplyPrompts(message,message.interactionMode)?.kind==='choice'){
    const details=document.createElement('details');details.className='message-popup-history';
    const heading=document.createElement('summary');heading.textContent='查看这次选项';
    const body=document.createElement('p');body.textContent=popup;details.append(heading,body);bubble.append(details);
  }
  const footer=document.createElement('div');footer.className='message-footer';
  const time=document.createElement(message.createdAt==null?'span':'time');time.className='message-time';
  if(message.createdAt==null){time.textContent='时间未记录';time.title='旧消息未保存发送时间';}
  else{
    const date=new Date(message.createdAt);time.dateTime=date.toISOString();
    time.textContent=messageDateFormat.format(date);time.title=date.toLocaleString('zh-CN',{hour12:false});
  }
  footer.append(time);
  if(message.role==='assistant'){
    const duration=document.createElement('span');duration.className='message-duration';
    duration.textContent=message.processingMs==null?'耗时未记录':durationLabel(message.processingMs);
    duration.title=message.processingMs==null?'旧回复未记录处理耗时':`本次${task.mode==='mock'?'模拟回复':'回复'}处理耗时，不含网络传输`;
    label.append(duration);
  }else if(pending||message.interrupted||message.unsent){
    const status=document.createElement('span');status.className='message-send-status';status.textContent=message.unsent?'未发送':message.interrupted||task.stopped?'当前对话已被暂停':failed?'发送失败':'已发送';footer.append(status);
  }
  const actions=document.createElement('div');actions.className='message-actions';actions.setAttribute('role','group');actions.setAttribute('aria-label','消息操作');
  for(const [action,name] of [['copy','复制'],['branch','从这里继续'],['delete','删除']]){
    const button=document.createElement('button');button.type='button';button.className='message-action';button.dataset.messageAction=action;
    button.title=action==='branch'?'从这条消息继续，原对话保留':name+'消息';button.setAttribute('aria-label',action==='branch'?name:name+'消息');
    button.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+actionPaths[action]+'</svg>';
    if(action==='branch'){const text=document.createElement('span');text.textContent=name;button.append(text);}
    if(action==='delete'&&task.waiting){button.disabled=true;button.title='回复完成后可删除消息';}
    actions.append(button);
  }
  footer.append(actions);article.append(bubble,footer);return article;
}
function confirmMessageDelete(taskId,messageId){
  const task=store.getTask(taskId),message=store.getMessage(taskId,messageId);
  if(!task||!message||task.waiting||taskId!==store.activeId||messageDeleteDialog.open||deleteDialog.open)return;
  rememberView();showMessageFeedback();
  const ids=store.deletionMessageIds(taskId,[messageId]);
  pendingMessageDelete={taskId,messageId,ids};
  const paired=message.role==='user'&&ids.length>1;
  document.querySelector('#message-delete-title').textContent=paired?'删除这条提问和回答？':'删除这条消息？';
  const removesDraft=task.pending&&ids.includes(task.pending.id)&&task.draft===task.pending.content;
  document.querySelector('#message-delete-description').textContent=(paired?'这条提问及对应回答会一起删除。':'只删除这条消息，其余消息会保留。')+'删除后无法恢复。'+(removesDraft?'这条失败提问的同文重试草稿也会移除。':'');
  messageDeleteDialog.returnValue='cancel';messageDeleteDialog.showModal();messageDeleteDialog.querySelector('[value="cancel"]').focus();
}
messageDeleteDialog.addEventListener('close',()=>{
  const plan=pendingMessageDelete;pendingMessageDelete=null;
  if(!plan)return;
  if(messageDeleteDialog.returnValue!=='delete'){
    announcement.textContent='已取消删除，消息保留。';return;
  }
  if(store.activeId!==plan.taskId||store.getTask(plan.taskId)?.waiting||
    JSON.stringify(store.deletionMessageIds(plan.taskId,[plan.messageId]))!==JSON.stringify(plan.ids)){
    showMessageFeedback('消息已变化，请重新点击删除并确认。');return;
  }
  if(!store.deleteMessage(plan.taskId,plan.messageId)){
    showMessageFeedback('删除未完成，本地保存暂不可用，消息已保留。');return;
  }
  document.querySelector('#current-task-name').focus({preventScroll:true});
  showMessageFeedback(plan.ids.length>1?'已删除这条提问及对应回答。':'已删除这条消息。');
});
async function copyMessage(text){
  try{await navigator.clipboard.writeText(text);return true;}catch{
    const previous=document.activeElement,selection=document.getSelection();
    const ranges=selection?[...Array(selection.rangeCount)].map((_,index)=>selection.getRangeAt(index).cloneRange()):[];
    const field=document.createElement('textarea');field.className='copy-buffer';field.value=text;field.readOnly=true;document.body.append(field);field.select();
    let copied=false;try{copied=document.execCommand('copy');}catch{}finally{
      field.remove();previous?.focus({preventScroll:true});
      if(selection&&ranges.length){selection.removeAllRanges();for(const range of ranges)selection.addRange(range);}
    }
    return copied;
  }
}
log.addEventListener('click',async event=>{
  const button=event.target.closest('[data-message-action]');if(!button||!log.contains(button))return;
  const article=button.closest('.message'),id=article.dataset.taskId,messageId=article.dataset.messageId;
  const task=store.getTask(id),message=store.getMessage(id,messageId);if(!task||!message)return;
  if(button.dataset.messageAction==='copy'){
    const copied=await copyMessage(readableMessage(message.content));
    if(store.activeId===id)showMessageFeedback(copied?'已复制这条消息。':'复制未成功，请选中文字手动复制。');
    return;
  }
  if(button.dataset.messageAction==='delete'){
    if(task.waiting){showMessageFeedback('回复完成后可删除消息。');return;}
    confirmMessageDelete(id,messageId);
  }else if(button.dataset.messageAction==='branch'){
    rememberView();
    finishRename();showArchived=false;showTaskFeedback();composing=false;
    const branchId=store.branchTask(id,messageId);if(!branchId)return;
    closeMobileSidebar();showMessageFeedback(message.role==='user'?'已回到这条消息，修改或直接发送即可继续。':'已从这里开启独立对话，原对话保留。');
    input.focus({preventScroll:true});requestAnimationFrame(()=>{if(store.activeId===branchId)scroller.scrollTop=scroller.scrollHeight;});
  }
});
function renderConversation(restoreScroll){
  const task=store.active;
  if(pendingMessageDelete&&(pendingMessageDelete.taskId!==task?.id||task.waiting)){
    pendingMessageDelete=null;if(messageDeleteDialog.open)messageDeleteDialog.close('cancel');
  }
  if(voice.active&&(voice.contextId!==store.activeId||task?.archived))voice.cancel();
  if(renderedTaskId!==store.activeId)updateNotice(voiceStatus,'');
  const welcome=document.querySelector('#new-conversation-welcome');
  const wasNew=main.classList.contains('is-new-conversation');
  main.classList.toggle('is-archived-conversation',task?.archived===true);
  main.classList.toggle('is-new-conversation',!task);welcome.hidden=!!task;
  if(!task){
    renderedTaskId=null;log.replaceChildren();showMessageFeedback();
    document.querySelector('.chat-app').classList.remove('has-conversation');
    input.value=store.newDraft;input.disabled=false;input.readOnly=voice.active;input.placeholder='说说你的需求或想法…';
    form.hidden=false;form.setAttribute('aria-busy','false');
    document.querySelector('#archive-notice').hidden=true;document.querySelector('#composer-note').hidden=false;
    errorBox.textContent='';errorBox.hidden=true;updateModelLabels();
    scroller.scrollTop=0;resizeInput();updateSend();renderModeControls();
    if(!wasNew){revealUI(welcome);revealUI(form,40);}
    return;
  }
  const switched=renderedTaskId!==task.id,hadConversation=renderedTaskId!==null;
  const archivedBefore=form.hidden;
  if(switched){showMessageFeedback();log.replaceChildren();}
  const existing=new Map([...log.children].filter(element=>element.matches('.message:not(.motion-ghost)')).map(element=>[element.dataset.messageId,element]));
  const positions=new Map([...existing].map(([id,element])=>[id,element.offsetTop]));
  const readingTop=scroller.scrollTop;
  const nearBottom=scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight<100;
  const entering=[];
  renderedTaskId=task.id;
  document.querySelector('.chat-app').classList.toggle('has-conversation',task.messages.some(message=>message.role==='user')||!!task.pending);
  const messages=task.pending?[...task.messages,task.pending]:task.messages;
  messages.forEach((message,index)=>{
    const pending=message===task.pending,failed=pending&&!!task.error;
    let article=existing.get(message.id);
    if(!article){article=messageElement(message,task,failed,pending);entering.push(article);}
    else{
      article.classList.toggle('failed',failed);
      const status=article.querySelector('.message-send-status');
      if(status){if(message.unsent)status.textContent='未发送';else if(message.interrupted)status.textContent='当前对话已被暂停';else if(pending)status.textContent=task.stopped?'当前对话已被暂停':failed?'发送失败':'已发送';else status.remove();}
      const remove=article.querySelector('[data-message-action="delete"]');
      remove.disabled=task.waiting;remove.title=task.waiting?'回复完成后可删除消息':'删除消息';
    }
    if(log.children[index]!==article)log.insertBefore(article,log.children[index]||null);
    existing.delete(message.id);
  });
  for(const article of existing.values()){fadeRemoved(article);article.remove();}
  let indicator=log.querySelector('.thinking:not(.motion-ghost)');
  if(task.waiting||task.stopped){
    if(!indicator){indicator=document.createElement('div');indicator.className='thinking';indicator.setAttribute('role','status');log.append(indicator);revealUI(indicator);}
    indicator.classList.toggle('is-paused',task.stopped);
    indicator.textContent=task.stopped?'当前对话已被暂停':task.pending?.action==='mode'?'正在换一种问法，继续陪你慢慢聊…':task.connected?'我在认真听，也在想怎样陪你继续聊…':'探询正在和你打招呼…';
  }else indicator?.remove();
  if(switched&&hadConversation){
    conversationMotion?.cancel();
    conversationMotion=animateUI(scroller,[{opacity:.15,transform:'translateY(8px)'},{opacity:1,transform:'translateY(0)'}],{duration:280});
  }else{
    entering.forEach(article=>revealUI(article));
    for(const article of [...log.children].filter(element=>element.matches('.message:not(.motion-ghost)'))){
      if(positions.has(article.dataset.messageId))moveUI(article,positions.get(article.dataset.messageId));
    }
  }
  if(input.value!==task.draft)input.value=task.draft;
  input.disabled=(!task.connected&&!task.openingError)||task.archived;input.readOnly=voice.active||task.openingError;
  form.hidden=task.archived;document.querySelector('#archive-notice').hidden=!task.archived;document.querySelector('#composer-note').hidden=task.archived;
  if(archivedBefore!==task.archived)revealUI(task.archived?document.querySelector('#archive-notice'):form);
  form.setAttribute('aria-busy',String(task.waiting));
  errorBox.textContent=task.error;errorBox.hidden=!task.error||task.archived;
  updateModelLabels();
  resizeInput();updateSend();renderModeControls();
  const savedTop=task.scrollTop;
  requestAnimationFrame(()=>{
    if(store.activeId!==task.id)return;
    const reply=entering.findLast(article=>article.classList.contains('assistant'));
    // Let people read a long new reply from its beginning. Never pull a reader
    // away from older messages they chose to inspect while the reply was pending.
    if(restoreScroll){scroller.scrollTop=savedTop;return;}
    if(reply&&!nearBottom){scroller.scrollTop=readingTop;return;}
    const target=reply&&reply.offsetHeight>scroller.clientHeight*.7
      ?scroller.scrollTop+reply.getBoundingClientRect().top-scroller.getBoundingClientRect().top-12:scroller.scrollHeight;
    scroller.scrollTo({top:Math.max(0,target),behavior:reducedMotion.matches?'instant':'smooth'});
  });
}
function onStoreChange(changedTaskId,reason='conversation'){
  const switched=renderedTaskId!==store.activeId;
  renderTaskList();renderStorageNotice();
  if(switched||changedTaskId===store.activeId&&reason!=='metadata')renderConversation(switched||['archive','message-delete','stop','queue'].includes(reason));
}
function rememberView(){
  voice.cancel();voiceNotice();
  store.setScroll(scroller.scrollTop);store.setDraft(input.value);
}
async function requestReply(messages,{interactionMode=null,coachState=null,action=null,signal}={}){
  signal?.throwIfAborted();
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),75000);
  const cancel=()=>controller.abort(signal.reason);signal?.addEventListener('abort',cancel,{once:true});
  try{
    const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages,interactionMode,coachProtocol:1,coachState,action}),signal:controller.signal});
    let result;try{result=await response.json();}catch{throw new Error('教练暂时没有连接上。');}
    if(!response.ok)throw new Error(result.error||'这次没有收到回复。');
    if(result.message?.role!=='assistant'||typeof result.message.content!=='string'||!result.message.content.trim())throw new Error('没有收到完整的回复。');
    return {message:result.message,mode:result.mode==='mock'?'mock':'live',processingMs:result.processingMs,requiresInteractionMode:result.requiresInteractionMode===true,coachState:result.coachState,interactionMode:result.interactionMode};
  }catch(error){signal?.throwIfAborted();if(error.name==='AbortError')throw new Error('等待回复超时了。');if(error instanceof TypeError)throw new Error('网络暂时没有连接上。');throw error;}
  finally{clearTimeout(timeout);signal?.removeEventListener('abort',cancel);}
}
function openNewConversation(){
  rememberView();composing=false;
  finishRename();showTaskFeedback();showArchived=false;
  promptStates.delete('landing');store.startNew();announcement.textContent='直接说说你的问题，也可以先选聊天方式。';
  closeMobileSidebar();input.focus({preventScroll:true});
}
newTaskButton.addEventListener('click',openNewConversation);
taskList.addEventListener('click',event=>{
  const action=event.target.closest('[data-task-action]');
  if(action&&taskList.contains(action)){
    const id=action.closest('.task-row').dataset.taskId;
    if(action.dataset.taskAction==='rename')startRename(id);
    else if(action.dataset.taskAction==='save')finishRename(true,true);
    else if(action.dataset.taskAction==='cancel')finishRename(false,true);
    else if(action.dataset.taskAction==='delete')deleteConversation(id);
    else archiveConversation(id);
    return;
  }
  const button=event.target.closest('.task-item[data-task-id]');if(!button||!taskList.contains(button))return;
  finishRename();showTaskFeedback();
  if(button.dataset.taskId===store.activeId){closeMobileSidebar();return;}
  rememberView();composing=false;store.switchTask(button.dataset.taskId);
  announcement.textContent=`已切换到：${store.title(store.active)}`;
  closeMobileSidebar();
  if(!store.active.connected&&!store.active.waiting&&!store.active.openingError)void store.connect(store.activeId);
});
form.addEventListener('submit',event=>{
  event.preventDefault();if(voice.active||messageDeleteDialog.open)return;
  if(store.active?.requiresInteractionMode){openModeChoices();return;}
  showMessageFeedback();voiceNotice();
  if(!store.active&&!input.value.trim())return;
  if(!store.active){showArchived=false;showTaskFeedback();}
  const task=store.active;
  if(task?.waiting){store.stop(task.id);return;}
  const pending=!task?.stopped&&task?.pending&&task.error
    ?input.value.trim()&&input.value.trim()!==task.pending.content
      ?store.interruptAndSubmit(task.id,input.value):store.resume(task.id)
    :store.submit(store.activeId,input.value),id=store.activeId;
  void pending.then(()=>{
    if(store.activeId===id&&(document.activeElement===input||document.activeElement===send))input.focus({preventScroll:true});
  });
});
queueButton.addEventListener('click',()=>{if(voice.active)return;store.queueMessage(store.activeId,input.value);input.focus({preventScroll:true});});
cancelQueued.addEventListener('click',()=>store.cancelQueued(store.activeId));
sendQueued.addEventListener('click',()=>store.sendQueued(store.activeId));
input.addEventListener('input',()=>{store.setDraft(input.value);renderStorageNotice();resizeInput();updateSend();});
input.addEventListener('compositionstart',()=>{composing=true;});
input.addEventListener('compositionend',()=>{composing=false;store.setDraft(input.value);updateSend();});
input.addEventListener('keydown',event=>{
  if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&!composing&&event.keyCode!==229){
    event.preventDefault();if(store.active?.waiting){if(!voice.active)store.queueMessage(store.activeId,input.value);}else form.requestSubmit();
  }
});
scroller.addEventListener('scroll',()=>store.setScroll(scroller.scrollTop),{passive:true});
window.addEventListener('pagehide',()=>{finishRename();rememberView();store.stopAll();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){store.setDraft(input.value);store.save();if(voice.active){voice.cancel();updateNotice(voiceStatus,'语音输入已停止，已识别的文字保留在输入框。');}}});
window.addEventListener('resize',resizeInput);
setSidebar(!mobileLayout.matches,{focus:false,animate:false});
playIntro();
renderTaskList();renderStorageNotice();renderConversation(true);
if(upgradeNotice)showMessageFeedback(upgradeNotice);
if(store.active&&!store.active.connected&&!store.active.openingError)void store.connect(store.activeId);
