import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TaskStore} from '../dist/task-store.js';
import {freshCoachState} from '../dist/coach-protocol.js';
const answer=content=>({message:{role:'assistant',content},mode:'mock'});
function setup(storage={value:null,getItem(){return this.value;},setItem(k,v){this.value=v;}}){const calls=[];const store=new TaskStore({storage,reply:(messages,options)=>new Promise((resolve,reject)=>calls.push({messages,options,resolve,reject}))});return {store,calls,storage};}
test('stop is terminal even with a draft and queue; stale answer cannot advance the frozen task',async()=>{
 const {store,calls}=setup();const pending=store.submit(null,'原问题'),id=store.activeId;store.queueMessage(id,'排队内容');store.setDraft('新的草稿');
 assert.equal(store.stop(id),true);assert.equal(calls[0].options.signal.aborted,true);assert.equal(store.active.stopped,true);assert.equal(store.active.draft,'新的草稿');
 assert.equal(await store.resume(id),false);assert.equal(store.sendQueued(id),false);assert.equal(await store.changeInteractionMode(id,'choice'),false);
 const state=freshCoachState();state.notes.facts=['迟到的事实'];calls[0].resolve({...answer('不应该出现的回复'),coachState:state});await pending;
 assert.equal(store.active.messages.length,0);assert.equal(store.active.pending.content,'原问题');assert.equal(store.active.coachState,undefined);assert.equal(calls.length,1);
 const next=store.submit(id,'新的草稿');const newId=store.activeId;assert.equal(newId,id);assert.equal(store.tasks.length,1);assert.deepEqual(calls[1].messages,[{role:'user',content:'新的草稿'}]);assert.equal(calls[1].options.coachState,null);
 calls[1].resolve(answer('新回复'));await next;assert.equal(store.active.stopped,false);assert.equal(store.active.messages[0].content,'原问题');assert.equal(store.active.messages[1].content,'排队内容');assert.equal(store.active.messages[1].unsent,true);assert.equal(store.active.queued,null);
});
test('only an explicit history branch inherits stopped history; both user and assistant branches work',async()=>{
 const {store,calls}=setup();let p=store.submit(null,'第一问'),id=store.activeId;const state=freshCoachState();state.notes.facts=['第一轮的事实'];calls[0].resolve({...answer('第一答'),coachState:state});await p;
 p=store.submit(id,'第二问');store.stop(id);const original=JSON.stringify(store.getTask(id));
 const branch=store.branchTask(id,store.getTask(id).pending.id);assert.equal(store.active.stopped,false);assert.equal(store.active.draft,'第二问');assert.deepEqual(store.active.coachState.notes.facts,['第一轮的事实']);
 const next=store.submit(branch,store.active.draft);assert.deepEqual(calls[2].messages.map(m=>m.content),['第一问','第一答','第二问']);calls[2].resolve(answer('分支回答'));await next;
 const other=store.branchTask(id,store.getTask(id).messages[1].id);assert.equal(store.getTask(other).messages.length,2);assert.equal(store.getTask(other).stopped,false);
 calls[1].resolve(answer('迟到'));await p;assert.equal(JSON.stringify(store.getTask(id)),original);
});
test('refresh and migration retain frozen history, independent draft and unsent queue without auto requests',()=>{
 const {store,storage}=setup();void store.submit(null,'未完成问题');store.queueMessage(store.activeId,'队列内容');store.setDraft('输入中的草稿');store.stopAll();
 let restored=setup(storage);assert.equal(restored.calls.length,0);assert.equal(restored.store.active.stopped,true);assert.equal(restored.store.active.pending.content,'未完成问题');assert.equal(restored.store.active.draft,'输入中的草稿');assert.equal(restored.store.active.queued.content,'队列内容');
 const legacy=JSON.parse(storage.value);delete legacy.tasks[0].stopped;legacy.tasks[0].paused=true;storage.value=JSON.stringify(legacy);restored=setup(storage);assert.equal(restored.store.active.stopped,true);assert.equal(restored.calls.length,0);
});
test('deleting a pending question does not unlock a stopped task',async()=>{
 const {store}=setup();void store.submit(null,'问题');const id=store.activeId;store.stop(id);assert.equal(store.deleteMessage(id,store.active.pending.id),true);assert.equal(store.active.stopped,true);
 assert.equal(await store.resume(id),false);assert.equal(store.sendQueued(id),false);
});

test('same-window reset survives reload and deletion; historical continuation selects only its segment',async()=>{
 const {store,calls,storage}=setup();let p=store.submit(null,'旧事实'),id=store.activeId;const old=freshCoachState();old.notes.facts=['旧秘密'];calls[0].resolve({...answer('旧回答'),coachState:old});await p;
 void store.submit(id,'停止的提问');store.stop(id);p=store.submit(id,'新问题');const first=store.active.pending.id;
 assert.equal(store.activeId,id);assert.equal(calls[2].options.coachState,null);assert.deepEqual(calls[2].messages.map(x=>x.content),['新问题']);
 const fresh=freshCoachState();fresh.notes.facts=['新事实'];calls[2].resolve({...answer('新回答'),coachState:fresh});await p;
 const branch=store.branchTask(id,first);assert.equal(store.active.coachState,null);p=store.submit(branch,'修改的新问题');assert.deepEqual(calls[3].messages.map(x=>x.content),['修改的新问题']);calls[3].resolve(answer('分支答'));await p;
 store.switchTask(id);store.deleteMessage(id,first);let restored=setup(storage);p=restored.store.submit(id,'刷新后的问题');assert.deepEqual(restored.calls[0].messages.map(x=>x.content),['刷新后的问题']);assert.equal(restored.calls[0].options.coachState,null);restored.calls[0].resolve(answer('刷新回答'));await p;
 void restored.store.submit(id,'再停止');restored.store.stop(id);p=restored.store.submit(id,'第三段');assert.deepEqual(restored.calls[2].messages.map(x=>x.content),['第三段']);assert.equal(restored.store.tasks.length,2);restored.calls[2].resolve(answer('第三段答'));await p;
});
