import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOwnerQueueProviderGate, ownerQueueWorkerReadiness, createOwnerQueueSnapshotReader, OWNER_QUEUE_HEALTH_TIMEOUT_MS } from './ivx-owner-queue-readiness.ts';
const now = Date.parse('2026-09-11T14:00:00Z'), sha = 'a'.repeat(40);
const live = { worker_id: 'worker-a', instance_id: 'instance-a', source_sha: sha, state: 'ready', last_seen_at: new Date(now).toISOString() };

test('32 simultaneous health observers share one request; the next read sees an Owner pause', async () => {
  const shared = createOwnerQueueSnapshotReader();
  let release, calls = 0;
  const read = () => { calls++; return new Promise(resolve => { release = resolve; }); };
  const observers = Array.from({ length: 32 }, () => shared('same-runtime-and-credentials', read));
  await Promise.resolve(); assert.equal(calls, 1);
  release({ authorized: true });
  assert.ok((await Promise.all(observers)).every(row => row.authorized));
  const next = await shared('same-runtime-and-credentials', async () => { calls++; return { authorized: false }; });
  assert.equal(next.authorized, false); assert.equal(calls, 2);
  assert.equal(OWNER_QUEUE_HEALTH_TIMEOUT_MS, 6500);
});

test('credential or SHA changes start a fresh read; an older completion cannot erase it', async () => {
  const shared = createOwnerQueueSnapshotReader();
  let finishOld, finishNew, calls = 0;
  const old = shared('old', () => { calls++; return new Promise(r => { finishOld = r; }); });
  const fresh = shared('new', () => { calls++; return new Promise(r => { finishNew = r; }); });
  await Promise.resolve(); finishOld('old'); await old;
  const joined = shared('new', async () => { calls++; return 'unexpected'; });
  assert.equal(joined, fresh); finishNew('fresh');
  assert.equal(await joined, 'fresh'); assert.equal(calls, 2);
});

test('a failed observation releases the pending request and cannot poison recovery', async () => {
  const shared = createOwnerQueueSnapshotReader();
  const failure = shared('key', async () => { throw new Error('transport unavailable'); });
  const concurrent = shared('key', async () => 'must not execute');
  const results = await Promise.allSettled([failure, concurrent]);
  assert.ok(results.every(row => row.status === 'rejected'));
  assert.equal(await shared('key', async () => 'recovered'), 'recovered');
});

test('cold provider validates once, resumes after a bounded outage and never probes while paused', async () => {
  let time = 0, calls = 0, configured = true, succeed = false;
  let health = { state: 'PROVIDER_VALIDATING', lastHttpStatus: null, lastValidationTime: null };
  const gate = createOwnerQueueProviderGate({ configured: () => configured, health: () => health, now: () => time,
    validate: async () => {
      calls++;
      if (!succeed) throw new Error('provider outage');
      health = { state: 'PROVIDER_READY', lastHttpStatus: 200, lastValidationTime: new Date(now).toISOString() };
    },
  });
  assert.equal(await gate(false), false); assert.equal(calls, 0);
  configured = false; assert.equal(await gate(true), false); assert.equal(calls, 0);
  configured = true; assert.equal(await gate(true), false); assert.equal(calls, 1);
  time = 59_999; assert.equal(await gate(true), false); assert.equal(calls, 1);
  time = 60_000; succeed = true; assert.equal(await gate(true), true); assert.equal(calls, 2);
  assert.equal(await gate(true), true); assert.equal(calls, 2);
  assert.equal(await gate(false), false); assert.equal(calls, 2);
});

test('configuration or a nominal ready label cannot replace a completed provider observation', async () => {
  let calls = 0;
  const gate = createOwnerQueueProviderGate({ configured: () => true,
    health: () => ({ state: 'PROVIDER_READY', lastHttpStatus: 200, lastValidationTime: null }),
    validate: async () => { calls++; },
  });
  assert.equal(await gate(true), false); assert.equal(calls, 1);
});

test('an API with no local timer recognizes two distinct fresh durable workers', () => {
  const r = ownerQueueWorkerReadiness([live, { ...live, worker_id: 'worker-b', instance_id: 'instance-b' }], sha, now);
  assert.equal(r.ready, true); assert.equal(r.workers.length, 2);
  assert.equal(ownerQueueWorkerReadiness([live, live], sha, now).workers.length, 1);
});
test('old releases, stale heartbeats, pause, drain and malformed evidence stay unavailable', () => {
  for (const change of [{ source_sha: 'b'.repeat(40) }, { state: 'paused' }, { state: 'degraded' }, { state: 'draining' }, { last_seen_at: new Date(now - 75_000).toISOString() }, { last_seen_at: new Date(now + 10_000).toISOString() }, { last_seen_at: 'invalid' }, { instance_id: '' }]) {
    assert.equal(ownerQueueWorkerReadiness([{ ...live, ...change }], sha, now).ready, false);
  }
  for (const rows of [null, {}, [], Array(11).fill(live)]) assert.equal(ownerQueueWorkerReadiness(rows, sha, now).ready, false);
});
