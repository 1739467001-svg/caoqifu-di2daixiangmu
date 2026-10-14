import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getReplyPrompts,addPromptToDraft} from '../dist/reply-prompts.js';
const reply=content=>({role:'assistant',content});

test('presents every actual option, keeping its letter and meaning',()=>{
  for(const count of [2,3,4,5,6]){
    const lines=Array.from({length:count},(_,i)=>`${String.fromCharCode(65+i)}. 想法 ${i+1}`);
    const result=getReplyPrompts(reply('我们慢慢梳理。\n你最在意什么？\n'+lines.join('\n')),'choice');
    assert.equal(result.title,'你最在意什么？');assert.equal(result.items.length,count);
    assert.deepEqual(result.items.map(item=>item.draft),lines);
  }
  const result=getReplyPrompts(reply('哪个更接近你？\n**Ａ．** 一种可能\nＢ、另一种可能'),'choice');
  assert.deepEqual(result.items.map(item=>item.draft),['A. 一种可能','B. 另一种可能']);
});

test('malformed or absent options fall back to ordinary chat without invented answers',()=>{
  for(const text of ['你好，请先选择模式。','问题？\nA. 单个选项','问题？\nA. 一\nC. 三','问题？\nA. 一\nA. 重复','没有问题\nA. 一\nB. 二'])assert.equal(getReplyPrompts(reply(text),'choice'),null);
  assert.equal(getReplyPrompts({role:'user',content:'问题？\nA. 一\nB. 二'},'choice'),null);
  assert.equal(getReplyPrompts(reply('问题？\nA. 一\nB. 二'),'open'),null);
});

test('inline and wrapped options remain clickable, and replies cannot be reinterpreted in another mode',()=>{
  const inline=getReplyPrompts(reply('更接近哪一种？ A. 我还不确定 B. 我想慢慢说说 C. 其他'),'choice');
  assert.deepEqual(inline.items.map(item=>item.text),['我还不确定','我想慢慢说说','其他']);
  const wrapped=getReplyPrompts(reply('哪一点更在意？\nA. 关于期待\n  以及期待从哪里来\nB. 关于顾虑'),'choice');
  assert.equal(wrapped.items[0].text,'关于期待\n  以及期待从哪里来');
  assert.equal(getReplyPrompts({...reply('问题？\nA. 一\nB. 二'),interactionMode:'open'},'choice'),null);
});

test('open questions support numbering and free lines, without becoming prewritten answers',()=>{
  for(const content of ['我们慢慢来。\n1. 你期待什么？\n2. 你依据什么判断？','你期待什么？\n\n你依据什么判断？']){
    const result=getReplyPrompts(reply(content),'open');
    assert.deepEqual(result.items.map(item=>item.text),['你期待什么？','你依据什么判断？']);
    assert.equal(Object.hasOwn(result.items[0],'draft'),false);
  }
  assert.equal(getReplyPrompts(reply('1. 你期待什么？\n2. 你在意什么？\n3. 你依据什么判断？'),'open').items.length,3);
  assert.equal(getReplyPrompts(reply('我们先聊到这里。'),'open'),null);
});

test('choice drafts preserve custom words, replace only known prefixes and never execute markup',()=>{
  assert.equal(addPromptToDraft('我还想补充','A. 在意目标'),'A. 在意目标\n我还想补充');
  assert.equal(addPromptToDraft('A. 在意目标\n我还想补充','B. 在意依据','A. 在意目标'),'B. 在意依据\n我还想补充');
  assert.equal(addPromptToDraft('已改成自己的话','B. 在意依据','A. 在意目标'),'B. 在意依据\n已改成自己的话');
  assert.equal(addPromptToDraft('B. 在意依据','B. 在意依据','B. 在意依据'),'B. 在意依据');
  const text='<img src=x onerror=alert(1)>';
  assert.equal(getReplyPrompts(reply('在意什么？\nA. '+text+'\nB. 其他'),'choice').items[0].text,text);
});

test('reply kind overrides a preference and answers never become question controls',()=>{
 const open={role:'assistant',content:'你具体卡在哪一步？',interactionMode:'choice',coachState:{replyKind:'open'}};assert.equal(getReplyPrompts(open,'choice').kind,'open');
 const answer={...open,content:'可以先写两句开场。假如有人问：你想说什么？就照着开场说。',coachState:{replyKind:'answer'}};assert.equal(getReplyPrompts(answer,'choice'),null);
 const old={...open,content:'旧小结\n[POPUP]\n我理解对吗？\n[/POPUP]',coachState:{phase:'final'}};assert.equal(getReplyPrompts(old,'choice'),null);
});
