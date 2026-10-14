import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TaskStore} from '../dist/task-store.js';
import {freshCoachState} from '../dist/coach-protocol.js';
const answer=text=>({message:{role:'assistant',content:text},mode:'mock'});
function setup(storage={value:null,getItem(){return this.value;},setItem(k,v){this.value=v;}}){
 const calls=[];const store=new TaskStore({storage,reply:(messages,options)=>new Promise((resolve,reject)=>calls.push({messages,options,resolve,reject}))});
 return {store,calls,storage};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('explicit queue sends once after success, includes prior answer, and preserves the next draft',async()=>{
 const {store,calls}=setup();const first=store.submit(null,'问题一'),id=store.activeId;
 store.setDraft('问题二');assert.equal(calls.length,1);assert.equal(store.queueMessage(id,'问题二'),true);assert.equal(store.active.draft,'');
 assert.equal(store.queueMessage(id,'不能覆盖排队内容'),false);store.setDraft('问题三尚未写完');
 calls[0].resolve(answer('回答一'));await first;assert.equal(calls.length,2);
 assert.deepEqual(calls[1].messages.map(m=>m.content),['问题一','回答一','问题二']);assert.equal(store.active.queued,null);
 calls[1].resolve(answer('回答二'));await tick();assert.equal(store.active.messages.length,4);assert.equal(store.active.draft,'问题三尚未写完');assert.equal(calls.length,2);
});

test('failure keeps queued content and newer draft; explicit retry drains queue only after success',async()=>{
 const {store,calls}=setup();const first=store.submit(null,'当前问题'),id=store.activeId;store.queueMessage(id,'排队问题');store.setDraft('新草稿');
 calls[0].reject(new Error('网络失败'));await first;assert.equal(calls.length,1);assert.equal(store.active.draft,'新草稿');assert.equal(store.active.queued.content,'排队问题');
 const retry=store.retryAction(id);calls[1].resolve(answer('恢复'));await retry;assert.equal(calls.length,3);assert.equal(calls[2].messages.at(-1).content,'排队问题');
 calls[2].resolve(answer('排队完成'));await tick();assert.equal(store.active.draft,'新草稿');
});

test('background queues and cancellation stay in the owning task',async()=>{
 const {store,calls}=setup();const first=store.submit(null,'任务一'),a=store.activeId;store.queueMessage(a,'任务一第二问');store.startNew();
 const second=store.submit(null,'任务二'),b=store.activeId;store.setDraft('任务二草稿');store.stop(b);
 calls[0].resolve(answer('任务一答复'));await first;assert.equal(calls.length,3);assert.equal(calls[2].messages.at(-1).content,'任务一第二问');
 assert.equal(store.activeId,b);assert.equal(store.active.stopped,true);assert.equal(store.active.draft,'任务二草稿');
 calls[2].resolve(answer('任务一第二答'));calls[1].resolve(answer('被取消的任务二答复'));await second;await tick();
 assert.equal(store.getTask(a).messages.length,4);assert.equal(store.getTask(b).messages.length,0);
});

test('queue persistence failure leaves input untouched, and cancelling queue prevents auto-send',async()=>{
 const {store,calls,storage}=setup();const first=store.submit(null,'原问题'),id=store.activeId;store.setDraft('要排队');
 const save=storage.setItem;storage.setItem=()=>{throw new Error('quota');};assert.equal(store.queueMessage(id,'要排队'),false);assert.equal(store.active.draft,'要排队');assert.equal(store.active.queued,null);
 storage.setItem=save;assert.equal(store.queueMessage(id,'要排队'),true);assert.equal(store.cancelQueued(id),true);
 calls[0].resolve(answer('完成'));await first;assert.equal(calls.length,1);
});
