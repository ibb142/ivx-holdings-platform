import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import * as worker from './ivx-senior-developer-worker';
import * as supervisor from './ivx-global-certification-supervisor';
import * as failureEvidence from './ivx-supervisor-failure-evidence';
import { dispatchRepairMission } from './ivx-global-certification-supervisor';

afterEach(() => { active.mockRestore(); enqueue.mockRestore(); collector?.mockRestore(); collector = undefined; evidence.mockRestore(); jobRead?.mockRestore(); jobRead = undefined; });
let active: ReturnType<typeof spyOn>;
let enqueue: ReturnType<typeof spyOn>;
let collector: ReturnType<typeof spyOn> | undefined;
let evidence: ReturnType<typeof spyOn>;
let jobRead: ReturnType<typeof spyOn> | undefined;

beforeEach(() => {
  evidence = spyOn(failureEvidence, 'collectSupervisorFailureEvidence').mockImplementation(async mission => ({
    observedAt: '2026-09-12T12:00:00Z', mainSha: mission.mainSha, runId: mission.runId!, runAttempt: 1,
    workflowPath: '.github/workflows/ivx-112-exact-sha-autodeploy-cert.yml', workflowSha256: '1'.repeat(64),
    implementationPaths: ['backend/services/ivx-real-execution-certificate.ts'],
    jobs: [{ jobId: 103502275336, conclusion: 'failure', failedSteps: ['Start real 112/112 execution certificate'],
      logExcerpt: 'Failed to enqueue 112 durable tasks: The operation was aborted due to timeout', logPrefixSha256: '2'.repeat(64), logTruncated: false }],
  }));
});

function failedCycle(sha: string) {
  collector = spyOn(supervisor, 'collectGlobalCertificationEvidence').mockResolvedValue({ input: {
    mainSha: sha, productionSha: sha, productionHealthy: true, collector: 'github_actions_api', collectorError: null,
    runs: supervisor.REQUIRED_CERTIFICATION_WORKFLOWS.map((workflow, index) => ({ workflow: workflow.name,
      runId: 100 + index, headSha: sha, headBranch: 'main', status: 'completed',
      conclusion: index < 3 ? 'failure' : 'success' })),
  } });
}

test('one uncertain queue read defers the remaining RED missions in the same cycle', async () => {
  const sha = 'f'.repeat(40);
  failedCycle(sha);
  let reads = 0, writes = 0;
  active = spyOn(worker, 'getActiveJobForOwner').mockImplementation(async () => { reads++; throw new Error('Query read timeout'); });
  enqueue = spyOn(worker, 'enqueueOrAttachSeniorDeveloperJob').mockImplementation(async () => { writes++; throw new Error('must not enqueue'); });
  const cycle = await supervisor.runGlobalCertificationSupervision(sha);
  expect(cycle.result.status).toBe('RED');
  expect(cycle.result.certified).toBe(false);
  expect(cycle.result.repairMissions).toHaveLength(3);
  expect(reads).toBe(1);
  expect(writes).toBe(0);
  expect(cycle.dispatches).toHaveLength(1);
  expect(cycle.dispatches[0].deferred).toBe(true);
  expect(cycle.dispatches[0].detail).toContain('Query read timeout');
});

test('an uncertain enqueue does not try another identity and the next cycle reconciles the original', async () => {
  const sha = 'c'.repeat(40);
  failedCycle(sha);
  const inputs: worker.IVXWorkerJobInput[] = [];
  active = spyOn(worker, 'getActiveJobForOwner').mockResolvedValue(null);
  enqueue = spyOn(worker, 'enqueueOrAttachSeniorDeveloperJob').mockImplementation(async input => {
    inputs.push(input);
    throw new Error('Query read timeout after enqueue');
  });
  const first = await supervisor.runGlobalCertificationSupervision(sha);
  expect(first.result.repairMissions).toHaveLength(3);
  expect(inputs).toHaveLength(1);
  expect(first.dispatches).toHaveLength(1);
  expect(first.dispatches[0].deferred).toBe(true);
  const original = {jobId:'durable-supervisor-mission',ownerId:inputs[0].ownerId,status:'queued',input:inputs[0]} as worker.IVXWorkerJob;
  active.mockResolvedValue(original);
  enqueue.mockImplementation(async input => {
    inputs.push(input);
    return {job:original,attached:true,activeJobId:original.jobId};
  });
  const second = await supervisor.runGlobalCertificationSupervision(sha);
  expect(inputs).toHaveLength(2);
  expect(inputs[1].taskId).toBe(inputs[0].taskId);
  expect(second.dispatches).toHaveLength(1);
  expect(second.dispatches[0].attached).toBe(true);
  expect(second.dispatches[0].jobId).toBe(original.jobId);
  expect(second.result.certified).toBe(false);
});

