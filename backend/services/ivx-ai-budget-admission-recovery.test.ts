import { expect, test } from 'bun:test';
import { admitBudgetWithRecovery, type BudgetReservationProof } from './ivx-ai-budget-admission-recovery';

const parameters = { p_reservation_id: 'invocation-uuid', p_worker_instance_id: 'worker-a', p_model: 'model-a',
  p_request_sha: 'request-sha', p_reserved_nano: '1000', p_pricing_evidence: { catalogSha256: 'catalog-sha', validUntil: '2026-09-14T19:05:00Z' } };
const proof: BudgetReservationProof = { reservationId: 'invocation-uuid', workerInstanceId: 'worker-a', model: 'model-a',
  requestSha: 'request-sha', reservedNano: '1000', status: 'reserved', policyEnabled: true,
  policyRevision: '6', currentPolicyRevision: '6', catalogSha256: 'catalog-sha', validUntil: '2026-09-14T19:05:00Z' };
const timing = { now: () => Date.parse('2026-09-14T19:01:00Z'), wait: async () => {} };

test('a confirmed reservation requires one RPC and no recovery reads', async () => {
  let reads = 0;
  const result = await admitBudgetWithRecovery({ parameters, ...timing,
    reserve: async () => ({ allowed: true, reservationId: 'invocation-uuid' }),
    readProof: async () => { reads++; return null; } });
  expect(result.allowed).toBe(true); expect(reads).toBe(0);
});

test('lost commit acknowledgement is recovered from the same owned reservation', async () => {
  let mutations = 0;
  const result = await admitBudgetWithRecovery({ parameters, ...timing,
    reserve: async () => { mutations++; throw new Error('lost acknowledgement'); }, readProof: async () => proof });
  expect(result).toEqual({ allowed: true, reservationId: 'invocation-uuid' }); expect(mutations).toBe(1);
});

test('a rolled-back or never-committed admission retries with the same identity and bounded backoff', async () => {
  const identities: unknown[] = [], delays: number[] = [];
  const result = await admitBudgetWithRecovery({ parameters, ...timing, wait: async delay => { delays.push(delay); },
    reserve: async () => {
      identities.push(parameters.p_reservation_id);
      if (identities.length < 3) throw new Error('connection unavailable');
      return { allowed: true, reservationId: parameters.p_reservation_id };
    }, readProof: async () => null });
  expect(result.allowed).toBe(true); expect(identities).toEqual(['invocation-uuid', 'invocation-uuid', 'invocation-uuid']);
  expect(delays).toHaveLength(2); expect(delays[0]).toBeLessThanOrEqual(200); expect(delays[1]).toBeLessThanOrEqual(400);
});

test('an explicit duplicate cannot authorize work until its proof is verified', async () => {
  const result = await admitBudgetWithRecovery({ parameters, ...timing,
    reserve: async () => ({ allowed: false, reason: 'reservation_already_exists' }), readProof: async () => proof });
  expect(result.allowed).toBe(true);
});

test('changed identity, cost, catalog, policy or expiry never grants a lease', async () => {
  for (const change of [{ workerInstanceId: 'other' }, { requestSha: 'other' }, { model: 'other' }, { reservedNano: '999' },
    { policyEnabled: false }, { currentPolicyRevision: '7' }, { policyRevision: 'undefined', currentPolicyRevision: 'undefined' },
    { status: 'settled' }, { catalogSha256: 'other' }, { validUntil: '2026-09-14T18:59:00Z' }]) {
    let calls = 0;
    await expect(admitBudgetWithRecovery({ parameters, ...timing,
      reserve: async () => { calls++; throw new Error('unconfirmed'); }, readProof: async () => ({ ...proof, ...change }) }))
      .rejects.toThrow('unconfirmed');
    expect(calls).toBe(1);
  }
});

test('monetary, capacity and disabled-policy decisions remain blocked without retry', async () => {
  for (const reason of ['global_daily_budget_exceeded', 'global_capacity_exceeded', 'budget_not_activated']) {
    let calls = 0, reads = 0;
    const result = await admitBudgetWithRecovery({ parameters, ...timing,
      reserve: async () => { calls++; return { allowed: false, reason }; }, readProof: async () => { reads++; return proof; } });
    expect(result).toEqual({ allowed: false, reason }); expect(calls).toBe(1); expect(reads).toBe(0);
  }
});

test('total storage outage has a finite retry budget and cannot start provider work', async () => {
  let calls = 0, reads = 0, providers = 0;
  const attempt = async () => {
    const result = await admitBudgetWithRecovery({ parameters, ...timing,
      reserve: async () => { calls++; throw new Error('storage unavailable'); },
      readProof: async () => { reads++; throw new Error('read unavailable'); } });
    if (result.allowed) providers++;
  };
  await expect(attempt()).rejects.toThrow('storage unavailable');
  expect(calls).toBe(3); expect(reads).toBe(3); expect(providers).toBe(0);
});
