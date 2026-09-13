import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareUncertainReceipts, reconcileUncertainBudget, verifyUncertainReceipt } from './ivx-uncertain-budget-reconciliation.mjs';

const at = Date.parse('2026-09-13T16:00:00Z');
const row = { reservation_id: '00000000-0000-4000-8000-000000000001', worker_instance_id: 'fixture',
  model: 'fixture/model', request_sha: 'a'.repeat(64), generation_id: 'gen_' + '0'.repeat(25) + '1',
  status: 'uncertain', settled_upper_nano: null, reserved_nano: '1000',
  created_at: new Date(at - 10000).toISOString(), completed_at: new Date(at - 5000).toISOString() };
const payload = () => ({ data: { id: row.generation_id, model: row.model, is_byok: false,
  created_at: new Date(at - 8000).toISOString(), total_cost: '0.000000125', gateway_cost: '0.000000125' } });
const digest = 'b'.repeat(64), observed = new Date(at).toISOString();

test('exact provider charge, original identity and receipt digest survive verification', () => {
  const receipt = verifyUncertainReceipt(row, payload(), observed, digest);
  assert.equal(receipt.provider_cost_nano, '125');
  assert.equal(receipt.reservation_id, row.reservation_id);
  assert.equal(receipt.receipt_sha256, digest);
  const free = payload(); free.data.total_cost = '0'; free.data.gateway_cost = '0';
  assert.equal(verifyUncertainReceipt(row, free, observed, digest).provider_cost_nano, '0');
});

test('wrong identity, model, request window, BYOK and conflicting costs retain liability', () => {
  for (const change of [{ id: 'wrong' }, { model: 'wrong' }, { is_byok: true }, { total_cost: '-1' },
    { total_cost: null }, { gateway_cost: '1' }, { created_at: '2000-01-01T00:00:00Z' }]) {
    const value = payload(); Object.assign(value.data, change);
    assert.throws(() => verifyUncertainReceipt(row, value, observed, digest));
  }
  assert.throws(() => verifyUncertainReceipt({ ...row, generation_id: null }, payload(), observed, digest), /MISSING_PROVIDER_ID/);
});

test('orphans never receive the same external receipt and never trigger provider requests', async () => {
  let calls = 0;
  const rows = [1, 2].map(n => ({ ...row, reservation_id: row.reservation_id.slice(0, -1) + n, generation_id: null }));
  const result = await prepareUncertainReceipts(rows, { gatewayKey: 'vck_fixture', now: () => at,
    fetcher: async () => { calls++; throw Error('must not fetch'); } });
  assert.equal(calls, 0); assert.equal(result.receipts.length, 0);
  assert.deepEqual(result.blocked.map(r => r.reason), ['MISSING_PROVIDER_ID', 'MISSING_PROVIDER_ID']);
});

test('only authenticated generation GET is used; duplicate identities are rejected before lookup', async () => {
  let calls = 0;
  const deps = { gatewayKey: 'vck_fixture', now: () => at, fetcher: async (url, options) => {
    calls++;
    assert.equal(url, 'https://ai-gateway.vercel.sh/v1/generation?id=' + row.generation_id);
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer vck_fixture');
    return Response.json(payload());
  } };
  assert.equal((await prepareUncertainReceipts([row], deps)).receipts.length, 1);
  await assert.rejects(prepareUncertainReceipts([row, { ...row, reservation_id: row.reservation_id.slice(0, -1) + '2' }], deps), /DUPLICATE_GENERATION/);
  assert.equal(calls, 1);
});

test('unavailable, malformed or oversized receipts cause no accounting write or secret disclosure', async () => {
  for (const makeResponse of [() => new Response('secret upstream text', { status: 404 }),
    () => new Response('{bad'), () => new Response('x'.repeat(512001))]) {
    const queries = [];
    const client = { async query(sql) { queries.push(sql); return { rows: [row] }; } };
    const result = await reconcileUncertainBudget({ client, reservationIds: [row.reservation_id], gatewayKey: 'vck_fixture', apply: true },
      { now: () => at, fetcher: async () => makeResponse() });
    assert.equal(queries.length, 1); assert.equal(result.state, 'INCOMPLETE');
    assert.equal(result.reconciledCount, 0); assert(!JSON.stringify(result).includes('secret upstream'));
  }
});

test('dry run reads a real receipt shape without starting a write transaction', async () => {
  const queries = [];
  const result = await reconcileUncertainBudget({ client: { async query(sql) { queries.push(sql); return { rows: [row] }; } },
    reservationIds: [row.reservation_id], gatewayKey: 'vck_fixture' },
  { now: () => at, fetcher: async () => Response.json(payload()) });
  assert.equal(queries.length, 1); assert.equal(result.state, 'DRY_RUN'); assert.equal(result.providerCostNano, '125');
});

test('lost commit acknowledgement remains unconfirmed and never reports zero changes', async () => {
  const queries = [];
  const client = { async query(sql) {
    queries.push(sql);
    if (sql === 'commit') throw Error('lost acknowledgement');
    if (sql.includes('fn_reconcile')) return { rows: [{ reconciled_count: 1, total_nano_reconciled: '125' }] };
    return { rows: [row] };
  } };
  const result = await reconcileUncertainBudget({ client, reservationIds: [row.reservation_id], gatewayKey: 'vck_fixture', apply: true },
    { now: () => at, fetcher: async () => Response.json(payload()) });
  assert.equal(result.state, 'WRITE_UNCONFIRMED'); assert.equal(result.reconciledCount, null);
  assert(queries.indexOf("set local statement_timeout = '4s'") < queries.findIndex(q => q.includes('fn_reconcile')));
});
