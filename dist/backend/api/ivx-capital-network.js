/**
 * IVX South Florida Luxury Capital Intelligence Network API (owner-only).
 *
 * BLOCK 17 (revised) — the targeted capital-source network backend:
 *   GET  /api/ivx/capital-network/dashboard        → best buyer/investor/developer/partner/market/follow-up + matching
 *   POST /api/ivx/capital-network/scan             → derive prospect profiles from live jv_deals
 *   GET  /api/ivx/capital-network/prospects        → list scored prospect profiles (ranked)
 *   POST /api/ivx/capital-network/:id/status        → set prospect status (researching/contacted/qualified/matched/dismissed)
 *
 * Owner-only. Records are high-probability PROSPECT PROFILES (segments) grounded in
 * IVX's real deals — never fabricated individuals or contact details.
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { runCapitalNetworkScan } from '../services/ivx-capital-network-engine';
import { buildCapitalNetworkDashboard } from '../services/ivx-capital-network-dashboard';
import { buildCapitalOutreachPlan } from '../services/ivx-capital-outreach-engine';
import { getProspect, listProspects, setProspectStatus } from '../services/ivx-capital-network-store';
import { buildProspectActionPlan, buildProspectResearch, buildProspectOutreachDraft, } from '../services/ivx-capital-action-engine';
import { createOutreachMessage } from '../services/ivx-outreach-store';
import { detectConfiguredEmailProvider } from '../services/ivx-email-provider';
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
export async function handleCapitalNetworkDashboardRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const dashboard = await buildCapitalNetworkDashboard();
    return ownerOnlyJson({ ok: true, dashboard: dashboard });
}
export async function handleCapitalNetworkScanRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const result = await runCapitalNetworkScan();
    return ownerOnlyJson({ ok: true, scan: result });
}
export async function handleCapitalNetworkProspectsRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const prospects = await listProspects();
    return ownerOnlyJson({ ok: true, prospects });
}
/**
 * BLOCK 18 — Capital Outreach Intelligence. Builds the evidence-grounded outreach
 * plan (strategy / investor packet / broker intros / partnership targets / 30-day
 * raise plan) over the already-scored capital-network prospects. Owner-only.
 */
export async function handleCapitalOutreachRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const prospects = await listProspects();
    const plan = buildCapitalOutreachPlan(prospects);
    return ownerOnlyJson({ ok: true, outreach: plan });
}
/**
 * BLOCK 93 — prospect action plan: why this prospect / best outreach angle / likely
 * objections / recommended next step / compliance warning / confidence score.
 */
export async function handleCapitalProspectActionPlanRequest(request, prospectId) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const prospect = await getProspect(prospectId);
    if (!prospect) {
        return ownerOnlyJson({ ok: false, error: 'Prospect not found.' }, 404);
    }
    const actionPlan = buildProspectActionPlan(prospect);
    return ownerOnlyJson({ ok: true, actionPlan });
}
/**
 * BLOCK 93 — research: legitimate public sourcing channels labelled by source type.
 * Segment profiles have no named/consented contact, so contactStatus = CONTACT_NOT_VERIFIED.
 */
export async function handleCapitalProspectResearchRequest(request, prospectId) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const prospect = await getProspect(prospectId);
    if (!prospect) {
        return ownerOnlyJson({ ok: false, error: 'Prospect not found.' }, 404);
    }
    const research = buildProspectResearch(prospect);
    return ownerOnlyJson({ ok: true, research });
}
/**
 * BLOCK 93 — outreach draft generation. Always creates an OUTREACH_DRAFT (owner-approval
 * gated by the existing outreach store), grounded only in the prospect segment + matched
 * deal — never a fabricated recipient. Reports whether an email provider is configured;
 * if not, returns the draft + EMAIL_PROVIDER_NOT_CONFIGURED so nothing can be auto-sent.
 */
export async function handleCapitalProspectOutreachDraftRequest(request, prospectId) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const prospect = await getProspect(prospectId);
    if (!prospect) {
        return ownerOnlyJson({ ok: false, error: 'Prospect not found.' }, 404);
    }
    const body = await readJsonBody(request);
    const senderName = asString(body.senderName);
    const draft = buildProspectOutreachDraft(prospect, senderName ? { senderName } : undefined);
    // Persist a real, owner-approval-gated outreach draft (starts as `draft`).
    const created = await createOutreachMessage({
        type: draft.outreachType,
        recipientCompany: prospect.segment,
        relatedDeal: prospect.matchedDealNames[0] ?? '',
        subject: draft.subject,
        body: `${draft.emailBody}\n\n${draft.complianceDisclaimer}`,
        notes: `Capital Network prospect ${prospect.id} (${prospect.type}). Source consented contacts only via the listed public channels.`,
    });
    const provider = detectConfiguredEmailProvider();
    return ownerOnlyJson({
        ok: true,
        draft,
        outreachMessage: created.ok ? created.message : null,
        outreachError: created.ok ? null : created.error,
        emailProvider: provider,
        sendStatus: provider.configured ? 'PROVIDER_CONFIGURED' : 'EMAIL_PROVIDER_NOT_CONFIGURED',
        note: provider.configured
            ? 'Draft created. Approve it in Outreach before sending — IVX never sends without owner approval.'
            : 'OUTREACH_DRAFT created only. EMAIL_PROVIDER_NOT_CONFIGURED — configure a provider (SendGrid / AWS SES / Gmail / backend queue) to enable sending. Nothing is ever sent without owner approval.',
    });
}
export async function handleCapitalNetworkStatusRequest(request, prospectId) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const body = await readJsonBody(request);
    const status = asString(body.status);
    const updated = await setProspectStatus(prospectId, status);
    if (!updated) {
        return ownerOnlyJson({ ok: false, error: 'Prospect not found or invalid status.' }, 404);
    }
    return ownerOnlyJson({ ok: true, prospect: updated });
}
