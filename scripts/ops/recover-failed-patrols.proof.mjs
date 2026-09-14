import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { clientOptions, main, parseArgs, previewRecovery, recoverTask, runRecovery } from './recover-failed-patrols.mjs';

// The CLI accepts only a disposable local test database. CREATE without
// IF NOT EXISTS also prevents accidentally running fixtures over existing data.
export async function proveRecovery(client, peerClient = null) {
  const passed = [];
  const check = async (name, fn) => { await fn(); passed.push(name); };
  await client.query(`create table public.ivx_autonomous_tasks (
    task_id text primary key,idempotency_key text not null,state text not null,
    version bigint not null,lease_holder text,worker_instance_id text,
    lease_expires_at timestamptz,last_heartbeat_at timestamptz,
    updated_at timestamptz not null default now(),payload jsonb not null,
    check(jsonb_typeof(payload)='object' and payload->>'taskId'=task_id))`);
  await client.query(`create index recovery_fixture_state_updated
    on public.ivx_autonomous_tasks(state,updated_at desc)`);
  await client.query(`create table public.ivx_autonomous_task_events (
    event_id bigserial primary key,event_type text not null,task_id text,
    worker_instance_id text,event jsonb not null,created_at timestamptz not null default now())`);
  const evidence = [{ id: 'original-failed-proof', status: 'FAILED', output: 'retained' }];
  async function seed(id, payload = {}, columns = {}) {
    const base = { taskId: id, state: 'FAILED', retryCount: 0, maxRetries: 3,
      error: 'transient failure', completedAt: '2026-01-01T00:00:00Z',
      startedAt: '2026-01-01T00:00:00Z', attemptStartedAt: '2026-01-01T00:00:01Z',
      evidence, budgetReserved: true, budgetReservationId: 'existing-reservation',
      customMetadata: { preserve: true }, ...payload };
    await client.query(`insert into public.ivx_autonomous_tasks (
      task_id,idempotency_key,state,version,lease_holder,worker_instance_id,
      lease_expires_at,last_heartbeat_at,payload
    ) values ($1,$1,'FAILED',$2,$3,$4,$5,$6,$7::jsonb)`, [id, columns.version ?? '12',
      columns.holder ?? null, columns.worker ?? null, columns.expiry ?? null,
      columns.heartbeat ?? null, JSON.stringify(base)]);
  }
  const future = new Date(Date.now() + 3600000).toISOString();
  const old = new Date(Date.now() - 3600000).toISOString();
  const recent = new Date().toISOString();
  const byId = async id => (await client.query('select *,version::text as exact_version from public.ivx_autonomous_tasks where task_id=$1', [id])).rows[0];
  const eventCount = async () => Number((await client.query('select count(*) as n from public.ivx_autonomous_task_events')).rows[0].n);

  await check('CLI defaults, bounded explicit apply and project binding', async () => {
    assert.equal(parseArgs([]).apply, false);
    assert.throws(() => parseArgs(['--apply']), /APPLY_REQUIRES/);
    assert.throws(() => parseArgs(['--limit=11']), /INVALID_LIMIT/);
    assert.throws(() => parseArgs(['--task-ids=a,a']), /INVALID_TASK_IDS/);
    assert.throws(() => parseArgs(['--aply']), /UNKNOWN_ARGUMENT/);
    assert.throws(() => clientOptions({}), /DATABASE_URL_REQUIRED/);
    assert.throws(() => clientOptions({ DATABASE_URL: 'postgres://postgres@unrelated.example/db' }), /PROJECT_BINDING/);
    const options = clientOptions({ DATABASE_URL: 'postgres://postgres@db.kvclcdjmjghndxsngfzb.supabase.co/postgres?sslmode=require' });
    assert.equal(options.ssl.rejectUnauthorized, true);
    assert.equal(new URL(options.connectionString).searchParams.has('sslmode'), false);
  });

  await seed('plain');
  await seed('expired', { leaseHolder: 'old-owner', workerInstanceId: 'old-worker',
    leaseExpiresAt: old, lastHeartbeatAt: old }, { version: '9007199254740993', holder: 'old-owner', worker: 'old-worker', expiry: old, heartbeat: old });
  await seed('live', {}, { holder: 'owner', expiry: future });
  await seed('unknown-expiry', {}, { worker: 'unverified-worker' });
  await seed('fresh-heartbeat', {}, { expiry: old, heartbeat: recent });
  await seed('payload-mismatch', { state: 'QUEUED' });
  await seed('attempt-budget', { retryCount: 3 });
  await seed('time-budget', { retryStartedAt: old });
  await seed('future-retry', { retryNotBefore: future });
  await seed('bad-timestamp', { retryStartedAt: 'invalid-timestamp' });
  const ids = ['plain','expired','live','unknown-expiry','fresh-heartbeat','payload-mismatch','attempt-budget','time-budget','future-retry','bad-timestamp'];

  await check('dry run is read-only and excludes unsafe leases and exhausted retries', async () => {
    const before = await client.query('select task_id,version::text,payload from public.ivx_autonomous_tasks order by task_id');
    const report = await runRecovery(client, { taskIds: ids });
    assert.equal(report.applied.length, 0);
    const decisions = Object.fromEntries(report.candidates.map(row => [row.task_id, row.eligibility]));
    assert.deepEqual(decisions, { plain: 'ELIGIBLE', expired: 'ELIGIBLE', live: 'LIVE_LEASE',
      'unknown-expiry': 'UNKNOWN_LEASE_EXPIRY', 'fresh-heartbeat': 'RECENT_HEARTBEAT',
      'payload-mismatch': 'PAYLOAD_STATE_MISMATCH', 'attempt-budget': 'RETRY_ATTEMPTS_EXHAUSTED',
      'time-budget': 'RETRY_TIME_BUDGET_EXHAUSTED', 'future-retry': 'RETRY_NOT_DUE', 'bad-timestamp': 'INVALID_RETRY_TIMESTAMP' });
    assert.deepEqual((await client.query('select task_id,version::text,payload from public.ivx_autonomous_tasks order by task_id')).rows, before.rows);
    assert.equal(await eventCount(), 0);
  });

  await check('recovery preserves bigint versions, evidence and budget; clears both lease representations', async () => {
    const report = await runRecovery(client, { apply: true, taskIds: ['plain','expired'], reason: 'verified fixture recovery' });
    assert.equal(report.applied.length, 2);
    assert.equal(report.errors.length, 0);
    assert.equal((await byId('plain')).exact_version, '13');
    const row = await byId('expired');
    assert.equal(row.exact_version, '9007199254740994');
    assert.equal(row.state, 'QUEUED');
    for (const key of ['lease_holder','worker_instance_id','lease_expires_at','last_heartbeat_at']) assert.equal(row[key], null);
    for (const key of ['leaseHolder','workerInstanceId','leaseExpiresAt','lastHeartbeatAt','completedAt','attemptStartedAt','error']) assert.equal(row.payload[key], null);
    assert.equal(row.payload.retryCount, 1);
    assert.equal(row.payload.startedAt, '2026-01-01T00:00:00Z');
    assert.deepEqual(row.payload.evidence, evidence);
    assert.deepEqual(row.payload.customMetadata, { preserve: true });
    assert.equal(row.payload.budgetReservationId, 'existing-reservation');
    assert.equal(row.payload.budgetReserved, true);
    const audit = (await client.query("select event from public.ivx_autonomous_task_events where task_id='expired'")).rows[0].event;
    assert.equal(audit.previousVersion, '9007199254740993');
    assert.equal(audit.previousError, 'transient failure');
    assert.equal(audit.previousCompletedAt, '2026-01-01T00:00:00Z');
    assert.equal(audit.recoveryRunId, report.runId);
  });

  await check('repeated apply does not requeue or increment twice', async () => {
    const count = await eventCount();
    const report = await runRecovery(client, { apply: true, taskIds: ['plain','expired'], reason: 'repeat' });
    assert.equal(report.applied.length, 0);
    assert.equal(await eventCount(), count);
    assert.equal((await byId('plain')).exact_version, '13');
  });

  await check('a concurrent version change is rejected', async () => {
    await seed('version-race');
    const [row] = await previewRecovery(client, { taskIds: ['version-race'] });
    await client.query("update public.ivx_autonomous_tasks set version=version+1 where task_id='version-race'");
    assert.equal(await recoverTask(client, row, { runId: 'version-race', reason: 'fixture' }), null);
    assert.equal((await byId('version-race')).state, 'FAILED');
  });

  await check('lease eligibility is rechecked even if another writer forgot to increment version', async () => {
    await seed('lease-race');
    const [row] = await previewRecovery(client, { taskIds: ['lease-race'] });
    await client.query("update public.ivx_autonomous_tasks set lease_holder='new-owner',lease_expires_at=$1 where task_id='lease-race'", [future]);
    assert.equal(await recoverTask(client, row, { runId: 'lease-race', reason: 'fixture' }), null);
    assert.equal((await byId('lease-race')).lease_holder, 'new-owner');
  });

  if (peerClient) await check('a row locked by another connection is skipped without stealing its lease', async () => {
    await seed('locked-row');
    const [row] = await previewRecovery(client, { taskIds: ['locked-row'] });
    await peerClient.query('BEGIN');
    try {
      await peerClient.query("select task_id from public.ivx_autonomous_tasks where task_id='locked-row' for update");
      assert.equal(await recoverTask(client, row, { runId: 'locked-row', reason: 'fixture' }), null);
    } finally { await peerClient.query('ROLLBACK'); }
    assert.equal((await byId('locked-row')).state, 'FAILED');
  });

  await check('audit insertion failure rolls back the state transition', async () => {
    await seed('audit-failure');
    await client.query(`create function public.reject_fixture_audit() returns trigger language plpgsql as $$
      begin if new.task_id='audit-failure' then raise exception 'fixture audit failure'; end if; return new; end $$`);
    await client.query('create trigger reject_fixture_audit before insert on public.ivx_autonomous_task_events for each row execute function public.reject_fixture_audit()');
    const [row] = await previewRecovery(client, { taskIds: ['audit-failure'] });
    await assert.rejects(recoverTask(client, row, { runId: 'audit-failure', reason: 'fixture' }));
    assert.equal((await byId('audit-failure')).state, 'FAILED');
    assert.equal((await byId('audit-failure')).exact_version, '12');
  });

  await check('lost COMMIT acknowledgement is uncertain, never success or an automatic retry', async () => {
    await seed('lost-ack');
    const [row] = await previewRecovery(client, { taskIds: ['lost-ack'] });
    let commits = 0;
    const ambiguousClient = { async query(sql, values) {
      const result = await client.query(sql, values);
      if (sql === 'COMMIT') { commits += 1; throw Object.assign(Error('connection lost'), { code: 'ECONNRESET' }); }
      return result;
    } };
    await assert.rejects(recoverTask(ambiguousClient, row, { runId: 'lost-ack', reason: 'fixture' }), { code: 'COMMIT_OUTCOME_UNKNOWN' });
    assert.equal(commits, 1);
    assert.equal((await byId('lost-ack')).exact_version, '13');
    assert.equal(Number((await client.query("select count(*) as n from public.ivx_autonomous_task_events where event->>'recoveryRunId'='lost-ack'")).rows[0].n), 1);
  });

  await check('empty preview and failed connect close their client exactly once', async () => {
    const env = { DATABASE_URL: 'postgres://postgres@db.kvclcdjmjghndxsngfzb.supabase.co/postgres' };
    let ends = 0;
    class EmptyClient { async connect() {} async query() { return { rows: [] }; } async end() { ends += 1; } }
    assert.equal(await main([], env, EmptyClient, () => {}), 0);
    assert.equal(ends, 1);
    class FailedClient extends EmptyClient { async connect() { throw Error('fixture connect failure'); } }
    await assert.rejects(main([], env, FailedClient, () => {}));
    assert.equal(ends, 2);
  });
  return { passed: passed.length, cases: passed,
    skipped: peerClient ? [] : ['Concurrent held-row lock requires a second PostgreSQL connection'] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = new URL(process.env.IVX_PATROL_RECOVERY_TEST_DATABASE_URL ?? 'postgres://unavailable');
  if (!['127.0.0.1','localhost'].includes(url.hostname) || url.pathname !== '/ivx_patrol_recovery_test') {
    throw Error('A disposable local ivx_patrol_recovery_test database is required');
  }
  const client = new pg.Client({ connectionString: url.href });
  const peer = new pg.Client({ connectionString: url.href });
  try {
    await client.connect(); await peer.connect();
    console.log(JSON.stringify(await proveRecovery(client, peer), null, 2));
  } finally { await client.end(); await peer.end(); }
}
