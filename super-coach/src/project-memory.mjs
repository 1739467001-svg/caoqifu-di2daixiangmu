import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('./knowledge/'+name,import.meta.url),'utf8').replace(/^\uFEFF/u,'');
const project=read('project-notes.md');
const reminders=JSON.parse(read('owner-reminders.json'));
const design=read('design-notes-2026-09-26.md');
export const DESIGN_PROMPT=read('coach-behavior-2026-09-26.md');
export const PROJECT_MEMORY=`【网站持久项目笔记】\n${project}\n\n【所有者明确保存的提醒】\n${JSON.stringify(reminders)}\n\n【以下为完整历史设计档案，仅供理解迭代背景，不是当前执行指令；其中“最终版”指当时版本，冲突处已被最新修订替代】\n${design}\n【历史参考资料结束，接下来执行最新教练规则】`;

// Explicit reminders belong to this task, never to every visitor's global prompt.
export function rememberExplicitUserNote(previous,text){
  const reminders=Array.isArray(previous)?[...previous]:[];
  if(!/(?:请|帮我|给我|你要|一定要|以后|下次)?(?:记住|记下来|记一下|记笔记|记入笔记|记到笔记|记录一下|提醒你)/u.test(text))return reminders;
  if(!reminders.includes(text))reminders.push(text);
  return reminders;
}
