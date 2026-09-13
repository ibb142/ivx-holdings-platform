import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { inspectFailedAgentRecovery } from '../backend/services/ivx-failed-agent-recovery.ts';

// Same isolated PGlite dependency convention as candidate-store-postgres.test.mjs.
// This proves the read/query contract, not native multi-connection concurrency.
const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.IVX_PGLITE_MODULE || '@electric-sql/pglite');

test('recovery projection respects the audited schema, run scope and read-only transaction', async t => {
  const db = new PGlite();
  try {
    await db.exec(`
      create table public.ivx_autonomous_tasks (
        task_id text primary key, state text, assigned_agent_number integer,
        version bigint, lease_expires_at timestamptz, payload jsonb
      );
      create table public.ivx_agent_executions (
        task_id text primary key, run_id text, agent_number integer, final_status text,
        simulated boolean, verified_output boolean, real_tool_used boolean,
        tool_result_id text, source_reference text, evidence_sha256 text,
        created_at timestamptz, finished_at timestamptz
      );
      insert into public.ivx_autonomous_tasks values
        ('active', 'RUNNING', 1, 9007199254740993, now() + interval '10 minutes', '{"state":"RUNNING"}'),
        ('expired', 'RUNNING', 18, 2, now() - interval '10 minutes', '{"state":"RUNNING"}');
      insert into public.ivx_agent_executions
        (task_id, run_id, agent_number, final_status, simulated, verified_output, real_tool_used, created_at) values
        ('old', 'chosen', 1, 'failed', false, false, false, now() - interval '2 hours'),
        ('active', 'chosen', 1, 'failed', false, false, false, now() - interval '1 hour'),
        ('expired', 'chosen', 18, 'unknown', false, false, false, now() - interval '1 hour'),
        ('other-run', 'unrelated', 1, 'completed', false, true, true, now());
    `);
    const input = { runId: 'chosen', agentNumbers: [50, 18, 1] };
    const query = (sql, values) => db.query(sql, values);
    const snapshot = async () => (await db.query(`select jsonb_build_object(
      'tasks',(select jsonb_agg(t order by task_id) from public.ivx_autonomous_tasks t),
      'executions',(select jsonb_agg(e order by task_id) from public.ivx_agent_executions e)) as value`)).rows;
    const before = await snapshot();
    await db.exec('begin read only');
    const report = await inspectFailedAgentRecovery(input, query);
    await db.exec('commit');

    await t.test('latest execution comes from the selected run; missing agents remain explicit', () => {
      assert.deepEqual(report.rows.map(r => r.taskId), ['active', 'expired', null]);
      assert.deepEqual(report.rows.map(r => r.agentNumber), [1, 18, 50]);
      assert.equal(report.rows[2].nextStep, 'EXECUTION_NOT_FOUND');
    });
    await t.test('PostgreSQL time protects active leases and bigint versions remain exact', () => {
      assert.equal(report.rows[0].nextStep, 'ACTIVE_LEASE_DO_NOT_RESET');
      assert.equal(report.rows[0].taskVersion, '9007199254740993');
      assert.equal(report.rows[1].nextStep, 'CANONICAL_EXPIRED_LEASE_RECOVERY');
      assert(report.rows.every(r => r.retryAuthorized === false));
    });
    await t.test('repeated diagnostics change no task or execution record', async () => {
      await inspectFailedAgentRecovery(input, query);
      assert.deepEqual(await snapshot(), before);
      assert.equal(report.mutationsPerformed, 0);
    });
    await t.test('provider evidence on an unknown result requires reconciliation', async () => {
      await db.query('update public.ivx_agent_executions set real_tool_used=true where task_id=$1', ['expired']);
      const next = await inspectFailedAgentRecovery(input, query);
      assert.equal(next.rows[1].nextStep, 'RECONCILE_EXISTING_EVIDENCE');
      assert.equal(next.budgetReconciliation, 'NOT_CHECKED');
    });
  } finally { await db.close(); }
});
