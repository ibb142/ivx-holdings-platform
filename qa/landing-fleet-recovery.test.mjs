import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const readSource = (name) => readFile(new URL(`../backend/services/${name}.ts`, import.meta.url), 'utf8');
const compile = (source) => moduleUrl(stripTypeScriptTypes(source, { mode: 'transform' }));
const retryUrl = compile(await readSource('ivx-retry-policy'));
const pgUrl = compile((await readSource('ivx-postgres-autonomous-task-store')).replace("from './ivx-retry-policy'", `from '${retryUrl}'`));
const durableUrl = moduleUrl(`
export const isDurableStoreConfigured = () => false;
export const readDurableJson = async () => { throw new Error('Unexpected legacy ledger read'); };
export const writeDurableJson = async () => { throw new Error('Unexpected legacy ledger write'); };
export const appendDurableEvent = async () => {};
export const readDurableEvents = async () => [];
`);
const engineUrl = compile((await readSource('ivx-autonomous-task-engine'))
  .replace("from './ivx-retry-policy'", `from '${retryUrl}'`)
  .replace("from './ivx-postgres-autonomous-task-store'", `from '${pgUrl}'`)
  .replace("from './ivx-durable-store'", `from '${durableUrl}'`));
const pg = await import(pgUrl);
const engine = await import(engineUrl);
const retry = await import(retryUrl);
const originalFetch = globalThis.fetch;
const savedEnv = { ...process.env };
process.env.IVX_AUTONOMOUS_QUEUE_BACKEND = 'postgres_atomic';
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://queue.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-test-credential';
process.env.IVX_AUTONOMOUS_WORKER_INSTANCE_ID = 'synthetic-worker';
test.after(() => { globalThis.fetch = originalFetch; process.env = savedEnv; });
test.afterEach(() => pg.resetPostgresAutonomousTaskStoreForTests());

const sha = 'a'.repeat(40);
function patrol(agent = 1) {
  return {
    taskId: `synthetic-task-${agent}`,
    idempotencyKey: `landing-p0-patrol:${sha}:ia-${String(agent).padStart(3, '0')}`,
    assignedAgentNumber: agent,
    state: 'RUNNING', leaseHolder: `agent:ivx_holdings_${agent}`,
    leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
    lastHeartbeatAt: new Date().toISOString(),
    retryCount: 2, maxRetries: 3,
    retryStartedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
    retryNotBefore: null, evidence: [], recordsChanged: 0,
    acceptanceCriteria: [], error: null, blocker: null,
  };
}
const evidence = {
  evidenceType: 'production_verification', source: 'synthetic-observation',
  contentHash: 'b'.repeat(64), summary: 'Synthetic failed QA observation', commitSha: sha, deploymentId: null,
};

test('a task lookup reads one identity and never downloads the historical ledger', async () => {
  const row = patrol();
  let calls = 0;
  globalThis.fetch = async (input) => {
    calls += 1;
    const url = new URL(input);
    assert.equal(url.searchParams.get('task_id'), `eq.${row.taskId}`);
    assert.equal(url.searchParams.get('limit'), '1');
    assert.equal(url.searchParams.get('offset'), null);
    return Response.json([{ payload: row }]);
  };
  assert.equal((await engine.getTaskById(row.taskId)).taskId, row.taskId);
  assert.equal(calls, 1);
});

test('targeted reads fail closed on a mismatched identity or malformed response', async () => {
  globalThis.fetch = async () => Response.json([{ payload: patrol(2) }]);
  await assert.rejects(pg.readPostgresTaskById('synthetic-task-1'), /identity mismatch/);
  globalThis.fetch = async () => Response.json({ error: 'bad response' });
  await assert.rejects(pg.readPostgresTaskById('synthetic-task-1'), /response is invalid/);
  globalThis.fetch = async () => Response.json([]);
  assert.equal(await pg.readPostgresTaskById('missing'), null);
});

test('seeding transfers only identities for the exact mission SHA', async () => {
  const prefix = `landing-p0:${sha}:`;
  globalThis.fetch = async (input) => {
    const query = new URL(input).searchParams;
    assert.equal(query.get('select'), 'task_id,idempotency_key,state');
    assert.equal(query.get('idempotency_key'), `like.${prefix}*`);
    return Response.json([{ task_id: 'synthetic-1', idempotency_key: `${prefix}unit`, state: 'VERIFIED' }]);
  };
  assert.deepEqual(await pg.readPostgresTaskIdentitiesByPrefix(prefix), [{ taskId: 'synthetic-1', idempotencyKey: `${prefix}unit`, state: 'VERIFIED' }]);
  await assert.rejects(pg.readPostgresTaskIdentitiesByPrefix('landing-p0:*'), /Exact mission prefix/);
  globalThis.fetch = async () => Response.json(Array.from({ length: 1000 }, () => ({})));
  await assert.rejects(pg.readPostgresTaskIdentitiesByPrefix(prefix), /incomplete/);
});

