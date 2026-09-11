import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { withIsolatedCoderWorkspace, type CoderWorkspaceEvidence } from '../backend/services/ivx-coder-workspace';

// A bounded local fixture: no production DB, provider call, commit or deploy.
const connectionString = process.env.IVX_HA_TEST_DATABASE_URL;
const url = new URL(connectionString ?? 'postgres://invalid/');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/ivx_ha_test') {
  throw new Error('Local ivx_ha_test database required');
}
const clients = [0, 1, 2].map(() => new pg.Client({ connectionString }));
const [a, b, observer] = clients;
await Promise.all(clients.map(client => client.connect()));
const source = await mkdtemp(path.join(tmpdir(), 'ivx-isolation-proof-'));
let release!: () => void;
const bothRunning = new Promise<void>(resolve => { release = resolve; });
const createdAt = new Date().toISOString();
const fixture = (name: string, owner: string) => ({ jobId: `workspace-proof-${name}`, ownerId: owner,
  status: 'queued', attempts: 0, createdAt, idempotencyKey: `workspace-proof-${name}` });
type Job = ReturnType<typeof fixture> & { leaseWorkerInstanceId?: string | null; leaseExpiresAt?: string | null;
  workspaceEvidence?: CoderWorkspaceEvidence & { jobId: string; workerInstanceId: string | null; leaseExpiresAt: string | null } };
const patch = async (client: pg.Client, expected: Job | null, next: Job, worker?: string) => {
  const receipt = (await client.query('select public.ivx_senior_queue_patch_receipt($1::jsonb) value',
    [JSON.stringify([{ expected, next, workerInstanceId: worker ?? null }])])).rows[0].value;
  assert.equal(receipt.kind, 'ivx-senior-patch-receipt-v1');
  assert.equal(receipt.jobs.length, 1);
  return receipt.jobs[0] as Job;
};
const claim = async (client: pg.Client, jobId: string, worker: string) =>
  (await client.query('select public.ivx_senior_queue_claim($1,$2) value', [jobId, worker])).rows[0].value as Job | null;
try {
  await a!.query(await readFile(new URL('../supabase/migrations/20260911091142_senior_history_archive.sql', import.meta.url), 'utf8'));
  await writeFile(path.join(source, 'first.ts'), 'first original');
  await writeFile(path.join(source, 'second.ts'), 'second original');
  const pending = [fixture('first', 'workspace-owner-a'), fixture('second', 'workspace-owner-b')];
  await Promise.all(pending.map((job, index) => patch(clients[index]!, null, job)));
  const jobs = await Promise.all(pending.map((job, index) => claim(clients[index]!, job.jobId, `workspace-worker-${index}`)));
  assert(jobs.every(Boolean), 'independent owners acquire two live physical leases');
  const sameOwner = fixture('same-owner', pending[0]!.ownerId);
  await patch(observer!, null, sameOwner);
  assert.equal(await claim(observer!, sameOwner.jobId, 'third-worker'), null, 'same owner remains serialized');
  let active = 0;
  let peak = 0;
  const executions = await Promise.allSettled(jobs.map(async (initial, index) => {
    try {
    let current = initial!;
    const client = clients[index]!;
    const worker = current.leaseWorkerInstanceId!;
    const name = index === 0 ? 'first' : 'second';
    await withIsolatedCoderWorkspace(source, async root => {
      active += 1; peak = Math.max(peak, active);
      if (active === 2) release();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([bothRunning, new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Concurrent repair did not enter its workspace')), 5000);
        })]);
      } finally { clearTimeout(timer); }
      await writeFile(path.join(root, `${name}.ts`), `${name} changed`);
      active -= 1;
    }, async evidence => {
      const workspaceEvidence = { ...evidence, jobId: current.jobId,
        workerInstanceId: worker, leaseExpiresAt: current.leaseExpiresAt ?? null };
      current = await patch(client, current, { ...current, workspaceEvidence }, worker);
      const stored = (await observer!.query("select job from public.ivx_durable_documents, lateral jsonb_array_elements(value->'jobs') job where doc_key='senior-developer-worker/queue.json' and job->>'jobId'=$1", [current.jobId])).rows[0].job;
      assert.deepEqual(stored.workspaceEvidence, workspaceEvidence, 'independent DB read sees the actual workspace receipt');
    });
    await assert.rejects(patch(client, current, { ...current, status: 'completed' }, 'wrong-worker'), /Worker lease lost/);
    current = await patch(client, current, { ...current, status: 'completed' }, worker);
    assert.equal(current.leaseWorkerInstanceId, null, 'completion releases the active lease');
    assert.equal(current.workspaceEvidence?.workerInstanceId, worker, 'historical receipt retains its actual worker');
    } catch (error) { release(); throw error; }
  }));
  for (const execution of executions) if (execution.status === 'rejected') throw execution.reason;
  assert.equal(peak, 2);
  const stored = (await observer!.query("select job from public.ivx_durable_documents, lateral jsonb_array_elements(value->'jobs') job where doc_key='senior-developer-worker/queue.json' and job->>'jobId'=any($1::text[]) order by job->>'jobId'", [pending.map(job => job.jobId)])).rows.map(row => row.job as Job);
  assert.equal(stored.length, 2);
  assert.equal(new Set(stored.map(job => job.workspaceEvidence?.workspaceId)).size, 2);
  for (const job of stored) {
    const receipt = job.workspaceEvidence!;
    assert.equal(job.status, 'completed');
    assert.equal(receipt.sourceUnchanged, true);
    assert.equal(receipt.cleanup, 'removed');
    assert.equal(receipt.changedFiles.length, 1);
    await assert.rejects(access(path.join(tmpdir(), receipt.workspaceId)));
  }
  assert.equal(await readFile(path.join(source, 'first.ts'), 'utf8'), 'first original');
  assert.equal(await readFile(path.join(source, 'second.ts'), 'utf8'), 'second original');
  const proof = { verification: 'PASS', scope: 'isolated PostgreSQL and production workspace implementation',
    generatedAt: new Date().toISOString(), testSha: process.env.GITHUB_SHA ?? null, connections: clients.length,
    simultaneousRepairs: peak, sameOwnerSerialized: true, staleWorkerRejected: true,
    independentReadVerified: true, workspaceReceiptsSurviveLeaseRelease: true,
    productionRowsTouched: 0, providerCalls: 0, jobs: stored };
  await mkdir('qa/evidence/fleet-ha', { recursive: true });
  await writeFile('qa/evidence/fleet-ha/coder-workspaces.json', `${JSON.stringify(proof, null, 2)}\n`);
  console.log(JSON.stringify({ verification: proof.verification, simultaneousRepairs: peak,
    durableReceipts: stored.length, providerCalls: 0, productionRowsTouched: 0 }));
} finally {
  release();
  await rm(source, { recursive: true, force: true });
  await Promise.allSettled(clients.map(client => client.end()));
}
