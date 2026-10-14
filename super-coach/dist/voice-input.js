// Browser speech only. No audio is uploaded to the coach server or saved here.
// Each listening session owns one draft; callbacks from old sessions are ignored.
export class VoiceInput {
  // Browser timers are Window methods: never call a bare stored reference with
  // the VoiceInput instance as its receiver (WebIDL throws Illegal invocation).
  constructor({Recognition,secureContext,onDraft,onState,onNotice,setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id)}){
    Object.assign(this,{Recognition,secureContext,onDraft,onState,onNotice,setTimer,clearTimer});
    this.session=null;
  }
  get active(){return !!this.session;}
  get contextId(){return this.session?.contextId;}
  start({contextId,text,selectionStart=text.length,selectionEnd=selectionStart,maxLength=4000}){
    if(this.active)return false;
    if(!this.secureContext){this.onNotice('语音输入需要 HTTPS 安全连接，当前网址还不能使用麦克风。','https');return false;}
    if(!this.Recognition){this.onNotice('当前浏览器不支持网页语音输入，请使用输入法键盘上的麦克风。若在微信中打开，也可从右上角菜单选择在浏览器中打开。','unsupported');return false;}
    let recognition;
    try{recognition=new this.Recognition();}catch{this.onNotice('语音服务暂时不可用，请使用文字输入。');return false;}
    const session={recognition,contextId,prefix:text.slice(0,selectionStart),suffix:text.slice(selectionEnd),maxLength,hasText:false,timer:null,state:'starting'};
    this.session=session;
    const current=()=>this.session===session;
    recognition.lang='zh-CN';recognition.continuous=true;recognition.interimResults=true;recognition.maxAlternatives=1;
    recognition.onstart=()=>{
      if(!current()){try{recognition.abort();}catch{}return;}
      if(session.state==='stopping')return;
      this.clearTimer(session.timer);session.state='listening';this.onState('listening');
      this.onNotice('正在听…再次点击麦克风停止，文字确认后再发送。');
      session.timer=this.setTimer(()=>this.stop(),60000);
    };
    recognition.onresult=event=>{
      if(!current())return;
      const final=[],interim=[];
      for(let i=0;i<event.results.length;i++){
        const result=event.results[i],text=result[0]?.transcript||'';
        (result.isFinal?final:interim).push(text);
      }
      const transcript=final.join('');
      if(transcript){
        const remaining=Math.max(0,maxLength-session.prefix.length-session.suffix.length);
        const inserted=transcript.slice(0,remaining).replace(/[\uD800-\uDBFF]$/,'');
        session.hasText=true;
        this.onDraft(session.prefix+inserted+session.suffix,session.prefix.length+inserted.length,contextId);
        if(transcript.length>=remaining){this.stop();this.onNotice('输入框已满，已保留可容纳的文字。');return;}
      }
      if(session.state!=='stopping')this.onNotice(interim.length?'正在听：'+interim.join(''):'正在听…再次点击麦克风停止，文字确认后再发送。');
    };
    recognition.onerror=event=>{
      if(!current())return;
      const messages={
        'not-allowed':'没有获得麦克风权限。请在浏览器的网站权限中允许麦克风，再点击语音按钮。',
        'service-not-allowed':'浏览器没有开放语音识别服务，可换用支持的浏览器或键盘语音输入。',
        'audio-capture':'没有找到可用的麦克风，请检查设备连接及系统麦克风权限。',
        'network':'浏览器的语音服务暂时连接不上，请稍后重试，或使用键盘语音输入。',
        'no-speech':'没有听清，点击麦克风再试一次。',
        'language-not-supported':'当前浏览器暂不支持中文语音识别，请使用键盘语音输入。',
        'aborted':'语音输入已停止，已识别的文字保留在输入框。',
      };
      this.finish(session,messages[event.error]||'语音识别没有完成，已识别的文字仍保留在输入框。',true);
    };
    recognition.onend=()=>{if(current())this.finish(session,session.hasText?'已转为文字，你可以修改后发送。':'没有听到内容，点击麦克风再试一次。');};
    this.onState('starting');this.onNotice('请允许麦克风权限，正在准备语音输入…');
    session.timer=this.setTimer(()=>this.finish(session,'未能启动麦克风，请检查浏览器权限后重试。',true),15000);
    try{recognition.start();return true;}catch{this.finish(session,'语音输入未能启动，请检查麦克风权限后重试。',true);return false;}
  }
  stop(){
    const session=this.session;if(!session||session.state==='stopping')return;
    if(session.state==='starting'){this.cancel();this.onNotice('已取消语音输入。');return;}
    session.state='stopping';this.clearTimer(session.timer);this.onState('stopping');this.onNotice('正在整理文字…');
    session.timer=this.setTimer(()=>this.finish(session,'已停止，已识别的文字保留在输入框。',true),2500);
    try{session.recognition.stop();}catch{this.finish(session,'已停止，已识别的文字保留在输入框。',true);}
  }
  finish(session,message,abort=false){
    if(this.session!==session)return;
    this.session=null;this.clearTimer(session.timer);
    if(abort){try{session.recognition.abort();}catch{}}
    this.onState('idle');if(message)this.onNotice(message);
  }
  cancel(){if(this.session)this.finish(this.session,'',true);}
}
