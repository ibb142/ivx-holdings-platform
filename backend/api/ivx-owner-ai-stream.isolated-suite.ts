// mock.module is process-global; the discovered wrapper isolates these stubs.
import { beforeEach, expect, mock, test } from 'bun:test';

type Chunk = { type: 'delta' | 'done'; delta?: string; text?: string };
type Input = { abortSignal?: AbortSignal; maxOutputTokens?: number };
const normal = async function* (_input: Input): AsyncGenerator<Chunk> {
  yield { type: 'delta', delta: 'response' };
  yield { type: 'done', text: 'response' };
};
const provider = mock(normal);
let permitted = true;
mock.module('../ivx-ai-runtime', () => ({
  computeAdaptiveTimeoutMs: () => 1000,
  streamIVXAIText: provider,
}));
mock.module('./owner-only', () => ({
  assertIVXOwnerOnly: async () => {
    if (!permitted) throw new Error('Missing bearer token');
    return { userId: 'fixture-owner' };
  },
  ownerOnlyJson: (body: unknown, status: number) => Response.json(body, { status }),
  ownerOnlyOptions: () => new Response(null, { status: 204 }),
}));
const { handleIVXOwnerAIStreamRequest } = await import('./ivx-owner-ai-stream');

function request(signal?: AbortSignal) {
  return new Request('https://ivx.test/api/ivx/owner-ai/stream', {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'fixture', maxOutputTokens: 64, requestId: 'fixture-request' }),
  });
}
beforeEach(() => { permitted = true; provider.mockClear(); provider.mockImplementation(normal); });

test('Owner authorization still rejects before any producer work', async () => {
  permitted = false;
  expect((await handleIVXOwnerAIStreamRequest(request())).status).toBe(401);
  expect(provider).toHaveBeenCalledTimes(0);
});

test('normal SSE completion preserves its event protocol and output cap', async () => {
  const response = await handleIVXOwnerAIStreamRequest(request());
  const events = (await response.text()).trim().split('\n\n').map(line => JSON.parse(line.slice(6)));
  expect(events.map(event => event.type)).toEqual(['start', 'delta', 'done']);
  expect(provider.mock.calls[0][0].maxOutputTokens).toBe(64);
  expect(provider.mock.calls[0][0].abortSignal?.aborted).toBe(false);
});

test('an already aborted HTTP request never reaches the provider', async () => {
  const controller = new AbortController();
  const req = request(controller.signal);
  controller.abort();
  expect(await (await handleIVXOwnerAIStreamRequest(req)).text()).toBe('');
  expect(provider).toHaveBeenCalledTimes(0);
});

for (const source of ['request', 'reader']) {
  test(`${source} cancellation reaches the provider before its first token`, async () => {
    const controller = new AbortController();
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    let stopped!: () => void;
    const finished = new Promise<void>(resolve => { stopped = resolve; });
    let signal: AbortSignal | undefined;
    provider.mockImplementation(async function* (input: Input) {
      signal = input.abortSignal;
      const aborted = new Promise<void>(resolve => signal?.addEventListener('abort', () => resolve(), { once: true }));
      started();
      try { await aborted; } finally { stopped(); }
      yield { type: 'done', text: 'must not be delivered after cancellation' };
    });
    const response = await handleIVXOwnerAIStreamRequest(request(controller.signal));
    const reader = response.body!.getReader();
    await entered;
    await reader.read(); // The start event precedes provider tokens.
    if (source === 'request') controller.abort();
    else await reader.cancel('client left');
    await finished;
    expect(signal?.aborted).toBe(true);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(await reader.read()).toEqual({ done: true, value: undefined });
  });
}
