/**
 * IVX Executive Action Loop API (owner-only) — BLOCK 39.
 *
 * The recommendation → execution → outcome → learning → improved-recommendation
 * loop with durable outcome tracking. Every step writes back into the Unified
 * Executive Memory so Owner AI / CRM AI / Autonomous Mode / Executive Layer share
 * one brain.
 *
 *   GET    /api/ivx/action-loop                 → recent loops + summary
 *   POST   /api/ivx/action-loop                 → record a recommendation (step 1)
 *   GET    /api/ivx/action-loop/learning        → learning report (step 4)
 *   GET    /api/ivx/action-loop/:id             → single loop
 *   POST   /api/ivx/action-loop/:id/execution   → record execution (step 2)
 *   POST   /api/ivx/action-loop/:id/outcome     → record outcome + KPI impact (step 3)
 *
 * Owner-only. Auth failures map to 401/403 (never 500).
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { recordRecommendation, recordExecution, recordOutcome, listActionLoops, getActionLoop, learnFromOutcomes, summarizeActionLoop, } from '../services/ivx-executive-action-loop';
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
export async function handleActionLoopListRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit'));
    const [loops, summary] = await Promise.all([
        listActionLoops(Number.isFinite(limit) && limit > 0 ? limit : 200),
        summarizeActionLoop(),
    ]);
    return ownerOnlyJson({ ok: true, loops, summary });
}
export async function handleActionLoopCreateRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const body = await readJsonBody(request);
    const result = await recordRecommendation(body);
    if (!result.ok)
        return ownerOnlyJson({ ok: false, error: result.error }, 400);
    return ownerOnlyJson({ ok: true, loop: result.loop }, 201);
}
export async function handleActionLoopLearningRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const learning = await learnFromOutcomes();
    return ownerOnlyJson({ ok: true, learning });
}
export async function handleActionLoopGetRequest(request, id) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const loop = await getActionLoop(id);
    if (!loop)
        return ownerOnlyJson({ ok: false, error: 'Action loop not found.' }, 404);
    return ownerOnlyJson({ ok: true, loop });
}
export async function handleActionLoopExecutionRequest(request, id) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const body = await readJsonBody(request);
    const loop = await recordExecution(id, body);
    if (!loop)
        return ownerOnlyJson({ ok: false, error: 'Action loop not found.' }, 404);
    return ownerOnlyJson({ ok: true, loop });
}
export async function handleActionLoopOutcomeRequest(request, id) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const body = await readJsonBody(request);
    const loop = await recordOutcome(id, body);
    if (!loop)
        return ownerOnlyJson({ ok: false, error: 'Action loop not found.' }, 404);
    return ownerOnlyJson({ ok: true, loop });
}
