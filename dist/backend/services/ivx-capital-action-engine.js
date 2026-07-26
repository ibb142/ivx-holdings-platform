/**
 * IVX Capital Network Action Engine — deterministic prospect action layer (owner-only).
 *
 * BLOCK 93. Turns a scored prospect PROFILE (from ivx-capital-network-store) into the
 * concrete owner actions the Capital Network screen needs:
 *   1. Action plan — why this prospect / best outreach angle / likely objections /
 *      recommended next step / compliance warning / confidence score.
 *   2. Research — the LEGITIMATE public channels where such a prospect can be sourced,
 *      each labelled by source type. NEVER fabricates names/emails/phones; because these
 *      are SEGMENT profiles (not named individuals), the verified-contact status is
 *      always CONTACT_NOT_VERIFIED until the owner attaches a real, consented contact.
 *   3. Outreach draft — subject + email body + a one-line SMS/LinkedIn message + an
 *      investor/deal-summary attachment placeholder + a compliance disclaimer.
 *
 * PURE + deterministic — no AI, no network, no I/O — so it is fully unit-testable and
 * produces consistent output. Every field is grounded in the prospect's existing
 * evidence (segment, type, signal, risks, publicSource, nextAction, scores, deals).
 *
 * HARD HONESTY RULES (BLOCK 17 alignment):
 *   - Never invent a named individual, company, email, or phone number.
 *   - Never claim guaranteed returns.
 *   - Securities / investor outreach always carries a compliance-review flag.
 *   - Unknown values stay empty — never faked.
 */
import { buildOutreachDraft } from './ivx-outreach-drafter';
export const IVX_CAPITAL_ACTION_ENGINE_MARKER = 'ivx-capital-action-engine-2026-06-03';
export const RESEARCH_SOURCE_LABEL = {
    public_website: 'Public website',
    investor_portal: 'Investor portal / public filing',
    referral_network: 'Referral network',
    crm_contact: 'Existing CRM / contact',
    owner_provided: 'Owner-provided contact',
};
const COMPLIANCE_DISCLAIMER = 'This message is an introduction only and is not an offer to sell or a solicitation of an offer to buy any security. ' +
    'No returns are guaranteed. Any investment involves risk. Confirm accreditation, Fair Housing, AML/KYC, and securities ' +
    'rules with licensed counsel before proceeding. — IVX Holdings';
/** Build a compliance warning specific to the prospect type. Always present. */
function complianceWarningFor(type, profile) {
    const base = profile.complianceNote?.trim();
    switch (type) {
        case 'investor':
            return 'COMPLIANCE REVIEW REQUIRED — investor outreach may implicate securities / accredited-investor rules. ' +
                'Do not pitch returns or pool capital before counsel review. ' + (base ?? '');
        case 'buyer':
            return 'COMPLIANCE — Fair Housing applies: target only by price band + stated interest, never protected class. ' +
                (base ?? '');
        case 'developer':
            return 'COMPLIANCE — share scope/site data only; entitlement, permitting, and construction risk apply. ' + (base ?? '');
        case 'partner':
            return 'COMPLIANCE — verify the partner is properly licensed (broker-dealer / NMLS / RIA) before any engagement. ' +
                (base ?? '');
        default:
            return base ?? 'COMPLIANCE REVIEW REQUIRED before any outreach.';
    }
}
/** Type-specific best outreach angle, anchored on the prospect's evidenced signal. */
function bestOutreachAngleFor(type, profile) {
    const dealName = profile.matchedDealNames[0]?.trim();
    const dealRef = dealName ? `"${dealName}"` : 'a current South Florida luxury offering';
    switch (type) {
        case 'investor':
            return `Lead with the deal-fit economics: ${profile.signal} Frame ${dealRef} as a scored, structured position and offer the underwriting proforma.`;
        case 'buyer':
            return `Lead with exclusivity + lifestyle fit: introduce ${dealRef} ahead of a wider release and offer a private viewing.`;
        case 'developer':
            return `Lead with the build/value-add upside: share the ${dealRef} site/scope and ask for a build-cost read.`;
        case 'partner':
            return `Lead with mutual deal flow: position ${dealRef} as a co-marketing / capital-introduction opportunity with clear terms.`;
        default:
            return `Introduce ${dealRef} and qualify fit before sharing detail.`;
    }
}
/** Type-specific likely objections, blended with the prospect's recorded risks. */
function likelyObjectionsFor(type, profile) {
    const byType = {
        investor: [
            '"Show me the proforma / track record" — have underwriting + comparable exits ready.',
            '"Is this a registered/compliant offering?" — confirm the Reg D structure + accreditation flow.',
        ],
        buyer: [
            '"Why this property over others?" — lead with the specific location + finish + price-band fit.',
            '"What are the true carrying costs?" — have HOA/taxes/insurance ready.',
        ],
        developer: [
            '"What is the real build cost + timeline?" — provide scope, entitlement status, and a contingency.',
            '"What is the exit?" — show the as-completed comparable basis.',
        ],
        partner: [
            '"What is in it for my clients/book?" — define the fee/referral split upfront.',
            '"Is the offering clean?" — provide an adviser-ready data room.',
        ],
    };
    const objections = [...(byType[type] ?? [])];
    // Surface the prospect's top recorded risk as a likely objection too.
    if (profile.risks[0])
        objections.push(`Risk to pre-empt: ${profile.risks[0]}`);
    return objections;
}
/**
 * Build the action plan for a prospect. Pure + deterministic.
 */
