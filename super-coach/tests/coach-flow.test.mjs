import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runCoachTurn,parseCoachEnvelope} from '../src/coach-flow.mjs';
import {COACH_OPENING,TOPIC_PROMPT,freshCoachState,emptyNotes,splitPopup} from '../dist/coach-protocol.js';
import {getReplyPrompts} from '../dist/reply-prompts.js';
import {TaskStore} from '../dist/task-store.js';
import {createApp} from '../server.mjs';
import {readConfig} from '../src/config.mjs';
import {SYSTEM_PROMPT} from '../src/system-prompt.mjs';

const choice='我们慢慢说。\n你最想理清哪一点？\n[POPUP]\nA. 我想要什么\nB. 我为什么在意\nC. 其他，我自己说\n[/POPUP]';
const open='我们就聊这件事。\n1. 最近发生了什么？\n2. 这为什么让你在意？';
const checkpoint='我捋一下你刚说的：你在意能不能说清楚。\n[POPUP]\n我理解得对吗？哪里要改？\n[/POPUP]';
const binary='没关系，换个简单角度。\n你更想先聊哪一边？\n[POPUP]\nA. 发生的事\nB. 我的感受\n[/POPUP]';
const user=content=>({role:'user',content});
function engine(overrides={}){
  const calls=[];
  const reply=async args=>{
    const directive=JSON.parse(args.systemPrompt.split('【本轮流程指令】\n')[1].split('\n')[0]);calls.push(directive);
    const notes=structuredClone(directive.state.notes);
    notes.facts=[...notes.facts,args.messages.at(-1).content].slice(-12);
    return {role:'assistant',content:JSON.stringify({level:'L3',kind:directive.purpose==='answer'?'answer':directive.allowedKinds.includes('choice')&&directive.mode==='choice'?'choice':'open',reply:directive.purpose==='answer'?'先写好一句开场，明天班会前找老师约一个发言机会。':directive.allowedKinds.includes('choice')&&directive.mode==='choice'?choice:open,notes,core:'',...overrides})};
  };return {reply,calls};
}
const turn=(state,content,reply,extra={})=>runCoachTurn({messages:[user(content)],interactionMode:state?.mode,coachState:state,reply,config:{useMock:false},...extra});

test('optional mode opening and topic invitation do not use a model or record control text as facts',async()=>{
  const noCall=()=>{throw new Error('unexpected model request');};
  const opening=await runCoachTurn({messages:[],interactionMode:null,reply:noCall,config:{useMock:false}});
  assert.equal(opening.message.content,COACH_OPENING);assert.equal(opening.requiresInteractionMode,false);
  const topic=await turn(opening.coachState,'我选择选择题模式。',noCall,{interactionMode:'choice',action:'mode'});
  assert.equal(topic.message.content,TOPIC_PROMPT);assert.equal(topic.coachState.phase,'topic');assert.deepEqual(topic.coachState.notes,emptyNotes());
});

test('choice preference allows free answers, follows readiness and answers an explicit request without confirmation',async()=>{
 const {reply,calls}=engine();let r=await turn(freshCoachState('choice','topic'),'我不敢发言',reply);
 assert.equal(r.coachState.replyKind,'choice');assert.equal(r.coachState.notes.surfaceRequest,'我不敢发言');
 r=await turn(r.coachState,'其实不是不敢，是没有轮到我',reply);
 assert.equal(r.coachState.replyKind,'open');assert.equal(getReplyPrompts({...r.message,coachState:r.coachState},'choice').kind,'open');
 r=await turn(r.coachState,'下周班会每个人只有一分钟',reply);
 r=await turn(r.coachState,'直接给我一个办法，我只想说清一个例子',reply);
 assert.equal(r.coachState.phase,'answer');assert.equal(calls.at(-1).purpose,'answer');assert.equal(splitPopup(r.message.content).popup,null);assert.match(r.message.content,/约一个发言机会/);
});

test('an answer may be provided immediately without a mandatory interview',async()=>{
 const r=await turn(freshCoachState(null,'topic'),'我有十分钟准备发言，只说一个故事，怎么安排？',engine({kind:'answer',reply:'用两分钟写开头，五分钟试讲，三分钟删掉不必要的细节。'}).reply);
 assert.equal(r.coachState.phase,'answer');assert.equal(r.coachState.rounds,0);assert.equal(getReplyPrompts({...r.message,coachState:r.coachState},null),null);
});

