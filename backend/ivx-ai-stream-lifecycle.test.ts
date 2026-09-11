import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import * as sdk from 'ai';
import * as telemetry from './services/ivx-provider-telemetry';
import { getAIQueueSnapshot } from './services/ivx-ai-queue';
import { computeAdaptiveTimeoutMs, streamIVXAIText, type IVXAIStreamChunk } from './ivx-ai-runtime';

// Controlled SDK fixtures exercise lifecycle only; these are not real-provider evidence.
const input = { module: 'stream-lifecycle-test', prompt: 'fixture', maxOutputTokens: 16 };
const spies: Array<{ mockRestore(): void }> = [];
let oldKey: string | undefined;
beforeEach(() => {
  oldKey = process.env.IVX_OPENAI_API_KEY;
  process.env.IVX_OPENAI_API_KEY = 'sk-local-lifecycle-fixture';
  spies.push(spyOn(telemetry, 'recordProviderTelemetry').mockImplementation(() => undefined as never));
});
afterEach(() => {
  for (const spy of spies.splice(0).reverse()) spy.mockRestore();
  if (oldKey === undefined) delete process.env.IVX_OPENAI_API_KEY;
  else process.env.IVX_OPENAI_API_KEY = oldKey;
});
const collect = async (source: AsyncIterable<IVXAIStreamChunk>) => {
  const chunks: IVXAIStreamChunk[] = [];
  for await (const chunk of source) chunks.push(chunk);
  return chunks;
};
function fixture(make: (options: any) => any) {
  spies.push(spyOn(sdk, 'streamText').mockImplementation(make));
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
const turn = () => new Promise<void>(r => setImmediate(r));

test('partial provider failure is an error, never successful done', async () => {
  fixture(() => ({ textStream: (async function* () {
    yield 'partial';
    throw new Error('controlled provider failure');
  })(), usage: Promise.resolve(null) }));
  const chunks = await collect(streamIVXAIText(input));
  expect(chunks.map(c => c.type)).toEqual(['delta', 'error']);
  expect(chunks.at(-1)?.error).toContain('controlled provider failure');
  expect(getAIQueueSnapshot().short.active).toBe(0);
});

test('SDK error callback cannot be hidden by a normally ending text stream', async () => {
  fixture(options => ({ textStream: (async function* () {
    yield 'partial';
    options.onError?.({ error: new Error('controlled SDK error') });
  })(), usage: Promise.resolve(null) }));
  const chunks = await collect(streamIVXAIText(input));
  expect(chunks.map(c => c.type)).toEqual(['delta', 'error']);
  expect(chunks.at(-1)?.error).toContain('controlled SDK error');
});

test('deadline aborts a silent provider and releases admission without another delta', async () => {
  const stalled = deferred();
  let signal: AbortSignal | undefined;
  let expire: (() => void) | undefined;
  const realSetTimeout = globalThis.setTimeout;
  const deadline = computeAdaptiveTimeoutMs({ promptChars: input.prompt.length, maxOutputTokens: 16 });
  spies.push(spyOn(globalThis, 'setTimeout').mockImplementation(((fn: any, ms: number, ...args: any[]) => {
    if (ms === deadline) expire = fn;
    return realSetTimeout(fn, ms, ...args);
  }) as any));
  fixture(options => {
    signal = options.abortSignal;
    return { textStream: (async function* () { await stalled.promise; })(), usage: Promise.resolve(null) };
  });
  let settled = false;
  const call = collect(streamIVXAIText(input)).then(chunks => { settled = true; return chunks; });
  try {
    await turn();
    expect(expire).toBeDefined();
    expire!();
    await turn();
    expect(signal?.aborted).toBe(true);
    expect(settled).toBe(true);
    expect((await call).at(-1)?.error).toContain('timed out');
    expect(getAIQueueSnapshot().short.active).toBe(0);
  } finally { stalled.resolve(); await call; }
});

test('user stop cancels a silent stream and never emits done', async () => {
  const stalled = deferred();
  const controller = new AbortController();
  fixture(() => ({ textStream: (async function* () { yield 'partial'; await stalled.promise; })(), usage: Promise.resolve(null) }));
  let settled = false;
  const call = collect(streamIVXAIText({ ...input, abortSignal: controller.signal })).then(chunks => { settled = true; return chunks; });
  try {
    await turn(); controller.abort(); await turn();
    expect(settled).toBe(true);
    expect((await call).map(c => c.type)).toEqual(['delta', 'error']);
    expect((await call).at(-1)?.error).toBe('Generation stopped by user.');
    expect(getAIQueueSnapshot().short.active).toBe(0);
  } finally { stalled.resolve(); await call; }
});

test('already cancelled admission returns the documented error chunk', async () => {
  const controller = new AbortController(); controller.abort();
  const chunks = await collect(streamIVXAIText({ ...input, abortSignal: controller.signal }));
  expect(chunks.map(c => c.type)).toEqual(['error']);
  expect(chunks[0].error).toBe('Generation stopped by user.');
  expect(getAIQueueSnapshot().short.active).toBe(0);
});

test('cancellation also bounds a stalled usage promise after the final delta', async () => {
  const stalled = deferred();
  const controller = new AbortController();
  fixture(() => ({ textStream: (async function* () { yield 'partial'; })(), usage: stalled.promise }));
  let settled = false;
  const call = collect(streamIVXAIText({ ...input, abortSignal: controller.signal })).then(chunks => { settled = true; return chunks; });
  try {
    await turn(); controller.abort(); await turn();
    expect(settled).toBe(true);
    expect((await call).map(c => c.type)).toEqual(['delta', 'error']);
    expect(getAIQueueSnapshot().short.active).toBe(0);
  } finally { stalled.resolve(); await call; }
});

test('consumer departure cancels upstream and releases its slot', async () => {
  let signal: AbortSignal | undefined;
  fixture(options => { signal = options.abortSignal; return {
    textStream: (async function* () { yield 'first'; yield 'second'; })(), usage: Promise.resolve(null),
  }; });
  const stream = streamIVXAIText(input);
  expect((await stream.next()).value?.type).toBe('delta');
  await stream.return();
  expect(signal?.aborted).toBe(true);
  expect(getAIQueueSnapshot().short.active).toBe(0);
});

test('successful streaming preserves exact text and a single done event', async () => {
  fixture(() => ({ textStream: (async function* () { yield 'hello '; yield 'world'; })(), usage: Promise.resolve({ outputTokens: 2 }) }));
  const chunks = await collect(streamIVXAIText(input));
  expect(chunks.map(c => c.type)).toEqual(['delta', 'delta', 'done']);
  expect(chunks.at(-1)?.text).toBe('hello world');
  expect(chunks.at(-1)?.usage).toEqual({ outputTokens: 2 });
  expect(getAIQueueSnapshot().short.active).toBe(0);
});
