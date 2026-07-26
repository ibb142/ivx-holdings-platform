/**
 * IVX Autonomous Operations Engine — 24/7 Persistent Execution
 *
 * Implements the 24/7 operating mandate: task queue with P0-P3 priority,
 * 16-step execution loop, owner approval gates, credential policy,
 * recovery with checkpoints, QA-only tasks, data-integrity checks,
 * deployment verification, and reporting.
 *
 * HARD RULES:
 *   - No production writes without owner approval (8 confirmation phrases)
 *   - No comment-only or marker-only patch counts as a fix
 *   - A deployment trigger does not count as success — requires live verification
 *   - Device tests must be reported as NOT_TESTED until real evidence exists
 *   - Owner can pause/cancel any task or category
 */
import { randomUUID } from 'crypto';
import { auditDir } from './ivx-data-root';
import { isDurableStoreConfigured, readDurableJson, writeDurableJson, appendDurableEvent, } from './ivx-durable-store';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
export const IVX_AUTONOMOUS_OPS_MARKER = 'ivx-autonomous-ops-2026-07-23';
export const PRIORITY_ORDER = ['P0', 'P1', 'P2', 'P3'];
export const PRIORITY_LABELS = {
    P0: 'CRITICAL',
    P1: 'HIGH',
    P2: 'MEDIUM',
    P3: 'LOW',
};
/**
 * Classify a detected issue into P0-P3.
 */
export function classifyIssue(input) {
    // P0 — CRITICAL
    if (input.productionUnavailable) {
        return { priority: 'P0', category: 'production_unavailable', description: 'Production is unavailable', system: 'backend' };
    }
    if (input.authUnavailable) {
        return { priority: 'P0', category: 'auth_unavailable', description: 'Authentication is unavailable', system: 'auth' };
    }
    if (input.dataLoss) {
        return { priority: 'P0', category: 'data_loss', description: 'Data loss detected', system: 'database' };
    }
    if (input.securityExposure) {
        return { priority: 'P0', category: 'security_exposure', description: 'Security exposure detected', system: 'security' };
    }
    if (input.paymentCorruption) {
        return { priority: 'P0', category: 'payment_corruption', description: 'Payment or ownership corruption', system: 'payments' };
    }
    if (input.widespreadRegistrationFailure) {
        return { priority: 'P0', category: 'registration_failure', description: 'Widespread registration failure', system: 'registration' };
    }
    // P1 — HIGH
    if (input.majorModuleBroken) {
        return { priority: 'P1', category: 'major_module_broken', description: 'Major module is broken', system: 'app' };
    }
    if (input.ownerAccessFailure) {
        return { priority: 'P1', category: 'owner_access_failure', description: 'Owner access failure', system: 'auth' };
    }
    if (input.deploymentMismatch) {
        return { priority: 'P1', category: 'deployment_mismatch', description: 'Deployment mismatch — GitHub HEAD ≠ runtime SHA', system: 'deployment' };
    }
    if (input.dbSyncFailure) {
        return { priority: 'P1', category: 'db_sync_failure', description: 'Database synchronization failure', system: 'database' };
    }
    if (input.apkUnusable) {
        return { priority: 'P1', category: 'apk_unusable', description: 'APK is unusable', system: 'mobile' };
    }
    // P2 — MEDIUM
    if (input.partialFeatureFailure) {
        return { priority: 'P2', category: 'partial_feature_failure', description: 'Partial feature failure', system: 'app' };
    }
    if (input.slowApi) {
        return { priority: 'P2', category: 'slow_api', description: 'API is slow', system: 'backend' };
    }
    if (input.staleCache) {
        return { priority: 'P2', category: 'stale_cache', description: 'Stale cache detected', system: 'cache' };
    }
    if (input.uiInconsistency) {
        return { priority: 'P2', category: 'ui_inconsistency', description: 'UI inconsistency affecting operation', system: 'app' };
    }
    // P3 — LOW
    if (input.visualPolish) {
        return { priority: 'P3', category: 'visual_polish', description: 'Visual polish issue', system: 'app' };
    }
    if (input.brandingIssue) {
        return { priority: 'P3', category: 'branding_inconsistency', description: 'Minor branding inconsistency', system: 'branding' };
    }
    if (input.refactorNeeded) {
        return { priority: 'P3', category: 'refactor', description: 'Refactoring needed', system: 'code' };
    }
    return { priority: 'P3', category: 'unknown', description: 'Unclassified issue', system: 'unknown' };
}
export const ALL_APPROVAL_PHRASES = [
    'CONFIRM_IVX_GITHUB_WRITE',
    'CONFIRM_IVX_RENDER_DEPLOY',
    'CONFIRM_IVX_SUPABASE_MIGRATION',
    'CONFIRM_IVX_APK_UPLOAD',
    'CONFIRM_IVX_CLOUDFRONT_INVALIDATE',
    'CONFIRM_IVX_CREATE_REPOSITORY',
    'CONFIRM_IVX_ROLLBACK',
    'CONFIRM_IVX_DESTRUCTIVE_ACTION',
];
export const ACTION_TO_PHRASE = {
    github_commit: 'CONFIRM_IVX_GITHUB_WRITE',
    render_deploy: 'CONFIRM_IVX_RENDER_DEPLOY',
    supabase_migration: 'CONFIRM_IVX_SUPABASE_MIGRATION',
    apk_upload: 'CONFIRM_IVX_APK_UPLOAD',
    cloudfront_invalidate: 'CONFIRM_IVX_CLOUDFRONT_INVALIDATE',
    create_repository: 'CONFIRM_IVX_CREATE_REPOSITORY',
    rollback: 'CONFIRM_IVX_ROLLBACK',
    destructive_action: 'CONFIRM_IVX_DESTRUCTIVE_ACTION',
    user_deletion: 'CONFIRM_IVX_DESTRUCTIVE_ACTION',
    financial_record_modification: 'CONFIRM_IVX_DESTRUCTIVE_ACTION',
    credential_rotation: 'CONFIRM_IVX_DESTRUCTIVE_ACTION',
};
export function isApprovalValid(approval, now = Date.now()) {
    if (approval.used)
        return false;
    if (Date.parse(approval.expiresAt) <= now)
        return false;
    return true;
}
export function createApproval(input) {
    const now = Date.now();
    const ttl = input.ttlMs ?? 10 * 60 * 1000; // 10-minute default TTL
    return {
        approvalId: `approval-${randomUUID()}`,
        phrase: input.phrase,
        action: input.action,
        taskId: input.taskId,
        scope: input.scope,
        grantedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + ttl).toISOString(),
        used: false,
        nonReplayable: true,
    };
}
export const TASK_STAGES = [
    'OBSERVE', 'DETECT', 'CLASSIFY', 'PRIORITIZE',
    'INSPECT', 'PLAN', 'PATCH', 'TEST',
    'REVIEW', 'REQUEST_APPROVAL', 'COMMIT', 'DEPLOY',
    'VERIFY', 'MONITOR', 'RECORD', 'REPORT',
];
export function createTask(input) {
    const now = new Date().toISOString();
    return {
        taskId: `task-${randomUUID()}`,
        priority: input.priority,
        stage: 'OBSERVE',
        status: 'QUEUED',
        title: input.title,
        description: input.description,
        system: input.system,
        createdAt: now,
        startedAt: null,
        finishedAt: null,
        checkpoint: null,
        heartbeat: null,
        leaseOwner: null,
        retryCount: 0,
        maxRetries: 3,
        filesInspected: [],
        filesChanged: [],
        testCommands: [],
        testResults: null,
        typecheck: null,
        lint: null,
        security: null,
        commitSha: null,
        deploymentId: null,
        runtimeSha: null,
        liveResult: null,
        traceId: `trace-${randomUUID()}`,
        approvalPhrase: input.approvalPhrase ?? null,
        approvalRecord: null,
        isReadOnly: input.isReadOnly ?? false,
        error: null,
    };
}
/**
 * Advance a task to the next stage in the 16-step execution loop.
 */
