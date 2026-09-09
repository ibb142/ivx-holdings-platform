import { describe, expect, test } from 'bun:test';
import { createDashboardReadCache } from './ivx-dashboard-read-cache';

describe('durable dashboard observation sharing', () => {
  test('112 concurrent readers use one read; socket refresh preserves the observation clock', async () => {
    let now = 1_000_000;
    let calls = 0;
    const read = createDashboardReadCache(async () => { calls++; return { ok: true }; }, value => value.ok, 5000, () => now);
    const snapshots = await Promise.all(Array.from({ length: 112 }, () => read()));
    expect(calls).toBe(1);
    now += 1000;
    expect((await read()).observedAt).toBe(snapshots[0].observedAt);
    now += 4000;
    expect((await read()).observedAt).not.toBe(snapshots[0].observedAt);
    expect(calls).toBe(2);
  });
  test('a rejected read releases the shared request and can recover', async () => {
    let calls = 0;
    const read = createDashboardReadCache(async () => { if (++calls === 1) throw new Error('database unavailable'); return { ok: true }; }, value => value.ok);
    await expect(read()).rejects.toThrow('database unavailable');
    expect((await read()).value.ok).toBe(true);
  });
  test('failed telemetry never becomes a cached healthy observation', async () => {
    let calls = 0;
    const read = createDashboardReadCache(async () => ({ ok: ++calls > 1 }), value => value.ok);
    expect((await read()).value.ok).toBe(false);
    expect((await read()).value.ok).toBe(true);
    expect(calls).toBe(2);
  });
});