test('old checkpoint and final records resume without a confirmation gate or replacing the model answer',async()=>{
 for(const phase of ['checkpoint','final']){const state=freshCoachState('open',phase);state.notes.facts=['还没轮到我发言'];
 const r=await turn(state,'我想先解决发言机会的问题',engine({kind:'answer',reply:'先找主持人约好一个发言顺序，准备一句话的开头。'}).reply);
 assert.equal(r.coachState.phase,'answer');assert.match(r.message.content,/约好一个发言顺序/);assert.equal(splitPopup(r.message.content).popup,null);}
});

test('explicit mode switching keeps factual notes and resets the question rhythm',async()=>{
 const state=freshCoachState('choice','checkpoint');state.notes.facts=['用户自己提出的事实'];state.rounds=3;state.coreStreak=2;
 const changed=await turn(state,'切换为多问题打包模式',engine().reply);
 assert.equal(changed.interactionMode,'open');assert.equal(changed.coachState.phase,'question');assert.equal(changed.coachState.rounds,1);assert.equal(changed.coachState.coreStreak,0);assert.deepEqual(changed.coachState.notes,state.notes);assert.equal(state.mode,'choice');
});

test('uncertainty can use optional choices in free conversation, including Other',async()=>{
 const r=await turn(freshCoachState('open','question'),'不知道',engine({kind:'choice',reply:choice}).reply);
 const ui=getReplyPrompts({...r.message,interactionMode:'open',coachState:r.coachState},'open');assert.equal(ui.kind,'choice');assert.equal(ui.items.at(-1).requiresText,true);
});

test('asking for an answer forces an answer on that turn, while stopping needs no paid call',async()=>{
 const {reply,calls}=engine();for(const text of ['你直接告诉我答案吧','别问了','帮我总结一下']){
 const r=await turn(freshCoachState('choice','question'),text,reply);assert.equal(r.coachState.replyKind,'answer');assert.deepEqual(calls.at(-1).allowedKinds,['answer']);assert.equal(splitPopup(r.message.content).popup,null);}
 const stop=await turn(freshCoachState('open','question'),'不聊了',()=>{throw new Error('unnecessary call');});assert.equal(stop.coachState.phase,'finished');assert.doesNotMatch(stop.message.content,/[？?]/);
});

test('unwanted confirmation popups, repeated choices and unanswered answer requests are rejected',async()=>{
 const state=freshCoachState('choice','question');state.replyKind='choice';
 for(const [input,overrides] of [['继续',{kind:'choice',reply:choice}],['直接给我一个办法',{kind:'open',reply:open}],['继续',{kind:'answer',reply:checkpoint}]]){
 await assert.rejects(turn(state,input,engine(overrides).reply),e=>e.code==='INVALID_COACH_REPLY');}
});

test('broken envelopes and unexpected popups are rejected without exposing notes or modifying saved state',async()=>{
  const state=freshCoachState('open','question'),before=structuredClone(state);
  for(const content of ['notes: PRIVATE','{"reply":"visible","notes":{}}',JSON.stringify({reply:'one [POPUP]x[/POPUP] two [POPUP]y[/POPUP]',notes:emptyNotes(),core:''})]){
    await assert.rejects(turn(state,'回答',async()=>({content})),error=>error.code==='INVALID_COACH_REPLY'&&!error.message.includes('PRIVATE'));
    assert.deepEqual(state,before);
  }
});

test('structured options are rendered by the server and an empty choice list cannot masquerade as a question',async()=>{
  const reply=engine({kind:'choice',reply:'现在最卡住你的是哪一点？',options:['手机分心','不知从哪开始']}).reply;
  const r=await turn(freshCoachState('choice','topic'),'做作业拖延',reply);
  const ui=getReplyPrompts({...r.message,coachState:r.coachState},'choice');
  assert.deepEqual(ui.items.map(item=>item.text),['手机分心','不知从哪开始','其他，我自己说']);
  assert.equal(ui.items.at(-1).requiresText,true);
  await assert.rejects(turn(freshCoachState('choice','topic'),'拖延',engine({kind:'choice',reply:'下面哪一种？',options:[]}).reply),e=>e.code==='INVALID_COACH_REPLY');
  await assert.rejects(turn(freshCoachState(null,'topic'),'问题',engine({kind:'answer',reply:'直接回答。',options:['不该存在']}).reply),e=>e.code==='INVALID_COACH_REPLY');
});

