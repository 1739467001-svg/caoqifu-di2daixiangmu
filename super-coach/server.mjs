import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAIReply } from './src/ai.mjs';
import { COACH_OPENING, promptForMode } from './src/system-prompt.mjs';
import { readConfig } from './src/config.mjs';
import {runCoachTurn} from './src/coach-flow.mjs';
import {normalizeCoachState} from './dist/coach-protocol.js';

const root=path.dirname(fileURLToPath(import.meta.url));
const fail=(status,message,code='INVALID_REQUEST')=>Object.assign(new Error(message),{status,code});
async function readBody(request) {
  if(!request.headers['content-type']?.startsWith('application/json'))throw fail(415,'请发送 JSON 数据。');
  const chunks=[];let size=0;
  for await(const chunk of request){size+=chunk.length;if(size>524288)throw fail(413,'这段对话太长了，请点击“新对话”继续聊。');chunks.push(chunk);}
  try{const parsed=JSON.parse(Buffer.concat(chunks).toString());if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error();return parsed;}
  catch{throw fail(400,'消息格式不正确。');}
}
function validateMessages(messages) {
  if(!Array.isArray(messages))throw fail(400,'需要提供对话消息。');
  if(messages.length>200)throw fail(413,'这段对话已经很长了，可以点击“新对话”继续聊。');
  let total=0;
  const cleaned=messages.map(message=>{
    if(!message||typeof message!=='object'||!['user','assistant'].includes(message.role)||typeof message.content!=='string')throw fail(400,'消息需要包含角色与文字。');
    const content=message.content.trim();if(!content||content.length>6000)throw fail(400,'每条消息需为 1–6000 个字。');
    total+=content.length;return {role:message.role,content};
  });
  if(total>48000)throw fail(413,'这段对话已经很长了，可以点击“新对话”继续聊。');
  if(cleaned.length&&cleaned.at(-1).role!=='user')throw fail(400,'请先发送你的消息。');
  return cleaned;
}
export async function createApp({config=readConfig(),reply=getAIReply,appOrigin=process.env.APP_ORIGIN}={}) {
  const allowedOrigins=appOrigin?.split(',').map(origin=>origin.trim()).filter(Boolean);
  const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  return http.createServer(async(req,res)=>{
    const controller=new AbortController();
    const disconnected=()=>{if(!res.writableEnded)controller.abort();};
    req.once('aborted',disconnected);res.once('close',disconnected);
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','SAMEORIGIN');
    res.setHeader('Permissions-Policy','microphone=(self), camera=(), geolocation=()');
    res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'");
    try {
      const url=new URL(req.url,'http://localhost');
      if(req.method==='GET'&&url.pathname==='/api/health')return json(res,200,{ok:true,mode:config.useMock?'mock':config.provider==='doubao'&&config.doubaoApiKey&&config.model?'live':'unconfigured'});
      if(req.method==='GET'&&url.pathname==='/api/config'){
        const secureOrigin=allowedOrigins?.find(origin=>{try{const target=new URL(origin);return target.protocol==='https:'&&target.host===req.headers.host;}catch{return false;}});
        return json(res,200,{useMock:config.useMock,...secureOrigin?{secureOrigin}:{}});
      }
      if(req.method==='POST'&&url.pathname==='/api/chat') {
        if(req.headers.origin&&!(allowedOrigins||[`http://${req.headers.host}`]).includes(req.headers.origin))throw fail(403,'请在网站页面中发送消息。');
        if(req.headers['sec-fetch-site']==='cross-site')throw fail(403,'请在网站页面中发送消息。');
        const input=await readBody(req),messages=validateMessages(input.messages);
        const interactionMode=input.interactionMode??null;
        if(interactionMode!==null&&!['choice','open'].includes(interactionMode))throw fail(400,'请选择一种有效的交互模式。');
        const started=performance.now();
        if(input.coachProtocol===1){
          if(input.coachState!=null&&!normalizeCoachState(input.coachState))throw fail(400,'对话状态未能读取，请刷新后重试。');
          if(input.action!=null&&!['mode','choice','confirm'].includes(input.action))throw fail(400,'对话操作无效。');
          const result=await runCoachTurn({messages,interactionMode,coachState:input.coachState,action:input.action,reply,config,signal:controller.signal});
          controller.signal.throwIfAborted();
          return json(res,200,{...result,mode:config.useMock?'mock':'live',processingMs:Math.max(0,performance.now()-started)});
        }
        // Older clients can also ask directly without choosing a mode.
        const answer=!messages.length?{role:'assistant',content:COACH_OPENING}:await reply({messages,systemPrompt:promptForMode(interactionMode)+'\n旧版文字接口：只输出用户可见的正常回复，不输出JSON或NOTES。',config,signal:controller.signal});
        controller.signal.throwIfAborted();
        const processingMs=Math.max(0,performance.now()-started);
        if(answer?.role!=='assistant'||typeof answer.content!=='string'||!answer.content.trim()||answer.content.length>6000)throw fail(502,'教练这次没能组织好回复，请重试。','INVALID_MODEL_REPLY');
        const visible=answer.content.replace(/<NOTES>[\s\S]*?<\/NOTES>/gu,'').trim();
        if(!visible||/<\/?NOTES>/u.test(visible))throw fail(502,'教练这次没能整理好回复，请重试。','INVALID_COACH_REPLY');
        return json(res,200,{message:{role:'assistant',content:visible},mode:config.useMock?'mock':'live',processingMs,requiresInteractionMode:false});
      }
      if(url.pathname.startsWith('/api/'))throw fail(404,'没有找到这个接口。');
      if(!['GET','HEAD'].includes(req.method))throw fail(405,'请求方式不支持。');
      const routes={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/task-store.js':'task-store.js','/reply-prompts.js':'reply-prompts.js','/coach-protocol.js':'coach-protocol.js','/voice-input.js':'voice-input.js','/secure-upgrade.js':'secure-upgrade.js','/styles.css':'styles.css','/favicon.svg':'favicon.svg'};
      routes['/message-presentation.js']='message-presentation.js';
      const file=routes[url.pathname];if(!file)throw fail(404,'页面不存在。');
      const data=await readFile(path.join(root,'dist',file));
      const type={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'}[path.extname(file)];
      res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:data);
    } catch(error) {
      if(controller.signal.aborted||res.destroyed)return;
      if(!error.status)console.error('Chat request failed:',error.code||error.name);
      if(!res.headersSent)json(res,error.status||500,{error:error.status?error.message:'暂时没有连接上教练，请重试。',code:error.code||'CHAT_FAILED'});else res.end();
    } finally {req.off('aborted',disconnected);res.off('close',disconnected);}
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const server=await createApp();
  server.listen(Number(process.env.PORT||3210),process.env.HOST||'127.0.0.1',()=>console.log(`探询 is ready at http://${process.env.HOST||'127.0.0.1'}:${process.env.PORT||3210}`));
}
