import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TaskStore,STORAGE_KEY,createId} from '../dist/task-store.js';

test('HTTP browsers without randomUUID can create independent tasks and message IDs',async()=>{
  const httpCrypto={getRandomValues:bytes=>globalThis.crypto.getRandomValues(bytes)};
  const store=new TaskStore({reply:async()=>answer('你好'),id:()=>createId(httpCrypto),messageId:()=>createId(httpCrypto)});
  const first=store.createTask();await store.connect(first);
  const second=store.createTask();await store.connect(second);
  await store.submit(second,'测试新消息');
  const ids=store.tasks.flatMap(task=>[task.id,...task.messages.map(message=>message.id)]);
  assert.equal(new Set(ids).size,ids.length);
  assert.ok(ids.every(id=>/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)));
  assert.equal(store.getTask(first).messages.length,1);
  assert.equal(store.getTask(second).messages.length,3);
});

const answer=content=>({message:{role:'assistant',content},mode:'mock'});
function memory(){const map=new Map();return {getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value)};}

test('changing mode immediately requests a new question in both directions while preserving the draft',async()=>{
  const requests=[];const store=new TaskStore({storage:memory(),reply:async(messages,options)=>{requests.push({messages,options});return {...answer('新的问题？'),mode:'live'};}});
  await store.submit(null,'我想理解读书这件事');const id=store.activeId;
  store.setDraft('还没有发送的感受');
  await store.changeInteractionMode(id,'choice');
  assert.equal(requests.length,2);assert.equal(requests.at(-1).options.interactionMode,'choice');assert.match(requests.at(-1).messages[0].content,/读书/);
  assert.equal(store.active.draft,'还没有发送的感受');assert.equal(store.active.messages.at(-1).interactionMode,'choice');
  await store.changeInteractionMode(id,'open');assert.equal(requests.length,3);assert.equal(requests.at(-1).options.interactionMode,'open');
  assert.match(requests.at(-1).messages.at(-1).content,/保留我们已经聊过的内容/);assert.equal(store.active.draft,'还没有发送的感受');
  await store.changeInteractionMode(id,'choice');assert.equal(requests.length,4);assert.equal(requests.at(-1).options.interactionMode,'choice');
  await store.changeInteractionMode(id,'choice');assert.equal(requests.length,4);
});

test('one-click choice failure and reload preserve unrelated draft; retry sends the choice once',async()=>{
  const storage=memory();let fail=true;const requests=[];
  const reply=async(messages,options)=>{requests.push({messages,options});if(fail)throw new Error('network');return answer('接着慢慢聊？');};
  const store=new TaskStore({storage,reply});const id=store.createTask({connected:true});store.selectInteractionMode(id,'choice');store.setDraft('这是未发送的草稿');
  await store.submit(id,'B. 我想慢慢说',{preserveDraft:true,action:'choice'});
  assert.equal(store.active.draft,'这是未发送的草稿');assert.equal(store.active.messages.length,0);assert.equal(store.active.pending.action,'choice');
  const restored=new TaskStore({storage,reply});assert.equal(restored.active.draft,'这是未发送的草稿');assert.equal(restored.active.pending.preserveDraft,true);
  fail=false;await restored.retryAction(id);
  assert.equal(requests.length,2);assert.equal(requests[1].messages.at(-1).content,'B. 我想慢慢说');
  assert.equal(restored.active.messages.filter(message=>message.role==='user').length,1);assert.equal(restored.active.draft,'这是未发送的草稿');
});

test('legacy question selection is discarded without losing drafts, history or multi-question answers',async()=>{
  const storage=memory();let fail=false;const requests=[];
  const reply=async messages=>{requests.push(messages);if(fail)throw new Error('network');return answer('1. 你期待什么？\n2. 你在意什么？');};
  const store=new TaskStore({storage,reply});const id=store.createTask({connected:true});store.selectInteractionMode(id,'open');await store.submit(id,'开始');
  const content='1. 我想学会画画\n2. 我在意自己的时间';store.setDraft(content);
  const legacy=JSON.parse(storage.getItem(STORAGE_KEY));
  legacy.tasks[0].answerTarget={messageId:store.active.messages.at(-1).id,text:'你在意什么？'};storage.setItem(STORAGE_KEY,JSON.stringify(legacy));
  const restored=new TaskStore({storage,reply});assert.equal(Object.hasOwn(restored.active,'answerTarget'),false);assert.equal(restored.active.draft,content);assert.deepEqual(restored.active.messages,store.active.messages);
  fail=true;await restored.submit(id,restored.active.draft);assert.equal(restored.active.draft,content);assert.equal(requests.at(-1).at(-1).content,content);
  fail=false;await restored.submit(id,restored.active.draft);assert.equal(restored.active.draft,'');assert.equal(restored.active.messages.at(-2).content,content);
});

