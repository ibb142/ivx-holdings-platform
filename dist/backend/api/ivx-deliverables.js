/**
 * IVX Deliverables API (owner-only) — PHASE 2 (Real Deliverable System).
 *
 * The owner surface for the artifact pipeline — turns report requests into real,
 * downloadable files with full proof, and exposes job status + audit trail +
 * notifications + a download-verification endpoint:
 *
 *   POST /api/ivx/deliverables                 enqueue a PDF/CSV artifact job
 *   GET  /api/ivx/deliverables                 list jobs + roll-up summary
 *   GET  /api/ivx/deliverables/notifications   "artifact ready" feed
 *   GET  /api/ivx/deliverables/:id             single job (status + proof + audit trail)
 *   GET  /api/ivx/deliverables/:id/verify      re-run the download-URL test (proof)
 *
 * Owner-gated via the same guard as the rest of the IVX developer surface.
 * A job is only ever reported COMPLETE once the store has every proof field
 * (uploaded path + size + bucket + signed URL + passing download test).
 */
import { getDeliverable, listDeliverables, listDeliverableNotifications, summarizeDeliverables, updateDeliverableJob, } from '../services/ivx-deliverable-store';
import { enqueueDeliverable } from '../services/ivx-deliverable-pipeline';
import { getStorageConfigStatus, verifyDownload } from '../services/ivx-supabase-storage';
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
function isDeliverableKind(value) {
    return value === 'pdf' || value === 'csv';
}
/** Build a typed deliverable request from a raw request body. */
function parseDeliverableRequest(body) {
    const kind = body.kind;
    if (!isDeliverableKind(kind)) {
        return { ok: false, error: 'Field "kind" must be "pdf" or "csv".' };
    }
    const title = typeof body.title === 'string' && body.title.trim().length > 0 ? body.title.trim() : null;
    if (!title)
        return { ok: false, error: 'Field "title" is required.' };
    const links = {
        requestId: typeof body.requestId === 'string' ? body.requestId : null,
        conversationId: typeof body.conversationId === 'string' ? body.conversationId : null,
        taskId: typeof body.taskId === 'string' ? body.taskId : null,
        signedUrlTtlSeconds: typeof body.signedUrlTtlSeconds === 'number' ? body.signedUrlTtlSeconds : undefined,
    };
    if (kind === 'pdf') {
        const spec = body.spec;
        if (!spec || typeof spec !== 'object') {
            return { ok: false, error: 'PDF deliverable requires a "spec" object { title, subtitle?, meta?, sections[] }.' };
        }
        const sectionsRaw = Array.isArray(spec.sections) ? spec.sections : [];
        const sections = sectionsRaw
            .map((s) => {
            const sec = s;
            const heading = typeof sec.heading === 'string' ? sec.heading : '';
            const bodyLines = Array.isArray(sec.body) ? sec.body.filter((b) => typeof b === 'string') : [];
            return { heading, body: bodyLines };
        })
            .filter((s) => s.heading.length > 0 || s.body.length > 0);
        if (sections.length === 0) {
            return { ok: false, error: 'PDF "spec.sections" must contain at least one section with a heading or body.' };
        }
        return {
            ok: true,
            request: {
                kind: 'pdf',
                title,
                spec: {
                    title: typeof spec.title === 'string' && spec.title.trim() ? spec.title.trim() : title,
                    subtitle: typeof spec.subtitle === 'string' ? spec.subtitle : undefined,
                    meta: typeof spec.meta === 'string' ? spec.meta : undefined,
                    sections,
                },
                ...links,
            },
        };
    }
    // csv
    const rows = Array.isArray(body.rows) ? body.rows.filter((r) => Boolean(r) && typeof r === 'object') : [];
    if (rows.length === 0) {
        return { ok: false, error: 'CSV deliverable requires a non-empty "rows" array of objects.' };
    }
    const columns = Array.isArray(body.columns) ? body.columns.filter((c) => typeof c === 'string') : undefined;
    return { ok: true, request: { kind: 'csv', title, rows, columns, ...links } };
}
/** POST /api/ivx/deliverables — enqueue a real artifact job. */
export async function handleDeliverableCreateRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    let body;
    try {
        body = (await request.json());
    }
    catch {
        return ownerOnlyJson({ ok: false, error: 'Invalid JSON body.' }, 400);
    }
    const storage = getStorageConfigStatus();
    if (!storage.configured) {
        return ownerOnlyJson({ ok: false, error: `Cannot create a deliverable — Supabase Storage is not configured. Missing: ${storage.missing.join(', ')}.`, storage }, 503);
    }
    const parsed = parseDeliverableRequest(body);
    if (!parsed.ok)
        return ownerOnlyJson({ ok: false, error: parsed.error }, 400);
    try {
        const enqueued = await enqueueDeliverable(parsed.request);
        return ownerOnlyJson({ ok: true, deliverable: enqueued, storage: { bucket: storage.bucket, projectHostMasked: storage.projectHostMasked } }, 202);
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to enqueue deliverable.' }, 500);
    }
}
/** GET /api/ivx/deliverables — list jobs + summary. */
export async function handleDeliverableListRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    const url = new URL(request.url);
    const limit = Number.parseInt(url.searchParams.get('limit') ?? '100', 10) || 100;
    try {
        const [deliverables, summary] = await Promise.all([listDeliverables(limit), summarizeDeliverables()]);
        return ownerOnlyJson({ ok: true, count: deliverables.length, summary, storage: getStorageConfigStatus(), deliverables });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to list deliverables.' }, 500);
    }
}
/** GET /api/ivx/deliverables/notifications — artifact-ready feed. */
export async function handleDeliverableNotificationsRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    try {
        const notifications = await listDeliverableNotifications(50);
        return ownerOnlyJson({ ok: true, count: notifications.length, notifications });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to read notifications.' }, 500);
    }
}
/** GET /api/ivx/deliverables/:id — single job with full proof + audit trail. */
export async function handleDeliverableGetRequest(request, id) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    try {
        const deliverable = await getDeliverable(id);
        if (!deliverable)
            return ownerOnlyJson({ ok: false, error: `No deliverable found for id ${id}.` }, 404);
        return ownerOnlyJson({ ok: true, deliverable });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to read deliverable.' }, 500);
    }
}
/** GET /api/ivx/deliverables/:id/verify — re-run the download-URL test (proof). */
export async function handleDeliverableVerifyRequest(request, id) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    try {
        const deliverable = await getDeliverable(id);
        if (!deliverable)
            return ownerOnlyJson({ ok: false, error: `No deliverable found for id ${id}.` }, 404);
        if (!deliverable.signedUrl) {
            return ownerOnlyJson({ ok: false, error: 'Deliverable has no signed URL to verify yet.', status: deliverable.status }, 409);
        }
        const verification = await verifyDownload(deliverable.signedUrl);
        // Persist the latest verification result as an audit-trail event.
        await updateDeliverableJob(id, { downloadVerified: verification.ok, downloadHttpStatus: verification.httpStatus, downloadVerifiedSize: verification.contentLength }, `Download re-verified: ${verification.ok ? 'OK' : 'FAILED'} (HTTP ${verification.httpStatus ?? 'n/a'}).`);
        return ownerOnlyJson({
            ok: verification.ok,
            deliverableId: id,
            bucket: deliverable.bucket,
            storagePath: deliverable.storagePath,
            fileSize: deliverable.fileSize,
            verification,
        });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Download verification failed.' }, 500);
    }
}
