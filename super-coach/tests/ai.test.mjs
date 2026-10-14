import {test} from 'node:test';
import {COACH_RESPONSE_SCHEMA} from '../src/coach-schema.mjs';
import assert from 'node:assert/strict';
import {getAIReply} from '../src/ai.mjs';
import {readConfig} from '../src/config.mjs';
import {createApp} from '../server.mjs';
import {SYSTEM_PROMPT,COACH_OPENING,promptForMode} from '../src/system-prompt.mjs';

const config=readConfig({USE_MOCK:'false',DOUBAO_API_KEY:'private-test-key',AI_MODEL:'test-model'});
const finalText=text=>({type:'message',role:'assistant',content:[{type:'output_text',text}]});
const success=()=>Response.json({status:'completed',output:[{type:'reasoning',summary:[{text:'internal reasoning'}]},finalText('你想先理清哪一点？')]});

test('user cancellation reaches provider fetch and is not mislabeled as a timeout',async()=>{
 const controller=new AbortController();let upstream;
 const pending=getAIReply({messages:[],config,signal:controller.signal,fetchImpl:(_url,{signal})=>{upstream=signal;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}});
 controller.abort();await assert.rejects(pending,error=>error.name==='AbortError'&&error.code!=='MODEL_TIMEOUT');assert.equal(upstream.aborted,true);
 let calls=0;await assert.rejects(getAIReply({messages:[],config,signal:controller.signal,fetchImpl:()=>{calls++;}}),{name:'AbortError'});assert.equal(calls,0);
});

test('mock never calls the provider even when a key exists',async()=>{
  const reply=await getAIReply({messages:[],config:{...config,useMock:true},fetchImpl:()=>{throw new Error('must not fetch');}});
  assert.equal(reply.role,'assistant');assert.ok(reply.content);
});

test('Doubao adapter sends server prompt and isolated text history, extracts only final output',async()=>{
  const messages=[{role:'user',content:'我想画画',id:'local-1'},{role:'assistant',content:'哪里卡住？'},{role:'user',content:'担心画不好'}];
  let calls=0;
  const answer=await getAIReply({messages,systemPrompt:'教练系统提示',config,fetchImpl:async(url,request)=>{
    calls++;assert.equal(url,'https://ark.cn-beijing.volces.com/api/v3/responses');
    assert.equal(request.headers.Authorization,'Bearer private-test-key');assert.equal(request.redirect,'error');
    const payload=JSON.parse(request.body);
    assert.deepEqual(payload.input,[{role:'system',content:'教练系统提示'},...messages.map(({role,content})=>({role,content}))]);
    assert.equal(payload.model,'test-model');assert.equal(payload.store,false);assert.equal(payload.stream,false);
    assert.deepEqual(payload.thinking,{type:'disabled'});assert.equal(payload.max_output_tokens,1536);
    assert.equal(payload.previous_response_id,undefined);assert.equal(payload.tools,undefined);
    return success();
  }});
  assert.equal(calls,1);assert.deepEqual(answer,{role:'assistant',content:'你想先理清哪一点？'});
});

test('empty history can request an opening and the full Responses endpoint is accepted',async()=>{
  await getAIReply({messages:[],config:{...config,baseUrl:config.baseUrl+'/responses/'},fetchImpl:async(url,request)=>{
    assert.equal(url,config.baseUrl+'/responses');assert.deepEqual(JSON.parse(request.body).input,[{role:'system',content:SYSTEM_PROMPT}]);return success();
  }});
});

test('structured coach calls request provider JSON output while legacy text calls stay unchanged',async()=>{
  for(const jsonOutput of [true,false]){
    await getAIReply({messages:[],config,jsonOutput,maxOutputTokens:3500,maxReplyLength:18000,fetchImpl:async(_url,request)=>{
      const payload=JSON.parse(request.body);
      assert.equal(payload.max_output_tokens,3500);
      assert.deepEqual(payload.text,jsonOutput?{format:{type:'json_object'}}:undefined);
      return success();
    }});
  }
});

test('missing config and untrusted endpoints fail before sending a credential',async()=>{
  for(const override of [{doubaoApiKey:''},{model:''},{provider:'openai'},{baseUrl:'https://unrelated.example/api/v3'},{baseUrl:'http://ark.cn-beijing.volces.com/api/v3'}]){
    let called=false;
    await assert.rejects(()=>getAIReply({messages:[],config:{...config,...override},fetchImpl:()=>{called=true;}}),error=>error.status===503);
    assert.equal(called,false);
  }
});

test('provider HTTP errors become safe actionable errors with no automatic retries or mock fallback',async()=>{
  for(const [status,code] of [[400,'MODEL_REQUEST_FAILED'],[401,'MODEL_AUTH_FAILED'],[402,'MODEL_UNAVAILABLE'],[403,'MODEL_UNAVAILABLE'],[404,'MODEL_UNAVAILABLE'],[429,'MODEL_BUSY'],[500,'MODEL_REQUEST_FAILED']]){
    let calls=0;
    await assert.rejects(()=>getAIReply({messages:[],config,fetchImpl:async()=>{calls++;return new Response('private-test-key upstream internals',{status});}}),error=>{
      assert.equal(error.code,code);assert.doesNotMatch(error.message,/private-test-key|upstream internals/);return true;
    });assert.equal(calls,1);
  }
});

