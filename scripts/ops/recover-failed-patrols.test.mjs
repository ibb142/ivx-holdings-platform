import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recoverFailedPatrols, recoveryBlocker, validateDatabaseBinding, PROJECT } from '../../backend/services/ivx-failed-patrol-recovery.mjs';
import { parseArguments } from './recover-failed-patrols.mjs';

const sha = 'a'.repeat(40);
const now = '2026-09-13T23:00:00.123Z';
function row(id = 'patrol-1') {
  return { task_id: id, idempotency_key: 'landing-p0-patrol:' + sha + ':ia-001', state: 'FAILED',
    version: '9007199254740993', assigned_agent_number: 1, lease_holder: null, worker_instance_id: null,
    lease_expires_at: null, last_heartbeat_at: null, observed_at: new Date(now),
    payload: { taskId: id, idempotencyKey: 'landing-p0-patrol:' + sha + ':ia-001', state: 'FAILED',
      assignedAgentNumber: 1, taskType: 'qa', leaseHolder: null, leaseExpiresAt: null, lastHeartbeatAt: null,
      retryCount: 1, maxRetries: 5, retryStartedAt: '2026-09-13T22:59:00Z', retryNotBefore: null,
      error: 'canceling statement due to statement timeout', blocker: null,
      evidence: [{ evidenceType: 'http_request', summary: 'prior failed probe' }],
      filesChanged: [], recordsChanged: 8, commitSha: null, deploymentId: null,
      startedAt: '2026-09-13T22:58:00Z', completedAt: now } };
}
function fixture(options = {}) {
  const state = { rows: options.rows ?? [row()], calls: [], audit: null, committed: false, writes: 0, before: null };
  const client = { async query(sql, values) {
    state.calls.push(sql);
    if (options.failRead && sql.includes('ANY($1')) throw new Error('unavailable');
    if (sql.includes('ANY($1')) return { rows: structuredClone(state.rows) };
    if (sql === 'BEGIN') { state.before = structuredClone(state.rows); return { rows: [] }; }
    if (sql.startsWith('SET LOCAL')) return { rows: [] };
    if (sql.includes('ivx_agent_controls')) return { rows: options.controlRows ?? [{ active: false }] };
    if (sql.includes('FOR UPDATE NOWAIT')) {
      const current = structuredClone(state.rows.find(r => r.task_id === values[0]));
      if (options.race) current.version = (BigInt(current.version) + 1n).toString();
      if (options.locked) throw Object.assign(new Error('locked'), { code: '55P03' });
      return { rows: current ? [current] : [] };
    }
    if (sql.includes('ivx_fleet_retry_payload')) {
      const p = JSON.parse(values[0]);
      return { rows: [{ payload: { ...p, state: options.policyRefused ? 'FAILED' : 'RETRYING',
        retryCount: p.retryCount + 1, retryNotBefore: '2026-09-13T23:00:01.123Z',
        leaseHolder: null, leaseExpiresAt: null, lastHeartbeatAt: null,
        completedAt: null, updatedAt: now, error: null, blocker: null } }] };
    }
    if (sql.includes('ivx_autonomous_task_compare_and_set')) {
      if (options.casRefused) return { rows: [{ result: { ok: false } }] };
      const p = JSON.parse(values[0]), current = state.rows.find(r => r.task_id === p.taskId);
      Object.assign(current, { state: p.state, payload: p, version: (BigInt(current.version) + 1n).toString(),
        lease_holder: null, worker_instance_id: null, lease_expires_at: null, last_heartbeat_at: null });
      state.writes++;
      return { rows: [{ result: { ok: true, task: p } }] };
    }
    if (sql.startsWith('INSERT INTO public.ivx_autonomous_task_events')) {
      if (options.auditFails) throw new Error('audit failed');
      state.audit = { task_id: values[0], ...JSON.parse(values[1]) };
      return { rows: [{ event_id: '9223372036854000000' }] };
    }
    if (sql === 'COMMIT') {
      if (options.commitFails) throw new Error('commit result lost');
      state.committed = true; return { rows: [] };
    }
    if (sql === 'ROLLBACK') {
      state.rows = state.before; state.audit = null; state.writes = 0; return { rows: [] };
    }
    if (sql.includes("event->>'operationId'")) {
      assert.equal(state.committed, true, 'proof read must follow an acknowledged commit');
      if (options.verifyFails) throw new Error('read unavailable');
      return { rows: [{ operation_id: state.audit.operationId, task_id: state.audit.task_id }] };
    }
    throw new Error('Unexpected fixture query');
  } };
  return { client, state };
}
const run = (f, extra = {}) => recoverFailedPatrols({ client: f.client, taskIds: f.state.rows.map(r => r.task_id),
  sourceSha: sha, apply: true, reason: 'Owner requested reviewed patrol recovery', ...extra });

