import assert from 'node:assert/strict';
import test from 'node:test';
import { settleBudgetWithRetry } from './ivx-global-ai-budget-settlement.ts';

const payload = {
  p_reservation_id: 'reservation-one',
  p_worker_instance_id: 'worker-one',
  p_status: 'settled',
  p_settled_upper_nano: '42500',
  p_generation_id: 'generation-one',
};
function clock() {
  const pending = [], delays = [];
  return {
    pending, delays,
    schedule(run, delayMs) { pending.push(run); delays.push(delayMs); },
    async next() {
      assert(pending.length > 0);
      pending.shift()();
      await new Promise(resolve => setImmediate(resolve));
    },
  };
}

test('recovers a failed settlement without waiting for background retries', async () => {
  const timer = clock(), writes = [], confirmed = [], pendingReceipts = [];
  await settleBudgetWithRetry(async value => {
    writes.push(value);
    if (writes.length === 1) throw new Error('database connection timeout');
    return { ok: true };
  }, payload, { schedule: timer.schedule, onConfirmed: (_, attempts) => confirmed.push(attempts),
    onRetry: (value, attempts, delayMs) => pendingReceipts.push({ value, attempts, delayMs }) });
  assert.equal(writes.length, 1);
  assert.equal(timer.pending.length, 1);
  assert.deepEqual(pendingReceipts, [{ value: payload, attempts: 1, delayMs: 1000 }]);
  await timer.next();
  assert.deepEqual(writes, [payload, payload]);
  assert.deepEqual(confirmed, [2]);
  assert.equal(timer.pending.length, 0);
});

test('a lost committed acknowledgement retries the same settlement exactly once', async () => {
  const timer = clock(), ledger = new Map();
  let attempts = 0, charged = 0n;
  await settleBudgetWithRetry(async value => {
    attempts++;
    if (!ledger.has(value.p_reservation_id)) {
      ledger.set(value.p_reservation_id, value);
      charged += BigInt(value.p_settled_upper_nano);
      throw new Error('response lost after commit');
    }
    assert.deepEqual(value, ledger.get(value.p_reservation_id));
    return { ok: true, duplicate: true };
  }, payload, { schedule: timer.schedule });
  await timer.next();
  assert.equal(attempts, 2);
  assert.equal(charged, 42500n);
  assert.equal(ledger.size, 1);
});

test('permanent failure stops after four attempts and preserves review metadata', async () => {
  const timer = clock(), writes = [], retained = [];
  const callerPayload = { ...payload };
  await settleBudgetWithRetry(async value => {
    assert(Object.isFrozen(value));
    writes.push(value);
    throw new Error('database unavailable');
  }, callerPayload, { schedule: timer.schedule, onUnconfirmed: (value, attempts) => retained.push({ value, attempts }) });
  callerPayload.p_settled_upper_nano = '0';
  callerPayload.p_generation_id = 'mutated';
  while (timer.pending.length) await timer.next();
  assert.deepEqual(timer.delays, [1000, 5000, 15000]);
  assert.equal(writes.length, 4);
  assert(writes.every(value => value.p_settled_upper_nano === '42500' && value.p_generation_id === 'generation-one'));
  assert.deepEqual(retained, [{ value: payload, attempts: 4 }]);
});

test('unknown charges remain uncertain with a null cost through recovery', async () => {
  const timer = clock(), writes = [];
  const unknown = { ...payload, p_status: 'uncertain', p_settled_upper_nano: null, p_generation_id: null };
  await settleBudgetWithRetry(async value => {
    writes.push(value);
    if (writes.length === 1) return { ok: false };
    return { ok: true };
  }, unknown, { schedule: timer.schedule });
  await timer.next();
  assert.deepEqual(writes, [unknown, unknown]);
  assert.equal(timer.pending.length, 0);
});

test('a pricing breach is acknowledged once and never retried into another write', async () => {
  const timer = clock(), confirmations = [];
  let writes = 0;
  await settleBudgetWithRetry(async () => {
    writes++;
    return { ok: true, pricingBoundBreached: true };
  }, payload, { schedule: timer.schedule, onConfirmed: receipt => confirmations.push(receipt) });
  assert.equal(writes, 1);
  assert.equal(timer.pending.length, 0);
  assert.deepEqual(confirmations, [{ ok: true, pricingBoundBreached: true }]);
});

test('retries do not overlap while the preceding database write is pending', async () => {
  const timer = clock();
  let rejectFirst, active = 0, maxActive = 0;
  const first = new Promise((_, reject) => { rejectFirst = reject; });
  const completing = settleBudgetWithRetry(async () => {
    active++; maxActive = Math.max(maxActive, active);
    try { if (maxActive === 1 && !timer.delays.length) await first; return { ok: true }; }
    finally { active--; }
  }, payload, { schedule: timer.schedule });
  await Promise.resolve();
  assert.equal(timer.pending.length, 0);
  rejectFirst(new Error('timeout'));
  await completing;
  await timer.next();
  assert.equal(maxActive, 1);
  assert.equal(active, 0);
});
