import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.IVX_PGLITE_MODULE || '@electric-sql/pglite');
const mission = JSON.parse(readFileSync(new URL('./autonomous/quantum-self-upgrade-mission.json', import.meta.url), 'utf8'));
const migration = readFileSync(new URL('../supabase/migrations/20260907151751_ivx_autonomous_atomic_task_queue.sql', import.meta.url), 'utf8');

test('the owner mission uses canonical admission and duplicate submission preserves state, leases, versions and evidence', async () => {
  const db = new PGlite();
  try {
    // Isolated original schema/function; no production credentials or writes.
    await db.exec(migration.slice(0, migration.indexOf('alter table public.ivx_autonomous_tasks enable row level security;')));
    const start = migration.indexOf('create or replace function public.ivx_autonomous_tasks_create_batch(');
    const end = migration.indexOf('create or replace function public.ivx_autonomous_tasks_claim_batch(', start);
    assert.ok(start >= 0 && end > start);
    await db.exec(migration.slice(start, end));
    const submit = async () => (await db.query('select public.ivx_autonomous_tasks_create_batch($1::jsonb) as result',
      [JSON.stringify([mission])])).rows[0].result[0];
    const read = async () => (await db.query('select *, version::text as exact_version from public.ivx_autonomous_tasks where task_id=$1', [mission.taskId])).rows[0];
    const created = await submit();
    assert.equal(created.ok, true); assert.equal(created.duplicate, false);
    const initial = await read();
    assert.equal(initial.state, 'QUEUED'); assert.equal(initial.payload.state, 'QUEUED');
    assert.equal(initial.assigned_agent_number, 1); assert.equal(initial.exact_version, '1');
    assert.equal(initial.idempotency_key, mission.idempotencyKey);
    assert.equal(initial.lease_holder, null); assert.equal(initial.worker_instance_id, null);
    assert.equal(initial.payload.budgetReserved, undefined); assert.equal(initial.payload.verified10of10, undefined);
    assert.equal(initial.payload.completedAt, null); assert.deepEqual(initial.payload.evidence, []);
    assert.equal(initial.payload.acceptanceCriteria.length, 8);
    assert.ok(initial.payload.acceptanceCriteria.every(c => c.met === false && c.evidence === null));
    assert.equal(new Set(initial.payload.acceptanceCriteria.map(c => c.id)).size, 8);

    for (const state of ['RUNNING', 'FAILED', 'VERIFIED']) {
      await db.query(`update public.ivx_autonomous_tasks set state=$2, version=9007199254740993,
        lease_holder='fixture-lease', worker_instance_id='fixture-worker', lease_expires_at=now()+interval '1 hour',
        payload=jsonb_set(jsonb_set(payload,'{state}',to_jsonb($2::text)), '{evidence}', '[{"evidenceId":"retained-proof"}]')
        where task_id=$1`, [mission.taskId, state]);
      const before = await read();
      const duplicate = await submit();
      assert.equal(duplicate.ok, true); assert.equal(duplicate.duplicate, true);
      assert.deepEqual(await read(), before);
      assert.equal(duplicate.task.state, state);
      assert.equal((await read()).exact_version, '9007199254740993');
    }
    assert.equal((await db.query('select count(*)::int as count from public.ivx_autonomous_tasks')).rows[0].count, 1);
  } finally { await db.close(); }
});
