// Each request captures its owning task. Switching views never redirects replies.
import {COACH_OPENING,freshCoachState,normalizeCoachState} from './coach-protocol.js';
import {normalizeHighlights} from './message-presentation.js';
export const STORAGE_KEY='tanxun.tasks.v1';
const interruptedOpening='上次连接已中断。点击输入框右侧箭头重试连接。';
const titleFor=task=>task.messages.find(message=>message.role==='user'&&!['mode','confirm'].includes(message.action))?.content||(!task.pending?.action?task.pending?.content:null);

// randomUUID is HTTPS-only; getRandomValues also works on a plain HTTP IP.
export function createId(cryptoSource=globalThis.crypto){
  if(typeof cryptoSource.randomUUID==='function')return cryptoSource.randomUUID();
  const bytes=cryptoSource.getRandomValues(new Uint8Array(16));
  bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

const validTime=value=>Number.isFinite(value)&&value>=0&&value<=8640000000000000?value:null;
const validDuration=value=>Number.isFinite(value)&&value>=0?value:null;
const validMode=value=>['choice','open'].includes(value)?value:null;
const validAction=value=>['mode','choice','confirm'].includes(value)?value:null;
const segmentOf=value=>typeof value?.segmentId==='string'&&value.segmentId.length<=100?value.segmentId:'initial';
export function historyForReply(messages,coachState){
  const clean=messages.map(({role,content})=>({role,content}));
  if(!normalizeCoachState(coachState)?.notes.surfaceRequest)return clean;
  // Keep full browser history; send a bounded recent window with factual memory.
  const recent=clean.slice(-20);let total=recent.reduce((n,m)=>n+m.content.length,0);
  while(recent.length>1&&total>30000)total-=recent.shift().content.length;
  return recent;
}
function restoreTask(value,version){
  if(!value||typeof value.id!=='string'||!Array.isArray(value.messages))return null;
  if(value.messages.length>2001)return null;
  const validMessage=(message,role)=>['user','assistant'].includes(message?.role)&&(!role||message.role===role)&&typeof message.content==='string'&&message.content.trim()&&message.content.length<=6000;
  if(!value.messages.every(message=>validMessage(message)))return null;
  if(version===1&&(value.messages.length>0&&value.messages.length%2!==1||!value.messages.every((message,index)=>validMessage(message,index%2?'user':'assistant'))))return null;
  const ids=new Set();
  const restoreMessage=(message,index)=>{
    let id=typeof message.id==='string'&&message.id&&!ids.has(message.id)?message.id:`${value.id}:message:${index}`;
    while(ids.has(id))id+='-';ids.add(id);
    return {id,...message.segmentId?{segmentId:segmentOf(message)}:{},...message.unsent===true?{unsent:true}:{},role:message.role,content:message.content,createdAt:validTime(message.createdAt),processingMs:message.role==='assistant'?validDuration(message.processingMs):null,
      ...message.role==='assistant'?{highlights:normalizeHighlights(message.content,message.highlights)}:{},
      ...validMode(message.interactionMode)?{interactionMode:message.interactionMode}:{},
      ...normalizeCoachState(message.coachState)?{coachState:normalizeCoachState(message.coachState)}:{},
      ...message.preserveDraft===true?{preserveDraft:true}:{},...validAction(message.action)?{action:message.action}:{},
      ...message.interrupted===true?{interrupted:true}:{},
      ...typeof message.draftContent==='string'?{draftContent:message.draftContent.slice(0,4000)}:{}};
  };
  const messages=value.messages.map(restoreMessage);
  // Migrate old histories once; explicit links keep later deletions unambiguous.
  let precedingUser=null;
  messages.forEach((message,index)=>{
    if(message.role==='user'){precedingUser=message.id;return;}
    const original=value.messages[index];
    message.replyToId=Object.hasOwn(original,'replyToId')
      ? messages.some(item=>item.role==='user'&&item.id===original.replyToId)?original.replyToId:null
      : precedingUser;
  });
  const connected=messages.length>0||version===2&&value.connected===true;
  const pending=connected&&validMessage(value.pending,'user')?restoreMessage(value.pending,'pending'):null;
  const queued=connected&&validMessage(value.queued,'user')?restoreMessage(value.queued,'queued'):null;
  const stopped=value.stopped===true||!!pending&&(value.paused===true||value.waiting===true);
  const openingError=!connected&&(value.openingError===true||value.waiting===true);
  return {
    id:value.id,number:Number.isSafeInteger(value.number)&&value.number>0?value.number:1,
    customTitle:typeof value.customTitle==='string'?value.customTitle.trim().replace(/\s+/g,' ').slice(0,60):'',archived:value.archived===true,
    messages,pending,queued,stopped,segmentId:segmentOf(value),connected,waiting:false,openingError,
    draft:typeof value.draft==='string'&&value.draft?value.draft.slice(0,4000):pending?.draftContent||'',
    error:value.waiting?(pending?'':interruptedOpening):typeof value.error==='string'?value.error:'',
    mode:value.mode==='live'?'live':'mock',unread:value.unread===true,
    interactionMode:validMode(value.interactionMode),requiresInteractionMode:false,
    coachState:normalizeCoachState(value.coachState),
    // Ignore legacy per-question selection; open answers cover the whole round.
    scrollTop:Number.isFinite(value.scrollTop)?Math.max(0,value.scrollTop):0,
  };
}

export class TaskStore{
  constructor({reply,storage=null,id=createId,messageId=createId,now=()=>Date.now(),onChange=()=>{}}){
    this.reply=reply;this.storage=storage;this.makeId=id;this.makeMessageId=messageId;this.now=now;this.onChange=onChange;
    this.tasks=[];this.activeId=null;this.newDraft='';this.nextNumber=1;this.storageWarning='';
    this.requests=new Map();
    try{
      const raw=storage?.getItem(STORAGE_KEY);
      if(raw){
        const data=JSON.parse(raw);
        if(![1,2].includes(data.version)||!Array.isArray(data.tasks))throw new Error('Invalid saved tasks');
        const ids=new Set();
        this.tasks=data.tasks.map(value=>restoreTask(value,data.version)).filter(task=>task&&!ids.has(task.id)&&ids.add(task.id));
        this.activeId=data.activeId===null?null:this.tasks.some(task=>task.id===data.activeId)?data.activeId:this.tasks[0]?.id||null;
        this.newDraft=typeof data.newDraft==='string'?data.newDraft.slice(0,4000):'';
        this.nextNumber=Math.max(0,...this.tasks.map(task=>task.number))+1;
      }
      if(!storage)this.storageWarning='浏览器未开启本地保存，任务仅在本次打开期间保留。';
    }catch{this.storageWarning='暂时无法读取本地任务，新对话仍可正常使用。';}
  }
  get active(){return this.tasks.find(task=>task.id===this.activeId);}
  getTask(id){return this.tasks.find(task=>task.id===id);}
  getMessage(id,messageId){const task=this.getTask(id);return task?.messages.find(message=>message.id===messageId)||(task?.pending?.id===messageId?task.pending:undefined);}
  newMessage(message,processingMs=null){return {id:this.makeMessageId(),role:message.role,content:message.content,createdAt:this.now(),processingMs:message.role==='assistant'?validDuration(processingMs):null,...message.role==='assistant'?{replyToId:message.replyToId||null,highlights:normalizeHighlights(message.content,message.highlights)}:{},...validMode(message.interactionMode)?{interactionMode:message.interactionMode}:{},...normalizeCoachState(message.coachState)?{coachState:normalizeCoachState(message.coachState)}:{}};}
  title(task){
    if(!task)return '新对话';
    if(task.customTitle)return task.customTitle;
    const topic=titleFor(task)?.replace(/\s+/g,' ').trim();
    return topic?Array.from(topic).slice(0,18).join('')+(Array.from(topic).length>18?'…':''):`新的探询 ${task.number}`;
  }
  save(){
    if(!this.storage)return true;
    try{
      this.storage.setItem(STORAGE_KEY,JSON.stringify({version:2,activeId:this.activeId,newDraft:this.newDraft,tasks:this.tasks}));
      this.storageWarning='';return true;
    }catch{this.storageWarning='本地保存暂不可用，请保持页面打开，避免丢失这次对话。';return false;}
  }
  changed(task,reason='conversation'){this.save();this.onChange(task?.id,reason);}
  startNew(){
    // A landing page has no task ID, history entry or model request.
    this.activeId=null;this.save();this.onChange(null,'new');
  }
  createTask({connected=false}={}){
    const task={id:this.makeId(),number:this.nextNumber++,customTitle:'',archived:false,messages:[],pending:null,queued:null,stopped:false,draft:'',waiting:false,connected,openingError:false,error:'',mode:'mock',interactionMode:null,requiresInteractionMode:false,scrollTop:0,unread:false};
    this.tasks.push(task);this.activeId=task.id;this.changed(task);return task.id;
  }
  async beginCoach(mode){
    if(this.activeId!==null||!validMode(mode))return false;
    const draft=this.newDraft,id=this.createTask({connected:true}),task=this.getTask(id);
    task.draft=draft;this.newDraft='';task.coachState=freshCoachState();task.requiresInteractionMode=true;
    task.messages=[this.newMessage({role:'assistant',content:COACH_OPENING,coachState:task.coachState})];
    this.changed(task);
    return this.changeInteractionMode(id,mode);
  }
  switchTask(id){
    const task=this.getTask(id);if(!task)return false;
    this.activeId=id;task.unread=false;this.changed(task);return true;
  }
  selectInteractionMode(id,mode){
    const task=this.getTask(id);if(!task||task.archived||task.waiting||!validMode(mode))return false;
    const previous={interactionMode:task.interactionMode,requiresInteractionMode:task.requiresInteractionMode};
    task.interactionMode=mode;task.requiresInteractionMode=false;
    if(!this.save()){Object.assign(task,previous);this.onChange(id,'metadata');return false;}
    this.onChange(id,'mode');return true;
  }
  async changeInteractionMode(id,mode){
    const task=this.getTask(id);if(!task||task.waiting||task.stopped||task.archived||!validMode(mode))return false;
    if(task.interactionMode===mode&&!task.requiresInteractionMode)return true;
    const initial=!task.interactionMode;
    if(!this.selectInteractionMode(id,mode))return false;
    const name=mode==='choice'?'选项辅助':'自由表达';
    await this.submit(id,initial?`我选择${name}。`:`请切换为${name}，保留我们已经聊过的内容。`,{preserveDraft:true,action:'mode'});
    return !task.error;
  }
  retryAction(id){
    const task=this.getTask(id),pending=task?.pending;
    if(!pending||!task.error||task.waiting||task.archived)return;
    return this.resume(id);
  }
  renameTask(id,name){
    const task=this.getTask(id);if(!task||typeof name!=='string')return false;
    name=name.trim().replace(/\s+/g,' ');if(!name||name.length>60)return false;
    task.customTitle=name;this.changed(task,'metadata');return true;
  }
  archiveTask(id){
    const task=this.getTask(id);if(!task||task.archived)return false;
    if(!this.tasks.some(item=>item.id!==id&&!item.archived))return false;
    task.archived=true;
    if(this.activeId===id)this.activeId=[...this.tasks].reverse().find(item=>!item.archived)?.id||null;
    this.changed(task,'archive');return true;
  }
  restoreTask(id){
    const task=this.getTask(id);if(!task||!task.archived)return false;
    task.archived=false;this.changed(task,'archive');return true;
  }
  deleteTask(id){
    const task=this.getTask(id);if(!task?.archived)return false;
    const previousTasks=this.tasks,previousActiveId=this.activeId;
    this.tasks=this.tasks.filter(item=>item.id!==id);
    if(this.activeId===id){
      const remaining=[...this.tasks].reverse();
      this.activeId=(remaining.find(item=>item.archived)||remaining.find(item=>!item.archived))?.id||null;
    }
    // Persist before reporting success; failed storage must not look like deletion.
    if(!this.save()){
      this.tasks=previousTasks;this.activeId=previousActiveId;this.onChange(id,'metadata');return false;
    }
    this.cancelRequest(id);
    this.onChange(id,'delete');return true;
  }
  deleteMessage(id,messageId){
    return this.deleteMessages(id,[messageId]);
  }
  deletionMessageIds(id,messageIds){
    const task=this.getTask(id);if(!task||!Array.isArray(messageIds))return [];
    const requested=new Set(messageIds),messages=task.pending?[...task.messages,task.pending]:task.messages;
    const users=new Set(messages.filter(message=>message.role==='user'&&requested.has(message.id)).map(message=>message.id));
    return messages.filter(message=>requested.has(message.id)||message.role==='assistant'&&users.has(message.replyToId)).map(message=>message.id);
  }
  deleteMessages(id,messageIds){
    const task=this.getTask(id);if(!task||task.waiting)return false;
    const removed=new Set(this.deletionMessageIds(id,messageIds));if(!removed.size)return false;
    const previous={messages:task.messages,pending:task.pending,draft:task.draft,error:task.error,coachState:task.coachState};
    if(task.pending&&removed.has(task.pending.id)){
      if(!task.pending.preserveDraft&&task.draft===task.pending.content)task.draft='';
      task.pending=null;task.error='';
    }
    // Later snapshots can contain facts from deleted turns: invalidate all of them.
    task.messages=task.messages.filter(message=>!removed.has(message.id)).map(({coachState,...message})=>message);
    task.coachState=null;
    if(!this.save()){Object.assign(task,previous);this.onChange(id,'metadata');return false;}
    this.onChange(id,'message-delete');return true;
  }
  branchTask(id,messageId){
    const source=this.getTask(id),message=this.getMessage(id,messageId);if(!source||!message)return null;
    const index=source.messages.findIndex(item=>item.id===messageId);
    const end=index<0?source.messages.length:index+(message.role==='assistant'?1:0);
    const prefix=source.messages.slice(0,end).map(item=>({...item,...item.coachState?{coachState:normalizeCoachState(item.coachState)}:{}}));
    const segmentId=segmentOf(message);
    const snapshot=[...prefix].reverse().find(item=>segmentOf(item)===segmentId&&item.coachState)?.coachState;
    const task={id:this.makeId(),number:this.nextNumber++,customTitle:this.title(source).slice(0,54)+' · 继续',archived:false,
      messages:prefix,segmentId,coachState:normalizeCoachState(snapshot),pending:null,queued:null,stopped:false,draft:message.role==='user'?message.content:'',
      waiting:false,connected:true,openingError:false,error:'',mode:source.mode,interactionMode:source.interactionMode,requiresInteractionMode:source.requiresInteractionMode,scrollTop:0,unread:false};
    this.tasks.push(task);this.activeId=task.id;this.changed(task);return task.id;
  }
  setDraft(value){if(this.active)this.active.draft=value;else this.newDraft=value;this.save();}
  setScroll(top){if(this.active)this.active.scrollTop=Math.max(0,top);}
  cancelRequest(id){
    const request=this.requests.get(id);this.requests.delete(id);request?.controller.abort();
  }
  stop(id){
    const task=this.getTask(id);if(!task?.waiting||!task.pending)return false;
    this.cancelRequest(id);task.waiting=false;task.stopped=true;task.error='';this.changed(task,'stop');return true;
  }
  stopAll(){for(const task of this.tasks)this.stop(task.id);this.save();}
  resume(id){
    const task=this.getTask(id);if(!task?.pending||task.waiting||task.archived||task.stopped)return Promise.resolve(false);
    return this.runPending(task);
  }
  queueMessage(id,content){
    const task=this.getTask(id);content=String(content||'').trim();
    if(!task?.waiting||task.archived||task.stopped||task.queued||!content||content.length>4000)return false;
    const draft=task.draft;task.queued={...this.newMessage({role:'user',content}),segmentId:segmentOf(task)};task.draft='';
    if(!this.save()){task.queued=null;task.draft=draft;this.onChange(id,'queue');return false;}
    this.onChange(id,'queue');return true;
  }
  cancelQueued(id){
    const task=this.getTask(id);if(!task?.queued)return false;
    const queued=task.queued;task.queued=null;
    if(!this.save()){task.queued=queued;this.onChange(id,'queue');return false;}
    this.onChange(id,'queue');return true;
  }
  sendQueued(id){
    const task=this.getTask(id);if(!task?.queued||task.waiting||task.pending||task.archived||task.stopped)return false;
    task.pending={...task.queued,preserveDraft:true};task.queued=null;void this.runPending(task);return true;
  }
  interruptAndSubmit(id,content){
    const task=this.getTask(id);content=String(content||'').trim();
    if(!task||task.archived||!content||content.length>4000)return Promise.resolve(false);
    if(task.stopped)return this.submit(id,content);
    this.cancelRequest(id);task.waiting=false;
    // Keep the interrupted question, but never invent an answer or commit stale notes.
    if(task.pending){task.messages.push({...task.pending,interrupted:true});task.pending=null;}
    return this.submit(id,content);
  }
  async connect(id){
    const task=this.getTask(id);if(!task||task.waiting||task.connected||task.archived)return;
    task.waiting=true;task.openingError=false;task.error='';this.changed(task);
    const request={controller:new AbortController()};this.requests.set(id,request);
    const current=()=>this.getTask(id)===task&&this.requests.get(id)===request;
    try{
      const result=await this.reply([],{interactionMode:task.interactionMode,signal:request.controller.signal});if(!current())return;
      task.coachState=normalizeCoachState(result.coachState);
      task.messages=[this.newMessage({...result.message,interactionMode:task.interactionMode,coachState:task.coachState},result.processingMs)];task.connected=true;task.mode=result.mode;
      task.requiresInteractionMode=result.requiresInteractionMode===true;
    }catch(error){if(!current())return;task.openingError=true;task.error=`${error.message} 点击输入框右侧箭头重试连接。`;}
    finally{if(current()){this.requests.delete(id);task.waiting=false;this.changed(task);}}
  }
  async submit(id,content,{preserveDraft=false,action=null}={}){
    if(id===null&&this.activeId===null){
      content=content.trim();if(!content)return;
      this.newDraft='';id=this.createTask({connected:true});
    }
    let task=this.getTask(id);if(!task||task.waiting||task.archived)return;
    if(task.stopped){
      content=content.trim();if(!content||preserveDraft||action)return;
      // Keep the visible transcript, but start an isolated model context in-place.
      if(task.pending)task.messages.push({...task.pending,interrupted:true});
      if(task.queued)task.messages.push({...task.queued,unsent:true});
      task.pending=null;task.queued=null;task.stopped=false;
      task.segmentId=this.makeMessageId();task.coachState=null;
      task.interactionMode=null;task.requiresInteractionMode=false;
    }
    if(task.requiresInteractionMode&&!task.interactionMode)return;
    if(!task.connected)return this.connect(id);
    content=content.trim();if(!content)return;
    task.pending={...this.newMessage({role:'user',content}),segmentId:segmentOf(task),...preserveDraft?{preserveDraft:true}:{},...validAction(action)?{action}:{}};
    if(!preserveDraft)task.draft='';
    return this.runPending(task);
  }
  async runPending(task){
    const id=task.id,pending=task.pending;if(!pending||task.waiting||task.stopped)return false;
    const request={controller:new AbortController()};this.requests.set(id,request);
    const current=()=>this.getTask(id)===task&&this.requests.get(id)===request;
    task.error='';task.waiting=true;this.changed(task);
    const requestedMode=task.interactionMode;
    const messages=historyForReply([...task.messages,pending].filter(message=>!message.unsent&&segmentOf(message)===segmentOf(task)),task.coachState);
    let succeeded=false;
    try{
      const result=await this.reply(messages,{interactionMode:requestedMode,coachState:normalizeCoachState(task.coachState),action:validAction(pending.action),signal:request.controller.signal});
      if(!current())return false;
      if(result.coachState){const state=normalizeCoachState(result.coachState);if(!state)throw new Error('没有收到完整的对话状态。');task.coachState=state;}
      const returnedMode=validMode(result.interactionMode)||requestedMode;
      task.interactionMode=returnedMode;
      task.messages.push({...pending},{...this.newMessage({...result.message,replyToId:pending.id,interactionMode:returnedMode,coachState:task.coachState},result.processingMs),segmentId:segmentOf(task)});task.pending=null;task.mode=result.mode;
      task.requiresInteractionMode=result.requiresInteractionMode===true;
      task.unread=this.activeId!==id;
      succeeded=true;
    }catch(error){
      if(!current())return false;
      if(!pending.preserveDraft&&!task.draft)task.draft=pending.content;
      task.error=`${error.message} ${pending.action==='mode'?'这轮模式切换尚未完成。 ':''}消息和草稿已保留，可以重试本条。`;
    }finally{
      if(current()){
        this.requests.delete(id);task.waiting=false;this.changed(task);
        if(succeeded&&task.queued&&!task.archived&&!task.stopped){
          this.sendQueued(id);
        }
      }
    }
    return succeeded;
  }
}
