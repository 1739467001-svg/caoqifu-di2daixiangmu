import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TaskStore,STORAGE_KEY} from '../dist/task-store.js';
import {importHistory} from '../dist/secure-upgrade.js';

function memory(){const data=new Map();return {getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)};}
test('HTTP history import preserves conversation, selected task and drafts on first HTTPS visit',async()=>{
  const source=memory(),target=memory();
  const store=new TaskStore({reply:async()=>({message:{role:'assistant',content:'你希望什么变化？'},mode:'mock'}),storage:source});
  await store.submit(null,'我想整理时间');store.setDraft('还有一个想法');
  const raw=source.getItem(STORAGE_KEY);assert.match(importHistory(target,raw),/已带到安全页面/);
  const restored=new TaskStore({reply:async()=>{},storage:target});
  assert.deepEqual(restored.active.messages,store.active.messages);assert.equal(restored.activeId,store.activeId);assert.equal(restored.active.draft,'还有一个想法');
  assert.equal(source.getItem(STORAGE_KEY),raw);
});
test('import preserves an existing HTTPS conversation and never overwrites its draft',async()=>{
  const target=memory();const store=new TaskStore({reply:async()=>{},storage:target});store.setDraft('安全页面的草稿');const previous=target.getItem(STORAGE_KEY);
  assert.match(importHistory(target,JSON.stringify({version:2,tasks:[],newDraft:'旧草稿'})),/已有对话/);assert.equal(target.getItem(STORAGE_KEY),previous);
});
test('malformed or unavailable history storage fails without changing saved data',()=>{
  const target=memory();for(const raw of ['not json','{}',JSON.stringify({version:2,tasks:[{id:'broken'}]})])assert.throws(()=>importHistory(target,raw));
  assert.equal(target.getItem(STORAGE_KEY),null);assert.throws(()=>importHistory(null,'{}'));
});
