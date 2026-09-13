import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INFRA_DIAGNOSTIC_QUERIES as queries, runInfraControlTower } from './infra-control-tower.mjs';

function harness({ failConnect = false, failBudget = false, failClose = false } = {}) {
  const calls = []; let closed = 0; let config;
  const client = {
    async connect() { if (failConnect) throw new Error('PRIVATE_DATABASE_CREDENTIAL'); },
    async query(sql) {
      calls.push(sql);
      if (sql === queries.budget && failBudget) throw Object.assign(new Error('PRIVATE_SQL'), { code: '57014' });
      if (sql === queries.budget) return { rows: [{ policy: { enabled: true }, stale_reserved_sample:
        Array.from({ length: 113 }, (_, i) => ({ reservation_id: String(i), reserved_nano: '9007199254740993', status: 'reserved' })) }] };
      if (sql === queries.tasks) return { rows: Array.from({ length: 11 }, (_, i) => ({ task_id: String(i),
        state: 'FAILED', payload_state: i === 1 ? 'RUNNING' : 'FAILED', version: '9007199254740993',
        lease_active: i === 0, has_embedded_evidence: i === 2 })) };
      return { rows: [] };
    },
    async end() { closed++; if (failClose) throw new Error('PRIVATE_CLOSE_ERROR'); },
  };
  return { calls, client, closed: () => closed, config: () => config,
    options: { env: { DATABASE_URL: 'postgresql://fixture:PRIVATE@127.0.0.1/test' },
      createClient: async value => { config = value; return client; } } };
}

test('missing credentials returns a configuration failure before opening a client', async () => {
  const report = await runInfraControlTower({ env: {}, createClient: () => { throw new Error('Must not connect'); } });
  assert.equal(report.exitCode, 1); assert.equal(report.error, 'DATABASE_URL_NOT_CONFIGURED');
  assert.equal(report.recoveryVerified, false);
});

test('diagnostics use one bounded client and independent read-only transactions', async () => {
  const h = harness(); const report = await runInfraControlTower(h.options);
  assert.equal(report.state, 'DIAGNOSTICS_COMPLETE'); assert.equal(report.exitCode, 0);
  assert.equal(report.mutationsPerformed, 0); assert.equal(report.recoveryVerified, false);
  assert.equal(report.readiness, 'NOT_CHECKED'); assert.equal(h.closed(), 1);
  assert.equal(h.config().connectionTimeoutMillis, 5000);
  for (const sql of Object.values(queries)) {
    const i = h.calls.indexOf(sql);
    assert.equal(h.calls[i - 3], 'BEGIN READ ONLY');
    assert.equal(h.calls[i - 2], "SET LOCAL statement_timeout = '3000ms'");
    assert.equal(h.calls[i + 1], 'COMMIT');
  }
  assert.equal(report.sections.budget.rows[0].sample_truncated, true);
  assert.equal(report.sections.budget.rows[0].stale_reserved_sample.length, 112);
  assert.equal(report.sections.budget.rows[0].stale_reserved_sample[0].reserved_nano, '9007199254740993');
  assert.equal(report.sections.tasks.sampleTruncated, true);
  assert.equal(report.sections.tasks.rows.length, 10);
  assert.equal(report.sections.tasks.rows[0].next_step, 'ACTIVE_LEASE_DO_NOT_RESET');
  assert.equal(report.sections.tasks.rows[1].next_step, 'CANONICAL_STATE_RECONCILIATION');
  assert.equal(report.sections.tasks.rows[2].next_step, 'RECONCILE_EXISTING_EVIDENCE');
  assert.equal(report.sections.tasks.rows[3].next_step, 'TERMINAL_TASK_REVIEW_WITH_CANONICAL_ENGINE');
  assert.equal(JSON.stringify(report).includes('PRIVATE'), false);
});

test('one failed section rolls back, retains unknown data, and still closes the client', async () => {
  const h = harness({ failBudget: true }); const report = await runInfraControlTower(h.options);
  assert.equal(report.exitCode, 2); assert.equal(report.state, 'DIAGNOSTICS_INCOMPLETE');
  assert.equal(report.sections.budget.rows, null);
  assert.equal(report.sections.budget.error, 'POSTGRES_57014');
  assert.equal(report.sections.tasks.status, 'OBSERVED');
  assert.equal(h.calls.filter(sql => sql === 'ROLLBACK').length, 1);
  assert.equal(h.closed(), 1); assert.equal(JSON.stringify(report).includes('PRIVATE'), false);
});

test('connection and cleanup failures are failures with redacted diagnostics', async () => {
  for (const failure of [{ failConnect: true }, { failClose: true }]) {
    const h = harness(failure); const report = await runInfraControlTower(h.options);
    assert.equal(report.exitCode, 1); assert.equal(report.state, 'DIAGNOSTICS_INCOMPLETE');
    assert.equal(report.recoveryVerified, false); assert.equal(h.closed(), 1);
    assert.equal(JSON.stringify(report).includes('PRIVATE'), false);
  }
});

test('database aliases honor precedence and ignore blank values', async () => {
  const h = harness();
  h.options.env = { DATABASE_URL: 'database', SUPABASE_DB_URL: 'supabase', IVX_BUDGET_RECONCILIATION_DATABASE_URL: '  reconciliation  ' };
  await runInfraControlTower(h.options); assert.equal(h.config().connectionString, 'reconciliation');
  h.options.env.IVX_BUDGET_RECONCILIATION_DATABASE_URL = ' ';
  await runInfraControlTower(h.options); assert.equal(h.config().connectionString, 'supabase');
});
