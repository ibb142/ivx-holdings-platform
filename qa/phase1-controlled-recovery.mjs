import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const REPO = 'ibb142/ivx-holdings-platform';
export const API = 'https://api.ivxholding.com';
export const SERVICES = { api: 'srv-d7t9ivreo5us73ftose0', worker: 'srv-d9i15fg4n6ts73bn00j0' };
export const TARGET = '65db16fb45eeba053a1a761ee602a1ef34ad98b7';
export const BRANCH = 'qa/phase1-controlled-recovery-20260912';
const PROJECT = 'kvclcdjmjghndxsngfzb';
const LIVE_JOB = 'Controlled API and worker restart acceptance';
const FILES = ['qa/phase1-controlled-recovery.mjs', 'qa/phase1-controlled-recovery.test.mjs', '.github/workflows/phase1-controlled-recovery.yml'];
const OUTPUT = 'qa-results/phase1-controlled-recovery/receipt.json';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function validateScope(env) {
  assert.equal(env.GITHUB_REPOSITORY, REPO);
  assert.equal(env.GITHUB_ACTOR, 'ibb142');
  assert.equal(env.GITHUB_EVENT_NAME, 'pull_request');
  assert.equal(env.IVX_QA_HEAD_BRANCH, BRANCH);
  assert.equal(env.IVX_TARGET_SHA, TARGET);
  assert.match(env.IVX_QA_SOURCE_SHA ?? '', /^[a-f0-9]{40}$/);
  assert.match(env.IVX_QA_PR ?? '', /^\d+$/);
  assert.equal(env.IVX_PHASE1_RESTART_AUTHORIZATION, 'controlled-api-then-worker-once');
  assert(env.IVX_SYSTEM_KEY && env.RENDER_API_KEY && env.GH_TOKEN, 'Protected credentials are required');
  assert.equal(new URL(env.SUPABASE_URL).origin, `https://${PROJECT}.supabase.co`);
  const db = new URL(env.SUPABASE_DB_URL || env.DATABASE_URL || 'postgres://invalid');
  assert(['postgres:', 'postgresql:'].includes(db.protocol) && db.password && db.pathname === '/postgres');
  assert(db.hostname === `db.${PROJECT}.supabase.co`
    || (db.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(db.username) === `postgres.${PROJECT}`), 'Wrong database project');
}

export function reviewChecks(rows) {
  assert(Array.isArray(rows) && rows.length > 0, 'No checks returned');
  const latest = new Map();
  for (const row of rows) if (!latest.has(row.name) || latest.get(row.name).id < row.id) latest.set(row.name, row);
  const applicable = [...latest.values()].filter(row => row.name !== LIVE_JOB);
  assert(applicable.some(row => row.name === 'Restart acceptance scope and verdict checks'), 'Missing harness gate');
  assert(applicable.length >= 3, 'Missing repository checks');
  const failed = applicable.filter(row => row.status === 'completed' && !['success', 'skipped'].includes(row.conclusion));
  assert.equal(failed.length, 0, `Repository checks failed: ${failed.map(row => row.name).join(', ')}`);
  return applicable.every(row => row.status === 'completed');
}

export function taskSummary(row) {
  assert(row?.payload && row.task_id === row.payload.taskId && row.idempotency_key === row.payload.idempotencyKey);
  return { taskId: row.task_id, key: row.idempotency_key, state: row.state,
    worker: row.worker_instance_id, holder: row.lease_holder, version: Number(row.version),
    observations: Number(row.payload.recordsChanged ?? 0), commitSha: row.payload.commitSha ?? null,
    evidence: (row.payload.evidence ?? []).map(e => ({ id: e.evidenceId, hash: digest(e), commitSha: e.commitSha })),
    observedAt: row.observed_at };
}

export function requireCheckpoint(before, after, archived) {
  assert.equal(after.taskId, before.taskId, 'Task identity changed');
  assert.equal(after.key, before.key, 'Task key changed');
  assert.equal(after.commitSha, before.commitSha, 'Task commit changed');
  assert(after.version >= before.version && after.observations >= before.observations, 'Checkpoint regressed');
  assert(before.evidence.length > 0, 'No committed checkpoint to recover');
  for (const proof of before.evidence) {
    const saved = archived.find(e => e.evidence_id === proof.id);
    assert(saved && digest(saved.evidence) === proof.hash, 'Committed checkpoint missing or changed');
  }
  const ids = archived.map(e => e.evidence_id);
  assert.equal(new Set(ids).size, ids.length, 'Duplicate evidence ID');
  const identities = archived.map(e => e.measurement?.identity).filter(Boolean);
  assert.equal(new Set(identities).size, identities.length, 'Duplicate committed observation');
}