test('popup parsing preserves literal text and Other requests input instead of sending a label',()=>{
  const ui=getReplyPrompts({role:'assistant',content:choice},'choice');assert.equal(ui.items.at(-1).requiresText,true);
  assert.equal(splitPopup(choice).text,'我们慢慢说。\n你最想理清哪一点？');
  const malicious='问题？\n[POPUP]\nA. <img src=x onerror=alert(1)>\nB. 其他，我自己说\n[/POPUP]';
  assert.equal(getReplyPrompts({role:'assistant',content:malicious},'choice').items[0].text,'<img src=x onerror=alert(1)>');
});

function memory(){const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};}
function storeReply(messages,options){return runCoachTurn({...options,messages,config:{useMock:true},reply:()=>{throw new Error('no paid calls');}}).then(value=>({...value,mode:'mock'}));}
test('notes survive reload, branching uses only that point, and deletion invalidates all dependent snapshots',async()=>{
  const storage=memory(),store=new TaskStore({reply:storeReply,storage});
  assert.equal(store.tasks.length,0);await store.beginCoach('choice');const id=store.activeId;
  assert.equal(store.active.messages.at(-1).content,TOPIC_PROMPT);assert.equal(store.active.coachState.phase,'topic');
  await store.submit(id,'我想理解发言');const earlier=store.active.messages.at(-1).id;
  await store.submit(id,'后来出现的秘密事实');
  const restored=new TaskStore({reply:storeReply,storage});assert.ok(restored.active.coachState.notes.facts.includes('后来出现的秘密事实'));
  const branch=restored.branchTask(id,earlier);assert.ok(!JSON.stringify(restored.getTask(branch).coachState).includes('后来出现的秘密事实'));
  const original=restored.getTask(id),question=original.messages.find(m=>m.content==='我想理解发言');
  assert.equal(restored.deleteMessage(id,question.id),true);assert.equal(original.coachState,null);assert.ok(original.messages.every(m=>!m.coachState));
  assert.ok(restored.getTask(branch).coachState.notes.facts.includes('我想理解发言'));
});

test('failed replies and failed deletion do not advance notes or lose the original snapshots',async()=>{
  const storage=memory();let broken=false;const store=new TaskStore({storage,reply:(messages,options)=>broken?Promise.reject(new Error('offline')):storeReply(messages,options)});
  await store.beginCoach('open');await store.submit(store.activeId,'我想读书');const old=structuredClone(store.active.coachState);
  broken=true;await store.submit(store.activeId,'但是没时间');assert.deepEqual(store.active.coachState,old);
  const messages=store.active.messages;storage.setItem=()=>{throw new Error('full');};
  assert.equal(store.deleteMessage(store.activeId,messages[2].id),false);assert.deepEqual(store.active.coachState,old);assert.equal(store.active.messages,messages);
});

test('HTTP protocol separates private factual notes from display and validates client state',async()=>{
  const app=await createApp({config:readConfig({USE_MOCK:'true'})});await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  try{
    const url=`http://127.0.0.1:${app.address().port}`;
    const post=value=>fetch(url+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({coachProtocol:1,...value})});
    const opening=await (await post({messages:[],interactionMode:null})).json();assert.equal(opening.message.content,COACH_OPENING);
    const response=await post({messages:[user('choice')],interactionMode:'choice',coachState:opening.coachState,action:'mode'});const topic=await response.json();assert.equal(topic.message.content,TOPIC_PROMPT);
    const answer=await (await post({messages:[user('我想参加班会')],interactionMode:'choice',coachState:topic.coachState})).json();
    assert.equal(answer.coachState.notes.surfaceRequest,'我想参加班会');assert.doesNotMatch(answer.message.content,/surfaceRequest|askedAngles/);
    assert.equal((await post({messages:[user('hi')],interactionMode:'choice',coachState:{version:1}})).status,400);
    assert.equal((await fetch(url+'/coach-protocol.js')).status,200);
  }finally{await new Promise(resolve=>app.close(resolve));}
});

