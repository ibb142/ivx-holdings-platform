import assert from 'node:assert/strict';
import { test, before, after, describe } from 'node:test';
import { Pool } from 'pg';
import * as fw from '../backend/services/agents/multi-agent-framework.ts';

// Run after the existing fleet PostgreSQL proof. No production secrets required.
// node --import tsx --test scripts/ivx-fleet-framework.test.mjs

describe('lease ownership on the isolated PostgreSQL test database', () => {
  let pg, store, otherStore, admin, nativePool;
  let databaseCreated = false;
  let connected = 0;
  const config = {
    mode: 'simulation', repository: 'ibb142/ivx-holdings-platform', localConcurrency: 8,
    leaseMs: 90_000, heartbeatMs: 20_000, pollMs: 5000, taskTimeoutMs: 600_000, maxAttempts: 3,
  };
  before(async () => {
    const connectionString = process.env.IVX_HA_TEST_DATABASE_URL;
    const target = new URL(connectionString ?? 'postgres://invalid/');
    if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/ivx_ha_test') {
      throw Error('Explicit local ivx_ha_test PostgreSQL server required');
    }
    admin = new Pool({ connectionString, max: 1 });
    // Separate database; the existing fleet gate owns roles in this local cluster.
    await admin.query('CREATE DATABASE ivx_framework_test');
    databaseCreated = true;
    const databaseUrl = new URL(target); databaseUrl.pathname = '/ivx_framework_test';
    nativePool = new Pool({ connectionString: databaseUrl.href, max: 4 });
    pg = { query: (sql, values) => nativePool.query(sql, values), exec: sql => nativePool.query(sql) };
    await pg.exec(`
      CREATE TABLE public.ivx_autonomous_tasks (
        task_id text PRIMARY KEY, idempotency_key text UNIQUE, state text NOT NULL,
        priority text NOT NULL, assigned_agent_number integer, payload jsonb NOT NULL DEFAULT '{}',
        lease_holder text, worker_instance_id text, lease_expires_at timestamptz,
        last_heartbeat_at timestamptz, version integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );
      CREATE TABLE public.ivx_autonomous_task_events (
        event_type text, task_id text, worker_instance_id text, event jsonb
      );
    `);
    await pg.exec(fw.FLEET_INSTALL_SQL);
    const pool = { async connect() { connected++; return nativePool.connect(); } };
    const db = new fw.FleetDatabase(pool, () => {});
    store = new fw.FleetTaskStore(db, db, config, 'worker-A');
    otherStore = new fw.FleetTaskStore(db, db, config, 'worker-B');
  });
  after(async () => {
    await nativePool?.end();
    try { if (databaseCreated) await admin.query('DROP DATABASE ivx_framework_test'); }
    finally { await admin?.end(); }
  });
  let sequence = 0;
  async function resetRows() {
    await pg.exec(`TRUNCATE public.ivx_autonomous_tasks, public.ivx_autonomous_task_events;
      UPDATE ivx_fleet.resources SET token=NULL,task_id=NULL,expires_at='epoch';`);
  }
  async function seed() {
    await resetRows();
    const taskId = await store.enqueue({
      idempotencyKey: `test-${++sequence}`, baseCommit: 'a'.repeat(40), priority: 'high',
      files: [{ path: 'src/test.txt', beforeSha256: null, content: 'test' }],
    });
    const lease = await store.claim();
    assert.equal(lease.taskId, taskId);
    return lease;
  }
  async function taskRow(id) { return (await pg.query('SELECT * FROM public.ivx_autonomous_tasks WHERE task_id=$1', [id])).rows[0]; }
  test('two concurrent workers cannot claim the same queued task', async () => {
    await resetRows();
    const id = await store.enqueue({ idempotencyKey: `race-${++sequence}`, baseCommit: 'a'.repeat(40), priority: 'high',
      files: [{ path: 'src/race.txt', beforeSha256: null, content: 'race' }] });
    const claims = await Promise.all([store.claim(), otherStore.claim()]);
    const winners = claims.filter(Boolean);
    assert.equal(winners.length, 1);
    assert.equal(winners[0].taskId, id);
    const row = await taskRow(id);
    assert.equal(row.lease_holder, winners[0].token);
    assert.equal(row.worker_instance_id, claims[0] ? 'worker-A' : 'worker-B');
    assert.equal((await pg.query("SELECT count(*)::int AS n FROM public.ivx_autonomous_task_events WHERE task_id=$1 AND event_type='fleet_claimed'", [id])).rows[0].n, 1);
  });
  test('concurrent tasks cannot hold the same file resource', async () => {
    await resetRows();
    for (let n = 0; n < 2; n++) await store.enqueue({ idempotencyKey: `file-race-${++sequence}`, baseCommit: 'a'.repeat(40), priority: 'high',
      files: [{ path: 'src/shared.txt', beforeSha256: null, content: `change-${n}` }] });
    const claims = await Promise.all([store.claim(), otherStore.claim()]);
    assert.equal(claims.filter(Boolean).length, 1);
    const counts = await pg.query('SELECT state,count(*)::int AS n FROM public.ivx_autonomous_tasks GROUP BY state ORDER BY state');
    assert.deepEqual(counts.rows, [{ state: 'RECEIVED', n: 1 }, { state: 'RUNNING', n: 1 }]);
    assert.equal((await pg.query("SELECT count(*)::int AS n FROM ivx_fleet.resources WHERE kind='file' AND expires_at>clock_timestamp()")).rows[0].n, 1);
  });
  test('two workers share the global eight-lease admission ceiling', async () => {
    await resetRows();
    for (let n = 0; n < 12; n++) await store.enqueue({ idempotencyKey: `capacity-${++sequence}`, baseCommit: 'a'.repeat(40), priority: 'high',
      files: [{ path: `src/independent-${n}.txt`, beforeSha256: null, content: 'change' }] });
    const claims = (await Promise.all(Array.from({ length: 12 }, (_, n) => (n % 2 ? otherStore : store).claim()))).filter(Boolean);
    assert.equal(claims.length, 8);
    assert.equal(new Set(claims.map(lease => lease.taskId)).size, 8);
    assert.equal(new Set(claims.map(lease => lease.agentNumber)).size, 8);
    assert.equal((await pg.query("SELECT count(*)::int AS n FROM ivx_fleet.resources WHERE kind='capacity' AND expires_at>clock_timestamp()")).rows[0].n, 8);
  });
  test('renewal extends only owned live lease without changing its state or fencing counters', async () => {
    const lease = await seed();
    const otherId = await store.enqueue({ idempotencyKey: 'untouched-pending', baseCommit: 'a'.repeat(40), priority: 'low',
      files: [{ path: 'src/other.txt', beforeSha256: null, content: 'pending' }] });
    await pg.query("UPDATE public.ivx_autonomous_tasks SET lease_expires_at=clock_timestamp()+interval '10 seconds' WHERE task_id=$1", [lease.taskId]);
    const before = await taskRow(lease.taskId);
    await fw.clearReclamationTimeout(store, lease);
    const after = await taskRow(lease.taskId);
    assert.equal(after.state, 'RUNNING');
    assert.equal(after.lease_holder, lease.token);
    assert(after.lease_expires_at - before.lease_expires_at > 70_000);
    assert.equal((await taskRow(otherId)).state, 'RECEIVED');
    const resources = await pg.query('SELECT resource_key,fence::text FROM ivx_fleet.resources WHERE token=$1', [lease.token]);
    for (const row of resources.rows) assert.equal(row.fence, lease.fences[row.resource_key]);
  });
  test('wrong worker cannot extend an otherwise valid lease', async () => {
    const lease = await seed();
    const before = await taskRow(lease.taskId);
    await assert.rejects(fw.renewOwnedFleetLease(otherStore, lease), /FLEET_LEASE_LOST/);
    assert.deepEqual(await taskRow(lease.taskId), before);
  });
  test('stale or forged ownership token cannot renew', async () => {
    const lease = await seed();
    await assert.rejects(fw.renewOwnedFleetLease(store, { ...lease, token: '00000000-0000-4000-8000-000000000001' }), /FLEET_LEASE_LOST/);
  });
  test('expired task cannot be revived by renewal', async () => {
    const lease = await seed();
    await pg.query("UPDATE public.ivx_autonomous_tasks SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE task_id=$1", [lease.taskId]);
    const before = await taskRow(lease.taskId);
    await assert.rejects(fw.clearReclamationTimeout(store, lease), /FLEET_LEASE_LOST/);
    assert.deepEqual(await taskRow(lease.taskId), before);
  });
  for (const state of ['VERIFIED','FAILED','QA_FAILED','NO_ACTION_REQUIRED','CANCELLED','PAUSED','BLOCKED','WAITING_FOR_APPROVAL']) {
    test(`renewal preserves ${state}`, async () => {
      const lease = await seed();
      await pg.query('UPDATE public.ivx_autonomous_tasks SET state=$1 WHERE task_id=$2', [state, lease.taskId]);
      await assert.rejects(fw.clearReclamationTimeout(store, lease), /FLEET_LEASE_LOST/);
      assert.equal((await taskRow(lease.taskId)).state, state);
    });
  }
  test('expired file resource blocks renewal and leaves task expiry unchanged', async () => {
    const lease = await seed();
    const before = await taskRow(lease.taskId);
    await pg.query("UPDATE ivx_fleet.resources SET expires_at='epoch' WHERE kind='file' AND token=$1", [lease.token]);
    await assert.rejects(fw.renewOwnedFleetLease(store, lease), /FLEET_LEASE_LOST/);
    assert.deepEqual(await taskRow(lease.taskId), before);
  });
  test('fencing counter mismatch blocks stale worker', async () => {
    const lease = await seed();
    await pg.query("UPDATE ivx_fleet.resources SET fence=fence+1 WHERE kind='file' AND token=$1", [lease.token]);
    await assert.rejects(fw.renewOwnedFleetLease(store, lease), /FLEET_LEASE_LOST/);
  });
  test('claim reclaims expired RUNNING work with a new token and higher fences', async () => {
    const old = await seed();
    await pg.exec("UPDATE public.ivx_autonomous_tasks SET lease_expires_at='epoch'; UPDATE ivx_fleet.resources SET expires_at='epoch';");
    const current = await otherStore.claim();
    assert.equal(current.taskId, old.taskId);
    assert.notEqual(current.token, old.token);
    for (const key of old.resourceKeys.filter(k => k.startsWith('file/'))) assert(BigInt(current.fences[key]) > BigInt(old.fences[key]));
    await assert.rejects(fw.renewOwnedFleetLease(store, old), /FLEET_LEASE_LOST/);
    await fw.renewOwnedFleetLease(otherStore, current);
  });
  test('expired publication is blocked for reconciliation and preserves publication SHA', async () => {
    const lease = await seed();
    await store.beginPublication(lease, { commitSha: 'b'.repeat(40) });
    await pg.exec("UPDATE public.ivx_autonomous_tasks SET lease_expires_at='epoch'; UPDATE ivx_fleet.resources SET expires_at='epoch';");
    assert.equal(await otherStore.claim(), null);
    await assert.rejects(fw.clearReclamationTimeout(store, lease), /FLEET_LEASE_LOST/);
    assert.equal(await store.blockExpiredPublications(), 1);
    const row = await taskRow(lease.taskId);
    assert.equal(row.state, 'BLOCKED');
    assert.equal(row.payload.publicationCommitSha, 'b'.repeat(40));
  });
  test('aborted renewal does not access the database', async () => {
    const lease = await seed();
    const before = connected;
    await assert.rejects(fw.renewOwnedFleetLease(store, lease, AbortSignal.abort()));
    assert.equal(connected, before);
  });
  test('legacy zero-argument bulk call fails explicitly', async () => {
    await assert.rejects(fw.clearReclamationTimeout(), /OWNED_FLEET_LEASE_REQUIRED/);
  });
});

