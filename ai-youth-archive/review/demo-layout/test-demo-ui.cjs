/* Checks the shipped app and demo renderer in a disposable VM.
 * No server, browser, network, account storage or live data is changed.
 */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {fixture,setData,responseFor,index,project}=require('../five-views/test-ui-lifecycle.cjs');
const root=path.resolve(__dirname,'../..');
const privateProject={...project,title:'本人私密档案标记',summary:'绝不进入公开演示搜索',notes:'不该出现在社区的私人制作笔记'};
const realProject={id:'actual-public-project',title:'真实作品保留标记',summary:'真实服务器返回的公开作品',tech:'HTML',status:'进行中',author:{id:'actual-author',name:'真实作者'},visibility:'public',review:'approved'};
const realPost={id:'actual-public-post',body:'真实帖子保留标记\n这是真实公开内容的替身，用于验证演示不会覆盖它。',kind:'update',author:realProject.author,projectId:realProject.id,likes:3,comments:1,liked:false,bookmarked:true,createdAt:1};
const realFeed=()=>({projects:[{...realProject}],posts:[{...realPost}]});

function setup(){
 const f=fixture();setData(f);f.api.state.projects=[{...privateProject}];
 for(const name of ['demo-content.js','demo-ui.js'])vm.runInContext(fs.readFileSync(path.join(root,'dist',name),'utf8'),f.context,{filename:name});
 const nav=['home','discover','creators','events','archive'].map(name=>{const el=new f.Element();el.dataset.nav=name;el.querySelector=()=>({classList:{contains:()=>true}});return el;});
 f.document.querySelectorAll=selector=>selector==='[data-nav]'?nav:[];
 const calls=[];
 f.api.setAPI(async(p,method='GET',data)=>{calls.push({p,method,data});if(p==='/feed')return realFeed();return responseFor(p);});
 return {...f,nav,calls,data:f.context.window.DISCOVERY_DEMO,ui:f.context.window.DiscoveryDemos};
}
const main=f=>f.nodes.get('#main').innerHTML;
async function visit(f,hash){f.location.hash=hash;await f.api.functions.render();return main(f);}
const mutations=f=>f.calls.filter(x=>x.method!=='GET');
const ids=html=>[...html.matchAll(/data-demo-id="([^"]+)"/g)].map(x=>x[1]);
const forbidden=/data-action="(?:like|bookmark|post-comments|comment-retry|start-chat|new-work|edit-work|delete-work|delete-post|upload|import|export-html)"|<form\b/;

async function checkDetails(){
 const f=setup();
 const routes=[['projects','project','discover'],['creators','creator','creators'],['posts','post','home'],['events','event','events']];
 for(const [collection,kind,active] of routes){
  assert.ok(f.data[collection].length,'There are populated demo '+collection);
  for(const item of f.data[collection]){
   const html=await visit(f,'#demo/'+kind+'/'+encodeURIComponent(item.id));
   assert.ok(html.includes('演示')&&html.includes('虚构'),'A deep link clearly identifies the example as fiction');
   assert.ok(html.includes(item.name||item.summary||item.body.split('\n')[0]),'Deep links show the requested content');
   assert.ok(!html.includes('暂时没能打开')&&!html.includes('没有这条演示内容'),'Every shipped example can be read directly');
   assert.ok(!forbidden.test(html),'Examples cannot offer real account write, chat or certification actions');
   assert.equal(f.nav.find(el=>el.attributes['aria-current']==='page')?.dataset.nav,active,'Detail keeps its owning main entry selected');
   if(kind==='project')for(const log of item.changelog||[])assert.ok(html.includes(log.body||log.text||log.description),'The actual creation record is visible, not just the step heading');
   if(kind==='creator')for(const experience of Array.isArray(item.experience)?item.experience:[item.experience])assert.ok(html.includes(experience),'The creator can be understood from the complete experience');
  }
 }
 for(const kind of ['project','creator','post','event','unknown']){
  const html=await visit(f,'#demo/'+kind+'/missing-example');
  assert.ok(html.includes('没有这条演示内容')&&html.includes('href="#home"'),'Unknown IDs give a recoverable empty state');
 }
 assert.equal(f.calls.length,0,'Reading demo deep links does not make public or personal API requests');
 return 'all four demo detail types, missing IDs, full content, honest labels, correct navigation and read-only actions';
}

