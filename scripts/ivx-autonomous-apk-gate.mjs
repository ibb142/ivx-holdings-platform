import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Admission is not completion. Bind the reply to this exact APK mission. */
export function assessSeniorApkJob(response, jobId, goal) {
  const job = response?.job;
  if (response?.ok !== true || !jobId || !goal || job?.jobId !== jobId || job?.input?.goal !== goal) {
    throw new Error('apk_senior_job_identity_mismatch');
  }
  if (['queued', 'running', 'patching', 'testing', 'committing', 'deploying', 'verifying'].includes(job.status)) {
    return { complete: false, jobId, status: job.status };
  }
  if (job.status !== 'completed' || job.result?.jobId !== jobId || job.result?.ok !== true
    || job.result?.finalStatus !== 'COMPLETE' || job.result?.error) throw new Error('apk_senior_job_not_complete');
  return { complete: true, jobId, status: job.status };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const receipt = assessSeniorApkJob(JSON.parse(readFileSync(process.argv[2], 'utf8')),
      process.env.AUTONOMOUS_APK_JOB_ID, process.env.AUTONOMOUS_APK_GOAL);
    console.log(JSON.stringify(receipt));
    process.exitCode = receipt.complete ? 0 : 2;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
