/**
 * IVX Capital Deployment Platform — Capital Command Center + Best-Investor workflow API (owner-only).
 *
 * BLOCK 27.
 *   GET  /api/ivx/capital-command-center            → owner tablet dashboard snapshot
 *   GET  /api/ivx/capital-command-center/activity   → recent best-investor workflow activity
 *   POST /api/ivx/capital-command-center/best-investor { dealQuery, senderName? }
 *        → runs the full "Find the best investor for Deal X" workflow + returns proof
 *
 * Owner-only. Read-mostly: the workflow's only writes are owner-approval-gated
 * outreach DRAFTS + an activity-ledger entry. Nothing is ever sent automatically,
 * and no relationship/contact is ever fabricated.
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { buildCapitalCommandCenter } from '../services/ivx-capital-command-center';
import { runBestInvestorWorkflow, listWorkflowActivity } from '../services/ivx-best-investor-workflow';
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
        const raw = await request.text();
        if (!raw)
            return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    }
    catch {
        return {};
    }
}
export async function handleCapitalCommandCenterRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const dashboard = await buildCapitalCommandCenter();
    return ownerOnlyJson({ ok: true, dashboard });
}
export async function handleCapitalCommandActivityRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const activity = await listWorkflowActivity(50);
    return ownerOnlyJson({ ok: true, activity });
}
export async function handleBestInvestorWorkflowRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const body = await readJsonBody(request);
    const dealQuery = typeof body.dealQuery === 'string' ? body.dealQuery.trim() : '';
    const senderName = typeof body.senderName === 'string' ? body.senderName.trim() : undefined;
    if (!dealQuery) {
        return ownerOnlyJson({ ok: false, error: 'dealQuery is required (the deal name to find the best investor for).' }, 400);
    }
    const result = await runBestInvestorWorkflow({ dealQuery, senderName });
    return ownerOnlyJson({ ok: true, result });
}