test('supervisor gives a real repair an exact task identity and code execution mode', async () => {
  const inputs: worker.IVXWorkerJobInput[] = [];
  active = spyOn(worker, 'getActiveJobForOwner').mockResolvedValue(null);
  enqueue = spyOn(worker, 'enqueueOrAttachSeniorDeveloperJob').mockImplementation(async input => {
    inputs.push(input);
    return {job: {jobId:'supervisor-job'} as worker.IVXWorkerJob, attached:false, activeJobId:null};
  });
  const sha = 'b'.repeat(40);
  const result = await dispatchRepairMission({workflow:'IVX QA Suite',mainSha:sha,runId:7,conclusion:'failure',reason:'failed QA'});
  expect(result.dispatched).toBe(true);
  expect(inputs[0].taskId).toMatch(new RegExp('^global-supervisor:'+sha+':[a-f0-9]{64}$'));
  expect(inputs[0].executionMode).toBe('code_change');
  expect(inputs[0].approveGitDeploy).toBe(false);
  expect(inputs[0].goal).toContain('[AUTONOMOUS_DIAGNOSTIC_DATA]');
  expect(inputs[0].goal).toContain('Failed to enqueue 112 durable tasks');
  expect(inputs[0].goal.split('\n')[1]).toContain('Failed to enqueue 112 durable tasks');
  expect(inputs[0].goal.split('\n')[2]).toContain('backend/services/ivx-real-execution-certificate.ts');
  expect(result.evidenceRunId).toBe(7);
});

test('a cached terminal job is reported truthfully and does not starve the next eligible mission', async () => {
  const sha = '1'.repeat(40);
  failedCycle(sha);
  active = spyOn(worker, 'getActiveJobForOwner').mockResolvedValue(null);
  const inputs: worker.IVXWorkerJobInput[] = [];
  enqueue = spyOn(worker, 'enqueueOrAttachSeniorDeveloperJob').mockImplementation(async input => {
    inputs.push(input);
    return { job: { jobId: `repair-${inputs.length}`, status: 'queued', ownerId: input.ownerId, input } as worker.IVXWorkerJob, attached: false, activeJobId: null };
  });
  await supervisor.runGlobalCertificationSupervision(sha);
  jobRead = spyOn(worker, 'getSeniorDeveloperJob').mockResolvedValue({
    jobId: 'repair-1', status: 'blocked', ownerId: inputs[0].ownerId, input: inputs[0],
  } as worker.IVXWorkerJob);
  const cycle = await supervisor.runGlobalCertificationSupervision(sha);
  expect(cycle.dispatches[0]).toMatchObject({ jobId: 'repair-1', jobStatus: 'blocked', attached: false, dispatched: false });
  expect(cycle.dispatches[1]).toMatchObject({ workflow: 'IVX QA Suite', jobId: 'repair-2', dispatched: true });
  expect(inputs).toHaveLength(2);
  expect(inputs[1].taskId).not.toBe(inputs[0].taskId);
  expect(cycle.result.certified).toBe(false);
});

test('missing failure evidence defers without asking the coder to guess a fix', async () => {
  active = spyOn(worker, 'getActiveJobForOwner').mockResolvedValue(null);
  enqueue = spyOn(worker, 'enqueueOrAttachSeniorDeveloperJob').mockImplementation(async () => { throw new Error('must not enqueue'); });
  evidence.mockRejectedValue(new Error('Failure evidence unavailable: GitHub HTTP 503.'));
  const result = await dispatchRepairMission({ workflow: 'IVX QA Suite', mainSha: '2'.repeat(40), runId: 71, conclusion: 'failure', reason: 'failed' });
  expect(result.deferred).toBe(true);
  expect(result.dispatched).toBe(false);
  expect(enqueue).not.toHaveBeenCalled();
});