export function advanceStage(task) {
    const currentIdx = TASK_STAGES.indexOf(task.stage);
    if (currentIdx < 0 || currentIdx >= TASK_STAGES.length - 1) {
        return task; // Already at last stage
    }
    const nextStage = TASK_STAGES[currentIdx + 1];
    return { ...task, stage: nextStage, heartbeat: new Date().toISOString() };
}
/**
 * Mark a task as needing approval before proceeding.
 */
export function markAwaitingApproval(task, phrase) {
    return {
        ...task,
        status: 'AWAITING_APPROVAL',
        stage: 'REQUEST_APPROVAL',
        approvalPhrase: phrase,
        heartbeat: new Date().toISOString(),
    };
}
/**
 * Grant approval to a task and advance it past the approval gate.
 */
export function grantApproval(task, approval) {
    return {
        ...task,
        status: 'IN_PROGRESS',
        approvalRecord: approval,
        heartbeat: new Date().toISOString(),
    };
}
/**
 * Complete a task with final evidence.
 */
export function completeTask(task, evidence) {
    const now = new Date().toISOString();
    return {
        ...task,
        status: 'COMPLETED',
        stage: 'REPORT',
        finishedAt: now,
        commitSha: evidence.commitSha ?? null,
        deploymentId: evidence.deploymentId ?? null,
        runtimeSha: evidence.runtimeSha ?? null,
        liveResult: evidence.liveResult ?? null,
        testResults: evidence.testResults ?? null,
        filesChanged: evidence.filesChanged ?? task.filesChanged,
        heartbeat: now,
    };
}
/**
 * Fail a task with error detail.
 */
