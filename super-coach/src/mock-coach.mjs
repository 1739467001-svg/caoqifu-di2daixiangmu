// Context-sensitive MOCK, not an LLM. Strategy stays behind getAIReply.
// There are no question indices, required stages, or fixed number of turns.
export const OPENING = '你好，我是探询，你的 AI 焦点教练。我们可以从一件具体的事开始。\n\n你现在最想理清或解决的问题是什么？';

const topics = [
  {id:'drawing',name:'画画',words:/画画|绘画|漫画|画作|画猫|画人物|画小动物/g,joy:'画画时，最让你舍不得放下笔的是什么？',detail:'你最近画过的一幅画，里面发生了什么？'},
  {id:'coding',name:'编程',words:/编程|代码|程序|做游戏|写游戏|做网站/g,joy:'编程时，哪个瞬间让你觉得“这也太有意思了”？',detail:'你最近做的小程序里，最想让它实现什么？'},
  {id:'building',name:'动手搭建',words:/机器人|乐高|积木|搭建|拼装|发明/g,joy:'搭东西时，你最享受其中的什么？',detail:'最近一次搭出来的东西，有什么是你特别想介绍的？'},
  {id:'basketball',name:'篮球',words:/篮球|投篮|三分球|三分|上篮/g,joy:'打篮球时，什么瞬间让你最过瘾？',detail:'最近一次打球，有哪个片段你到现在还记得？'},
  {id:'football',name:'足球',words:/足球|踢球|射门/g,joy:'踢球时，什么瞬间让你最过瘾？',detail:'最近一次踢球，有哪个片段你到现在还记得？'},
  {id:'music',name:'音乐',words:/音乐|唱歌|钢琴|吉他|作曲|弹琴/g,joy:'一段音乐里，最能打动你的是什么？',detail:'最近有没有一段你反复想听或想弹的旋律？'},
  {id:'nature',name:'自然和科学',words:/星星|宇宙|太空|恐龙|植物|昆虫|科学|实验|观星/g,joy:'这些发现里面，你最想弄明白的是什么？',detail:'最近看到的哪个现象，让你想多看一会儿？'},
  {id:'reading',name:'故事和阅读',words:/读书|阅读|故事|小说|写作|书里/g,joy:'一个故事里，什么最容易把你吸引进去？',detail:'最近有没有一个角色或片段，让你一直惦记着？'},
  {id:'games',name:'游戏',words:/游戏|我的世界|王者|闯关/g,joy:'玩游戏时，最吸引你继续探索的是什么？',detail:'最近一次玩的时候，有哪个瞬间特别让你记得？'}
];
const stop = /^(?:今天)?(?:先)?(?:不聊了|聊到这里|先到这|再见|拜拜|我要走了|我要睡了|想休息|我要休息|停止)(?:[吧啦了。！!\s]*)$/;
const decline = /^(?:我)?(?:暂时|现在|今天|真的|也)?(?:不知道|不清楚|没想好|想不出来|不想说|不想回答|不想聊这个|随便|没什么想说的)[啊呢吧呀。！!\s]*$/;
const summaryRequest = /(?:帮我|请|能不能|可以)?(?:总结|小结|整理一下|梳理一下)|你(?:现在)?了解我什么/;
const correction = /(?:不是这个意思|理解错了|说错了|不是.{0,20}[，,]|其实|改成|更准确|应该是|我说的是|不再喜欢)/;
const emotion = /难过|不开心|伤心|烦躁|很烦|害怕|担心|紧张|生气|委屈|焦虑|难受|哭了|嘲笑|说我.{0,6}(?:菜|笨)/;
const struggle = /困难|麻烦|卡住|卡在|报错|不会|不太会|太难|很难|找不到|来不及|忘记|记不住|记不清|太慢|搞不懂|不知道怎么|做不到|画不好|不敢|总是失败|没时间|花.{0,6}小时/;
const noStruggle = /没(?:有|什么).{0,5}(?:困难|麻烦|卡住|问题)|都(?:很)?顺利|没觉得难/;
const wish = /(?:我)?(?:希望|想要|想做|想让|想有|想试|想创造|想设计|想实现)|如果.{0,18}(?:能|可以)|帮我.{0,15}(?:记|找|画|做|听|记录)/;
const noWish = /不想(?:做|要|有).{0,10}(?:工具|产品|软件|程序)|先不做/;
const context = /昨天|上次|那次|刚才|比如|有一次|那天|前几天|每次|经常|总是|最近一次|今天.{0,10}(?:时|画|玩|做)/;
const interest = /喜欢|爱好|最爱|有趣|有意思|着迷|投入|好玩|最开心|停不下来/;
const step = /(?:先|第一步|试着|试试看).{1,50}(?:做|画|记|找|试|拍|写|用|列|问)|先做|先试/;
const confirmation = /^(?:对|是的|没错|嗯|嗯嗯|对的|就是这样|差不多|说得对|是这样|可以)[啊呢呀的。！!\s]*$/;
const summaryMarker = '我先把听到的拼在一起';
const snippet = text => text.replace(/\s+/g,' ').slice(0,72) + (text.replace(/\s+/g,' ').length>72?'…':'');
const quote = text => `“${snippet(text)}”`;
const evidence = (text, pattern) => text.split(/[，,。；;\n]/).map(s=>s.trim()).find(s=>pattern.test(s)) || text;

