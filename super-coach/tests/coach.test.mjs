import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAIReply } from '../src/ai.mjs';
import { readConfig } from '../src/config.mjs';
const config=readConfig({USE_MOCK:'true'});
async function conversation() {
  const messages=[];
  const opening=await getAIReply({messages,config});messages.push(opening);
  return {opening,async say(content){messages.push({role:'user',content});const reply=await getAIReply({messages,config});messages.push(reply);return reply.content;}};
}
test('opens without a form and follows the actual interest, not turn number',async()=>{
  const art=await conversation(),code=await conversation();
  assert.match(art.opening.content,/探询.*最想理清或解决的问题.*？/s);
  const a=await art.say('我喜欢画画，尤其喜欢画小动物。');
  const b=await code.say('我喜欢编程，做游戏很有意思。');
  assert.match(a,/放下笔/);assert.match(b,/编程/);assert.notEqual(a,b);
});
test('can summarize a rich first message without forcing intermediate questions',async()=>{
  const c=await conversation();const reply=await c.say('我喜欢画画，但总是找不到之前画的画纸，我想做一个整理画纸的小工具。');
  assert.match(reply,/我先把听到的拼在一起/);
  assert.match(reply,/我喜欢画画/);assert.match(reply,/找不到/);assert.match(reply,/整理画纸/);
  assert.doesNotMatch(reply,/第.*个问题|进度/);
});
test('detours preserve the main context and natural summary stays in the conversation',async()=>{
  const c=await conversation();await c.say('我喜欢画画。');
  await c.say('昨天找不到画纸，翻了好久。');
  const detour=await c.say('我有点饿了');assert.match(detour,/肚子/);assert.match(detour,/画画/);
  const summary=await c.say('我想做一个帮我整理画纸的小工具。');assert.match(summary,/我先把听到的拼在一起/);assert.match(summary,/画纸/);
  const follow=await c.say('对');assert.match(follow,/一小步/);
  const step=await c.say('先拍三张画纸，试试给它们起名字。');assert.match(step,/三张画纸/);
});
test('respects a new topic, a correction and no-difficulty answers',async()=>{
  const c=await conversation();await c.say('我喜欢画画。');await c.say('画不好人物让我很烦。');
  const changed=await c.say('不聊画画了，我最近喜欢篮球。');assert.match(changed,/篮球/);assert.doesNotMatch(changed,/人物/);
  const noPain=await c.say('没有什么困难，都很顺利。');assert.match(noPain,/不需要硬找/);
  const correction=await c.say('其实我更喜欢足球。');assert.match(correction,/足球/);
  const summary=await c.say('帮我总结一下');assert.match(summary,/足球/);assert.doesNotMatch(summary,/画不好人物/);
});
test('does not turn a denied interest into a positive fact',async()=>{
  const c=await conversation();await c.say('我喜欢画画');await c.say('我不喜欢画画了');
  const summary=await c.say('总结一下');assert.doesNotMatch(summary,/你愿意投入的事/);
});
test('uncertainty, refusal and goodbye are not pushed through a checklist',async()=>{
  const c=await conversation();assert.match(await c.say('不知道'),/放小一点/);
  assert.match(await c.say('我也不知道'),/先安静/);
  assert.match(await c.say('不想说'),/不用.*勉强/);
  const goodbye=await c.say('不聊了');assert.doesNotMatch(goodbye,/？/);
});
test('responds to emotions before returning to product ideas',async()=>{
  const c=await conversation();await c.say('我喜欢篮球');const reply=await c.say('同学说我打得菜，我很难过');
  assert.match(reply,/感受|难受/);assert.doesNotMatch(reply,/小工具|产品|API/);
});
test('mock needs no key; incomplete real configuration fails without contacting a provider',async()=>{
  assert.equal(readConfig({}).useMock,true);
  assert.throws(()=>readConfig({USE_MOCK:'tru'}),/USE_MOCK/);
  await assert.rejects(()=>getAIReply({messages:[],config:readConfig({USE_MOCK:'false',DOUBAO_API_KEY:'test-only'})}),error=>error.code==='MODEL_NOT_CONFIGURED'&&error.status===503);
});