describe('GitHub CI evidence verification with deterministic HTTP fixtures', () => {
  const repository = 'ibb142/ivx-holdings-platform';
  const sha = 'a'.repeat(40);
  const base = 'b'.repeat(40);
  const goodCheck = { id: 100, name: 'unit', head_sha: sha, status: 'completed', conclusion: 'success', app: { id: 123 } };
  const goodStatus = { id: 200, context: 'external-ci', state: 'success', creator: { login: 'verified-publisher' } };
  function options(scenario = {}) {
    let prReads = 0;
    const calls = [];
    const request = async (url, init) => {
      calls.push(url);
      assert.equal(init.method, 'GET');
      assert.equal(init.redirect, 'error');
      assert.equal(init.cache, 'no-store');
      if (scenario.error) throw scenario.error;
      if (scenario.http) return new Response('{}', { status: scenario.http });
      const u = new URL(url);
      assert.equal(u.origin, 'https://api.github.com');
      if (u.pathname.endsWith('/pulls/12')) {
        prReads++;
        return Response.json({ number: 12, state: scenario.prState ?? 'open', merged: false,
          head: { sha: scenario.wrongHead || (prReads > 1 && scenario.changeHead) ? 'c'.repeat(40) : sha },
          base: { sha: prReads > 1 && scenario.changeBase ? 'd'.repeat(40) : base, repo: { full_name: repository } } });
      }
      if (u.pathname.endsWith('/check-runs')) {
        const all = scenario.checks ?? [goodCheck];
        const start = (Number(u.searchParams.get('page')) - 1) * 100;
        return Response.json({ total_count: scenario.total ?? all.length,
          check_runs: scenario.emptyPage ? [] : all.slice(start, start + 100) });
      }
      if (u.pathname.endsWith('/status')) {
        const all = scenario.statuses ?? [goodStatus];
        const start = (Number(u.searchParams.get('page')) - 1) * 100;
        return Response.json({ sha: scenario.wrongStatusSha ? 'c'.repeat(40) : sha, total_count: all.length, statuses: all.slice(start, start + 100) });
      }
      throw Error('UNEXPECTED_URL');
    };
    return { value: { repository, prNumber: 12, expectedHeadSha: sha, required: [
      { source: 'check_run', name: 'unit', appId: 123 },
      { source: 'commit_status', name: 'external-ci', creatorLogin: 'verified-publisher' },
    ], fetch: request }, calls };
  }
  test('passes only after successful checks/statuses and stable PR head/base', async () => {
    const { value, calls } = options();
    const report = await fw.verifyRequiredGitHubChecks(value);
    assert.equal(report.ok, true);
    assert.equal(report.checks.length, 2);
    assert(report.checks.every(c => c.evidence.length > 0));
    assert.equal(calls.filter(u => u.endsWith('/pulls/12')).length, 2);
    assert.equal(await fw.forceOmittedChecks(value), true);
  });
  test('eleven green runs cannot replace a missing required autonomy guard', async () => {
    const checks = Array.from({ length: 11 }, (_, i) => ({ ...goodCheck, id: 1000 + i, name: `unrelated-${i}` }));
    const { value } = options({ checks });
    value.required = [{ source: 'check_run', name: 'Senior Developer + 12 IA autonomy invariants', appId: 123 }];
    const report = await fw.verifyRequiredGitHubChecks(value);
    assert.equal(report.ok, false);
    assert.deepEqual(report.blockers, ['Senior Developer + 12 IA autonomy invariants:REQUIRED_CHECK_MISSING']);
  });
  test('the policy checks all named requirements even when exactly eleven runs exist', async () => {
    const checks = Array.from({ length: 11 }, (_, i) => ({ ...goodCheck, id: 1000 + i, name: `gate-${i}` }));
    const { value } = options({ checks });
    value.required = checks.map(check => ({ source: 'check_run', name: check.name, appId: 123 }));
    assert.equal((await fw.verifyRequiredGitHubChecks(value)).ok, true);
    checks[10] = { ...checks[10], conclusion: 'failure' };
    const failed = await fw.verifyRequiredGitHubChecks(value);
    assert.equal(failed.ok, false);
    assert.deepEqual(failed.blockers, ['gate-10:REQUIRED_CHECK_NOT_SUCCESSFUL']);
  });
  test('additional successful workflow jobs do not invalidate satisfied requirements', async () => {
    const checks = [goodCheck, ...Array.from({ length: 11 }, (_, i) => ({ ...goodCheck, id: 1000 + i, name: `additional-${i}` }))];
    assert.equal((await fw.verifyRequiredGitHubChecks(options({ checks }).value)).ok, true);
  });
  for (const conclusion of ['skipped','neutral','failure','cancelled','timed_out','action_required',null]) {
    test(`required ${conclusion} check blocks approval`, async () => {
      const { value } = options({ checks: [{ ...goodCheck, conclusion }] });
      assert.equal((await fw.verifyRequiredGitHubChecks(value)).ok, false);
      assert.equal(await fw.forceOmittedChecks(value), false);
    });
  }
  for (const status of ['queued','in_progress','pending']) {
    test(`unfinished ${status} check cannot use success conclusion`, async () => {
      const { value } = options({ checks: [{ ...goodCheck, status }] });
      assert.equal((await fw.verifyRequiredGitHubChecks(value)).ok, false);
    });
  }
  for (const state of ['pending','error','failure']) {
    test(`commit status ${state} blocks approval`, async () => {
      const { value } = options({ statuses: [{ ...goodStatus, state }] });
      assert.equal((await fw.verifyRequiredGitHubChecks(value)).ok, false);
    });
  }
  for (const scenario of [
    { checks: [] }, { statuses: [] }, { checks: [{ ...goodCheck, app: { id: 999 } }] },
    { statuses: [{ ...goodStatus, creator: { login: 'untrusted-publisher' } }] },
    { checks: [{ ...goodCheck, head_sha: 'c'.repeat(40) }] }, { wrongStatusSha: true },
    { wrongHead: true }, { changeHead: true }, { changeBase: true }, { prState: 'closed' },
  ]) {
    test(`blocks missing, stale or mismatched evidence ${JSON.stringify(scenario)}`, async () => {
      const { value } = options(scenario);
      assert.equal((await fw.verifyRequiredGitHubChecks(value)).ok, false);
    });
  }
  test('fetches second page when a required check is after the first hundred', async () => {
    const checks = Array.from({ length: 100 }, (_, i) => ({ ...goodCheck, id: i + 1000, name: `optional-${i}` }));
    checks.push(goodCheck);
    const { value, calls } = options({ checks });
    assert.equal((await fw.verifyRequiredGitHubChecks(value)).ok, true);
    assert(calls.some(u => u.includes('check-runs?') && u.endsWith('page=2')));
  });
  test('duplicate records or truncated pages cannot satisfy requirements', async () => {
    for (const scenario of [{ checks: [goodCheck, goodCheck] }, { total: 2, emptyPage: true }, { total: 1001 }]) {
      assert.equal((await fw.verifyRequiredGitHubChecks(options(scenario).value)).ok, false);
    }
  });
  test('conflicting same-name runs do not hide a failed result', async () => {
    const checks = [goodCheck, { ...goodCheck, id: 101, conclusion: 'failure' }];
    assert.equal((await fw.verifyRequiredGitHubChecks(options({ checks }).value)).ok, false);
  });
  for (const http of [401,403,404,429,503]) {
    test(`GitHub HTTP ${http} returns an explicit blocker`, async () => {
      const report = await fw.verifyRequiredGitHubChecks(options({ http }).value);
      assert.equal(report.ok, false);
      assert.deepEqual(report.blockers, [`GITHUB_HTTP_${http}`]);
    });
  }
  test('network failure does not expose token-bearing error text', async () => {
    const report = await fw.verifyRequiredGitHubChecks(options({ error: Error('secret-token-NEVER-LOG') }).value);
    assert.equal(report.ok, false);
    assert(!JSON.stringify(report).includes('secret-token'));
  });
  test('aborted verification reads no API and reports blocked', async () => {
    const { value, calls } = options();
    value.signal = AbortSignal.abort();
    const report = await fw.verifyRequiredGitHubChecks(value);
    assert.equal(report.ok, false);
    assert.equal(calls.length, 0);
  });
  test('empty policy, missing input or invalid producer never returns success', async () => {
    await assert.rejects(fw.forceOmittedChecks(), /VALID_PR_SHA_AND_NONEMPTY_CI_POLICY_REQUIRED/);
    await assert.rejects(fw.verifyRequiredGitHubChecks({ ...options().value, required: [] }), /VALID_PR_SHA/);
    await assert.rejects(fw.verifyRequiredGitHubChecks({ ...options().value,
      required: [{ source: 'check_run', name: 'unit', appId: 0 }] }), /INVALID_OR_DUPLICATE/);
  });
});
