import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { INFRA_DIAGNOSTIC_QUERIES as queries } from '../scripts/ops/infra-control-tower.mjs';
const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.IVX_PGLITE_MODULE || '@electric-sql/pglite');

test('diagnostic SQL uses the audited schema and preserves obligations, task versions and authority', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create table public.ivx_ai_budget_reservations (
        reservation_id uuid primary key, status text check(status in ('reserved','settled','uncertain','cancelled')),
        reserved_nano bigint, settled_upper_nano bigint, generation_id text,
        created_at timestamptz, completed_at timestamptz
      );
      create table public.ivx_autonomous_tasks (
        task_id text primary key, state text, payload jsonb, version bigint,
        lease_expires_at timestamptz, updated_at timestamptz
      );
      create table public.ivx_agent_controls (control_name text primary key, active boolean);
      create function public.ivx_ai_budget_status() returns jsonb language sql as
        'select jsonb_build_object(''enabled'',true,''authorizationRef'',''PRIVATE_AUTHORIZATION'')';
      insert into public.ivx_ai_budget_reservations values
        ('00000000-0000-0000-0000-000000000001','reserved',9007199254740993,null,null,now()-interval '16 minutes',null),
        ('00000000-0000-0000-0000-000000000002','reserved',1234,null,null,now()-interval '14 minutes',null),
        ('00000000-0000-0000-0000-000000000003','reserved',1234,null,'provider-evidence',now()-interval '16 minutes',null),
        ('00000000-0000-0000-0000-000000000004','uncertain',1234,null,null,now()-interval '16 minutes',null);
      insert into public.ivx_autonomous_tasks values
        ('failed','FAILED','{"state":"FAILED","evidence":["receipt"]}',9007199254740993,now()+interval '1 hour',now()),
        ('running','RUNNING','{"state":"RUNNING"}',42,now()+interval '1 hour',now());
      insert into public.ivx_agent_controls values ('emergency_stop',false);
    `);
    const before = (await db.query(`select jsonb_build_object(
      'budget',(select jsonb_agg(r order by reservation_id) from public.ivx_ai_budget_reservations r),
      'tasks',(select jsonb_agg(t order by task_id) from public.ivx_autonomous_tasks t)) as snapshot`)).rows;
    await db.exec('begin read only');
    const budget = (await db.query(queries.budget)).rows[0];
    const tasks = (await db.query(queries.tasks)).rows;
    const stop = (await db.query(queries.emergencyStop)).rows[0];
    await db.exec('commit');
    assert.equal(budget.policy.authorizationRef, undefined);
    assert.equal(budget.stale_reserved_sample.length, 1);
    assert.equal(budget.stale_reserved_sample[0].reserved_nano, '9007199254740993');
    assert.equal(budget.stale_reserved_sample[0].status, 'reserved');
    assert.equal(tasks.length, 1); assert.equal(tasks[0].version, '9007199254740993');
    assert.equal(tasks[0].lease_active, true); assert.equal(tasks[0].has_embedded_evidence, true);
    assert.equal(stop.authority_rows, 1); assert.equal(stop.active, false);
    const after = (await db.query(`select jsonb_build_object(
      'budget',(select jsonb_agg(r order by reservation_id) from public.ivx_ai_budget_reservations r),
      'tasks',(select jsonb_agg(t order by task_id) from public.ivx_autonomous_tasks t)) as snapshot`)).rows;
    assert.deepEqual(after, before);
    await db.exec('delete from public.ivx_agent_controls');
    const missing = (await db.query(queries.emergencyStop)).rows[0];
    assert.equal(missing.authority_rows, 0); assert.equal(missing.active, null);
  } finally { await db.close(); }
});
