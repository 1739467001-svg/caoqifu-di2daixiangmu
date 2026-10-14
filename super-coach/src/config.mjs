export function readConfig(env = process.env) {
  const raw = (env.USE_MOCK ?? 'true').trim().toLowerCase();
  if (!['true','false'].includes(raw)) throw new Error('USE_MOCK must be true or false');
  return Object.freeze({
    useMock: raw === 'true',
    provider: (env.AI_PROVIDER || 'doubao').trim(),
    doubaoApiKey: (env.DOUBAO_API_KEY || '').trim(),
    openaiApiKey: env.OPENAI_API_KEY || '',
    baseUrl: (env.AI_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').trim(),
    model: (env.AI_MODEL || '').trim(),
    requestTimeoutMs: 55000
  });
}
