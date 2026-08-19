/** IVX Live Work API (owner-only). */
import { buildLiveWorkSnapshot } from '../services/ivx-live-work';
import { runTrackedSupabaseCheck } from '../services/ivx-supabase-check';
import { listAgentRuns } from '../services/ivx-agent-activity-store';
import { cancelTask, resumeTask, startTask } from '../services/ivx-task-orchestrator';
import {
  appendTaskEvent,
  getTask,
  getTaskBlocks,
  listTasks,
  readTaskEvents,
  type IVXTaskBlock,
  type IVXTaskRecord,
} from '../services/ivx-task-state-store';
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';

function readTrimmed(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function taskProgressPercent(task: IVXTaskRecord): number {
  if (task.totalBlocks <= 0) return 0;
  return Math.min(100, Math.round((task.completedBlockIds.length / task.totalBlocks) * 100));
}
function taskPassFail(task: IVXTaskRecord): 'PASS' | 'FAIL' | 'RUNNING' {
  if (task.status === 'completed') return 'PASS';
  if (task.status === 'failed' || task.status === 'cancelled' || task.status === 'blocked') return 'FAIL';
  return 'RUNNING';
}
function serializeLiveWorkTask(task: IVXTaskRecord, blocks: IVXTaskBlock[] = []): Record<string, unknown> {
  return {
    id: task.id,
    title: task.ownerCommand || task.originalTask.slice(0, 80) || task.id,
    status: task.status,
    passFail: taskPassFail(task),
    progressPercent: taskProgressPercent(task),
    totalBlocks: task.totalBlocks,
    completedBlocks: task.completedBlockIds.length,
    failedBlocks: task.failedBlockIds.length,
    blockedBlocks: task.blockedBlockIds.length,
    currentBlockIndex: task.currentBlockIndex,
    currentBlockId: task.currentBlockId,
    deploymentStatus: task.deploymentStatus,
    filesTouched: Array.from(new Set(blocks.flatMap((b) => b.filesInvolved))),
    routesTouched: blocks.map((b) => (b.validationCommand ?? '').match(/\/api\/[\w/:-]+/g) ?? []).flat(),
    error: task.error,
    blocker: task.lastCrash?.detail ?? task.error ?? null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
  };
}

export const OPTIONS = (): Response => ownerOnlyOptions();

async function requireOwner(request: Request): Promise<{ ok: true } | { ok: false; response: Response }> {
  try {
    const owner = await assertIVXOwnerOnly(request);
    if (!owner.userId) return { ok: false, response: ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401) };
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'IVX owner authentication required.';
    const status = message.toLowerCase().includes('missing bearer') ? 401 : 403;
    return { ok: false, response: ownerOnlyJson({ ok: false, error: message }, status) };
  }
}