test('completed idempotent evidence is not reported as a new running repair', async () => {
  active = spyOn(worker, 'getActiveJobForOwner').mockResolvedValue(null);
  enqueue = spyOn(worker, 'enqueueOrAttachSeniorDeveloperJob').mockResolvedValue({
    job: { jobId: 'prior-complete', status: 'completed' } as worker.IVXWorkerJob, attached: true, activeJobId: 'prior-complete',
  });
  const result = await dispatchRepairMission({ workflow: 'IVX QA Suite', mainSha: '3'.repeat(40), runId: 72, conclusion: 'failure', reason: 'failed' });
  expect(result).toMatchObject({ jobId: 'prior-complete', jobStatus: 'completed', dispatched: false, attached: false });
});

test('work admitted during diagnostic collection retains its priority and identity', async () => {
  active = spyOn(worker, 'getActiveJobForOwner').mockResolvedValueOnce(null).mockResolvedValue({
    jobId: 'intervening-repair', status: 'running', input: { taskId: 'another-priority-scope' },
  } as worker.IVXWorkerJob);
  enqueue = spyOn(worker, 'enqueueOrAttachSeniorDeveloperJob').mockImplementation(async () => { throw new Error('must not enqueue'); });
  const result = await dispatchRepairMission({ workflow: 'IVX QA Suite', mainSha: '4'.repeat(40), runId: 73, conclusion: 'failure', reason: 'failed' });
  expect(result).toMatchObject({ dispatched: false, attached: false, deferred: true });
  expect(result.detail).toContain('acquired other work');
  expect(enqueue).not.toHaveBeenCalled();
});

test('shutdown while fetching failure logs prevents enqueue', async () => {
  let running = true;
  active = spyOn(worker, 'getActiveJobForOwner').mockResolvedValue(null);
  enqueue = spyOn(worker, 'enqueueOrAttachSeniorDeveloperJob').mockImplementation(async () => { throw new Error('must not enqueue'); });
  const original = evidence.getMockImplementation()!;
  evidence.mockImplementation(async mission => { const result = await original(mission); running = false; return result; });
  const result = await dispatchRepairMission({ workflow: 'IVX QA Suite', mainSha: '5'.repeat(40), runId: 74, conclusion: 'failure', reason: 'failed' }, () => running);
  expect(result.deferred).toBe(true);
  expect(enqueue).not.toHaveBeenCalled();
});

test('another workflow waits for the existing supervisor job without attaching its identity', async () => {
  active = spyOn(worker, 'getActiveJobForOwner').mockResolvedValue({jobId:'existing-supervisor-job',
    ownerId:'machine:autonomous-global-supervisor',status:'committing',input:{taskId:'another-workflow'}} as worker.IVXWorkerJob);
  let writes = 0;
  enqueue = spyOn(worker, 'enqueueOrAttachSeniorDeveloperJob').mockImplementation(async () => {
    writes++;
    return {job:{jobId:'wrong-extra-job'} as worker.IVXWorkerJob,attached:false,activeJobId:null};
  });
  const result = await dispatchRepairMission({workflow:'IVX E2E Acceptance Pipeline',mainSha:'d'.repeat(40),runId:8,conclusion:'failure',reason:'failed E2E'});
  expect(writes).toBe(0);
  expect(result.dispatched).toBe(false);
  expect(result.attached).toBe(false);
});

test('shutdown during the owner read prevents the pending enqueue', async () => {
  let running = true, writes = 0;
  active = spyOn(worker, 'getActiveJobForOwner').mockImplementation(async () => { running = false; return null; });
  enqueue = spyOn(worker, 'enqueueOrAttachSeniorDeveloperJob').mockImplementation(async () => {
    writes++;
    return {job:{jobId:'late-job'} as worker.IVXWorkerJob,attached:false,activeJobId:null};
  });
  const result = await dispatchRepairMission({workflow:'IVX QA Suite',mainSha:'e'.repeat(40),runId:9,conclusion:'failure',reason:'failed QA'}, () => running);
  expect(writes).toBe(0);
  expect(result.dispatched).toBe(false);
  expect(result.deferred).toBe(true);
});