test('interrupted legacy selected answer restores raw text and retries without the retired question prefix',async()=>{
  const storage=memory();const requests=[];const reply=async messages=>{requests.push(messages);return answer('1. 想画什么？\n2. 什么时候开始画的？');};
  const store=new TaskStore({storage,reply});const id=store.createTask({connected:true});store.selectInteractionMode(id,'open');await store.submit(id,'画画');
  const data=JSON.parse(storage.getItem(STORAGE_KEY)),task=data.tasks[0];
  task.waiting=true;task.draft='';task.pending={id:'old-pending',role:'user',content:'关于“你在意什么？”：\n自己的时间',draftContent:'自己的时间'};
  task.answerTarget={messageId:task.messages.at(-1).id,text:'你在意什么？'};storage.setItem(STORAGE_KEY,JSON.stringify(data));
  const restored=new TaskStore({storage,reply});assert.equal(restored.active.draft,'自己的时间');assert.equal(Object.hasOwn(restored.active,'answerTarget'),false);
  await restored.submit(id,restored.active.draft);assert.equal(requests.at(-1).at(-1).content,'自己的时间');assert.equal(restored.active.pending,null);
});

test('failed mode switch is retryable without sending the draft and late replies stay with their task',async()=>{
  const requests=[];const storage=memory();const reply=(messages,options)=>new Promise((resolve,reject)=>requests.push({messages,options,resolve,reject}));
  const store=new TaskStore({reply,storage});const id=store.createTask({connected:true});store.selectInteractionMode(id,'choice');store.setDraft('独立草稿');
  const change=store.changeInteractionMode(id,'open');assert.equal(store.active.waiting,true);assert.equal(store.active.pending.action,'mode');
  assert.equal(await store.changeInteractionMode(id,'choice'),false);requests[0].reject(new Error('network'));await change;
  assert.match(store.active.error,/切换尚未完成/);assert.equal(store.active.draft,'独立草稿');
  const retry=store.retryAction(id);const second=store.createTask({connected:true});store.setDraft('第二段');
  requests[1].resolve(answer('开放问题？'));await retry;
  assert.equal(store.activeId,second);assert.equal(store.active.draft,'第二段');assert.equal(store.getTask(id).messages.at(-1).interactionMode,'open');
  assert.equal(store.getTask(id).draft,'独立草稿');assert.equal(store.getTask(id).unread,true);
});

test('mode selection gates replies, belongs to its task and survives reload, deletion and branching',async()=>{
  const requests=[],storage=memory();
  const reply=async(messages,options)=>{requests.push({messages,options});return {...answer(options.interactionMode?'继续思考？':'请先选择模式'),mode:'live',requiresInteractionMode:!options.interactionMode};};
  const store=new TaskStore({reply,storage});
  await store.submit(null,'读书的问题');const first=store.activeId;
  assert.equal(store.active.requiresInteractionMode,true);assert.equal(store.active.interactionMode,null);
  await store.submit(first,'直接跳过');assert.equal(requests.length,1);
  assert.equal(store.selectInteractionMode(first,'both'),false);
  assert.equal(store.selectInteractionMode(first,'choice'),true);
  await store.submit(first,'我选择选项辅助。');assert.equal(requests.at(-1).options.interactionMode,'choice');
  store.setDraft('未发送的草稿');assert.equal(store.selectInteractionMode(first,'open'),true);assert.equal(store.active.draft,'未发送的草稿');
  store.startNew();await store.submit(null,'画画的问题');const second=store.activeId;
  assert.equal(store.active.interactionMode,null);assert.equal(store.active.requiresInteractionMode,true);
  assert.equal(store.getTask(first).interactionMode,'open');
  const restored=new TaskStore({reply,storage});
  assert.equal(restored.activeId,second);assert.equal(restored.active.requiresInteractionMode,false); // The final design removes the legacy mode gate on reload.
  restored.switchTask(first);assert.equal(restored.active.interactionMode,'open');assert.equal(restored.active.draft,'未发送的草稿');
  restored.deleteMessage(first,restored.active.messages[0].id);assert.equal(restored.active.interactionMode,'open');
  restored.branchTask(first,restored.active.messages.at(-1).id);assert.equal(restored.active.interactionMode,'open');
  await restored.submit(restored.activeId,'继续');assert.equal(requests.at(-1).options.interactionMode,'open');
});

