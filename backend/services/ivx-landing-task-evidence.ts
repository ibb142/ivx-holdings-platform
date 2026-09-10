import { createHash } from 'node:crypto';
import type { TaskEvidence } from './ivx-autonomous-task-engine';
import { encodeLandingResult, type LandingResultRecord } from './ivx-landing-p0-backlog';

/** Identical evidence contract for one-shot tasks, repairs and patrols. */
export function landingTaskEvidence(record: LandingResultRecord, source: string, evidenceType: TaskEvidence['evidenceType']): Omit<TaskEvidence, 'evidenceId' | 'createdAt'> {
  if (!record.production_sha || !/^[a-f0-9]{40}$/i.test(record.production_sha)) {
    throw new Error('LANDING_EVIDENCE_SOURCE_REQUIRED: observed production SHA is missing or invalid');
  }
  const summary = encodeLandingResult(record);
  return { evidenceType, source, summary, contentHash: createHash('sha256').update(summary, 'utf8').digest('hex'),
    commitSha: record.production_sha, deploymentId: null };
}
