import { test, expect } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { autonomousBranchSuffix } from './ivx-coder-branch';

const source = await readFile(new URL('./ivx-senior-developer-worker.ts', import.meta.url), 'utf8');
const transpiler = new Bun.Transpiler({ loader: 'ts' });
const extract = (start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const now = Date.parse('2026-09-11T00:00:00Z');
const sha = 'a'.repeat(40);

function commitRecovery(message = 'IVX autonomous coder: unrelated task\n\nIVX-Worker-Job: someone-else\nIVX-Task-ID: other-task') {
  const body = extract('async function recoverStuckCommittingJobs(', '\n// ─────────────────────────────────────────────────────────────────────────────\n// RESILIENCE LAYER 4');
  const calls: string[] = [];
  const job = { jobId: 'ivx-worker-exact-original-job', ownerId: 'owner-original', status: 'committing',
    stage: 'COMMITTING', startedAt: new Date(now - 120_000).toISOString(), attempts: 2, result: null,
    input: { taskId: 'exact-original-task', goal: 'Fix the original defect', executionMode: 'code_change', approveGitDeploy: false } };
  const run = new Function('ledgerGithubToken', 'process', 'Date', 'fetch', 'COMMITTING_RECOVERY_THRESHOLD_MS',
    'COMMITTING_RECOVERY_WINDOW_MS', 'STAGE_PROGRESS', 'nowIso', 'classifyTaskType', 'isDurableStoreConfigured',
    'saveQueue', 'appendDurableEvent', 'QUEUE_FILE', 'assertEmergencyStopInactive', 'sharedSeniorQueueEnabled', 'autonomousBranchSuffix',
    transpiler.transformSync(body) + '\nreturn recoverStuckCommittingJobs;')(
      () => 'fixture-only', { env: { GITHUB_REPO_URL: 'https://github.com/owner/app' } },
      class extends Date { static now() { return now; } },
      async (url: string) => { calls.push(url); return Response.json({ commit: { sha,
        commit: { author: { date: new Date(now - 60_000).toISOString() }, message } } }); },
      90_000, 1_200_000, { FAILED: 100, COMPLETED: 100 }, () => new Date(now).toISOString(),
      () => 'CODE_FIX', () => true, async () => {}, async () => {}, 'queue.json', async () => {}, () => false, autonomousBranchSuffix);
  return { job, calls, run: () => run({ jobs: [job] }) };
}

test('a nearby unrelated branch head cannot supply a lost checkpoint or fabricate passing tests', async () => {
  const f = commitRecovery();
  await f.run();
  expect(f.job.result).toBeNull();
  expect(f.job.status).not.toBe('completed');
});

test('a live physical lease prevents legacy commit recovery from reading or changing the job', async () => {
  const f = commitRecovery();
  Object.assign(f.job, { leaseExpiresAt: new Date(now + 60_000).toISOString() });
  await f.run();
  expect(f.calls).toHaveLength(0);
  expect(f.job.result).toBeNull();
});

test('exact task and job trailers recover the commit without inventing validation or a new attempt', async () => {
  const f = commitRecovery('IVX autonomous coder: original task\n\nIVX-Worker-Job: ivx-worker-exact-original-job\nIVX-Task-ID: exact-original-task');
  await f.run();
  expect(f.job.status).toBe('queued');
  expect(f.job.attempts).toBe(2);
  expect(f.job.result).toMatchObject({ commitSha: sha, ok: false, testsRun: false, testsPassed: false,
    typecheckRun: false, finalStatus: 'BLOCKED', endToEndProductionComplete: false });
});

test('resumed validation receipts retain the fact that tests and typecheck actually ran', async () => {
  const body = extract('async function resumeCiWaitJob(', '\n/** Recover a lost commit checkpoint');
  const receipts = [
    { kind: 'test', phase: 'regression_baseline', command: 'node --test repair.test.ts', ok: false, exitCode: 1 },
    { kind: 'test', command: 'node --test repair.test.ts', ok: true, exitCode: 0 },
    { kind: 'typecheck', command: 'tsc --noEmit', ok: true, exitCode: 0 },
  ];
  const job = { jobId: 'same-job', ownerId: 'same-owner', status: 'committing', input: { taskId: 'same-task', goal: 'repair' },
    result: { commitSha: sha, prNumber: 7, branch: 'same-branch', testsRun: true, testsPassed: true,
      typecheckRun: true, typecheckPassed: true, validationEvidence: receipts } };
  let finalized: any;
  const names = ['queueStopping','assertEmergencyStopInactive','getSeniorDeveloperJob','ACTIVE_STATUSES',
    'sharedSeniorQueueEnabled','activeJobControllers','claimedJobIds','updateJob','nowIso','updateJobStage',
    'resumeIVXAutonomousCoderFromCiWait','summarizeAutonomousCoderProof','finalizeResultWithStateRecord',
    'STAGE_PROGRESS','appendLedger','assertRepairResumeEvidence'];
  const run = new Function(...names, transpiler.transformSync(body) + '\nreturn resumeCiWaitJob;')(
    false, async () => {}, async () => structuredClone(job), new Set(['committing']), () => false,
    new Map(), new Set(), async () => {}, () => new Date(now).toISOString(), async () => {},
    async () => ({ finalStatus: 'COMPLETED' }), () => ({ commitSha: sha, validationEvidence: [], testsRun: false, typecheckRun: false }),
    (_job: unknown, result: unknown) => { finalized = result; return { ...(result as object), finalStatus: 'BLOCKED' }; },
    { FAILED: 100 }, async () => {}, () => {});
  await run(job.jobId);
  expect(finalized.validationEvidence).toEqual(receipts);
  expect(finalized.testsRun).toBe(true);
  expect(finalized.typecheckRun).toBe(true);
});

test('production recovery cannot label a rejected final result as completed', async () => {
  const body = extract('async function recoverStuckVerifyingJobs(', '\n// ─────────────────────────────────────────────────────────────────────────────\n// PER-OWNER SINGLE-FLIGHT');
  const job: any = { jobId: 'same-job', status: 'verifying', stage: 'VERIFYING',
    startedAt: new Date(now - 120_000).toISOString(), input: { executionMode: 'code_change', approveGitDeploy: false },
    result: { commitSha: sha, deployId: 'dep-original', deployStatus: 'live',
      healthResponse: { ok: true, commitSha: sha }, versionResponse: { ok: true, commitSha: sha } } };
  const run = new Function('Date', 'VERIFYING_RECOVERY_THRESHOLD_MS', 'process', 'fetch', 'ledgerGithubToken',
    'STAGE_PROGRESS', 'nowIso', 'finalizeResultWithStateRecord', 'appendDurableEvent', 'QUEUE_FILE', 'appendLedger', 'saveQueue',
    transpiler.transformSync(body) + '\nreturn recoverStuckVerifyingJobs;')(
    class extends Date { static now() { return now; } }, 90_000, { env: {} }, async () => Response.json({ commit: sha }),
    () => null, { COMPLETED: 100, FAILED: 100 }, () => new Date(now).toISOString(),
    (_job: unknown, result: object) => ({ ...result, finalStatus: 'BLOCKED', ok: false, endToEndProductionComplete: false, error: 'Missing functional regression' }),
    async () => {}, 'queue.json', async () => {}, async () => {});
  await run({ jobs: [job] });
  expect(job.status).toBe('blocked');
  expect(job.stage).toBe('FAILED');
  expect(job.error).toBe('Missing functional regression');
  expect(job.result.finalStatus).toBe('BLOCKED');
});
