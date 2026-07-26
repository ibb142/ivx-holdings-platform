/**
 * IVX Power Tools Core — dashboard aggregator + Gmail-first outreach draft gate (owner-only).
 *
 * BLOCK 98. One read-only roll-up over the execution platform so the owner sees, at a glance:
 * leads captured / hot / qualified, drafts created, emails sent vs drafts saved, follow-ups due,
 * meetings requested, data rooms sent, LOIs requested, closed deals, plus deal-packet readiness
 * and the live email-provider state (Gmail-first).
 *
 * Gmail-first draft gate (`prepareOutreachDraft`): IVX always DRAFTS the message deterministically,
 * then reports the send path — a configured provider (Gmail preferred) requires owner approval before
 * sending; with no provider it returns EMAIL_PROVIDER_NOT_CONFIGURED and the draft is saved only.
 * It NEVER sends and NEVER allows a send to an unverified contact.
 */
import { buildOutreachDraft } from './ivx-outreach-drafter';
import { detectConfiguredEmailProvider } from './ivx-email-provider';
import { summarizeLeads } from './ivx-lead-capture-store';
import { summarizeDealPackets } from './ivx-deal-packet-store';
import { summarizeOutreach } from './ivx-outreach-store';
export const IVX_POWER_TOOLS_MARKER = 'ivx-power-tools-2026-06-03';
/** Build the unified Power Tools dashboard from every live subsystem. */
export async function buildPowerToolsDashboard() {
    const [leads, outreach, packets] = await Promise.all([
        summarizeLeads(),
        summarizeOutreach(),
        summarizeDealPackets(),
    ]);
    const emailProvider = detectConfiguredEmailProvider();
    return {
        marker: IVX_POWER_TOOLS_MARKER,
        generatedAt: new Date().toISOString(),
        counts: {
            leadsCaptured: leads.total,
            hotLeads: leads.hot,
            qualifiedLeads: leads.qualified,
            draftsCreated: outreach.total,
            emailsSent: outreach.sent,
            draftsSaved: outreach.drafts + outreach.pendingApproval,
            followUpsDue: leads.followUpsDue,
            meetingsRequested: leads.byStage.meeting_requested,
            dataRoomsSent: leads.byStage.data_room_sent,
            loisRequested: leads.byStage.loi_requested,
            closedDeals: leads.byStage.closed,
        },
        leads,
        outreach,
        packets,
        emailProvider,
        note: emailProvider.configured
            ? `Send path available via ${emailProvider.provider}. Owner approval + a verified contact are still required before any message is sent.`
            : 'EMAIL_PROVIDER_NOT_CONFIGURED — outreach is created as a draft only and never sent. Connect Gmail to enable owner-approved sending.',
    };
}
/**
 * Gmail-first draft preparation. Always drafts; reports the send path + the exact blocker.
 * Never sends. Send is impossible without a configured provider AND a verified contact AND
 * (downstream) explicit owner approval.
 */
export function prepareOutreachDraft(input) {
    const draft = buildOutreachDraft({
        type: input.type,
        recipientName: input.recipientName,
        recipientCompany: input.recipientCompany,
        relatedDeal: input.relatedDeal,
        contextNote: input.contextNote,
        senderName: input.senderName,
    });
    const provider = detectConfiguredEmailProvider();
    const contactVerified = input.contactVerified === true;
    let blocker = null;
    if (!provider.configured)
        blocker = 'EMAIL_PROVIDER_NOT_CONFIGURED';
    else if (!contactVerified)
        blocker = 'CONTACT_NOT_VERIFIED';
    const gmailAvailable = provider.available.includes('gmail');
    const sendPath = !provider.configured
        ? 'draft_only'
        : gmailAvailable
            ? 'gmail_draft'
            : 'provider_send';
    return {
        subject: draft.subject,
        body: draft.body,
        sendPath,
        provider: provider.provider,
        canSendAfterApproval: provider.configured && contactVerified,
        blocker,
        requiresOwnerApproval: true,
        complianceNote: 'Investor/capital outreach requires compliance review. Never claim guaranteed returns; do not send securities solicitations without owner approval and a verified, consented contact.',
        note: !provider.configured
            ? 'EMAIL_PROVIDER_NOT_CONFIGURED — draft saved only. Connect Gmail to enable owner-approved sending.'
            : !contactVerified
                ? 'CONTACT_NOT_VERIFIED — verify the contact before this draft can be approved for sending.'
                : gmailAvailable
                    ? 'Ready: create a Gmail draft for the owner to review and send after approval.'
                    : `Ready: send via ${provider.provider} after explicit owner approval.`,
    };
}
