import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runCoachTurn} from '../src/coach-flow.mjs';
import {emptyNotes,freshCoachState,normalizeCoachState,normalizeAssessment,TRACK_CRITERIA} from '../dist/coach-protocol.js';
import {normalizeHighlights,highlightedSegments,answerHighlights,replyParagraphs} from '../dist/message-presentation.js';
import {TaskStore,historyForReply} from '../dist/task-store.js';

const plan=(track='project',covered=['audience'])=>({track,stage:'explore',ready:false,covered,nextFocus:track==='project'?'实际使用过程':'此刻最需要的支持'});
const ask='我们把这个细节说清楚。\n\n他们会在什么情况下打开这个产品？';
function engine(assessment,kind='open',content=ask){
 const calls=[];
 return {calls,reply:async args=>{
  const directive=JSON.parse(args.systemPrompt.split('【本轮流程指令】\n')[1].split('\n')[0]);calls.push({directive,schema:args.responseSchema});
  return {content:JSON.stringify({level:assessment.track==='short'?'L0':'L3',assessment,kind,reply:content,options:[],highlights:[content.split('\n')[0]],notes:{...emptyNotes(),surfaceRequest:'帮孩子整理提问的产品',facts:['使用者是初中生']},core:''})};
 }};
}
const turn=(state,text,reply)=>runCoachTurn({coachState:state,interactionMode:state.mode,messages:[{role:'user',content:text}],config:{useMock:false},reply});

test('project exploration continues past three turns based on unfilled criteria',async()=>{
 let state=freshCoachState('open','question');state.notes.surfaceRequest='一个产品';state.assessment=normalizeAssessment(plan());
 const {reply,calls}=engine(plan());
 for(let i=0;i<7;i++){const r=await turn(state,'这一点还没有定',reply);state=r.coachState;assert.equal(state.phase,'question');}
 assert.equal(state.rounds,7);assert.ok(state.assessment.missing.includes('validation'));assert.equal(state.assessment.ready,false);
 assert.ok(calls.every(c=>c.directive.purpose==='adaptive'&&c.schema.schema.properties.kind.enum.includes('open')));
 assert.equal(normalizeCoachState(JSON.parse(JSON.stringify(state))).rounds,7);
});

test('support can continue listening and a requested response remains provisional',async()=>{
 const state=freshCoachState(null,'question');state.rounds=8;state.assessment=normalizeAssessment(plan('support',['experience']));
 const listened=await turn(state,'我还想说说这件事',engine(plan('support',['experience']),'open','听起来你一直很不好受，我们不用急。\n\n今天哪一刻最难熬？').reply);
 assert.equal(listened.coachState.phase,'question');assert.equal(listened.coachState.assessment.track,'support');
 const response=await turn(listened.coachState,'现在给我一个能试试的办法',engine({...plan('support',['experience']),stage:'work'},'answer','先给自己一点缓冲。\n\n找一位愿意听你说话的人，告诉他你现在希望被听见。').reply);
 assert.equal(response.coachState.phase,'answer');assert.equal(response.coachState.assessment.ready,false);assert.equal(response.coachState.assessment.stage,'work');
});

test('a complete project can deliver a detailed answer and literal highlights without confirming a summary',async()=>{
 const state=freshCoachState(null,'question');state.assessment=normalizeAssessment(plan());
 const complete={...plan('project',TRACK_CRITERIA.project),ready:true,stage:'deliver',nextFocus:''};
 const content='先做好一个完整使用流程。\n\n'+'每一步都要让真实使用者能说清楚下一步，遇到困难时记下具体场景。'.repeat(18);
 const r=await turn(state,'范围、资源和试用标准都明确了',engine(complete,'answer',content).reply);
 assert.equal(r.message.content,content);assert.equal(r.coachState.assessment.ready,true);assert.equal(r.coachState.assessment.stage,'deliver');assert.equal(r.coachState.phase,'answer');
 assert.deepEqual(r.message.highlights,['先做好一个完整使用流程。']);assert.doesNotMatch(r.message.content,/POPUP|确认小结/);
 const incomplete=normalizeAssessment({...complete,covered:['audience']});assert.equal(incomplete.ready,false);assert.equal(incomplete.stage,'work');
});

test('temporary knowledge questions preserve a long project plan and facts',async()=>{
 const state=freshCoachState('choice','question');state.rounds=6;state.assessment=normalizeAssessment(plan());state.notes.facts=['用户是学生'];
 const r=await turn(state,'1+1等于多少？',engine({track:'short',stage:'deliver',covered:['question'],ready:true,nextFocus:''},'answer','1 + 1 = 2。').reply);
 assert.equal(r.message.content,'1 + 1 = 2。');assert.deepEqual(r.coachState.assessment,state.assessment);assert.deepEqual(r.coachState.notes,state.notes);assert.equal(r.coachState.rounds,6);
 const old={...state};delete old.assessment;assert.equal(normalizeCoachState(old).assessment,null);
 assert.equal(normalizeAssessment({...plan(),covered:['diagnosis']}),null);
});

