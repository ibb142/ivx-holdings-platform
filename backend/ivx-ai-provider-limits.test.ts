import { afterEach, expect, spyOn, test } from 'bun:test';
import * as ai from 'ai';
import * as state from './services/ivx-provider-state-machine';
import * as fallback from './services/ivx-ai-provider-fallback';
import { requestIVXAIText } from './ivx-ai-runtime';
import { getAIQueueSnapshot } from './services/ivx-ai-queue';

const originalKey = process.env.IVX_AI_GATEWAY_KEY;
const originalCanonicalKey = process.env.AI_GATEWAY_API_KEY;
const originalDirectKey = process.env.IVX_OPENAI_DIRECT_API_KEY;
const originalFetch = globalThis.fetch;
const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
  if (originalKey === undefined) delete process.env.IVX_AI_GATEWAY_KEY;
  else process.env.IVX_AI_GATEWAY_KEY = originalKey;
  if (originalCanonicalKey === undefined) delete process.env.AI_GATEWAY_API_KEY;
  else process.env.AI_GATEWAY_API_KEY = originalCanonicalKey;
  if (originalDirectKey === undefined) delete process.env.IVX_OPENAI_DIRECT_API_KEY;
  else process.env.IVX_OPENAI_DIRECT_API_KEY = originalDirectKey;
  globalThis.fetch = originalFetch;
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
