/**
 * IVX Capital Deployment Platform — Opportunity-to-Investor Matching Engine.
 *
 * BLOCK 25. For every active IVX deal (`jv_deals`), score each CRM contact as a
 * potential investor / buyer / lender / partner and surface the best fit per
 * role with a Match Score, Evidence, Geography Fit, Capital Fit, Timeline Fit,
 * and Risk Notes.
 *
 * HARD HONESTY RULE: relationships are never invented. Matches are scored ONLY
 * from evidence that exists on the deal + the CRM record. A fit that can't be
 * computed (missing data on either side) is reported as unavailable and excluded
 * from the match score — never guessed. No contact details are fabricated.
 *
 * The pure scoring functions are deterministic and fully unit-testable; the
 * async `runDealMatching()` grounds the deals in the live `jv_deals` reader and
 * the contacts in the durable Investor CRM store.
 */
import { listInvestors } from './ivx-investor-crm-store';
import { parseCurrency, parseTimelineMonths } from './ivx-deal-intelligence';
import { readLandingProjects } from './ivx-project-data';
export const IVX_DEAL_MATCHING_MARKER = 'ivx-deal-matching-2026-05-31';
export const MATCH_ROLES = ['investor', 'buyer', 'lender', 'partner'];
const STRONG_MATCH_THRESHOLD = 70;
const GEO_WEIGHT = 0.3;
const CAPITAL_WEIGHT = 0.35;
const TIMELINE_WEIGHT = 0.2;
const RELATIONSHIP_WEIGHT = 0.15;
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
function round(value) {
    return Math.round(value);
}
function lower(value) {
    return value.trim().toLowerCase();
}
function termsOverlap(a, b) {
    const left = a.map(lower).filter(Boolean);
    const right = b.map(lower).filter(Boolean);
    return left.some((l) => right.some((r) => l.includes(r) || r.includes(l)));
}
/** Classify a CRM contact into a deal role from their stated investment type. */
export function classifyMatchRole(investmentType) {
    const t = lower(investmentType);
    if (/(lender|debt|credit|bank|mortgage|financ|bridge)/.test(t))
        return 'lender';
    if (/(broker|brokerage|referral|agent|placement|advisor|adviser|ria|partner)/.test(t))
        return 'partner';
    if (/(buyer|acquir|end[-\s]?user|owner[-\s]?occupant|homebuyer|purchaser|second home)/.test(t))
        return 'buyer';
    return 'investor';
}
function scoreGeographyFit(contact, dealLocation) {
    if (!dealLocation) {
        return { available: false, score: 0, note: 'Deal location not stated — geography fit not scored.' };
    }
    if (contact.preferredMarkets.length === 0) {
        return { available: false, score: 0, note: 'No preferred markets on the contact — geography fit not scored.' };
    }
    const overlap = termsOverlap(contact.preferredMarkets, [dealLocation]);
    return {
        available: true,
        score: overlap ? 100 : 30,
        note: overlap ? `Preferred markets include the deal market (${dealLocation}).` : `Preferred markets do not include ${dealLocation}.`,
    };
}
function scoreCapitalFit(contact, deal) {
    const check = parseCurrency(contact.typicalCheckSize || null);
    if (check === null) {
        return { available: false, score: 0, note: 'No typical check size on the contact — capital fit not scored.' };
    }
    const minUsd = parseCurrency(deal.ownershipMinimum);
    const priceUsd = parseCurrency(deal.price);
    if (minUsd === null && priceUsd === null) {
        return { available: false, score: 0, note: 'Deal has no minimum or price — capital fit not scored.' };
    }
    if (minUsd !== null && check < minUsd) {
        return { available: true, score: 30, note: `Check ~$${check.toLocaleString('en-US')} is below the $${minUsd.toLocaleString('en-US')} minimum.` };
    }
    if (priceUsd !== null && check >= priceUsd) {
        return { available: true, score: 100, note: `Check ~$${check.toLocaleString('en-US')} can cover the full $${priceUsd.toLocaleString('en-US')} ticket.` };
    }
    if (minUsd !== null) {
        return { available: true, score: 85, note: `Check ~$${check.toLocaleString('en-US')} clears the $${minUsd.toLocaleString('en-US')} minimum.` };
    }
    // Has a check + a price but check < price: partial participation.
    const ratio = priceUsd ? clamp((check / priceUsd) * 100, 40, 90) : 60;
    return { available: true, score: round(ratio), note: `Check ~$${check.toLocaleString('en-US')} covers part of the $${(priceUsd ?? 0).toLocaleString('en-US')} ticket.` };
}
function scoreTimelineFit(contact, deal) {
    const contactMonths = parseTimelineMonths(contact.investmentTimeline || null);
    const dealMonths = parseTimelineMonths(deal.timeline);
    if (contactMonths === null || dealMonths === null) {
        return {
            available: false,
            score: 0,
            note: contactMonths === null ? 'No investment timeline on the contact — timeline fit not scored.' : 'Deal has no completion timeline — timeline fit not scored.',
        };
    }
    if (contactMonths >= dealMonths) {
        return { available: true, score: 100, note: `Contact horizon (~${contactMonths} mo) covers the deal horizon (~${dealMonths} mo).` };
    }
    const ratio = clamp((contactMonths / dealMonths) * 100, 30, 95);
    return { available: true, score: round(ratio), note: `Contact horizon (~${contactMonths} mo) is shorter than the deal horizon (~${dealMonths} mo).` };
}
/** Score a single contact against a single deal. Pure + deterministic. */
export function scoreDealMatch(deal, contact) {
    const geographyFit = scoreGeographyFit(contact, deal.location);
    const capitalFit = scoreCapitalFit(contact, deal);
    const timelineFit = scoreTimelineFit(contact, deal);
    const relationshipAvailable = contact.relationshipScore > 0;
    const dims = [];
    if (geographyFit.available)
        dims.push({ score: geographyFit.score, weight: GEO_WEIGHT });
    if (capitalFit.available)
        dims.push({ score: capitalFit.score, weight: CAPITAL_WEIGHT });
    if (timelineFit.available)
        dims.push({ score: timelineFit.score, weight: TIMELINE_WEIGHT });
    if (relationshipAvailable)
        dims.push({ score: clamp(contact.relationshipScore, 0, 100), weight: RELATIONSHIP_WEIGHT });
    const weightSum = dims.reduce((sum, d) => sum + d.weight, 0);
    const matchScore = weightSum > 0
        ? round(dims.reduce((sum, d) => sum + d.score * d.weight, 0) / weightSum)
        : 0;
    const evidence = [];
    if (geographyFit.available)
        evidence.push(geographyFit.note);
    if (capitalFit.available)
        evidence.push(capitalFit.note);
    if (timelineFit.available)
        evidence.push(timelineFit.note);
    if (relationshipAvailable)
        evidence.push(`Owner-recorded relationship score ${contact.relationshipScore}/100.`);
    if (contact.accreditedStatus === 'accredited')
        evidence.push('Contact is marked accredited.');
    const riskNotes = [];
    if (!geographyFit.available)
        riskNotes.push(geographyFit.note);
    if (!capitalFit.available)
        riskNotes.push(capitalFit.note);
    if (!timelineFit.available)
        riskNotes.push(timelineFit.note);
    if (weightSum === 0)
        riskNotes.push('No comparable evidence on either side — this is an unscored lead, not a verified match.');
    if (contact.accreditedStatus === 'unknown')
        riskNotes.push('Accreditation unknown — confirm before any securities offering.');
    return {
        contactId: contact.id,
        name: contact.name,
        company: contact.company,
        role: classifyMatchRole(contact.investmentType),
        matchScore,
        geographyFit,
        capitalFit,
        timelineFit,
        evidence,
        riskNotes,
    };
}
function describeDeal(deal) {
    const parts = [
        deal.location ?? 'location n/a',
        deal.price ?? 'price n/a',
        deal.roi ? `${deal.roi} ROI` : 'ROI n/a',
        deal.ownershipMinimum ? `${deal.ownershipMinimum} min` : 'min n/a',
    ];
    return parts.join(' · ');
}
/** Match all contacts to one deal, ranked best-first, with best-per-role. */
export function matchDealToContacts(deal, contacts) {
    const matches = contacts
        .map((contact) => scoreDealMatch(deal, contact))
        .sort((a, b) => b.matchScore - a.matchScore);
    const best = {
        investor: null, buyer: null, lender: null, partner: null,
    };
    for (const match of matches) {
        if (best[match.role] === null)
            best[match.role] = match;
    }
    return {
        dealId: deal.id,
        dealName: deal.name,
        dealLocation: deal.location,
        dealSummary: describeDeal(deal),
        totalContacts: contacts.length,
        matches,
        best,
    };
}
export function summarizeMatching(deals, contactCount) {
    const strongMatches = deals.reduce((sum, set) => sum + set.matches.filter((m) => m.matchScore >= STRONG_MATCH_THRESHOLD).length, 0);
    return { deals: deals.length, contacts: contactCount, strongMatches };
}
/**
 * Match every active/published IVX deal against the CRM contacts. Read-only;
 * grounds deals in the live `jv_deals` reader. Defensive — a failed read simply
 * yields an honest empty result (never fabricated).
 */
export async function runDealMatching() {
    const [contacts, projects] = await Promise.all([
        listInvestors().catch(() => []),
        readLandingProjects().catch(() => null),
    ]);
    const activeDeals = projects && projects.ok ? projects.projects : [];
    const deals = activeDeals.map((deal) => matchDealToContacts(deal, contacts));
    const note = !projects || !projects.ok
        ? 'No live deals available from jv_deals — add/publish deals to match against.'
        : contacts.length === 0
            ? 'No CRM contacts yet — add investors/buyers to match against active deals.'
            : `Matched ${contacts.length} contact(s) against ${deals.length} active deal(s).`;
    return {
        marker: IVX_DEAL_MATCHING_MARKER,
        generatedAt: new Date().toISOString(),
        deals,
        summary: summarizeMatching(deals, contacts.length),
        note,
    };
}
