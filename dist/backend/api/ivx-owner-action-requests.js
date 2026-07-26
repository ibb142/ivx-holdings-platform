/**
 * IVX Owner Action Request System — autonomous owner notification + task tracking.
 *
 * When autonomous execution hits a real, verified blocker, this system:
 *   1. Creates an Owner Action Request record (durable, resumable)
 *   2. Sends an IVX IA chat message to the owner room
 *   3. Exposes endpoints for resume/verify/status
 *
 * Endpoints (all public — the autonomous system itself calls these):
 *   POST /api/ivx/owner-action/create    → create a new action request
 *   GET  /api/ivx/owner-action/list      → list all pending requests
 *   GET  /api/ivx/owner-action/:traceId  → get single request by trace ID
 *   POST /api/ivx/owner-action/:traceId/verify → verify owner action completed
 *   POST /api/ivx/owner-action/:traceId/notify → re-send notification
 *
 * Notification payload contains:
 *   task name, exact blocker, exact error, provider/module,
 *   action required, why autonomous cannot complete, safe instructions,
 *   deadline/urgency, resume deep link, execution trace ID
 */
import { appendFile, mkdir, readFile, readdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
// ---------------------------------------------------------------------------
// Durable file-based store (survives process restarts)
// ---------------------------------------------------------------------------
const ACTIONS_ROOT = path.join(process.cwd(), 'logs', 'audit', 'owner-action-requests');
function nowIso() {
    return new Date().toISOString();
}
function generateTraceId() {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.random().toString(16).slice(2, 8);
    return `IVX-OAR-${date}-${rand}`;
}
function generateTaskId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `task-${crypto.randomUUID()}`;
    }
    return `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function sanitizeId(id) {
    return id.replace(/[^a-zA-Z0-9_-]/g, '');
}
function actionDir(traceId) {
    const safe = sanitizeId(traceId);
    if (!safe)
        throw new Error('Invalid trace ID.');
    return path.join(ACTIONS_ROOT, safe);
}
function actionPath(traceId) {
    return path.join(actionDir(traceId), 'action.json');
}
function eventsPath(traceId) {
    return path.join(actionDir(traceId), 'events.jsonl');
}
async function ensureDir(dir) {
    await mkdir(dir, { recursive: true });
}
async function writeAction(action) {
    const dir = actionDir(action.traceId);
    await ensureDir(dir);
    const tmp = actionPath(action.traceId) + '.tmp';
    await writeFile(tmp, JSON.stringify(action, null, 2), 'utf-8');
    await rename(tmp, actionPath(action.traceId));
}
async function appendEvent(traceId, event) {
    const dir = actionDir(traceId);
    await ensureDir(dir);
    await appendFile(eventsPath(traceId), JSON.stringify(event) + '\n', 'utf-8');
}
export async function readAction(traceId) {
    try {
        const raw = await readFile(actionPath(traceId), 'utf-8');
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
export async function listActions() {
    try {
        const entries = await readdir(ACTIONS_ROOT, { withFileTypes: true });
        const actions = [];
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            const action = await readAction(entry.name);
            if (action)
                actions.push(action);
        }
        return actions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    catch {
        return [];
    }
}
export async function createOwnerActionRequest(input) {
    const traceId = generateTraceId();
    const taskId = generateTaskId();
    const now = nowIso();
    const action = {
        traceId,
        taskId,
        taskName: input.taskName,
        status: 'OWNER_ACTION_REQUIRED',
        currentStep: input.currentStep,
        lastSuccessfulStep: input.lastSuccessfulStep ?? null,
        retryCount: 0,
        blockerType: input.blockerType,
        blockerMessage: input.blockerMessage,
        ownerActionRequired: true,
        provider: input.provider ?? null,
        module: input.module ?? null,
        exactError: input.exactError ?? null,
        actionRequired: input.actionRequired,
        whyAutonomousCannotComplete: input.whyAutonomousCannotComplete,
        safeInstructions: input.safeInstructions ?? null,
        deadline: input.deadline ?? null,
        urgency: input.urgency ?? 'high',
        resumeDeepLink: `https://ivxholding.com/admin?traceId=${traceId}`,
        repository: input.repository ?? 'ibb142/ivx-holdings-platform',
        branch: input.branch ?? 'main',
        commitSha: input.commitSha ?? null,
        deploymentId: input.deploymentId ?? null,
        notificationsSent: 0,
        lastNotificationAt: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
    };
    await writeAction(action);
    await appendEvent(traceId, { at: now, type: 'CREATED', detail: `Owner action request created for: ${input.taskName}` });
    return action;
}
// ---------------------------------------------------------------------------
// Notification: send IVX IA chat message
// ---------------------------------------------------------------------------
export async function sendOwnerNotification(action) {
    const message = formatOwnerNotificationMessage(action);
    try {
        // Send via the public chat endpoint (same room the owner sees in IVX IA)
        const res = await fetch('https://api.ivxholding.com/api/public/send-message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                roomId: 'main-room',
                username: 'IVX Autonomous System',
                text: message,
                source: 'system',
            }),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            return { ok: false, error: `Chat notification failed: HTTP ${res.status} ${body.slice(0, 200)}` };
        }
        // Update notification count
        const updated = {
            ...action,
            notificationsSent: action.notificationsSent + 1,
            lastNotificationAt: nowIso(),
            updatedAt: nowIso(),
        };
        await writeAction(updated);
        await appendEvent(action.traceId, { at: nowIso(), type: 'NOTIFICATION_SENT', detail: `Notification #${updated.notificationsSent} sent via IVX IA chat` });
        return { ok: true };
    }
    catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Unknown notification error' };
    }
}
function formatOwnerNotificationMessage(action) {
    const lines = [
        `OWNER ACTION REQUIRED`,
        ``,
        `Task: ${action.taskName}`,
        `Blocker: ${action.blockerMessage ?? 'Unknown blocker'}`,
        `Provider/Module: ${[action.provider, action.module].filter(Boolean).join(' / ') || 'N/A'}`,
        `Exact Error: ${action.exactError ?? 'See blocker details'}`,
        ``,
        `Action Required: ${action.actionRequired}`,
        `Why autonomous cannot complete: ${action.whyAutonomousCannotComplete}`,
        ``,
        action.safeInstructions ? `Safe Instructions: ${action.safeInstructions}` : '',
        action.deadline ? `Deadline: ${action.deadline}` : '',
        `Urgency: ${action.urgency.toUpperCase()}`,
        ``,
        `Trace ID: ${action.traceId}`,
        `Resume: ${action.resumeDeepLink ?? 'N/A'}`,
        ``,
        `Execution will resume automatically after verification.`,
    ];
    return lines.filter(l => l !== '').join('\n');
}
// ---------------------------------------------------------------------------
// Verify: check if owner action is completed
// ---------------------------------------------------------------------------
export async function verifyOwnerAction(traceId, verificationFn) {
    const action = await readAction(traceId);
    if (!action) {
        return { ok: false, action: null, resolved: false, detail: 'Action request not found.' };
    }
    const result = await verificationFn();
    const now = nowIso();
    if (result.resolved) {
        const updated = {
            ...action,
            status: 'RUNNING',
            ownerActionRequired: false,
            blockerType: null,
            blockerMessage: null,
            updatedAt: now,
        };
        await writeAction(updated);
        await appendEvent(traceId, { at: now, type: 'OWNER_ACTION_RESOLVED', detail: result.detail });
        return { ok: true, action: updated, resolved: true, detail: result.detail };
    }
    await appendEvent(traceId, { at: now, type: 'VERIFICATION_CHECKED', detail: `Not yet resolved: ${result.detail}` });
    return { ok: true, action, resolved: false, detail: result.detail };
}
// ---------------------------------------------------------------------------
// Update status
// ---------------------------------------------------------------------------
export async function updateActionStatus(traceId, status, detail, extraUpdates) {
    const action = await readAction(traceId);
    if (!action)
        return null;
    const now = nowIso();
    const updated = {
        ...action,
        status,
        updatedAt: now,
        completedAt: status === 'COMPLETED' || status === 'FAILED' ? now : null,
        ...extraUpdates,
    };
    await writeAction(updated);
    await appendEvent(traceId, { at: now, type: `STATUS_${status}`, detail });
    return updated;
}
// ---------------------------------------------------------------------------
// HTTP Handlers
// ---------------------------------------------------------------------------
function jsonResponse(payload, status = 200) {
    return Response.json(payload, {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://ivxholding.com', 'Vary': 'Origin' },
    });
}
export function ownerActionOptions() {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': 'https://ivxholding.com',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
    });
}
export async function handleCreateOwnerActionRequest(req) {
    try {
        const body = await req.json().catch(() => ({}));
        const taskName = typeof body.taskName === 'string' && body.taskName.trim() ? body.taskName.trim() : null;
        if (!taskName) {
            return jsonResponse({ ok: false, error: 'Field "taskName" is required.' }, 400);
        }
        const blockerMessage = typeof body.blockerMessage === 'string' ? body.blockerMessage.trim() : null;
        if (!blockerMessage) {
            return jsonResponse({ ok: false, error: 'Field "blockerMessage" is required.' }, 400);
        }
        const actionRequired = typeof body.actionRequired === 'string' ? body.actionRequired.trim() : null;
        if (!actionRequired) {
            return jsonResponse({ ok: false, error: 'Field "actionRequired" is required.' }, 400);
        }
        const whyAutonomousCannotComplete = typeof body.whyAutonomousCannotComplete === 'string' ? body.whyAutonomousCannotComplete.trim() : null;
        if (!whyAutonomousCannotComplete) {
            return jsonResponse({ ok: false, error: 'Field "whyAutonomousCannotComplete" is required.' }, 400);
        }
        const action = await createOwnerActionRequest({
            taskName,
            currentStep: typeof body.currentStep === 'string' ? body.currentStep.trim() : 'unknown',
            blockerType: typeof body.blockerType === 'string' ? body.blockerType.trim() : 'unknown',
            blockerMessage,
            provider: typeof body.provider === 'string' ? body.provider.trim() : null,
            module: typeof body.module === 'string' ? body.module.trim() : null,
            exactError: typeof body.exactError === 'string' ? body.exactError.trim() : null,
            actionRequired,
            whyAutonomousCannotComplete,
            safeInstructions: typeof body.safeInstructions === 'string' ? body.safeInstructions.trim() : null,
            deadline: typeof body.deadline === 'string' ? body.deadline.trim() : null,
            urgency: body.urgency === 'low' || body.urgency === 'medium' || body.urgency === 'high' || body.urgency === 'critical' ? body.urgency : 'high',
            repository: typeof body.repository === 'string' ? body.repository.trim() : undefined,
            branch: typeof body.branch === 'string' ? body.branch.trim() : undefined,
            commitSha: typeof body.commitSha === 'string' ? body.commitSha.trim() : null,
            deploymentId: typeof body.deploymentId === 'string' ? body.deploymentId.trim() : null,
            lastSuccessfulStep: typeof body.lastSuccessfulStep === 'string' ? body.lastSuccessfulStep.trim() : null,
        });
        // Auto-send notification
        const notifResult = await sendOwnerNotification(action);
        return jsonResponse({
            ok: true,
            action,
            notificationSent: notifResult.ok,
            notificationError: notifResult.error ?? null,
            timestamp: nowIso(),
        });
    }
    catch (err) {
        return jsonResponse({
            ok: false,
            error: err instanceof Error ? err.message : 'Failed to create owner action request.',
            timestamp: nowIso(),
        }, 500);
    }
}
export async function handleListOwnerActionRequests() {
    try {
        const actions = await listActions();
        const pending = actions.filter(a => a.ownerActionRequired && a.status !== 'COMPLETED' && a.status !== 'FAILED');
        return jsonResponse({
            ok: true,
            total: actions.length,
            pending: pending.length,
            actions,
            timestamp: nowIso(),
        });
    }
    catch (err) {
        return jsonResponse({
            ok: false,
            error: err instanceof Error ? err.message : 'Failed to list owner action requests.',
            timestamp: nowIso(),
        }, 500);
    }
}
export async function handleGetOwnerActionRequest(req, traceId) {
    try {
        const action = await readAction(traceId);
        if (!action) {
            return jsonResponse({ ok: false, error: 'Action request not found.', traceId }, 404);
        }
        return jsonResponse({ ok: true, action, timestamp: nowIso() });
    }
    catch (err) {
        return jsonResponse({
            ok: false,
            error: err instanceof Error ? err.message : 'Failed to read action request.',
            timestamp: nowIso(),
        }, 500);
    }
}
export async function handleVerifyOwnerAction(req, traceId) {
    try {
        const body = await req.json().catch(() => ({}));
        const verifyType = typeof body.verifyType === 'string' ? body.verifyType.trim() : 'custom';
        // Built-in verification for common blocker types
        if (verifyType === 'github_sync') {
            // Check if GitHub HEAD matches the expected commit
            const expectedSha = typeof body.expectedSha === 'string' ? body.expectedSha.trim() : null;
            const repo = typeof body.repo === 'string' ? body.repo.trim() : 'ibb142/ivx-holdings-platform';
            const result = await verifyOwnerAction(traceId, async () => {
                try {
                    const res = await fetch(`https://api.github.com/repos/${repo}/commits?per_page=1`);
                    if (!res.ok)
                        return { resolved: false, detail: `GitHub API returned HTTP ${res.status}` };
                    const data = await res.json();
                    if (!Array.isArray(data) || data.length === 0)
                        return { resolved: false, detail: 'No commits found on GitHub' };
                    const headSha = data[0].sha;
                    if (expectedSha && headSha.startsWith(expectedSha.slice(0, 8))) {
                        return { resolved: true, detail: `GitHub HEAD ${headSha.slice(0, 8)} matches expected ${expectedSha.slice(0, 8)}` };
                    }
                    if (!expectedSha && headSha !== '8ce470649b83369bf124442b6bdbdb0009f4727c') {
                        return { resolved: true, detail: `GitHub HEAD updated to ${headSha.slice(0, 8)} (was 8ce47064)` };
                    }
                    return { resolved: false, detail: `GitHub HEAD is ${headSha.slice(0, 8)}, expected newer than 8ce47064` };
                }
                catch (e) {
                    return { resolved: false, detail: `GitHub check failed: ${e instanceof Error ? e.message : 'unknown'}` };
                }
            });
            return jsonResponse({
                ok: result.ok,
                resolved: result.resolved,
                detail: result.detail,
                action: result.action,
                timestamp: nowIso(),
            });
        }
        // Custom verification
        const resolved = body.resolved === true;
        const detail = typeof body.detail === 'string' ? body.detail.trim() : 'Manual verification';
        const result = await verifyOwnerAction(traceId, async () => ({ resolved, detail }));
        // If resolved, trigger notification
        if (result.resolved && result.action) {
            await sendOwnerNotification({
                ...result.action,
                status: 'RUNNING',
                taskName: `${result.action.taskName} — RESUMED`,
                actionRequired: 'No action needed — execution has resumed automatically.',
                whyAutonomousCannotComplete: 'Blocker has been resolved.',
            });
        }
        return jsonResponse({
            ok: result.ok,
            resolved: result.resolved,
            detail: result.detail,
            action: result.action,
            timestamp: nowIso(),
        });
    }
    catch (err) {
        return jsonResponse({
            ok: false,
            error: err instanceof Error ? err.message : 'Verification failed.',
            timestamp: nowIso(),
        }, 500);
    }
}
export async function handleNotifyOwnerAction(req, traceId) {
    try {
        const action = await readAction(traceId);
        if (!action) {
            return jsonResponse({ ok: false, error: 'Action request not found.', traceId }, 404);
        }
        const notifResult = await sendOwnerNotification(action);
        return jsonResponse({
            ok: notifResult.ok,
            error: notifResult.error ?? null,
            notificationsSent: action.notificationsSent + 1,
            timestamp: nowIso(),
        });
    }
    catch (err) {
        return jsonResponse({
            ok: false,
            error: err instanceof Error ? err.message : 'Notification failed.',
            timestamp: nowIso(),
        }, 500);
    }
}
export async function handleUpdateOwnerActionStatus(req, traceId) {
    try {
        const body = await req.json().catch(() => ({}));
        const status = typeof body.status === 'string' ? body.status : null;
        if (!status) {
            return jsonResponse({ ok: false, error: 'Field "status" is required.' }, 400);
        }
        const detail = typeof body.detail === 'string' ? body.detail.trim() : `Status updated to ${status}`;
        const extra = {};
        if (typeof body.commitSha === 'string')
            extra.commitSha = body.commitSha;
        if (typeof body.deploymentId === 'string')
            extra.deploymentId = body.deploymentId;
        if (typeof body.currentStep === 'string')
            extra.currentStep = body.currentStep;
        if (typeof body.retryCount === 'number')
            extra.retryCount = body.retryCount;
        const updated = await updateActionStatus(traceId, status, detail, extra);
        if (!updated) {
            return jsonResponse({ ok: false, error: 'Action request not found.', traceId }, 404);
        }
        return jsonResponse({ ok: true, action: updated, timestamp: nowIso() });
    }
    catch (err) {
        return jsonResponse({
            ok: false,
            error: err instanceof Error ? err.message : 'Update failed.',
            timestamp: nowIso(),
        }, 500);
    }
}
