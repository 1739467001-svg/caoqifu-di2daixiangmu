import {TaskStore,STORAGE_KEY} from './task-store.js';

// Transfer only this app's history between its HTTP and HTTPS tabs. Conversation
// text never enters the URL, web server, or clipboard; the HTTP copy is retained.
export function importHistory(storage,raw){
  if(!storage)throw new Error('storage unavailable');
  if(typeof raw!=='string'||raw.length>8_000_000)throw new Error('invalid history');
  const data=JSON.parse(raw);
  if(![1,2].includes(data?.version)||!Array.isArray(data.tasks))throw new Error('invalid history');
  const existing=storage.getItem(STORAGE_KEY);
  if(existing){
    const saved=JSON.parse(existing);
    if(saved.tasks?.length||saved.newDraft)return '安全页面已有对话，继续保留这里的记录；旧网址里的对话也仍然保留。';
  }
  const incoming=new TaskStore({reply:async()=>{},storage:{getItem:()=>raw,setItem:()=>{}}});
  if(incoming.storageWarning||incoming.tasks.length!==data.tasks.length)throw new Error('invalid history');
  storage.setItem(STORAGE_KEY,JSON.stringify({version:2,activeId:incoming.activeId,newDraft:incoming.newDraft,tasks:incoming.tasks}));
  return '原网址的对话已带到安全页面，以后可以在这里继续聊。';
}

export async function receiveUpgrade(storage){
  const url=new URL(location.href);
  if(url.protocol!=='https:'||url.searchParams.get('from-http')!=='1')return '';
  const sourceOrigin='http://'+url.host;
  url.searchParams.delete('from-http');history.replaceState(null,'',url.pathname+url.search+url.hash);
  if(!window.opener)return '安全页面已打开。原网址里的对话仍然保留。';
  const source=window.opener;
  return new Promise(resolve=>{
    const done=message=>{clearTimeout(timer);window.removeEventListener('message',receive);resolve(message);};
    const receive=event=>{
      if(event.source!==source||event.origin!==sourceOrigin||event.data?.type!=='tanxun-upgrade-history')return;
      try{done(importHistory(storage,event.data.history));}
      catch{done('未能带入旧对话，原网址的记录仍然保留，请暂时不要关闭原页面。');}
    };
    const timer=setTimeout(()=>done('未能带入旧对话，原网址的记录仍然保留，请暂时不要关闭原页面。'),10000);
    window.addEventListener('message',receive);
    source.postMessage({type:'tanxun-upgrade-ready'},sourceOrigin);
  });
}

export function openSecurePage(secureOrigin,raw,onNotice){
  const target=new URL(secureOrigin);
  if(location.protocol!=='http:'||target.protocol!=='https:'||target.host!==location.host)return;
  let child;
  const receive=event=>{
    if(!child||event.source!==child||event.origin!==target.origin||event.data?.type!=='tanxun-upgrade-ready')return;
    child.postMessage({type:'tanxun-upgrade-history',history:raw},target.origin);
    window.removeEventListener('message',receive);clearTimeout(timer);
  };
  window.addEventListener('message',receive);
  const timer=setTimeout(()=>window.removeEventListener('message',receive),30000);
  child=window.open(target.origin+'/?from-http=1','_blank');
  if(!child){clearTimeout(timer);window.removeEventListener('message',receive);onNotice('浏览器阻止了新窗口。请允许本站打开新窗口，再点击进入安全页面。');}
  else onNotice('已打开安全页面，原网址的记录仍为你保留。请在新页面点击麦克风。');
}
