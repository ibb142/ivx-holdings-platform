/**
 * IVX crash-safe task state store — durable, block-structured, resumable.
 *
 * A large owner task is split into ordered BLOCKS. Each block is executed one at
 * a time and its result is persisted before the next block starts, so a crash,
 * reload, or timeout loses at most the single in-flight block — never the whole
 * task and never the original owner command.
 *
 * Durable layout (survives process restarts):
 *   logs/audit/task-orchestrator/<taskId>/task.json    → task metadata + cursor
 *   logs/audit/task-orchestrator/<taskId>/blocks.json  → full ordered block array
 *   logs/audit/task-orchestrator/<taskId>/events.jsonl → append-only crash/forensics log
 *
 * task.json holds the cursor (`currentBlockIndex`) + roll-ups (completed/failed/
 * blocked ids). blocks.json is rewritten atomically on every block update so the
 * latest status of each block is always on disk. events.jsonl is append-only so a
 * crash mid-write to blocks.json can still be reconstructed/audited.
 */
import { appendFile, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
export const TERMINAL_BLOCK_STATUSES = new Set([
    'BUILT_NOT_DEPLOYED',
    'VERIFIED',
    'BLOCKED',
    'FAILED',
]);
/** True terminal SUCCESS — only VERIFIED counts as a shipped, proven block. */
export const VERIFIED_BLOCK_STATUSES = new Set(['VERIFIED']);
const TASKS_ROOT = path.join(process.cwd(), 'logs', 'audit', 'task-orchestrator');
function nowIso() {
    return new Date().toISOString();
}
function createTaskId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `task-${crypto.randomUUID()}`;
    }
    return `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function createBlockId(taskId, index) {
    return `${taskId}-b${index + 1}`;
}
function sanitizeTaskId(taskId) {
    return taskId.replace(/[^a-zA-Z0-9_-]/g, '');
}
function taskDir(taskId) {
    const safe = sanitizeTaskId(taskId);
    if (!safe) {
        throw new Error('Invalid task id.');
    }
    return path.join(TASKS_ROOT, safe);
}
function taskMetaPath(taskId) {
    return path.join(taskDir(taskId), 'task.json');
}
function taskBlocksPath(taskId) {
    return path.join(taskDir(taskId), 'blocks.json');
}
function taskEventsPath(taskId) {
    return path.join(taskDir(taskId), 'events.jsonl');
}
/** Atomic write: write to a temp file then rename, so a crash can't corrupt the JSON. */
async function atomicWrite(filePath, contents) {
    const tmp = `${filePath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await writeFile(tmp, contents, 'utf8');
    await rename(tmp, filePath);
}
export async function createTask(input) {
    const id = createTaskId();
    const createdAt = nowIso();
    const blocks = input.blocks.map((block, index) => ({
        id: createBlockId(id, index),
        index,
        title: block.title,
        goal: block.goal,
        filesInvolved: block.filesInvolved ?? [],
        status: 'PENDING',
        codeChanges: null,
        codeDiff: null,
        validationCommand: block.validationCommand ?? null,
        testResult: null,
        commitHash: null,
        deploymentStatus: null,
        verification: null,
        blocker: null,
        nextBlockId: index + 1 < input.blocks.length ? createBlockId(id, index + 1) : null,
        attempts: 0,
        error: null,
        createdAt,
        startedAt: null,
        completedAt: null,
    }));
    const task = {
        id,
        ownerCommand: input.ownerCommand,
        originalTask: input.originalTask,
        status: 'queued',
        createdAt,
        updatedAt: createdAt,
        completedAt: null,
        currentBlockIndex: 0,
        currentBlockId: blocks[0]?.id ?? null,
        totalBlocks: blocks.length,
        completedBlockIds: [],
        failedBlockIds: [],
        blockedBlockIds: [],
        deploymentStatus: null,
        error: null,
        lastCrash: null,
        recoveryCount: 0,
    };
    await mkdir(taskDir(id), { recursive: true });
    await atomicWrite(taskMetaPath(id), JSON.stringify(task, null, 2));
    await atomicWrite(taskBlocksPath(id), JSON.stringify(blocks, null, 2));
    await writeFile(taskEventsPath(id), '', 'utf8');
    await appendTaskEvent(id, { type: 'TASK_CREATED', blockId: null, detail: `${blocks.length} blocks planned` });
    return { task, blocks };
}
function normalizeLegacyBlockStatus(block) {
    const status = block.status;
    if (status === 'COMPLETED' || status === 'completed') {
        const hasProof = Boolean(block.commitHash && block.verification?.ok);
        return {
            ...block,
            status: hasProof ? 'VERIFIED' : 'BUILT_NOT_DEPLOYED',
            blocker: block.blocker ?? (hasProof ? null : 'MIGRATED: legacy COMPLETED status — no real commit/deploy/verification proof.'),
        };
    }
    return block;
}
export async function getTask(taskId) {
    try {
        const raw = await readFile(taskMetaPath(taskId), 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed.status === 'completed' && (!parsed.completedAt || parsed.deploymentStatus === null)) {
            // Legacy fake-completed tasks are not terminal successes until verified.
            parsed.status = 'blocked';
            parsed.error = parsed.error ?? 'MIGRATED: legacy completed status — no deployment proof.';
            parsed.completedAt = null;
        }
        return parsed;
    }
    catch {
        return null;
    }
}
export async function getTaskBlocks(taskId) {
    try {
        const raw = await readFile(taskBlocksPath(taskId), 'utf8');
        const parsed = JSON.parse(raw);
        return parsed.map(normalizeLegacyBlockStatus).sort((a, b) => a.index - b.index);
    }
    catch {
        return [];
    }
}
export async function updateTask(taskId, patch) {
    const current = await getTask(taskId);
    if (!current) {
        return null;
    }
    const next = { ...current, ...patch, id: current.id, updatedAt: nowIso() };
    await atomicWrite(taskMetaPath(taskId), JSON.stringify(next, null, 2));
    return next;
}
/**
 * Persist a block update AND advance the task roll-ups/cursor in one durable
 * step. Returns the updated block + task so callers keep an in-memory mirror.
 */