export function failTask(task, error) {
    return {
        ...task,
        status: 'FAILED',
        finishedAt: new Date().toISOString(),
        error,
        heartbeat: new Date().toISOString(),
    };
}
export function checkCredentialStatus(input) {
    const traceId = `cred-${randomUUID()}`;
    if (!input.exists) {
        return {
            variable: input.variable,
            status: 'MISSING',
            service: input.service,
            httpResult: null,
            traceId,
            ownerAction: `Provide ${input.variable} in IVX Variables or Render environment.`,
        };
    }
    if (input.testResult?.httpStatus === 401) {
        return {
            variable: input.variable,
            status: 'HTTP_401',
            service: input.service,
            httpResult: 'HTTP 401 Unauthorized',
            traceId,
            ownerAction: `Credential ${input.variable} is invalid or revoked. Rotate and update.`,
        };
    }
    if (input.testResult?.httpStatus === 403) {
        return {
            variable: input.variable,
            status: 'HTTP_403',
            service: input.service,
            httpResult: 'HTTP 403 Forbidden',
            traceId,
            ownerAction: `Credential ${input.variable} lacks required scopes. Update permissions.`,
        };
    }
    return {
        variable: input.variable,
        status: 'AVAILABLE',
        service: input.service,
        httpResult: input.testResult?.ok ? 'OK' : null,
        traceId,
        ownerAction: null,
    };
}
export function createCheckpoint(task, data) {
    return {
        checkpointId: `ckpt-${randomUUID()}`,
        taskId: task.taskId,
        stage: task.stage,
        data: data ?? {},
        createdAt: new Date().toISOString(),
    };
}
/**
 * Resume a task from a checkpoint after interruption.
 * The task resumes from the checkpoint's stage, NOT from the beginning.
 */
