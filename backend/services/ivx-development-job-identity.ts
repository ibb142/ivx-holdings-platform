import { createHash } from 'node:crypto';

/** A task owns one durable job, including failed or uncertain enqueue outcomes. */
export function developmentJobId(taskId: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_:.-]{0,511}$/.test(taskId)) throw new Error('Invalid autonomous task identity');
  return `ivx-worker-task-${createHash('sha256').update(taskId).digest('hex')}`;
}

/** Reuse the existing campaign agent lane so both dispatchers respect the
 * Senior queue's single-flight rule for the same agent. */
export function developmentOwnerLane(agentNumber: number | null): string {
  if (!Number.isInteger(agentNumber) || agentNumber === null || agentNumber < 1 || agentNumber > 112) {
    throw new Error('Development handoff requires an assigned fleet agent from 1 to 112.');
  }
  return `campaign-agent-${agentNumber}`;
}
