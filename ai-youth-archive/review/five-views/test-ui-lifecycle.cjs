/* Browser-free regression checks for five-entry navigation and auxiliary chat.
 * This runs the real application in an isolated VM with disposable DOM/API stubs.
 * It never starts a server, writes storage, or changes preview/production data.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'dist/app.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');

function fixture() {
  const nodes = new Map(), events = new Map(), timers = new Map(), storage = new Map();
  let timerId = 0;
  class Element {
    constructor(id='') { this.id=id; this.innerHTML=''; this.textContent=''; this.value=''; this.dataset={}; this.open=false; this.hidden=false; this.isConnected=true; this.disabled=false; this.scrollTop=0; this.scrollHeight=100; this.clientHeight=100; this.attributes={}; this.listeners=new Map(); this.classList={add(){},remove(){},toggle(){}}; }
    setAttribute(k,v){this.attributes[k]=String(v);}
    getAttribute(k){return this.attributes[k]??null;}
    removeAttribute(k){delete this.attributes[k];}
    addEventListener(k,fn){this.listeners.set(k,fn);}
    querySelector(){return null;}
    querySelectorAll(){return [];}
    insertAdjacentHTML(_where,s){this.innerHTML+=s;}
    showModal(){this.open=true;}
    close(){this.open=false;}
    focus(){}
    getBoundingClientRect(){return {top:0,left:0,right:100,bottom:100};}
    get innerHTML(){return this._html||'';}
    set innerHTML(v){this._html=String(v);this.childNodes=v?[{serialized:String(v)}]:[];}
    append(...children){this.childNodes.push(...children);this._html=(this._html||'')+children.map(c=>c.serialized||c.innerHTML||'').join('');}
    replaceChildren(...children){this.innerHTML=children.map(c=>c.serialized||c.innerHTML||'').join('');}
  }
  const known=['main','toast','modal','modal-title','modal-body','motion-button','global-search-form','message-panel','message-panel-body','message-title','message-panel-tabs','message-button','notice-link','account-link','connection-note'];
  for(const id of known)nodes.set('#'+id,new Element(id));
  const document={hidden:false,body:new Element('body'),title:'',querySelector:s=>nodes.get(s)||null,querySelectorAll:()=>[],addEventListener:(k,fn)=>{events.set('document:'+k,[...(events.get('document:'+k)||[]),fn]);},createElement:()=>new Element(),createDocumentFragment:()=>new Element()};
  const location={protocol:'http:',hostname:'127.0.0.1',host:'127.0.0.1:4174',pathname:'/ai-youth/',search:'',_hash:'#home',get hash(){return this._hash;},set hash(v){this._hash=v?String(v).startsWith('#')?String(v):'#'+v:'';}};
  const window={addEventListener:(k,fn)=>{events.set('window:'+k,[...(events.get('window:'+k)||[]),fn]);},scrollTo(){}};
  const history={state:null,replaceState(_state,_title,url){location.hash=url.split('#')[1]||'';}};
  const context=vm.createContext({document,location,history,window,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},URL,URLSearchParams,AbortController,console,Blob,setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),requestAnimationFrame:()=>{},ArchiveTools:{render:p=>'<section data-tool="'+p+'">'+p+'</section>',bind(){},exportPortfolio(){}},FormData:class {constructor(form){this.entries=Object.entries(form.data||{});}[Symbol.iterator](){return this.entries[Symbol.iterator]();}}});
  const boot=source.lastIndexOf('(async()=>{try{state.ready=');
  assert.ok(boot>=0,'Recognize and disable only the network startup');
  const functions=[...source.matchAll(/^(?:async )?function (\w+)\(/gm)].map(x=>x[1]);
  const instrumented=source.slice(0,boot)+'\nglobalThis.audit={state,chatState,legacy,messageState:typeof messageState!=="undefined"?messageState:null,notificationState:typeof notificationState!=="undefined"?notificationState:null,composeState:typeof composeState!=="undefined"?composeState:null,functions:{'+functions.join(',')+'},setAPI:fn=>api=fn};\n})();';
  vm.runInContext(instrumented,context,{filename:'app.js'});
  const api=context.audit;
  return {api,nodes,events,timers,storage,document,location,context,Element};
}

const user={id:'creator-a',username:'fixture',profile:{name:'回归测试者',bio:'只用于隔离测试',skills:'设计'}};
const project={id:'project-a',title:'隔离作品',summary:'回归测试，不公开',visibility:'private',review:'private',status:'进行中',event:'隔离比赛',notes:'私人笔记'};
function setData(f){Object.assign(f.api.state,{ready:true,user,projects:[project],files:[],posts:[],feed:{projects:[],posts:[]}});}
const chat={id:'chat-a',peer:{id:'creator-b',name:'伙伴'},preview:'邀请测试',state:'accepted',incoming:false,unread:2,blockedByMe:false,blockedByPeer:false};
function responseFor(p){if(p==='/feed')return {projects:[],posts:[]};if(p==='/me')return {user,usage:{used:0,limit:104857600}};if(p==='/projects')return {projects:[project]};if(p==='/files')return {files:[]};if(p==='/posts')return {posts:[]};if(p==='/notifications')return {notifications:[],unreadTotal:0};if(p==='/notifications/read')return {ok:true,unreadTotal:0};if(p==='/chats')return {chats:[{...chat}],unreadTotal:2};if(p==='/chats/chat-a')return {chat:{...chat},messages:[{seq:1,senderId:'creator-b',body:'隔离消息',createdAt:1}],olderCursor:null};if(p==='/chats/chat-a/read')return {};if(p==='/projects/project-a/history')return {versions:[{title:'旧版本',summary:'旧介绍',createdAt:1}]};throw Error('Unexpected stub request: '+p);}

async function checkRoutes(){
  const f=fixture();setData(f);f.api.setAPI(async p=>responseFor(p));
  const nav=[...index.matchAll(/data-nav="([^"]+)"/g)].map(x=>x[1]);
  assert.deepEqual(nav,['home','discover','creators','events','archive'],'Exactly five main entries; messages must be auxiliary');
  f.context.window.ArchiveLibrary={markup:()=>'<section id="archive-canvas-studio">内部私人整理画布</section>',destroy(){},mount(){},flush:async()=>{}};
  f.location.hash='#archive';await f.api.functions.render();
  assert.ok(f.nodes.get('#main').innerHTML.includes('data-action="open-library"'),'My contains an internal archive entry');
  assert.ok(!f.nodes.get('#main').innerHTML.includes('id="archive-canvas-studio"'),'The archive is not embedded in the scrolling My page');
  await f.api.functions.openArchiveLibrary();
  assert.equal(f.location.hash,'#archive','Opening the archive stays at the same URL');
  assert.ok(f.nodes.get('#main').innerHTML.includes('内部私人整理画布'),'The entry opens the archive inside My');
  assert.ok(!f.nodes.get('#main').innerHTML.includes('profile-overview'),'Archive content replaces the personal-page overview');
  assert.equal(f.document.body.dataset.archiveStudio,'true');assert.equal(f.document.body.dataset.uiVisual,'true','Archive retains the shared visual theme');
  await f.api.functions.closeArchiveLibrary();
  assert.equal(f.location.hash,'#archive','Returning to My does not open a different URL');
  assert.equal(f.document.body.dataset.archiveStudio,'false');assert.ok(f.nodes.get('#main').innerHTML.includes('profile-overview'),'Returning restores the My page');
  f.location.hash='#archive/library';await f.api.functions.render();
  assert.equal(f.location.hash,'#archive','Old archive links remain compatible and normalize to My');
  assert.ok(f.nodes.get('#main').innerHTML.includes('内部私人整理画布'));
  await f.api.functions.closeArchiveLibrary();
  const panelMarkup=index.slice(index.indexOf('<dialog id="message-panel"'),index.indexOf('</dialog>',index.indexOf('<dialog id="message-panel"')));
  assert.ok(panelMarkup.includes('一对一私人聊天')&&!panelMarkup.includes('href="#notifications"'),'The dialogue shell offers only private chats');
  const expected=[['#archive/works','隔离作品'],['#archive/files','资料文件'],['#archive/events','隔离作品'],['#my-posts','还没有'],['#discover/bookmarks','收藏'],['#profile','profile-form'],['#project/project-a','旧版本'],['#prepare','data-tool="prepare"'],['#credential','data-tool="credential"'],['#login','auth-form'],['#login/register','data-register="true"'],['#privacy','隐私'],['#notifications','notification-page'],['#notifications/likes','收到的赞'],['#notifications/replies','收到的回复'],['#notifications/reviews','审核状态']];
  for(const [hash,part] of expected){f.location.hash=hash;await f.api.functions.render();assert.ok(f.nodes.get('#main').innerHTML.includes(part),hash+' remains reachable after regrouping');}
  for(const [old,now] of [['#portfolio','archive/works'],['#archive/posts','my-posts'],['#archive/profile','profile'],['#archive/bookmarks','discover/bookmarks'],['#archive/notifications','notifications']]){f.location.hash=old;await f.api.functions.render();assert.equal(f.api.state.route,now,'Keep saved links compatible: '+old);}
  const html=f.nodes.get('#main').innerHTML;
  assert.ok(!html.includes('暂时没能打开'),'No route silently falls into the error state');
  return 'five main entries, original tools/data/account routes, saved aliases';
}

function checkHistoryAndDrafts(){
  const f=fixture();setData(f);const fn=f.api.functions;
  const range=(a,b)=>Array.from({length:b-a+1},(_,i)=>({seq:a+i,body:'message '+(a+i)}));
  const gap=fn.reconcileChatMessages(range(1,10),range(26,85),null,26);
  assert.equal(gap.olderCursor,26,'A missed API page must remain reachable');
  const overlap=fn.reconcileChatMessages(range(1,65),range(20,79),null,20);
  assert.deepEqual(Array.from(overlap.messages,m=>m.seq),range(1,79).map(m=>m.seq),'Polling cannot duplicate messages or discard loaded history');
  f.api.chatState.current={id:'chat-a',peer:{name:'伙伴'},state:'accepted'};
  f.api.chatState.messages=[{seq:1,senderId:'creator-a',body:'<script>alert(1)</script>',createdAt:1}];
  f.api.chatState.drafts.set('chat-a','尚未发送的草稿');
  const html=fn.chatPanelHTML();
  assert.ok(html.includes('尚未发送的草稿'),'An unsent chat draft survives panel re-render');
  assert.ok(html.includes('&lt;script&gt;')&&!html.includes('<script>'),'Message text is escaped');
  f.api.chatState.current.state='pending';assert.equal(fn.chatCanSend(),false,'An invitation cannot send another message before acceptance');
  f.api.chatState.current.state='accepted';f.api.chatState.current.blockedByPeer=true;assert.equal(fn.chatCanSend(),false,'A blocked conversation cannot send');
  f.api.chatState.unreadTotal=4;f.api.chatState.chats=[{id:'chat-a'}];f.api.chatState.sendingKeys.add('creator-a/chat-a');
  fn.resetChatSession();
  assert.equal(f.api.chatState.drafts.size,0,'Account reset clears unsent private content');
  assert.equal(f.api.chatState.chats.length,0);assert.equal(f.api.chatState.sendingKeys.size,0);assert.equal(f.api.chatState.unreadTotal,0);
  return 'history recovery, draft restoration, escaping, invitation/blocking, account isolation';
}

function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
async function checkAuxiliaryPanel(){
  const f=fixture();setData(f);f.api.setAPI(async p=>responseFor(p));
  f.location.hash='#creators';await f.api.functions.render();const background=f.nodes.get('#main').innerHTML;
  f.location.hash='#messages';await f.api.functions.render();
  assert.equal(f.nodes.get('#message-panel').open,true,'Messages open as an auxiliary dialog');
  assert.equal(f.nodes.get('#main').innerHTML,background,'Opening messages preserves the main page');
  assert.equal(f.api.messageState.baseRoute,'creators');
  f.location.hash='#messages/chat-a';await f.api.functions.render();
  assert.equal(f.nodes.get('#main').innerHTML,background,'Opening a thread also preserves the main page');
  assert.ok(f.nodes.get('#message-panel-body').innerHTML.includes('隔离消息'),'An old thread deep link opens the actual conversation');
  assert.equal(f.api.chatState.unreadTotal,0,'Reading a visible conversation updates unread');
  f.location.hash='#notifications';await f.api.functions.render();
  const notificationBackground=f.nodes.get('#main').innerHTML;
  assert.notEqual(notificationBackground,background,'Notifications replace the main page instead of opening inside private chat');
  assert.ok(notificationBackground.includes('notification-page'),'Notifications are a page within My');
  assert.equal(f.nodes.get('#message-panel').open,false,'Navigating to notifications closes private chat');
  assert.equal(f.api.messageState.baseRoute,'notifications','Notifications become the new background route');
  assert.equal([...f.timers.values()].filter(t=>t.ms===5000).length,0,'Notifications stop private-chat polling');
  f.location.hash='#messages/chat-a';await f.api.functions.render();
  assert.equal(f.nodes.get('#main').innerHTML,notificationBackground,'Opening private chat from My keeps the notification page underneath');
  assert.ok(!f.nodes.get('#message-panel-body').innerHTML.includes('notification-item'),'The private-chat panel has no activity or review notices');
  f.location.hash='#messages/chat-a?view=full';await f.api.functions.render();
  assert.equal(f.nodes.get('#message-panel').open,false,'Optional full view closes the auxiliary dialog');
  assert.ok(f.nodes.get('#main').innerHTML.includes('chat-layout'),'Full view retains the existing conversation and controls');
  f.location.hash='#messages/chat-a';await f.api.functions.render();
  assert.equal(f.nodes.get('#main').innerHTML,notificationBackground,'Returning from full chat restores the notification page');
  assert.ok(!f.nodes.get('#main').innerHTML.includes('id="chat-composer"'),'The background must not keep a duplicate chat composer');
  f.api.functions.closeMessages();assert.equal(f.nodes.get('#message-panel').open,false);assert.equal(f.location.hash,'#notifications','Closing restores the notification route');
  await f.api.functions.render();assert.equal(f.nodes.get('#main').innerHTML,notificationBackground,'Closing cannot return to an older creator-page background');
  const deep=fixture();setData(deep);deep.api.setAPI(async p=>responseFor(p));deep.location.hash='#messages/chat-a';await deep.api.functions.render();
  assert.equal(deep.nodes.get('#message-panel').open,true,'Reloading an old message URL still works');
  assert.ok(deep.nodes.get('#main').innerHTML.includes('community-feed'),'First-entry deep links have a real home background');
  return 'private-chat panel, independent My notifications, restored background, thread deep links and full view';
}

const activityFixtures=[
  {id:'1'.repeat(32),kind:'like',actor:{id:'liker',name:'点赞者专用名字'},targetKind:'post',targetId:'liked-post',title:'被点赞的独立帖子',createdAt:1,read:false},
  {id:'2'.repeat(32),kind:'reply',actor:{id:'replier',name:'回复者专用名字'},targetKind:'post',targetId:'replied-post',title:'被回复的独立帖子',body:'回复正文 <script>不可执行</script>',createdAt:2,read:false}
];
function notificationAPI(calls=[],items=activityFixtures.map(x=>({...x}))){return async(p,method='GET',data)=>{
  calls.push({p,method,data});
  if(p==='/notifications')return {notifications:items.map(x=>({...x})),unreadTotal:items.filter(x=>!x.read).length};
  if(p==='/notifications/read'){assert.equal(method,'POST');for(const item of items)if(data.all||data.ids?.includes(item.id))item.read=true;return {ok:true,unreadTotal:items.filter(x=>!x.read).length};}
  if(p==='/projects')return {projects:[{...project,title:'后台刚通过的作品',visibility:'public',review:'approved'}]};
  if(p==='/posts')return {posts:[{id:'pending-post',body:'待审核的个人帖子',review:'pending'},{id:'rejected-post',body:'未通过的个人帖子',review:'rejected'}]};
  return responseFor(p);
};}

async function checkNotifications(){
  const f=fixture();setData(f);const fn=f.api.functions,calls=[];f.api.setAPI(notificationAPI(calls));
  f.location.hash='#notifications';await fn.render();let html=f.nodes.get('#main').innerHTML;
  assert.ok(html.includes('点赞者专用名字')&&html.includes('回复者专用名字'),'All notifications show both actual interaction kinds');
  assert.ok(html.includes('后台刚通过的作品')&&html.includes('已公开'),'Review states are fetched again instead of using login-time cache');
  assert.ok(html.includes('&lt;script&gt;')&&!html.includes('<script>'),'Notification and reply content is escaped');
  assert.equal(f.api.notificationState.unreadTotal,2);
  assert.ok(!calls.some(c=>c.p==='/notifications/read'),'Merely opening My notifications does not clear unread activity');
  f.location.hash='#notifications/likes';await fn.render();html=f.nodes.get('#main').innerHTML;
  assert.ok(html.includes('点赞者专用名字')&&!html.includes('回复者专用名字'),'Likes filter excludes reply items');
  f.location.hash='#notifications/replies';await fn.render();html=f.nodes.get('#main').innerHTML;
  assert.ok(html.includes('回复者专用名字')&&!html.includes('点赞者专用名字'),'Replies filter excludes likes');
  f.location.hash='#notifications/reviews';await fn.render();html=f.nodes.get('#main').innerHTML;
  assert.ok(html.includes('后台刚通过的作品')&&html.includes('待审核的个人帖子')&&html.includes('未通过的个人帖子'),'Review view keeps approved, pending and rejected submissions');
  assert.ok(!html.includes('点赞者专用名字')&&!html.includes('回复者专用名字'),'Review states do not mix private chats or reaction rows');
  f.location.hash='#notifications';await fn.render();f.api.chatState.unreadTotal=7;
  assert.equal(await fn.markNotificationsRead([activityFixtures[0].id]),true);
  assert.equal(f.api.notificationState.items[0].read,true);assert.equal(f.api.notificationState.items[1].read,false);assert.equal(f.api.notificationState.unreadTotal,1);
  const single=calls.find(c=>c.p==='/notifications/read');assert.deepEqual(Array.from(single.data.ids),[activityFixtures[0].id],'Reading an item sends only that notification ID');
  const originalContent=new f.Element();originalContent.dataset={id:activityFixtures[0].id,route:'home?post=liked-post'};
  await fn.action('open-notification',originalContent);assert.equal(f.location.hash,'#home?post=liked-post','Clicking a notification marks it read and opens its original content');
  f.location.hash='#notifications';await fn.render();
  await fn.action('read-notifications',new f.Element('read-all'));
  assert.equal(f.api.notificationState.unreadTotal,0);assert.ok(f.api.notificationState.items.every(x=>x.read));
  assert.ok(calls.some(c=>c.p==='/notifications/read'&&c.method==='POST'&&c.data.all===true),'All-read calls the backend and refreshes the current notification view');
  assert.equal(f.api.chatState.unreadTotal,7,'Activity unread and private-chat unread stay independent');
  fn.resetChatSession();assert.equal(f.api.notificationState.owner,null);assert.equal(f.api.notificationState.items.length,0);assert.equal(f.api.notificationState.unreadTotal,0);
  f.api.state.user=null;f.api.state.projects=[];f.api.state.posts=[];calls.length=0;f.location.hash='#notifications';await fn.render();
  assert.ok(f.nodes.get('#main').innerHTML.includes('登录后查看消息通知'));assert.ok(!calls.some(c=>c.p==='/notifications'),'Guests never request a personal notification inbox');
  return 'likes/replies/review filters, fresh review data, escaping, individual/all read and separate chat unread';
}

async function checkNotificationRaces(){
  const page=fixture();setData(page);const pendingPage=deferred();
  page.api.setAPI(async p=>p==='/notifications'?pendingPage.promise:notificationAPI()(p));
  page.location.hash='#notifications';const loading=page.api.functions.render();
  page.location.hash='#creators';await page.api.functions.render();const currentPage=page.nodes.get('#main').innerHTML;
  pendingPage.resolve({notifications:activityFixtures,unreadTotal:2});await loading;
  assert.equal(page.nodes.get('#main').innerHTML,currentPage,'A late notification response cannot overwrite the newly selected page');
  assert.equal(page.api.notificationState.items.length,0,'A cancelled inbox response cannot overwrite notification state');
  assert.equal(page.api.state.projects[0].title,project.title,'Cancelled review fetches cannot replace personal data');

  const account=fixture();setData(account);const pendingAccount=deferred();
  account.api.setAPI(async p=>p==='/notifications'?pendingAccount.promise:notificationAPI()(p));
  const reading=account.api.functions.notifications('',account.api.state.seq);
  account.api.functions.resetChatSession();account.api.state.user={...user,id:'creator-other'};
  const otherItems=[{id:'other-item',kind:'reply',read:false}];Object.assign(account.api.notificationState,{owner:'creator-other',items:otherItems,unreadTotal:9});
  account.api.state.projects=[{...project,id:'other-project',title:'另一个账号的作品'}];account.api.state.posts=[{id:'other-post',body:'另一个账号的帖子'}];
  pendingAccount.resolve({notifications:activityFixtures,unreadTotal:2});assert.equal(await reading,'','An inbox response from the previous account is discarded');
  assert.equal(account.api.notificationState.items,otherItems);assert.equal(account.api.notificationState.unreadTotal,9);
  assert.equal(account.api.state.projects[0].id,'other-project');assert.equal(account.api.state.posts[0].id,'other-post');

  const mark=fixture();setData(mark);Object.assign(mark.api.notificationState,{owner:user.id,items:activityFixtures.map(x=>({...x})),unreadTotal:2});
  const pendingRead=deferred();mark.api.setAPI(async p=>p==='/notifications/read'?pendingRead.promise:responseFor(p));
  const marking=mark.api.functions.markNotificationsRead();++mark.api.state.seq;
  Object.assign(mark.api.notificationState,{items:[{id:'newer-item',read:false}],unreadTotal:8});
  pendingRead.resolve({ok:true,unreadTotal:0});assert.equal(await marking,false,'A delayed read response is invalid after changing pages');
  assert.equal(mark.api.notificationState.unreadTotal,8);assert.equal(mark.api.notificationState.items[0].read,false,'A stale read response cannot clear a newly loaded inbox');

  const opening=fixture();setData(opening);opening.api.state.route='notifications';opening.location.hash='#notifications';Object.assign(opening.api.notificationState,{owner:user.id,items:activityFixtures.map(x=>({...x})),unreadTotal:2});
  const pendingOpen=deferred();opening.api.setAPI(async p=>p==='/notifications/read'?pendingOpen.promise:responseFor(p));
  const target=new opening.Element();target.dataset={id:activityFixtures[0].id,route:'home?post=liked-post'};
  const clicking=opening.api.functions.action('open-notification',target);
  opening.api.state.route='creators';opening.location.hash='#creators';++opening.api.state.seq;
  pendingOpen.resolve({ok:true,unreadTotal:1});await clicking;
  assert.equal(opening.location.hash,'#creators','A delayed read callback cannot pull the user back to an old notification target');
  return 'notification load cancellation, account isolation, stale read protection and late-navigation cancellation';
}

async function checkCloseDuringLoad(){
  const f=fixture();setData(f);f.api.setAPI(async p=>responseFor(p));f.location.hash='#creators';await f.api.functions.render();
  const pending=deferred(),calls=[];
  f.api.setAPI(async p=>{calls.push(p);return p==='/chats'?pending.promise:responseFor(p);});
  f.location.hash='#messages/chat-a';const opening=f.api.functions.render();
  assert.equal(f.nodes.get('#message-panel').open,true,'Load begins in the visible panel');
  f.api.functions.closeMessages();pending.resolve(responseFor('/chats'));await opening;
  assert.equal(f.nodes.get('#message-panel').open,false);
  assert.ok(!calls.includes('/chats/chat-a')&&!calls.includes('/chats/chat-a/read'),'Closing immediately stops a delayed load before private history/read operations');
  assert.equal([...f.timers.values()].filter(t=>t.ms===5000).length,0,'A delayed load cannot restart polling after close');
  assert.equal(f.nodes.get('#main').getAttribute('aria-busy'),'false','Closing a loading panel releases the main loading state');
  return 'rapid-close race: delayed results cannot read messages or restart polling';
}

async function checkPollingRace(){
  const f=fixture();setData(f);f.api.state.route='messages/chat-a';f.api.messageState.open=true;f.nodes.get('#message-panel').showModal();
  f.api.chatState.current={...chat};f.api.chatState.unreadTotal=3;
  const pending=deferred(),calls=[];f.api.setAPI(async p=>{calls.push(p);return p==='/chats'?pending.promise:responseFor(p);});
  f.api.functions.startChatPolling();assert.equal([...f.timers.values()].filter(t=>t.ms===5000).length,1);
  const polling=f.api.functions.refreshChats();f.api.functions.closeMessages();pending.resolve({chats:[{...chat,unread:99}],unreadTotal:99});await polling;
  assert.equal(f.api.chatState.unreadTotal,3,'An old polling response cannot replace unread state after closing');
  assert.ok(!calls.includes('/chats/chat-a/read'),'Closing prevents a delayed poll from marking messages read');
  assert.equal([...f.timers.values()].filter(t=>t.ms===5000).length,0);
  f.api.state.route='messages/chat-a';f.document.hidden=true;await f.api.functions.markChatRead('chat-a');
  assert.ok(!calls.includes('/chats/chat-a/read'),'A hidden browser tab cannot mark private messages read');
  return 'poll cancellation, stale unread responses, hidden-tab read protection';
}

function checkComposeIsolation(){
  const f=fixture();setData(f);const fn=f.api.functions;
  fn.composePage();Object.assign(f.api.composeState,{kind:'question',projectId:project.id,body:'尚未提交的帖子草稿'});
  const html=fn.composePage();assert.ok(html.includes('尚未提交的帖子草稿'),'Reopening the composer retains the current account draft');assert.ok(html.includes('value="question" checked'));
  f.api.state.user={...user,id:'another-user'};const other=fn.composePage();assert.ok(!other.includes('尚未提交的帖子草稿'),'Changing account cannot display another creator draft');
  f.api.composeState.body='第二份未提交草稿';fn.resetChatSession();assert.equal(f.api.composeState.body,'','Logging out clears the composer too');
  return 'post draft restoration, category retention and account isolation';
}

module.exports = {fixture,setData,responseFor,index,user,project};

if (require.main === module) (async()=>{
  const results=[await checkRoutes(),checkHistoryAndDrafts(),await checkAuxiliaryPanel(),await checkNotifications(),await checkNotificationRaces(),await checkCloseDuringLoad(),await checkPollingRace(),checkComposeIsolation()];
  for(const result of results)console.log('PASS: '+result);
})().catch(e=>{console.error(e);process.exitCode=1;});
