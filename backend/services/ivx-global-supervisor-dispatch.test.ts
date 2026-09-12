import { afterEach, expect, spyOn, test } from 'bun:test';
import * as worker from './ivx-senior-developer-worker';
import * as supervisor from './ivx-global-certification-supervisor';
import { dispatchRepairMission } from './ivx-global-certification-supervisor';

afterEach(() => { active.mockRestore(); enqueue.mockRestore(); collector?.mockRestore(); collector = undefined; });
let active: ReturnType<typeof spyOn>;
let enqueue: ReturnType<typeof spyOn>;
let collector: ReturnType<typeof spyOn> | undefined;

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
