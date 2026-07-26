/**
 * IVX Business Impact + Daily Operations API (owner-only).
 *
 * One read-only endpoint that returns the full owner Command Center / CEO
 * Briefing / Business Impact payload — the first thing the owner sees:
 * "Here is how IVX helped IVX Holdings in the last 24 hours."
 *
 *   GET /api/ivx/business-impact/dashboard → business outcomes + CEO briefing +
 *                                            daily scorecard + priority tasks +
 *                                            owner tablet feed.
 *
 * Owner-only. Never promises guaranteed profit; the engine encodes the impact
 * disclaimer on the payload.
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { buildBusinessImpactDashboard } from '../services/ivx-business-impact';
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
export async function handleBusinessImpactDashboardRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const dashboard = await buildBusinessImpactDashboard();
    return ownerOnlyJson({ ok: true, dashboard: dashboard });
}
