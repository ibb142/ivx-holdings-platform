/** Read-only command boundary: a status query must never start an agent or model. */
export type OwnerTaskStatusCommand = { taskId: string; error?: never } | { taskId?: never; error: string };

export function parseOwnerTaskStatusCommand(prompt: string): OwnerTaskStatusCommand | null {
  if (!/^\/status(?:\s|$)/i.test(prompt.trim())) return null;
  const match = prompt.trim().match(/^\/status\s+--task(?:=|\s+)(?:"([^"\n]+)"|'([^'\n]+)'|([^\s]+))\s*$/i);
  const taskId = match?.[1] ?? match?.[2] ?? match?.[3];
  if (!taskId || !/^[a-zA-Z0-9][a-zA-Z0-9_:.-]{0,511}$/.test(taskId)) {
    return { error: 'Use /status --task="TASK_ID" with one task identifier.' };
  }
  return { taskId };
}

type TaskReader = (taskId: string) => Promise<unknown>;
export interface OwnerTaskStatusResult {
  ok: boolean;
  httpStatus: 200 | 503;
  code: string | null;
  answer: string;
  task: Record<string, unknown> | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;

/**
 * Read the indexed autonomous ledger first, then the senior job ledger. Database
 * failure is distinct from absence. Never fall back to an in-memory task list or
 * manufacture completion evidence when a persistent read fails.
 */
export async function readOwnerTaskStatus(
  taskId: string,
  readAutonomous: TaskReader,
  readSenior: TaskReader,
): Promise<OwnerTaskStatusResult> {
  try {
    const autonomous = await readAutonomous(taskId);
    const value = autonomous ?? await readSenior(taskId);
    if (value === null) {
      return { ok: true, httpStatus: 200, code: 'TASK_NOT_FOUND', task: null,
        answer: `Task ${taskId} was not found in the autonomous or senior developer ledger. Check the identifier. No new task was started.` };
    }
    const task = record(value);
    const identity = autonomous !== null ? task?.taskId : task?.jobId;
    const state = text(task?.state) ?? text(task?.status);
    if (!task || identity !== taskId || !state) throw new Error('Invalid task identity or state');
    const result = record(task.result);
    const snapshot = {
      taskId, source: autonomous !== null ? 'autonomous' : 'senior_developer', state,
      stage: text(task.stage), updatedAt: text(task.updatedAt),
      commitSha: text(task.commitSha) ?? text(result?.commitSha),
      deploymentId: text(task.deploymentId) ?? text(result?.deploymentId),
      blocker: text(task.blocker) ?? text(task.error),
    };
    return { ok: true, httpStatus: 200, code: null, task: snapshot,
      answer: [
        `Task: ${taskId}`, `Status: ${state}`, `Ledger: ${snapshot.source}`,
        ...(snapshot.stage ? [`Stage: ${snapshot.stage}`] : []),
        ...(snapshot.updatedAt ? [`Updated: ${snapshot.updatedAt}`] : []),
        ...(snapshot.blocker ? [`Blocker: ${snapshot.blocker}`] : []),
        `Commit: ${snapshot.commitSha ?? 'No commit recorded'}`,
        `Deployment: ${snapshot.deploymentId ?? 'No deployment recorded'}`,
      ].join('\n') };
  } catch {
    return { ok: false, httpStatus: 503, code: 'TASK_STATUS_UNAVAILABLE', task: null,
      answer: `The stored status of task ${taskId} could not be read. Retry this status query; it will not start another execution.` };
  }
}
