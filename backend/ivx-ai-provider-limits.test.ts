import { afterEach, expect, spyOn, test } from 'bun:test';
import * as ai from 'ai';
import * as timers from 'node:timers/promises';
import { createGateway } from '@ai-sdk/gateway';
import * as state from './services/ivx-provider-state-machine';
import * as fallback from './services/ivx-ai-provider-fallback';
import { requestIVXAIText, streamIVXAIText } from './ivx-ai-runtime';
import { getAIQueueSnapshot } from './services/ivx-ai-queue';
import * as queue from './services/ivx-ai-queue';
import { createBudgetedFetch } from './services/ivx-global-ai-budget-fetch';
import { GlobalAIBudgetError } from './services/ivx-global-ai-budget';

const originalKey = process.env.IVX_AI_GATEWAY_KEY;
const originalCanonicalKey = process.env.AI_GATEWAY_API_KEY;
const originalDirectKey = process.env.IVX_OPENAI_DIRECT_API_KEY;
const originalFetch = globalThis.fetch;
const credentialNames = ['IVX_AI_GATEWAY_KEY', 'AI_GATEWAY_API_KEY', 'IVX_VERCEL_GATEWAY_API_KEY',
  'IVX_OPENAI_DIRECT_API_KEY', 'IVX_OPENAI_API_KEY', 'OPENAI_API_KEY', 'IVX_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY'];
const originalCredentials = Object.fromEntries(credentialNames.map(name => [name, process.env[name]]));
const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
  state.resetProviderStateMachine();
  if (originalKey === undefined) delete process.env.IVX_AI_GATEWAY_KEY;
  else process.env.IVX_AI_GATEWAY_KEY = originalKey;
  if (originalCanonicalKey === undefined) delete process.env.AI_GATEWAY_API_KEY;
  else process.env.AI_GATEWAY_API_KEY = originalCanonicalKey;
  if (originalDirectKey === undefined) delete process.env.IVX_OPENAI_DIRECT_API_KEY;
  else process.env.IVX_OPENAI_DIRECT_API_KEY = originalDirectKey;
  globalThis.fetch = originalFetch;
  for (const [name, value] of Object.entries(originalCredentials)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});
function setup() {
  process.env.IVX_AI_GATEWAY_KEY = 'vck_qa_fixture';
  spies.push(spyOn(state, 'shouldTryPrimary').mockReturnValue(true));
  spies.push(spyOn(state, 'shouldTryFallback').mockReturnValue(true));
  spies.push(spyOn(Math, 'random').mockReturnValue(0));
  const alternative = spyOn(fallback, 'attemptProviderFallback').mockResolvedValue(null);
  spies.push(alternative);
  return alternative;
}
const result = { text:'fixture recovery', usage:{inputTokens:2,outputTokens:2,totalTokens:4} } as Awaited<ReturnType<typeof ai.generateText>>;
test('local budget rejection preserves provider health and the next admitted request can run', async () => {
  process.env.IVX_AI_GATEWAY_KEY = 'vck_qa_fixture';
  state.initProviderStateMachine('vercel_ai_gateway', 'openai/gpt-4o', true, true);
  state.markProviderReady('vercel_ai_gateway', 'openai/gpt-4o');
  const before = state.getProviderHealth();
  const alternative = spyOn(fallback, 'attemptProviderFallback').mockResolvedValue(null);
  spies.push(alternative);
  let upstreamCalls = 0;
  const guarded = createBudgetedFetch((async () => { upstreamCalls++; throw new Error('unexpected upstream request'); }) as typeof fetch, {
    enabled:() => true, reserve:async () => { throw new GlobalAIBudgetError('global_capacity_exceeded'); },
  });
  const gateway = createGateway({apiKey:'vck_qa_fixture',fetch:guarded});
  // Exercise the real SDK error adapter before injecting its error into the
  // runtime, so responseBody nested in cause cannot hide the local rejection.
  const denial = await ai.generateText({model:gateway('openai/gpt-4o'),prompt:'fixture',maxRetries:0}).catch(error => error);
  expect(upstreamCalls).toBe(0);
  expect(fallback.classifyProviderFailure(denial)).toBe('rate_limit');
  expect(fallback.providerRetryAfterMs(denial)).toBe(2000);
  // Exhaust this caller's retry deadline without a multi-second test wait.
  spies.push(spyOn(fallback, 'providerRetryAfterMs').mockReturnValue(3_600_000));
  const call = spyOn(ai, 'generateText').mockRejectedValueOnce(denial).mockResolvedValue(result);
  spies.push(call);
  await expect(requestIVXAIText({module:'provider-limit-fixture',prompt:'fixture',maxOutputTokens:4})).rejects.toThrow('global_capacity_exceeded');
  expect(state.getProviderHealth()).toEqual(before);
  expect(getAIQueueSnapshot().short.active).toBe(0);
  expect((await requestIVXAIText({module:'provider-limit-fixture',prompt:'fixture',maxOutputTokens:4})).text).toBe('fixture recovery');
  expect(call).toHaveBeenCalledTimes(2);
  expect(alternative).toHaveBeenCalledTimes(0);
});

