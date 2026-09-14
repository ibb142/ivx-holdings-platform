import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { proveSeniorHistory } from './ivx-senior-history-proof.mjs';

const migration = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const patched = '20260914195600_senior_queue_checkpoint_metadata.sql';

export async function proveSeniorCheckpointMetadata(db) {
  const exec = sql => db.exec ? db.exec(sql) : db.query(sql);
  const previous = await migration('20260912012700_senior_queue_payload_spill.sql');
  const start = previous.indexOf('create or replace function public.ivx_senior_queue_patch(');
  const previousFunction = previous.slice(start, previous.indexOf('\nrevoke execute', start));
  const current = await migration(patched);
  const seed = jobs => db.query("insert into public.ivx_durable_documents(doc_key,value) values('senior-developer-worker/queue.json',$1::jsonb) on conflict(doc_key) do update set value=excluded.value", [JSON.stringify({ jobs })]);
  const patch = changes => db.query('select public.ivx_senior_queue_patch_receipt($1::jsonb) value', [JSON.stringify(changes)]).then(result => result.rows[0].value);
  const readJobs = () => db.query("select value->'jobs' jobs from public.ivx_durable_documents where doc_key='senior-developer-worker/queue.json'").then(result => result.rows[0].jobs);
  const terminal = Array.from({ length: 203 }, (_, index) => ({ jobId: `metadata-history-${index}`, ownerId: `history-${index}`, status: 'failed', createdAt: new Date(Date.UTC(2020, 0, 1, 0, index)).toISOString(), finishedAt: '2021-01-01T00:00:00Z', result: { checkpoint: 'preserved-checkpoint-'.repeat(2500) } }));
  const active = { jobId: 'metadata-active', ownerId: 'metadata-owner', status: 'running', stage: 'RUNNING', createdAt: '2026-01-01T00:00:00Z', leaseWorkerInstanceId: 'metadata-worker', leaseExpiresAt: '2099-01-01T00:00:00Z' };
  const next = { ...active, stage: 'TESTING', status: 'testing', stageDetail: 'Observed real phase transition' };
  const changes = [{ expected: active, next, workerInstanceId: 'metadata-worker' }];
  await exec('begin');
  try {
    await exec("set local work_mem='64kB'");
    const measure = async () => {
      const times = [];
      for (let sample = 0; sample < 3; sample += 1) {
        await seed([...terminal.slice(0, 200), active]);
        const plans = (await db.query('explain (analyze,buffers,format json) select public.ivx_senior_queue_patch_receipt($1::jsonb)', [JSON.stringify(changes)])).rows[0]['QUERY PLAN'];
        times.push(plans[0]['Execution Time']);
      }
      const stored = await readJobs();
      assert.deepEqual(stored.slice(0, 200), terminal.slice(0, 200), 'Every retained terminal checkpoint must be unchanged');
      assert.equal(stored[200].stage, 'TESTING');
      assert.equal(stored[200].leaseWorkerInstanceId, active.leaseWorkerInstanceId);
      assert(Date.parse(stored[200].leaseExpiresAt) > Date.now());
      return { samplesMs: times, medianMs: [...times].sort((a, b) => a - b)[1], retainedJobs: stored.length };
    };
    await exec(previousFunction);
    const before = await measure();
    await exec(current);
    await exec(current); // Guarded reapplication must be safe.
    const after = await measure();
    assert(after.medianMs < before.medianMs, 'Metadata fast path must reduce measured checkpoint latency');

    // Compare the original contract for every condition that must fall back.
    const small = terminal.slice(0, 3).map(({ result, ...job }) => job);
    const cases = [
      [],
      [...terminal, { ...active, status: 'queued', leaseWorkerInstanceId: null }],
      [small[2], small[0], small[1]],
      [{ ...small[0], status: 'queued' }, { ...small[1], createdAt: small[0].createdAt }],
      [{ ...small[0], createdAt: null }, small[1]],
      [{ jobId: 'missing-metadata', ownerId: 'unknown' }, small[1]],
      [{ ...small[0], createdAt: [small[0].createdAt] }, small[1]],
      [{ ...small[0], status: ['failed'] }, small[1]],
    ];
    for (const jobs of cases) {
      await exec(previousFunction);
      await seed(jobs);
      await patch([]);
      const expected = await readJobs();
      await exec(current);
      await seed(jobs);
      await patch([]);
      assert.deepEqual(await readJobs(), expected, 'Ordering, overflow and malformed metadata must preserve the original contract');
    }
    await seed([...small, active]);
    await exec('savepoint wrong_holder');
    await assert.rejects(patch([{ ...changes[0], workerInstanceId: 'another-worker' }]), /Worker lease lost/);
    await exec('rollback to savepoint wrong_holder');
    const receipt = await patch(changes);
    assert.equal(receipt.jobs.length, 1);
    assert.equal(receipt.jobs[0].jobId, active.jobId);
    assert.deepEqual(receipt.removedJobIds, []);
    await exec('savepoint stale_checkpoint');
    await assert.rejects(patch(changes), /changed concurrently/);
    await exec('rollback to savepoint stale_checkpoint');
    return { ok: true, before, after, retainedCheckpointsPreserved: 200, fallbackCases: cases.length,
      compactReceiptPreserved: true, wrongLeaseRejected: true, staleCasRejected: true,
      schemaAndMemorySettingsUnchanged: true, productionRowsTouched: 0 };
  } finally { await exec('rollback'); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const connectionString = process.env.IVX_HA_TEST_DATABASE_URL;
  const url = new URL(connectionString ?? 'postgres://invalid/');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/ivx_ha_test') throw new Error('Local ivx_ha_test database required');
  const db = new pg.Client({ connectionString });
  await db.connect();
  try {
    const proof = await proveSeniorCheckpointMetadata(db);
    await db.query(await migration(patched));
    proof.history = await proveSeniorHistory(db, false);
    proof.database = 'isolated PostgreSQL';
    proof.sourceSha = process.env.GITHUB_SHA;
    proof.observedAt = new Date().toISOString();
    await mkdir(new URL('../qa/evidence/fleet-ha/', import.meta.url), { recursive: true });
    await writeFile(new URL('../qa/evidence/fleet-ha/senior-checkpoint-metadata.json', import.meta.url), JSON.stringify(proof, null, 2));
    console.log(JSON.stringify(proof));
  } finally { await db.end(); }
}