test('mode selection cannot change an in-flight or archived task and rolls back when saving fails',async()=>{
  const storage=memory();let resolve;
  const store=new TaskStore({storage,reply:()=>new Promise(done=>{resolve=done;})});
  const first=store.createTask({connected:true});store.selectInteractionMode(first,'choice');
  const pending=store.submit(first,'问题');assert.equal(store.selectInteractionMode(first,'open'),false);
  resolve({...answer('回答'),requiresInteractionMode:false});await pending;
  const second=store.createTask({connected:true});store.archiveTask(first);assert.equal(store.selectInteractionMode(first,'open'),false);
  store.active.requiresInteractionMode=true;store.setDraft('草稿保留');
  storage.setItem=()=>{throw new Error('quota');};
  assert.equal(store.selectInteractionMode(second,'open'),false);
  assert.equal(store.active.interactionMode,null);assert.equal(store.active.requiresInteractionMode,true);assert.equal(store.active.draft,'草稿保留');
});

test('legacy histories without a mode field restore their messages unchanged and invalid modes are not adopted',()=>{
  const storage=memory();const messages=[{id:'u',role:'user',content:'旧问题'},{id:'a',role:'assistant',content:'旧回答',replyToId:'u'}];
  storage.setItem(STORAGE_KEY,JSON.stringify({version:2,activeId:'old',tasks:[{id:'old',messages,interactionMode:'untrusted'}]}));
  const store=new TaskStore({storage,reply:async()=>answer('回答')});
  assert.equal(store.active.interactionMode,null);assert.deepEqual(store.active.messages.map(m=>m.content),['旧问题','旧回答']);
});
function setup(){
  const requests=[];let nextId=0;const storage=memory();
  const reply=messages=>new Promise((resolve,reject)=>requests.push({messages,resolve,reject}));
  const store=new TaskStore({reply,storage,id:()=>`task-${++nextId}`});
  async function open(){const id=store.createTask();const ready=store.connect(id);requests.at(-1).resolve(answer('你好，想聊什么？'));await ready;return id;}
  return {store,requests,storage,open};
}

test('new conversation landing creates no history or requests and preserves independent drafts across reload',async()=>{
  const {store,requests,storage,open}=setup();
  store.startNew();store.startNew();await store.submit(null,'   ');
  assert.equal(store.tasks.length,0);assert.equal(requests.length,0);assert.equal(store.nextNumber,1);
  const original=await open();store.setDraft('旧对话草稿');const before=JSON.stringify(store.getTask(original));
  store.startNew();store.setDraft('还没发送的问题');store.startNew();
  assert.equal(store.active,undefined);assert.equal(store.tasks.length,1);assert.equal(requests.length,1);
  assert.equal(JSON.stringify(store.getTask(original)),before);assert.equal(store.nextNumber,2);
  const restored=new TaskStore({storage,reply:async()=>{throw new Error('must not request on landing');}});
  assert.equal(restored.activeId,null);assert.equal(restored.newDraft,'还没发送的问题');
  restored.switchTask(original);assert.equal(restored.active.draft,'旧对话草稿');
  restored.startNew();assert.equal(restored.newDraft,'还没发送的问题');assert.equal(restored.tasks.length,1);
});

test('first send creates exactly one task without a synthetic greeting and late replies leave the landing untouched',async()=>{
  const {store,requests}=setup();store.setDraft('我喜欢画画');
  const pending=store.submit(null,' 我喜欢画画 '),id=store.activeId;
  assert.equal(store.tasks.length,1);assert.equal(store.newDraft,'');assert.equal(store.active.waiting,true);
  assert.deepEqual(requests[0].messages,[{role:'user',content:'我喜欢画画'}]);
  await store.submit(null,'重复发送');assert.equal(store.tasks.length,1);assert.equal(requests.length,1);
  store.startNew();store.setDraft('新的未发送问题');requests[0].resolve(answer('画画时最享受什么？'));await pending;
  assert.equal(store.activeId,null);assert.equal(store.newDraft,'新的未发送问题');assert.equal(store.getTask(id).unread,true);
  assert.deepEqual(store.getTask(id).messages.map(message=>message.role),['user','assistant']);
  const next=store.submit(null,'我想练习篮球');assert.equal(store.tasks.length,2);
  assert.deepEqual(requests[1].messages,[{role:'user',content:'我想练习篮球'}]);requests[1].resolve(answer('想提高什么？'));await next;
  assert.equal(store.getTask(id).messages.length,2);
});

test('failed first send survives reload and retries the same task without duplicating the first message',async()=>{
  const {store,requests,storage}=setup();
  const pending=store.submit(null,'第一次提问'),id=store.activeId;
  requests[0].reject(new Error('断线'));await pending;
  assert.equal(store.active.draft,'第一次提问');assert.equal(store.active.pending.content,'第一次提问');
  const sent=[];const restored=new TaskStore({storage,reply:async messages=>{sent.push(messages);return answer('收到你的问题');}});
  assert.equal(restored.activeId,id);await restored.submit(id,'修改后的问题');
  assert.equal(restored.tasks.length,1);assert.equal(restored.active.messages.length,2);assert.equal(restored.active.pending,null);
  assert.deepEqual(sent,[[{role:'user',content:'修改后的问题'}]]);
});