test('a local daily budget rejection remains closed without invalidating healthy credentials', async () => {
  process.env.IVX_AI_GATEWAY_KEY = 'vck_qa_fixture';
  state.initProviderStateMachine('vercel_ai_gateway', 'openai/gpt-4o', true, true);
  state.markProviderReady('vercel_ai_gateway', 'openai/gpt-4o');
  const before = state.getProviderHealth();
  const alternative = spyOn(fallback, 'attemptProviderFallback').mockResolvedValue(null);
  spies.push(alternative);
  const call = spyOn(ai, 'generateText').mockRejectedValue(Object.assign(new Error('Global AI budget: global_daily_budget_exceeded'), {
    statusCode:402, responseBody:JSON.stringify({error:{type:'quota_for_entity_exceeded',code:'IVX_GLOBAL_AI_BUDGET_BLOCKED'}}),
  }));
  spies.push(call);
  await expect(requestIVXAIText({module:'provider-limit-fixture',prompt:'fixture',maxOutputTokens:4})).rejects.toThrow('global_daily_budget_exceeded');
  expect(call).toHaveBeenCalledTimes(1);
  expect(alternative).toHaveBeenCalledTimes(0);
  expect(state.getProviderHealth()).toEqual(before);
  expect(getAIQueueSnapshot().short.active).toBe(0);
});

test('a real provider billing rejection still records unavailable health', async () => {
  process.env.IVX_AI_GATEWAY_KEY = 'vck_qa_fixture';
  state.initProviderStateMachine('vercel_ai_gateway', 'openai/gpt-4o', true, true);
  state.markProviderReady('vercel_ai_gateway', 'openai/gpt-4o');
  const call = spyOn(ai, 'generateText').mockRejectedValue(Object.assign(new Error('Provider credits exhausted'), {
    statusCode:402,responseBody:'{"error":{"type":"quota_for_entity_exceeded"}}',
  }));
  spies.push(call);
  await expect(requestIVXAIText({module:'provider-limit-fixture',prompt:'fixture',maxOutputTokens:4})).rejects.toThrow('Provider credits exhausted');
  expect(state.getProviderHealth().state).toBe('AI_UNAVAILABLE');
  expect(call).toHaveBeenCalledTimes(1);
});

