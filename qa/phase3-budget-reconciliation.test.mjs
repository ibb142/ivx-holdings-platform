import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observeBudgetReconciliation, reconcileReceipt, receiptUsdToNano } from './phase3-budget-reconciliation.mjs';

const NOW = Date.parse('2026-09-12T12:00:00.000Z');
const row = { reservation_id: '00000000-0000-4000-8000-000000000001', model: 'openai/gpt-4o',
  status: 'settled', reserved_nano: 1_000_000, settled_upper_nano: 200_000,
  generation_id: 'gen_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  created_at: '2026-09-12T11:00:00.000Z', completed_at: '2026-09-12T11:00:03.000Z' };
const receipt = { data: { id: row.generation_id, model: row.model, is_byok: false,
  total_cost: 0.00015, gateway_cost: 0.00015, usage: 0.00015,
  created_at: '2026-09-12T11:00:01.000Z', tokens_prompt: 20, tokens_completion: 5,
  latency: 70, generation_time: 900, prompt: 'PRIVATE_PROMPT', arbitrary: 'PRIVATE_RESPONSE' } };
const config = { databaseUrl: 'https://kvclcdjmjghndxsngfzb.supabase.co',
  serviceKey: 'TEST_SERVICE_SECRET', gatewayKey: 'vck_TEST_GATEWAY_SECRET', sourceSha: 'a'.repeat(40) };
const policy = { day: '2026-09-12', enabled: true, scope: 'all_instrumented_backend_provider_requests',
  policyRevision: 2, dailyLimitNano: '200000000000', maxConcurrent: 2,
  requestsActive: 0, unknownCharges: 0, unsettledLiabilityNano: '0' };
function fixture({ rows = [row], afterRows, beforePolicy = policy, afterPolicy, provider } = {}) {
  const calls = []; let ledgerReads = 0, policyReads = 0;
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), init });
    const parsed = new URL(url);
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    if (parsed.origin === config.databaseUrl) {
      assert.equal(init.headers.apikey, config.serviceKey);
      assert.equal(init.headers.Authorization, 'Bearer ' + config.serviceKey);
      if (parsed.pathname.endsWith('/rpc/ivx_ai_budget_status')) {
        return Response.json(++policyReads === 1 ? beforePolicy : afterPolicy ?? beforePolicy);
      }
      assert.equal(parsed.pathname, '/rest/v1/ivx_ai_budget_reservations');
      assert.equal(parsed.searchParams.get('limit'), '113');
      return Response.json(++ledgerReads === 1 ? rows : afterRows ?? rows);
    }
    assert.equal(parsed.origin, 'https://ai-gateway.vercel.sh');
    assert.equal(parsed.pathname, '/v1/generation');
    assert.equal(init.headers.Authorization, 'Bearer ' + config.gatewayKey);
    assert.equal(init.headers.apikey, undefined);
    return provider ? provider(parsed, calls) : Response.json(receipt);
  };
  return { calls, fetcher };
}
const observe = (f, options = {}) => observeBudgetReconciliation(config,
  { fetcher: f.fetcher, now: () => NOW, wait: async () => {}, ...options });

