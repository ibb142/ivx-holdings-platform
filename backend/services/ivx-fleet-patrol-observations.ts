import { createHash } from 'node:crypto';
import type { PatrolObservation } from './ivx-autonomous-recovery-health';
import type { FleetPatrolObservation } from '../../expo/shared/ivx/fleet-signals';

export const PATROL_OBSERVATION_MAX_AGE_MS = 120_000;

/** A persisted QA attempt survives lease release; it never proves a model call or repair. */
export function verifiedPatrolObservations(rows: readonly PatrolObservation[], sha: string, now: number): Map<number, FleetPatrolObservation> {
  if (!Array.isArray(rows) || rows.length > 112) throw new Error('Ambiguous patrol observations');
  const result = new Map<number, FleetPatrolObservation>(), identities = new Set<number>();
  for (const row of rows) {
    const agent = row.assigned_agent_number, evidence = row.evidence;
    if (!Number.isInteger(agent) || agent < 1 || agent > 112 || identities.has(agent)) throw new Error('Ambiguous patrol identities');
    identities.add(agent);
    if (!row.task_id || !evidence?.evidenceId || evidence.commitSha !== sha
      || !evidence.source?.startsWith('continuous-patrol:') || !evidence.summary?.startsWith('LANDING_P0_RESULT ')
      || createHash('sha256').update(evidence.summary).digest('hex') !== evidence.contentHash) continue;
    try {
      const record = JSON.parse(evidence.summary.slice('LANDING_P0_RESULT '.length));
      const start = Date.parse(record.started_at), end = Date.parse(record.completed_at), stored = Date.parse(evidence.createdAt);
      if (record.v !== 1 || record.agent_number !== agent || record.production_sha !== sha
        || !['PASS', 'FAIL', 'BLOCKED'].includes(record.status)
        || !Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(stored)
        || start > end || end > stored || stored > now || now - end > PATROL_OBSERVATION_MAX_AGE_MS
        || now - stored > PATROL_OBSERVATION_MAX_AGE_MS) continue;
      result.set(agent, { taskId: row.task_id, evidenceId: evidence.evidenceId, outcome: record.status,
        source: evidence.source, contentHash: evidence.contentHash, commitSha: sha,
        startedAt: record.started_at, completedAt: record.completed_at, recordedAt: evidence.createdAt });
    } catch { /* Malformed evidence remains unverified. */ }
  }
  return result;
}
