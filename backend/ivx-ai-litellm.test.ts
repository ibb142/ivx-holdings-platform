import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { generateText } from 'ai';
import { getIVXAIGatewayApiKey, getIVXAIConfigurationSnapshot, requestIVXAIText,
  streamIVXAIText, validateIVXAIStartup } from './ivx-ai-runtime';
import { getIVXLiteLLMConfig, resolveIVXAIProviderModel } from './services/ivx-litellm-provider';
import { autoDetectGatewayBaseUrl, getIVXApiKey } from './services/ivx-provider-autodetect';
import * as fallback from './services/ivx-ai-provider-fallback';
import * as state from './services/ivx-provider-state-machine';
import { getAIQueueSnapshot } from './services/ivx-ai-queue';
import { createBudgetedFetch } from './services/ivx-global-ai-budget-fetch';
import { GlobalAIBudgetError } from './services/ivx-global-ai-budget';

const names = ['IVX_AI_PROVIDER', 'IVX_AI_MODEL', 'OPENAI_API_BASE', 'OPENAI_API_KEY',
  'IVX_OPENAI_API_KEY', 'IVX_AI_GATEWAY_KEY', 'AI_GATEWAY_API_KEY'];
const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
const nativeFetch = globalThis.fetch;
const stops: Array<() => void> = [];
const spies: Array<{ mockRestore(): void }> = [];
const requests: Array<{ url: string; key: string | null; body: Record<string, unknown> }> = [];
const key = 'sk-local-test-credential-only';

function serve(handler: (request: Request) => Response | Promise<Response>): string {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: handler });
  stops.push(() => server.stop(true));
  return `http://127.0.0.1:${server.port}`;
}

beforeEach(() => {
  requests.length = 0;
  process.env.IVX_AI_PROVIDER = 'litellm';
  delete process.env.IVX_AI_MODEL;
  process.env.OPENAI_API_KEY = key;
  // Stale provider credentials must not override the explicit local selection.
  process.env.IVX_OPENAI_API_KEY = 'sk-stale-remote-fixture';
  process.env.IVX_AI_GATEWAY_KEY = 'vck_stale_remote_fixture';
  process.env.AI_GATEWAY_API_KEY = 'vck_stale_remote_fixture';
  const origin = serve(async request => {
    const body = await request.json() as Record<string, unknown>;
    requests.push({ url: request.url, key: request.headers.get('authorization'), body });
    if (request.headers.get('authorization') !== `Bearer ${key}`) {
      return Response.json({ error: { message: 'Invalid test credential', type: 'authentication_error' } }, { status: 401 });
    }
    const common = { id: 'chatcmpl-local-fixture', created: 1, model: 'ivx-local-chat' };
    if (body.stream) {
      const events = [
        { ...common, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: 'Hola local' }, finish_reason: null }] },
        { ...common, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
        { ...common, object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 } },
      ];
      return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } });
    }
    return Response.json({ ...common, object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Hola local' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 } });
  });
  process.env.OPENAI_API_BASE = origin + '/v1';
  globalThis.fetch = (async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== origin) throw new Error('Test prevented a request to another provider');
    return nativeFetch(input, init);
  }) as typeof fetch;
  state.resetProviderStateMachine();
  state.initProviderStateMachine('litellm', 'ivx-local-chat', true, false);
});

afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
  for (const stop of stops.splice(0)) stop();
  globalThis.fetch = nativeFetch;
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  state.resetProviderStateMachine();
});

test('explicit LiteLLM config supersedes stale credentials and reports the actual endpoint', () => {
  expect(getIVXAIGatewayApiKey()).toBe(key);
  expect(getIVXApiKey()).toBe(key);
  expect(autoDetectGatewayBaseUrl()).toBe(process.env.OPENAI_API_BASE);
  expect(validateIVXAIStartup()).toMatchObject({ ok: true, providerType: 'litellm', model: 'ivx-local-chat', keyPrefix: 'configured' });
  expect(getIVXAIConfigurationSnapshot()).toMatchObject({ configured: true, model: 'ivx-local-chat', endpoint: process.env.OPENAI_API_BASE });
  expect(fallback.getIVXProviderChainSnapshot()).toMatchObject({ primary: { name: 'litellm' }, fallbacks: [], fallbackEnabled: false });
});

test('missing local credentials cannot use stale owner provider keys', async () => {
  delete process.env.OPENAI_API_KEY;
  expect(getIVXAIGatewayApiKey()).toBe('');
  expect(validateIVXAIStartup().ok).toBe(false);
  await expect(requestIVXAIText({ module: 'local-test', prompt: 'Hola', maxOutputTokens: 8 })).rejects.toThrow();
  expect(requests).toHaveLength(0);
  expect(getAIQueueSnapshot().short.active).toBe(0);
});

test('real SDK chat adapter sends the selected model and key only to Chat Completions', async () => {
  const result = await requestIVXAIText({ module: 'local-test', prompt: 'Hola', maxOutputTokens: 8 });
  expect(result.text).toBe('Hola local');
  expect(result.providerMetadata).toMatchObject({ provider: 'litellm', source: 'remote_api',
    model: 'ivx-local-chat', endpoint: process.env.OPENAI_API_BASE, ivxAI: { providerDependency: 'self_hosted_litellm' } });
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ url: process.env.OPENAI_API_BASE + '/chat/completions', key: `Bearer ${key}`, body: { model: 'ivx-local-chat' } });
  expect(getAIQueueSnapshot().short.active).toBe(0);
});

