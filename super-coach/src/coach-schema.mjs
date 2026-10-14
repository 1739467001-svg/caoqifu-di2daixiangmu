// Provider-side structure validation; semantic correctness still needs application checks.
const strings={type:'array',items:{type:'string'}};
export const COACH_RESPONSE_SCHEMA={
  name:'coach_turn',strict:true,
  schema:{
    type:'object',additionalProperties:false,
    properties:{
      level:{type:'string',enum:['L0','L1','L2','L3']},
      assessment:{type:'object',additionalProperties:false,properties:{
        track:{type:'string',enum:['short','medium','project','support'],description:'short知识计算；medium具体日常困难；project复杂项目/产品；support情绪与陪伴，不能误归成简单短聊。'},
        stage:{type:'string',enum:['explore','work','deliver']},
        ready:{type:'boolean',description:'是否已有足够信息给本阶段完整答复；项目缺关键需求时为false，情绪陪伴不按轮数结束。'},
        covered:{type:'array',items:{type:'string',enum:['question','goal','situation','constraints','attempts','audience','problem','scenario','outcome','scope','validation','experience','impact','need','support']},description:'仅列当前track中用户已明确说清的标准；不能把猜测或刚问的问题当已知。'},
        nextFocus:{type:'string',description:'下个需要聊的具体话题，160字以内的简短标签，非推理过程。'}
      },required:['track','stage','ready','covered','nextFocus']},
      kind:{type:'string',enum:['open','choice','answer']},
      reply:{type:'string',description:'用户可见正文。answer提供有用答案；open为自然交流和必要追问；choice只写完整问题，实际选项必须填options数组。任何kind都不要在reply写POPUP或确认小结。'},
      options:{type:'array',items:{type:'string'},description:'kind=choice时必须填写2～3个实际具体选项的完整文字，不带字母编号，例如["先刷手机忘了时间","担心写不好不想开始"]；程序会补上“其他，我自己说”。kind=open或answer时必须为空数组[]。'},
      highlights:{type:'array',items:{type:'string'},description:'从reply逐字摘取2～6处核心结论或行动，每处2～40字；长答案必须有重点。问题回复0～2处，极短事实题可[]。不摘整段，不添加新文字。'},
      notes:{
        type:'object',additionalProperties:false,
        properties:{surfaceRequest:{type:'string'},facts:strings,unclear:strings,contradictions:strings,themes:strings,askedAngles:strings,missedGuesses:strings},
        required:['surfaceRequest','facts','unclear','contradictions','themes','askedAngles','missedGuesses']
      },
      core:{type:'string'}
    },
    required:['level','assessment','kind','reply','options','highlights','notes','core']
  }
};
export function schemaForKinds(kinds){
  const schema=structuredClone(COACH_RESPONSE_SCHEMA);
  schema.schema.properties.kind.enum=[...kinds];
  return schema;
}
