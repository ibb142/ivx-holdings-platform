import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEmptyClaimCooldown } from './ivx-empty-claim-cooldown.ts';
import { refillFleetBatches } from './ivx-fleet-refill-batches.ts';

const requests = Array.from({ length: 112 }, (_, i) => ({ workerId: `agent:${i + 1}`, agentNumber: i + 1 }));
const result = (request, task = null) => ({ ...request, ok: true, task, error: null, stolen: false });
function fixture() {
  const cooldown = createEmptyClaimCooldown(5_000), queued = new Set(), dispatched = [], batches = [];
  const refill = async (now, scope = 'sha-a:landing') => refillFleetBatches(
    requests.filter(request => cooldown.canClaim(request.workerId, scope, now)), {
      batchSize: 4, shouldStop: () => false,
      lease: async rows => {
        batches.push(rows.map(row => row.workerId));
        const results = rows.map(row => result(row, queued.delete(row.workerId)
          ? { taskId: `${row.workerId}-${now}`, state: 'LEASED' } : null));
        cooldown.observe(rows, results, scope, now);
        return results;
      },
      start: async rows => rows.map(row => ({ ...row, ok: true, error: null, task: { taskId: row.taskId, state: 'RUNNING' } })),
      onStarted: row => { dispatched.push(row.taskId); return true; },
      release: async () => { throw new Error('Accepted tasks retain their lease'); },
    });
  return { cooldown, queued, dispatched, batches, refill };
}

test('staggered completion wakeups do not repeat 112 empty lanes within one normal tick', async () => {
  const f = fixture();
  for (let now = 0; now < 5000; now += 250) await f.refill(now);
  assert.equal(f.batches.length, 28);
  assert.equal(f.batches.flat().length, 112);
  assert.equal(new Set(f.batches.flat()).size, 112);
  await f.refill(5000);
  assert.equal(f.batches.length, 56, 'every lane is eligible again at the normal tick');
});

test('a productive lane refills promptly and newly queued work waits at most one tick', async () => {
  const f = fixture();
  f.queued.add('agent:1'); await f.refill(0);
  f.queued.add('agent:1'); f.queued.add('agent:2'); await f.refill(250);
  assert.deepEqual(f.batches.at(-1), ['agent:1']);
  assert.deepEqual(f.dispatched, ['agent:1-0', 'agent:1-250']);
  await f.refill(5000);
  assert(f.dispatched.includes('agent:2-5000'));
  assert.equal(new Set(f.dispatched).size, f.dispatched.length);
});

test('112 available lanes retain full concurrent admission and four-lane transactions', async () => {
  const f = fixture();
  for (const request of requests) f.queued.add(request.workerId);
  await f.refill(0);
  assert.equal(f.dispatched.length, 112);
  assert.equal(Math.max(...f.batches.map(batch => batch.length)), 4);
});

test('new revision or mission and worker restart invalidate old empty observations', async () => {
  const f = fixture(); await f.refill(0); await f.refill(1, 'sha-b:landing');
  assert.equal(f.batches.length, 56);
  await f.refill(2, 'sha-b:other'); assert.equal(f.batches.length, 84);
  f.cooldown.clear(); await f.refill(3, 'sha-b:other'); assert.equal(f.batches.length, 112);
});

test('failed or unrequested claims are never cached as an empty queue and clocks cannot stall recovery', () => {
  const cooldown = createEmptyClaimCooldown(5000), request = requests[0];
  cooldown.observe([request], [{ ...result(request), ok: false, error: 'DATABASE_PRESSURE' }], 'scope', 100);
  assert(cooldown.canClaim(request.workerId, 'scope', 101));
  cooldown.observe([request], [result(requests[1])], 'scope', 100);
  assert(cooldown.canClaim(requests[1].workerId, 'scope', 101));
  cooldown.observe([request], [result(request)], 'scope', 100);
  assert.equal(cooldown.canClaim(request.workerId, 'scope', 101), false);
  assert(cooldown.canClaim(request.workerId, 'scope', 99));
});
