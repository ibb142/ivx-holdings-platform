/**
 * IVX Unified Executive Memory API (owner-only) — BLOCK 39.
 *
 * The single memory API shared by Owner AI, CRM AI, Autonomous Mode, and the
 * Executive Layer. Durable, cross-session, never fabricates.
 *
 *   GET    /api/ivx/memory                 → recall (query via ?kind&tag&source&status&search&limit) + summary
 *   POST   /api/ivx/memory                 → remember (create/refine a memory)
 *   GET    /api/ivx/memory/summary         → roll-up over the whole store
 *   GET    /api/ivx/memory/:id             → single memory by id
 *   POST   /api/ivx/memory/:id             → update a memory
 *   POST   /api/ivx/memory/:id/forget      → delete a memory
 *
 * Owner-only. Auth failures map to 401/403 (never 500).
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { remember, recall, getMemory, updateMemory, forget, summarizeMemory, } from '../services/ivx-unified-memory-store';
export const OPTIONS = () => ownerOnlyOptions();
async function requireOwner(request) {
    try {
        const owner = await assertIVXOwnerOnly(request);
        if (!owner.userId) {
            return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);
        }
        return null;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'IVX owner authentication failed.';
        const status = /missing bearer/i.test(message) || /invalid or expired/i.test(message) ? 401 : 403;
        return ownerOnlyJson({ ok: false, error: message }, status);
    }
}
async function readJsonBody(request) {
    try {
        const body = (await request.json());
        return body && typeof body === 'object' ? body : {};
    }
    catch {
        return {};
    }
}
function parseRecallQuery(url) {
    const query = {};
    const kind = url.searchParams.get('kind');
    if (kind)
        query.kind = kind;
    const tag = url.searchParams.get('tag');
    if (tag)
        query.tag = tag;
    const source = url.searchParams.get('source');
    if (source)
        query.source = source;
    const status = url.searchParams.get('status');
    if (status)
        query.status = status;
    const search = url.searchParams.get('search');
    if (search)
        query.search = search;
    const limit = Number(url.searchParams.get('limit'));
    if (Number.isFinite(limit) && limit > 0)
        query.limit = limit;
    return query;
}
export async function handleMemoryListRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const url = new URL(request.url);
    const [records, summary] = await Promise.all([recall(parseRecallQuery(url)), summarizeMemory()]);
    return ownerOnlyJson({ ok: true, records, summary });
}
export async function handleMemorySummaryRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const summary = await summarizeMemory();
    return ownerOnlyJson({ ok: true, summary });
}
export async function handleMemoryCreateRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const body = await readJsonBody(request);
    const input = body;
    const result = await remember(input);
    if (!result.ok)
        return ownerOnlyJson({ ok: false, error: result.error }, 400);
    return ownerOnlyJson({ ok: true, record: result.record, refined: result.refined }, result.refined ? 200 : 201);
}
export async function handleMemoryGetRequest(request, id) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const record = await getMemory(id);
    if (!record)
        return ownerOnlyJson({ ok: false, error: 'Memory not found.' }, 404);
    return ownerOnlyJson({ ok: true, record });
}
export async function handleMemoryUpdateRequest(request, id) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const body = await readJsonBody(request);
    const record = await updateMemory(id, body);
    if (!record)
        return ownerOnlyJson({ ok: false, error: 'Memory not found.' }, 404);
    return ownerOnlyJson({ ok: true, record });
}
export async function handleMemoryForgetRequest(request, id) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const removed = await forget(id);
    if (!removed)
        return ownerOnlyJson({ ok: false, error: 'Memory not found.' }, 404);
    return ownerOnlyJson({ ok: true, forgotten: id });
}