test('112 completed observations persist evidence and release 112 leases with exactly 112 guarded writes', async () => {
  const rows = new Map(Array.from({ length: 112 }, (_, i) => { const row = patrol(i + 1); return [row.taskId, row]; }));
  let writes = 0;
  globalThis.fetch = async (input, init) => {
    assert.equal(init.method, 'POST');
    assert.ok(String(input).endsWith('/rpc/ivx_autonomous_task_compare_and_set'));
    const body = JSON.parse(init.body);
    const before = rows.get(body.p_task.taskId);
    assert.deepEqual(body.p_expected_states, ['RUNNING']);
    assert.equal(body.p_lease_holder, before.leaseHolder);
    assert.equal(body.p_worker_instance_id, 'synthetic-worker');
    rows.set(body.p_task.taskId, body.p_task);
    writes += 1;
    return Response.json({ ok: true, task: body.p_task, error: null });
  };
  const next = new Date(Date.now() + 60_000).toISOString();
  const results = await Promise.all([...rows.values()].map(task => engine.recordLeasedTaskEvidence({ task, workerId: task.leaseHolder, evidence, nextObservationAt: next })));
  assert.equal(writes, 112);
  assert.ok(results.every(result => result.ok && result.evidenceId));
  for (const row of rows.values()) {
    assert.equal(row.state, 'QUEUED');
    assert.equal(row.leaseHolder, null);
    assert.equal(row.lastHeartbeatAt, null);
    assert.equal(row.leaseExpiresAt, null);
    assert.equal(row.recordsChanged, 1);
    assert.equal(row.evidence[0].summary, evidence.summary);
    assert.equal(row.retryCount, 0);
    assert.equal(row.retryStartedAt, null);
    assert.equal(row.retryNotBefore, next);
    assert.equal(retry.taskRetryDue(row), false);
    assert.equal(retry.taskRetryDue(row, Date.parse(next)), true);
    assert.equal(retry.planTaskRetry(row).state, 'RETRYING');
  }
});

test('a stale holder cannot report a persisted observation or release another lease', async () => {
  globalThis.fetch = async () => Response.json({ ok: false, task: null, error: 'Not the lease holder.' });
  const task = patrol();
  const result = await engine.recordLeasedTaskEvidence({ task, workerId: task.leaseHolder, evidence, nextObservationAt: new Date(Date.now() + 60_000).toISOString() });
  assert.equal(result.ok, false);
  assert.equal(result.evidenceId, null);
  assert.equal(task.state, 'RUNNING');
  assert.equal(task.evidence.length, 0);
});

test('an ambiguous evidence mutation is never replayed automatically', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('fetch failed after possible commit'); };
  const task = patrol();
  await assert.rejects(engine.recordLeasedTaskEvidence({ task, workerId: task.leaseHolder, evidence, nextObservationAt: new Date(Date.now() + 60_000).toISOString() }), /fetch failed/);
  assert.equal(calls, 1);
});

test('only a running patrol with a future observation time can schedule a recurrence', async () => {
  globalThis.fetch = async () => { throw new Error('Unexpected mutation'); };
  for (const nextObservationAt of ['invalid', new Date(Date.now() - 1_000).toISOString()]) {
    const task = patrol();
    await assert.rejects(engine.recordLeasedTaskEvidence({ task, workerId: task.leaseHolder, evidence, nextObservationAt }), /future patrol/);
  }
  const task = { ...patrol(), state: 'FAILED' };
  const result = await engine.recordLeasedTaskEvidence({ task, workerId: task.leaseHolder, evidence, nextObservationAt: new Date(Date.now() + 60_000).toISOString() });
  assert.equal(result.ok, false);
  assert.match(result.error, /FAILED/);
});

test('a body read timeout propagates instead of becoming a false empty response', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { status: 200, ok: true, headers: new Headers(), text: async () => { throw new Error('body read failed'); } };
  };
  await assert.rejects(pg.readPostgresTaskById('synthetic-task-1'), /body read failed/);
  assert.equal(calls, 1);
});
