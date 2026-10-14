// Present questions already written by the coach. Never invent or execute content.
import {splitPopup} from './coach-protocol.js';
const plainLine=value=>value.trim().replace(/\*\*([^*]+)\*\*/gu,'$1');
const optionLine=/^\s*(?:[-*]\s+)?([A-ZＡ-Ｚ])[.．、:：)）]\s*(.+)$/u;
const numberedLine=/^\s*(?:\d{1,2}[.．、)）]|[①②③④⑤⑥⑦⑧⑨⑩])\s*(.+)$/u;
const questionText=value=>plainLine(value).replace(/^\d{1,2}[.．、)）]\s*/u,'');

export function getReplyPrompts(message,mode){
  if(message?.role!=='assistant'||typeof message.content!=='string')return null;
  const kind=message.coachState?.replyKind;
  if(!kind&&message.interactionMode&&message.interactionMode!==mode)return null;
  if(kind==='answer'||['L0','L1'].includes(message.coachState?.level)||['checkpoint','final','finished'].includes(message.coachState?.phase))return null;
  const parts=splitPopup(message.content);
  if(!parts.valid)return null;
  if(parts.popup&&!/[A-ZＡ-Ｚ][.．、:：)）]\s*\S/u.test(parts.popup))return null;
  let content=(parts.popup?[parts.text,parts.popup].join('\n'):message.content).replace(/\*\*([^*]+)\*\*/gu,'$1').replace(/\r\n/g,'\n');
  if(kind)mode=kind;
  else if(parts.popup)mode='choice';
  const lines=content.split('\n').map(plainLine).filter(Boolean);
  if(mode==='choice'){
    // Accept both line-separated and inline A/B options; preserve wrapped wording.
    const markers=[...content.matchAll(/(?:^|[\n\t ])(?:[-*]\s*)?[（(]?([A-ZＡ-Ｚ])[.．、:：)）]\s*/gu)];
    if(markers.length<2)return null;
    const options=[];
    for(let index=0;index<markers.length;index++){
      const match=markers[index],letter=String.fromCharCode(match[1].charCodeAt(0)-(match[1]>='Ａ'?0xfee0:0));
      if(letter.charCodeAt(0)!==65+index)return null;
      const start=match.index+match[0].length,end=markers[index+1]?.index??content.length;
      const text=content.slice(start,end).trim();if(!text)return null;
      options.push({key:letter,label:letter,text,draft:letter+'. '+text,.../^其他[，,、]?\s*我自己说[。！!]?$/u.test(text)?{requiresText:true}:{}});
    }
    const preceding=content.slice(0,markers[0].index);
    const question=[...preceding.matchAll(/[^\n。！？!?]+[？?]/gu)].at(-1)?.[0]?.trim();
    const invitation=preceding.trim().match(/[^\n。！？!?]+[：:]$/u)?.[0];
    if(!question&&!invitation)return null;
    return {kind:'choice',title:question||invitation,items:options};
  }
  if(mode==='open'||mode==null){
    if(lines.some(line=>optionLine.test(line)))return null;
    const numbered=lines.map(line=>line.match(numberedLine)?.[1]).filter(line=>line&&/[？?]/u.test(line));
    const candidates=numbered.length?numbered:lines.filter(line=>/[？?]$/u.test(line)&&!optionLine.test(line));
    const questions=[...new Set(candidates.flatMap(line=>[...line.matchAll(/[^。！？!?]+[？?]/gu)].map(match=>questionText(match[0]))))];
    if(!questions.length)return null;
    return {kind:'open',title:'直接说说你的想法',items:questions.map((text,index)=>({key:String(index+1),label:String(index+1),text}))};
  }
  return null;
}

export function addPromptToDraft(current,prompt,previousPrompt=''){
  // Selecting another option replaces only the inserted prefix, never free text.
  let remainder=current;
  if(previousPrompt&&remainder.startsWith(previousPrompt))remainder=remainder.slice(previousPrompt.length).replace(/^\n/u,'');
  if(remainder.startsWith(prompt))return remainder;
  return remainder.trim()?`${prompt}\n${remainder}`:prompt;
}
