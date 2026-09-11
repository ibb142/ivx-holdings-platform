import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ownerQueueWorkerReadiness } from './ivx-owner-queue-readiness.ts';
const now = Date.parse('2026-09-11T14:00:00Z'), sha = 'a'.repeat(40);
const live = { worker_id: 'worker-a', instance_id: 'instance-a', source_sha: sha, state: 'ready', last_seen_at: new Date(now).toISOString() };

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
