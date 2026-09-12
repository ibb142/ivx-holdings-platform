import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { SENIOR_QUEUE_JOB_SQL } from '../backend/services/ivx-senior-work-queue';

type Database = { query(sql: string, values?: any[]): Promise<{ rows: any[] }>; exec?: (sql: string) => Promise<unknown> };
const key = 'senior-developer-worker/queue.json';
const migration = (name: string) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const patched = '20260912134500_senior_claim_payload_spill.sql';
const claimSql = 'select public.ivx_senior_queue_claim($1::text,$2::text,$3::boolean) as value';
const oldRead = `select job from public.ivx_durable_documents d
  cross join lateral jsonb_array_elements(d.value->'jobs') as job
  where d.doc_key = $1 and job->>'jobId' = $2 limit 2`;
const put = (db: Database, value: unknown) => db.query(
  'insert into public.ivx_durable_documents(doc_key,value) values($1,$2::jsonb) on conflict(doc_key) do update set value=excluded.value',
  [key, JSON.stringify(value)]);
const claim = async (db: Database, jobId: string, worker: string, resume = false) =>
  (await db.query(claimSql, [jobId, worker, resume])).rows[0].value;

export async function proveSeniorClaimSpill(db: Database) {
  const exec = (sql: string) => db.exec ? db.exec(sql) : db.query(sql);
  await db.query('begin');
  try {
    await db.query("set local work_mem='64kB'");
    const predecessor = await migration('20260910193000_ivx_senior_committed_phase_recovery.sql');
    const originalFunction = predecessor.slice(predecessor.indexOf('create or replace function'), predecessor.lastIndexOf('commit;'));
    const access = async () => (await db.query("select prosecdef,proconfig,proacl::text from pg_proc where oid='public.ivx_senior_queue_claim(text,text,boolean)'::regprocedure")).rows[0];
    const privileges = await access();
    const target = { jobId: 'claim-spill-target', ownerId: 'claim-owner', status: 'queued', attempts: 2,
      input: { taskId: 'original-priority-repair', priority: 'P0' }, checkpoint: 'original-checkpoint' };
    const live = { jobId: 'claim-spill-live', ownerId: 'another-owner', status: 'running',
      leaseWorkerInstanceId: 'existing-worker', leaseExpiresAt: '2099-01-01T00:00:00Z' };
    const history = Array.from({ length: 200 }, (_, i) => ({ jobId: `claim-history-${i}`, ownerId: `history-${i}`,
      status: 'failed', finishedAt: '2026-01-01T00:00:00Z', result: { checkpoint: 'retained-work-evidence-'.repeat(1500) } }));
    const original = { marker: 'preserved', jobs: [...history, live, target] };
    const explain = async (sql: string, args: any[]) => {
      const plan = (await db.query(`explain (analyze,buffers,format json) ${sql}`, args)).rows[0]['QUERY PLAN'][0];
      return { tempBlocksWritten: plan.Plan['Temp Written Blocks'] ?? 0, executionMs: plan['Execution Time'] };
    };
    const read = async (sql: string, jobId: string) => (await db.query(sql, [key, jobId])).rows;
    const measure = async (patchedVersion: boolean) => {
      await exec(originalFunction);
      if (patchedVersion) await exec(await migration(patched));
      await put(db, original);
      const poll = await explain(patchedVersion ? SENIOR_QUEUE_JOB_SQL : oldRead, [key, target.jobId]);
      assert.deepEqual(await read(patchedVersion ? SENIOR_QUEUE_JOB_SQL : oldRead, target.jobId), [{ job: target }]);
      const take = await explain(claimSql, [target.jobId, 'proof-worker', false]);
      const stored = (await db.query('select value from public.ivx_durable_documents where doc_key=$1', [key])).rows[0].value;
      assert.equal(stored.marker, original.marker);
      assert.deepEqual(stored.jobs.slice(0, -1), [...history, live], 'Every omitted payload and the live holder survive the claim');
      const winner = stored.jobs.at(-1);
      assert.equal(winner.status, 'running');
      assert.equal(winner.attempts, 3);
      assert.equal(winner.checkpoint, target.checkpoint);
      assert.deepEqual(winner.input, target.input);
      assert.equal(winner.leaseWorkerInstanceId, 'proof-worker');
      assert.equal(Date.parse(winner.leaseExpiresAt) - Date.parse(winner.startedAt), 120_000);
      return { poll, claim: take };
    };
    const before = await measure(false), after = await measure(true);
    for (const operation of ['poll', 'claim'] as const) {
      assert(before[operation].tempBlocksWritten > 100, `${operation}: reproduce the original spill`);
      assert(after[operation].tempBlocksWritten < before[operation].tempBlocksWritten / 10, `${operation}: eliminate at least 90% of temporary writes`);
    }
    await exec(await migration(patched));
    assert.deepEqual(await access(), privileges, 'Security and caller privileges are unchanged');

    // Compare the application query with the old SQL, including malformed IDs,
    // duplicates and strings that must never be interpreted as SQL or JSONPath.
    const ids = ['literal" $id \\ (true) --', '123', 'true', '["x"]', '{"a": 1}', 'missing', 'dup'];
    const jobs = [{ jobId: ids[0] }, { jobId: 123 }, { jobId: '123' }, { jobId: true },
      { jobId: ['x'] }, { jobId: { a: 1 } }, { jobId: null }, {}, null, 'scalar',
      { jobId: 'dup', checkpoint: 1 }, { jobId: 'dup', checkpoint: 2 }, { jobId: 'dup', checkpoint: 3 }];
    await put(db, { jobs });
    for (const id of ids) assert.deepEqual(await read(SENIOR_QUEUE_JOB_SQL, id), await read(oldRead, id), `Identical polling semantics for ${id}`);
    for (const doc of [{ jobs: [] }, {}]) {
      await put(db, doc);
      assert.deepEqual(await read(SENIOR_QUEUE_JOB_SQL, 'missing'), []);
      assert.equal(await claim(db, 'missing', 'proof-worker'), null);
    }
    const recovery = { ...target, status: 'committing', attempts: 3, leaseExpiresAt: '2020-01-01T00:00:00Z',
      result: { commitSha: 'a'.repeat(40), branch: 'original-branch', prNumber: null } };
    for (const status of ['queued', 'running', 'patching', 'testing', 'committing', 'deploying', 'verifying']) {
      const job = { ...recovery, status };
      await put(db, { jobs: [job] });
      assert.equal(await claim(db, job.jobId, 'recoder'), null, 'A persisted commit cannot start another coding attempt');
      const resumed = await claim(db, job.jobId, 'resume-worker', true);
      assert.equal(resumed.status, 'committing');
      assert.equal(resumed.attempts, job.attempts);
      assert.deepEqual(resumed.result, job.result);
      assert.equal(await claim(db, job.jobId, 'lease-thief', true), null);
    }
    for (const change of [
      ...['completed', 'cancelled', 'failed', 'blocked'].map(status => ({ status })),
      { leaseExpiresAt: '2099-01-01T00:00:00Z' },
      { result: { ...recovery.result, commitSha: 'short' } },
      { result: { ...recovery.result, branch: null } },
      { result: { ...recovery.result, prMerged: true } },
    ]) {
      await put(db, { jobs: [{ ...recovery, ...change }] });
      assert.equal(await claim(db, target.jobId, 'forbidden', true), null);
    }
    await put(db, { jobs: [{ ...live, ownerId: target.ownerId }, target] });
    assert.equal(await claim(db, target.jobId, 'same-owner'), null);
    await db.query('savepoint blank_worker');
    await assert.rejects(claim(db, target.jobId, ' '), /Process identity required/);
    await db.query('rollback to savepoint blank_worker');
    await db.query('savepoint drift');
    await exec(originalFunction.replace('begin\n', 'begin\n  -- Concurrent unreviewed implementation\n'));
    await assert.rejects(exec(await migration(patched)), /Senior claim implementation changed/);
    await db.query('rollback to savepoint drift');
    return { ok: true, before, after, retainedHistoricalJobs: history.length, historyAndLiveHolderPreserved: true,
      originalPriorityAndCheckpointPreserved: true, duplicateAndMalformedIdentitySemanticsPreserved: true,
      boundLiteralIdentityVerified: true, recoveredActivePhases: 7, committedAttemptPreserved: true,
      terminalAndLiveLeaseProtected: true, ownerSingleFlightPreserved: true, privateAccessPreserved: true,
      idempotentMigrationVerified: true, concurrentImplementationRejected: true, productionRowsTouched: 0 };
  } finally { await db.query('rollback'); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const connectionString = process.env.IVX_HA_TEST_DATABASE_URL;
  const url = new URL(connectionString ?? 'postgres://invalid/');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/ivx_ha_test') throw new Error('Local ivx_ha_test database required');
  const a = new pg.Client({ connectionString }), b = new pg.Client({ connectionString });
  await Promise.all([a.connect(), b.connect()]);
  try {
    const proof = await proveSeniorClaimSpill(a);
    await a.query(await migration(patched));
    const job = { jobId: 'physical-claim-race', ownerId: 'physical-claim-owner', status: 'queued', attempts: 0 };
    await put(a, { jobs: [job] });
    const winners = (await Promise.all([claim(a, job.jobId, 'physical-a'), claim(b, job.jobId, 'physical-b')])).filter(Boolean);
    assert.equal(winners.length, 1);
    assert.equal(winners[0].attempts, 1);
    const output = { ...proof, physicalConcurrentWinners: winners.length, observedAt: new Date().toISOString(),
      sourceSha: process.env.GITHUB_SHA ?? null, database: 'isolated PostgreSQL' };
    await mkdir('qa/evidence/fleet-ha', { recursive: true });
    await writeFile('qa/evidence/fleet-ha/senior-claim-spill.json', JSON.stringify(output, null, 2) + '\n');
    console.log(JSON.stringify(output));
  } finally { await Promise.allSettled([a.end(), b.end()]); }
}