async function checkClassificationAndSearch(){
 const f=setup();
 for(const kind of ['','update','question','team']){
  const html=await visit(f,'#home'+(kind?'/'+kind:''));
  const visible=new Set(ids(html)),expected=f.data.posts.filter(p=>!kind||p.kind===kind);
  for(const p of f.data.posts)assert.equal(visible.has(p.id),expected.some(x=>x.id===p.id),'Home categories contain only matching example posts');
  assert.ok(!html.includes('本人私密档案标记'),'Personal project remains private on home');
 }
 const discovery=await visit(f,'#discover');
 assert.ok(discovery.includes('真实作品保留标记'),'Demo works do not replace actual public results');
 for(const p of f.data.projects)assert.ok(ids(discovery).includes(p.id),'Work list includes its browseable examples');
 const creatorHTML=await visit(f,'#creators');
 assert.ok(creatorHTML.includes('真实作者'),'Demo creators do not replace actual authors');
 for(const a of f.data.creators)assert.ok(ids(creatorHTML).includes(a.id),'Creator list includes examples');
 const p=f.data.projects[0],a=f.data.creators[0],e=f.data.events[0];
 for(const [query,expected] of [[p.title,p.title],[a.name,a.name],[e.title,e.title]]){
  const html=await visit(f,'#search?q='+encodeURIComponent(query));
  assert.ok(html.includes(expected)&&html.includes('演示'),'Global search finds matching demo content');
  assert.ok(!html.includes('本人私密档案标记'),'Search never exposes private account projects');
 }
 const none=await visit(f,'#search?q=never-match-7c2474');
 assert.ok(none.includes('没有找到相关内容')&&!none.includes('data-demo-id='),'Unmatched search remains genuinely empty');
 const focused=await visit(f,'#home?post=actual-public-post');
 assert.ok(focused.includes('真实帖子保留标记')&&!focused.includes('data-demo-id='),'A notification focused on a real post does not append unrelated examples');
 assert.equal(mutations(f).length,0,'Public browsing and search perform no writes');
 return 'home category filtering, real content coexistence, global search, honest empty results and focused-post isolation';
}

async function checkInlineFilters(){
 const f=setup();
 const addNode=id=>{const el=new f.Element(id);f.nodes.set('#'+id,el);return el;};
 const ds=addNode('discover-search'),dr=addNode('discover-results');
 await visit(f,'#discover');
 ds.value=f.data.projects[0].title;ds.oninput();
 assert.ok(ids(dr.innerHTML).includes(f.data.projects[0].id),'Work input can find the requested demo work');
 assert.equal(ids(dr.innerHTML).length,1,'Work input does not leave unrelated examples visible');
 ds.value='真实作品保留标记';ds.oninput();
 assert.ok(dr.innerHTML.includes(realProject.title)&&!dr.innerHTML.includes('data-demo-id='),'Real work search remains separate from matching examples');
 ds.value='never-match-7c2474';ds.oninput();assert.ok(dr.innerHTML.includes('没有找到匹配的作品'));
 f.nodes.delete('#discover-search');f.nodes.delete('#discover-results');
 const cs=addNode('creator-search'),cr=addNode('creator-results');
 await visit(f,'#creators');
 cs.value=f.data.creators[0].name;cs.oninput();
 assert.deepEqual(ids(cr.innerHTML),[f.data.creators[0].id],'Creator input finds one demo creator');
 cs.value='真实作者';cs.oninput();assert.ok(cr.innerHTML.includes('真实作者')&&!cr.innerHTML.includes('data-demo-id='));
 cs.value='never-match-7c2474';cs.oninput();assert.ok(cr.innerHTML.includes('没有找到匹配的创作者'));
 assert.equal(mutations(f).length,0);
 return 'work and creator inline search include demos without losing real results or empty states';
}