test('real SDK streaming uses the same local route and returns local provider metadata', async () => {
  const chunks = [];
  for await (const chunk of streamIVXAIText({ module: 'local-test', prompt: 'Hola', maxOutputTokens: 8 })) chunks.push(chunk);
  expect(chunks.filter(chunk => chunk.type === 'delta').map(chunk => chunk.delta).join('')).toBe('Hola local');
  expect(chunks.at(-1)).toMatchObject({ type: 'done', providerMetadata: { provider: 'litellm', model: 'ivx-local-chat' } });
  expect(requests).toHaveLength(1);
  expect(requests[0].body).toMatchObject({ model: 'ivx-local-chat', stream: true });
  expect(getAIQueueSnapshot().short.active).toBe(0);
});

test('local 401 does not retry or call a paid fallback', async () => {
  process.env.OPENAI_API_KEY = 'sk-invalid-local-fixture';
  const alternate = spyOn(fallback, 'attemptProviderFallback').mockResolvedValue(null);
  spies.push(alternate);
  await expect(requestIVXAIText({ module: 'local-test', prompt: 'Hola', maxOutputTokens: 8 })).rejects.toThrow();
  expect(requests).toHaveLength(1);
  expect(alternate).not.toHaveBeenCalled();
  expect(getAIQueueSnapshot().short.active).toBe(0);
});

test('direct fallback callers also stop when LiteLLM is selected', async () => {
  expect(await fallback.attemptProviderFallback({ module: 'local-test', requestId: null,
    system: '', prompt: 'Hola', messages: [], maxOutputTokens: 8, timeoutMs: 100 })).toBeNull();
  expect(requests).toHaveLength(0);
});

test('the global budget guard can reject a local model before any inference', async () => {
  let admissions = 0;
  globalThis.fetch = createBudgetedFetch(globalThis.fetch, { enabled: () => true, reserve: async () => {
    admissions++;
    throw new GlobalAIBudgetError('unpriced provider operation');
  } });
  const before = state.getProviderHealth();
  await expect(requestIVXAIText({ module: 'local-test', prompt: 'Hola', maxOutputTokens: 8 })).rejects.toThrow('unpriced provider operation');
  expect(admissions).toBe(1);
  expect(requests).toHaveLength(0);
  expect(state.getProviderHealth()).toEqual(before);
  expect(getAIQueueSnapshot().short.active).toBe(0);
});

test('cancelling local inference aborts the HTTP request and releases admission', async () => {
  const controller = new AbortController();
  let observedAbort = false;
  globalThis.fetch = ((_input, init) => new Promise<Response>((_resolve, reject) => {
    init!.signal!.addEventListener('abort', () => { observedAbort = true; reject(init!.signal!.reason); }, { once: true });
    controller.abort(new Error('local test cancelled'));
  })) as typeof fetch;
  await expect(requestIVXAIText({ module: 'local-test', prompt: 'Hola', maxOutputTokens: 8,
    abortSignal: controller.signal })).rejects.toThrow();
  expect(observedAbort).toBe(true);
  expect(getAIQueueSnapshot().short.active).toBe(0);
});

test('text-only pilot rejects attachments before sending an inference request', async () => {
  await expect(requestIVXAIText({ module: 'local-test', prompt: 'Describe',
    images: [{ url: 'https://example.invalid/photo.jpg' }] })).rejects.toThrow('text only');
  expect(requests).toHaveLength(0);
});

test('malformed endpoint settings fail without leaking URL credentials', () => {
  for (const value of ['http://user:private-value@localhost:4000/v1', 'http://localhost:4000/v1?token=private-value', 'file:///v1', 'http://localhost:4000']) {
    process.env.OPENAI_API_BASE = value;
    expect(getIVXLiteLLMConfig).toThrow('LiteLLM');
    try { getIVXLiteLLMConfig(); } catch (error) { expect(String(error)).not.toContain('private-value'); }
  }
});

test('redirects cannot forward the prompt to another endpoint', async () => {
  let redirectedRequests = 0;
  const destination = serve(() => { redirectedRequests++; return new Response('unexpected'); });
  const redirector = serve(() => Response.redirect(destination + '/capture', 307));
  process.env.OPENAI_API_BASE = redirector + '/v1';
  globalThis.fetch = nativeFetch;
  await expect(generateText({ model: resolveIVXAIProviderModel('ivx-local-chat'), prompt: 'Hola', maxRetries: 0 })).rejects.toThrow();
  expect(redirectedRequests).toBe(0);
});

test('without the explicit opt-in, the current SDK provider selection is preserved', () => {
  delete process.env.IVX_AI_PROVIDER;
  expect(getIVXLiteLLMConfig()).toBeNull();
  expect(resolveIVXAIProviderModel('openai/gpt-4o')).toBe('openai/gpt-4o');
});
