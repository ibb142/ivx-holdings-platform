import { expect, mock, test } from 'bun:test';
import { createPersistenceStoreResolver } from './ivx-persistence-store-resolution';

test('112 callers share an unavailable probe, never bootstrap, and recover after backoff', async () => {
  let now = 0;
  let release!: (result: { ok: boolean; status: number; error: string }) => void;
  const dedicated = mock(() => new Promise<{ ok: boolean; status: number; error: string }>(resolve => { release = resolve; }));
  const bootstrap = mock(async () => ({ ok: true, detail: 'created' }));
  const fallback = mock(async () => ({ ok: true, status: 200 }));
  const resolver = createPersistenceStoreResolver({ dedicated, bootstrap, fallback, now: () => now });
  const requests = Array.from({ length: 112 }, () => resolver.resolve());
  expect(dedicated).toHaveBeenCalledTimes(1);
  release({ ok: false, status: 0, error: 'timeout' });
  const results = await Promise.all(requests);
  expect(results.every(result => result.mode === 'unavailable')).toBe(true);
  expect(bootstrap).not.toHaveBeenCalled();
  expect(fallback).not.toHaveBeenCalled();
  await resolver.resolve();
  expect(dedicated).toHaveBeenCalledTimes(1);
  now = 5_000;
  dedicated.mockResolvedValue({ ok: true, status: 200, error: '' });
  expect((await resolver.resolve()).mode).toBe('dedicated');
  await resolver.resolve();
  expect(dedicated).toHaveBeenCalledTimes(2);
});

test.each([401, 403, 429, 500, 503])('HTTP %s cannot cause schema writes or a persistence switch', async status => {
  const bootstrap = mock(async () => ({ ok: true, detail: 'created' }));
  const fallback = mock(async () => ({ ok: true, status: 200 }));
  const resolver = createPersistenceStoreResolver({ dedicated: async () => ({ ok: false, status }), bootstrap, fallback });
  expect((await resolver.resolve()).mode).toBe('unavailable');
  expect(bootstrap).not.toHaveBeenCalled();
  expect(fallback).not.toHaveBeenCalled();
});

test('a confirmed missing table bootstraps once for concurrent callers', async () => {
  const bootstrap = mock(async () => ({ ok: true, detail: 'created and verified' }));
  const fallback = mock(async () => ({ ok: true, status: 200 }));
  const resolver = createPersistenceStoreResolver({ dedicated: async () => ({ ok: false, status: 404 }), bootstrap, fallback });
  const results = await Promise.all(Array.from({ length: 112 }, () => resolver.resolve()));
  expect(results.every(result => result.mode === 'dedicated')).toBe(true);
  expect(bootstrap).toHaveBeenCalledTimes(1);
  expect(fallback).not.toHaveBeenCalled();
});

test('only a missing canonical table and a verified alternative enable fallback', async () => {
  const fallback = mock(async () => ({ ok: true, status: 200 }));
  const resolver = createPersistenceStoreResolver({
    dedicated: async () => ({ ok: false, status: 404 }),
    bootstrap: async () => ({ ok: false, detail: 'DDL deferred' }), fallback,
  });
  expect((await resolver.resolve()).mode).toBe('jobs_fallback');
  expect((await resolver.resolve()).mode).toBe('jobs_fallback');
  expect(fallback).toHaveBeenCalledTimes(1);
});

test('a thrown probe releases the shared attempt without marking persistence healthy', async () => {
  let now = 0;
  const dedicated = mock(async () => { throw new Error('network'); });
  const resolver = createPersistenceStoreResolver({ dedicated, now: () => now,
    bootstrap: async () => ({ ok: true, detail: 'created' }), fallback: async () => ({ ok: true, status: 200 }),
  });
  expect((await resolver.resolve()).mode).toBe('unavailable');
  now = 5_000;
  await resolver.resolve();
  expect(dedicated).toHaveBeenCalledTimes(2);
});