test('402 and insufficient quota stop without another billable provider attempt', async () => {
  const alternative = setup();
  const call = spyOn(ai, 'generateText').mockRejectedValue(Object.assign(new Error('Budget exhausted'), {
    statusCode:402, responseBody:'{"error":{"type":"quota_for_entity_exceeded"}}',
  }));
  spies.push(call);
  await expect(requestIVXAIText({module:'provider-limit-fixture',prompt:'fixture',maxOutputTokens:4})).rejects.toThrow();
  expect(call).toHaveBeenCalledTimes(1);
  expect(alternative).toHaveBeenCalledTimes(0);
  expect(fallback.classifyProviderFailure(Object.assign(new Error('Request denied'),{statusCode:429,responseBody:'{"error":{"code":"insufficient_quota"}}'}))).toBe('quota');
  expect(fallback.isFailureRetryable('quota')).toBe(false);
  expect(getAIQueueSnapshot().short.active).toBe(0);
});
test('structured 429 honors Retry-After, retains admission and recovers', async () => {
  const alternative = setup();
  const attempted: number[] = [];
  const call = spyOn(ai, 'generateText').mockImplementation(async () => {
    attempted.push(Date.now());
    expect(getAIQueueSnapshot().short.active).toBe(1);
    if (attempted.length === 1) throw Object.assign(new Error('Slow down'),{statusCode:429,responseHeaders:{'retry-after':'0.03'}});
    return result;
  });
  spies.push(call);
  const response=await requestIVXAIText({module:'provider-limit-fixture',prompt:'fixture',maxOutputTokens:4});
  expect(response.text).toBe('fixture recovery');
  expect(attempted).toHaveLength(2);
  expect(attempted[1]-attempted[0]).toBeGreaterThanOrEqual(30);
  expect(alternative).toHaveBeenCalledTimes(0);
  expect(getAIQueueSnapshot().short).toMatchObject({active:0,waiting:0});
});
for (const cancel of [false, true]) test(`early retry timer cannot ${cancel ? 'ignore cancellation' : 'start another provider attempt'}`, async () => {
  const alternative = setup();
  const controller = new AbortController();
  let now = Date.now();
  const started = now, attempted: number[] = [];
  spies.push(spyOn(Date, 'now').mockImplementation(() => now));
  spies.push(spyOn(timers, 'setTimeout').mockImplementation((async (delay, value, options) => {
    options?.signal?.throwIfAborted();
    // Reproduce the CI timer waking one millisecond before Retry-After.
    now += Math.max(1, Number(delay) - 1);
    if (cancel) controller.abort(new Error('QA cancelled during retry'));
    return value;
  }) as typeof timers.setTimeout));
  const call = spyOn(ai, 'generateText').mockImplementation(async () => {
    attempted.push(now);
    expect(getAIQueueSnapshot().short.active).toBe(1);
    if (attempted.length === 1) throw Object.assign(new Error('Slow down'), {
      statusCode: 429, responseHeaders: { 'retry-after': '0.03' },
    });
    return result;
  });
  spies.push(call);
  const response = requestIVXAIText({ module: 'provider-limit-fixture', prompt: 'fixture',
    maxOutputTokens: 4, abortSignal: controller.signal });
  if (cancel) {
    await expect(response).rejects.toThrow('QA cancelled during retry');
    expect(attempted).toEqual([started]);
  } else {
    expect((await response).text).toBe('fixture recovery');
    expect(attempted).toEqual([started, started + 30]);
  }
  expect(alternative).toHaveBeenCalledTimes(0);
  expect(getAIQueueSnapshot().short).toMatchObject({ active: 0, waiting: 0 });
});

test('provider Retry-After beyond the request deadline rejects instead of retrying early', async () => {
  const alternative = setup();
  const call=spyOn(ai,'generateText').mockRejectedValue(Object.assign(new Error('Slow down'),{statusCode:429,responseHeaders:{'retry-after':'3600'}}));
  spies.push(call);
  await expect(requestIVXAIText({module:'provider-limit-fixture',prompt:'fixture',maxOutputTokens:4})).rejects.toThrow();
  expect(call).toHaveBeenCalledTimes(1);
  expect(alternative).toHaveBeenCalledTimes(0);
  expect(getAIQueueSnapshot().short.active).toBe(0);
});
test('fallback HTTP cancellation ends the chain without spending on another provider', async () => {
  process.env.IVX_OPENAI_DIRECT_API_KEY = 'sk-qa-fixture';
  process.env.IVX_AI_GATEWAY_KEY = 'vck_qa_fixture';
  const controller = new AbortController();
  let requests = 0;
  globalThis.fetch = (async (_url, options) => new Promise((_resolve, reject) => {
    requests++;
    options!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once:true });
    controller.abort();
  })) as typeof fetch;
  const output = await fallback.attemptProviderFallback({module:'provider-limit-fixture',requestId:null,
    system:'',prompt:'fixture',messages:[],maxOutputTokens:4,timeoutMs:1000,abortSignal:controller.signal});
  expect(output).toBeNull();
  expect(requests).toBe(1);
});

test('closing a stream consumer aborts provider work before returning its queue slot', async () => {
  setup();
  let signal: AbortSignal | undefined;
  const call = spyOn(ai, 'streamText').mockImplementation((options) => {
    signal = options.abortSignal;
    return { textStream: (async function* () { yield 'partial'; yield 'more'; })(),
      usage: Promise.resolve({ inputTokens: 2, outputTokens: 1 }) } as ReturnType<typeof ai.streamText>;
  });
  spies.push(call);
  const stream = streamIVXAIText({ module: 'provider-limit-fixture', prompt: 'fixture', maxOutputTokens: 4 });
  expect((await stream.next()).value).toMatchObject({ type: 'delta', delta: 'partial' });
  expect(getAIQueueSnapshot().short.active).toBe(1);
  await stream.return();
  expect(signal?.aborted).toBe(true);
  expect(getAIQueueSnapshot().short).toMatchObject({ active: 0, waiting: 0 });
});

