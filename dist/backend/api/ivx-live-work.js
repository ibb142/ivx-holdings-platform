/**
 * IVX Live Work API (owner-only).
 *
 * Real-time execution visibility for the tablet (IVX → Live Work) — never a
 * "please wait" placeholder, only live execution evidence:
 *   GET  /api/ivx/live-work/feed            → current task + module + percent,
 *                                             background-agent queue, live logs,
 *                                             proof output, recent completed tasks
 *   POST /api/ivx/live-work/check-supabase  → staged Supabase diagnostic
 *                                             (connection → authentication →
 *                                              query → response → verification →
 *                                              completion), each stage streamed
 *   GET  /api/ivx/live-work/agents          → recent background-agent runs
 *
 * Owner-gated via the same guard as the rest of the IVX developer surface.
 */
import { buildLiveWorkSnapshot } from '../services/ivx-live-work';
import { runTrackedSupabaseCheck } from '../services/ivx-supabase-check';
import { listAgentRuns } from '../services/ivx-agent-activity-store';
import { cancelTask, resumeTask, startTask } from '../services/ivx-task-orchestrator';
import { appendTaskEvent, getTask, getTaskBlocks, listTasks, readTaskEvents, } from '../services/ivx-task-state-store';
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
function readTrimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function taskProgressPercent(task) {
    if (task.totalBlocks <= 0)
        return 0;
    return Math.min(100, Math.round((task.completedBlockIds.length / task.totalBlocks) * 100));
}
/** Owner-readable PASS/FAIL roll-up for a task's current state. */
function taskPassFail(task) {
    if (task.status === 'completed')
        return 'PASS';
    if (task.status === 'failed' || task.status === 'cancelled' || task.status === 'blocked')
        return 'FAIL';
    return 'RUNNING';
}
function serializeLiveWorkTask(task, blocks = []) {
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
        routesTouched: blocks
            .map((b) => (b.validationCommand ?? '').match(/\/api\/[\w/:-]+/g) ?? [])
            .flat(),
        error: task.error,
        blocker: task.lastCrash?.detail ?? task.error ?? null,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        completedAt: task.completedAt,
    };
}
export const OPTIONS = () => ownerOnlyOptions();
async function requireOwner(request) {
    try {
        const owner = await assertIVXOwnerOnly(request);
        if (!owner.userId) {
            return { ok: false, response: ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401) };
        }
        return { ok: true };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'IVX owner authentication required.';
        const status = message.toLowerCase().includes('missing bearer') ? 401 : 403;
        return { ok: false, response: ownerOnlyJson({ ok: false, error: message }, status) };
    }
}
/** GET /api/ivx/live-work/feed */
export async function handleLiveWorkFeedRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    const url = new URL(request.url);
    const logLimit = Number.parseInt(url.searchParams.get('logs') ?? '60', 10) || 60;
    try {
        const snapshot = await buildLiveWorkSnapshot(logLimit);
        return ownerOnlyJson({ ok: true, snapshot });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to build live-work snapshot.' }, 500);
    }
}
/** GET /api/ivx/live-work/agents */
export async function handleLiveWorkAgentsRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    const url = new URL(request.url);
    const limit = Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50;
    try {
        const agents = await listAgentRuns(limit);
        return ownerOnlyJson({ ok: true, agents });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to read agent runs.' }, 500);
    }
}
/** POST /api/ivx/live-work/check-supabase */
export async function handleLiveWorkCheckSupabaseRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    try {
        const result = await runTrackedSupabaseCheck();
        return ownerOnlyJson({ ok: result.ok, check: result });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Supabase check failed.' }, 500);
    }
}
/**
 * GET /api/ivx/live-work/status — owner-gated real-time status roll-up: the
 * current task + module + percent, active background agents, route status, and a
 * PASS/FAIL on the active task. Reuses the live-work snapshot aggregator.
 */