export async function updateTaskBlock(taskId, blockId, patch) {
    const blocks = await getTaskBlocks(taskId);
    const idx = blocks.findIndex((block) => block.id === blockId);
    if (idx < 0) {
        return null;
    }
    const updatedBlock = { ...blocks[idx], ...patch, id: blockId, index: blocks[idx].index };
    blocks[idx] = updatedBlock;
    await atomicWrite(taskBlocksPath(taskId), JSON.stringify(blocks, null, 2));
    // Recompute roll-ups from the authoritative block array so they can never drift.
    const completedBlockIds = blocks.filter((b) => TERMINAL_BLOCK_STATUSES.has(b.status)).map((b) => b.id);
    const failedBlockIds = blocks.filter((b) => b.status === 'FAILED').map((b) => b.id);
    const blockedBlockIds = blocks.filter((b) => b.status === 'BLOCKED').map((b) => b.id);
    const firstUnfinished = blocks.find((b) => !TERMINAL_BLOCK_STATUSES.has(b.status));
    const task = await updateTask(taskId, {
        completedBlockIds,
        failedBlockIds,
        blockedBlockIds,
        currentBlockIndex: firstUnfinished?.index ?? blocks.length,
        currentBlockId: firstUnfinished?.id ?? null,
    });
    if (!task) {
        return null;
    }
    await appendTaskEvent(taskId, {
        type: `BLOCK_${updatedBlock.status}`,
        blockId,
        detail: updatedBlock.blocker ?? updatedBlock.error ?? updatedBlock.title,
    });
    return { task, block: updatedBlock };
}
export async function appendTaskEvent(taskId, input) {
    const event = {
        at: nowIso(),
        type: input.type,
        blockId: input.blockId,
        detail: input.detail,
    };
    try {
        await appendFile(taskEventsPath(taskId), `${JSON.stringify(event)}\n`, 'utf8');
    }
    catch {
        // Forensics logging must never break execution.
    }
}
export async function readTaskEvents(taskId, limit = 200) {
    try {
        const raw = await readFile(taskEventsPath(taskId), 'utf8');
        const events = raw
            .split('\n')
            .filter((line) => line.trim().length > 0)
            .map((line) => JSON.parse(line));
        return events.slice(-Math.min(Math.max(1, limit), 1000));
    }
    catch {
        return [];
    }
}
export async function listTasks(limit = 25) {
    let entries = [];
    try {
        entries = await readdir(TASKS_ROOT);
    }
    catch {
        return [];
    }
    const records = await Promise.all(entries.map((entry) => getTask(entry)));
    return records
        .filter((record) => record !== null)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, Math.min(Math.max(1, limit), 100));
}
/** The first block that is neither terminal, failed, nor blocked — the resume point. */
export function findResumeBlock(blocks) {
    return (blocks.find((b) => !TERMINAL_BLOCK_STATUSES.has(b.status) && b.status !== 'FAILED' && b.status !== 'BLOCKED') ?? null);
}