test('concurrent task replies, drafts and context remain isolated when replies arrive out of order',async()=>{
  const {store,requests,open}=setup();const a=await open();
  const aReply=store.submit(a,'我想整理画纸');const aRequest=requests.at(-1);
  const b=await open();const bReply=store.submit(b,'我想练习篮球');const bRequest=requests.at(-1);
  assert.deepEqual(aRequest.messages.map(message=>message.content),['你好，想聊什么？','我想整理画纸']);
  assert.deepEqual(bRequest.messages.map(message=>message.content),['你好，想聊什么？','我想练习篮球']);
  bRequest.resolve(answer('篮球方面想提高什么？'));await bReply;
  store.setDraft('篮球草稿');store.setScroll(140);
  aRequest.resolve(answer('画纸通常放在哪里？'));await aReply;
  assert.equal(store.activeId,b);assert.equal(store.active.draft,'篮球草稿');assert.equal(store.active.scrollTop,140);
  assert.equal(store.active.messages.at(-1).content,'篮球方面想提高什么？');
  assert.equal(store.getTask(a).messages.at(-1).content,'画纸通常放在哪里？');assert.equal(store.getTask(a).unread,true);
  store.switchTask(a);assert.equal(store.active.unread,false);assert.equal(store.active.draft,'');
  const followup=store.submit(a,'放在抽屉里');assert.equal(requests.at(-1).messages.length,4);
  assert.ok(requests.at(-1).messages.every(message=>!message.content.includes('篮球')));
  requests.at(-1).resolve(answer('怎么整理会更好找？'));await followup;
  store.switchTask(b);assert.equal(store.active.draft,'篮球草稿');assert.equal(store.active.scrollTop,140);
});

test('a background failure and edited retry never duplicate the user turn or overwrite another task',async()=>{
  const {store,requests,open}=setup();const a=await open();const pending=store.submit(a,'原问题');const aRequest=requests.at(-1);
  const b=await open();store.setDraft('不要覆盖这份草稿');aRequest.reject(new Error('暂时断网'));await pending;
  assert.equal(store.activeId,b);assert.equal(store.active.error,'');assert.equal(store.active.draft,'不要覆盖这份草稿');
  store.switchTask(a);assert.equal(store.active.draft,'原问题');assert.equal(store.active.messages.length,1);
  const retry=store.submit(a,'修改后的问题');assert.equal(requests.at(-1).messages.length,2);
  assert.equal(requests.at(-1).messages[1].content,'修改后的问题');requests.at(-1).resolve(answer('收到'));await retry;
  assert.equal(store.active.messages.filter(message=>message.role==='user').length,1);assert.equal(store.active.pending,null);
});

test('reload restores independent tasks and drafts; interrupted requests become retryable, not stuck',async()=>{
  const {store,requests,storage,open}=setup();const a=await open();void store.submit(a,'等待中的问题');
  const b=await open();store.setDraft('还没发送的想法');store.setScroll(90);store.save();
  const restored=new TaskStore({reply:async()=>answer('恢复后的回答'),storage});
  assert.equal(restored.tasks.length,2);assert.equal(restored.activeId,b);assert.equal(restored.active.draft,'还没发送的想法');
  restored.switchTask(a);assert.equal(restored.active.waiting,false);assert.equal(restored.active.draft,'');
  assert.equal(restored.active.pending.content,'等待中的问题');assert.equal(restored.active.stopped,true);const branch=restored.branchTask(a,restored.active.pending.id);await restored.submit(branch,restored.active.draft);
  assert.equal(restored.active.messages.length,3);assert.equal(restored.active.pending,null);
  const c=store.createTask();void store.connect(c);
  const openingRestore=new TaskStore({reply:async()=>answer('新开场'),storage});
  assert.equal(openingRestore.active.openingError,true);await openingRestore.connect(c);
  assert.equal(openingRestore.active.connected,true);assert.equal(openingRestore.active.error,'');
});

test('task creation does not reuse or erase previous histories and opens independently',async()=>{
  const {store,requests,open}=setup();const a=await open();store.setDraft('第一份草稿');
  const b=store.createTask();assert.notEqual(a,b);assert.equal(store.active.messages.length,0);
  const opening=store.connect(b);requests.at(-1).reject(new Error('连接失败'));await opening;
  assert.equal(store.active.openingError,true);store.switchTask(a);assert.equal(store.active.draft,'第一份草稿');
  assert.equal(store.active.openingError,false);assert.equal(store.active.connected,true);
});