test('highlighting preserves text, ignores absent phrases and handles overlaps as literal text',()=>{
 const text='先确定使用者，再明确使用者遇到的问题。<img src=x onerror=alert(1)>';
 const parts=highlightedSegments(text,['先确定使用者','使用者','不存在','<img src=x onerror=alert(1)>']);
 assert.equal(parts.map(p=>p.text).join(''),text);assert.equal(parts.filter(p=>p.marked).length,2);
 assert.deepEqual(normalizeHighlights(text,['不存在',null,'使用者','使用者']),['使用者']);
});

test('long provider answers missing literal highlights use their short headings without painting paragraphs',async()=>{
 const content='第一部分：首版使用流程\n'+('先让使用者表达具体问题，再回应最重要的一个卡点。'.repeat(6))+'\n\n第二部分：怎样验证\n'+('观察是否能讲清问题，不预设一定成功。'.repeat(6));
 assert.deepEqual(answerHighlights(content,[]),['第一部分：首版使用流程','第二部分：怎样验证']);
 assert.deepEqual(answerHighlights(content,['不是原文']),['第一部分：首版使用流程','第二部分：怎样验证']);
 assert.deepEqual(answerHighlights('1 + 1 = 2。',[]),[]);
 const state=freshCoachState(null,'question'),model=engine(plan(),'answer',content);
 const r=await turn(state,'直接给我一份方案',async args=>{const reply=await model.reply(args),body=JSON.parse(reply.content);body.highlights=[];return {content:JSON.stringify(body)};});
 assert.deepEqual(r.message.highlights,['第一部分：首版使用流程','第二部分：怎样验证']);
 assert.equal(highlightedSegments(r.message.content,r.message.highlights).map(p=>p.text).join(''),content);
});

test('support replies with single line breaks retain readable paragraphs and short literal emphasis',()=>{
 const content='你现在不用硬逼着自己马上从这种不安里走出来，也不用勉强自己立刻变成一个不紧张的人。\n今天回家之后，你可以先给自己留一段十几分钟的缓冲时间。找一件自己觉得轻松的小事做，不需要马上整理好一切，也不用为了放松再给自己列出新的任务。\n接下来你也不用刻意逼自己彻底放空，如果脑子里又飘过白天的事，不用急着把它推开。可以先记下来，再分辨有没有今晚一定要处理的事，其余的明天再看看。\n明天你还可以找那位信任的朋友说一说，不用提前把话都编排好，想到哪儿说到哪儿就好。也可以告诉朋友，这次你希望他先听一听，不用马上给建议。';
 const marks=answerHighlights(content,[]),paragraphs=replyParagraphs(content);
 assert.equal(paragraphs.length,4);assert.equal(paragraphs.join('\n'),content);assert.equal(marks.length,3);
 assert.ok(marks.every(m=>m.length<=40&&content.includes(m)&&!m.includes('\n')));
 assert.equal(paragraphs.flatMap(p=>highlightedSegments(p,marks)).map(p=>p.text).join(''),content.replace(/\n/g,''));
});

test('long history is retained locally while requests carry recent text and saved criteria',async()=>{
 const state=freshCoachState(null,'question');state.notes.surfaceRequest='项目';state.assessment=normalizeAssessment(plan());
 const history=Array.from({length:220},(_,i)=>({role:i%2?'assistant':'user',content:'项目记录'+i+'。'.repeat(1600),id:String(i)}));
 const recent=historyForReply(history,state);assert.ok(recent.length<=20);assert.ok(recent.reduce((n,m)=>n+m.content.length,0)<=30000);assert.equal(recent.at(-1).content,history.at(-1).content);assert.equal(history.length,220);
 assert.equal(historyForReply(history,null).length,220); // deletion invalidation cannot reuse stale facts
 const data={version:2,activeId:'project',tasks:[{id:'project',messages:history,coachState:state,connected:true}]};
 const storage={value:JSON.stringify(data),getItem(){return this.value;},setItem(_k,v){this.value=v;}};
 const store=new TaskStore({storage,reply:()=>{throw new Error('not needed');}});assert.equal(store.active.messages.length,220);assert.deepEqual(store.active.coachState.assessment,state.assessment);
});

test('assessment and highlights survive reload and branch, and deletion invalidates the plan',async()=>{
 const storage={value:null,getItem(){return this.value;},setItem(_k,v){this.value=v;}};
 const reply=async(messages,options)=>runCoachTurn({...options,messages,config:{useMock:false},reply:engine(plan(),'open',ask).reply});
 const store=new TaskStore({storage,reply});await store.submit(null,'我想做个帮助孩子提问的产品');const id=store.activeId,first=store.active.messages.at(-1);
 const restored=new TaskStore({storage,reply});assert.deepEqual(restored.active.messages.at(-1).highlights,first.highlights);assert.deepEqual(restored.active.coachState.assessment,store.active.coachState.assessment);
 const branch=restored.branchTask(id,first.id);assert.deepEqual(restored.getTask(branch).coachState.assessment,store.active.coachState.assessment);
 restored.deleteMessage(id,restored.getTask(id).messages[0].id);assert.equal(restored.getTask(id).coachState,null);assert.ok(restored.getTask(branch).coachState.assessment);
});
