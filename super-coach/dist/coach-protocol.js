// Shared wire contract; contains user facts and workflow state, never hidden reasoning.
export const COACH_OPENING='你好，我是探询，你的思考教练。我们可以一起把问题说清楚，再找到能动手做的办法。\n你现在最想解决的是什么事？';
export const TOPIC_PROMPT='好，那先用一两句话告诉我：你现在想理清的是什么事？';
export const NOTE_FIELDS=['surfaceRequest','facts','unclear','contradictions','themes','askedAngles'];
// Factual coverage labels, not hidden reasoning or a user-facing questionnaire.
export const TRACK_CRITERIA={
  short:['question'],
  medium:['goal','situation','constraints','attempts'],
  project:['audience','problem','scenario','outcome','scope','constraints','validation'],
  support:['experience','impact','need','support']
};
export function normalizeAssessment(value){
  if(!value||!Object.hasOwn(TRACK_CRITERIA,value.track)||!['explore','work','deliver'].includes(value.stage)||typeof value.ready!=='boolean'||typeof value.nextFocus!=='string'||value.nextFocus.length>160)return null;
  const criteria=TRACK_CRITERIA[value.track];
  if(!Array.isArray(value.covered)||value.covered.length>8||value.covered.some(key=>!criteria.includes(key)))return null;
  const covered=[...new Set(value.covered)],missing=criteria.filter(key=>!covered.includes(key));
  // A project can have a useful partial answer while its requirements are still open.
  const ready=value.ready&&(value.track!=='project'||missing.length===0);
  return {track:value.track,stage:value.stage==='deliver'&&!ready?'work':value.stage,ready,covered,missing,nextFocus:value.nextFocus};
}
export function emptyNotes(){return {surfaceRequest:'',facts:[],unclear:[],contradictions:[],themes:[],askedAngles:[],missedGuesses:[],reminders:[]};}
export function normalizeNotes(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.surfaceRequest!=='string'||value.surfaceRequest.length>400)return null;
  const notes={surfaceRequest:value.surfaceRequest};
  for(const key of NOTE_FIELDS.slice(1)){
    if(!Array.isArray(value[key])||value[key].length>12||value[key].some(item=>typeof item!=='string'||!item.trim()||item.length>240))return null;
    notes[key]=[...new Set(value[key].map(item=>item.trim()))];
  }
  for(const key of ['missedGuesses','reminders']){
    const items=value[key]??[];if(!Array.isArray(items)||items.length>(key==='reminders'?100:12)||items.some(item=>typeof item!=='string'||item.length>(key==='reminders'?6000:240)))return null;
    notes[key]=[...new Set(items)];
  }
  return notes;
}
export function freshCoachState(mode=null,phase='mode'){
  return {version:1,mode,phase,notes:emptyNotes(),rounds:0,core:'',coreStreak:0,redirects:0,level:'L3',lightRounds:0,replyKind:null,assessment:null};
}
export function normalizeCoachState(value){
  if(!value||value.version!==1||![null,'choice','open'].includes(value.mode)||!['mode','topic','question','answer','checkpoint','final','finished'].includes(value.phase))return null;
  const notes=normalizeNotes(value.notes);if(!notes)return null;
  if(!Number.isInteger(value.rounds)||value.rounds<0||value.rounds>999||!Number.isInteger(value.coreStreak)||value.coreStreak<0||value.coreStreak>100||!Number.isInteger(value.redirects)||value.redirects<0||value.redirects>1||typeof value.core!=='string'||value.core.length>160)return null;
  const level=value.level??'L3',lightRounds=value.lightRounds??0;if(!['L0','L1','L2','L3'].includes(level)||!Number.isInteger(lightRounds)||lightRounds<0||lightRounds>3)return null;
  const replyKind=value.replyKind??null;if(![null,'open','choice','answer'].includes(replyKind))return null;
  const assessment=value.assessment==null?null:normalizeAssessment(value.assessment);if(value.assessment!=null&&!assessment)return null;
  return {version:1,mode:value.mode,phase:value.phase,notes,rounds:value.rounds,core:value.core,coreStreak:value.coreStreak,redirects:value.redirects,level,lightRounds,replyKind,assessment};
}
export function splitPopup(content){
  const text=String(content||'').replace(/\r\n/g,'\n');
  const blocks=[...text.matchAll(/\[POPUP\]([\s\S]*?)\[\/POPUP\]/g)];
  if(blocks.length!==1)return {text:text.replace(/\[\/?POPUP\]/g,''),popup:null,valid:blocks.length===0&&!/\[\/?POPUP\]/.test(text)};
  const match=blocks[0],outside=(text.slice(0,match.index)+text.slice(match.index+match[0].length)).trim();
  return {text:outside,popup:match[1].trim(),valid:!outside.includes('[POPUP]')&&!outside.includes('[/POPUP]')};
}
export function readableMessage(content){const parts=splitPopup(content);return [parts.text,parts.popup].filter(Boolean).join('\n\n');}