test('unavailable or malformed local storage does not prevent chatting',async()=>{
  const storage={getItem:()=>'{bad json',setItem:()=>{throw new Error('quota');}};
  const store=new TaskStore({reply:async()=>answer('开场'),storage,id:()=> 'offline-store'});
  const id=store.createTask();await store.connect(id);await store.submit(id,'你好');
  assert.equal(store.active.messages.length,3);assert.match(store.storageWarning,/保存暂不可用/);
  const invalid=memory();invalid.setItem(STORAGE_KEY,JSON.stringify({version:1,tasks:[{id:'broken',messages:[{role:'user',content:'bad'}]}]}));
  assert.equal(new TaskStore({reply:async()=>answer('开场'),storage:invalid}).tasks.length,0);
});

test('renaming a background task preserves selection and context, and survives new replies and reload',async()=>{
  const {store,requests,storage,open}=setup();const a=await open();const b=await open();
  store.setDraft('保留当前草稿');
  assert.equal(store.renameTask(a,'  我的   画画计划  '),true);
  assert.equal(store.title(store.getTask(a)),'我的 画画计划');
  assert.equal(store.activeId,b);assert.equal(store.active.draft,'保留当前草稿');
  assert.equal(store.renameTask(a,'   '),false);assert.equal(store.renameTask(a,'字'.repeat(61)),false);
  const pending=store.submit(a,'我喜欢画画');requests.at(-1).resolve(answer('你喜欢画什么？'));await pending;
  const restored=new TaskStore({reply:async()=>answer('继续'),storage});
  assert.equal(restored.title(restored.getTask(a)),'我的 画画计划');
  assert.equal(restored.getTask(a).messages.length,3);assert.equal(restored.activeId,b);
});

test('archived tasks retain drafts and histories across reload and can be restored without changing context',async()=>{
  const {store,storage,open}=setup();const a=await open();store.setDraft('画纸草稿');store.setScroll(72);
  store.renameTask(a,'画纸整理');const b=await open();store.setDraft('篮球草稿');
  assert.equal(store.archiveTask(a),true);assert.equal(store.activeId,b);assert.equal(store.archiveTask(a),false);
  const restored=new TaskStore({reply:async()=>answer('继续'),storage});
  assert.equal(restored.getTask(a).archived,true);assert.equal(restored.getTask(a).draft,'画纸草稿');
  assert.equal(restored.title(restored.getTask(a)),'画纸整理');assert.equal(restored.getTask(a).scrollTop,72);
  assert.equal(restored.restoreTask(a),true);assert.equal(restored.activeId,b);
  restored.switchTask(a);assert.equal(restored.active.draft,'画纸草稿');assert.equal(restored.active.messages.length,1);
  assert.equal(restored.getTask(b).draft,'篮球草稿');assert.equal(restored.restoreTask(a),false);
});

test('archiving keeps the last live task even when archived tasks still exist',async()=>{
  const {store,open}=setup();const a=await open();const b=await open();
  assert.equal(store.archiveTask(b),true);assert.equal(store.activeId,a);
  const before=JSON.stringify(store.tasks),nextNumber=store.nextNumber;
  assert.equal(store.archiveTask(a),false);assert.equal(store.archiveTask(a),false);
  assert.equal(store.activeId,a);assert.equal(JSON.stringify(store.tasks),before);
  assert.equal(store.nextNumber,nextNumber);assert.equal(store.tasks.filter(task=>!task.archived).length,1);
  assert.equal(store.deleteTask(a),false);
});

test('archiving an in-flight task keeps its reply while blocking new requests until restoration',async()=>{
  const {store,requests,open}=setup();const a=await open();
  const pending=store.submit(a,'想练习篮球');const request=requests.at(-1);
  const b=await open();store.archiveTask(a);store.setDraft('另一段对话的草稿');
  const count=requests.length;await store.submit(a,'不能发送');await store.connect(a);
  assert.equal(requests.length,count);
  request.resolve(answer('先从哪项练习开始？'));await pending;
  assert.equal(store.getTask(a).archived,true);assert.equal(store.getTask(a).messages.length,3);
  assert.equal(store.activeId,b);assert.equal(store.active.draft,'另一段对话的草稿');
  store.restoreTask(a);const next=store.submit(a,'投篮');
  assert.deepEqual(requests.at(-1).messages.map(message=>message.content),['你好，想聊什么？','想练习篮球','先从哪项练习开始？','投篮']);
  requests.at(-1).resolve(answer('好的'));await next;
});

test('older saved tasks load without requiring name or archive fields',()=>{
  const storage=memory();
  storage.setItem(STORAGE_KEY,JSON.stringify({version:1,activeId:'old',tasks:[{id:'old',number:1,messages:[answer('开场').message],draft:'旧草稿'}]}));
  const store=new TaskStore({reply:async()=>answer('继续'),storage});
  assert.equal(store.active.archived,false);assert.equal(store.active.customTitle,'');
  assert.equal(store.active.draft,'旧草稿');assert.equal(store.title(store.active),'新的探询 1');
});

