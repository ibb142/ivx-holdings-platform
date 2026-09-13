import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { collectUncertainReceipts } from './collect-uncertain-provider-receipts.mjs';
import { validateUncertainReceipt } from './phase3-budget-reconciliation.mjs';

const row = { reservation_id: '00000000-0000-4000-8000-000000000001', status: 'uncertain',
  model: 'openai/gpt-4o', reserved_nano: 822728000, settled_upper_nano: null,
  generation_id: 'gen_01ARZ3NDEKTSV4RRFFQ69G5FAV', created_at: '2026-09-13T10:00:00Z', completed_at: '2026-09-13T10:00:03Z' };
const payload = { data: { id: row.generation_id, model: row.model, created_at: '2026-09-13T10:00:01Z',
  is_byok: false, cancelled: false, finish_reason: 'stop', total_cost: '0.00015', tokens_prompt: 20,
  tokens_completion: 5, latency: 20, generation_time: 100, prompt: 'PRIVATE PROMPT', response: 'PRIVATE RESPONSE' } };
const now = () => Date.parse('2026-09-13T15:00:00Z');
const config = { serviceKey: 'service-secret', gatewayKey: 'vck_gateway-secret', sourceSha: 'a'.repeat(40) };
const deps = { now, pause: async () => {}, expectedCount: 1,
  expectedHash: createHash('sha256').update(row.reservation_id).digest('hex') };

test('uncertain receipt records actual cost without pretending the ledger is settled', () => {
  const result = validateUncertainReceipt(row, payload, new Date(now()).toISOString());
  assert.equal(result.state, 'PROVIDER_RECEIPT_OBSERVED');
  assert.equal(result.ledgerStatus, 'uncertain');
  assert.equal(result.providerCostNano, '150000');
  assert.equal(result.settledUpperNano, undefined);
  assert(!JSON.stringify(result).includes('PRIVATE'));
  for (const bad of [{ is_byok: true }, { finish_reason: null }, { total_cost: '-1' },
    { total_cost: '1' }, { cancelled: null }, { id: 'wrong' }, { model: 'wrong' }, { tokens_prompt: -1 }]) {
    assert.throws(() => validateUncertainReceipt(row, { data: { ...payload.data, ...bad } }, new Date(now()).toISOString()));
  }
});
test('only a validated receipt is uploaded; no model or ledger mutations occur', async () => {
  const writes = [];
  const report = await collectUncertainReceipts(config, { ...deps, fetcher: async (url, init) => {
    if (init.method === 'POST') {
      assert(String(url).includes('/ivx_durable_documents?'));
      const body = JSON.parse(init.body); writes.push(body);
      assert(body.doc_key.startsWith('finance/provider-receipts/2026-09-13/'));
      assert(!JSON.stringify(body).includes('PRIVATE'));
      assert.equal(body.value.providerCostNano, '150000');
      return new Response(null, { status: 201 });
    }
    assert.equal(init.method, 'GET');
    if (String(url).startsWith('https://ai-gateway.vercel.sh/')) {
      assert.equal(new URL(url).pathname, '/v1/generation');
      assert.equal(init.headers.apikey, undefined);
      return Response.json(payload);
    }
    return Response.json([row]);
  } });
  assert.equal(writes.length, 1); assert.equal(report.uploaded, 1);
  assert.equal(report.ledgerRowsChanged, 0); assert.equal(report.modelCallsCreated, 0);
});
test('missing receipts and changed cohorts preserve uncertain balances', async () => {
  let writes = 0;
  const fetcher = async (url, init) => {
    if (init.method !== 'GET') { writes++; throw new Error('unexpected write'); }
    return String(url).startsWith('https://ai-gateway.vercel.sh/')
      ? new Response(null, { status: 404 }) : Response.json([row]);
  };
  const report = await collectUncertainReceipts(config, { ...deps, fetcher });
  assert.equal(report.uploaded, 0); assert.equal(report.unavailable, 1); assert.equal(writes, 0);
  assert.equal(report.records[0].reason, 'READ_HTTP_404');
  await assert.rejects(collectUncertainReceipts(config, { ...deps, expectedHash: '0'.repeat(64), fetcher }), /COHORT_CHANGED/);
  await assert.rejects(collectUncertainReceipts({ ...config, gatewayKey: '' }, { ...deps, fetcher }), /BINDING_UNAVAILABLE/);
});
