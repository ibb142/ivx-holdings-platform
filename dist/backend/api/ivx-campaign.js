/**
 * IVX 10-Day Buyer / JV / Investor Campaign — report API (owner-only).
 *
 *   GET /api/ivx/campaign/report?windowDays=10 → owner: full campaign report
 *
 * Reads real captured leads only (no fabricated traffic). Owner-gated like the
 * rest of the developer surface.
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { buildCampaignReport, CAMPAIGN_WINDOW_DAYS } from '../services/ivx-campaign-report';
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
function parseWindowDays(request) {
    try {
        const value = new URL(request.url).searchParams.get('windowDays');
        const parsed = value ? Number.parseInt(value, 10) : NaN;
        return Number.isFinite(parsed) && parsed > 0 ? parsed : CAMPAIGN_WINDOW_DAYS;
    }
    catch {
        return CAMPAIGN_WINDOW_DAYS;
    }
}
export async function handleCampaignReportRequest(request) {
    const unauthorized = await requireOwner(request);
    if (unauthorized)
        return unauthorized;
    try {
        const report = await buildCampaignReport(parseWindowDays(request));
        return ownerOnlyJson({ ok: true, report });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Campaign report failed.';
        return ownerOnlyJson({ ok: false, error: `Campaign report failed: ${message}` }, 500);
    }
}
