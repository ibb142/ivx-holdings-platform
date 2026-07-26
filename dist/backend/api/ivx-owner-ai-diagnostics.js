/**
 * Owner-only HTTP surface for the permanent owner-AI diagnostics log.
 *
 * - GET  /api/ivx/owner-ai/diagnostics            → list last N entries
 * - GET  /api/ivx/owner-ai/diagnostics/:requestId → single entry
 * - POST /api/ivx/owner-ai/diagnostics/client-event → append frontend stage
 *
 * Never returns message bodies or secrets. Pure lifecycle metadata.
 */
import { getOwnerAIDiagnostic, listOwnerAIDiagnostics, recordOwnerAIDiagnosticStage, } from '../services/ivx-owner-ai-diagnostics-log';
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
const ALLOWED_CLIENT_STAGES = [
    'frontend_request_started',
    'frontend_response_received',
    'frontend_render_ok',
    'frontend_render_failed',
    'frontend_realtime_delivered',
    'frontend_typing_cleared',
    'frontend_error',
];
function getErrorStatus(error) {
    if (error instanceof Error) {
        const msg = error.message.toLowerCase();
        if (msg.includes('missing bearer'))
            return 401;
        if (msg.includes('invalid or expired'))
            return 401;
        if (msg.includes('not allowed') || msg.includes('forbidden'))
            return 403;
    }
    return 500;
}
export function ivxOwnerAIDiagnosticsOptions() {
    return ownerOnlyOptions();
}
export async function handleIVXOwnerAIDiagnosticsListRequest(request) {
    try {
        await assertIVXOwnerOnly(request);
    }
    catch (error) {
        const status = getErrorStatus(error);
        const message = error instanceof Error ? error.message : 'owner verification failed';
        return ownerOnlyJson({ ok: false, error: message }, status);
    }
    try {
        const url = new URL(request.url);
        const limit = Number.parseInt(url.searchParams.get('limit') ?? '50', 10);
        const entries = listOwnerAIDiagnostics(Number.isFinite(limit) ? limit : 50);
        return ownerOnlyJson({ ok: true, count: entries.length, entries });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'unable to list diagnostics';
        return ownerOnlyJson({ ok: false, error: message }, 500);
    }
}
export async function handleIVXOwnerAIDiagnosticsGetRequest(request, requestId) {
    try {
        await assertIVXOwnerOnly(request);
    }
    catch (error) {
        const status = getErrorStatus(error);
        const message = error instanceof Error ? error.message : 'owner verification failed';
        return ownerOnlyJson({ ok: false, error: message }, status);
    }
    const entry = getOwnerAIDiagnostic(requestId);
    if (!entry) {
        return ownerOnlyJson({ ok: false, error: 'not found', requestId }, 404);
    }
    return ownerOnlyJson({ ok: true, entry });
}
export async function handleIVXOwnerAIDiagnosticsClientEventRequest(request) {
    try {
        await assertIVXOwnerOnly(request);
    }
    catch (error) {
        const status = getErrorStatus(error);
        const message = error instanceof Error ? error.message : 'owner verification failed';
        return ownerOnlyJson({ ok: false, error: message }, status);
    }
    let body;
    try {
        body = await request.json().catch(() => null);
    }
    catch {
        body = null;
    }
    if (!body || typeof body !== 'object') {
        return ownerOnlyJson({ ok: false, error: 'invalid body' }, 400);
    }
    const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
    const stageRaw = typeof body.stage === 'string' ? body.stage.trim() : '';
    if (!requestId || !stageRaw) {
        return ownerOnlyJson({ ok: false, error: 'requestId and stage required' }, 400);
    }
    if (!ALLOWED_CLIENT_STAGES.includes(stageRaw)) {
        return ownerOnlyJson({ ok: false, error: `stage not allowed from client: ${stageRaw}` }, 400);
    }
    const conversationId = typeof body.conversationId === 'string' ? body.conversationId : null;
    const detail = body.detail && typeof body.detail === 'object' ? body.detail : null;
    recordOwnerAIDiagnosticStage({
        requestId,
        conversationId,
        stage: stageRaw,
        detail,
    });
    return ownerOnlyJson({ ok: true, requestId, stage: stageRaw });
}