export function buildProspectActionPlan(profile) {
    const confidenceScore = clampScore(profile.scores?.confidence ?? profile.overall ?? 0);
    return {
        prospectId: profile.id,
        segment: profile.segment,
        type: profile.type,
        whyThisProspect: `${profile.rationale} ${profile.signal}`.trim(),
        bestOutreachAngle: bestOutreachAngleFor(profile.type, profile),
        likelyObjections: likelyObjectionsFor(profile.type, profile),
        recommendedNextStep: profile.nextAction,
        complianceWarning: complianceWarningFor(profile.type, profile).trim(),
        confidenceScore,
    };
}
function clampScore(value) {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n))
        return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
}
/** Classify a single public-source channel string into a source type. */
export function classifyResearchChannel(channel) {
    const hay = channel.toLowerCase();
    if (/owner|provided by you|your contact/.test(hay))
        return 'owner_provided';
    if (/\bcrm\b|existing contact|already in/.test(hay))
        return 'crm_contact';
    if (/portal|waitlist|sec |form d|reg d|iapd|finra|nmls|registr|registry|filing|database|directories|director/.test(hay)) {
        return 'investor_portal';
    }
    if (/referral|network|communit|introduc|conference|associat|podcast/.test(hay))
        return 'referral_network';
    return 'public_website';
}
/**
 * Build the research view for a prospect: split its publicSource into labelled channels.
 * Because these are SEGMENT profiles, no named/consented contact exists yet, so the
 * contact status is always CONTACT_NOT_VERIFIED. We NEVER fabricate a contact here.
 */
export function buildProspectResearch(profile) {
    const rawChannels = (profile.publicSource ?? '')
        .split(/[·|]/)
        .map((c) => c.trim())
        .filter(Boolean);
    const channels = rawChannels.map((detail) => {
        const type = classifyResearchChannel(detail);
        return { type, label: RESEARCH_SOURCE_LABEL[type], detail, verified: false };
    });
    return {
        prospectId: profile.id,
        segment: profile.segment,
        channels,
        contactStatus: 'CONTACT_NOT_VERIFIED',
        note: channels.length > 0
            ? 'These are LEGITIMATE public sourcing channels for this segment — not named contacts. ' +
                'Source consented, named contacts through these channels; IVX never invents names, emails, or phone numbers. ' +
                'Status stays CONTACT_NOT_VERIFIED until you attach a real, consented contact.'
            : 'No public sourcing channel recorded for this segment. CONTACT_NOT_VERIFIED — attach an owner-provided contact to proceed.',
    };
}
/** Map a prospect type to the closest outreach draft type. */
export function outreachTypeForProspect(type) {
    switch (type) {
        case 'investor':
            return 'investor_intro';
        case 'buyer':
            return 'buyer_intro';
        case 'developer':
            return 'meeting_request';
        case 'partner':
            return 'investor_intro';
        default:
            return 'meeting_request';
    }
}
/** A one-line SMS/LinkedIn message, only for types where a short channel is appropriate. */
function shortMessageFor(profile) {
    const dealName = profile.matchedDealNames[0]?.trim();
    const dealRef = dealName ? dealName : 'a South Florida luxury opportunity';
    switch (profile.type) {
        case 'partner':
            return `Hi — IVX Holdings here. We have ${dealRef} that may fit your network; open to a quick intro call?`;
        case 'investor':
            return `Hi — sharing ${dealRef} (scored, structured) with a small group of qualified investors. May I send the package?`;
        case 'buyer':
            return `Hi — introducing ${dealRef} ahead of a wider release. Worth a private look?`;
        default:
            // Developers: a meeting request is email-led; no cold SMS one-liner.
            return '';
    }
}
/**
 * Build the outreach draft for a prospect by composing the deterministic outreach
 * drafter (subject + body) with a short message + attachment placeholder + disclaimer.
 * Uses ONLY the prospect's own segment + matched deal as context — never a fabricated
 * recipient name (the drafter omits unknown recipient fields).
 */
export function buildProspectOutreachDraft(profile, options) {
    const outreachType = outreachTypeForProspect(profile.type);
    const relatedDeal = profile.matchedDealNames[0]?.trim() ?? '';
    const contextNote = `Outreach angle: ${bestOutreachAngleFor(profile.type, profile)} ` +
        `(${profile.segment}, fit ${profile.overall}/100). Source consented contacts only through the listed public channels.`;
    const draft = buildOutreachDraft({
        type: outreachType,
        // No recipient name/company — segment profile, never fabricated.
        relatedDeal,
        contextNote,
        senderName: options?.senderName,
    });
    return {
        prospectId: profile.id,
        segment: profile.segment,
        outreachType,
        subject: draft.subject,
        emailBody: draft.body,
        shortMessage: shortMessageFor(profile),
        attachmentPlaceholder: relatedDeal
            ? `[Attach: ${relatedDeal} investor/deal summary — generate a verified deliverable before sending]`
            : '[Attach: deal/investor summary — generate a verified deliverable before sending]',
        complianceDisclaimer: COMPLIANCE_DISCLAIMER,
    };
}
