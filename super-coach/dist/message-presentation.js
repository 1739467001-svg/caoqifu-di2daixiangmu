// Highlight only literal substrings of the reply. No HTML/Markdown is evaluated.
export function normalizeHighlights(content,values){
  if(typeof content!=='string'||!Array.isArray(values))return [];
  return [...new Set(values.filter(v=>typeof v==='string').map(v=>v.trim()).filter(v=>v.length>=2&&v.length<=80&&!v.includes('\n')&&content.includes(v)))].slice(0,6);
}
// Long replies still get readable emphasis if the provider omits usable phrases.
// Select literal short headings first; never rewrite a sentence or mark a whole paragraph.
export function answerHighlights(content,values){
  const valid=normalizeHighlights(content,values);
  if(valid.length||content.length<240)return valid;
  const paragraphs=content.split(/\n+/u).map(p=>p.trim()).filter(Boolean);
  const headings=paragraphs.map(p=>p.split('\n')[0].trim()).filter(line=>line.length>=4&&line.length<=40&&!/[。！？!?，,]/u.test(line));
  if(headings.length)return normalizeHighlights(content,headings.slice(0,4));
  const phrases=paragraphs.map(p=>p.split(/[，,。！？!?；;]/u).map(s=>s.trim()).find(s=>s.length>=8&&s.length<=40)).filter(Boolean);
  return normalizeHighlights(content,phrases.slice(0,3));
}
export const replyParagraphs=content=>content.split(/\n+/u).map(p=>p.trim()).filter(Boolean);
export function highlightedSegments(content,values){
  const ranges=normalizeHighlights(content,values).map(text=>({start:content.indexOf(text),end:content.indexOf(text)+text.length})).sort((a,b)=>a.start-b.start||b.end-a.end);
  const result=[];let cursor=0;
  for(const range of ranges){
    if(range.start<cursor)continue;
    if(range.start>cursor)result.push({text:content.slice(cursor,range.start),marked:false});
    result.push({text:content.slice(range.start,range.end),marked:true});cursor=range.end;
  }
  if(cursor<content.length)result.push({text:content.slice(cursor),marked:false});
  return result;
}
