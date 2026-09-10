import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export async function proveWorkEvidenceArchive(db) {
  await db.query(await readFile(new URL('../supabase/migrations/20260910160010_ivx_immutable_work_evidence.sql', import.meta.url), 'utf8'));
  const start = Date.parse('2026-06-01T06:00:00Z');
  const proof = (i, agent = 1, status = 'PASS', seconds = 1) => ({
    evidenceId: `archive-proof-${agent}-${i}`, evidenceType: 'test_result', source: 'fixture',
    summary: 'LANDING_P0_RESULT ' + JSON.stringify({ v: 1, agent_number: agent, status,
      started_at: new Date(start + i * 1000).toISOString(), completed_at: new Date(start + (i + 1) * 1000).toISOString(),
      productive_seconds: seconds, unit_id: 'archive-test', production_sha: 'a'.repeat(40) }),
  });
  const task = { taskId: 'archive-proof-task', idempotencyKey: 'archive-proof-task', assignedAgentNumber: 1,
    state: 'RUNNING', leaseHolder: 'agent:archive', leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(), evidence: [] };
  await db.query(`insert into public.ivx_autonomous_tasks(task_id,idempotency_key,state,assigned_agent_number,lease_holder,worker_instance_id,lease_expires_at,payload)
    values($1,$1,'RUNNING',1,'agent:archive','archive-winner',now()+interval '1 minute',$2::jsonb)`, [task.taskId, JSON.stringify(task)]);
  for (let i = 0; i < 40; i++) {
    task.evidence = [...task.evidence, proof(i)].slice(-24);
    await db.query('update public.ivx_autonomous_tasks set payload=$2::jsonb where task_id=$1', [task.taskId, JSON.stringify(task)]);
  }
  const count = async () => Number((await db.query('select count(*) as n from public.ivx_work_evidence_archive where task_id=$1', [task.taskId])).rows[0].n);
  assert.equal(await count(), 40, 'Pruning the hot payload must not prune the audit history');
  const cas = async (id, payload) => (await db.query('select public.ivx_autonomous_task_compare_and_set($1::jsonb,$2::jsonb,$3,$4,$5) as result',
    [JSON.stringify(payload), '["RUNNING"]', 'agent:archive', id, 'proof_recorded'])).rows[0].result;
  const stale = await cas('stale-process', { ...task, evidence: [proof(100)] });
  assert.equal(stale.ok, false);
  assert.equal(await count(), 40, 'A fenced-out process must not archive invented work');
  const won = await cas('archive-winner', { ...task, state: 'VERIFIED', leaseHolder: null, leaseExpiresAt: null, evidence: [proof(40)] });
  assert.equal(won.ok, true);
  assert.equal(await count(), 41);
  // Copies, malformed payloads, future time and over-reported durations are not extra hours.
  const extra = [proof(0), { ...proof(41), evidenceId: 'bad-json', summary: 'LANDING_P0_RESULT broken' },
    proof(42, 1, 'FAIL', 999), { ...proof(43), evidenceId: 'duplicate-content', summary: proof(0).summary }];
  await db.query('update public.ivx_autonomous_tasks set payload=$2::jsonb where task_id=$1', [task.taskId, JSON.stringify({ ...won.task, evidence: extra })]);
  const report = (from, to) => db.query('select public.ivx_work_evidence_hours($1,$2,300) as result', [from, to]).then(r => r.rows[0].result);
  const hours = await report('2026-06-01T06:00:00Z', '2026-06-01T07:00:00Z');
  assert.equal(hours.agents.length, 112);
  assert.equal(Number(hours.agents[0].passing_seconds), 41, 'The first interval and all pruned intervals count exactly once');
  assert.equal(Number(hours.agents[0].nonpassing_seconds), 1, 'Failures are separate; duration cannot exceed elapsed time');
  assert.equal(hours.targetEvidenced, false);
  assert.equal(hours.historicalEvidenceIncomplete, true, 'Backfill must not certify missing history');
  const clipped = await report('2026-06-01T06:00:00.500Z', '2026-06-01T06:00:02Z');
  assert.equal(Number(clipped.agents[0].passing_seconds), 1.5);
  await assert.rejects(db.query('delete from public.ivx_work_evidence_archive where task_id=$1', [task.taskId]), /append-only/);
  const access = (await db.query(`select has_table_privilege('anon','public.ivx_work_evidence_archive','select') as anon,
    has_function_privilege('authenticated','public.ivx_work_evidence_hours(timestamptz,timestamptz,numeric)','execute') as authenticated`)).rows[0];
  assert.deepEqual(access, { anon: false, authenticated: false });
  // The read optimization must preserve exact accounting and existing ACLs.
  await db.query(await readFile(new URL('../supabase/migrations/20260910170903_ivx_work_evidence_hours_cover.sql', import.meta.url), 'utf8'));
  await db.query(await readFile(new URL('../supabase/migrations/20260910174848_ivx_compact_work_intervals.sql', import.meta.url), 'utf8'));
  await assert.rejects(report('2026-06-01T06:00:00Z', '2026-06-01T07:00:00Z'), /bootstrap is incomplete/);
  await db.query('select public.ivx_backfill_work_intervals(25)');
  await db.query(await readFile(new URL('../supabase/migrations/20260910175800_ivx_sequential_interval_bootstrap.sql', import.meta.url), 'utf8'));
  const pageBatch = async () => (await db.query('select public.ivx_backfill_work_interval_pages(1) as result')).rows[0].result;
  assert.equal((await pageBatch()).complete, false, 'The fixture must span multiple heap pages');
  // Local fixture only: a heap rewrite must restart physical scanning safely.
  await db.query('vacuum full public.ivx_work_evidence_archive');
  assert.equal((await pageBatch()).restarted, true, 'Rewritten source pages must not be skipped');
  for (let batch = 0; batch < 30; batch++) {
    const result = await pageBatch();
    if (result.complete) break;
    assert(batch < 29, 'Bounded bootstrap must finish for this fixture');
  }
  assert.equal((await pageBatch()).inserted, 0, 'A completed checkpoint is idempotent');
  assert.deepEqual(await report('2026-06-01T06:00:00Z', '2026-06-01T07:00:00Z'), hours);
  assert.deepEqual(await report('2026-06-01T06:00:00.500Z', '2026-06-01T06:00:02Z'), clipped);
  const optimizedAccess = (await db.query(`select has_table_privilege('anon','public.ivx_work_evidence_archive','select') as anon,
    has_function_privilege('authenticated','public.ivx_work_evidence_hours(timestamptz,timestamptz,numeric)','execute') as authenticated`)).rows[0];
  assert.deepEqual(optimizedAccess, access);
  const projectionAccess = (await db.query(`select has_table_privilege('anon','public.ivx_work_evidence_intervals','select') as anon,
    has_function_privilege('service_role','public.ivx_backfill_work_intervals(integer)','execute') as "backendBootstrap",
    has_function_privilege('service_role','public.ivx_backfill_work_interval_pages(integer)','execute') as "backendPageBootstrap"`)).rows[0];
  assert.deepEqual(projectionAccess, { anon: false, backendBootstrap: false, backendPageBootstrap: false });
  await assert.rejects(db.query('delete from public.ivx_work_evidence_intervals'), /append-only/);
  await db.query('update public.ivx_autonomous_tasks set payload=$2::jsonb where task_id=$1',
    [task.taskId, JSON.stringify({ ...won.task, evidence: [proof(45), { ...proof(0), evidenceId: 'another-copy' }] })]);
  const incremental = await report('2026-06-01T06:00:00Z', '2026-06-01T07:00:00Z');
  assert.equal(Number(incremental.agents[0].passing_seconds), 42, 'New archive evidence must reach the compact projection exactly once');
  assert.equal(Number(incremental.agents[0].nonpassing_seconds), 1);
  console.log(JSON.stringify({ immutableWorkEvidence: true, observationsSurvivedRotation: 41, staleCompletionRejected: true,
    duplicatesExcluded: true, nonpassingTimeSeparated: true, clippingVerified: true, privateAccess: true,
    optimizedAccountingUnchanged: true }));
}
