/**
 * IVX Operational Memory — owner-only HTTP routes (Block 23).
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { ensureOperationalMemorySchema, listMemoryByCategory, memoryStats, searchMemory, upsertMemory, } from '../services/operational-memory/vector-memory';
import { runRepoIndex } from '../services/operational-memory/repo-indexer';
import { getOperationalSnapshot } from '../services/operational-memory/operational-adapters';
import { runExecutionLoop, recordRollback } from '../services/operational-memory/execution-loop';
import { getAgentTask, listAgentTasks } from '../services/operational-memory/task-state';
import { OPERATIONAL_MEMORY_MARKER } from '../services/operational-memory/memory-types';
function readTrimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function sanitizeError(error, fallback) {
    const raw = error instanceof Error ? error.message : fallback;
    return raw
        .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, '$1[redacted]')
        .replace(/(apikey[=:]\s*)[A-Za-z0-9._\-]+/gi, '$1[redacted]')
        .slice(0, 320) || fallback;
}
function getErrorStatus(error) {
    const msg = error instanceof Error ? error.message.toLowerCase() : '';
    if (msg.includes('missing bearer token') || msg.includes('invalid or expired'))
        return 401;
    if (msg.includes('privileged ivx access is required'))
        return 403;
    if (msg.includes('required') || msg.includes('not configured'))
        return 503;
    return 500;
}
function errorResponse(error) {
    return ownerOnlyJson({
        ok: false,
        error: sanitizeError(error, 'IVX operational memory route failed.'),
        marker: OPERATIONAL_MEMORY_MARKER,
        timestamp: new Date().toISOString(),
    }, getErrorStatus(error));
}
export function OPTIONS() {
    return ownerOnlyOptions();
}
export async function handleStatus(request) {
    try {
        await assertIVXOwnerOnly(request);
        await ensureOperationalMemorySchema();
        const [stats, snapshot] = await Promise.all([memoryStats(), getOperationalSnapshot()]);
        return ownerOnlyJson({
            ok: true,
            marker: OPERATIONAL_MEMORY_MARKER,
            memory: stats,
            operational: snapshot,
            tables: ['ivx_operational_memory', 'ivx_agent_tasks'],
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        return errorResponse(error);
    }
}
const VALID_CATEGORIES = new Set([
    'architecture', 'deployment', 'incident', 'fix', 'roadmap', 'repo_index', 'task_state', 'note',
]);
export async function handleSearch(request) {
    try {
        await assertIVXOwnerOnly(request);
        const url = new URL(request.url);
        const query = readTrimmed(url.searchParams.get('q'));
        if (!query)
            return ownerOnlyJson({ ok: false, error: 'q is required.', marker: OPERATIONAL_MEMORY_MARKER }, 400);
        const categoryParam = readTrimmed(url.searchParams.get('category'));
        const category = VALID_CATEGORIES.has(categoryParam) ? categoryParam : undefined;
        const limit = Number.parseInt(readTrimmed(url.searchParams.get('limit')), 10) || 8;
        const hits = await searchMemory(query, { category, limit });
        return ownerOnlyJson({ ok: true, marker: OPERATIONAL_MEMORY_MARKER, hits, count: hits.length, timestamp: new Date().toISOString() });
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleList(request) {
    try {
        await assertIVXOwnerOnly(request);
        const url = new URL(request.url);
        const categoryParam = readTrimmed(url.searchParams.get('category'));
        if (!VALID_CATEGORIES.has(categoryParam)) {
            return ownerOnlyJson({ ok: false, error: 'category is required.', marker: OPERATIONAL_MEMORY_MARKER }, 400);
        }
        const limit = Number.parseInt(readTrimmed(url.searchParams.get('limit')), 10) || 25;
        const rows = await listMemoryByCategory(categoryParam, limit);
        return ownerOnlyJson({ ok: true, marker: OPERATIONAL_MEMORY_MARKER, rows, count: rows.length, timestamp: new Date().toISOString() });
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleUpsert(request) {
    try {
        await assertIVXOwnerOnly(request);
        const body = await request.json().catch(() => ({}));
        const category = readTrimmed(body.category);
        const title = readTrimmed(body.title);
        const content = readTrimmed(body.content);
        if (!VALID_CATEGORIES.has(category) || !title || !content) {
            return ownerOnlyJson({ ok: false, error: 'category, title, and content are required.', marker: OPERATIONAL_MEMORY_MARKER }, 400);
        }
        const metadata = (body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)) ? body.metadata : {};
        const row = await upsertMemory({
            category, title, content, metadata,
            source: readTrimmed(body.source) || undefined,
            refId: readTrimmed(body.refId) || undefined,
        });
        return ownerOnlyJson({ ok: true, marker: OPERATIONAL_MEMORY_MARKER, row, timestamp: new Date().toISOString() }, 201);
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleReindex(request) {
    try {
        await assertIVXOwnerOnly(request);
        const body = await request.json().catch(() => ({}));
        const maxFiles = Number(body.maxFiles) || 400;
        const result = await runRepoIndex(maxFiles);
        return ownerOnlyJson({ ok: result.ok, marker: OPERATIONAL_MEMORY_MARKER, result, timestamp: new Date().toISOString() });
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleLoopRun(request) {
    try {
        await assertIVXOwnerOnly(request);
        const body = await request.json().catch(() => ({}));
        const goal = readTrimmed(body.goal);
        if (!goal)
            return ownerOnlyJson({ ok: false, error: 'goal is required.', marker: OPERATIONAL_MEMORY_MARKER }, 400);
        const run = await runExecutionLoop(goal, {
            reindexBeforeRun: body.reindex === true,
            liveProbe: body.liveProbe === true,
        });
        return ownerOnlyJson({
            ok: run.task.status === 'completed',
            marker: OPERATIONAL_MEMORY_MARKER,
            task: run.task,
            rollbackToken: run.rollbackToken,
            snapshotBefore: run.snapshotBefore,
            timestamp: new Date().toISOString(),
        }, 201);
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleTasksList(request) {
    try {
        await assertIVXOwnerOnly(request);
        const url = new URL(request.url);
        const limit = Number.parseInt(readTrimmed(url.searchParams.get('limit')), 10) || 25;
        const rows = await listAgentTasks(limit);
        return ownerOnlyJson({ ok: true, marker: OPERATIONAL_MEMORY_MARKER, rows, count: rows.length, timestamp: new Date().toISOString() });
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleTaskGet(request, taskId) {
    try {
        await assertIVXOwnerOnly(request);
        const row = await getAgentTask(taskId);
        if (!row)
            return ownerOnlyJson({ ok: false, error: 'task not found', marker: OPERATIONAL_MEMORY_MARKER }, 404);
        return ownerOnlyJson({ ok: true, marker: OPERATIONAL_MEMORY_MARKER, row, timestamp: new Date().toISOString() });
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleRollback(request, taskId) {
    try {
        await assertIVXOwnerOnly(request);
        const body = await request.json().catch(() => ({}));
        const reason = readTrimmed(body.reason) || 'Owner-initiated rollback.';
        const row = await recordRollback(taskId, reason);
        if (!row)
            return ownerOnlyJson({ ok: false, error: 'task not found', marker: OPERATIONAL_MEMORY_MARKER }, 404);
        return ownerOnlyJson({ ok: true, marker: OPERATIONAL_MEMORY_MARKER, row, timestamp: new Date().toISOString() });
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleSnapshot(request) {
    try {
        await assertIVXOwnerOnly(request);
        const snap = await getOperationalSnapshot();
        return ownerOnlyJson({ ok: snap.ok, marker: OPERATIONAL_MEMORY_MARKER, snapshot: snap, timestamp: new Date().toISOString() });
    }
    catch (error) {
        return errorResponse(error);
    }
}