test('CLI requires explicit scope and rejects ignored flags and duplicates', () => {
  const args = ['--source-sha=' + sha, '--task-ids=patrol-1'];
  assert.equal(parseArguments(args).apply, false);
  assert.throws(() => parseArguments([...args, '--apply']));
  assert.throws(() => parseArguments([...args, '--task-ids=patrol-2']));
  assert.throws(() => parseArguments([...args, '--force']));
  assert.throws(() => parseArguments(['--source-sha=' + sha, '--task-ids=a,a']));
  assert.throws(() => parseArguments(['--source-sha=' + sha, '--task-ids=' + Array.from({length:11}, (_,i) => 'p'+i)]));
});

test('production database binding is exact and URL TLS downgrades are removed', () => {
  const good = 'postgres://postgres:unused@db.' + PROJECT + '.supabase.co/postgres?sslmode=disable&ssl=false';
  const sanitized = new URL(validateDatabaseBinding(good));
  assert.equal(sanitized.searchParams.has('sslmode'), false);
  assert.equal(sanitized.searchParams.has('ssl'), false);
  assert.throws(() => validateDatabaseBinding('postgres://postgres:unused@localhost/postgres'));
  assert.throws(() => validateDatabaseBinding('postgres://postgres.other@aws.pooler.supabase.com/postgres'));
  assert.throws(() => validateDatabaseBinding(good.replace('/postgres?', '/other?')));
});

test('dry run observes selected IDs without mutation or a policy call', async () => {
  const f = fixture();
  const report = await run(f, { apply: false });
  assert.equal(report.outcome, 'DRY_RUN');
  assert.equal(report.results[0].result, 'ELIGIBLE_FOR_REVIEW');
  assert.equal(f.state.calls.length, 1);
  assert.equal(f.state.writes, 0);
});

test('read failure is not a zero-task or successful recovery', async () => {
  const f = fixture({ failRead: true });
  await assert.rejects(run(f), /unavailable/);
  assert.equal(f.state.writes, 0);
});

for (const state of ['RUNNING','LEASED','QUEUED','RETRYING','VERIFIED','CANCELLED','EXPIRED']) {
  test('does not reset state ' + state, async () => {
    const r = row(); r.state = r.payload.state = state;
    const f = fixture({ rows: [r] });
    const report = await run(f);
    assert.equal(report.results[0].blocker, 'STATE_' + state);
    assert.equal(f.state.writes, 0);
  });
}

const refused = [
  ['wrong SHA', r => { r.idempotency_key = r.payload.idempotencyKey = r.idempotency_key.replace(sha, 'b'.repeat(40)); }, 'NOT_A_SELECTED_SHA_QA_PATROL'],
  ['wrong agent', r => { r.payload.assignedAgentNumber = 2; }, 'CANONICAL_IDENTITY_REVIEW'],
  ['state mismatch', r => { r.payload.state = 'QUEUED'; }, 'CANONICAL_IDENTITY_REVIEW'],
  ['development task', r => { r.payload.taskType = 'development'; }, 'NOT_A_SELECTED_SHA_QA_PATROL'],
  ['active lease', r => { r.lease_expires_at = new Date('2026-09-13T23:01:00.123Z'); r.payload.leaseExpiresAt = r.lease_expires_at.toISOString(); }, 'LEASE_AUTHORITY_REVIEW'],
  ['unbounded owner', r => { r.lease_holder = r.payload.leaseHolder = 'worker'; }, 'LEASE_AUTHORITY_REVIEW'],
  ['attempt budget', r => { r.payload.retryCount = 5; }, 'RETRY_ATTEMPTS_EXHAUSTED'],
  ['elapsed budget', r => { r.payload.retryStartedAt = '2026-09-13T22:44:00Z'; }, 'RETRY_TIME_BUDGET_EXHAUSTED'],
  ['invalid retry counter', r => { r.payload.retryCount = '1'; }, 'RETRY_ATTEMPTS_EXHAUSTED'],
  ['permission error', r => { r.payload.error = 'permission denied timeout'; }, 'NON_TRANSIENT_FAILURE_REVIEW'],
  ['missing column', r => { r.payload.error = '42703 undefined column timeout'; }, 'NON_TRANSIENT_FAILURE_REVIEW'],
  ['prior commit', r => { r.payload.commitSha = sha; }, 'RECONCILE_EXISTING_SIDE_EFFECTS'],
  ['prior database mutation', r => { r.payload.evidence.push({evidenceType:'database_mutation'}); }, 'RECONCILE_EXISTING_SIDE_EFFECTS'],
];
for (const [name, change, expected] of refused) {
  test('refuses ' + name, async () => {
    const r = row(); change(r);
    const f = fixture({ rows: [r] });
    assert.equal((await run(f)).results[0].blocker, expected);
    assert.equal(f.state.writes, 0);
  });
}

