import { afterEach, expect, spyOn, test } from 'bun:test';
import * as worker from './ivx-senior-developer-worker';
import { dispatchRepairMission } from './ivx-global-certification-supervisor';

afterEach(() => { active.mockRestore(); enqueue.mockRestore(); });
let active: ReturnType<typeof spyOn>;
let enqueue: ReturnType<typeof spyOn>;

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
