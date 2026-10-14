import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {VoiceInput} from '../dist/voice-input.js';

function setup(options={}){
  const instances=[],drafts=[],states=[],notices=[],timers=new Map();let timerId=0;
  class Recognition{
    constructor(){instances.push(this);}
    start(){this.started=true;}
    stop(){this.stopped=true;}
    abort(){this.aborted=true;}
  }
  const voice=new VoiceInput({Recognition,secureContext:true,onDraft:(...args)=>drafts.push(args),onState:s=>states.push(s),onNotice:s=>notices.push(s),setTimer:fn=>{timers.set(++timerId,fn);return timerId;},clearTimer:id=>timers.delete(id),...options});
  return {voice,instances,drafts,states,notices,timers};
}
const result=(text,isFinal=true)=>Object.assign([{transcript:text}],{isFinal});
test('default timers respect browser Window receiver rules throughout start, stop and cancel',async()=>{
  const source=await readFile(new URL('../dist/voice-input.js',import.meta.url),'utf8');
  // Node's timers tolerate a custom receiver, unlike browser WebIDL timers.
  const runtime=runInNewContext(`'use strict';
    const jobs=new Map();let id=0;
    function setTimeout(fn,ms){if(this!==undefined&&this!==globalThis)throw new TypeError('Illegal invocation');jobs.set(++id,fn);return id;}
    function clearTimeout(id){if(this!==undefined&&this!==globalThis)throw new TypeError('Illegal invocation');jobs.delete(id);}
    ${source.replace('export class VoiceInput','class VoiceInput')}
    ({VoiceInput,jobs});`);
  let recognition;const states=[];
  class Recognition{constructor(){recognition=this;}start(){this.started=true;}stop(){this.stopped=true;}abort(){this.aborted=true;}}
  const voice=new runtime.VoiceInput({Recognition,secureContext:true,onDraft:()=>{},onState:s=>states.push(s),onNotice:()=>{}});
  assert.equal(voice.start({contextId:null,text:''}),true);assert.equal(recognition.started,true);
  recognition.onstart();assert.equal(states.at(-1),'listening');
  voice.stop();assert.equal(recognition.stopped,true);recognition.onend();assert.equal(runtime.jobs.size,0);assert.equal(voice.active,false);
  voice.start({contextId:null,text:''});voice.cancel();assert.equal(recognition.aborted,true);assert.equal(runtime.jobs.size,0);
});
test('microphone starts only on request; insecure and unsupported contexts explain why',()=>{
  const a=setup({secureContext:false});assert.equal(a.instances.length,0);
  assert.equal(a.voice.start({contextId:null,text:''}),false);assert.match(a.notices.at(-1),/HTTPS/);assert.equal(a.instances.length,0);
  const b=setup({Recognition:undefined});assert.equal(b.voice.start({contextId:null,text:''}),false);assert.match(b.notices.at(-1),/不支持/);
});
test('dictation replaces selected text, ignores interim drafts and avoids duplicate final results',()=>{
  const t=setup();t.voice.start({contextId:'a',text:'今天旧内容真好',selectionStart:2,selectionEnd:5});const r=t.instances[0];r.onstart();
  r.onresult({results:[result('天气',false)]});assert.equal(t.drafts.length,0);assert.match(t.notices.at(-1),/天气/);
  r.onresult({results:[result('天气'),result('非常',false)]});assert.equal(t.drafts.at(-1)[0],'今天天气真好');
  r.onresult({results:[result('天气'),result('特别')]});assert.deepEqual(t.drafts.at(-1),['今天天气特别真好',6,'a']);
  t.voice.stop();assert.equal(r.stopped,true);assert.equal(t.states.at(-1),'stopping');
  r.onend();assert.equal(t.voice.active,false);assert.equal(t.timers.size,0);assert.match(t.notices.at(-1),/修改后发送/);
});
test('cancelled sessions cannot put late text into a different conversation',()=>{
  const t=setup();t.voice.start({contextId:'a',text:''});const old=t.instances[0];old.onstart();
  t.voice.cancel();assert.ok(old.aborted);
  t.voice.start({contextId:'b',text:'草稿'});const next=t.instances[1];next.onstart();
  old.onresult({results:[result('不该出现')]});old.onend();old.onerror({error:'network'});
  assert.equal(t.drafts.length,0);assert.equal(t.voice.contextId,'b');
  next.onresult({results:[result('新内容')]});assert.equal(t.drafts.at(-1)[0],'草稿新内容');
});
test('permission and network failures stop listening and keep previously recognized text',()=>{
  const t=setup();t.voice.start({contextId:null,text:'已有'});const r=t.instances[0];r.onstart();
  r.onresult({results:[result('文字')]});r.onerror({error:'network'});
  assert.equal(t.voice.active,false);assert.ok(r.aborted);assert.equal(t.drafts.at(-1)[0],'已有文字');assert.match(t.notices.at(-1),/连接不上/);assert.equal(t.timers.size,0);
  t.voice.start({contextId:null,text:''});t.instances[1].onerror({error:'not-allowed'});assert.match(t.notices.at(-1),/麦克风权限/);
});
test('length cap stops capture without splitting an emoji or dropping surrounding draft',()=>{
  const t=setup();t.voice.start({contextId:'a',text:'AB',selectionStart:1,maxLength:5});const r=t.instances[0];r.onstart();
  r.onresult({results:[result('你好🙂更多')]});assert.equal(t.drafts.at(-1)[0],'A你好B');assert.ok(r.stopped);
});
test('permission timeout, cancellation and stop timeout release the microphone',()=>{
  const t=setup();t.voice.start({contextId:null,text:''});t.timers.values().next().value();assert.ok(t.instances[0].aborted);assert.equal(t.voice.active,false);
  t.voice.start({contextId:null,text:''});t.voice.stop();assert.ok(t.instances[1].aborted);
  t.voice.start({contextId:null,text:''});const r=t.instances[2];r.onstart();t.timers.values().next().value();assert.ok(r.stopped);
  t.timers.values().next().value();assert.ok(r.aborted);assert.equal(t.voice.active,false);
});