export async function handleLiveWorkFeedRequest(request: Request): Promise<Response> {
  const auth = await requireOwner(request); if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const logLimit = Number.parseInt(url.searchParams.get('logs') ?? '60', 10) || 60;
  try { return ownerOnlyJson({ ok: true, snapshot: await buildLiveWorkSnapshot(logLimit) }); }
  catch (error) { return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to build live-work snapshot.' }, 500); }
}

/**
 * GET /api/ivx/live-work/agents
 * - ?enterpriseDashboard=1 -> enterprise 112 durable dashboard
 * - ?individualCerts=1     -> 112 role-alignment certificates from durable executions
 * - default                -> legacy background-agent runs
 */
export async function handleLiveWorkAgentsRequest(request: Request): Promise<Response> {
  const auth = await requireOwner(request); if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  if (url.searchParams.get('individualCerts') === '1') {
    const hoursRaw = Number.parseInt(url.searchParams.get('hours') ?? '24', 10);
    const hours = Number.isFinite(hoursRaw) ? Math.max(1, Math.min(720, hoursRaw)) : 24;
    const { buildIndividualRoleCertificates } = await import('../services/ivx-agent-role-certification');
    const report = await buildIndividualRoleCertificates(hours);
    const agentRaw = url.searchParams.get('agent');
    if (agentRaw) {
      const n = Number.parseInt(agentRaw, 10);
      const cert = report.certificates.find((c) => c.agentNumber === n || c.agentId === agentRaw);
      if (!cert) return ownerOnlyJson({ ok: false, error: 'Agent certificate not found.' }, 404);
      return ownerOnlyJson({ ok: true, marker: report.marker, generatedAt: report.generatedAt, certificate: cert });
    }
    return ownerOnlyJson({ ok: true, report });
  }
  if (url.searchParams.get('enterpriseDashboard') === '1') {
    const { handleAutonomousOpsDashboardRequest } = await import('./ivx-autonomous-ops-dashboard');
    return handleAutonomousOpsDashboardRequest(request);
  }
  const limit = Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50;
  try { return ownerOnlyJson({ ok: true, agents: await listAgentRuns(limit) }); }
  catch (error) { return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to read agent runs.' }, 500); }
}

export async function handleLiveWorkCheckSupabaseRequest(request: Request): Promise<Response> {
  const auth = await requireOwner(request); if (!auth.ok) return auth.response;
  try { const result = await runTrackedSupabaseCheck(); return ownerOnlyJson({ ok: result.ok, check: result }); }
  catch (error) { return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Supabase check failed.' }, 500); }
}

export async function handleLiveWorkStatusRequest(request: Request): Promise<Response> {
  const auth = await requireOwner(request); if (!auth.ok) return auth.response;
  try {
    const snapshot = await buildLiveWorkSnapshot(40);
    const current = snapshot.currentTask;
    const passFail = current ? current.status === 'completed' ? 'PASS' : current.status === 'failed' || current.status === 'cancelled' ? 'FAIL' : 'RUNNING' : 'IDLE';
    return ownerOnlyJson({ ok: true, status: { generatedAt: snapshot.generatedAt, summary: snapshot.summary, currentTask: current, currentModule: current?.currentModule ?? 'Idle', progressPercent: current?.progressPercent ?? 0, passFail, activeAgents: snapshot.activeAgents, proofOutput: snapshot.proofOutput, counts: snapshot.counts, routeStatus: 'GET /api/ivx/live-work/status -> 200' } });
  } catch (error) { return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to build live-work status.' }, 500); }
}

export async function handleLiveWorkTasksRequest(request: Request): Promise<Response> {
  const auth = await requireOwner(request); if (!auth.ok) return auth.response;
  const url = new URL(request.url); const limit = Number.parseInt(url.searchParams.get('limit') ?? '25', 10) || 25;
  try { const tasks = await listTasks(Math.max(1, Math.min(100, limit))); return ownerOnlyJson({ ok: true, tasks: tasks.map((task) => serializeLiveWorkTask(task)) }); }
  catch (error) { return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to list tasks.' }, 500); }
}

export async function handleLiveWorkTaskRequest(request: Request, taskId: string): Promise<Response> {
  const auth = await requireOwner(request); if (!auth.ok) return auth.response;
  const id = readTrimmed(taskId); if (!id) return ownerOnlyJson({ ok: false, error: 'task id is required.' }, 400);
  try {
    const task = await getTask(id); if (!task) return ownerOnlyJson({ ok: false, error: 'task not found.' }, 404);
    const blocks = await getTaskBlocks(id); const events = await readTaskEvents(id, 200);
    return ownerOnlyJson({ ok: true, task: serializeLiveWorkTask(task, blocks), blocks, events });
  } catch (error) { return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to read task.' }, 500); }
}

function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  return request.json().then((value) => (value && typeof value === 'object' ? value as Record<string, unknown> : {})).catch(() => ({}));
}

export async function handleLiveWorkRunRequest(request: Request): Promise<Response> {
  const auth = await requireOwner(request); if (!auth.ok) return auth.response;
  const body = await readJsonBody(request); const command = readTrimmed(body.task) || readTrimmed(body.prompt) || readTrimmed(body.message);
  if (!command) return ownerOnlyJson({ ok: false, error: 'task is required.' }, 400);
  const autoStart = body.autoStart !== false;
  try { const { task, blocks } = await startTask(command, { autoStart }); return ownerOnlyJson({ ok: true, task: serializeLiveWorkTask(task, blocks), blocks, autoStarted: autoStart }); }
  catch (error) { return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to start task.' }, 500); }
}

export async function handleLiveWorkApproveRequest(request: Request): Promise<Response> {
  const auth = await requireOwner(request); if (!auth.ok) return auth.response;
  const body = await readJsonBody(request); const taskId = readTrimmed(body.taskId) || readTrimmed(body.id);
  if (!taskId) return ownerOnlyJson({ ok: false, error: 'taskId is required.' }, 400);
  try {
    const task = await getTask(taskId); if (!task) return ownerOnlyJson({ ok: false, error: 'task not found.' }, 404);
    const note = readTrimmed(body.note);
    await appendTaskEvent(taskId, { type: 'OWNER_APPROVED', blockId: task.currentBlockId, detail: note ? `Owner approved: ${note}` : 'Owner approved continuation.' });
    let resumed: IVXTaskRecord | null = task;
    if (task.status === 'paused' || task.status === 'queued' || task.status === 'blocked') resumed = await resumeTask(taskId);
    return ownerOnlyJson({ ok: true, approved: true, task: serializeLiveWorkTask(resumed ?? task) });
  } catch (error) { return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to approve task.' }, 500); }
}

export async function handleLiveWorkCancelRequest(request: Request): Promise<Response> {
  const auth = await requireOwner(request); if (!auth.ok) return auth.response;
  const body = await readJsonBody(request); const taskId = readTrimmed(body.taskId) || readTrimmed(body.id);
  if (!taskId) return ownerOnlyJson({ ok: false, error: 'taskId is required.' }, 400);
  try { const task = await cancelTask(taskId); if (!task) return ownerOnlyJson({ ok: false, error: 'task not found.' }, 404); return ownerOnlyJson({ ok: true, cancelled: true, task: serializeLiveWorkTask(task) }); }
  catch (error) { return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to cancel task.' }, 500); }
}
