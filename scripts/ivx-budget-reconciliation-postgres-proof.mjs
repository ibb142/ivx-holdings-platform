import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { reconcileUncertainBudget } from '../backend/services/ivx-uncertain-budget-reconciliation.mjs';

export async function proveBudgetReconciliation(clients, realConnections = true) {
  const [a, b = a] = clients;
  const migration = await readFile(new URL('../supabase/migrations/20260913161000_ivx_verified_budget_reconciliation.sql', import.meta.url), 'utf8');
  assert.equal(migration, await readFile(new URL('../database/functions/execute_budget_reconciliation_batch.sql', import.meta.url), 'utf8'));
  await a.query(migration);
  const day = (await a.query("select (clock_timestamp() at time zone 'UTC')::date::text as day")).rows[0].day;
  const reset = async () => {
    await a.query('truncate public.ivx_ai_budget_reconciliation_receipts,public.ivx_ai_budget_reservations,public.ivx_ai_budget_days');
    await a.query("update public.ivx_ai_budget_policy set enabled=true,daily_limit_nano=1000000,max_concurrent=12,authorization_ref='ISOLATED_FIXTURE'");
  };
  const fixture = async (n, orphan = false) => {
    const id = '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
    const generation = 'gen_' + String(n).padStart(26, '0');
    const { rows } = await a.query(`insert into public.ivx_ai_budget_reservations
      (reservation_id,worker_instance_id,model,request_sha,day,policy_revision,reserved_nano,status,
        pricing_evidence,generation_id,created_at,completed_at)
      values($1,'fixture','fixture/model',$2,$3::date-1,1,1000,'uncertain','{}',$4,
        clock_timestamp()-interval '1 day 10 seconds',clock_timestamp()-interval '1 day 5 seconds')
      returning created_at::text, completed_at::text`, [id, 'a'.repeat(64), day, orphan ? null : generation]);
    return { reservation_id: id, worker_instance_id: 'fixture', request_sha: 'a'.repeat(64), model: 'fixture/model',
      generation_id: generation, provider_cost_nano: '125', provider_created_at: rows[0].created_at,
      observed_at: new Date().toISOString(), receipt_sha256: String(n).repeat(64), completed: rows[0].completed_at };
  };
  const call = async (entries, client = a, size = entries.length) => (await client.query(
    'select * from public.fn_reconcile_uncertain_budget_batch($1,$2::jsonb)', [size, JSON.stringify(entries)])).rows[0];
  const status = async () => (await a.query('select public.ivx_ai_budget_status() value')).rows[0].value;
  const receipts = async () => Number((await a.query('select count(*) n from public.ivx_ai_budget_reconciliation_receipts')).rows[0].n);
  const acl = (await a.query(`select
    has_function_privilege('anon','public.fn_reconcile_uncertain_budget_batch(integer,jsonb)','execute') anon,
    has_function_privilege('authenticated','public.fn_reconcile_uncertain_budget_batch(integer,jsonb)','execute') authenticated,
    has_function_privilege('service_role','public.fn_reconcile_uncertain_budget_batch(integer,jsonb)','execute') service,
    has_table_privilege('service_role','public.ivx_ai_budget_reconciliation_receipts','update') mutable_receipts`)).rows[0];
  assert.deepEqual(acl, { anon: false, authenticated: false, service: true, mutable_receipts: false });

  await reset();
  const first = await fixture(1), second = await fixture(2), orphan = await fixture(3, true);
  second.provider_cost_nano = '0';
  await a.query('insert into public.ivx_ai_budget_days(day,settled_upper_nano) values($1::date-1,77)', [day]);
  assert.equal((await status()).unsettledLiabilityNano, '3000');
  assert.equal((await call([first, second])).reconciled_count, 2);
  assert.equal((await status()).settledUpperNano, '125');
  assert.equal((await status()).unsettledLiabilityNano, '1000');
  assert.equal((await a.query('select completed_at::text from public.ivx_ai_budget_reservations where reservation_id=$1', [first.reservation_id])).rows[0].completed_at, first.completed);
  assert.equal(String((await a.query('select settled_upper_nano from public.ivx_ai_budget_days where day=$1::date-1', [day])).rows[0].settled_upper_nano), '77');
  assert.equal((await call([first, second])).reconciled_count, 0);
  assert.equal((await status()).settledUpperNano, '125'); assert.equal(await receipts(), 2);
  await assert.rejects(call([{ ...first, provider_cost_nano: '126' }]), /retry conflict/);
  await assert.rejects(call([orphan]), /Missing provider identity/);

  await reset();
  const one = await fixture(1), two = await fixture(2);
  await assert.rejects(call([one, { ...two, model: 'wrong/model' }]), /identity mismatch/);
  assert.equal(await receipts(), 0); assert.equal((await status()).unknownCharges, 2);
  assert.equal((await status()).settledUpperNano, '0');
  for (const entries of [[one, one], [one, { ...two, generation_id: one.generation_id }],
    [{ ...one, provider_cost_nano: '-1' }], [{ ...one, provider_cost_nano: null }],
    [{ ...one, provider_cost_nano: '1000000000000001' }], [{ ...one, provider_created_at: 'infinity' }],
    [{ ...one, observed_at: '2000-01-01T00:00:00Z' }], [{ ...one, request_sha: 'b'.repeat(64) }]]) {
    await assert.rejects(call(entries));
  }
  await assert.rejects(call([], a, 1));
  for (const size of [null, 0, 113]) await assert.rejects(call([one], a, size));
  await assert.rejects(a.query('select * from public.fn_reconcile_uncertain_budget_batch(1,null)'));
  assert.equal(await receipts(), 0); assert.equal((await status()).unsettledLiabilityNano, '2000');

  // Unique generation IDs also fence ordinary finish calls, not just this RPC.
  await a.query("update public.ivx_ai_budget_reservations set status='reserved',generation_id=null where reservation_id=$1", [two.reservation_id]);
  await assert.rejects(a.query("select public.ivx_ai_budget_finish($1,'fixture','settled',125,$2)",
    [two.reservation_id, one.generation_id]), /duplicate key/);
  assert.equal((await status()).settledUpperNano, '0');

  await reset();
  const over = await fixture(1); over.provider_cost_nano = '1250';
  assert.equal((await call([over])).reconciled_count, 1);
  assert.equal((await status()).settledUpperNano, '1250'); assert.equal((await status()).enabled, false);

  await reset();
  const endToEnd = await fixture(1);
  let providerReads = 0;
  const result = await reconcileUncertainBudget({ client: a, reservationIds: [endToEnd.reservation_id],
    gatewayKey: 'vck_isolated_fixture', apply: true }, { fetcher: async (url, options) => {
    providerReads++;
    assert.equal(options.method, 'GET');
    assert.equal(url, 'https://ai-gateway.vercel.sh/v1/generation?id=' + endToEnd.generation_id);
    return Response.json({ data: { id: endToEnd.generation_id, model: endToEnd.model,
      created_at: endToEnd.provider_created_at, is_byok: false, total_cost: '0.000000125' } });
  } });
  assert.equal(result.state, 'COHORT_RECONCILED'); assert.equal(result.confirmedCount, 1);
  assert.equal(providerReads, 1); assert.equal((await status()).settledUpperNano, '125');

  if (realConnections) {
    await reset();
    const held = await fixture(1), free = await fixture(2);
    await a.query('begin');
    await a.query('select 1 from public.ivx_ai_budget_reservations where reservation_id=$1 for update', [held.reservation_id]);
    assert.equal((await call([held, free], b)).reconciled_count, 1, 'skip a held reservation, settle the free row');
    await a.query('rollback');
    assert.equal((await call([held, free], b)).reconciled_count, 1, 'retry only books the previously held row');
    assert.equal((await status()).settledUpperNano, '250');
    await reset();
    const race = await fixture(1);
    await a.query('begin'); await a.query('select 1 from public.ivx_ai_budget_policy for update');
    assert.equal((await call([race], b)).reconciled_count, 0, 'policy contention yields without 55P03');
    await a.query('rollback');
    const results = await Promise.all([call([race], a), call([race], b)]);
    assert.equal(results.reduce((n, r) => n + r.reconciled_count, 0), 1);
    assert.equal((await status()).settledUpperNano, '125'); assert.equal(await receipts(), 1);
  }
  return { verification: 'PASS', realConnections, concurrentSessionsTested: realConnections,
    receiptIdentityUnique: true, retryIdempotent: true, rollbackAtomic: true, missingIdentityRetained: true,
    originalRequestWindowPreserved: true, currentUtcDayAccounting: true, pricingBreachStopsAdmission: true,
    privateAccess: true, verifierToDatabaseConfirmed: true, mockedReceiptReads: providerReads,
    providerCalls: 0, productionRowsTouched: 0, observedAt: new Date().toISOString() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const connectionString = process.env.IVX_HA_TEST_DATABASE_URL;
  const url = new URL(connectionString ?? 'postgres://invalid');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/ivx_ha_test') throw Error('Local ivx_ha_test database required');
  const { default: pg } = await import('pg');
  const clients = Array.from({ length: 2 }, () => new pg.Client({ connectionString, statement_timeout: 4000 }));
  await Promise.all(clients.map(c => c.connect()));
  try {
    const proof = await proveBudgetReconciliation(clients);
    await mkdir('qa/evidence/fleet-ha', { recursive: true });
    await writeFile('qa/evidence/fleet-ha/budget-reconciliation.json', JSON.stringify(proof, null, 2) + '\n');
    console.log(JSON.stringify(proof));
  } finally { await Promise.allSettled(clients.map(c => c.end())); }
}
