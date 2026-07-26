/**
 * IVX Gmail OAuth Draft Provider API (owner-only).
 *
 * BLOCK 4. Owner-gated routes for the Gmail OAuth/draft provider. The owner-session
 * preflight is enforced CLIENT-side (the app runs `assertOwnerSessionAccessToken`
 * before any of these POSTs); these handlers enforce the owner guard server-side.
 *
 *   GET  /api/ivx/gmail/status      → owner: connection status (connected/not_connected + details)
 *   POST /api/ivx/gmail/connect     → owner: connect Gmail (requires OAuth credential)
 *   POST /api/ivx/gmail/disconnect  → owner: disconnect Gmail
 *   POST /api/ivx/gmail/refresh     → owner: refresh the Gmail token
 *   POST /api/ivx/gmail/test        → owner: test Gmail draft access
 *   GET  /api/ivx/gmail/drafts      → owner: list created Gmail drafts
 *   POST /api/ivx/gmail/draft       → owner: create a Gmail draft (connected + verified + approved gate)
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { connectGmail, createGmailDraft, disconnectGmail, getGmailProviderStatus, listGmailDrafts, refreshGmailToken, testGmailDraftAccess, } from '../services/ivx-gmail-provider';
export const OPTIONS = () => ownerOnlyOptions();
const VALID_OUTREACH_TYPES = new Set([
    'email_campaign', 'follow_up', 'investor_intro', 'buyer_intro', 'meeting_request', 'deal_update',
]);
function asString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function asBool(value) {
    return value === true || value === 'true' || value === 1 || value === '1';
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
export async function handleGmailStatusRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const status = await getGmailProviderStatus();
    return ownerOnlyJson({ ok: true, status });
}
export async function handleGmailConnectRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const result = await connectGmail();
    return ownerOnlyJson({ ...result }, result.ok ? 200 : 409);
}
export async function handleGmailDisconnectRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const result = await disconnectGmail();
    return ownerOnlyJson({ ...result });
}
export async function handleGmailRefreshRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const result = await refreshGmailToken();
    return ownerOnlyJson({ ...result }, result.ok ? 200 : 409);
}
export async function handleGmailTestRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const result = await testGmailDraftAccess();
    return ownerOnlyJson({ ...result }, result.ok ? 200 : 409);
}
export async function handleGmailDraftsListRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const drafts = await listGmailDrafts();
    return ownerOnlyJson({ ok: true, drafts });
}
export async function handleGmailDraftCreateRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const body = await readJsonBody(request);
    const type = asString(body.type);
    if (!VALID_OUTREACH_TYPES.has(type)) {
        return ownerOnlyJson({ ok: false, error: 'A valid outreach type is required.' }, 400);
    }
    const input = {
        type,
        recipientName: asString(body.recipientName),
        recipientCompany: asString(body.recipientCompany),
        recipientContact: asString(body.recipientContact),
        relatedDeal: asString(body.relatedDeal),
        contextNote: asString(body.contextNote),
        senderName: asString(body.senderName),
        contactVerified: asBool(body.contactVerified),
        ownerApproved: asBool(body.ownerApproved),
        followUpInDays: typeof body.followUpInDays === 'number' ? body.followUpInDays : undefined,
    };
    const result = await createGmailDraft(input);
    if (!result.ok) {
        // Gate blockers are a deliberate 409 (conflict with current state), not a 500.
        return ownerOnlyJson({ ok: false, blocker: result.blocker, error: result.detail }, 409);
    }
    return ownerOnlyJson({ ok: true, draft: result.draft, note: result.note }, 201);
}