function findTopic(text) {
  const matches=[];
  for(const topic of topics)for(const match of text.matchAll(topic.words)) {
    const preceding=text.slice(Math.max(0,match.index-10),match.index);
    if(/不(?:是|喜欢|爱|想聊|想玩|想做)[^，。；,]{0,5}$/.test(preceding))continue;
    matches.push({topic,index:match.index});
  }
  return matches.sort((a,b)=>a.index-b.index).findLast(m=>m.topic.id!=='games')?.topic || matches.at(-1)?.topic;
}
function specialIntent(text) {
  if(stop.test(text))return 'stop';
  if(/想(?:自杀|死)|不想活|伤害自己|有人.{0,8}(?:打我|伤害我)|被.{0,8}(?:打了|欺负)/.test(text))return 'distress';
  if(summaryRequest.test(text))return 'summary';
  if(decline.test(text))return 'decline';
  if(/你是谁|你叫什么|你是(?:谁|机器人|真人)|你能做什么/.test(text))return 'identity';
  if(/讲.{0,4}笑话/.test(text))return 'joke';
  if(/我(?:有点|好|很)?饿|先去吃|吃饭去了/.test(text))return 'hungry';
  if(/(?:今天|明天|现在|外面).{0,4}天气|天气(?:怎么样|如何)/.test(text))return 'weather';
  return null;
}
function collect(messages) {
  const s={topic:null,interest:null,pain:null,scene:null,wish:null,step:null,detail:null,noProblem:false,declines:0,summarized:false,factsAtSummary:'',topicChanged:false,lastAssistant:'',lastUser:'',intent:null};
  for(const message of messages) {
    if(message.role==='assistant') {
      s.lastAssistant=message.content;
      if(message.content.includes(summaryMarker)){s.summarized=true;s.factsAtSummary=fingerprint(s);}
      continue;
    }
    const text=message.content.trim();s.lastUser=text;s.intent=specialIntent(text);s.topicChanged=false;
    if(s.intent){if(s.intent==='decline')s.declines++;continue;}
    const nextTopic=findTopic(text);
    if(s.topic && /不喜欢|不再喜欢|不是在说|不想聊/.test(text) && !nextTopic){
      s.topic=null;for(const key of ['interest','pain','scene','wish','step','detail'])s[key]=null;s.summarized=false;s.noProblem=false;
    }
    if(nextTopic && s.topic && nextTopic.id!==s.topic.id && (interest.test(text)||correction.test(text)||/换个话题|不聊.{0,8}了/.test(text))) {
      for(const key of ['interest','pain','scene','wish','step','detail'])s[key]=null;
      s.summarized=false;s.noProblem=false;s.topicChanged=true;
    }
    if(nextTopic)s.topic=nextTopic;
    const isPain=(struggle.test(text)||emotion.test(text))&&!noStruggle.test(text);
    const isWish=wish.test(text)&&!noWish.test(text);
    const negatedInterest=/不喜欢|不再喜欢|不想聊/.test(text)&&!nextTopic;
    const isOpeningAnswer=s.lastAssistant===OPENING && !isPain && !isWish && !negatedInterest;
    if(!negatedInterest&&(interest.test(text)||(nextTopic&&!s.interest)||isOpeningAnswer))s.interest=evidence(text,interest);
    if(isPain){s.pain=evidence(text,new RegExp(`${struggle.source}|${emotion.source}`));s.noProblem=false;}
    if(noStruggle.test(text)){s.pain=null;s.noProblem=true;}
    if(context.test(text))s.scene=text;
    if(isWish)s.wish=evidence(text,wish);
    if(step.test(text))s.step=text;
    if(noWish.test(text)){s.wish=null;s.step=null;}
    if(!isPain && !isWish && !confirmation.test(text) && text.length>4 && !interest.test(text))s.detail=text;
    // Interpret direct replies using the preceding open question, not a step index.
    if(/哪个地方|最不方便|小麻烦|在哪里卡住/.test(s.lastAssistant) && !noStruggle.test(text) && !isWish && !confirmation.test(text))s.pain=text;
    if(/那一次|最近一次遇到/.test(s.lastAssistant) && !confirmation.test(text))s.scene=text;
    if(/希望它|希望有什么变化/.test(s.lastAssistant) && !noWish.test(text) && !confirmation.test(text))s.wish=text;
    if(/最小的尝试|先试的一小步/.test(s.lastAssistant) && !confirmation.test(text))s.step=text;
  }
  return s;
}
function fingerprint(s){return [s.interest,s.pain,s.scene,s.wish,s.step].join('|');}
function summarize(s) {
  const entries=[
    s.interest&&`你愿意投入的事，你是这样说的：${quote(s.interest)}。`,
    s.pain&&`你提到的困扰是：${quote(s.pain)}。`,
    s.wish&&`你希望发生的变化是：${quote(s.wish)}。`,
    s.step&&s.step!==s.wish&&`你想先试一小步：${quote(s.step)}。`
  ].filter(Boolean);
  if(!entries.length&&s.scene)entries.push(`你讲的这段经历是：${quote(s.scene)}。`);
  if(!entries.length&&s.detail)entries.push(`你提到：${quote(s.detail)}。`);
  if(!entries.length)return '可以，我们先停下来看看。现在我还没有听到足够的具体内容，不想替你编一个结论。\n\n你希望我先听懂你哪一件事？';
  return `${summaryMarker}，你来看看我有没有听偏：\n\n${[...new Set(entries)].join('\n\n')}\n\n${s.pain&&s.wish?'从你描述的困难出发，挑一个小地方试试，已经是一个很具体的起点。':'这些是你刚才说过的想法，还不用急着把自己定义成什么样的人。'}有没有哪一点，你想纠正或补充？`;
}
export function mockCoachReply(messages,systemPrompt) {
  if(typeof systemPrompt!=='string'||!systemPrompt.trim())throw new Error('A system prompt is required');
  if(!messages.length)return OPENING;
  const s=collect(messages),text=s.lastUser,previous=s.lastAssistant;
  const returnToTopic=s.topic?`等你想接着聊了，我也想听听${s.topic.name}里那些让你在意的小事。`:'等你想继续时，说什么都可以。';
  if(s.intent==='stop')return '好，我们就先聊到这里。谢谢你把这些想法告诉我，去休息一下吧。想接着说的时候，再来找我就好。';
  if(s.intent==='distress')return '谢谢你告诉我，听起来你正在经历很难受的事情。现在先把你自己的安全放在最前面，请马上找身边信任的家长或老师陪着你；如果眼前有危险，请让身边的大人联系当地急救或报警服务。\n\n现在有哪位你信任的大人可以来陪你？';
  if(s.intent==='summary')return summarize(s);
  if(s.intent==='identity')return `我是探询，你的 AI 焦点教练，现在用模拟对话和你交流。我会通过提问帮你梳理关键信息，理清问题和下一步。\n\n${s.topic?`刚才说到${s.topic.name}，你还有什么想让我听听的？`:'你现在最希望解决什么问题？'}`;
  if(s.intent==='hungry')return `饿了就先照顾好肚子，不着急回答我。我们可以停一会儿。\n\n${returnToTopic}`;
  if(s.intent==='weather')return `想聊聊天气也可以。不过我现在没有实时天气信息，不能猜外面的情况。\n\n${s.topic?`天气会怎样影响你想做的${s.topic.name}活动？`:'你今天最想在外面做些什么？'}`;
  if(s.intent==='joke')return `先来个小笑话：小蜗牛给自己买了双跑鞋，朋友问有用吗？它说：“至少现在，我是有装备的慢！”\n\n${s.topic?`说起来，${s.topic.name}有没有让你忍不住笑出来的时刻？`:'最近有什么小事让你笑出来了？'}`;
  if(s.intent==='decline') {
    if(/不想/.test(text))return '好，这部分我们先不碰。你不用为了回答我勉强自己。\n\n现在有什么是你更愿意聊的？';
    if(s.declines>1)return '没关系，不用努力找一个答案。我们可以先安静一会儿；等你想到任何小事，再告诉我就好。';
    return '一下子想不到很正常，我们把问题放小一点。\n\n今天到现在，有没有哪个小瞬间是你还记得的？';
  }
  if(/不喜欢|不再喜欢|不想聊/.test(text)&&!s.topic)return '谢谢你告诉我，那我就不把它当作你的兴趣了。\n\n你现在更愿意聊什么？';
  if(s.topicChanged)return `好，我们就跟着你的新想法走，先聊${s.topic.name}。之前的想法不需要一直保持不变。\n\n${s.topic.joy}`;
  if(correction.test(text))return `谢谢你纠正我，我会以你刚才这句${quote(text)}为准，不替你下结论。\n\n${s.wish?'按照这个理解，你希望先发生什么变化？':'关于这一点，你还想让我听懂什么？'}`;
  if(confirmation.test(text)&&previous.includes(summaryMarker))return s.wish?'好，那我们先按你确认的理解往前走，不急着把整个工具做出来。\n\n你愿意先试的一小步是什么？':'好，谢谢你帮我确认。兴趣也可以只是让你开心的事，不一定要变成产品。\n\n你还想继续聊哪一部分？';
  if(emotion.test(text))return `你提到${quote(text)}，这份感受值得认真听一听，我们先不用急着想办法。\n\n${s.scene?'那件事里，你最希望别人理解你的是什么？':'你愿意说说，是哪件小事让你有了这种感觉？'}`;
  const enough=Boolean(s.interest&&((s.pain&&s.wish)||(s.scene&&s.wish)||(s.step&&s.wish)));
  if(enough&&(!s.summarized||(s.step&&fingerprint(s)!==s.factsAtSummary)))return summarize(s);
  if(noWish.test(text))return '好，不一定要做工具。能把自己的想法说出来，本身就值得花一点时间。\n\n如果只是为了自己开心，你接下来想试什么？';
  if(noStruggle.test(text))return `那就很好，不需要硬找一个困难。${s.topic?`${s.topic.name}带给你的乐趣，也值得慢慢聊。`:''}\n\n如果能继续玩出一点新花样，你会想试什么？`;
  if(s.step&&step.test(text))return `你说${quote(text)}，这个尝试已经挺具体了，可以先用最简单的方式试一次。\n\n你会观察什么，来判断它有没有真的帮上忙？`;
  if(wish.test(text))return `你提到${quote(text)}，我听到一个想让事情变得更好的愿望。\n\n${s.pain?'如果只保留一个作用，你最希望它帮你完成什么？':'这个想法最想帮你解决哪一个小麻烦？'}`;
  if(struggle.test(text))return `你说${quote(text)}，听起来这个地方确实有点卡住你了。\n\n${s.scene?'在那一次，最希望有什么变化能帮到你？':'能讲讲最近一次遇到它的时候，发生了什么吗？'}`;
  if(s.scene&&context.test(text))return `谢谢你讲这个具体的片段，${quote(text)}让我更容易跟上你的想法。\n\n${s.pain?'回到那一次，你最希望有什么变化？':s.topic?'那一刻，最让你在意的是什么？':'这件事里，你最想多说一点的是什么？'}`;
  if(confirmation.test(text))return `好，我跟上了。\n\n${s.topic?s.topic.detail:'你愿意用一件具体的小事，接着讲讲吗？'}`;
  if(s.topic&&(interest.test(text)||!s.detail))return `听到你说${quote(text)}，我想多认识一下这个让你投入的世界。\n\n${previous.includes(s.topic.joy)?s.topic.detail:s.topic.joy}`;
  if(s.topic)return `你刚才说的${quote(text)}，我听到了。\n\n${s.pain?'如果能让这件事轻松一点，你希望有什么变化？':s.noProblem?s.topic.detail:`做${s.topic.name}的时候，有没有哪个地方让你觉得不太顺手？`}`;
  return `你提到${quote(text)}，我们就从这里聊，不用换成别的话题。\n\n${s.interest?'这件事里，最吸引你的是什么？':'你最想让我听懂的，是其中哪一点？'}`;
}