test('permanent deletion removes archived history and draft from persisted data while keeping other tasks',async()=>{
  const {store,requests,storage,open}=setup();const a=await open();
  const pending=store.submit(a,'需要彻底移除的聊天内容');requests.at(-1).resolve(answer('归档回复'));await pending;
  store.setDraft('需要移除的草稿');const b=await open();store.setDraft('保留这份草稿');
  store.archiveTask(a);assert.equal(store.deleteTask(a),true);
  assert.equal(store.getTask(a),undefined);assert.equal(store.restoreTask(a),false);assert.equal(store.deleteTask(a),false);
  assert.equal(store.activeId,b);assert.equal(store.active.draft,'保留这份草稿');
  assert.ok(!storage.getItem(STORAGE_KEY).includes('需要彻底移除的聊天内容'));
  assert.ok(!storage.getItem(STORAGE_KEY).includes('需要移除的草稿'));
  const restored=new TaskStore({reply:async()=>answer('继续'),storage});
  assert.equal(restored.tasks.length,1);assert.equal(restored.getTask(a),undefined);assert.equal(restored.activeId,b);
});

test('deleting the viewed archive moves to another archive, then to the remaining live conversation',async()=>{
  const {store,open}=setup();const a=await open();const b=await open();const c=await open();
  store.archiveTask(a);store.archiveTask(b);store.switchTask(a);
  store.deleteTask(a);assert.equal(store.activeId,b);
  store.deleteTask(b);assert.equal(store.activeId,c);assert.equal(store.tasks.length,1);
  assert.equal(store.active.archived,false);
});

test('late replies and failures from deleted archives cannot return or change the remaining conversation',async()=>{
  for(const fail of [false,true]){
    const {store,requests,storage,open}=setup();const a=await open();
    const pending=store.submit(a,'正在等待的对话');const request=requests.at(-1);
    const b=await open();store.archiveTask(a);store.deleteTask(a);
    const saved=storage.getItem(STORAGE_KEY);let changes=0;store.onChange=()=>changes++;
    if(fail)request.reject(new Error('迟到的失败'));else request.resolve(answer('迟到的回复'));
    await pending;
    assert.equal(store.getTask(a),undefined);assert.equal(store.activeId,b);assert.equal(changes,0);
    assert.equal(storage.getItem(STORAGE_KEY),saved);
  }
});

test('deleting an archive with an unfinished opening ignores that opening when it arrives',async()=>{
  const {store,requests,storage,open}=setup();await open();const id=store.createTask();
  const pending=store.connect(id);const request=requests.at(-1);store.archiveTask(id);store.deleteTask(id);
  const saved=storage.getItem(STORAGE_KEY);request.resolve(answer('已经删除的开场'));await pending;
  assert.equal(store.getTask(id),undefined);assert.equal(storage.getItem(STORAGE_KEY),saved);
});

test('a failed storage write does not falsely report permanent deletion or lose the active archive',async()=>{
  const {store,storage,open}=setup();const a=await open();await open();
  store.archiveTask(a);store.switchTask(a);const saved=storage.getItem(STORAGE_KEY);
  storage.setItem=()=>{throw new Error('quota');};
  assert.equal(store.deleteTask(a),false);assert.equal(store.activeId,a);assert.equal(store.getTask(a).archived,true);
  assert.equal(storage.getItem(STORAGE_KEY),saved);assert.match(store.storageWarning,/保存暂不可用/);
});

test('message timestamps, IDs and measured processing time persist; metadata never goes into model input',async()=>{
  const storage=memory(),requests=[];let timestamp=1000,messageNumber=0;
  const store=new TaskStore({storage,id:()=> 'timed',messageId:()=>`message-${++messageNumber}`,now:()=>timestamp,
    reply:async messages=>{requests.push(messages);timestamp+=20;return {...answer('回答'),processingMs:12.75};}});
  const id=store.createTask();await store.connect(id);timestamp=2000;await store.submit(id,'问题');
  const [opening,user,response]=store.active.messages;
  assert.equal(opening.createdAt,1020);assert.equal(user.createdAt,2000);assert.equal(response.createdAt,2020);
  assert.equal(response.processingMs,12.75);assert.equal(user.processingMs,null);
  assert.equal(new Set(store.active.messages.map(message=>message.id)).size,3);
  assert.deepEqual(requests[1],[{role:'assistant',content:'回答'},{role:'user',content:'问题'}]);
  const restored=new TaskStore({reply:async()=>answer('继续'),storage});
  assert.deepEqual(restored.active.messages,store.active.messages);
});