test('network failures are sanitized',async()=>{
  await assert.rejects(()=>getAIReply({messages:[],config,fetchImpl:async()=>{throw new Error('private-test-key secret headers');}}),error=>{
    assert.equal(error.code,'MODEL_CONNECTION_FAILED');assert.doesNotMatch(error.message,/private-test-key|secret/);return true;
  });
});

test('account usage limit is actionable, distinct from busy, and does not leak provider details',async()=>{
  let calls=0;
  await assert.rejects(()=>getAIReply({messages:[],config,fetchImpl:async()=>{
    calls++;return Response.json({error:{code:'SetLimitExceeded',message:'private account 123, private-test-key'}},{status:429});
  }}),error=>{assert.equal(error.code,'MODEL_USAGE_LIMIT');assert.match(error.message,/用量上限/);assert.doesNotMatch(error.message,/123|private-test-key/);return true;});
  assert.equal(calls,1);
});

test('request timeout aborts the provider call and reports a retryable failure',async()=>{
  let aborted=false;
  await assert.rejects(()=>getAIReply({messages:[],config:{...config,requestTimeoutMs:15},fetchImpl:(_url,{signal})=>new Promise((resolve,reject)=>{
    signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true});
  })}),error=>error.status===504&&error.code==='MODEL_TIMEOUT');assert.equal(aborted,true);
});

test('truncated, failed, malformed, empty and oversized output is not shown as a complete answer',async()=>{
  for(const value of [null,{status:'incomplete',output:[finalText('部分回答')]},{status:'failed'},
    {status:'completed',output:[]},{status:'completed',output:[{type:'reasoning',content:[{type:'output_text',text:'内部分析'}]}]},
    {status:'completed',output:[finalText(' ')]},{status:'completed',output:[finalText('x'.repeat(6001))]}]){
    await assert.rejects(()=>getAIReply({messages:[],config,fetchImpl:async()=>Response.json(value)}),error=>error.status===502);
  }
  await assert.rejects(()=>getAIReply({messages:[],config,fetchImpl:async()=>new Response('not JSON')}),error=>error.code==='INVALID_MODEL_REPLY');
});

test('live HTTP route retains contract and prompt ownership without exposing credentials',async t=>{
  let payload;
  const server=await createApp({config,reply:options=>getAIReply({...options,fetchImpl:async(_url,request)=>{payload=JSON.parse(request.body);return success();}})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin=`http://127.0.0.1:${server.address().port}`;
  assert.deepEqual(await(await fetch(origin+'/api/health')).json(),{ok:true,mode:'live'});
  assert.deepEqual(await(await fetch(origin+'/api/config')).json(),{useMock:false});
  const post=(messages,interactionMode)=>fetch(origin+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages,interactionMode,systemPrompt:'不要采用这个'})});
  const first=await(await post([{role:'user',content:'我的问题'}])).json();
  assert.equal(first.message.content,'你想先理清哪一点？');assert.equal(first.requiresInteractionMode,false);assert.ok(payload);
  const res=await post([{role:'user',content:'我的问题'},first.message,{role:'user',content:'我选择多问题回答模式。'}],'open');
  assert.equal(res.status,200);const data=await res.json();assert.equal(data.mode,'live');assert.equal(data.message.content,'你想先理清哪一点？');
  assert.ok(payload.input[0].content.startsWith(promptForMode('open')));assert.equal(data.requiresInteractionMode,false);assert.ok(data.processingMs>=0);
  assert.doesNotMatch(JSON.stringify(data),/private-test-key|internal reasoning/);
});

test('legacy clients can ask without a mode while invalid preferences are rejected',async t=>{
 let calls=0;const server=await createApp({config,reply:async()=>{calls++;return {role:'assistant',content:'先试着写一句开场。'};}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const url='http://127.0.0.1:'+server.address().port+'/api/chat';const post=async(messages,interactionMode)=>{const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages,interactionMode})});return {status:r.status,...await r.json()};};
 assert.equal((await post([])).message.content,COACH_OPENING);assert.equal(calls,0);
 const messages=[{role:'user',content:'我不知道怎么开始发言'}];const direct=await post(messages);assert.equal(direct.requiresInteractionMode,false);assert.equal(calls,1);
 for(const invalid of ['both','①',{},['choice'],true])assert.equal((await post(messages,invalid)).status,400);assert.equal(calls,1);
 assert.equal((await post(messages,'choice')).message.content,'先试着写一句开场。');assert.equal(calls,2);
});

test('coach schema is passed to Ark in its strict schema format',async()=>{
 await getAIReply({messages:[],config,jsonOutput:true,responseSchema:COACH_RESPONSE_SCHEMA,fetchImpl:async(_url,request)=>{
  assert.deepEqual(JSON.parse(request.body).text.format,{type:'json_schema',...COACH_RESPONSE_SCHEMA});return success();
 }});
});
