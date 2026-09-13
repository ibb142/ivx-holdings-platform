import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A signed build and a completed Senior Developer task are separate claims. */
export function assessSeniorApkJob(response, jobId, sourceSha) {
  const job = response?.job;
  if (response?.ok !== true || !jobId || !/^[a-f0-9]{40}$/.test(sourceSha ?? '') || job?.jobId !== jobId) {
    throw new Error('apk_senior_job_identity_mismatch');
  }
  if (['queued', 'running', 'patching', 'testing', 'committing', 'deploying', 'verifying'].includes(job.status)) {
    return { complete: false, jobId, status: job.status };
  }
  if (job.status !== 'completed' || job.result?.jobId !== jobId || job.result?.ok !== true
    || job.error || job.result?.finalStatus !== 'COMPLETE' || job.result?.error) throw new Error('apk_senior_job_not_complete');
  const proof = job.result;
  if (proof.durable !== true || proof.prMerged !== true || proof.prMergeCommitSha !== sourceSha
    || !/^[a-f0-9]{40}$/.test(proof.commitSha ?? '') || !Number.isSafeInteger(proof.prNumber) || proof.prNumber < 1
    || proof.ciChecksGreen !== true || proof.testsRun !== true || proof.testsPassed !== true
    || proof.typecheckRun !== true || proof.typecheckPassed !== true) {
    throw new Error('apk_senior_source_evidence_incomplete');
  }
  return { complete: true, jobId, status: job.status, sourceSha, prNumber: proof.prNumber };
}

/** Never create a code-change job merely to compile an already approved SHA. */
export function findSeniorApkEvidence(response, sourceSha) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha ?? '')) throw new Error('apk_source_sha_invalid');
  if (response?.ok !== true || !Array.isArray(response.jobs)) {
    return { complete: false, jobId: null, sourceSha, reason: 'senior_evidence_unavailable' };
  }
  for (const job of response.jobs) {
    if (job?.result?.prMergeCommitSha !== sourceSha) continue;
    try {
      const receipt = assessSeniorApkJob({ ok: true, job }, job.jobId, sourceSha);
      if (receipt.complete) return receipt;
    } catch { /* Keep searching; an inconsistent record cannot certify this build. */ }
  }
  return { complete: false, jobId: null, sourceSha, reason: 'no_completed_senior_job_for_source_sha' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const receipt = findSeniorApkEvidence(JSON.parse(readFileSync(process.argv[2], 'utf8')), process.env.TARGET_SHA);
    console.log(JSON.stringify(receipt));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
