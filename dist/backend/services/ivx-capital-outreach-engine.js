export const IVX_CAPITAL_OUTREACH_MARKER = 'ivx-capital-outreach-2026-05-31';
export const CAPITAL_OUTREACH_COMPLIANCE_NOTE = 'Outreach plan derived ONLY from evidence-based prospect PROFILES (segments) + their legitimate public sourcing channels — ' +
    'no fabricated individuals, companies, emails, or phone numbers. Contact only consented prospects through the named public ' +
    'channels. Confirm Fair Housing, securities/accredited-investor (Reg D), AML/KYC, and privacy rules with licensed counsel ' +
    'before any outreach. This is not investment, legal, or solicitation advice.';
function activeOnly(prospects) {
    return prospects.filter((p) => p.status !== 'dismissed');
}
function byOverallDesc(a, b) {
    return b.overall - a.overall || b.scores.dealFit - a.scores.dealFit;
}
/** Map an evidence-based overall score to an outreach priority. */
export function outreachPriority(overall) {
    if (overall >= 85)
        return 'high';
    if (overall >= 65)
        return 'medium';
    return 'low';
}
/** First (primary) channel from a "A · B · C" public-source string. */
export function primaryChannel(publicSource) {
    const first = publicSource.split('·')[0]?.trim();
    return first && first.length > 0 ? first : publicSource.trim();
}
/** Build the sequenced outreach steps for one prospect (anchored on its data). */
function buildSteps(prospect) {
    const channel = primaryChannel(prospect.publicSource);
    const isCapitalSide = prospect.type === 'investor' || prospect.type === 'partner';
    const introTarget = isCapitalSide ? 'capital partner' : prospect.type;
    return [
        {
            order: 1,
            action: `Identify consented ${introTarget} contacts via the named public channel (no cold/unconsented outreach).`,
            channel,
            timing: 'Days 1–3',
        },
        {
            order: 2,
            action: `Send the tailored packet for this segment and request a short intro call. (${prospect.nextAction})`,
            channel,
            timing: 'Days 4–10',
        },
        {
            order: 3,
            action: isCapitalSide
                ? 'Hold the intro call, share the data room, and discuss structure/terms.'
                : 'Schedule a qualified showing/LOI conversation and route through a licensed broker.',
            channel,
            timing: 'Days 11–21',
        },
        {
            order: 4,
            action: isCapitalSide
                ? 'Follow up for soft commitment / term sheet; loop in counsel for compliance.'
                : 'Follow up to convert interest; confirm AML/KYC + fair-housing compliance with counsel.',
            channel,
            timing: 'Days 22–30',
        },
    ];
}
function buildStrategy(prospect) {
    return {
        prospectId: prospect.id,
        type: prospect.type,
        segment: prospect.segment,
        market: prospect.market,
        priority: outreachPriority(prospect.overall),
        overall: prospect.overall,
        primaryChannel: primaryChannel(prospect.publicSource),
        approach: `${prospect.signal} ${prospect.nextAction}`.trim(),
        steps: buildSteps(prospect),
        evidence: prospect.evidence,
        matchedDealNames: prospect.matchedDealNames,
        complianceNote: prospect.complianceNote,
    };
}
// ── Investor packet recommendations (driven by the segments present) ─────────
function uniqueSegments(prospects, predicate) {
    return Array.from(new Set(prospects.filter(predicate).map((p) => p.segment)));
}
function buildInvestorPacket(prospects) {
    const items = [];
    const has = (type) => prospects.some((p) => p.type === type);
    const segmentsContaining = (needle) => uniqueSegments(prospects, (p) => p.segment.toLowerCase().includes(needle));
    const allSegments = Array.from(new Set(prospects.map((p) => p.segment)));
    // Always required: a per-deal one-pager + the compliance disclosures.
    items.push({
        item: 'Deal one-pager (per published IVX deal)',
        reason: 'Every outreach starts with a concise, evidence-based summary of the specific deal (location, price, ROI, timeline, minimum).',
        priority: 'required',
        forSegments: allSegments,
    });
    items.push({
        item: 'Risk & compliance disclosures (Fair Housing / securities / AML)',
        reason: 'Required before any capital outreach; protects the raise and every prospect interaction.',
        priority: 'required',
        forSegments: allSegments,
    });
    if (has('investor') || has('partner')) {
        items.push({
            item: 'Underwriting proforma (NOI / ROI / IRR)',
            reason: 'Investors, syndicators, family offices, and capital partners diligence the numbers before any commitment.',
            priority: 'required',
            forSegments: uniqueSegments(prospects, (p) => p.type === 'investor' || p.type === 'partner'),
        });
        items.push({
            item: 'Offering structure & accreditation summary (Reg D)',
            reason: 'Fractional / JV / syndicated capital requires a clear securities structure and accredited-investor flow.',
            priority: 'required',
            forSegments: uniqueSegments(prospects, (p) => p.type === 'investor' || p.type === 'partner' || p.segment.toLowerCase().includes('fractional')),
        });
        items.push({
            item: 'Investor data room (financials, title, photos, docs)',
            reason: 'RIAs and family offices require institutional-grade diligence material before allocating client capital.',
            priority: 'recommended',
            forSegments: segmentsContaining('family office').concat(segmentsContaining('ria'), segmentsContaining('wealth')),
        });
    }
    if (has('buyer')) {
        items.push({
            item: 'Property brochure + photos / renders',
            reason: 'Luxury buyers and brokerages expect visual marketing material for the listing.',
            priority: 'recommended',
            forSegments: uniqueSegments(prospects, (p) => p.type === 'buyer'),
        });
    }
    const intlSegments = segmentsContaining('international');
    if (intlSegments.length > 0) {
        items.push({
            item: 'AML/KYC + FIRPTA / source-of-funds summary',
            reason: 'International luxury buyers require cross-border compliance and tax (FIRPTA) clarity up front.',
            priority: 'required',
            forSegments: intlSegments,
        });
    }
    if (has('developer')) {
        items.push({
            item: 'Site / scope packet + entitlement status',
            reason: 'Developers and redevelopment groups assess buildability, entitlements, and budget before engaging.',
            priority: 'recommended',
            forSegments: uniqueSegments(prospects, (p) => p.type === 'developer'),
        });
    }
    return items;
}
// ── Broker introductions + partnership targets ──────────────────────────────
const BROKER_INTRO_RE = /(brokerage|broker|placement|agent|lender|wealth|ria|capital\s*rais)/i;
function buildBrokerIntroductions(prospects) {
    return prospects
        .filter((p) => p.type === 'partner' && BROKER_INTRO_RE.test(`${p.segment} ${p.companyType}`))
        .sort(byOverallDesc)
        .map((p) => ({
        prospectId: p.id,
        segment: p.segment,
        channel: primaryChannel(p.publicSource),
        why: p.signal,
        nextAction: p.nextAction,
    }));
}
function buildPartnershipTargets(prospects) {
    return prospects
        .filter((p) => p.type === 'partner')
        .sort(byOverallDesc)
        .map((p) => ({
        prospectId: p.id,
        segment: p.segment,
        companyType: p.companyType,
        overall: p.overall,
        why: p.rationale,
        nextAction: p.nextAction,
    }));
}
// ── 30-day capital-raising plan ─────────────────────────────────────────────
function topSegments(prospects, filter, limit) {
    return Array.from(new Set(prospects.filter(filter).sort(byOverallDesc).map((p) => p.segment))).slice(0, limit);
}
function buildThirtyDayPlan(prospects) {
    const investorTargets = topSegments(prospects, (p) => p.type === 'investor' || p.type === 'partner', 3);
    const buyerTargets = topSegments(prospects, (p) => p.type === 'buyer', 3);
    const partnerTargets = topSegments(prospects, (p) => p.type === 'partner', 3);
    const overallTop = topSegments(prospects, () => true, 3);
    return [
        {
            window: 'Days 1–7 · Prepare & shortlist',
            focus: 'Assemble the packet and shortlist the highest-fit capital sources.',
            actions: [
                'Finalize the deal one-pager, proforma, and compliance disclosures.',
                'Shortlist the top-scored prospects from the capital network.',
                'Open consented contact lists through the named public channels only.',
            ],
            targets: overallTop,
        },
        {
            window: 'Days 8–14 · Warm introductions',
            focus: 'Open conversations with the highest-fit investors and capital partners.',
            actions: [
                'Send tailored packets to top investor / partner segments.',
                'Request brokered / referral introductions where a partner channel exists.',
                'Confirm accredited-investor / securities flow with counsel before pitching structure.',
            ],
            targets: investorTargets,
        },
        {
            window: 'Days 15–21 · Meetings & data room',
            focus: 'Hold intro calls, share the data room, and surface buyer demand.',
            actions: [
                'Run investor/partner intro calls; grant data-room access to qualified parties.',
                'Brief a luxury brokerage to surface consented buyer leads.',
                'Capture diligence questions and reconcile against the proforma.',
            ],
            targets: Array.from(new Set([...buyerTargets, ...partnerTargets])).slice(0, 4),
        },
        {
            window: 'Days 22–30 · Convert & commit',
            focus: 'Convert interest into soft commitments / term sheets.',
            actions: [
                'Follow up for soft commitments or term sheets; involve counsel on terms.',
                'Advance qualified buyers toward LOI through a licensed broker.',
                'Record outcomes and re-rank the network for the next cycle.',
            ],
            targets: overallTop,
        },
    ];
}
function buildHeadline(prospects) {
    if (prospects.length === 0) {
        return 'No scored prospects yet — run a capital-network scan once IVX has a published South Florida luxury deal, then generate the outreach plan.';
    }
    const top = [...prospects].sort(byOverallDesc)[0];
    const investors = prospects.filter((p) => p.type === 'investor' || p.type === 'partner').length;
    const buyers = prospects.filter((p) => p.type === 'buyer').length;
    return (`Capital outreach plan ready: ${prospects.length} evidence-based prospect segments ` +
        `(${investors} capital-side, ${buyers} buyer-side). Lead with "${top.segment}" (fit ${top.overall}/100). ` +
        'No fabricated contacts — outreach runs through the named public channels with compliance review.');
}
/**
 * Build the full capital-outreach plan from already-scored prospect profiles.
 * Pure + deterministic — no I/O, no AI. Active prospects only (dismissed excluded).
 */
export function buildCapitalOutreachPlan(prospects) {
    const active = activeOnly(prospects).sort(byOverallDesc);
    const readiness = active.length === 0 ? 'no-prospects' : active.length >= 4 ? 'ready' : 'partial';
    return {
        marker: IVX_CAPITAL_OUTREACH_MARKER,
        generatedAt: new Date().toISOString(),
        totalProspects: active.length,
        readiness,
        headline: buildHeadline(active),
        // Strategies for the highest-fit prospects (cap to keep the plan actionable).
        outreachStrategies: active.slice(0, 10).map(buildStrategy),
        investorPacket: buildInvestorPacket(active),
        brokerIntroductions: buildBrokerIntroductions(active),
        partnershipTargets: buildPartnershipTargets(active),
        thirtyDayPlan: buildThirtyDayPlan(active),
        disclaimer: CAPITAL_OUTREACH_COMPLIANCE_NOTE,
    };
}
