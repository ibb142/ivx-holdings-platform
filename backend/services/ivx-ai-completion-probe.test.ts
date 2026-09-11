import { afterEach, expect, test } from 'bun:test';
import { probeGatewayCompletion } from './ivx-ai-completion-probe';
import { getProviderHealth, initProviderStateMachine, markFallbackReady, markProviderReady, resetProviderStateMachine } from './ivx-provider-state-machine';

afterEach(resetProviderStateMachine);
const complete = { choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }] };
const run = (fetchImpl: typeof fetch, timeoutMs = 100) => probeGatewayCompletion({
  url: 'https://gateway.example/v1/chat/completions', apiKey: 'local-probe-fixture', model: 'local-model', provider: 'local-provider', fetchImpl, timeoutMs,
});

test('only a complete nonempty assistant response makes the provider ready', async () => {
  initProviderStateMachine('local-provider', 'local-model', true, false);
  const result = await run((async (_url, init) => {
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body)).stream).toBe(false);
    return Response.json(complete);
  }) as typeof fetch);
  expect(result.ok).toBe(true);
  expect(getProviderHealth().state).toBe('PROVIDER_READY');
});

test('HTML, malformed JSON, empty choices, empty output and error envelopes cannot claim readiness', async () => {
  for (const body of ['<html>Gateway page</html>', '{invalid', '{}', '{"choices":[]}',
    JSON.stringify({ choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'stop' }] }),
    JSON.stringify({ ...complete, error: { message: 'failed' } }),
    JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'partial' }, finish_reason: null }] })]) {
    markProviderReady('local-provider', 'local-model');
    const result = await run((async () => new Response(body, { status: 200 })) as typeof fetch);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('AI_PROBE_INVALID_RESPONSE');
    expect(getProviderHealth().state).toBe('AI_UNAVAILABLE');
  }
});

test('credit failure clears prior primary readiness with a specific reason', async () => {
  markProviderReady('local-provider', 'local-model');
  const result = await run((async () => Response.json({ error: 'requires a positive credit balance' }, { status: 402 })) as typeof fetch);
  expect(result.code).toBe('AI_CREDITS_REQUIRED');
  expect(getProviderHealth().lastHttpStatus).toBe(402);
  expect(getProviderHealth().state).toBe('AI_UNAVAILABLE');
});

test('deadline covers a hanging response body even when the transport ignores abort', async () => {
  const result = await run((async () => new Response(new ReadableStream({ start() {} }))) as typeof fetch, 20);
  expect(result.ok).toBe(false);
  expect(result.code).toBe('AI_PROBE_TIMEOUT');
  expect(result.latencyMs).toBeLessThan(250);
});

test('deadline also bounds headers when the transport never settles', async () => {
  const result = await run((() => new Promise(() => {})) as typeof fetch, 20);
  expect(result.ok).toBe(false);
  expect(result.code).toBe('AI_PROBE_TIMEOUT');
  expect(result.latencyMs).toBeLessThan(250);
});

test('oversized completion and failed HTTP status cannot pass', async () => {
  const large = await run((async () => new Response('x'.repeat(65537))) as typeof fetch);
  expect(large.code).toBe('AI_PROBE_INVALID_RESPONSE');
  const failed = await run((async () => Response.json(complete, { status: 503 })) as typeof fetch);
  expect(failed.ok).toBe(false);
  expect(failed.status).toBe(503);
});

test('a primary probe failure preserves an independently ready approved fallback', async () => {
  markFallbackReady('approved-fallback', 'fallback-model');
  const result = await run((async () => new Response('unavailable', { status: 503 })) as typeof fetch);
  expect(result.ok).toBe(false);
  expect(getProviderHealth().state).toBe('FALLBACK_READY');
});

test('an older failed probe cannot overwrite a later successful request', async () => {
  initProviderStateMachine('local-provider', 'local-model', true, false);
  const result = await run((async () => {
    markProviderReady('approved-recovered-provider', 'recovered-model');
    return new Response('old failure', { status: 503 });
  }) as typeof fetch);
  expect(result.ok).toBe(false);
  expect(getProviderHealth().state).toBe('PROVIDER_READY');
  expect(getProviderHealth().provider).toBe('approved-recovered-provider');
});