test('a provider stream ending on cancellation cannot report successful partial work', async () => {
  setup();
  const controller = new AbortController();
  spies.push(spyOn(ai, 'streamText').mockReturnValue({
    textStream: (async function* () { yield 'partial'; controller.abort(); })(),
    usage: Promise.resolve({ inputTokens: 2, outputTokens: 1 }),
  } as ReturnType<typeof ai.streamText>));
  const chunks = [];
  for await (const chunk of streamIVXAIText({ module: 'provider-limit-fixture', prompt: 'fixture',
    maxOutputTokens: 4, abortSignal: controller.signal })) chunks.push(chunk);
  expect(chunks.at(-1)).toMatchObject({ type: 'done', text: 'partial', error: 'Generation stopped by user.' });
  expect(getAIQueueSnapshot().short.active).toBe(0);
});

test('stream admission rejection is returned as one explicit error without a provider call', async () => {
  setup();
  const controller = new AbortController(); controller.abort(new Error('fixture admission cancelled'));
  const call = spyOn(ai, 'streamText'); spies.push(call);
  const chunks = [];
  for await (const chunk of streamIVXAIText({ module: 'provider-limit-fixture', prompt: 'fixture',
    maxOutputTokens: 4, abortSignal: controller.signal })) chunks.push(chunk);
  expect(chunks).toEqual([{ type: 'error', error: 'fixture admission cancelled' }]);
  expect(call).toHaveBeenCalledTimes(0);
});

test('cancellation after queue admission prevents the first billable attempt', async () => {
  const alternative = setup();
  const controller = new AbortController();
  const acquire = queue.acquireAIQueueSlot;
  spies.push(spyOn(queue, 'acquireAIQueueSlot').mockImplementation(async (...args) => {
    const slot = await acquire(...args); controller.abort(new Error('cancelled after admission')); return slot;
  }));
  const call = spyOn(ai, 'generateText').mockResolvedValue(result); spies.push(call);
  await expect(requestIVXAIText({ module: 'provider-limit-fixture', prompt: 'fixture',
    maxOutputTokens: 4, abortSignal: controller.signal })).rejects.toThrow('cancelled after admission');
  expect(call).toHaveBeenCalledTimes(0);
  expect(alternative).toHaveBeenCalledTimes(0);
  expect(getAIQueueSnapshot().short.active).toBe(0);
});

test('a deadline expiring after retry scheduling prevents another provider call', async () => {
  const alternative = setup();
  let now = Date.now();
  spies.push(spyOn(Date, 'now').mockImplementation(() => now));
  spies.push(spyOn(Math, 'random').mockImplementation(() => { now += 120_001; return 0; }));
  const call = spyOn(ai, 'generateText').mockRejectedValue(Object.assign(new Error('temporarily unavailable'), { statusCode: 503 }));
  spies.push(call);
  await expect(requestIVXAIText({ module: 'provider-limit-fixture', prompt: 'fixture', maxOutputTokens: 4 })).rejects.toThrow();
  expect(call).toHaveBeenCalledTimes(1);
  expect(alternative).toHaveBeenCalledTimes(0);
  expect(getAIQueueSnapshot().short.active).toBe(0);
});

test('fallback excludes the failed primary credential even when it is configured under several aliases', async () => {
  for (const name of credentialNames) delete process.env[name];
  process.env.IVX_AI_GATEWAY_KEY = 'vck_failed_fixture';
  process.env.AI_GATEWAY_API_KEY = 'vck_failed_fixture';
  let requests = 0;
  globalThis.fetch = (async () => { requests++; return new Response('{}', { status: 401 }); }) as typeof fetch;
  const output = await fallback.attemptProviderFallback({ module: 'provider-limit-fixture', requestId: null,
    system: '', prompt: 'fixture', messages: [], maxOutputTokens: 4, timeoutMs: 1000,
    excludedApiKey: 'vck_failed_fixture' });
  expect(output).toBeNull();
  expect(requests).toBe(0);
});