test('unselected mode can directly ask an L0 fact; temporary facts preserve exploration notes and rhythm',async()=>{
  const direct=engine({level:'L0',kind:'answer',reply:'2 + 3 = 5。'}).reply;
  const first=await runCoachTurn({messages:[user('2+3等于多少？')],interactionMode:null,reply:direct,config:{useMock:false}});
  assert.equal(first.message.content,'2 + 3 = 5。');assert.equal(first.requiresInteractionMode,false);assert.equal(first.coachState.mode,null);
  const state=freshCoachState('choice','checkpoint');state.rounds=2;state.notes.facts=['我想在班会上说话'];state.notes.missedGuesses=['不是害怕同学，是没轮到我'];
  const temporary=await turn(state,'2+3等于多少？',direct);
  assert.deepEqual(temporary.coachState.notes,state.notes);assert.equal(temporary.coachState.phase,'checkpoint');assert.equal(temporary.coachState.rounds,2);
  assert.equal(getReplyPrompts({...temporary.message,coachState:temporary.coachState},'choice'),null);
});

test('medium concerns are not forcibly ended after two questions',async()=>{
 const {reply,calls}=engine({level:'L2'});let r=await turn(freshCoachState(null,'topic'),'明天聚餐去不去呢？',reply);
 for(const content of ['我想去，但还有没说清的事','还要照顾弟弟','当天可能要加班'])r=await turn(r.coachState,content,reply);
 assert.equal(r.coachState.phase,'question');assert.equal(calls.at(-1).purpose,'adaptive');assert.ok(calls.at(-1).allowedKinds.includes('open'));
});

test('explicit reminders persist verbatim and are injected with the full approved project memory next call',async()=>{
  const storage=memory();const requests=[];
  const liveReply=engine().reply;
  const invoke=async(messages,options)=>({...await runCoachTurn({...options,messages,config:{useMock:false},reply:async args=>{requests.push(args);return liveReply(args);}}),mode:'live'});
  const store=new TaskStore({storage,reply:invoke});
  await store.submit(null,'请记住：我喜欢先看具体例子，再聊原因。');
  assert.deepEqual(store.active.coachState.notes.reminders,['请记住：我喜欢先看具体例子，再聊原因。']);
  const restored=new TaskStore({storage,reply:invoke});await restored.submit(restored.activeId,'我最近想换学习方法');
  const request=requests.at(-1);assert.equal(request.jsonOutput,true);assert.match(request.systemPrompt,/我喜欢先看具体例子，再聊原因/);assert.match(request.systemPrompt,/猜过但没猜中的点/);assert.match(request.systemPrompt,/每次调用模型都带入项目设计笔记/);
  assert.match(SYSTEM_PROMPT,/L0：事实/);assert.match(SYSTEM_PROMPT,/模式可不选/);
  assert.doesNotMatch(restored.active.messages.at(-1).content,/<NOTES>|surfaceRequest|reminders/);
  restored.startNew();await restored.submit(null,'一个完全不同的问题');assert.deepEqual(restored.active.coachState.notes.reminders,[]);
});

test('attachment NOTES protocol is parsed privately; malformed or nested notes are never displayed',()=>{
  const data={'表层诉求':'发言','已确认事实':['没有轮到我'],'模糊点':[],'矛盾点':[],'反复出现的主题':[],'已问过的角度':['轮到发言的机会'],'猜过但没猜中的点':['不是不敢'],'等级':'L3'};
  const parsed=parseCoachEnvelope('我们慢慢说。\n<NOTES>\n'+JSON.stringify(data)+'\n</NOTES>');assert.equal(parsed.reply,'我们慢慢说。');assert.deepEqual(parsed.notes.missedGuesses,['不是不敢']);
  assert.throws(()=>parseCoachEnvelope('不能显示<NOTES>{broken}</NOTES>'),error=>error.code==='INVALID_COACH_REPLY');
  assert.throws(()=>parseCoachEnvelope(JSON.stringify({reply:'<NOTES>hidden</NOTES>',level:'L3',core:'',notes:emptyNotes()})),error=>error.code==='INVALID_COACH_REPLY');
});
