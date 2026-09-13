import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.IVX_PGLITE_MODULE || '@electric-sql/pglite');
const source = await readFile(new URL('../scripts/ops/infra-control-tower.ts', import.meta.url), 'utf8');
const sql = source.match(/export const BUDGET_DIAGNOSTIC_SQL = `([\s\S]*?)`;/)?.[1];
assert(sql, 'budget diagnostic SQL export is required');
const migration = await readFile(new URL('../supabase/migrations/20260911203746_ivx_global_ai_budget.sql', import.meta.url), 'utf8');

test('budget inspection uses the native schema without freeing reservations', async t => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    await db.exec(migration);
    const read = async () => {
      await db.exec('begin read only');
      try {
        const result = (await db.query(sql)).rows[0].report;
        await db.exec('commit');
        return result;
      } catch (error) { await db.exec('rollback'); throw error; }
    };
    await t.test('an unconfigured budget does not invent a capacity limit', async () => {
      const report = await read();
      assert.equal(report.capacityState, 'BUDGET_DISABLED');
      assert.equal(report.maxConcurrent, null);
      assert.equal(report.availableReservationSlots, null);
    });
    await db.exec(`update public.ivx_ai_budget_policy set enabled=true,
      daily_limit_nano=1000000000, max_concurrent=4, authorization_ref='isolated-fixture';
      insert into public.ivx_ai_budget_reservations
        (reservation_id,worker_instance_id,model,request_sha,day,policy_revision,
         reserved_nano,status,pricing_evidence,created_at) values
        ('00000000-0000-4000-8000-000000000001','fixture-worker','fixture/model',repeat('a',64),current_date,1,
         100,'reserved','{}',statement_timestamp()-interval '16 minutes'),
        ('00000000-0000-4000-8000-000000000002','fixture-worker','fixture/model',repeat('b',64),current_date,1,
         200,'uncertain','{}',statement_timestamp()-interval '1 day');`);
    const snapshot = async () => (await db.query(`select jsonb_agg(r order by reservation_id) as rows
      from public.ivx_ai_budget_reservations r`)).rows;
    const before = await snapshot();
    await t.test('occupancy counts reserved slots independently from unsettled liability', async () => {
      const report = await read();
      assert.equal(report.activeReservations, 1);
      assert.equal(report.availableReservationSlots, 3);
      assert.equal(report.capacityState, 'CAPACITY_AVAILABLE');
      assert.equal(report.reservedLiabilityNano, '100');
      assert.equal(report.financialClearanceVerified, false);
    });
    await t.test('old missing-generation rows require review and preserve all money and records', async () => {
      const report = await read();
      assert.equal(report.reservedOlderThan15Minutes, 1);
      assert.equal(report.olderReservationsWithoutGeneration, 1);
      assert.equal(report.nextStep, 'REVIEW_RETAINED_SETTLEMENT');
      assert.equal(report.ageProvesUnbilled, false);
      assert.equal(report.reservationsChanged, 0);
      assert.equal(report.modelCallsCreated, 0);
      assert.deepEqual(await snapshot(), before);
    });
    await t.test('saturated and disabled policies remain distinct', async () => {
      await db.exec('update public.ivx_ai_budget_policy set max_concurrent=1');
      assert.equal((await read()).capacityState, 'CAPACITY_SATURATED');
      assert.equal((await read()).availableReservationSlots, 0);
      await db.exec('update public.ivx_ai_budget_policy set enabled=false');
      assert.equal((await read()).capacityState, 'BUDGET_DISABLED');
    });
    await t.test('a missing policy remains unavailable instead of reporting a free fleet', async () => {
      await db.exec('delete from public.ivx_ai_budget_policy');
      const report = await read();
      assert.equal(report.policyConfigured, false);
      assert.equal(report.capacityState, 'POLICY_UNAVAILABLE');
      assert.equal(report.maxConcurrent, null);
      assert.equal(report.availableReservationSlots, null);
      assert.equal(report.activeReservations, 1);
      assert.deepEqual(await snapshot(), before);
    });
  } finally { await db.close(); }
});