export function requireRecovery(before, after, archived, matchesReplacement, restartAt) {
  requireCheckpoint(before, after, archived);
  assert(after.observations > before.observations, 'Replacement did not advance the saved checkpoint');
  const fresh = archived.filter(e => Date.parse(e.recorded_at) > Date.parse(restartAt) && matchesReplacement(e.worker_instance_id));
  assert(fresh.length > 0, 'No durable result from a replacement process');
  assert(fresh.some(e => e.evidence.commitSha === TARGET), 'Recovered work did not verify the deployed commit');
  return fresh.map(e => ({ evidenceId: e.evidence_id, worker: e.worker_instance_id,
    recordedAt: e.recorded_at, outcome: e.measurement?.outcome ?? null, hash: digest(e.evidence) }));
}

export function requireDuplicate(reply, taskId) {
  assert.equal(reply.ok, true); assert.equal(reply.duplicate, true, 'Idempotent request created another task');
  assert.equal(reply.task?.taskId, taskId, 'Idempotent request returned a different task');
}

export async function run() {
  const receipt = { sourceSha: process.env.IVX_QA_SOURCE_SHA, deploymentSha: TARGET,
    startedAt: new Date().toISOString(), result: 'PENDING', items: {}, requests: [], actions: [], errors: [],
    scope: 'Controlled rolling service restarts, task API idempotency, and native patrol checkpoint recovery',
    directDatabaseWritesByHarness: 0, leaseClocksModified: false, workerIdentityImpersonation: false,
    codingCommitPublicationTested: false, productBrowserCertified: false };
  const save = async () => { await mkdir('qa-results/phase1-controlled-recovery', { recursive: true }); await writeFile(OUTPUT, JSON.stringify(receipt, null, 2)); };
  const log = (phase, data = {}) => console.log(JSON.stringify({ phase, ...data }));
  let db, fixture;
  const env = process.env;
  async function json(url, { body, headers = {}, deadline = 15000 } = {}) {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(deadline),
      method: body === undefined ? 'GET' : 'POST', headers: { Accept: 'application/json', ...headers,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert(response.ok, `HTTP ${response.status} at ${new URL(url).pathname}`);
    return response.json();
  }
  const github = (path, body) => json(`https://api.github.com/repos/${REPO}/${path}`, { body,
    headers: { Authorization: `Bearer ${env.GH_TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28' } });
  const render = path => json('https://api.render.com/v1' + path, { headers: { Authorization: `Bearer ${env.RENDER_API_KEY}` } });
  const app = async (path, body, deadline = 15000) => {
    const started = Date.now();
    try {
      const reply = await json(API + path, { body, deadline,
        headers: { 'X-IVX-System-Key': env.IVX_SYSTEM_KEY, 'Cache-Control': 'no-store', Connection: 'close' } });
      assert.equal(reply.ok, true, `Operation rejected at ${path}`);
      receipt.requests.push({ path, method: body === undefined ? 'GET' : 'POST', status: 200,
        ...(path === '/health' ? { instanceId: reply.instanceId, commit: reply.commit } : {}),
        ms: Date.now() - started, at: new Date().toISOString() });
      return reply;
    } catch (error) {
      receipt.requests.push({ path, status: 'FAIL', ms: Date.now() - started, error: error.message, at: new Date().toISOString() });
      throw error;
    }
  };
  async function exactMain() {
    const branch = await github('branches/main'); assert.equal(branch.commit.sha, TARGET, 'Production target superseded');
  }
  async function topology(rolling = null) {
    const result = {};
    for (const [role, id] of Object.entries(SERVICES)) {
      const [service, entries, instances] = await Promise.all([render(`/services/${id}`), render(`/services/${id}/deploys?limit=5`), render(`/services/${id}/instances`)]);
      assert.equal(service.id, id); assert.equal(service.repo, `https://github.com/${REPO}`);
      assert.equal(service.branch, 'main'); assert.equal(service.suspended, 'not_suspended');
      assert.equal(service.serviceDetails.numInstances, 2);
      const deploys = entries.map(e => e.deploy ?? e), live = deploys.find(e => e.status === 'live');
      assert.equal(live?.commit?.id, TARGET, 'Render live revision differs');
      assert(!deploys.some(e => ['build_in_progress', 'update_in_progress', 'pre_deploy_in_progress'].includes(e.status)
        && (role !== rolling || e.commit?.id !== TARGET)), 'An unrelated deployment is in progress');
      assert(Array.isArray(instances) && instances.every(e => typeof e.id === 'string' && e.id && Number.isFinite(Date.parse(e.createdAt))));
      if (role !== rolling) assert.equal(instances.length, 2);
      else assert(instances.length >= 1 && instances.length <= 4, 'Invalid rolling replica count');
      assert.equal(new Set(instances.map(e => e.id)).size, instances.length);
      result[role] = { deployId: live.id, instances: instances.map(e => ({ id: e.id, createdAt: e.createdAt })).sort((a,b) => a.id.localeCompare(b.id)) };
    }
    return result;
  }
  async function checkpoint(taskId) {
    const result = await db.query('select *,clock_timestamp() as observed_at from public.ivx_autonomous_tasks where task_id=$1', [taskId]);
    assert.equal(result.rows.length, 1); return result.rows[0];
  }
  const archive = async taskId => (await db.query('select evidence_id,worker_instance_id,evidence,measurement,recorded_at from public.ivx_work_evidence_archive where task_id=$1 order by recorded_at,evidence_id limit 1000', [taskId])).rows;
  async function publicHealth() {
    const health = await app('/health'); assert.equal(health.commit, TARGET); assert(health.instanceId);
    return health.instanceId;
  }
  async function traffic() {
    const instanceId = await publicHealth();
    const read = await app(`/api/ivx/autonomous-task-engine/tasks/${fixture.taskId}`);
    assert.equal(read.task.taskId, fixture.taskId); assert.equal(read.task.idempotencyKey, fixture.key);
    requireDuplicate(await app('/api/ivx/autonomous-task-engine/tasks', fixture.input), fixture.taskId);
    return instanceId;
  }
  let stopTraffic, trafficFailure, trafficLoop;
  async function beginTraffic() {
    await traffic(); stopTraffic = false; trafficFailure = null;
    trafficLoop = (async () => {
      while (!stopTraffic) {
        try { await traffic(); } catch (error) { trafficFailure = error; break; }
        await sleep(1000);
      }
    })();
  }
  async function endTraffic() {
    stopTraffic = true; await trafficLoop;
    if (trafficFailure) throw trafficFailure;
  }
  async function restart(role) {
    await exactMain();
    const context = `qa/phase1-controlled-restart-${env.IVX_QA_PR}-${role}`;
    const statuses = await github(`commits/${TARGET}/statuses?per_page=100`);
    assert(!statuses.some(s => s.context === context), 'Restart already attempted; automatic replay is forbidden');
    await github(`statuses/${TARGET}`, { state: 'pending', context,
      description: 'One controlled restart reserved; replay prohibited',
      target_url: `https://github.com/${REPO}/actions/runs/${env.GITHUB_RUN_ID}` });
    // Reservation is durable before the request. A lost response never retries it.
    const record = { role, serviceId: SERVICES[role], at: new Date().toISOString(), accepted: false, context };
    receipt.actions.push(record); await save();
    const response = await app('/api/ivx/developer-deploy/action', { action: 'render_restart_service',
      input: { serviceId: SERVICES[role] }, confirm: true, confirmText: 'CONFIRM_IVX_RENDER_SERVICE_UPDATE',
      reason: `Owner-authorized Phase 1 ${role === 'api' ? '2.2' : '2.3'} controlled restart acceptance; preserve existing tasks and checkpoints.` }, 60000);
    assert.equal(response.result?.restartAccepted ?? response.restartAccepted, true, 'Restart not accepted');
    record.accepted = true; await save(); return record;
  }
  try {
    validateScope(env); await save();
    const pr = await github(`pulls/${env.IVX_QA_PR}`);
    assert.equal(pr.state, 'open'); assert.equal(pr.head.sha, env.IVX_QA_SOURCE_SHA);
    assert.equal(pr.head.repo.full_name, REPO); assert.equal(pr.head.ref, BRANCH);
    assert.equal(pr.base.ref, 'main'); assert.equal(pr.base.sha, TARGET);
    const changed = await github(`pulls/${env.IVX_QA_PR}/files?per_page=100`);
    assert(changed.length === FILES.length && changed.every(f => FILES.includes(f.filename)), 'Unexpected production code in acceptance PR');
    execFileSync('git', ['diff', '--exit-code', TARGET, '--', 'backend', 'scripts', 'supabase', 'expo'], { stdio: 'ignore' });
    for (let i = 0; ; i++) {
      await exactMain();
      const checks = await github(`commits/${env.IVX_QA_SOURCE_SHA}/check-runs?per_page=100`);
      assert(checks.total_count <= 100, 'Check list must not be truncated');
      if (reviewChecks(checks.check_runs)) { receipt.preRestartChecks = checks.check_runs.map(c => ({ id: c.id, name: c.name, status: c.status, conclusion: c.conclusion })); break; }
      assert(i < 90, 'Repository checks did not finish'); await sleep(5000);
    }
    const [{ default: pg }, { emergencyStopPostgresConfig }, identities] = await Promise.all([
      import('pg'), import('../backend/services/ivx-emergency-stop-postgres.ts'), import('../scripts/ivx-fleet-ha-identities.ts')]);
    const matches = identities.processIdentityMatchesObservedInstance;
    db = new pg.Client({ ...emergencyStopPostgresConfig(), connectionTimeoutMillis: 8000,
      query_timeout: 5000, statement_timeout: 4000, application_name: 'phase1-controlled-recovery-observer',
      options: '-c default_transaction_read_only=on' });
    db.on('error', () => {}); await db.connect();
    const control = (await db.query("select active from public.ivx_agent_controls where control_name='emergency_stop' limit 2")).rows;
    assert.equal(control.length, 1); assert.equal(control[0].active, false);
    const before = await topology(); receipt.before = before;
    const key = `phase1-api-restart:${env.IVX_QA_PR}:${env.GITHUB_RUN_ID}`;
    const input = { title: 'Temporary Phase 1 API restart idempotency acceptance', description: key,
      taskType: 'qa', idempotencyKey: key, priority: 'low', assignedAgentNumber: 112, maxRetries: 1 };
    fixture = { taskId: null, key, input }; receipt.fixture = { key, creationAttempted: true };
    const created = await app('/api/ivx/autonomous-task-engine/tasks', input);
    assert(created.task?.taskId && created.duplicate === false, 'Fixture creation was not unique');
    fixture.taskId = created.task.taskId; receipt.fixture.taskId = fixture.taskId;
    await app(`/api/ivx/autonomous-task-engine/tasks/${fixture.taskId}/evidence`, { evidenceType: 'test_result',
      source: 'phase1-controlled-api-restart', contentHash: digest(key), summary: 'Checkpoint written through the real owner API before restart.', commitSha: TARGET });
    const fixtureBefore = taskSummary(await checkpoint(fixture.taskId)); receipt.fixture.before = fixtureBefore;
    for (let i = 0; i < 3; i++) { await traffic(); await sleep(2000); }
    await beginTraffic();
    const apiAction = await restart('api'); log('api-restart-accepted');
    let apiAfter, stable = 0;
    for (let i = 0; i < 72; i++) {
      if (trafficFailure) throw trafficFailure;
      const current = await topology('api');
      const replaced = current.api.instances.length === 2 && current.api.instances.every(e => !before.api.instances.some(old => old.id === e.id));
      assert.deepEqual(current.worker.instances, before.worker.instances, 'Worker changed during the API-only experiment');
      stable = replaced ? stable + 1 : 0;
      receipt.apiProgress = { probe: i, replaced, stable }; await save();
      if (stable >= 3) { apiAfter = current; break; } await sleep(3000);
    }
    assert(apiAfter, 'API replicas did not recover');
    await endTraffic();
    assert(matches(await publicHealth(), new Set(apiAfter.api.instances.map(e => e.id))), 'Health did not reach a replacement API');
    const fixtureAfter = taskSummary(await checkpoint(fixture.taskId));
    requireCheckpoint(fixtureBefore, fixtureAfter, await archive(fixture.taskId));
    const duplicateRows = await db.query('select task_id from public.ivx_autonomous_tasks where idempotency_key=$1', [key]);
    assert.deepEqual(duplicateRows.rows.map(r => r.task_id), [fixture.taskId]);
    receipt.items['2.2'] = { result: 'PASS', before, after: apiAfter, checkpoint: fixtureAfter, duplicateTasks: 0 };
    await github(`statuses/${TARGET}`, { state: 'success', context: apiAction.context, description: 'API replacement, continuous task traffic and idempotency passed' });
    apiAction.passed = true;
    await save(); log('item-2.2-passed');

    // Observe native production work only. Never seed, lease, release or rewrite
    // worker tasks to manufacture process ownership or a recovery checkpoint.
    const candidates = (await db.query("select *,clock_timestamp() as observed_at from public.ivx_autonomous_tasks where state='RUNNING' and worker_instance_id is not null and idempotency_key like $1 and coalesce((payload->>'recordsChanged')::int,0)>0 and lease_expires_at>clock_timestamp() order by updated_at desc limit 112", [`landing-p0-patrol:${TARGET}:%`])).rows;
    const chosen = apiAfter.worker.instances.map(instance => candidates.find(row => matches(row.worker_instance_id, new Set([instance.id]))));
    assert(chosen.every(Boolean), 'Need committed native work on both worker replicas before restarting');
    const checkpoints = chosen.map(taskSummary); receipt.workerCheckpoints = checkpoints;
    for (const sample of checkpoints) requireCheckpoint(sample, sample, await archive(sample.taskId));
    for (let i = 0; i < 3; i++) { await traffic(); await sleep(2000); }
    await beginTraffic();
    const workerAction = await restart('worker'); log('worker-restart-accepted', { tasks: checkpoints.map(c => c.taskId) });
    let workerAfter; const recovered = new Map();
    for (let i = 0; i < 90; i++) {
      if (trafficFailure) throw trafficFailure;
      const current = await topology('worker');
      assert.deepEqual(current.api.instances, apiAfter.api.instances, 'API changed during the worker-only experiment');
      const ids = new Set(current.worker.instances.map(e => e.id));
      const replaced = ids.size === 2 && [...ids].every(id => !apiAfter.worker.instances.some(old => old.id === id));
      if (replaced) {
        for (const previous of checkpoints) {
          const after = taskSummary(await checkpoint(previous.taskId)), saved = await archive(previous.taskId);
          requireCheckpoint(previous, after, saved);
          if (after.observations > previous.observations && saved.some(e => Date.parse(e.recorded_at) > Date.parse(workerAction.at) && matches(e.worker_instance_id, ids))) {
            const results = requireRecovery(previous, after, saved, worker => matches(worker, ids), workerAction.at);
            recovered.set(previous.taskId, { before: previous, after, results });
          }
        }
      }
      receipt.workerProgress = { probe: i, replaced, recovered: [...recovered.values()] }; await save();
      if (replaced && recovered.size === checkpoints.length) { workerAfter = current; break; } await sleep(5000);
    }
    assert(workerAfter, 'Native checkpoints did not resume on replacement workers');
    await endTraffic();
    for (let i = 0; i < 3; i++) { await traffic(); await sleep(2000); }
    await exactMain();
    receipt.items['2.3'] = { result: 'PASS', after: workerAfter, recovered: [...recovered.values()],
      scope: 'Native patrol tasks: saved observation cursor, evidence and inspected commit; no coding commit publication is claimed.' };
    await github(`statuses/${TARGET}`, { state: 'success', context: workerAction.context, description: 'Native task checkpoints resumed with unique durable evidence' });
    workerAction.passed = true;
    log('item-2.3-passed');
  } catch (error) {
    receipt.errors.push({ name: error.name, message: error.message }); log('acceptance-failed', { error: error.message });
  } finally {
    stopTraffic = true; await trafficLoop;
    if (fixture) {
      try {
        if (!fixture.taskId) {
          const rows = (await db.query('select task_id from public.ivx_autonomous_tasks where idempotency_key=$1', [fixture.key])).rows;
          assert(rows.length <= 1, 'Unexpected duplicate fixture');
          fixture.taskId = rows[0]?.task_id ?? null;
        }
        if (!fixture.taskId) receipt.cleanup = { confirmed: true, fixtureCreated: false };
        else {
        const row = await checkpoint(fixture.taskId); assert.equal(row.idempotency_key, fixture.key);
        const cancelled = await app(`/api/ivx/autonomous-task-engine/tasks/${fixture.taskId}/transition`, { toState: 'CANCELLED' });
        assert.equal(cancelled.ok, true);
        const final = await checkpoint(fixture.taskId); assert.equal(final.state, 'CANCELLED');
        receipt.cleanup = { confirmed: true, taskId: fixture.taskId, state: final.state,
          auditRetained: true, activeQaTasks: 0 };
        }
      } catch (error) { receipt.cleanup = { confirmed: false, error: error.message }; receipt.errors.push({ phase: 'cleanup', message: error.message }); }
    } else receipt.cleanup = { confirmed: true, fixtureCreated: false };
    for (const action of receipt.actions.filter(a => !a.passed)) {
      await github(`statuses/${TARGET}`, { state: 'failure', context: action.context,
        description: 'Controlled restart attempted; acceptance failed; automatic replay prohibited' }).catch(() => {});
    }
    await db?.end().catch(() => {});
    receipt.result = receipt.errors.length === 0 && receipt.items['2.2']?.result === 'PASS' && receipt.items['2.3']?.result === 'PASS' && receipt.cleanup.confirmed ? 'PASS' : 'FAIL';
    receipt.finishedAt = new Date().toISOString(); await save();
    log('receipt', { result: receipt.result, items: receipt.items, cleanup: receipt.cleanup, errors: receipt.errors });
  }
  if (receipt.result !== 'PASS') process.exitCode = 1;
  return receipt;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run();
