/**
 * IVX Execution Trace & Audit API (owner-only) — TASK 3.
 *
 * Read-only retrieval over the durable execution-trace store so every action is
 * traceable across sessions:
 *   GET /api/ivx/execution-trace            → recent traces + roll-up summary
 *   GET /api/ivx/execution-trace/:id        → a single trace by id
 *   GET /api/ivx/execution-trace?requestId=…       → traces for a request
 *   GET /api/ivx/execution-trace?conversationId=…  → traces for a conversation
 *   GET /api/ivx/execution-trace?taskId=…          → traces for a task
 *
 * Owner-gated via the same guard as the rest of the IVX developer surface.
 */
import { listExecutionTraces, getExecutionTrace, getTracesByRequestId, getTracesByConversationId, getTracesByTaskId, summarizeExecutionTraces, } from '../services/ivx-execution-trace-store';
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
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
/** GET /api/ivx/execution-trace (list/filter + summary). */
export async function handleExecutionTraceListRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    const url = new URL(request.url);
    const requestId = url.searchParams.get('requestId');
    const conversationId = url.searchParams.get('conversationId');
    const taskId = url.searchParams.get('taskId');
    const limit = Number.parseInt(url.searchParams.get('limit') ?? '100', 10) || 100;
    try {
        if (requestId) {
            const traces = await getTracesByRequestId(requestId);
            return ownerOnlyJson({ ok: true, filter: { requestId }, count: traces.length, traces });
        }
        if (conversationId) {
            const traces = await getTracesByConversationId(conversationId);
            return ownerOnlyJson({ ok: true, filter: { conversationId }, count: traces.length, traces });
        }
        if (taskId) {
            const traces = await getTracesByTaskId(taskId);
            return ownerOnlyJson({ ok: true, filter: { taskId }, count: traces.length, traces });
        }
        const [traces, summary] = await Promise.all([listExecutionTraces(limit), summarizeExecutionTraces()]);
        return ownerOnlyJson({ ok: true, count: traces.length, summary, traces });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to read execution traces.' }, 500);
    }
}
/** GET /api/ivx/execution-trace/:id (single trace). */
export async function handleExecutionTraceGetRequest(request, id) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    try {
        const trace = await getExecutionTrace(id);
        if (!trace) {
            return ownerOnlyJson({ ok: false, error: `No execution trace found for id ${id}.` }, 404);
        }
        return ownerOnlyJson({ ok: true, trace });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to read execution trace.' }, 500);
    }
}
