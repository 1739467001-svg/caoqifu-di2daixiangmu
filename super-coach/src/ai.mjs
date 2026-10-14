import { SYSTEM_PROMPT } from './system-prompt.mjs';
import { mockCoachReply } from './mock-coach.mjs';
import { readConfig } from './config.mjs';

/**
 * The ONLY model-provider integration point.
 * Input: full current conversation [{role:'user'|'assistant', content:string}].
 * Output: {role:'assistant', content:string}. Keep this contract unchanged.
 * Doubao Responses API receives server-owned instructions and this task's history.
 * No provider-side response state is used, so edits/deletions apply on the next turn.
 * Never include credentials in a response or browser code.
 */
export async function getAIReply({ messages, systemPrompt = SYSTEM_PROMPT, config = readConfig(), fetchImpl = globalThis.fetch, maxOutputTokens = 1536, maxReplyLength = 6000, jsonOutput = false, responseSchema, signal }) {
  signal?.throwIfAborted();
  if (config.useMock) return { role: 'assistant', content: mockCoachReply(messages, systemPrompt) };

  const fail = (status, code, message) => Object.assign(new Error(message), {status, code});
  if (config.provider !== 'doubao' || !config.doubaoApiKey?.trim() || !config.model?.trim()) {
    throw fail(503, 'MODEL_NOT_CONFIGURED', '教练模型尚未配置完整，请联系管理员检查模型和密钥。');
  }
  // Never send an Ark credential to a redirect or an arbitrary configured host.
  const base = (config.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '');
  if (!['https://ark.cn-beijing.volces.com/api/v3', 'https://ark.cn-beijing.volces.com/api/v3/responses'].includes(base)) {
    throw fail(503, 'MODEL_ENDPOINT_INVALID', '教练模型地址配置有误，请联系管理员检查。');
  }
  const endpoint = base.endsWith('/responses') ? base : base + '/responses';
  const controller = new AbortController();
  const cancel=()=>controller.abort(signal.reason);
  signal?.addEventListener('abort',cancel,{once:true});
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs || 35000);
  const timeout = () => fail(504, 'MODEL_TIMEOUT', '教练回复超时了，文字已保留，请稍后重试。');
  try {
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: {'Content-Type': 'application/json', Authorization: `Bearer ${config.doubaoApiKey}`},
        body: JSON.stringify({
          model: config.model,
          input: [{role: 'system', content: systemPrompt}, ...messages.map(({role, content}) => ({role, content}))],
          store: false, stream: false, thinking: {type: 'disabled'}, max_output_tokens: maxOutputTokens,
          ...jsonOutput?{text:{format:responseSchema?{type:'json_schema',...responseSchema}:{type:'json_object'}}}:{}
        })
      });
    } catch {
      signal?.throwIfAborted();
      if (controller.signal.aborted) throw timeout();
      throw fail(502, 'MODEL_CONNECTION_FAILED', '暂时无法连接教练模型，文字已保留，请稍后重试。');
    }
    if (!response.ok) {
      // Inspect only the provider code; never echo upstream account IDs, headers or messages.
      const providerCode=await response.json().then(body=>body?.error?.code).catch(()=>null);
      await response.body?.cancel().catch(() => {});
      if(providerCode==='SetLimitExceeded')throw fail(503, 'MODEL_USAGE_LIMIT', '豆包已达到账户设置的用量上限，服务暂时停止。请管理员在火山方舟“模型开通”页检查安全体验模式或用量上限。文字已保留，调整后可以重试。');
      if (response.status === 401) throw fail(503, 'MODEL_AUTH_FAILED', '教练模型连接凭据已失效，请联系管理员更新。');
      if ([402, 403, 404].includes(response.status)) throw fail(503, 'MODEL_UNAVAILABLE', '教练模型暂不可用，请联系管理员检查模型权限和额度。');
      if (response.status === 429) throw fail(429, 'MODEL_BUSY', '教练暂时繁忙，请稍后重试。');
      throw fail(502, 'MODEL_REQUEST_FAILED', '教练暂时没有回复，文字已保留，请稍后重试。');
    }
    let data;
    try { data = await response.json(); }
    catch {
      signal?.throwIfAborted();
      if (controller.signal.aborted) throw timeout();
      throw fail(502, 'INVALID_MODEL_REPLY', '没有收到完整的教练回复，请重试。');
    }
    if (data?.status !== 'completed' || !Array.isArray(data.output)) {
      throw fail(502, 'INCOMPLETE_MODEL_REPLY', '教练这次没能完成回复，文字已保留，请重试。');
    }
    // Extract only the assistant's final text, never reasoning/tool output.
    const content = data.output.filter(item => item?.type === 'message' && item.role === 'assistant')
      .flatMap(item => Array.isArray(item.content) ? item.content : [])
      .filter(part => part?.type === 'output_text' && typeof part.text === 'string')
      .map(part => part.text).join('\n').trim();
    if (!content || content.length > maxReplyLength) throw fail(502, 'INVALID_MODEL_REPLY', '教练这次没能组织好回复，请重试。');
    return {role: 'assistant', content};
  } finally { clearTimeout(timer);signal?.removeEventListener('abort',cancel); }
}
