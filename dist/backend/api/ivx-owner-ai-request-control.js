/**
 * IVX Owner AI Request Control — idempotency, status, retry, and cancel endpoints.
 *
 * POST   /api/ivx/owner-ai/request                  — idempotent AI request
 * GET    /api/ivx/owner-ai/request/:traceId/status  — query request status
 * POST   /api/ivx/owner-ai/request/:traceId/retry   — retry a failed request
 * POST   /api/ivx/owner-ai/request/:traceId/cancel  — cancel an in-flight request
 *
 * The same idempotency key never creates duplicate AI replies.
 */
import { ownerOnlyJson, ownerOnlyOptions, assertIVXOwnerOnly } from './owner-only';
// In-memory store (persisted to Redis in production via the worker)
const requestStore = new Map();
const idempotencyIndex = new Map(); // idempotencyKey → traceId
const MAX_STORE_SIZE = 1000;
function pruneStore() {
    if (requestStore.size > MAX_STORE_SIZE) {
        const oldestKeys = Array.from(requestStore.keys())
            .slice(0, requestStore.size - MAX_STORE_SIZE);
        for (const key of oldestKeys) {
            const record = requestStore.get(key);
            if (record) {
                idempotencyIndex.delete(record.idempotencyKey);
            }
            requestStore.delete(key);
        }
    }
}
function generateRequestId() {
    return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
function generateTraceId() {
    return `ivx-req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
function generateIdempotencyKey(conversationId, message) {
    let hash = 0;
    const input = `${conversationId}:${message}`;
    for (let i = 0; i < input.length; i++) {
        const char = input.charCodeAt(i);
        hash = ((hash << 5) - hash + char) | 0;
    }
    return `idemp-${Math.abs(hash).toString(36)}-${input.length.toString(36)}`;
}
export function handleIVXOwnerAIRequestControlOptions() {
    return ownerOnlyOptions();
}
/**
 * POST /api/ivx/owner-ai/request
 * Idempotent AI request: if the same idempotency key was already used,
 * return the cached result instead of creating a duplicate.
 */
export async function handleIVXOwnerAIRequestCreate(rawRequest) {
    let authContext;
    try {
        authContext = await assertIVXOwnerOnly(rawRequest);
    }
    catch (authErr) {
        const status = authErr instanceof Error && 'status' in authErr
            ? authErr.status
            : 401;
        return ownerOnlyJson({ error: 'Authentication required' }, status);
    }
    let body;
    try {
        body = await rawRequest.json();
    }
    catch {
        return ownerOnlyJson({ error: 'Invalid JSON body' }, 400);
    }
    if (!body.message || typeof body.message !== 'string' || body.message.trim().length === 0) {
        return ownerOnlyJson({ error: 'message is required' }, 400);
    }
    const conversationId = body.conversationId ?? null;
    const messageId = body.messageId ?? `msg-${Date.now()}`;
    const traceId = body.traceId ?? generateTraceId();
    const idempotencyKey = body.idempotencyKey ?? generateIdempotencyKey(conversationId ?? 'default', body.message);
    // Idempotency check: if this key was already used, return the cached result
    const existingTraceId = idempotencyIndex.get(idempotencyKey);
    if (existingTraceId) {
        const existing = requestStore.get(existingTraceId);
        if (existing && (existing.status === 'completed' || existing.status === 'in_flight')) {
            return ownerOnlyJson({
                traceId: existing.traceId,
                requestId: existing.requestId,
                status: existing.status,
                idempotencyKey: existing.idempotencyKey,
                duplicate: true,
                result: existing.terminalResult,
                message: 'Idempotent replay: returning cached result for this idempotency key.',
            }, 200);
        }
    }
    // Create new request record
    const requestId = generateRequestId();
    const record = {
        traceId,
        requestId,
        conversationId,
        messageId,
        idempotencyKey,
        status: 'pending',
        retryCount: 0,
        providerRequestId: null,
        startedAt: new Date().toISOString(),
        completedAt: null,
        terminalResult: null,
        structuredError: null,
    };
    requestStore.set(traceId, record);
    idempotencyIndex.set(idempotencyKey, traceId);
    pruneStore();
    return ownerOnlyJson({
        traceId,
        requestId,
        status: 'pending',
        idempotencyKey,
        duplicate: false,
        message: 'Request accepted. Use GET /request/:traceId/status to poll.',
    }, 202);
}
/**
 * GET /api/ivx/owner-ai/request/:traceId/status
 * Query the status of a request by traceId.
 */
export async function handleIVXOwnerAIRequestStatus(rawRequest, traceId) {
    try {
        await assertIVXOwnerOnly(rawRequest);
    }
    catch (authErr) {
        const status = authErr instanceof Error && 'status' in authErr
            ? authErr.status
            : 401;
        return ownerOnlyJson({ error: 'Authentication required' }, status);
    }
    const record = requestStore.get(traceId);
    if (!record) {
        return ownerOnlyJson({
            traceId,
            status: 'not_found',
            message: 'No request found for this traceId.',
        }, 404);
    }
    return ownerOnlyJson({
        traceId: record.traceId,
        requestId: record.requestId,
        conversationId: record.conversationId,
        messageId: record.messageId,
        idempotencyKey: record.idempotencyKey,
        status: record.status,
        retryCount: record.retryCount,
        providerRequestId: record.providerRequestId,
        startedAt: record.startedAt,
        completedAt: record.completedAt,
        terminalResult: record.terminalResult,
        structuredError: record.structuredError,
    }, 200);
}
/**
 * POST /api/ivx/owner-ai/request/:traceId/retry
 * Retry a failed request. Increments retry count and resets status.
 */
export async function handleIVXOwnerAIRequestRetry(rawRequest, traceId) {
    try {
        await assertIVXOwnerOnly(rawRequest);
    }
    catch (authErr) {
        const status = authErr instanceof Error && 'status' in authErr
            ? authErr.status
            : 401;
        return ownerOnlyJson({ error: 'Authentication required' }, status);
    }
    const record = requestStore.get(traceId);
    if (!record) {
        return ownerOnlyJson({ error: 'Request not found', traceId }, 404);
    }
    if (record.status === 'in_flight' || record.status === 'pending') {
        return ownerOnlyJson({
            error: 'Request is already in flight. Cancel it first or wait for completion.',
            traceId,
            status: record.status,
        }, 409);
    }
    if (record.status === 'completed') {
        return ownerOnlyJson({
            message: 'Request already completed successfully. Use the cached result.',
            traceId,
            status: record.status,
            terminalResult: record.terminalResult,
        }, 200);
    }
    // Reset for retry
    record.status = 'pending';
    record.retryCount += 1;
    record.completedAt = null;
    record.terminalResult = null;
    record.structuredError = null;
    record.startedAt = new Date().toISOString();
    return ownerOnlyJson({
        traceId: record.traceId,
        requestId: record.requestId,
        status: 'pending',
        retryCount: record.retryCount,
        message: 'Request queued for retry.',
    }, 202);
}
/**
 * POST /api/ivx/owner-ai/request/:traceId/cancel
 * Cancel an in-flight request.
 */
export async function handleIVXOwnerAIRequestCancel(rawRequest, traceId) {
    try {
        await assertIVXOwnerOnly(rawRequest);
    }
    catch (authErr) {
        const status = authErr instanceof Error && 'status' in authErr
            ? authErr.status
            : 401;
        return ownerOnlyJson({ error: 'Authentication required' }, status);
    }
    const record = requestStore.get(traceId);
    if (!record) {
        return ownerOnlyJson({ error: 'Request not found', traceId }, 404);
    }
    if (record.status === 'completed' || record.status === 'cancelled') {
        return ownerOnlyJson({
            message: `Request already in terminal state: ${record.status}`,
            traceId,
            status: record.status,
        }, 200);
    }
    record.status = 'cancelled';
    record.completedAt = new Date().toISOString();
    record.structuredError = {
        code: 'CANCELLED',
        message: 'Request cancelled by client.',
        checkpoint: null,
    };
    return ownerOnlyJson({
        traceId: record.traceId,
        requestId: record.requestId,
        status: 'cancelled',
        message: 'Request cancelled successfully.',
    }, 200);
}
/**
 * Update a request record (called internally by the AI processing pipeline).
 */
export function updateRequestRecord(traceId, updates) {
    const record = requestStore.get(traceId);
    if (!record)
        return;
    Object.assign(record, updates);
    if (updates.status === 'completed' || updates.status === 'failed' || updates.status === 'cancelled') {
        record.completedAt = new Date().toISOString();
    }
}
/**
 * Get a request record by traceId (for internal use).
 */
export function getRequestRecord(traceId) {
    return requestStore.get(traceId) ?? null;
}
