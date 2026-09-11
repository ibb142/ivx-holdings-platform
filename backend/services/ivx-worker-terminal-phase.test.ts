import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./ivx-senior-developer-worker.ts', import.meta.url), 'utf8');
const writes = source.slice(source.indexOf('let queueWriteChain:'), source.indexOf('\n/**\n * Phase 1 + 11:'));
const stages = source.slice(source.indexOf('async function updateJobStage('), source.indexOf('\n/** Map a senior-developer runtime phase'));
assert.ok(writes.includes('async function updateJob(') && stages.includes('async function updateJobStage('));
const transpiler = new Bun.Transpiler({ loader: 'ts' });

// Exercise the real queue/stage functions with an isolated persistence adapter.
// Delaying the old preflight read reproduces a terminal write overtaken by a phase update.
function fixture() {
  let row = { jobId: 'job', status: 'running', stage: 'RUNNING', lastHeartbeatAt: 'original', finishedAt: null, result: null };
  const code = transpiler.transformSync(writes + '\n' + stages);
  const create = new Function('loadQueueForJob', 'saveQueue', 'getSeniorDeveloperJob', 'ACTIVE_STATUSES', 'STAGE_PROGRESS', 'claimedJobIds', 'nowIso', code + '\nreturn { updateJob, updateJobStage };');
  const api = create(
    async (jobId: string) => { assert.equal(jobId, row.jobId); return { jobs: [structuredClone(row)] }; },
    async (next: { jobs: Array<typeof row> }) => { row = structuredClone(next.jobs[0]); },
    async () => { const snapshot = structuredClone(row); await new Promise(resolve => setTimeout(resolve, 1)); return snapshot; },
    new Set(['queued', 'running', 'patching', 'testing', 'committing', 'deploying', 'verifying']),
    { QUEUED: 0, RUNNING: 10, COMMITTING: 65, FAILED: 100, COMPLETED: 100 },
    new Set(),
    () => 'fresh',
  );
  return { ...api, read: () => structuredClone(row) };
}

for (const status of ['failed', 'blocked', 'completed', 'cancelled']) {
  test('a late phase cannot reopen a ' + status + ' job or replace its proof', async () => {
    const f = fixture();
    const evidence = { finalStatus: status, generatedAt: 'finished', commitSha: null };
    const phase = f.updateJobStage('job', 'COMMITTING', 'late notification');
    const terminal = f.updateJob('job', { status, stage: status === 'completed' ? 'COMPLETED' : 'FAILED', finishedAt: 'finished', result: evidence, error: 'preserved' });
    await Promise.all([phase, terminal]);
    assert.equal(f.read().status, status);
    assert.equal(f.read().finishedAt, 'finished');
    assert.deepEqual(f.read().result, evidence);
    assert.equal(f.read().error, 'preserved');
    await f.updateJobStage('job', 'RUNNING', 'even later notification');
    assert.equal(f.read().status, status);
  });
}

test('active phase updates still advance the job and refresh its heartbeat', async () => {
  const f = fixture();
  await f.updateJobStage('job', 'COMMITTING', 'real progress');
  assert.equal(f.read().status, 'committing');
  assert.equal(f.read().stage, 'COMMITTING');
  assert.equal(f.read().lastHeartbeatAt, 'fresh');
});

test('an explicit retry can still requeue a terminal job', async () => {
  const f = fixture();
  await f.updateJob('job', { status: 'failed', finishedAt: 'finished' });
  await f.updateJob('job', { status: 'queued', stage: 'QUEUED', finishedAt: null });
  assert.equal(f.read().status, 'queued');
  assert.equal(f.read().finishedAt, null);
});

for (const phase of ['COMPLETED', 'FAILED']) {
  test(`a ${phase} notification cannot close the job before its result is durable`, async () => {
    const f = fixture();
    await f.updateJobStage('job', 'COMMITTING', 'commit checkpoint retained');
    await f.updateJobStage('job', phase, 'executor returned; final proof still pending');
    assert.equal(f.read().status, 'committing');
    assert.equal(f.read().stage, 'COMMITTING');
    assert.equal(f.read().finishedAt, null);
    await f.updateJob('job', { status: 'blocked', stage: 'FAILED', finishedAt: 'finished',
      result: { finalStatus: 'BLOCKED', commitSha: 'a'.repeat(40) } });
    assert.equal(f.read().status, 'blocked');
    assert.equal(f.read().finishedAt, 'finished');
  });
}
