import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

export async function proveSeniorHistory(db, applyPatch = true) {
  const exec = sql => db.exec ? db.exec(sql) : db.query(sql);
  await exec('begin');
  try {
    if (applyPatch) await exec(await readFile(new URL('../supabase/migrations/20260911091142_senior_history_archive.sql', import.meta.url), 'utf8'));
    const access = (await db.query("select has_function_privilege('anon','public.ivx_senior_queue_patch(jsonb)','execute') anon, has_function_privilege('authenticated','public.ivx_senior_queue_patch(jsonb)','execute') authenticated")).rows[0];
    assert.deepEqual(access, { anon: false, authenticated: false });
    const now = new Date().toISOString();
    const pending = { jobId: 'history-proof-active', ownerId: 'proof-owner', status: 'queued', createdAt: '2000-01-01T00:00:00Z', attempts: 0 };
    const terminal = Array.from({ length: 203 }, (_, i) => ({ jobId: `history-proof-${i}`, ownerId: `proof-${i}`, status: 'failed',
      createdAt: new Date(Date.UTC(2020, 0, 1, 0, i)).toISOString(), finishedAt: now,
      result: { commitSha: 'a'.repeat(40), validationEvidence: [{ command: 'fixture regression', ok: false }], finalStatus: 'FAILED' } }));
    const original = { jobs: [pending, ...terminal] };
    await db.query("insert into public.ivx_durable_documents(doc_key,value) values('senior-developer-worker/queue.json',$1::jsonb) on conflict(doc_key) do update set value=excluded.value", [JSON.stringify(original)]);
    const patch = changes => db.query('select public.ivx_senior_queue_patch($1::jsonb) value', [JSON.stringify(changes)]).then(r => r.rows[0].value);
    const failures = [];
    await patch([]);
    const archives = (await db.query("select value from public.ivx_durable_documents where doc_key like 'senior-developer-worker/archive/history-proof-%' order by doc_key")).rows;
    try { assert.deepEqual(archives.map(row => row.value.job), terminal.slice(0, 3)); } catch { failures.push('pruned terminal preimages were not archived'); }
    const current = (await db.query("select value from public.ivx_durable_documents where doc_key='senior-developer-worker/queue.json'")).rows[0].value;
    assert.equal(current.jobs.length, 201);
    assert.deepEqual(current.jobs.find(job => job.jobId === pending.jobId), pending);
    await patch([]);
    assert.equal((await db.query("select count(*)::int n from public.ivx_durable_documents where doc_key like 'senior-developer-worker/archive/history-proof-%'")).rows[0].n, archives.length);
    const claimed = (await db.query('select public.ivx_senior_queue_claim($1,$2,false) value', [pending.jobId, 'history-proof-worker'])).rows[0].value;
    const failed = (await patch([{ expected: claimed, next: { ...claimed, status: 'failed', stage: 'FAILED', finishedAt: null }, workerInstanceId: 'history-proof-worker' }])).jobs.find(job => job.jobId === pending.jobId);
    // The old active job may be immediately archived when it becomes terminal.
    const completed = failed ?? (await db.query("select value->'job' job from public.ivx_durable_documents where doc_key like 'senior-developer-worker/archive/history-proof-active/%'")).rows[0]?.job;
    if (!completed?.finishedAt) failures.push('new terminal transition has no finishedAt');
    const survivor = current.jobs.find(job => job.jobId === terminal[3].jobId);
    const staleTerminal = { ...survivor, leaseWorkerInstanceId: 'late-worker', leaseExpiresAt: new Date(Date.now() + 60000).toISOString() };
    await patch([{ expected: survivor, next: staleTerminal }]);
    await exec('savepoint late_worker');
    let refused = false;
    try { await patch([{ expected: staleTerminal, next: { ...staleTerminal, result: { finalStatus: 'COMPLETE' } }, workerInstanceId: 'late-worker' }]); }
    catch (error) { refused = error.code === '55000'; }
    await exec('rollback to savepoint late_worker');
    if (!refused) failures.push('a late worker overwrote a terminal result');
    assert.deepEqual(failures, []);
    // Archive failure must abort retention and the queue update together.
    await exec("create function pg_temp.reject_archive() returns trigger language plpgsql as $$ begin raise exception 'archive unavailable'; end $$; create trigger history_proof_reject before insert on public.ivx_durable_documents for each row when (new.doc_key like 'senior-developer-worker/archive/%') execute function pg_temp.reject_archive()");
    const snapshot = (await db.query("select value from public.ivx_durable_documents where doc_key='senior-developer-worker/queue.json'")).rows[0].value;
    await exec('savepoint archive_failure');
    let failedAtomically = false;
    try { await patch([{ expected: null, next: { ...terminal[0], jobId: 'history-proof-another', createdAt: now } }]); }
    catch (error) { failedAtomically = /archive unavailable/.test(error.message); }
    await exec('rollback to savepoint archive_failure');
    assert.equal(failedAtomically, true);
    assert.deepEqual((await db.query("select value from public.ivx_durable_documents where doc_key='senior-developer-worker/queue.json'")).rows[0].value, snapshot);
    return { ok: true, archivesPreserveCompleteJobs: 3, activeJobsPreserved: true, repeatedRetentionIdempotent: true,
      terminalTimestampRecorded: true, lateWorkerRejected: true, archiveFailureAtomic: true, privateAccessPreserved: true, productionRowsTouched: 0 };
  } finally { await exec('rollback'); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const connectionString = process.env.IVX_HA_TEST_DATABASE_URL;
  const url = new URL(connectionString ?? 'postgres://invalid/');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/ivx_ha_test') throw new Error('Local ivx_ha_test database required');
  const db = new pg.Client({ connectionString });
  await db.connect();
  try {
    await db.query('create table if not exists public.ivx_durable_events(id bigserial primary key,doc_key text,event jsonb,created_at timestamptz default now())');
    const proof = { ...await proveSeniorHistory(db), database: 'isolated PostgreSQL', sourceSha: process.env.GITHUB_SHA, observedAt: new Date().toISOString() };
    await mkdir(new URL('../qa/evidence/fleet-ha/', import.meta.url), { recursive: true });
    await writeFile(new URL('../qa/evidence/fleet-ha/senior-history.json', import.meta.url), JSON.stringify(proof, null, 2));
    console.log(JSON.stringify(proof));
  } finally { await db.end(); }
}
