import {DESIGN_PROMPT,PROJECT_MEMORY} from './project-memory.mjs';
export {COACH_OPENING} from '../dist/coach-protocol.js';
export const SYSTEM_PROMPT = `${PROJECT_MEMORY}\n\n【当前已确认的最新教练规则，优先于历史附件】\n${DESIGN_PROMPT}\n\n【执行优先级】以解决问题为目标；聊天模式可不选。新规则允许并要求在信息足够时给出答案和建议。不要执行历史附件中的禁答、固定题型和小结确认流程。`;
export function promptForMode(mode){
  if(!['choice','open'].includes(mode))return SYSTEM_PROMPT;
  return `${SYSTEM_PROMPT}\n\n【当前聊天偏好】${mode==='choice'?'选项辅助：必要时给几个选项，也要允许自由回答，不把每一轮都变成选择题':'自由表达：以自然文字交流为主，确实需要缩小范围时也可给选项'}。这是偏好，不阻止你直接给出答案。不要反复要求用户选择方式。`;
}