test('deleting a question removes its answer, preserves later turns and remains chat-ready after reload',async()=>{
  const {store,requests,storage,open}=setup();const id=await open();
  for(const text of ['第一条问题','后来的问题']){
    const pending=store.submit(id,text);requests.at(-1).resolve(answer('回答：'+text));await pending;
  }
  const messages=[...store.active.messages];store.setDraft('保留草稿');
  assert.equal(store.deleteMessage(id,messages[1].id),true);
  assert.deepEqual(store.active.messages.map(message=>message.id),[messages[0],...messages.slice(3)].map(message=>message.id));
  assert.equal(store.active.draft,'保留草稿');assert.equal(store.deleteMessage(id,messages[1].id),false);
  const sent=[];const restored=new TaskStore({storage,reply:async context=>{sent.push(context);return answer('继续回复');}});
  assert.equal(restored.active.messages.length,3);await restored.submit(id,'新问题');
  assert.ok(!sent[0].some(message=>message.content==='第一条问题'));
  assert.ok(!sent[0].some(message=>message.content==='回答：第一条问题'));
  assert.ok(sent[0].some(message=>message.content==='后来的问题'));
  assert.equal(restored.deleteMessages(id,restored.active.messages.map(message=>message.id)),true);
  const empty=new TaskStore({storage,reply:async context=>{assert.deepEqual(context,[{role:'user',content:'重新开始'}]);return answer('收到');}});
  assert.equal(empty.active.connected,true);assert.equal(empty.active.messages.length,0);
  await empty.submit(id,'重新开始');assert.equal(empty.active.messages.length,2);
});

test('bulk deletion expands and deduplicates selected turns without touching another task or its branch',async()=>{
  const {store,requests,storage,open}=setup();const id=await open();
  for(const text of ['问题一','问题二','问题三']){const p=store.submit(id,text);requests.at(-1).resolve(answer('回答：'+text));await p;}
  const messages=[...store.active.messages],branch=store.branchTask(id,messages[6].id);
  const branchBefore=JSON.stringify(store.getTask(branch));store.switchTask(id);store.setDraft('待会再问');
  const selected=[messages[1].id,messages[2].id,messages[1].id,messages[5].id,'不存在'];
  assert.deepEqual(store.deletionMessageIds(id,selected),[messages[1],messages[2],messages[5],messages[6]].map(m=>m.id));
  assert.equal(store.deleteMessages(id,selected),true);
  assert.deepEqual(store.getTask(id).messages.map(m=>m.content),['你好，想聊什么？','问题二','回答：问题二']);
  assert.equal(store.getTask(id).draft,'待会再问');assert.equal(JSON.stringify(store.getTask(branch)),branchBefore);
  const restored=new TaskStore({storage,reply:async()=>answer('继续')});
  assert.equal(restored.getTask(id).messages[2].replyToId,messages[3].id);
  assert.equal(restored.deleteMessages(id,[]),false);assert.equal(restored.deleteMessages(id,['不存在']),false);
});

test('deleting an answer alone keeps its question and never reassigns later answers after reload',async()=>{
  const {store,requests,storage,open}=setup();const id=await open();
  for(const text of ['问题一','问题二']){const p=store.submit(id,text);requests.at(-1).resolve(answer('回答：'+text));await p;}
  const [opening,q1,a1,q2,a2]=store.active.messages;
  assert.equal(store.deleteMessage(id,a1.id),true);assert.ok(store.getMessage(id,q1.id));
  const restored=new TaskStore({storage,reply:async()=>answer('继续')});
  assert.deepEqual(restored.deletionMessageIds(id,[q1.id]),[q1.id]);
  assert.equal(restored.deleteMessage(id,q1.id),true);
  assert.deepEqual(restored.active.messages.map(m=>m.id),[opening.id,q2.id,a2.id]);
});

test('bulk deletion is atomic on failed storage and rejects changes during a reply',async()=>{
  const {store,requests,storage,open}=setup();const id=await open();
  const first=store.submit(id,'已有问题');requests.at(-1).resolve(answer('已有回答'));await first;
  const pending=store.submit(id,'待重试问题'),pendingId=store.active.pending.id;
  assert.equal(store.deleteMessages(id,[store.active.messages[1].id,pendingId]),false);
  requests.at(-1).reject(new Error('断线'));await pending;
  const before=JSON.stringify(store.active),save=storage.setItem;
  storage.setItem=()=>{throw new Error('quota');};
  assert.equal(store.deleteMessages(id,[store.active.messages[1].id,pendingId]),false);
  assert.equal(JSON.stringify(store.active),before);
  storage.setItem=save;
  assert.equal(store.deleteMessages(id,[store.active.messages[1].id,pendingId]),true);
  assert.equal(store.active.messages.length,1);assert.equal(store.active.pending,null);assert.equal(store.active.draft,'');
});

