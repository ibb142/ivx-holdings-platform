import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createPlatformFeedLoader } from './ivx-platform-feed-loader';
import { DurableStore } from './ivx-durable-store';
import { newReadTimings, readTimings } from './ivx-read-timings';

const turn = () => new Promise<void>(resolve => setImmediate(resolve));
const originalFetch = globalThis.fetch;
const envNames = ['EXPO_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;
let savedEnv: Array<string | undefined>;
beforeEach(() => {
  savedEnv = envNames.map(name => process.env[name]);
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://documents.example.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  envNames.forEach((name, i) => {
    if (savedEnv[i] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[i];
  });
});

function caller<T>(signal: AbortSignal, read: () => Promise<T>): Promise<T> {
  return readTimings.run({ ...newReadTimings(), deadline: signal }, read);
}

function delayed<T>() {
  let finish!: (value: T) => void;
  let producerSignal: AbortSignal | undefined;
  let calls = 0;
  const read = () => {
    calls++;
    producerSignal = readTimings.getStore()?.deadline;
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(new DOMException('Source cancelled', 'AbortError'));
      finish = value => { producerSignal?.removeEventListener('abort', abort); resolve(value); };
      if (producerSignal?.aborted) abort();
      else producerSignal?.addEventListener('abort', abort, { once: true });
    });
  };
  return { read, finish: (value: T) => finish(value), signal: () => producerSignal, calls: () => calls };
}

test('a viewer deadline cannot cancel the public catalog already shared with Home', async () => {
  const source = delayed<Array<{ id: string }>>();
  const load = createPlatformFeedLoader({ videos: source.read, meta: async () => ({}),
    counts: async () => ({}), playback: async () => ({}), analytics: async () => ({}),
    deals: async () => [], mediaCandidates: async () => new Set<string>() });
  const viewer = new AbortController(), home = new AbortController();
  const first = caller(viewer.signal, () => load(null));
  const second = caller(home.signal, () => load(null));
  // Attach handlers before cancellation so the original failure is observable.
  const outcomes = Promise.allSettled([first, second]);
  await turn();
  viewer.abort();
  await turn();
  const sourceWasCancelled = source.signal()?.aborted;
  source.finish([{ id: 'published-video' }]);
  const [viewerResult, homeResult] = await outcomes;
  expect(source.calls()).toBe(1);
  expect(sourceWasCancelled).toBe(false);
  expect(viewerResult.status).toBe('rejected');
  expect(homeResult).toMatchObject({ status: 'fulfilled', value: { videos: [{ id: 'published-video' }] } });
});

test('a short metadata caller cannot abort a longer caller or open its source circuit', async () => {
  const source = delayed<Response>();
  globalThis.fetch = (async (_input, init) => {
    expect(init?.method).toBe('GET');
    return source.read();
  }) as typeof fetch;
  const store = new DurableStore();
  const short = new AbortController(), long = new AbortController();
  const first = caller(short.signal, () => store.readJson('platform/meta.json', {}));
  const second = caller(long.signal, () => store.readJson('platform/meta.json', {}));
  const outcomes = Promise.allSettled([first, second]);
  await turn();
  short.abort();
  await turn();
  const sourceWasCancelled = source.signal()?.aborted;
  const third = caller(long.signal, () => store.readJson('platform/meta.json', {}));
  const thirdResult = Promise.allSettled([third]);
  source.finish(Response.json([{ value: { video: { is_hidden: true } } }]));
  const [shortResult, longResult] = await outcomes;
  expect(source.calls()).toBe(1);
  expect(sourceWasCancelled).toBe(false);
  expect(shortResult.status).toBe('rejected');
  expect(longResult).toMatchObject({ status: 'fulfilled', value: { video: { is_hidden: true } } });
  expect(await thirdResult).toEqual([longResult]);
});