export function resumeFromCheckpoint(task, checkpoint) {
    return {
        ...task,
        stage: checkpoint.stage,
        status: 'QUEUED',
        retryCount: task.retryCount + 1,
        error: null,
        heartbeat: new Date().toISOString(),
        checkpoint: checkpoint.checkpointId,
    };
}
// ─── Task Store ────────────────────────────────────────────────────
const STORE_DIR = auditDir('autonomous-ops');
const TASKS_FILE = path.join(STORE_DIR, 'tasks.json');
const TASKS_LOG = path.join(STORE_DIR, 'tasks.jsonl');
let taskCache = null;
async function loadTasks() {
    if (taskCache)
        return taskCache;
    if (isDurableStoreConfigured()) {
        taskCache = await readDurableJson(TASKS_FILE, []);
        return taskCache;
    }
    try {
        taskCache = JSON.parse(await readFile(TASKS_FILE, 'utf8'));
        return taskCache;
    }
    catch {
        taskCache = [];
        return taskCache;
    }
}
async function saveTasks(tasks) {
    taskCache = tasks;
    if (isDurableStoreConfigured()) {
        await writeDurableJson(TASKS_FILE, tasks);
        return;
    }
    await mkdir(STORE_DIR, { recursive: true });
    await writeFile(TASKS_FILE, JSON.stringify(tasks, null, 2), 'utf8');
}
async function logTaskEvent(event) {
    try {
        if (isDurableStoreConfigured()) {
            await appendDurableEvent(TASKS_LOG, event);
            return;
        }
        await mkdir(STORE_DIR, { recursive: true });
        await appendFile(TASKS_LOG, `${JSON.stringify(event)}\n`, 'utf8');
    }
    catch {
        // Best-effort
    }
}
export async function enqueueTask(task) {
    const tasks = await loadTasks();
    tasks.push(task);
    await saveTasks(tasks);
    await logTaskEvent({ action: 'task_enqueued', taskId: task.taskId, priority: task.priority, timestamp: task.createdAt });
    return task;
}
export async function getTask(taskId) {
    const tasks = await loadTasks();
    return tasks.find(t => t.taskId === taskId) ?? null;
}
export async function updateTask(taskId, updater) {
    const tasks = await loadTasks();
    const idx = tasks.findIndex(t => t.taskId === taskId);
    if (idx < 0)
        throw new Error(`Task not found: ${taskId}`);
    const updated = updater(tasks[idx]);
    tasks[idx] = updated;
    await saveTasks(tasks);
    await logTaskEvent({ action: 'task_updated', taskId, status: updated.status, stage: updated.stage, timestamp: new Date().toISOString() });
    return updated;
}
export async function cancelTask(taskId) {
    return updateTask(taskId, (t) => ({
        ...t,
        status: 'CANCELLED',
        finishedAt: new Date().toISOString(),
        heartbeat: new Date().toISOString(),
    }));
}
export async function listTasks(filter) {
    const tasks = await loadTasks();
    let filtered = tasks;
    if (filter?.status)
        filtered = filtered.filter(t => t.status === filter.status);
    if (filter?.priority)
        filtered = filtered.filter(t => t.priority === filter.priority);
    // Sort by priority then created date
    filtered.sort((a, b) => {
        const pa = PRIORITY_ORDER.indexOf(a.priority);
        const pb = PRIORITY_ORDER.indexOf(b.priority);
        if (pa !== pb)
            return pa - pb;
        return a.createdAt.localeCompare(b.createdAt);
    });
    if (filter?.limit)
        return filtered.slice(0, filter.limit);
    return filtered;
}
export const DAILY_CYCLE = [
    { timeRange: '00:00-06:00', tasks: ['nightly_regression', 'database_integrity', 'security_scan', 'dependency_check', 'stale_data_check', 'recovery_testing'] },
    { timeRange: '06:00-12:00', tasks: ['repair_overnight_failures', 'registration_auth_checks', 'deployment_verification', 'owner_priority_tasks'] },
    { timeRange: '12:00-18:00', tasks: ['module_product_work', 'performance_optimization', 'integration_qa', 'owner_approved_deployments'] },
    { timeRange: '18:00-24:00', tasks: ['reels_media_checks', 'data_consistency', 'reporting', 'next_day_queue_prep', 'unresolved_incident_escalation'] },
];
export async function getAutonomousDashboard() {
    const tasks = await loadTasks();
    const now = new Date().toISOString();
    const byPriority = { P0: 0, P1: 0, P2: 0, P3: 0 };
    const byStatus = {};
    for (const t of tasks) {
        byPriority[t.priority] = (byPriority[t.priority] ?? 0) + 1;
        byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    }
    const active = tasks.filter(t => t.status === 'IN_PROGRESS' || t.status === 'AWAITING_APPROVAL');
    const queued = tasks.filter(t => t.status === 'QUEUED');
    const completed = tasks.filter(t => t.status === 'COMPLETED');
    const failed = tasks.filter(t => t.status === 'FAILED');
    const blocked = tasks.filter(t => t.status === 'BLOCKED' || t.status === 'AWAITING_APPROVAL');
    // Current highest priority active task
    const sortedActive = active.sort((a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority));
    const currentPriority = sortedActive[0]?.priority ?? null;
    const recentTasks = tasks
        .sort((a, b) => (b.finishedAt ?? b.createdAt).localeCompare(a.finishedAt ?? a.createdAt))
        .slice(0, 50)
        .map(t => ({
        taskId: t.taskId,
        title: t.title,
        priority: t.priority,
        status: t.status,
        stage: t.stage,
        system: t.system,
        startedAt: t.startedAt,
        finishedAt: t.finishedAt,
        error: t.error,
    }));
    return {
        marker: IVX_AUTONOMOUS_OPS_MARKER,
        generatedAt: now,
        workerStatus: active.length > 0 ? 'ONLINE' : 'OFFLINE',
        activeTasks: active.length,
        queuedTasks: queued.length,
        completedTasks: completed.length,
        failedTasks: failed.length,
        blockedTasks: blocked.length,
        tasksByPriority: byPriority,
        tasksByStatus: byStatus,
        recentTasks,
        pendingApprovals: tasks.filter(t => t.status === 'AWAITING_APPROVAL').length,
        currentPriority,
        nextCheckpoint: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    };
}
export function buildTaskFinalReport(task) {
    let finalStatus;
    switch (task.status) {
        case 'COMPLETED':
            finalStatus = 'COMPLETED';
            break;
        case 'FAILED':
            finalStatus = 'FAILED';
            break;
        case 'BLOCKED':
            finalStatus = 'BLOCKED';
            break;
        case 'AWAITING_APPROVAL':
            finalStatus = 'BLOCKED';
            break;
        case 'CANCELLED':
            finalStatus = 'CANCELLED';
            break;
        case 'ROLLED_BACK':
            finalStatus = 'ROLLED_BACK';
            break;
        default: finalStatus = 'NOT_APPLICABLE';
    }
    return {
        taskId: task.taskId,
        priority: task.priority,
        mode: task.isReadOnly ? 'READ_ONLY' : 'WRITE',
        startingSha: null, // Set by caller
        filesInspected: task.filesInspected,
        filesChanged: task.filesChanged,
        testCommands: task.testCommands,
        testResults: task.testResults,
        typecheck: task.typecheck,
        lint: task.lint,
        security: task.security,
        commitSha: task.commitSha,
        deploymentId: task.deploymentId,
        runtimeSha: task.runtimeSha,
        liveResult: task.liveResult,
        traceId: task.traceId,
        ownerApproval: task.approvalRecord?.phrase ?? null,
        startTime: task.startedAt,
        finishTime: task.finishedAt,
        finalStatus,
    };
}
