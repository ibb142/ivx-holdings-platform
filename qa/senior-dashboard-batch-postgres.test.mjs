import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { seniorJobBatchIds, verifiedSeniorJobBatch, SENIOR_QUEUE_JOBS_SQL } from '../backend/services/ivx-senior-work-queue.ts';

const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.IVX_PGLITE_MODULE || '@electric-sql/pglite');

// Execute the production SQL in isolated PostgreSQL. This checks query semantics,
// not native multi-connection throughput or production latency.
test('one selected-job observation preserves all identities and immutable evidence', async t => {
  const db = new PGlite();
  const ids = seniorJobBatchIds(Array.from({ length: 112 }, (_, i) => `job-${i}`));
  const jobs = ids.map((jobId, i) => ({ jobId, status: i === 0 ? 'completed' : 'running',
    result: { commitSha: String(i).padStart(40, 'a') }, input: { taskId: `task-${i}` } }));
  try {
    await db.exec('create table public.ivx_durable_documents (doc_key text primary key, value jsonb not null)');
    const put = value => db.query('insert into public.ivx_durable_documents values ($1,$2) on conflict(doc_key) do update set value=excluded.value',
      ['senior-developer-worker/queue.json', { jobs: value }]);
    const read = async selected => {
      const normalized = seniorJobBatchIds(selected);
      const rows = (await db.query(SENIOR_QUEUE_JOBS_SQL,
        ['senior-developer-worker/queue.json', normalized, normalized.length + 1])).rows;
      return verifiedSeniorJobBatch(rows.map(row => row.job), normalized);
    };
    await put([...jobs, { jobId: 'unrelated-history', status: 'completed', secretFixture: 'not-selected' }]);
    await t.test('112 jobs need one statement; unrelated history is omitted and the read does not mutate', async () => {
      await db.exec('begin read only');
      assert.deepEqual(await read(ids), jobs);
      await db.exec('commit');
      assert.equal((await db.query('select jsonb_array_length(value->\'jobs\') as n from public.ivx_durable_documents')).rows[0].n, 113);
    });
    await t.test('missing IDs stay missing and repeated input IDs do not duplicate outputs', async () => {
      assert.deepEqual(await read(['missing', ids[0], ids[0]]), [jobs[0]]);
    });
    await t.test('a later observation sees a real change instead of a cached job result', async () => {
      jobs[1].status = 'failed';
      await put(jobs);
      assert.equal((await read([ids[1]]))[0].status, 'failed');
    });
    await t.test('duplicates anywhere in the selected result are rejected', async () => {
      await put([...jobs, jobs[0]]);
      await assert.rejects(read(ids), /Duplicate/);
      await put([jobs[0], jobs[0]]);
      await assert.rejects(read(ids), /Duplicate/);
    });
    await t.test('SQL-looking identities stay bound values and malformed identities cannot certify a job', async () => {
      const jobId = "x' OR true --";
      await put([{ jobId }, { jobId: 'unrelated' }]);
      assert.deepEqual(await read([jobId]), [{ jobId }]);
      await put([{ jobId: 7 }, { jobId: '7' }]);
      await assert.rejects(read(['7']), /mismatch|Duplicate/);
    });
  } finally { await db.close(); }
});
