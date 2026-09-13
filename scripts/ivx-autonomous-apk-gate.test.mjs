import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessSeniorApkJob, findSeniorApkEvidence } from './ivx-autonomous-apk-gate.mjs';

const id = 'ivx-worker-fixture', sourceSha = 'a'.repeat(40);
const result = () => ({ ok: true, job: { jobId: id, input: { goal: '[TEMPLATE_MODE:BUG_FIX] Repair APK delivery' }, status: 'completed',
  result: { jobId: id, ok: true, finalStatus: 'COMPLETE', error: null, durable: true,
    prMerged: true, prMergeCommitSha: sourceSha, commitSha: 'b'.repeat(40), prNumber: 42,
    ciChecksGreen: true, testsRun: true, testsPassed: true, typecheckRun: true, typecheckPassed: true } } });

test('admission and active phases cannot certify Senior Developer completion', () => {
  for (const status of ['queued', 'running', 'patching', 'testing', 'committing', 'deploying', 'verifying']) {
    const body = result(); body.job.status = status;
    assert.equal(assessSeniorApkJob(body, id, sourceSha).complete, false);
  }
});
test('matches the actual merged source, including API-normalized goals', () => {
  assert.deepEqual(assessSeniorApkJob(result(), id, sourceSha),
    { complete: true, jobId: id, status: 'completed', sourceSha, prNumber: 42 });
  assert.equal(findSeniorApkEvidence({ ok: true, jobs: [result().job] }, sourceSha).complete, true);
});
test('rejects another job, a PR head instead of its merge, and malformed source SHAs', () => {
  assert.throws(() => assessSeniorApkJob(result(), 'other', sourceSha), /identity_mismatch/);
  assert.throws(() => assessSeniorApkJob(result(), id, 'b'.repeat(40)), /source_evidence_incomplete/);
  for (const sha of ['', 'a'.repeat(41), undefined]) {
    assert.throws(() => assessSeniorApkJob(result(), id, sha), /identity_mismatch/);
    assert.throws(() => findSeniorApkEvidence({ ok: true, jobs: [] }, sha), /source_sha_invalid/);
  }
});
test('failed, stale-error and inconsistent receipts cannot certify a completed task', () => {
  for (const status of ['failed', 'blocked', 'cancelled', 'unknown']) {
    const body = result(); body.job.status = status;
    assert.throws(() => assessSeniorApkJob(body, id, sourceSha), /not_complete/);
  }
  for (const proof of [null, { jobId: id, ok: true }, { ...result().job.result, ok: false },
    { ...result().job.result, jobId: 'other' }, { ...result().job.result, error: 'failed verification' }]) {
    const body = result(); body.job.result = proof;
    assert.throws(() => assessSeniorApkJob(body, id, sourceSha), /not_complete/);
  }
  const body = result(); body.job.error = 'LEASE_EXPIRED';
  assert.throws(() => assessSeniorApkJob(body, id, sourceSha), /not_complete/);
});
test('requires persistent proof, merged PR, green CI, tests and typecheck', () => {
  for (const field of ['durable', 'prMerged', 'ciChecksGreen', 'testsRun', 'testsPassed', 'typecheckRun', 'typecheckPassed']) {
    const body = result(); body.job.result[field] = false;
    assert.throws(() => assessSeniorApkJob(body, id, sourceSha), /source_evidence_incomplete/);
  }
});
test('absence, outage and stale records leave the Senior claim unverified while artifact delivery remains independent', () => {
  const unrelated = result().job; unrelated.result.prMergeCommitSha = 'c'.repeat(40);
  for (const response of [null, { ok: false }, { ok: true, jobs: [] }, { ok: true, jobs: [unrelated] }]) {
    const receipt = findSeniorApkEvidence(response, sourceSha);
    assert.equal(receipt.complete, false);
    assert.equal(receipt.jobId, null);
    assert.equal(receipt.sourceSha, sourceSha);
  }
  const failed = result().job; failed.result.testsPassed = false;
  assert.equal(findSeniorApkEvidence({ ok: true, jobs: [failed, result().job] }, sourceSha).complete, true);
});
