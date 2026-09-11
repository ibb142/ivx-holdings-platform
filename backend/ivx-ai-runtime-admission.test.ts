import { afterEach, expect, spyOn, test } from 'bun:test';
import * as provider from './services/ivx-provider-state-machine';
import * as fallback from './services/ivx-ai-provider-fallback';
import { acquireAIQueueSlot, getAIQueueSnapshot } from './services/ivx-ai-queue';
import { requestIVXAIText } from './ivx-ai-runtime';
const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => { for (const spy of spies.splice(0)) spy.mockRestore(); });
function forceFallback() {
  spies.push(spyOn(provider, 'shouldTryPrimary').mockReturnValue(false));
  spies.push(spyOn(provider, 'shouldTryFallback').mockReturnValue(true));
  spies.push(spyOn(fallback, 'isFailureRetryable').mockReturnValue(true));
}
test('provider fallback retains admission during saturation and releases it on recovery', async () => {
  forceFallback();
  const releases: Array<() => void> = [];
  spies.push(spyOn(fallback, 'attemptProviderFallback').mockImplementation(() => new Promise(resolve => releases.push(() => resolve({
    text: 'controlled fixture', provider: 'openai_direct', model: 'fixture', latencyMs: 1 })))));
  const capacity = getAIQueueSnapshot().short.maxConcurrent;
  const calls = Array.from({ length: capacity }, (_, i) => requestIVXAIText({ module: 'admission-test', requestId: `fixture-${i}`, prompt: 'fixture', maxOutputTokens: 1 }));
  await new Promise(resolve => setImmediate(resolve));
  try {
    expect(releases.length).toBe(capacity);
    expect(getAIQueueSnapshot().short.active).toBe(capacity);
    await expect(acquireAIQueueSlot('short', { timeoutMs: 5 })).rejects.toThrow('AI queue wait timed out');
  } finally { for (const release of releases) release(); await Promise.all(calls); }
  expect(getAIQueueSnapshot().short.active).toBe(0);
  expect(getAIQueueSnapshot().short.waiting).toBe(0);
});
test('unexpected provider fallback failures cannot leak a model slot', async () => {
  forceFallback();
  spies.push(spyOn(fallback, 'attemptProviderFallback').mockRejectedValue(new Error('controlled provider failure')));
  await expect(requestIVXAIText({ module: 'admission-test', prompt: 'fixture', maxOutputTokens: 1 })).rejects.toThrow('controlled provider failure');
  expect(getAIQueueSnapshot().short.active).toBe(0);
});
