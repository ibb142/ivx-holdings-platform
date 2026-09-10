import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const reportPath = 'qa/evidence/fleet-ha/task-recovery.json';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = text => createHash('sha256').update(text).digest('hex');

function localConnection() {
  const connectionString = process.env.IVX_HA_TEST_DATABASE_URL;
  const url = new URL(connectionString ?? 'postgres://invalid/');
  assert(['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname === '/ivx_ha_test',
    'Recovery fixtures require the isolated local ivx_ha_test database');
  return connectionString;
}

const laneRequest = agent => JSON.stringify([{ workerId: `agent:ivx_holdings_${agent}`, agentNumber: agent }]);
const leaseRequest = (taskId, agent) => JSON.stringify([{ taskId, workerId: `agent:ivx_holdings_${agent}` }]);
async function claim(client, agent, worker) {
  return (await client.query('select public.ivx_autonomous_tasks_claim_batch($1::jsonb,$2,30) as value',
    [laneRequest(agent), worker])).rows[0].value[0];
}
async function start(client, taskId, agent, worker) {
  return (await client.query('select public.ivx_autonomous_tasks_start_batch($1::jsonb,$2,30) as value',
    [leaseRequest(taskId, agent), worker])).rows[0].value[0];
}
async function heartbeat(client, taskId, agent, worker) {
  return (await client.query('select public.ivx_autonomous_tasks_heartbeat_batch($1::jsonb,$2,30) as value',
    [leaseRequest(taskId, agent), worker])).rows[0].value;
}
async function cas(client, task, states, agent, worker, eventType) {
  return (await client.query('select public.ivx_autonomous_task_compare_and_set($1::jsonb,$2::jsonb,$3,$4,$5) as value',
    [JSON.stringify(task), JSON.stringify(states), `agent:ivx_holdings_${agent}`, worker, eventType])).rows[0].value;
}
async function readTask(client, taskId) {
  return (await client.query('select task_id,idempotency_key,state,worker_instance_id,lease_holder,lease_expires_at,version,payload,clock_timestamp() as observed_at from public.ivx_autonomous_tasks where task_id=$1', [taskId])).rows[0];
}
function evidence(id, summary) {
  return { id, summary, contentHash: hash(summary), createdAt: new Date().toISOString(),
    source: 'isolated-postgres-recovery-fixture', production: false };
}

// A separate OS process acquires a real lease and persists its checkpoint.
// SIGKILL bypasses its shutdown handler; the parent never alters lease clocks.
async function runWorker() {
  const [taskId, agentText, worker, mode] = process.argv.slice(3);
  const agent = Number(agentText);
  assert(Number.isInteger(agent) && agent >= 2 && agent <= 112);
  assert(['graceful', 'crash'].includes(mode));
  const client = new pg.Client({ connectionString: localConnection() });
  client.on('error', () => { process.exitCode = 1; });
  await client.connect();
  let stopping = false;
  process.on('SIGTERM', async () => {
    if (stopping) return;
    stopping = true;
    try {
      const released = (await client.query('select public.ivx_autonomous_tasks_release_worker($1) as value', [worker])).rows[0].value;
      assert.equal(released.released, 1);
      await client.end();
      process.exit(0);
    } catch (error) {
      process.send?.({ error: String(error.message) });
      process.exit(1);
    }
  });
  const leased = await claim(client, agent, worker);
  assert.equal(leased.task?.taskId, taskId);
  const running = await start(client, taskId, agent, worker);
  assert.equal(running.ok, true);
  const checkpoint = evidence(`${taskId}:checkpoint`, `Checkpoint for ${taskId} before ${mode} worker exit`);
  const saved = await cas(client, { ...running.task, evidence: [checkpoint] }, ['RUNNING'], agent, worker, 'recovery_fixture_checkpoint');
  assert.equal(saved.ok, true);
  process.send?.({ ready: true, task: saved.task, pid: process.pid });
}

async function checkpoint(proof) {
  await mkdir('qa/evidence/fleet-ha', { recursive: true });
  await writeFile(reportPath, JSON.stringify(proof, null, 2));
}

export async function proveInterruptedTaskRecovery(reader, successor) {
  localConnection();
  const proof = { verification: 'PENDING', database: 'isolated PostgreSQL',
    sourceSha: process.env.GITHUB_SHA ?? null, productionRowsTouched: 0,
    leaseClockModified: false, externalSideEffectsExactlyOnceClaimed: false,
    fullItem10Certified: false, startedAt: new Date().toISOString(), scenarios: [] };
  await checkpoint(proof);
  try {
    for (const [index, mode] of ['graceful', 'crash'].entries()) {
      const agent = index + 2;
      const taskId = `recovery-${mode}`;
      const worker = `interrupted-${mode}`;
      const replacement = `replacement-${mode}`;
      const fixture = { taskId, idempotencyKey: `recovery-key-${mode}`, assignedAgentNumber: agent,
        state: 'QUEUED', dependencies: [], retryCount: 0, maxRetries: 3, evidence: [] };
      const created = (await reader.query('select public.ivx_autonomous_tasks_create_batch($1::jsonb) as value', [JSON.stringify([fixture])])).rows[0].value[0];
      assert.equal(created.ok, true);
      assert.equal(created.duplicate, false);
      const scenario = { mode, taskId, idempotencyKey: fixture.idempotencyKey, worker, replacement, verification: 'PENDING' };
      proof.scenarios.push(scenario);
      const child = fork(fileURLToPath(import.meta.url), ['--worker', taskId, String(agent), worker, mode],
        { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: process.env });
      let stderr = '';
      child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-4000); });
      child.stdout.resume();
      const exited = once(child, 'exit');
      // Prevent an unexpected child error from becoming an unhandled rejection.
      exited.catch(() => {});
      try {
        const ready = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Recovery worker did not acquire its task within 10 seconds')), 10_000);
          const finish = (error, value) => {
            clearTimeout(timer); child.off('message', onMessage); child.off('error', onError); child.off('exit', onExit);
            error ? reject(error) : resolve(value);
          };
          const onMessage = value => value?.ready ? finish(null, value) : value?.error ? finish(new Error(value.error)) : undefined;
          const onError = error => finish(error);
          const onExit = () => finish(new Error(`Recovery worker exited before checkpoint: ${stderr}`));
          child.on('message', onMessage); child.on('error', onError); child.on('exit', onExit);
        });
        const before = await readTask(reader, taskId);
        assert.equal(before.state, 'RUNNING');
        assert.equal(before.worker_instance_id, worker);
        assert.deepEqual(before.payload.evidence, ready.task.evidence, 'independent connection must see committed checkpoint');
        assert.equal((await claim(successor, agent, replacement)).task, null, 'live lease cannot be stolen');
        assert.equal((await heartbeat(successor, taskId, agent, replacement)).refreshed, 0);
        scenario.before = before;
        scenario.childPid = ready.pid;
        await checkpoint(proof);
        assert.equal(child.kill(mode === 'crash' ? 'SIGKILL' : 'SIGTERM'), true);
        const [exitCode, signal] = await exited;
        assert.equal(mode === 'crash' ? signal : exitCode, mode === 'crash' ? 'SIGKILL' : 0, stderr);
        scenario.exit = { exitCode, signal, observedAt: new Date().toISOString() };
        const exitedTask = await readTask(reader, taskId);
        let recovered;
        if (mode === 'graceful') {
          assert.equal(exitedTask.state, 'QUEUED');
          assert.equal(exitedTask.worker_instance_id, null);
          assert.equal(exitedTask.lease_holder, null);
          assert.ok(exitedTask.payload.shutdownReleasedAt, 'graceful shutdown must release this exact task');
        } else {
          assert.equal(exitedTask.state, 'RUNNING');
          assert.equal(exitedTask.worker_instance_id, worker);
          assert.equal(exitedTask.payload.shutdownReleasedAt, undefined, 'SIGKILL must bypass graceful lease release');
          assert.equal((await claim(successor, agent, replacement)).task, null, 'crashed worker lease remains exclusive until it expires');
          const waitMs = new Date(exitedTask.lease_expires_at).getTime() - new Date(exitedTask.observed_at).getTime();
          assert(waitMs > 0 && waitMs <= 30_000, 'expected a real unexpired thirty-second lease');
          await sleep(waitMs + 100);
          assert.equal((await heartbeat(reader, taskId, agent, worker)).refreshed, 0, 'expired worker cannot renew');
          assert.equal((await cas(reader, { ...ready.task, state: 'EXECUTION_COMPLETED' }, ['RUNNING'], agent, worker, 'recovery_fixture_forbidden')).ok, false);
          recovered = await claim(successor, agent, replacement);
          const retry = await readTask(reader, taskId);
          assert(['RETRYING', 'LEASED'].includes(retry.state));
          assert.equal(retry.payload.retryCount, 1);
          // Full jitter legitimately includes zero milliseconds. Validate the
          // actual eligibility time without inventing a mandatory nonzero wait.
          const retryDelay = new Date(retry.payload.retryNotBefore) - new Date(retry.payload.retryStartedAt);
          assert(retryDelay >= 0 && retryDelay < 1000, 'first retry must respect the configured full-jitter range');
          if (new Date(retry.payload.retryNotBefore) > new Date(retry.observed_at)) {
            assert.equal(recovered.task, null, 'a future retry must not acquire a lease early');
            assert.equal(retry.state, 'RETRYING');
          }
          scenario.retry = { state: retry.state, retryCount: retry.payload.retryCount, notBefore: retry.payload.retryNotBefore };
        }
        const deadline = Date.now() + 45_000;
        do {
          if (recovered?.task) break;
          recovered = await claim(successor, agent, replacement);
          if (recovered.task) break;
          await sleep(200);
        } while (Date.now() < deadline);
        assert.equal(recovered.task?.taskId, taskId, 'replacement must recover the interrupted task, not merely another available task');
        assert.equal(recovered.task.idempotencyKey, fixture.idempotencyKey);
        assert.deepEqual(recovered.task.evidence, ready.task.evidence, 'recovery cannot discard existing evidence');
        const owned = await readTask(reader, taskId);
        assert.equal(owned.worker_instance_id, replacement);
        assert(owned.version > before.version);
        if (scenario.retry) assert(new Date(owned.observed_at) >= new Date(scenario.retry.notBefore), 'recovery must respect backoff');
        assert.equal((await start(reader, taskId, agent, worker)).ok, false, 'old process cannot start successor lease');
        assert.equal((await heartbeat(reader, taskId, agent, worker)).refreshed, 0, 'old process cannot renew successor lease');
        const lateRelease = (await reader.query('select public.ivx_autonomous_tasks_release_worker($1) as value', [worker])).rows[0].value;
        assert.equal(lateRelease.released, 0, 'late old-worker shutdown must not release successor');
        const resumed = await start(successor, taskId, agent, replacement);
        assert.equal(resumed.ok, true);
        assert.equal((await cas(reader, { ...ready.task, state: 'EXECUTION_COMPLETED' }, ['RUNNING'], agent, worker, 'recovery_fixture_forbidden')).ok, false,
          'old process completion must remain fenced after new process starts');
        const result = evidence(`${taskId}:result`, `Isolated PostgreSQL recovery result for ${taskId}`);
        const completed = await cas(successor, { ...resumed.task, state: 'EXECUTION_COMPLETED', evidence: [...resumed.task.evidence, result] }, ['RUNNING'], agent, replacement, 'recovery_fixture_completed');
        assert.equal(completed.ok, true);
        const qa = await cas(successor, { ...completed.task, state: 'QA_IN_PROGRESS' }, ['EXECUTION_COMPLETED'], agent, replacement, 'recovery_fixture_qa');
        assert.equal(qa.ok, true);
        const terminalPayload = { ...qa.task, state: 'VERIFIED', completedAt: new Date().toISOString(), leaseHolder: null, leaseExpiresAt: null, lastHeartbeatAt: null };
        const verified = await cas(successor, terminalPayload, ['QA_IN_PROGRESS'], agent, replacement, 'recovery_fixture_verified');
        assert.equal(verified.ok, true);
        assert.equal((await cas(successor, terminalPayload, ['QA_IN_PROGRESS'], agent, replacement, 'recovery_fixture_verified')).ok, false, 'completion replay must fail');
        const duplicate = (await reader.query('select public.ivx_autonomous_tasks_create_batch($1::jsonb) as value',
          [JSON.stringify([{ ...fixture, taskId: `${taskId}-duplicate` }])])).rows[0].value[0];
        assert.equal(duplicate.duplicate, true);
        assert.equal(duplicate.task.taskId, taskId);
        const final = await readTask(reader, taskId);
        assert.equal(final.state, 'VERIFIED');
        assert.equal(final.worker_instance_id, null);
        assert.deepEqual(final.payload.evidence, [ready.task.evidence[0], result]);
        for (const item of final.payload.evidence) assert.equal(hash(item.summary), item.contentHash);
        assert.equal((await reader.query('select count(*)::integer as count from public.ivx_autonomous_tasks where idempotency_key=$1', [fixture.idempotencyKey])).rows[0].count, 1);
        const events = (await reader.query('select event_type,worker_instance_id,event,created_at from public.ivx_autonomous_task_events where task_id=$1 order by id', [taskId])).rows;
        assert.equal(events.filter(event => event.event_type === 'recovery_fixture_verified').length, 1);
        assert.equal(events.filter(event => event.event_type === 'recovery_fixture_completed').length, 1);
        assert.equal(events.filter(event => event.event_type === 'recovery_fixture_forbidden').length, 0);
        assert.equal(events.find(event => event.event_type === 'recovery_fixture_verified').worker_instance_id, replacement);
        scenario.after = final;
        scenario.events = events;
        scenario.verification = 'PASS';
        await checkpoint(proof);
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }
    }
    proof.verification = 'PASS';
    proof.finishedAt = new Date().toISOString();
    await checkpoint(proof);
    console.log(JSON.stringify({ verification: proof.verification, scope: 'isolated PostgreSQL task recovery',
      sourceSha: proof.sourceSha, scenarios: proof.scenarios.map(({ mode, taskId, verification }) => ({ mode, taskId, verification })),
      leaseClockModified: false, productionRowsTouched: 0, reportPath }));
    return proof;
  } catch (error) {
    proof.verification = 'FAIL';
    proof.error = String(error.message);
    proof.finishedAt = new Date().toISOString();
    await checkpoint(proof);
    throw error;
  }
}

if (process.argv[2] === '--worker') runWorker().catch(error => {
  process.send?.({ error: String(error.message) });
  process.exit(1);
});
