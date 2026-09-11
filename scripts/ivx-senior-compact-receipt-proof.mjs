import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

export async function proveCompactReceipt(a, b = a) {
  await a.query(await readFile(new URL('../supabase/migrations/20260911001358_ivx_senior_queue_compact_receipt.sql', import.meta.url), 'utf8'));
  const access = (await a.query("select has_function_privilege('anon','public.ivx_senior_queue_patch_receipt(jsonb)','execute') as anon, has_function_privilege('authenticated','public.ivx_senior_queue_patch_receipt(jsonb)','execute') as authenticated, has_function_privilege('service_role','public.ivx_senior_queue_patch_receipt(jsonb)','execute') as service")).rows[0];
  assert.deepEqual(access, { anon: false, authenticated: false, service: true });
  const call = async (client, name, changes) => (await client.query(`select public.${name}($1::jsonb) as value`, [JSON.stringify(changes)])).rows[0].value;
  const patch = (client, changes) => call(client, 'ivx_senior_queue_patch_receipt', changes);
  const now = new Date().toISOString();
  const unrelated = Array.from({ length: 120 }, (_, i) => ({ jobId: `receipt-history-${i}`,
    ownerId: `receipt-owner-${i}`, status: 'queued', createdAt: now, checkpoint: 'synthetic-history-'.repeat(1500) }));
  const job = { jobId: 'receipt-target', ownerId: 'receipt-target-owner', status: 'queued', createdAt: now };
  const legacy = await call(a, 'ivx_senior_queue_patch', [...unrelated, job].map(next => ({ expected: null, next })));
  assert.ok(legacy.jobs.length >= 121, 'Old RPC remains compatible');
  const next = { ...job, note: 'updated' };
  const receipt = await patch(a, [{ expected: job, next }]);
  assert.equal(receipt.kind, 'ivx-senior-patch-receipt-v1');
  assert.deepEqual(receipt.jobs, [next]);
  assert.deepEqual(receipt.removedJobIds, []);
  const fullBytes = Buffer.byteLength(JSON.stringify(legacy));
  const receiptBytes = Buffer.byteLength(JSON.stringify(receipt));
  assert.ok(receiptBytes < fullBytes / 100, 'Unrelated retained history must not be transferred');
  const read = async () => (await a.query("select value from public.ivx_durable_documents where doc_key='senior-developer-worker/queue.json'")).rows[0].value;
  const byIdentity = jobs => [...jobs].sort((x, y) => x.jobId.localeCompare(y.jobId));
  let stored = await read();
  assert.deepEqual(byIdentity(stored.jobs.filter(j => j.jobId.startsWith('receipt-history-'))), byIdentity(unrelated), 'Other owners and checkpoints remain intact');
  const attempts = await Promise.allSettled([
    patch(a, [{ expected: next, next: { ...next, note: 'contender-a' } }]),
    patch(b, [{ expected: next, next: { ...next, note: 'contender-b' } }]),
  ]);
  assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1, 'Only one competing CAS may commit');
  const rejection = attempts.find(r => r.status === 'rejected');
  assert.equal(rejection.reason.code, '40001');
  const claimed = (await a.query('select public.ivx_senior_queue_claim($1,$2,false) as value', [job.jobId, 'receipt-worker'])).rows[0].value;
  assert.ok(claimed);
  await assert.rejects(patch(b, [{ expected: claimed, next: { ...claimed, status: 'testing' }, workerInstanceId: 'wrong-worker' }]), /Worker lease lost/);
  const renewed = await patch(a, [{ expected: claimed, next: { ...claimed, status: 'testing' }, workerInstanceId: 'receipt-worker' }]);
  assert.equal(renewed.jobs[0].leaseWorkerInstanceId, 'receipt-worker');
  assert.ok(Date.parse(renewed.jobs[0].leaseExpiresAt) > Date.now());
  await assert.rejects(patch(a, [null]), /Distinct job identities required/);
  await assert.rejects(patch(a, [{ next: job }, { next: job }]), /Distinct job identities required/);
  // Existing retention may prune a changed old terminal row. The receipt must
  // say so explicitly instead of silently omitting an acknowledgement.
  const old = { jobId: 'receipt-old', ownerId: 'receipt-old-owner', status: 'queued', createdAt: '2000-01-01T00:00:00Z' };
  await call(a, 'ivx_senior_queue_patch', [old, ...Array.from({ length: 200 }, (_, i) => ({
    jobId: `receipt-terminal-${i}`, ownerId: `terminal-owner-${i}`, status: 'completed', createdAt: now,
  }))].map(next => ({ next, expected: null })));
  const removed = await patch(a, [{ expected: old, next: { ...old, status: 'cancelled' } }]);
  assert.deepEqual(removed.jobs, []);
  assert.deepEqual(removed.removedJobIds, [old.jobId]);
  stored = await read();
  assert.deepEqual(byIdentity(stored.jobs.filter(j => j.jobId.startsWith('receipt-history-'))), byIdentity(unrelated));
  return { ok: true, observedAt: new Date().toISOString(), sourceSha: process.env.GITHUB_SHA ?? null,
    fullBytes, receiptBytes, unrelatedJobsPreserved: unrelated.length, casWinners: 1,
    leaseFencing: true, renewedLeaseReturned: true, retentionAcknowledged: true,
    privateAccess: true, legacyCompatible: true, productionRowsTouched: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const connectionString = process.env.IVX_HA_TEST_DATABASE_URL;
  const url = new URL(connectionString ?? 'postgres://invalid/');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/ivx_ha_test') throw new Error('Local ivx_ha_test database required');
  const a = new pg.Client({ connectionString }), b = new pg.Client({ connectionString });
  await Promise.all([a.connect(), b.connect()]);
  try {
    const proof = { ...await proveCompactReceipt(a, b), database: 'isolated PostgreSQL', connections: 2 };
    await mkdir(new URL('../qa/evidence/fleet-ha/', import.meta.url), { recursive: true });
    await writeFile(new URL('../qa/evidence/fleet-ha/compact-receipt.json', import.meta.url), JSON.stringify(proof, null, 2) + '\n');
    console.log(JSON.stringify(proof));
  } finally { await Promise.allSettled([a.end(), b.end()]); }
}
