import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runQuantumUpgradeAudit, UPGRADE_TASK_QUERY, UPGRADE_LOG_QUERY, UPGRADE_LOG_KEY } from './audit-quantum-upgrade.mjs';

function harness({ failConnect = false, failQuery = false, failClose = false, empty = false } = {}) {
  const calls = []; let closed = 0; let config;
  const client = {
    async connect() { if (failConnect) throw new Error('PRIVATE_CONNECTION'); },
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql === UPGRADE_TASK_QUERY) {
        if (failQuery) throw Object.assign(new Error('PRIVATE_PAYLOAD'), { code: '57014' });
        return { rows: [{ sampled_tasks: 500, matches_in_sample: empty ? 0 : 11, older_tasks_unscanned: true,
          tasks: empty ? [] : [{ task_id: 'self_upgrade', state: 'FAILED', payload_state: 'QUEUED',
            version: '9007199254740993', reported_completed_at: null, evidence_format: 'string', evidence_count: null }] }] };
      }
      if (sql === UPGRADE_LOG_QUERY) return { rows: [{ document_found: false, entries: [] }] };
      return { rows: [] };
    },
    async end() { closed++; if (failClose) throw new Error('PRIVATE_CLOSE'); },
  };
  return { calls, closed: () => closed, config: () => config,
    options: { env: { DATABASE_URL: 'postgres://fixture:PRIVATE@127.0.0.1/test' },
      createClient: async value => { config = value; return client; } } };
}

test('one bounded client reads both sources in read-only transactions and closes once', async () => {
  const h = harness(); const report = await runQuantumUpgradeAudit(h.options);
  assert.equal(report.exitCode, 0); assert.equal(report.upgradeVerified, false);
  assert.equal(report.versionProgress, 'NOT_ASSESSED_SINGLE_SNAPSHOT');
  assert.equal(report.mutationsPerformed, 0); assert.equal(h.closed(), 1);
  assert.equal(h.config().connectionTimeoutMillis, 5000); assert.equal(h.config().statement_timeout, 3000);
  for (const [sql, params] of [[UPGRADE_TASK_QUERY, [500]], [UPGRADE_LOG_QUERY, [UPGRADE_LOG_KEY]]]) {
    const index = h.calls.findIndex(call => call.sql === sql);
    assert.deepEqual(h.calls[index].params, params);
    assert.equal(h.calls[index - 3].sql, 'BEGIN READ ONLY');
    assert.equal(h.calls[index - 2].sql, "SET LOCAL statement_timeout = '3000ms'");
    assert.equal(h.calls[index + 1].sql, 'COMMIT');
  }
  const task = report.sections.tasks.data.tasks[0];
  assert.equal(task.version, '9007199254740993');
  assert.equal(task.state_consistent, false); assert.equal(task.reported_completed_at, null);
  assert.equal(task.evidence_review, 'INVALID_EVIDENCE_FORMAT');
  assert.equal(report.sections.tasks.data.results_truncated, true);
});

test('no matches is limited to the scanned sample and never implies a running study', async () => {
  const h = harness({ empty: true }); const report = await runQuantumUpgradeAudit(h.options);
  assert.equal(report.sections.tasks.data.finding, 'NO_MATCHES_IN_SCANNED_SAMPLE');
  assert.equal(report.sections.tasks.data.older_tasks_unscanned, true);
  assert.deepEqual(report.sections.tasks.data.tasks, []);
  assert.equal(report.upgradeVerified, false); assert.equal(h.closed(), 1);
});

test('a timeout stays unavailable, rolls back and still reads the independent daily log', async () => {
  const h = harness({ failQuery: true }); const report = await runQuantumUpgradeAudit(h.options);
  assert.equal(report.exitCode, 2); assert.equal(report.state, 'AUDIT_INCOMPLETE');
  assert.equal(report.sections.tasks.error, 'POSTGRES_57014');
  assert.equal(report.sections.tasks.data, null); assert.equal(report.sections.dailyLog.status, 'OBSERVED');
  assert.equal(h.calls.filter(call => call.sql === 'ROLLBACK').length, 1);
  assert.equal(h.closed(), 1); assert.equal(JSON.stringify(report).includes('PRIVATE'), false);
});

test('connection and cleanup failures are nonzero and never print private errors', async () => {
  for (const failure of [{ failConnect: true }, { failClose: true }]) {
    const h = harness(failure); const report = await runQuantumUpgradeAudit(h.options);
    assert.equal(report.exitCode, 1); assert.equal(report.state, 'AUDIT_INCOMPLETE');
    assert.equal(h.closed(), 1); assert.equal(report.upgradeVerified, false);
    assert.equal(JSON.stringify(report).includes('PRIVATE'), false);
  }
});

test('missing bindings and invalid scan limits fail before connecting', async () => {
  for (const options of [{ env: {} }, ...[0, -1, 2001, Infinity, 1.5, '50'].map(scanLimit => ({ scanLimit }))]) {
    const report = await runQuantumUpgradeAudit({ ...options, createClient: () => { throw new Error('Must not connect'); } });
    assert.equal(report.exitCode, 1);
    assert.ok(['CONFIGURATION_MISSING', 'INVALID_ARGUMENT'].includes(report.state));
  }
});

test('database bindings ignore blanks and respect the existing precedence', async () => {
  const h = harness();
  h.options.env = { DATABASE_URL: 'database', SUPABASE_DB_URL: 'supabase', IVX_BUDGET_RECONCILIATION_DATABASE_URL: ' reconciliation ' };
  await runQuantumUpgradeAudit(h.options); assert.equal(h.config().connectionString, 'reconciliation');
  h.options.env.IVX_BUDGET_RECONCILIATION_DATABASE_URL = ' ';
  await runQuantumUpgradeAudit(h.options); assert.equal(h.config().connectionString, 'supabase');
});
