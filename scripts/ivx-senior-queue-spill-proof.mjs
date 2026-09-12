import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { proveSeniorHistory } from './ivx-senior-history-proof.mjs';

const migration = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const patched = '20260912012700_senior_queue_payload_spill.sql';

export async function proveSeniorQueuePayloadSpill(db) {
  const exec = sql => db.exec ? db.exec(sql) : db.query(sql);
  await exec('begin');
  try {
    await exec("set local work_mem='64kB'");
    const target = { jobId: 'spill-target', ownerId: 'spill-owner', status: 'queued', createdAt: '2026-01-01T00:00:00Z' };
    const live = { jobId: 'spill-live', ownerId: 'another-owner', status: 'running', createdAt: '2025-01-01T00:00:00Z', leaseWorkerInstanceId: 'live-holder', leaseExpiresAt: '2099-01-01T00:00:00Z', result: { commitSha: 'b'.repeat(40) } };
    const history = Array.from({ length: 203 }, (_, i) => ({ jobId: `spill-history-${i}`, ownerId: `history-owner-${i}`, status: 'failed', stage: 'FAILED', createdAt: new Date(Date.UTC(2020, 0, 1, 0, i)).toISOString(), finishedAt: '2021-01-01T00:00:00Z', result: { commitSha: 'a'.repeat(40), finalStatus: 'FAILED', checkpoint: 'retained-work-evidence-'.repeat(1500) } }));
    const original = { jobs: [...history, live, target] };
    const next = { ...target, stageDetail: 'new observed checkpoint' };
    const changes = JSON.stringify([{ expected: target, next }]);
    const patch = input => db.query('select public.ivx_senior_queue_patch_receipt($1::jsonb) value', [JSON.stringify(input)]).then(r => r.rows[0].value);
    const measure = async usePatch => {
      await exec(await migration('20260911091142_senior_history_archive.sql'));
      await exec(await migration('20260911001358_ivx_senior_queue_compact_receipt.sql'));
      if (usePatch) await exec(await migration(patched));
      await db.query("insert into public.ivx_durable_documents(doc_key,value) values('senior-developer-worker/queue.json',$1::jsonb) on conflict(doc_key) do update set value=excluded.value", [JSON.stringify(original)]);
      const plans = (await db.query('explain (analyze,buffers,format json) select public.ivx_senior_queue_patch_receipt($1::jsonb)', [changes])).rows[0]['QUERY PLAN'];
      const plan = plans[0].Plan;
      const stored = (await db.query("select value from public.ivx_durable_documents where doc_key='senior-developer-worker/queue.json'")).rows[0].value;
      assert.deepEqual(stored.jobs, [...history.slice(3), live, next]);
      const archives = (await db.query("select value->'job' job from public.ivx_durable_documents where doc_key like 'senior-developer-worker/archive/spill-history-%' order by doc_key")).rows;
      assert.deepEqual(archives.map(r => r.job), history.slice(0, 3));
      return { tempBlocksWritten: plan['Temp Written Blocks'] ?? 0, tempBlocksRead: plan['Temp Read Blocks'] ?? 0, executionMs: plans[0]['Execution Time'], retainedJobs: stored.jobs.length, archivedJobs: archives.length };
    };
    const before = await measure(false);
    const after = await measure(true);
    assert(before.tempBlocksWritten > 100, 'The original application RPC must reproduce payload spills');
    assert(after.tempBlocksWritten < before.tempBlocksWritten / 10, 'The unchanged RPC must cut temporary writes by at least 90%');
    const receipt = await patch([{ expected: next, next: { ...next, stageDetail: 'second checkpoint' } }]);
    assert.deepEqual(receipt.jobs, [{ ...next, stageDetail: 'second checkpoint' }]);
    assert.deepEqual(receipt.removedJobIds, []);
    await exec('savepoint stale_write');
    await assert.rejects(patch([{ expected: next, next: { ...next, stageDetail: 'stale' } }]), /changed concurrently/);
    await exec('rollback to savepoint stale_write');
    await exec('savepoint wrong_lease');
    await assert.rejects(patch([{ expected: live, next: { ...live, stage: 'TESTING' }, workerInstanceId: 'wrong-holder' }]), /Worker lease lost/);
    await exec('rollback to savepoint wrong_lease');
    const old = { jobId: 'spill-old-active', ownerId: 'old-owner', status: 'queued', createdAt: '1990-01-01T00:00:00Z' };
    await patch([{ expected: null, next: old }]);
    const removed = await patch([{ expected: old, next: { ...old, status: 'cancelled' } }]);
    assert.deepEqual(removed.jobs, []);
    assert.deepEqual(removed.removedJobIds, [old.jobId]);
    const empty = await patch([]);
    assert.deepEqual(empty.jobs, []);
    assert.deepEqual(empty.removedJobIds, []);
    const acl = (await db.query("select has_function_privilege('anon','public.ivx_senior_queue_patch(jsonb)','execute') patch_anon, has_function_privilege('authenticated','public.ivx_senior_queue_patch_receipt(jsonb)','execute') receipt_authenticated, has_function_privilege('service_role','public.ivx_senior_queue_patch_receipt(jsonb)','execute') service")).rows[0];
    assert.deepEqual(acl, { patch_anon: false, receipt_authenticated: false, service: true });
    return { ok: true, before, after, temporaryWriteReduction: 1 - after.tempBlocksWritten / before.tempBlocksWritten, originalJobAndArchiveValuesPreserved: true, unchangedRetentionOrder: true, staleCasRejected: true, wrongLeaseRejected: true, compactReceiptAndRemovalPreserved: true, emptyReceiptPreserved: true, privateAccessPreserved: true, serverMemorySettingsUnchanged: true, productionRowsTouched: 0 };
  } finally { await exec('rollback'); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const connectionString = process.env.IVX_HA_TEST_DATABASE_URL;
  const url = new URL(connectionString ?? 'postgres://invalid/');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/ivx_ha_test') throw new Error('Local ivx_ha_test database required');
  const db = new pg.Client({ connectionString });
  await db.connect();
  try {
    // Earlier isolated proofs roll back their archive implementation. Install
    // the exact production predecessor before testing the guarded migration.
    await db.query(await migration('20260911091142_senior_history_archive.sql'));
    await db.query(await migration('20260911001358_ivx_senior_queue_compact_receipt.sql'));
    const proof = await proveSeniorQueuePayloadSpill(db);
    await db.query(await migration(patched));
    await db.query(await migration(patched));
    proof.history = await proveSeniorHistory(db, false);
    proof.observedAt = new Date().toISOString();
    proof.sourceSha = process.env.GITHUB_SHA;
    proof.database = 'isolated PostgreSQL';
    await mkdir(new URL('../qa/evidence/fleet-ha/', import.meta.url), { recursive: true });
    await writeFile(new URL('../qa/evidence/fleet-ha/senior-queue-spill.json', import.meta.url), JSON.stringify(proof, null, 2));
    console.log(JSON.stringify(proof));
  } finally { await db.end(); }
}
