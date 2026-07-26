/**
 * IVX Capital Deployment Platform — Deal Pipeline seeder API (owner-only).
 *
 * BLOCK 67 (Phase 2). Owner-triggered bridge that turns the REAL published
 * `jv_deals` projects (Casa Rosario, etc.) into Deal Tracking + Capital Pipeline
 * entries so the pipeline modules reflect the real, active opportunities instead
 * of sitting empty. Idempotent — safe to re-run; never fabricates data.
 *
 *   POST /api/ivx/deal-pipeline/seed → seed real jv_deals into the two stores
 *
 * Owner-only. Honest failure (exact missing env) when the authoritative
 * `jv_deals` source is unconfigured/unreachable.
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { seedDealPipelineFromJvDeals } from '../services/ivx-deal-pipeline-seed';
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
export async function handleDealPipelineSeedRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const result = await seedDealPipelineFromJvDeals();
    if (!result.ok) {
        return ownerOnlyJson({
            ok: false,
            error: result.error,
            missingEnv: result.missingEnv,
            marker: result.marker,
        }, result.missingEnv.length > 0 ? 503 : 502);
    }
    return ownerOnlyJson({ ...result, ok: true }, 201);
}