async function checkAccountIsolation(){
 const f=setup();
 for(const route of ['#home','#discover','#creators','#events'])await visit(f,route);
 assert.deepEqual(Array.from(f.api.state.projects,p=>p.id),[privateProject.id],'Demo browsing does not alter personal works');
 assert.deepEqual(Array.from(f.api.state.feed.projects,p=>p.id),[realProject.id],'Public API work state holds real records only');
 assert.deepEqual(Array.from(f.api.state.feed.posts,p=>p.id),[realPost.id],'Public API post state holds real records only');
 assert.deepEqual(Array.from(f.api.functions.publicAuthors(),a=>a.id),[realProject.author.id],'Private chat discovery sees only real authors');
 const archiveHTML=await visit(f,'#archive/works');
 assert.ok(archiveHTML.includes(privateProject.title)&&!archiveHTML.includes('data-demo-id='),'My archive remains owned content, not a seeded portfolio');
 const bookmarks=await visit(f,'#discover/bookmarks');
 assert.ok(bookmarks.includes(realPost.body.split('\n')[0])&&!bookmarks.includes('data-demo-id='),'Bookmarks cannot pretend the fictional posts were saved');
 let exported;
 f.context.ArchiveTools.exportPortfolio=(_profile,works)=>{exported=Array.from(works,p=>p.id);};
 await f.api.functions.action('export-html',new f.Element());
 assert.deepEqual(exported,[privateProject.id],'Exported portfolio contains only personal works');
 let toolWorks;
 f.context.ArchiveTools.render=(page,context)=>{toolWorks=Array.from(context.projects,p=>p.id);return '<section data-tool="'+page+'"></section>';};
 await visit(f,'#credential');assert.deepEqual(toolWorks,[privateProject.id],'Credential drafts cannot claim demo projects');
 await visit(f,'#prepare');assert.deepEqual(toolWorks,[privateProject.id],'Preparation tools retain actual owned inputs');
 for(const name of ['like','bookmark']){const button=new f.Element();button.dataset.id=f.data.posts[0].id;await f.api.functions.action(name,button);}
 assert.equal(mutations(f).length,0,'Demo IDs never trigger actual reaction writes');
 return 'demo separation from real feed, authors, personal works, bookmarks, exported portfolio and credential/preparation inputs';
}

async function checkDialogueRestore(){
 const f=setup();
 for(const [kind,item] of [['project',f.data.projects[0]],['creator',f.data.creators[0]],['post',f.data.posts[0]],['event',f.data.events[0]]]){
  const original='#demo/'+kind+'/'+item.id,html=await visit(f,original);
  await visit(f,'#messages');
  assert.equal(f.nodes.get('#message-panel').open,true,'Private dialogue opens above the demo detail');
  assert.equal(main(f),html,'Opening private dialogue preserves the demo detail');
  f.api.functions.closeMessages();
  assert.equal(f.nodes.get('#message-panel').open,false);
  assert.equal(f.location.hash,original,'Closing dialogue returns to the exact demo deep link');
  await f.api.functions.render();assert.equal(main(f),html,'Returned demo is still browseable');
 }
 assert.ok(!f.calls.some(x=>x.method!=='GET'),'Opening a chat list does not write messages for a fictional creator');
 return 'all four detail pages survive opening and closing real private dialogue';
}

function checkNavigationAndAssets(){
 const f=setup(),nav=index.match(/<nav class="primary-nav"[\s\S]*?<\/nav>/)?.[0]||'';
 const entries=[...nav.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)];
 assert.equal(entries.length,5,'Five main entries remain');
 for(const entry of entries){assert.ok(/title="[^"]+"/.test(entry[1])&&/aria-label="[^"]+"/.test(entry[1]),'Icon-only navigation is named for hover and accessibility');assert.ok(!entry[2].trim(),'Visible captions have been removed');}
 assert.ok(index.indexOf('src="demo-content.js')<index.indexOf('src="demo-ui.js')&&index.indexOf('src="demo-ui.js')<index.indexOf('src="app.js'),'Data, renderer and app load in dependency order');
 for(const p of [...f.data.projects,...f.data.events]){const file=path.resolve(root,'dist',p.cover);assert.ok(file.startsWith(path.resolve(root,'dist')+path.sep)&&fs.existsSync(file),'Every shipped demo cover resolves inside public dist');}
 for(const html of [f.ui.projectCards(),f.ui.creatorCards(),f.ui.postCards(),f.ui.eventCards(),f.ui.search('')])assert.ok(!forbidden.test(html),'Demo cards have no account interaction or certification controls');
 return 'five named icon-only entries, dependency order, available original covers and no fake interaction buttons';
}

(async()=>{
 const results=[await checkDetails(),await checkClassificationAndSearch(),await checkInlineFilters(),await checkAccountIsolation(),await checkDialogueRestore(),checkNavigationAndAssets()];
 for(const result of results)console.log('PASS: '+result);
})().catch(error=>{console.error(error);process.exitCode=1;});
