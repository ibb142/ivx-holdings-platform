/**
 * IVX Capital Deployment Platform — Opportunity-to-Investor Matching API (owner-only).
 *
 * BLOCK 25. For every active IVX deal, returns the best-fit CRM contacts per role
 * (investor / buyer / lender / partner) with a Match Score, Evidence, Geography
 * Fit, Capital Fit, Timeline Fit, and Risk Notes.
 *
 *   GET /api/ivx/deal-matching → { ok, result }
 *
 * Owner-only. Relationships are never invented — matches are scored only from
 * evidence on the deal + the CRM record.
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { runDealMatching } from '../services/ivx-deal-matching-engine';
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
export async function handleDealMatchingRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const result = await runDealMatching();
    return ownerOnlyJson({ ok: true, result });
}
