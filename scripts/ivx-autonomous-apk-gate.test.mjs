import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessSeniorApkJob } from './ivx-autonomous-apk-gate.mjs';
const id = 'ivx-worker-fixture', goal = 'Build the authorized APK mission';
const result = () => ({ ok: true, job: { jobId: id, input: { goal }, status: 'completed',
  result: { jobId: id, ok: true, finalStatus: 'COMPLETE', error: null } } });
test('admission and active phases cannot authorize APK dispatch', () => {
  for (const status of ['queued', 'running', 'patching', 'testing', 'committing', 'deploying', 'verifying']) {
    const body = result(); body.job.status = status;
    assert.equal(assessSeniorApkJob(body, id, goal).complete, false);
  }
});
test('only the requested completed job permits the next build step', () => {
  assert.deepEqual(assessSeniorApkJob(result(), id, goal), { complete: true, jobId: id, status: 'completed' });
});
test('a different job or attached unrelated goal is rejected', () => {
  for (const [expectedId, expectedGoal] of [['other-job', goal], [id, 'unrelated goal'], ['', goal]]) {
    assert.throws(() => assessSeniorApkJob(result(), expectedId, expectedGoal), /identity_mismatch/);
  }
});
test('failed, blocked, cancelled, missing and inconsistent proofs cannot authorize a build', () => {
  for (const status of ['failed', 'blocked', 'cancelled', 'unknown']) {
    const body = result(); body.job.status = status;
    assert.throws(() => assessSeniorApkJob(body, id, goal), /not_complete/);
  }
  for (const proof of [null, { jobId: id, ok: true }, { ...result().job.result, ok: false },
    { ...result().job.result, jobId: 'other' }, { ...result().job.result, error: 'failed verification' }]) {
    const body = result(); body.job.result = proof;
    assert.throws(() => assessSeniorApkJob(body, id, goal), /not_complete/);
  }
});
