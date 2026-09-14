import type { Task } from './ivx-autonomous-task-engine';
import type { FleetFileObservation } from '../../expo/shared/ivx/fleet-signals';

/** A source location is an observed tool event, never an invented live cursor. */
export function latestFleetFileObservation(task: Task, now: number): FleetFileObservation | null {
  const latest = (task.evidence ?? []).filter(e =>
    ['source_file_inspected', 'source_file_changed', 'code_diff'].includes(e.evidenceType)
    && e.evidenceId && /^[a-f0-9]{64}$/i.test(e.contentHash ?? '')
    && Date.parse(e.createdAt) <= now && now - Date.parse(e.createdAt) <= 60_000
    && Date.parse(e.createdAt) >= Date.parse(task.attemptStartedAt ?? task.startedAt ?? task.createdAt ?? '')
  ).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  if (!latest || typeof latest.source !== 'string') return null;
  const match = /^(.+?)(?::(\d+)(?:-(\d+))?|#L(\d+)(?:-L(\d+))?)?$/.exec(latest.source);
  if (!match) return null;
  const filePath = match[1];
  if (!filePath || filePath.length > 512 || /[\\:\x00-\x1f]/.test(filePath)
    || filePath.startsWith('/') || filePath.split('/').some(p => !p || p === '.' || p === '..')) return null;
  const lineStart = match[2] || match[4] ? Number(match[2] || match[4]) : null;
  const lineEnd = match[3] || match[5] ? Number(match[3] || match[5]) : lineStart;
  if (lineStart !== null && (!Number.isSafeInteger(lineStart) || lineStart < 1
    || !Number.isSafeInteger(lineEnd) || lineEnd! < lineStart || lineEnd! > 10_000_000)) return null;
  return { taskId: task.taskId, filePath, lineStart, lineEnd, observedAt: latest.createdAt,
    evidenceId: latest.evidenceId, contentHash: latest.contentHash,
    operation: latest.evidenceType as FleetFileObservation['operation'] };
}
