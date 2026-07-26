/**
 * IVX crash-safe task orchestrator API (owner-only).
 *
 * Endpoints:
 *   POST   /api/ivx/tasks                 → split an owner task into blocks + start
 *   GET    /api/ivx/tasks                 → list recent tasks
 *   GET    /api/ivx/tasks/:id             → task status + cursor + roll-ups
 *   GET    /api/ivx/tasks/:id/blocks      → ordered block array (full state)
 *   GET    /api/ivx/tasks/:id/events      → append-only crash/forensics log
 *   GET    /api/ivx/tasks/:id/review      → end-to-end final owner report
 *   POST   /api/ivx/tasks/:id/resume      → resume from the last unfinished block
 *   POST   /api/ivx/tasks/:id/pause       → pause between blocks
 *   POST   /api/ivx/tasks/:id/cancel      → cancel the task
 *
 * The orchestrator executes blocks one at a time in the background, persisting
 * each block's result before the next starts, so these endpoints serve durable
 * progress and resume cleanly across restarts.
 */
import { buildTaskFinalReview, cancelTask, pauseTask, resumeTask, startTask, } from '../services/ivx-task-orchestrator';
import { getTask, getTaskBlocks, listTasks, readTaskEvents, } from '../services/ivx-task-state-store';
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
function readTrimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function progressPercent(task) {
    if (task.totalBlocks <= 0) {
        return 0;
    }
    return Math.min(100, Math.round((task.completedBlockIds.length / task.totalBlocks) * 100));
}
function serializeTask(task) {
    return {
        id: task.id,
        status: task.status,
        ownerCommand: task.ownerCommand,
        originalTask: task.originalTask,
        totalBlocks: task.totalBlocks,
        currentBlockIndex: task.currentBlockIndex,
        currentBlockId: task.currentBlockId,
        completedBlocks: task.completedBlockIds.length,
        failedBlocks: task.failedBlockIds.length,
        blockedBlocks: task.blockedBlockIds.length,
        deploymentStatus: task.deploymentStatus,
        progressPercent: progressPercent(task),
        lastCrash: task.lastCrash,
        recoveryCount: task.recoveryCount,
        error: task.error,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        completedAt: task.completedAt,
    };
}
async function requireOwner(request) {
    const owner = await assertIVXOwnerOnly(request);
    if (!owner.userId) {
        return { ok: false, response: ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401) };
    }
    return { ok: true };
}
export const OPTIONS = () => ownerOnlyOptions();
export async function handleStartTaskRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok) {
        return auth.response;
    }
    let body = {};
    try {
        body = (await request.json());
    }
    catch {
        return ownerOnlyJson({ ok: false, error: 'Invalid JSON body.' }, 400);
    }
    const command = readTrimmed(body.task) || readTrimmed(body.prompt) || readTrimmed(body.message);
    if (!command) {
        return ownerOnlyJson({ ok: false, error: 'task is required.' }, 400);
    }
    const autoStart = body.autoStart !== false;
    const { task, blocks } = await startTask(command, { autoStart });
    return ownerOnlyJson({
        ok: true,
        task: serializeTask(task),
        blocks,
        autoStarted: autoStart,
    });
}
export async function handleListTasksRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok) {
        return auth.response;
    }
    const tasks = await listTasks(25);
    return ownerOnlyJson({ ok: true, tasks: tasks.map(serializeTask) });
}
export async function handleTaskStatusRequest(request, taskId) {
    const auth = await requireOwner(request);
    if (!auth.ok) {
        return auth.response;
    }
    const task = await getTask(taskId);
    if (!task) {
        return ownerOnlyJson({ ok: false, error: 'task not found.' }, 404);
    }
    return ownerOnlyJson({ ok: true, task: serializeTask(task) });
}
export async function handleTaskBlocksRequest(request, taskId) {
    const auth = await requireOwner(request);
    if (!auth.ok) {
        return auth.response;
    }
    const task = await getTask(taskId);
    if (!task) {
        return ownerOnlyJson({ ok: false, error: 'task not found.' }, 404);
    }
    const blocks = await getTaskBlocks(taskId);
    return ownerOnlyJson({ ok: true, task: serializeTask(task), blocks });
}
export async function handleTaskEventsRequest(request, taskId) {
    const auth = await requireOwner(request);
    if (!auth.ok) {
        return auth.response;
    }
    const task = await getTask(taskId);
    if (!task) {
        return ownerOnlyJson({ ok: false, error: 'task not found.' }, 404);
    }
    const url = new URL(request.url);
    const limit = Number.parseInt(url.searchParams.get('limit') ?? '200', 10) || 200;
    const events = await readTaskEvents(taskId, limit);
    return ownerOnlyJson({ ok: true, task: serializeTask(task), events });
}
export async function handleTaskReviewRequest(request, taskId) {
    const auth = await requireOwner(request);
    if (!auth.ok) {
        return auth.response;
    }
    const review = await buildTaskFinalReview(taskId);
    if (!review) {
        return ownerOnlyJson({ ok: false, error: 'task not found.' }, 404);
    }
    return ownerOnlyJson({ ok: true, review });
}
export async function handleResumeTaskRequest(request, taskId) {
    const auth = await requireOwner(request);
    if (!auth.ok) {
        return auth.response;
    }
    const task = await resumeTask(taskId);
    if (!task) {
        return ownerOnlyJson({ ok: false, error: 'task not found.' }, 404);
    }
    return ownerOnlyJson({ ok: true, task: serializeTask(task) });
}
export async function handlePauseTaskRequest(request, taskId) {
    const auth = await requireOwner(request);
    if (!auth.ok) {
        return auth.response;
    }
    const task = await pauseTask(taskId);
    if (!task) {
        return ownerOnlyJson({ ok: false, error: 'task not found.' }, 404);
    }
    return ownerOnlyJson({ ok: true, task: serializeTask(task) });
}
export async function handleCancelTaskRequest(request, taskId) {
    const auth = await requireOwner(request);
    if (!auth.ok) {
        return auth.response;
    }
    const task = await cancelTask(taskId);
    if (!task) {
        return ownerOnlyJson({ ok: false, error: 'task not found.' }, 404);
    }
    return ownerOnlyJson({ ok: true, task: serializeTask(task) });
}