test('decimal costs round upward at nanodollar precision, including exponent notation', () => {
  assert.equal(receiptUsdToNano('0.0000000001'), 1n);
  assert.equal(receiptUsdToNano(1e-9), 1n);
  assert.equal(receiptUsdToNano('1.0100000001'), 1010000001n);
  assert.equal(receiptUsdToNano('200'), 200000000000n);
  for (const value of [-1, NaN, Infinity, null, '', 'NaN', '1e999', '1000001', '0x10']) {
    assert.throws(() => receiptUsdToNano(value), /INVALID_PROVIDER_COST/);
  }
});
test('matching receipt preserves real cost and bound, strips prompt and unrecognized fields', () => {
  const result = reconcileReceipt(row, receipt, new Date(NOW).toISOString());
  assert.equal(result.state, 'RECONCILED');
  assert.equal(result.providerCostNano, '150000');
  assert.equal(result.settledUpperNano, '200000');
  assert.equal(result.firstTokenMs, 70);
  assert(!JSON.stringify(result).includes('PRIVATE'));
});
test('an actual provider cost beyond the recorded liability is never accepted', () => {
  const high = { data: { ...receipt.data, total_cost: 0.0003, gateway_cost: 0.0003, usage: 0.0003 } };
  assert.throws(() => reconcileReceipt(row, high, new Date(NOW).toISOString()), /PROVIDER_COST_EXCEEDS_LEDGER/);
  assert.throws(() => reconcileReceipt({ ...row, reserved_nano: 1 }, receipt, new Date(NOW).toISOString()), /LEDGER_BOUND_BREACHED/);
});
test('BYOK, wrong model, wrong receipt, contradictory cost and invalid usage fail closed', () => {
  for (const change of [{ is_byok: true }, { is_byok: undefined }, { model: 'openai/other' },
    { id: 'gen_01ARZ3NDEKTSV4RRFFQ69G5FAA' }, { gateway_cost: 0.1 }, { tokens_prompt: -1 },
    { latency: null }, { total_cost: null }]) {
    assert.throws(() => reconcileReceipt(row, { data: { ...receipt.data, ...change } }, new Date(NOW).toISOString()));
  }
});
test('a receipt from another execution time or an unfinished ledger entry cannot reconcile', () => {
  assert.throws(() => reconcileReceipt(row, { data: { ...receipt.data, created_at: '2026-08-01T00:00:00Z' } },
    new Date(NOW).toISOString()), /RECEIPT_TIME_MISMATCH/);
  assert.throws(() => reconcileReceipt({ ...row, completed_at: null }, receipt, new Date(NOW).toISOString()));
  assert.throws(() => reconcileReceipt({ ...row, status: 'uncertain' }, receipt, new Date(NOW).toISOString()), /RESERVATION_NOT_SETTLED/);
});
test('real HTTP response fixtures reconcile a stable cohort using GETs on only the two bound origins', async () => {
  const f = fixture(); const result = await observe(f);
  assert.equal(result.state, 'COHORT_RECONCILED');
  assert.equal(result.reconciledRecords, 1); assert.equal(result.providerCostNano, '150000');
  assert.equal(result.ledgerStable, true); assert.equal(f.calls.length, 5);
  assert.equal(result.fullDayReconciled, false); assert.equal(result.providerAccountReconciled, false);
  assert.equal(result.generationCommitAttributed, false); assert.equal(result.phase3Closed, false);
  assert.equal(result.modelCallsCreated, 0); assert.equal(result.productionRowsChanged, 0);
  const output = JSON.stringify(result);
  for (const secret of ['TEST_SERVICE_SECRET', 'vck_TEST_GATEWAY_SECRET', 'PRIVATE_PROMPT', 'PRIVATE_RESPONSE']) {
    assert(!output.includes(secret));
  }
});
test('only generation 404 receives two bounded ingestion retries; no new inference is requested', async () => {
  let attempts = 0; const sleeps = [];
  const f = fixture({ provider: () => ++attempts < 3 ? new Response('', { status: 404 }) : Response.json(receipt) });
  const result = await observe(f, { wait: async ms => sleeps.push(ms) });
  assert.equal(result.state, 'COHORT_RECONCILED'); assert.equal(result.records[0].lookupAttempts, 3);
  assert.deepEqual(sleeps, [2000, 2000]); assert.equal(attempts, 3);
});
test('a permanently missing receipt stays incomplete and never becomes a zero charge', async () => {
  let attempts = 0;
  const f = fixture({ provider: () => { attempts++; return new Response('PRIVATE_ERROR', { status: 404 }); } });
  const result = await observe(f);
  assert.equal(result.state, 'INCOMPLETE'); assert.equal(attempts, 3);
  assert.equal(result.records[0].reason, 'READ_HTTP_404');
  assert.equal(result.records[0].providerCostNano, undefined);
  assert(!JSON.stringify(result).includes('PRIVATE_ERROR'));
});
test('provider authentication denial stops immediately without retry or error-body disclosure', async () => {
  const f = fixture({ provider: () => new Response('TEST_SERVICE_SECRET', { status: 401 }) });
  const result = await observe(f);
  assert.equal(result.state, 'INCOMPLETE'); assert.equal(result.reason, 'READ_HTTP_401');
  assert.equal(f.calls.filter(c => new URL(c.url).pathname === '/v1/generation').length, 1);
  assert(!JSON.stringify(result).includes('TEST_SERVICE_SECRET'));
});
test('unknown charges remain visible without lookup or release, including liabilities outside the cohort', async () => {
  const f = fixture({ rows: [{ ...row, status: 'uncertain', generation_id: null, settled_upper_nano: null }],
    beforePolicy: { ...policy, unknownCharges: 4, unsettledLiabilityNano: '3290112000' } });
  const result = await observe(f);
  assert.equal(result.state, 'INCOMPLETE'); assert.equal(result.policy.unknownCharges, 4);
  assert.equal(result.policy.unsettledLiabilityNano, '3290112000');
  assert.equal(result.records[0].reason, 'UNKNOWN_CHARGE_RETAINED');
  assert.equal(f.calls.filter(c => new URL(c.url).origin.includes('ai-gateway')).length, 0);
});
test('duplicate reservation or generation identities fail before provider lookup', async () => {
  for (const duplicate of [row, { ...row, reservation_id: '00000000-0000-4000-8000-000000000002' }]) {
    const f = fixture({ rows: [row, duplicate] }); const result = await observe(f);
    assert.equal(result.state, 'INCOMPLETE'); assert.match(result.reason, /DUPLICATE/);
    assert.equal(f.calls.length, 2);
  }
});
test('an empty cohort and a truncated cohort never certify completeness', async () => {
  assert.equal((await observe(fixture({ rows: [] }))).reason, 'EMPTY_LEDGER_COHORT');
  const rows = Array.from({ length: 113 }, (_, i) => ({ ...row, status: 'uncertain', generation_id: null,
    reservation_id: '00000000-0000-4000-8000-' + String(i + 1).padStart(12, '0') }));
  const result = await observe(fixture({ rows }));
  assert.equal(result.state, 'INCOMPLETE'); assert.equal(result.selectionTruncated, true);
  assert.equal(result.records.length, 112);
});
test('ledger or policy changes during lookup invalidate the observation', async () => {
  for (const f of [fixture({ afterRows: [{ ...row, settled_upper_nano: 201000 }] }),
    fixture({ afterPolicy: { ...policy, policyRevision: 3 } })]) {
    const result = await observe(f); assert.equal(result.state, 'INCOMPLETE');
    assert.match(result.reason, /CHANGED_DURING_OBSERVATION/);
  }
});
test('credential or source mismatch stops before any outbound request', async () => {
  for (const changed of [{ databaseUrl: 'https://other-project.supabase.co' }, { gatewayKey: '' },
    { serviceKey: '' }, { sourceSha: 'main' }]) {
    const f = fixture();
    const result = await observeBudgetReconciliation({ ...config, ...changed }, { fetcher: f.fetcher, now: () => NOW });
    assert.equal(result.state, 'INCOMPLETE'); assert.equal(f.calls.length, 0);
  }
});
test('malformed JSON, oversized bodies, transport failures and deadline exhaustion disclose no payload', async () => {
  for (const provider of [() => new Response('PRIVATE_NOT_JSON'),
    () => new Response('PRIVATE' + 'x'.repeat(512_000)),
    () => { throw new Error('TEST_SERVICE_SECRET'); }]) {
    const result = await observe(fixture({ provider }));
    assert.equal(result.state, 'INCOMPLETE'); assert.equal(result.reconciledRecords, 0);
    assert(!JSON.stringify(result).includes('PRIVATE'));
    assert(!JSON.stringify(result).includes('TEST_SERVICE_SECRET'));
  }
  let clock = NOW;
  const f = fixture({ provider: () => { clock += 121_000; return new Response('', { status: 404 }); } });
  const result = await observe(f, { now: () => clock });
  assert.equal(result.state, 'INCOMPLETE'); assert.equal(result.reason, 'OBSERVATION_DEADLINE');
});
test('the first minute after UTC midnight does not silently substitute the preceding day', async () => {
  const f = fixture({ rows: [] });
  const result = await observe(f, { now: () => Date.parse('2026-09-12T00:00:30Z') });
  assert.equal(result.day, '2026-09-12'); assert.equal(result.cutoff, '2026-09-12T00:00:00.000Z');
  assert.equal(result.reason, 'EMPTY_LEDGER_COHORT');
});

