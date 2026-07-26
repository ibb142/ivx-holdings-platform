/**
 * IVX Opportunity Intelligence API (owner-only) — Opportunity Engine backend.
 *
 *   GET  /api/ivx/opportunity/dashboard          → ranked opportunities + alerts + research layer
 *   POST /api/ivx/opportunity/scan               → run the engine: generate scored opportunities
 *   GET  /api/ivx/opportunity/opportunities      → list scored opportunities (ranked)
 *   GET  /api/ivx/opportunity/best               → single best opportunity today (acceptance test)
 *   POST /api/ivx/opportunity/:id/status         → set opportunity status (watching/pursuing/dismissed…)
 *   GET  /api/ivx/opportunity/alerts             → list owner alerts
 *   POST /api/ivx/opportunity/alerts/:id/ack     → acknowledge an alert
 *   GET  /api/ivx/opportunity/research           → multi-AI research layer status
 *
 * Owner-only. Never promises guaranteed profit; the engine encodes the legal +
 * risk warnings on every payload.
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { runOpportunityScan, buildResearchLayer } from '../services/ivx-opportunity-engine';
import { buildOpportunityDashboard, selectBestOpportunity } from '../services/ivx-opportunity-dashboard';
import { acknowledgeAlert, listAlerts, listOpportunities, setOpportunityStatus, } from '../services/ivx-opportunity-store';
export const OPTIONS = () => ownerOnlyOptions();
function asString(value) {
    return typeof value === 'string' ? value.trim() : '';
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
export async function handleOpportunityDashboardRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const dashboard = await buildOpportunityDashboard();
    return ownerOnlyJson({ ok: true, dashboard: dashboard });
}
export async function handleOpportunityScanRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const result = await runOpportunityScan();
    return ownerOnlyJson({ ok: true, scan: result });
}
export async function handleOpportunityListRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const opportunities = await listOpportunities();
    return ownerOnlyJson({ ok: true, opportunities });
}
export async function handleOpportunityBestRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    let opportunities = await listOpportunities();
    // If nothing has been scanned yet, run a scan so "best opportunity" is always answerable.
    if (opportunities.length === 0) {
        const scan = await runOpportunityScan();
        opportunities = scan.opportunities;
    }
    const best = selectBestOpportunity(opportunities);
    return ownerOnlyJson({ ok: true, best, research: buildResearchLayer() });
}
export async function handleOpportunityStatusRequest(request, opportunityId) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const body = await readJsonBody(request);
    const status = asString(body.status);
    const updated = await setOpportunityStatus(opportunityId, status);
    if (!updated) {
        return ownerOnlyJson({ ok: false, error: 'Opportunity not found or invalid status.' }, 404);
    }
    return ownerOnlyJson({ ok: true, opportunity: updated });
}
export async function handleOpportunityAlertsRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const alerts = await listAlerts(100);
    return ownerOnlyJson({ ok: true, alerts });
}
export async function handleOpportunityAlertAckRequest(request, alertId) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const updated = await acknowledgeAlert(alertId);
    if (!updated) {
        return ownerOnlyJson({ ok: false, error: 'Alert not found.' }, 404);
    }
    return ownerOnlyJson({ ok: true, alert: updated });
}
export async function handleOpportunityResearchRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    return ownerOnlyJson({ ok: true, research: buildResearchLayer() });
}