test('old histories gain stable answer links while explicit standalone answers remain standalone',()=>{
  const storage=memory();storage.setItem(STORAGE_KEY,JSON.stringify({version:2,activeId:'legacy',tasks:[{id:'legacy',number:1,connected:true,messages:[
    {id:'intro',role:'assistant',content:'开场'},
    {id:'q1',role:'user',content:'第一问'},
    {id:'a1',role:'assistant',content:'第一答'},
    {id:'orphan',role:'assistant',content:'独立反馈',replyToId:null},
    {id:'q2',role:'user',content:'第二问'},
    {id:'a2',role:'assistant',content:'第二答'},
  ]}]}));
  const store=new TaskStore({storage,reply:async()=>answer('继续')});
  assert.deepEqual(store.deletionMessageIds('legacy',['q1']),['q1','a1']);
  assert.equal(store.deleteMessage('legacy','q1'),true);
  const restored=new TaskStore({storage,reply:async()=>answer('继续')});
  assert.deepEqual(restored.deletionMessageIds('legacy',['q2']),['q2','a2']);
  assert.equal(restored.getMessage('legacy','orphan').replyToId,null);
  assert.equal(restored.getMessage('legacy','intro').replyToId,null);
});

test('message deletion blocks in-flight edits and safely clears a failed pending message',async()=>{
  const {store,requests,storage,open}=setup();const id=await open();
  const pending=store.submit(id,'失败的消息');const pendingId=store.active.pending.id;
  assert.equal(store.deleteMessage(id,store.active.messages[0].id),false);
  assert.equal(store.deleteMessage(id,pendingId),false);
  requests.at(-1).reject(new Error('断线'));await pending;
  store.setDraft('已修改的重试草稿');assert.equal(store.deleteMessage(id,pendingId),true);
  assert.equal(store.active.pending,null);assert.equal(store.active.draft,'已修改的重试草稿');assert.equal(store.active.error,'');
  const original=JSON.stringify(store.active.messages);storage.setItem=()=>{throw new Error('quota');};
  assert.equal(store.deleteMessage(id,store.active.messages[0].id),false);
  assert.equal(JSON.stringify(store.active.messages),original);
});

test('branching an assistant reply or a user message excludes future turns without changing the source',async()=>{
  const {store,requests,open}=setup();const source=await open();
  for(const text of ['早先的问题','后来的问题']){
    const pending=store.submit(source,text);requests.at(-1).resolve(answer('回复：'+text));await pending;
  }
  store.setDraft('原对话草稿');const original=JSON.stringify(store.getTask(source));const messages=store.active.messages;
  const calls=requests.length;const assistantBranch=store.branchTask(source,messages[2].id);
  assert.deepEqual(store.active.messages,messages.slice(0,3));assert.equal(store.active.draft,'');
  assert.equal(requests.length,calls);assert.equal(JSON.stringify(store.getTask(source)),original);
  const userBranch=store.branchTask(source,messages[1].id);assert.notEqual(userBranch,assistantBranch);
  assert.equal(store.active.messages.length,1);assert.equal(store.active.draft,'早先的问题');
  const pending=store.submit(userBranch,'改写早先的问题');assert.deepEqual(requests.at(-1).messages.map(message=>message.content),['你好，想聊什么？','改写早先的问题']);
  requests.at(-1).resolve(answer('新的方向'));await pending;
  assert.equal(JSON.stringify(store.getTask(source)),original);assert.equal(store.getTask(assistantBranch).messages.length,3);
});

test('branching a pending user message keeps the original late reply in its own task',async()=>{
  const {store,requests,open}=setup();const source=await open();const pending=store.submit(source,'等待中的问题');const request=requests.at(-1);
  const branch=store.branchTask(source,store.getTask(source).pending.id);
  assert.equal(store.active.draft,'等待中的问题');assert.equal(store.active.waiting,false);assert.equal(store.active.messages.length,1);
  request.resolve(answer('原来的回答'));await pending;
  assert.equal(store.activeId,branch);assert.equal(store.active.messages.length,1);assert.equal(store.getTask(source).messages.length,3);
});

test('legacy messages migrate without inventing historical times or losing conversations',()=>{
  const storage=memory();storage.setItem(STORAGE_KEY,JSON.stringify({version:1,activeId:'legacy',tasks:[{id:'legacy',number:1,messages:[answer('旧开场').message,{role:'user',content:'旧问题'},answer('旧回答').message]}]}));
  const store=new TaskStore({storage,reply:async()=>answer('新回答')});
  assert.equal(store.active.messages.length,3);
  assert.ok(store.active.messages.every(message=>message.id&&message.createdAt===null&&message.processingMs===null));
  store.save();assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).version,2);
  const restored=new TaskStore({storage,reply:async()=>answer('继续')});assert.deepEqual(restored.active.messages,store.active.messages);
});
