import { createHash } from 'node:crypto';
import type { TaskEvidence } from './ivx-autonomous-task-engine';

export type PatrolObservation = { task_id: string; assigned_agent_number: number; evidence: TaskEvidence | null };

/** Activity is distinct from success: FAIL/BLOCKED observations do not certify a task. */
export function recentPatrolAgents(rows: readonly PatrolObservation[], sha: string, now = Date.now()): Set<number> {
  const agents = new Set<number>();
  if (!/^[a-f0-9]{40}$/i.test(sha)) return agents;
  for (const row of rows) {
    const evidence = row.evidence;
    if (!evidence || evidence.commitSha !== sha || !evidence.source?.startsWith('continuous-patrol:') ||
        !evidence.summary?.startsWith('LANDING_P0_RESULT ') ||
        createHash('sha256').update(evidence.summary).digest('hex') !== evidence.contentHash) continue;
    try {
      const record = JSON.parse(evidence.summary.slice('LANDING_P0_RESULT '.length));
      const completed = Date.parse(record.completed_at);
      const persisted = Date.parse(evidence.createdAt);
      if (record.v !== 1 || record.agent_number !== row.assigned_agent_number ||
          record.production_sha !== sha || !['PASS', 'FAIL', 'BLOCKED'].includes(record.status) ||
          !Number.isInteger(row.assigned_agent_number) || row.assigned_agent_number < 1 || row.assigned_agent_number > 112 ||
          !Number.isFinite(completed) || !Number.isFinite(persisted) || completed > now || persisted > now ||
          now - completed > 120000 || now - persisted > 120000) continue;
      agents.add(row.assigned_agent_number);
    } catch { /* Invalid evidence never suppresses a recovery diagnosis. */ }
  }
  return agents;
}

export function observedBetweenPatrols(row: {agentNumber: number; status: string; paused: boolean; disabled: boolean}, recent: ReadonlySet<number>): boolean {
  return row.status === 'IDLE' && !row.paused && !row.disabled && recent.has(row.agentNumber);
}
