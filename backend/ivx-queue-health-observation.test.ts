import { expect, test } from 'bun:test';
import { createQueueHealthObserver, type QueueHealthSnapshot } from './services/ivx-queue-health-observation';
import { measuredSqlQuery, recordPoolCheckout } from './services/ivx-read-timings';

const options = { sourceSha: 'a'.repeat(40), url: 'https://queue.invalid/rpc', headers: {}, env: { DATABASE_URL: 'postgres://unit-test' } };
const snapshot = (authorized = true): QueueHealthSnapshot => ({ authorized, pending: [], dead: [], workers: [] });

test('concurrent probes share one query, then observe changed Owner authorization', async () => {
  let reads = 0, release!: (value: QueueHealthSnapshot) => void;
  const observe = createQueueHealthObserver(async () => { reads++; return new Promise(resolve => { release = resolve; }); });
  const batch = Array.from({ length: 40 }, () => observe(options));
  expect(reads).toBe(1);
  release(snapshot());
  const results = await Promise.all(batch);
  expect(results.every(result => result.ok && result.value?.authorized)).toBe(true);
  const next = observe(options);
  expect(reads).toBe(2);
  release(snapshot(false));
  expect((await next).value?.authorized).toBe(false);
});
test('timeouts remain failures and do not spawn replacement queries while one is pending', async () => {
  let reads = 0, release!: (value: QueueHealthSnapshot) => void;
  const observe = createQueueHealthObserver(async () => { reads++; return new Promise(resolve => { release = resolve; }); }, 20);
  const result = await observe(options);
  expect(result.ok).toBe(false);
  expect(result.error).toContain('timed out');
  expect(result.timing.sqlRoundTripMs).toBeNull();
  expect((await observe(options)).ok).toBe(false);
  expect(reads).toBe(1);
  release(snapshot());
  await Bun.sleep(0);
});
test('invalid or unavailable database observations never become healthy empty queues', async () => {
  for (const value of [null, {}, { ...snapshot(), pending: Array(201).fill({}) }, { ...snapshot(), workers: Array(11).fill({}) }]) {
    expect((await createQueueHealthObserver(async () => value)(options)).ok).toBe(false);
  }
  const result = await createQueueHealthObserver(async () => { throw new Error('private connection detail'); })(options);
  expect(result.ok).toBe(false);
  expect(JSON.stringify(result)).not.toContain('private connection detail');
});
test('connection and query round trips are separate; raw server SQL time is not invented', async () => {
  const observe = createQueueHealthObserver(async () => {
    recordPoolCheckout(120);
    return measuredSqlQuery(async () => { await Bun.sleep(5); return snapshot(); });
  });
  const result = await observe(options);
  expect(result.timing.transport).toBe('postgres');
  expect(result.timing.poolAcquisitionMs).toBe(120);
  expect(result.timing.sqlRoundTripMs).toBeGreaterThan(0);
  expect(result.timing.sqlRoundTripMs).toBeLessThan(120);
  expect(result.timing.serverSqlMs).toBeNull();
});
