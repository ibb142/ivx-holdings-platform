import { afterEach, beforeEach, expect, test } from 'bun:test';
import { DurableStore } from './ivx-durable-store';

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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
const turn = () => new Promise<void>(resolve => setImmediate(resolve));

test('a burst shares one document read, isolates caller values, and does not cache settled data', async () => {
  const gate = deferred();
  let reads = 0;
  let version = 1;
  globalThis.fetch = (async (input, init) => {
    expect(init?.method).toBe('GET');
    const url = new URL(String(input));
    if (!url.searchParams.has('doc_key')) return Response.json([]);
    reads++;
    const snapshot = { version, nested: { visible: true } };
    await gate.promise;
    return Response.json([{ value: snapshot }]);
  }) as typeof fetch;
  const store = new DurableStore();
  const requests = Array.from({ length: 40 }, () => store.readJson('video-platform/meta.json', { version: 0, nested: { visible: false } }));
  await turn();
  const burstReads = reads;
  gate.resolve();
  const values = await Promise.all(requests);
  expect(burstReads).toBe(1);
  expect(values.every(value => value.version === 1)).toBe(true);
  values[0].nested.visible = false;
  expect(values[1].nested.visible).toBe(true);
  version = 2;
  expect((await store.readJson('video-platform/meta.json', { version: 0 })).version).toBe(2);
  expect(reads).toBe(2);
});

test('different keys stay isolated and absent documents keep each caller fallback', async () => {
  const gate = deferred();
  const reads: string[] = [];
  globalThis.fetch = (async input => {
    const key = new URL(String(input)).searchParams.get('doc_key');
    if (key === null) return Response.json([]);
    reads.push(key);
    await gate.promise;
    return Response.json(key === 'eq.absent' ? [] : [{ value: { key } }]);
  }) as typeof fetch;
  const store = new DurableStore();
  const firstFallback = { missing: 'first' };
  const secondFallback = { missing: 'second' };
  const requests = [store.readJson('owner/a&doc_key=eq.b', {}), store.readJson('owner/b', {}),
    store.readJson('absent', firstFallback), store.readJson('absent', secondFallback)];
  await turn();
  gate.resolve();
  const [first, second, absentOne, absentTwo] = await Promise.all(requests);
  expect(first).toEqual({ key: 'eq.owner/a&doc_key=eq.b' });
  expect(second).toEqual({ key: 'eq.owner/b' });
  expect(absentOne).toBe(firstFallback);
  expect(absentTwo).toBe(secondFallback);
  expect(reads.sort()).toEqual(['eq.absent', 'eq.owner/a&doc_key=eq.b', 'eq.owner/b'].sort());
});

test('a completed write invalidates pending reads without an older completion deleting the new read', async () => {
  const oldGate = deferred(), newGate = deferred();
  let version = 1, reads = 0, writes = 0;
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    if (init?.method === 'POST') {
      writes++;
      version = JSON.parse(String(init.body)).value.version;
      return new Response(null, { status: 201 });
    }
    if (!url.searchParams.has('doc_key')) return Response.json([]);
    const ordinal = ++reads, snapshot = version;
    await (ordinal === 1 ? oldGate.promise : newGate.promise);
    return Response.json([{ value: { version: snapshot } }]);
  }) as typeof fetch;
  const store = new DurableStore();
  const oldRead = store.readJson('meta', { version: 0 });
  await turn();
  await store.writeJson('meta', { version: 2 });
  const freshRead = store.readJson('meta', { version: 0 });
  await turn();
  oldGate.resolve();
  expect((await oldRead).version).toBe(1);
  const follower = store.readJson('meta', { version: 0 });
  await turn();
  const readsBeforeRelease = reads;
  newGate.resolve();
  const values = await Promise.all([freshRead, follower]);
  expect(values.map(value => value.version)).toEqual([2, 2]);
  expect(readsBeforeRelease).toBe(2);
  expect(writes).toBe(1);
});

test('an unavailable document remains an error for every caller and a later read can recover', async () => {
  const gate = deferred();
  let reads = 0, unavailable = true;
  globalThis.fetch = (async input => {
    if (!new URL(String(input)).searchParams.has('doc_key')) return Response.json([]);
    reads++;
    await gate.promise;
    return unavailable ? Response.json({ message: 'Database unavailable' }, { status: 503 })
      : Response.json([{ value: { healthy: true } }]);
  }) as typeof fetch;
  const store = new DurableStore();
  const first = store.readJson('meta', { healthy: false });
  const second = store.readJson('meta', { healthy: false });
  const settled = Promise.allSettled([first, second]);
  await turn();
  gate.resolve();
  const outcomes = await settled;
  expect(outcomes.map(outcome => outcome.status)).toEqual(['rejected', 'rejected']);
  for (const outcome of outcomes) if (outcome.status === 'rejected') expect(outcome.reason.message).toBe('Database unavailable');
  expect(reads).toBe(1);
  unavailable = false;
  expect(await store.readJson('meta', { healthy: false })).toEqual({ healthy: true });
  expect(reads).toBe(2);
});

for (const replyLost of [false, true]) test(`reads started during a write cannot hide its new value after ${replyLost ? 'an uncertain' : 'a successful'} response`, async () => {
  const writeStarted = deferred(), writeGate = deferred(), readGate = deferred();
  let version = 1, reads = 0, writes = 0;
  globalThis.fetch = (async (input, init) => {
    if (init?.method === 'POST') {
      writes++;
      writeStarted.resolve();
      await writeGate.promise;
      version = JSON.parse(String(init.body)).value.version;
      return replyLost ? Response.json({ message: 'Commit outcome unknown' }, { status: 502 })
        : new Response(null, { status: 201 });
    }
    if (!new URL(String(input)).searchParams.has('doc_key')) return Response.json([]);
    reads++;
    const snapshot = version;
    await readGate.promise;
    return Response.json([{ value: { version: snapshot } }]);
  }) as typeof fetch;
  const store = new DurableStore();
  const writeOutcome = store.writeJson('meta', { version: 2 }).then(() => 'success', () => 'uncertain');
  await writeStarted.promise;
  const during = store.readJson('meta', { version: 0 });
  await turn();
  writeGate.resolve();
  expect(await writeOutcome).toBe(replyLost ? 'uncertain' : 'success');
  const after = store.readJson('meta', { version: 0 });
  await turn();
  readGate.resolve();
  expect((await during).version).toBe(1);
  expect((await after).version).toBe(2);
  expect(reads).toBe(2);
  expect(writes).toBe(1);
});
