/**
 * IVX Capital Deployment Platform — Outreach message drafter (deterministic).
 *
 * BLOCK 23. IVX drafts outreach messages automatically (subject + body) from the
 * owner-supplied recipient + deal context. PURE + deterministic — no AI, no
 * network, no I/O — so it is fully unit-testable and produces consistent drafts.
 *
 * HARD HONESTY RULE: the drafter only uses values the OWNER supplied (recipient
 * name, company, related deal, a context note). It NEVER invents recipient
 * contact details, fake testimonials, or guaranteed-return claims. Unknown
 * fields are simply omitted from the draft (no placeholders like "[NAME]").
 *
 * Drafts are proposals only. They are NOT sent — every draft must be approved by
 * the owner (see ivx-outreach-store) before it can move to a sent state.
 */
export const OUTREACH_TYPES = [
    'email_campaign', 'follow_up', 'investor_intro', 'buyer_intro', 'meeting_request', 'deal_update',
];
export const OUTREACH_TYPE_LABEL = {
    email_campaign: 'Email campaign',
    follow_up: 'Follow-up sequence',
    investor_intro: 'Investor introduction',
    buyer_intro: 'Buyer introduction',
    meeting_request: 'Meeting request',
    deal_update: 'Deal update',
};
function trim(value) {
    return typeof value === 'string' ? value.trim() : '';
}
/** Greeting line — uses the recipient name only if the owner supplied one. */
function greeting(recipientName) {
    return recipientName ? `Hi ${recipientName},` : 'Hello,';
}
/** Sign-off — uses the sender name only if supplied. */
function signoff(senderName) {
    return senderName ? `Best regards,\n${senderName}` : 'Best regards,\nIVX Holdings';
}
/** A short deal phrase, or a generic phrase when no deal is attached. */
function dealPhrase(relatedDeal) {
    return relatedDeal ? relatedDeal : 'a current South Florida opportunity';
}
/**
 * Build a deterministic draft (subject + body) for an outreach message.
 * Only owner-supplied fields are used; unknowns are omitted, never faked.
 */
export function buildOutreachDraft(input) {
    const recipientName = trim(input.recipientName);
    const company = trim(input.recipientCompany);
    const deal = trim(input.relatedDeal);
    const context = trim(input.contextNote);
    const sender = trim(input.senderName);
    const deals = dealPhrase(deal);
    const hi = greeting(recipientName);
    const sign = signoff(sender);
    const contextLine = context ? `\n\n${context}` : '';
    switch (input.type) {
        case 'email_campaign': {
            return {
                subject: deal ? `${deal} — South Florida investment opportunity` : 'South Florida investment opportunity',
                body: `${hi}\n\nI'm reaching out from IVX Holdings about ${deals}. We're sharing it with a small group of qualified investors who focus on South Florida real estate.${contextLine}\n\nIf this fits your mandate, I'd be glad to send the full deal package and answer any questions.\n\n${sign}`,
            };
        }
        case 'follow_up': {
            return {
                subject: deal ? `Following up — ${deal}` : 'Following up',
                body: `${hi}\n\nJust following up on ${deals}. I wanted to make sure the details reached you and see if you had any questions.${contextLine}\n\nHappy to jump on a quick call whenever works for you.\n\n${sign}`,
            };
        }
        case 'investor_intro': {
            const who = company ? `${recipientName ? `${recipientName} at ` : ''}${company}` : recipientName || 'you';
            return {
                subject: deal ? `Introduction — ${deal} (IVX Holdings)` : 'Introduction — IVX Holdings',
                body: `${hi}\n\nI'd like to introduce IVX Holdings and ${deals}. Based on ${who ? `${who}'s` : 'your'} focus, this may align with your investment criteria.${contextLine}\n\nWould you be open to a short introductory call to walk through the structure and returns profile?\n\n${sign}`,
            };
        }
        case 'buyer_intro': {
            return {
                subject: deal ? `${deal} — private buyer introduction` : 'Private buyer introduction',
                body: `${hi}\n\nI wanted to introduce ${deals} ahead of a wider release. Given your interest in South Florida luxury property, I thought it was worth a direct look.${contextLine}\n\nIf you'd like, I can arrange a private viewing or send the full details.\n\n${sign}`,
            };
        }
        case 'meeting_request': {
            return {
                subject: deal ? `Quick call about ${deal}?` : 'Quick call this week?',
                body: `${hi}\n\nWould you have 20 minutes this week for a brief call about ${deals}? I'd like to understand your priorities and see whether there's a fit.${contextLine}\n\nLet me know a couple of times that suit you and I'll send an invite.\n\n${sign}`,
            };
        }
        case 'deal_update': {
            return {
                subject: deal ? `${deal} — progress update` : 'Progress update',
                body: `${hi}\n\nHere's a short update on ${deals}. I wanted to keep you in the loop on where things stand.${contextLine}\n\nHappy to discuss any of this in more detail — just let me know.\n\n${sign}`,
            };
        }
        default: {
            return {
                subject: deal ? `${deal}` : 'IVX Holdings',
                body: `${hi}\n\nReaching out from IVX Holdings about ${deals}.${contextLine}\n\n${sign}`,
            };
        }
    }
}
