import { expect, test } from 'bun:test';
import { confirmBudgetReservation } from './ivx-global-ai-budget-admission';
import type { BudgetSettlement } from './ivx-global-ai-budget-settlement';

const identity = { p_reservation_id: 'reservation-owned-by-this-request', p_worker_instance_id: 'process-one' };
const cancellation: BudgetSettlement = { ...identity, p_status: 'cancelled', p_settled_upper_nano: '0', p_generation_id: null };
function clock() {
  const pending: (() => void)[] = [];
  const delays: number[] = [];
  return {
    pending, delays,
    schedule(run: () => void, delay: number) { pending.push(run); delays.push(delay); },
    async next() { pending.shift()!(); await new Promise(resolve => setImmediate(resolve)); },
  };
}

test('confirmed admission retains its reservation for the provider lifecycle', async () => {
  let cancellations = 0;
  const receipt = { allowed: true, reservationId: identity.p_reservation_id };
  expect(await confirmBudgetReservation(async () => receipt, async () => {
    cancellations++; return { ok: true };
  }, identity)).toEqual(receipt);
  expect(cancellations).toBe(0);
});

test('capacity, monetary and duplicate-ID denials never cancel another reservation', async () => {
  let cancellations = 0;
  for (const reason of ['global_capacity_exceeded', 'global_daily_budget_exceeded', 'reservation_already_exists']) {
    expect(await confirmBudgetReservation(async () => ({ allowed: false, reason }), async () => {
      cancellations++; return { ok: true };
    }, identity)).toEqual({ allowed: false, reason });
  }
  expect(cancellations).toBe(0);
});

test('a mismatched acknowledgement can cancel only the originally requested identity', async () => {
  const writes: BudgetSettlement[] = [];
  await expect(confirmBudgetReservation(async () => ({ allowed: true, reservationId: 'foreign-reservation' }), async value => {
    writes.push(value); return { ok: true };
  }, identity)).rejects.toThrow('acknowledgement mismatch');
  expect(writes).toEqual([cancellation]);
});

test('a late admission commit is cleaned up by an identical cancellation retry', async () => {
  const timer = clock(), writes: BudgetSettlement[] = [];
  let stored: 'missing' | 'reserved' | 'cancelled' = 'missing';
  const failure = new Error('admission response lost');
  await expect(confirmBudgetReservation(async () => { throw failure; }, async value => {
    writes.push(value);
    if (stored === 'missing') throw new Error('row not committed yet');
    stored = 'cancelled'; return { ok: true };
  }, identity, { schedule: timer.schedule })).rejects.toBe(failure);
  expect(stored).toBe('missing');
  stored = 'reserved';
  await timer.next();
  expect(stored).toBe('cancelled');
  expect(writes).toEqual([cancellation, cancellation]);
  expect(timer.pending).toHaveLength(0);
});

test('a lost cancellation acknowledgement cannot refund twice or replay admission', async () => {
  const timer = clock(), writes: BudgetSettlement[] = [];
  let reserves = 0, liability = 123n, applied = false;
  await expect(confirmBudgetReservation(async () => { reserves++; throw new Error('lost admission acknowledgement'); }, async value => {
    writes.push(value);
    if (!applied) { applied = true; liability -= 123n; throw new Error('lost cancellation acknowledgement'); }
    return { ok: true };
  }, identity, { schedule: timer.schedule })).rejects.toThrow('lost admission acknowledgement');
  await timer.next();
  expect(reserves).toBe(1);
  expect(liability).toBe(0n);
  expect(writes).toEqual([cancellation, cancellation]);
});

test('permanent database failure retains the reservation and its review identity', async () => {
  const timer = clock(), retained: { value: BudgetSettlement; attempts: number }[] = [];
  let writes = 0;
  const failure = new Error('admission outcome unknown');
  await expect(confirmBudgetReservation(async () => { throw failure; }, async () => {
    writes++; throw new Error('database unavailable');
  }, identity, { schedule: timer.schedule, onUnconfirmed: (value, attempts) => retained.push({ value, attempts }) })).rejects.toBe(failure);
  while (timer.pending.length) await timer.next();
  expect(writes).toBe(4);
  expect(timer.delays).toEqual([1000, 5000, 15000]);
  expect(retained).toEqual([{ value: cancellation, attempts: 4 }]);
});
