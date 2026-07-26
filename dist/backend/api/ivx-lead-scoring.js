/**
 * IVX Capital Deployment Platform — Lead Scoring API (owner-only).
 *
 * BLOCK 24. Read-only scoring over the Investor CRM, grounded in live IVX deal
 * markets. Returns every lead with a 0–100 score, a Hot/Warm/Cold category, the
 * per-signal evidence breakdown, and a roll-up summary.
 *
 *   GET /api/ivx/lead-scoring → { ok, result }
 *
 * Owner-only. No fabrication: signals that are not tracked are reported as
 * unavailable and excluded from the score, never invented.
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { runLeadScoring } from '../services/ivx-lead-scoring-engine';
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
export async function handleLeadScoringRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const result = await runLeadScoring();
    return ownerOnlyJson({ ok: true, result });
}