test('Date objects retain subsecond precision when matching an expired lease', () => {
  const r = row();
  r.lease_expires_at = new Date('2026-09-13T22:59:59.789Z');
  r.payload.leaseExpiresAt = r.lease_expires_at.toISOString();
  assert.equal(recoveryBlocker(r, sha), null);
});

test('successful retry preserves evidence, respects configured maxRetries and uses bigint versions', async () => {
  const r = row(); r.payload.retryCount = 3;
  const evidence = structuredClone(r.payload.evidence);
  const f = fixture({ rows: [r] });
  const report = await run(f);
  assert.equal(report.results[0].result, 'RETRY_SCHEDULE_COMMITTED');
  assert.equal(report.results[0].version, '9007199254740994');
  assert.equal(f.state.rows[0].state, 'RETRYING');
  assert.equal(f.state.rows[0].payload.retryCount, 4);
  assert.deepEqual(f.state.rows[0].payload.evidence, evidence);
  assert.equal(f.state.rows[0].payload.recordsChanged, 8);
  assert.equal(f.state.rows[0].payload.completedAt, null);
  assert.equal(f.state.audit.previousCompletedAt, now);
  assert.equal(f.state.audit.previousError, 'canceling statement due to statement timeout');
  assert.equal(report.results[0].workCompleted, false);
});

for (const controlRows of [[], [{active:true}], [{active:null}], [{active:false},{active:false}]]) {
  test('unavailable or active emergency control refuses mutation ' + JSON.stringify(controlRows), async () => {
    const f = fixture({ controlRows });
    const report = await run(f);
    assert.equal(report.outcome, 'TRANSACTION_ABORTED');
    assert.equal(report.results[0].blocker, 'EMERGENCY_STOP_ACTIVE_OR_UNAVAILABLE');
    assert.equal(f.state.writes, 0);
  });
}
test('a version race does not reset a concurrent writer', async () => {
  const f = fixture({ race: true });
  assert.equal((await run(f)).results[0].blocker, 'VERSION_CHANGED');
  assert.equal(f.state.writes, 0);
});
test('locked task is not waited on or replayed', async () => {
  const f = fixture({ locked: true });
  const report = await run(f);
  assert.equal(report.results[0].errorCode, '55P03');
  assert.equal(f.state.writes, 0);
});
test('retry policy refusal at the elapsed-time boundary performs no mutation', async () => {
  const f = fixture({ policyRefused: true });
  assert.equal((await run(f)).results[0].blocker, 'RETRY_POLICY_REFUSED');
  assert.equal(f.state.writes, 0);
});
test('CAS refusal stops before audit or commit', async () => {
  const f = fixture({ casRefused: true });
  assert.equal((await run(f)).outcome, 'TRANSACTION_ABORTED');
  assert.equal(f.state.calls.includes('COMMIT'), false);
});
test('audit failure rolls the state change back before any success report', async () => {
  const f = fixture({ auditFails: true });
  const report = await run(f);
  assert.equal(report.outcome, 'TRANSACTION_ABORTED');
  assert.equal(f.state.rows[0].state, 'FAILED');
  assert.equal(f.state.writes, 0);
  assert.equal(f.state.calls.includes('COMMIT'), false);
});
test('lost commit acknowledgement stops the batch with an explicit uncertain result', async () => {
  const f = fixture({ commitFails: true, rows: [row('a'),row('b')] });
  const report = await run(f);
  assert.equal(report.outcome, 'WRITE_UNCONFIRMED');
  assert.equal(report.results.length, 1);
  assert.equal(f.state.rows[1].state, 'FAILED');
  assert.equal(f.state.calls.filter(q => q === 'COMMIT').length, 1);
});
test('readback failure does not erase an acknowledged commit or certify recovery', async () => {
  const f = fixture({ verifyFails: true });
  const report = await run(f);
  assert.equal(report.outcome, 'COMMITTED_VERIFICATION_UNAVAILABLE');
  assert.equal(f.state.committed, true);
  assert.equal(f.state.calls.includes('ROLLBACK'), false);
});

