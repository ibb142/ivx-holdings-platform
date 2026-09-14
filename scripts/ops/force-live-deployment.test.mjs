import assert from 'node:assert/strict';
import { test } from 'node:test';
import { budgetBlockers, main, pipelineClientOptions, PREFLIGHT_SQL, runPipeline } from './force-live-deployment.mjs';

const budget = { enabled: true, requestsActive: 1, maxConcurrent: 12,
  dailyLimitNano: '1000000000000', settledUpperNano: '131173144554', unsettledLiabilityNano: '28940432000' };
const snapshot = { budget, connections: [{ application_name: 'Supavisor', connections: 6, selected_by_unsafe_filter: 6 }] };
function readOnlyClient(observation = snapshot) {
  const statements = [];
  return { statements, async query(sql) {
    statements.push(sql);
    if (sql === PREFLIGHT_SQL) return { rows: [{ snapshot: observation }] };
    if (/^with bounded/.test(sql)) return { rows: [] };
    if (/^(BEGIN READ ONLY|SET LOCAL |COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
    throw Error('UNEXPECTED_MUTATION');
  } };
}

test('capacity and money are checked independently without rounding bigint balances', () => {
  assert.deepEqual(budgetBlockers(budget), []);
  assert.deepEqual(budgetBlockers({ ...budget, requestsActive: 12 }), ['GLOBAL_CAPACITY_EXCEEDED']);
  assert.deepEqual(budgetBlockers({ ...budget, enabled: false }), ['BUDGET_NOT_ACTIVATED']);
  assert.deepEqual(budgetBlockers({ ...budget, dailyLimitNano: '9007199254740993',
    settledUpperNano: '9007199254740992', unsettledLiabilityNano: '1' }), ['GLOBAL_DAILY_BUDGET_EXCEEDED']);
  assert.deepEqual(budgetBlockers({ ...budget, requestsActive: null }), ['BUDGET_OBSERVATION_INVALID']);
});

test('a missing budget observation never permits task writes', async () => {
  const client = readOnlyClient({ budget: null, connections: [] });
  const report = await runPipeline(client, { apply: true, taskIds: ['selected-task'], reason: 'fixture' });
  assert.equal(report.state, 'BLOCKED');
  assert.equal(report.tasks.mode, 'DRY_RUN_PREVIEW');
  assert.equal(report.tasks.applied.length, 0);
});

test('full capacity blocks recovery and preserves managed idle sessions and financial holds', async () => {
  const client = readOnlyClient({ ...snapshot, budget: { ...budget, requestsActive: 12 } });
  const report = await runPipeline(client, { apply: true, taskIds: ['selected-task'], reason: 'fixture' });
  assert.equal(report.state, 'BLOCKED');
  assert.equal(report.connectionsTerminated, 0);
  assert.equal(report.financialRowsChanged, 0);
  assert.equal(report.zeroRuntimeErrorsCertified, false);
  assert.equal(report.tasks.mode, 'DRY_RUN_PREVIEW');
});

test('a preflight timeout aborts before the task scan or any mutation', async () => {
  const client = readOnlyClient();
  const query = client.query.bind(client);
  client.query = async sql => { if (sql === PREFLIGHT_SQL) throw Object.assign(Error('timeout'), { code: '57014' }); return query(sql); };
  await assert.rejects(runPipeline(client, { apply: true, taskIds: ['selected-task'], reason: 'fixture' }), { code: '57014' });
  assert.equal(client.statements.at(-1), 'ROLLBACK');
  assert.equal(client.statements.some(sql => sql.startsWith('with bounded')), false);
});

test('Supabase URL fallback retains project binding and verified TLS', () => {
  const url = 'postgres://postgres@db.kvclcdjmjghndxsngfzb.supabase.co/postgres';
  const options = pipelineClientOptions({ SUPABASE_DB_URL: url });
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.throws(() => pipelineClientOptions({ SUPABASE_DB_URL: 'postgres://postgres@unrelated.example/postgres' }), /PROJECT_BINDING_MISMATCH/);
  assert.throws(() => pipelineClientOptions({ IVX_BUDGET_RECONCILIATION_DATABASE_URL: 'bad', DATABASE_URL: url }), /INVALID_DATABASE_URL/);
});

test('CLI fails closed for unselected apply and missing credentials; help needs neither', async () => {
  await assert.rejects(main(['--apply'], {}, null, () => {}), /APPLY_REQUIRES/);
  await assert.rejects(main([], {}, null, () => {}), /DATABASE_URL_REQUIRED/);
  assert.equal(await main(['--help'], {}, null, () => {}), 0);
});

test('an empty apply reports no recovery with exit 2 and closes exactly once', async () => {
  let ends = 0, output;
  class Client {
    async connect() {}
    async query(sql) { return readOnlyClient().query(sql); }
    async end() { ends++; }
  }
  const code = await main(['--apply','--task-ids=selected-task','--reason=fixture'], {
    DATABASE_URL: 'postgres://postgres@db.kvclcdjmjghndxsngfzb.supabase.co/postgres',
  }, Client, value => { output = JSON.parse(value); });
  assert.equal(code, 2);
  assert.equal(output.state, 'NO_TASKS_RECOVERED');
  assert.equal(output.tasks.applied.length, 0);
  assert.equal(ends, 1);
});