export async function handleLiveWorkStatusRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    try {
        const snapshot = await buildLiveWorkSnapshot(40);
        const current = snapshot.currentTask;
        const passFail = current
            ? current.status === 'completed'
                ? 'PASS'
                : current.status === 'failed' || current.status === 'cancelled'
                    ? 'FAIL'
                    : 'RUNNING'
            : 'IDLE';
        return ownerOnlyJson({
            ok: true,
            status: {
                generatedAt: snapshot.generatedAt,
                summary: snapshot.summary,
                currentTask: current,
                currentModule: current?.currentModule ?? 'Idle',
                progressPercent: current?.progressPercent ?? 0,
                passFail,
                activeAgents: snapshot.activeAgents,
                proofOutput: snapshot.proofOutput,
                counts: snapshot.counts,
                routeStatus: 'GET /api/ivx/live-work/status → 200',
            },
        });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to build live-work status.' }, 500);
    }
}
/** GET /api/ivx/live-work/tasks — owner-gated list of recent live-work tasks. */
export async function handleLiveWorkTasksRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    const url = new URL(request.url);
    const limit = Number.parseInt(url.searchParams.get('limit') ?? '25', 10) || 25;
    try {
        const tasks = await listTasks(Math.max(1, Math.min(100, limit)));
        return ownerOnlyJson({ ok: true, tasks: tasks.map((task) => serializeLiveWorkTask(task)) });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to list tasks.' }, 500);
    }
}
/**
 * GET /api/ivx/live-work/task/:id — owner-gated single task with its blocks
 * (files touched, routes, proof artifacts) and the append-only event log.
 */
export async function handleLiveWorkTaskRequest(request, taskId) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    const id = readTrimmed(taskId);
    if (!id) {
        return ownerOnlyJson({ ok: false, error: 'task id is required.' }, 400);
    }
    try {
        const task = await getTask(id);
        if (!task) {
            return ownerOnlyJson({ ok: false, error: 'task not found.' }, 404);
        }
        const blocks = await getTaskBlocks(id);
        const events = await readTaskEvents(id, 200);
        return ownerOnlyJson({
            ok: true,
            task: serializeLiveWorkTask(task, blocks),
            blocks,
            events,
        });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to read task.' }, 500);
    }
}
function readJsonBody(request) {
    return request
        .json()
        .then((value) => (value && typeof value === 'object' ? value : {}))
        .catch(() => ({}));
}
/**
 * POST /api/ivx/live-work/run — owner-gated. Splits an owner command into a
 * crash-safe block plan and starts it. Code/deploy actions still pass through
 * their own owner-approval gates; this only kicks off the tracked work.
 */
export async function handleLiveWorkRunRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    const body = await readJsonBody(request);
    const command = readTrimmed(body.task) || readTrimmed(body.prompt) || readTrimmed(body.message);
    if (!command) {
        return ownerOnlyJson({ ok: false, error: 'task is required.' }, 400);
    }
    const autoStart = body.autoStart !== false;
    try {
        const { task, blocks } = await startTask(command, { autoStart });
        return ownerOnlyJson({ ok: true, task: serializeLiveWorkTask(task, blocks), blocks, autoStarted: autoStart });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to start task.' }, 500);
    }
}
/**
 * POST /api/ivx/live-work/approve — owner-gated approval gate. Records the owner
 * approval on the task's append-only event log and, if the task is paused/queued,
 * resumes execution. No outreach, email, or deploy is sent automatically — this
 * only authorizes the tracked task to continue.
 */
export async function handleLiveWorkApproveRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    const body = await readJsonBody(request);
    const taskId = readTrimmed(body.taskId) || readTrimmed(body.id);
    if (!taskId) {
        return ownerOnlyJson({ ok: false, error: 'taskId is required.' }, 400);
    }
    try {
        const task = await getTask(taskId);
        if (!task) {
            return ownerOnlyJson({ ok: false, error: 'task not found.' }, 404);
        }
        const note = readTrimmed(body.note);
        await appendTaskEvent(taskId, {
            type: 'OWNER_APPROVED',
            blockId: task.currentBlockId,
            detail: note ? `Owner approved: ${note}` : 'Owner approved continuation.',
        });
        let resumed = task;
        if (task.status === 'paused' || task.status === 'queued' || task.status === 'blocked') {
            resumed = await resumeTask(taskId);
        }
        return ownerOnlyJson({ ok: true, approved: true, task: serializeLiveWorkTask(resumed ?? task) });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to approve task.' }, 500);
    }
}
/** POST /api/ivx/live-work/cancel — owner-gated cancellation of a tracked task. */
export async function handleLiveWorkCancelRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    const body = await readJsonBody(request);
    const taskId = readTrimmed(body.taskId) || readTrimmed(body.id);
    if (!taskId) {
        return ownerOnlyJson({ ok: false, error: 'taskId is required.' }, 400);
    }
    try {
        const task = await cancelTask(taskId);
        if (!task) {
            return ownerOnlyJson({ ok: false, error: 'task not found.' }, 404);
        }
        return ownerOnlyJson({ ok: true, cancelled: true, task: serializeLiveWorkTask(task) });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to cancel task.' }, 500);
    }
}
