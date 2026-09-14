import { createOpenAI } from '@ai-sdk/openai';
import { isBlockedDomain } from './ivx-domain-blocklist';

/** Explicit opt-in; existing deployments keep their current provider. */
export function isIVXLiteLLMEnabled(): boolean {
  return process.env.IVX_AI_PROVIDER?.trim().toLowerCase() === 'litellm';
}

export function getIVXLiteLLMConfig(): { baseURL: string; apiKey: string; model: string } | null {
  if (!isIVXLiteLLMEnabled()) return null;
  let url: URL;
  try { url = new URL(process.env.OPENAI_API_BASE?.trim() ?? ''); }
  catch { throw new Error('LiteLLM requires a valid OPENAI_API_BASE ending in /v1'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || url.search || url.hash || !url.pathname.replace(/\/+$/, '').endsWith('/v1')
      || isBlockedDomain(url.hostname)) {
    throw new Error('LiteLLM OPENAI_API_BASE must be an HTTP(S) /v1 endpoint without credentials or query parameters');
  }
  return {
    baseURL: url.toString().replace(/\/+$/, ''),
    // Never fall back to a cached owner key or a key for a paid provider.
    apiKey: process.env.OPENAI_API_KEY?.trim() ?? '',
    model: process.env.IVX_AI_MODEL?.trim() || 'ivx-local-chat',
  };
}

/** Use Chat Completions explicitly: the OpenAI adapter defaults to Responses. */
export function resolveIVXAIProviderModel(model: string) {
  const local = getIVXLiteLLMConfig();
  if (!local) return model;
  if (!local.apiKey) throw new Error('LiteLLM requires OPENAI_API_KEY');
  const endpoint = `${local.baseURL}/chat/completions`;
  return createOpenAI({
    name: 'litellm',
    baseURL: local.baseURL,
    apiKey: local.apiKey,
    fetch: (input, init) => {
      const target = input instanceof Request ? input.url : String(input);
      if (target !== endpoint) throw new Error('LiteLLM adapter attempted an unexpected endpoint');
      // Keep the installed global budget fetch guard and cancellation signal.
      // A redirect must not forward prompts or credentials to a different host.
      return globalThis.fetch(input, { ...init, redirect: 'error' });
    },
  }).chat(model);
}
