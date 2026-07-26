/**
 * IVX Capital Deployment Platform — Capital Pipeline API (owner-only).
 *
 * BLOCK 22. Full CRUD over owner-managed capital-pipeline entries:
 *   GET    /api/ivx/capital-pipeline            → list entries (newest first) + summary
 *   POST   /api/ivx/capital-pipeline            → create an entry (name + real source required)
 *   GET    /api/ivx/capital-pipeline/:id        → read one entry
 *   POST   /api/ivx/capital-pipeline/:id        → update an entry (partial)
 *   POST   /api/ivx/capital-pipeline/:id/stage  → move pipeline stage
 *   POST   /api/ivx/capital-pipeline/:id/delete → delete an entry
 *
 * Owner-only. IVX never fabricates capital data — `name` + a real `source` are
 * required on create; public_source / crm_import also require attribution.
 * Remaining gap is computed server-side, never supplied.
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { createPipelineEntry, deletePipelineEntry, getPipelineEntry, listPipelineEntries, setPipelineStage, summarizePipeline, updatePipelineEntry, } from '../services/ivx-capital-pipeline-store';
export const OPTIONS = () => ownerOnlyOptions();
const VALID_SOURCES = new Set([
    'owner_entered', 'submitted_form', 'crm_import', 'public_source', 'verified_deal',
]);
const VALID_STAGE = new Set([
    'lead', 'qualified', 'contacted', 'meeting', 'interested',
    'due_diligence', 'soft_commit', 'hard_commit', 'closed',
]);
const VALID_PARTY = new Set(['investor', 'buyer']);
function asString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function asOptionalAmount(value) {
    if (value === undefined)
        return undefined;
    if (value === null || value === '')
        return null;
    const n = typeof value === 'number' ? value : Number(String(value).replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? n : null;
}
function asOptionalNumber(value) {
    if (value === undefined || value === null)
        return undefined;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : undefined;
}
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
        const text = await request.text();
        if (!text)
            return {};
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    }
    catch {
        return {};
    }
}
/** Map a JSON body to an UpdatePipelineInput, omitting absent fields. */
function bodyToUpdateInput(body) {
    const patch = {};
    if (body.name !== undefined)
        patch.name = asString(body.name);
    if (body.company !== undefined)
        patch.company = asString(body.company);
    if (body.partyType !== undefined && VALID_PARTY.has(asString(body.partyType)))
        patch.partyType = asString(body.partyType);
    if (body.dealName !== undefined)
        patch.dealName = asString(body.dealName);
    if (body.stage !== undefined && VALID_STAGE.has(asString(body.stage)))
        patch.stage = asString(body.stage);
    const requested = asOptionalAmount(body.capitalRequested);
    if (requested !== undefined)
        patch.capitalRequested = requested;
    const committed = asOptionalAmount(body.capitalCommitted);
    if (committed !== undefined)
        patch.capitalCommitted = committed;
    const prob = asOptionalNumber(body.closeProbability);
    if (prob !== undefined)
        patch.closeProbability = prob;
    if (body.expectedCloseDate !== undefined)
        patch.expectedCloseDate = body.expectedCloseDate === null ? null : asString(body.expectedCloseDate);
    if (body.notes !== undefined)
        patch.notes = asString(body.notes);
    if (body.source !== undefined && VALID_SOURCES.has(asString(body.source)))
        patch.source = asString(body.source);
    if (body.sourceDetail !== undefined)
        patch.sourceDetail = asString(body.sourceDetail);
    return patch;
}
export async function handlePipelineListRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const [entries, summary] = await Promise.all([listPipelineEntries(), summarizePipeline()]);
    return ownerOnlyJson({ ok: true, entries, summary });
}
export async function handlePipelineCreateRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const body = await readJsonBody(request);
    const requested = asOptionalAmount(body.capitalRequested);
    const committed = asOptionalAmount(body.capitalCommitted);
    const input = {
        name: asString(body.name),
        source: asString(body.source),
        sourceDetail: asString(body.sourceDetail),
        company: asString(body.company),
        partyType: VALID_PARTY.has(asString(body.partyType)) ? asString(body.partyType) : undefined,
        dealName: asString(body.dealName),
        stage: VALID_STAGE.has(asString(body.stage)) ? asString(body.stage) : undefined,
        capitalRequested: requested === undefined ? null : requested,
        capitalCommitted: committed === undefined ? null : committed,
        closeProbability: asOptionalNumber(body.closeProbability),
        expectedCloseDate: body.expectedCloseDate === null ? null : asString(body.expectedCloseDate) || null,
        notes: asString(body.notes),
    };
    const result = await createPipelineEntry(input);
    if (!result.ok) {
        return ownerOnlyJson({ ok: false, error: result.error }, 400);
    }
    return ownerOnlyJson({ ok: true, entry: result.entry }, 201);
}
export async function handlePipelineGetRequest(request, entryId) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const entry = await getPipelineEntry(entryId);
    if (!entry) {
        return ownerOnlyJson({ ok: false, error: 'Pipeline entry not found.' }, 404);
    }
    return ownerOnlyJson({ ok: true, entry });
}
export async function handlePipelineUpdateRequest(request, entryId) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const body = await readJsonBody(request);
    const updated = await updatePipelineEntry(entryId, bodyToUpdateInput(body));
    if (!updated) {
        return ownerOnlyJson({ ok: false, error: 'Pipeline entry not found.' }, 404);
    }
    return ownerOnlyJson({ ok: true, entry: updated });
}
export async function handlePipelineStageRequest(request, entryId) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const body = await readJsonBody(request);
    const stage = asString(body.stage);
    if (!VALID_STAGE.has(stage)) {
        return ownerOnlyJson({ ok: false, error: 'Invalid stage. Use lead | qualified | contacted | meeting | interested | due_diligence | soft_commit | hard_commit | closed.' }, 400);
    }
    const updated = await setPipelineStage(entryId, stage);
    if (!updated) {
        return ownerOnlyJson({ ok: false, error: 'Pipeline entry not found.' }, 404);
    }
    return ownerOnlyJson({ ok: true, entry: updated });
}
export async function handlePipelineDeleteRequest(request, entryId) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const removed = await deletePipelineEntry(entryId);
    if (!removed) {
        return ownerOnlyJson({ ok: false, error: 'Pipeline entry not found.' }, 404);
    }
    return ownerOnlyJson({ ok: true, deleted: true, id: entryId });
}
