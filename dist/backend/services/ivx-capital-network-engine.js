/**
 * IVX South Florida Luxury Capital Intelligence Network — engine (owner-only).
 *
 * BLOCK 17 (revised). Targeted, NOT a global-everything scanner. It finds the
 * highest-probability CAPITAL SOURCES for IVX's actual South Florida luxury real-
 * estate offerings, in four families:
 *   buyer      — luxury / waterfront / second-home / international / relocation buyers
 *   investor   — multifamily / syndicators / private equity / family offices / accredited
 *   developer  — land acquisition / builders / redevelopment groups
 *   partner    — lenders / brokers / wealth managers / capital raisers
 *
 * HARD HONESTY RULES:
 *   - NEVER fabricate named individuals/companies/contact details. Records are
 *     high-probability PROSPECT PROFILES (segments) grounded in IVX's real `jv_deals`,
 *     each with the LEGITIMATE public sourcing channel where such prospects are found.
 *   - Optimize for the highest-probability fit (quality), not the largest name count.
 *   - Unknown values stay null/empty. Every profile carries a compliance/privacy note.
 *
 * Deterministic + runtime-light: pure functions over already-collected deal signals,
 * no AI/network of its own, fully unit-testable. The heavy `jv_deals` reader is
 * lazy-imported; a failed read degrades to an honest empty signal (never throws).
 */
import { rankDeals } from './ivx-deal-intelligence';
import { upsertProspects, listProspects, DEFAULT_COMPLIANCE_NOTE, } from './ivx-capital-network-store';
export const IVX_CAPITAL_NETWORK_ENGINE_MARKER = 'ivx-capital-network-engine-sfla-2026-05-30';
const SOUTH_FLORIDA_RE = /(south\s*florida|florida|\bfl\b|miami|broward|pembroke|hialeah|fort\s*lauderdale|lauderdale|palm\s*beach|boca|naples|aventura|brickell|coral\s*gables|doral|weston|sunny\s*isles|bal\s*harbour|key\s*biscayne|jacksonville)/i;
const WATERFRONT_RE = /(waterfront|ocean|beach|bay|canal|intracoastal|marina|riverfront)/i;
const CONDO_RE = /(condo|residence|tower|penthouse|villa|estate)/i;
const DEVELOPMENT_RE = /(land|lot|development|develop|construct|build|redevelop|value[-\s]?add|distressed|renovat)/i;
function detectSouthFlorida(location, name) {
    const hay = `${location ?? ''} ${name}`;
    return SOUTH_FLORIDA_RE.test(hay);
}
function detectLuxury(priceUsd, location, name) {
    if (priceUsd !== null && priceUsd >= 1_000_000)
        return true;
    const hay = `${location ?? ''} ${name}`;
    return WATERFRONT_RE.test(hay) || CONDO_RE.test(hay);
}
function detectDevelopment(name, completionScore) {
    return DEVELOPMENT_RE.test(name) || completionScore < 55;
}
/**
 * Collect the capital signal: read live `jv_deals`, rank them, and join each with
 * its location + derived South-Florida / luxury / fractional / development flags.
 * Read-only + defensive — a failed read becomes an honest empty signal.
 */
export async function collectCapitalSignals() {
    const scannedAt = new Date().toISOString();
    try {
        const { readLandingProjects } = await import('./ivx-project-data');
        const result = await readLandingProjects();
        if (!result.ok) {
            return { scannedAt, ok: false, reason: result.error ?? 'project source unavailable', deals: [], markets: [] };
        }
        const ranked = result.projects.length > 0 ? rankDeals(result.projects) : [];
        const locById = new Map(result.projects.map((p) => [p.id, p.location]));
        const deals = ranked.map((d) => {
            const location = locById.get(d.id) ?? null;
            const priceUsd = d.metrics.priceUsd;
            const minOwnershipUsd = d.metrics.minOwnershipUsd;
            return {
                id: d.id,
                name: d.name,
                location,
                priceUsd,
                roiPercent: d.metrics.roiPercent,
                minOwnershipUsd,
                weightedScore: d.weightedScore,
                completionScore: d.completionScore,
                dataCompleteness: d.metrics.dataCompleteness,
                isSouthFlorida: detectSouthFlorida(location, d.name),
                isLuxury: detectLuxury(priceUsd, location, d.name),
                isFractional: minOwnershipUsd !== null && minOwnershipUsd <= 25_000,
                isDevelopment: detectDevelopment(d.name, d.completionScore),
            };
        });
        const markets = Array.from(new Set(deals.map((d) => normalizeMarket(d.location)).filter((m) => Boolean(m))));
        return { scannedAt, ok: true, reason: null, deals, markets };
    }
    catch (error) {
        return {
            scannedAt,
            ok: false,
            reason: error instanceof Error ? error.message : 'project source unavailable',
            deals: [],
            markets: [],
        };
    }
}
/** Normalize a free-text location to a market label (best-effort, never fabricated). */
export function normalizeMarket(location) {
    if (!location)
        return null;
    const trimmed = location.trim();
    return trimmed.length > 0 ? trimmed : null;
}
// ── Scoring (deterministic, 0–100) ──────────────────────────────────────────
/** Relevance to IVX's South Florida luxury focus. */
function relevanceScore(deal) {
    let score = 45;
    if (deal.isSouthFlorida)
        score += 30;
    if (deal.isLuxury)
        score += 20;
    // Stronger data → more confidence the relevance is real.
    score += Math.round(deal.dataCompleteness * 5);
    return clamp(score);
}
/** How well a prospect TYPE fits a specific deal's economics. */
function dealFitScore(type, deal) {
    const roi = deal.roiPercent ?? 0;
    const price = deal.priceUsd ?? 0;
    switch (type) {
        case 'buyer': {
            // Whole-asset luxury buyers fit a defined, buyable luxury price (not micro-fractional).
            let s = 40;
            if (deal.isLuxury)
                s += 25;
            if (deal.isSouthFlorida)
                s += 15;
            if (price >= 1_000_000 && price <= 15_000_000)
                s += 12;
            return clamp(s);
        }
        case 'investor': {
            // Investors fit fractional/JV positions with strong ROI.
            let s = 42;
            if (deal.isFractional)
                s += 18;
            s += Math.round(Math.min(roi, 30) / 30 * 24);
            if (deal.weightedScore >= 70)
                s += 8;
            return clamp(s);
        }
        case 'developer': {
            // Developers fit development / value-add / distressed plays.
            let s = 38;
            if (deal.isDevelopment)
                s += 28;
            if (deal.isSouthFlorida)
                s += 12;
            return clamp(s);
        }
        case 'partner': {
            // Lenders/wealth managers/capital raisers fit larger, financeable luxury deals.
            let s = 44;
            if (price >= 1_000_000)
                s += 16;
            if (deal.isLuxury)
                s += 10;
            if (deal.isFractional)
                s += 6;
            return clamp(s);
        }
        default:
            return 40;
    }
}
function confidenceScore(deal) {
    // Confidence the segment is real + reachable scales with deal-data completeness.
    return clamp(45 + Math.round(deal.dataCompleteness * 45));
}
function clamp(value) {
    return Math.max(0, Math.min(100, Math.round(value)));
}
const TEMPLATES = [
    // Buyers
    {
        type: 'buyer',
        segment: 'South Florida second-home / relocation buyer ($2M+)',
        companyType: 'High-net-worth individual / private buyer',
        investmentFocus: 'Luxury primary or second homes in South Florida',
        publicSource: 'MLS closed $2M+ sales · luxury brokerage buyer lists · relocation/concierge networks',
        applies: (d) => d.isLuxury,
        signal: (d) => `Luxury price tier${d.priceUsd ? ` (~$${(d.priceUsd / 1_000_000).toFixed(2)}M)` : ''} matches the South Florida second-home demand band.`,
        risks: ['Fair Housing: never target by protected class — only price band + stated interest.', 'Buyer demand is unproven until a qualified showing/LOI.'],
        nextAction: 'Brief a luxury brokerage partner to surface consented $2M+ buyer leads for this property.',
    },
    {
        type: 'buyer',
        segment: 'International luxury buyer (LatAm / EU / Canada)',
        companyType: 'International HNW / family buyer',
        investmentFocus: 'US-dollar luxury real estate, South Florida gateway markets',
        publicSource: 'International luxury portals (e.g. listing syndication) · multilingual brokerage referral networks · immigration/relocation advisors',
        applies: (d) => d.isSouthFlorida && d.isLuxury,
        signal: () => 'South Florida is a primary US destination for international luxury capital seeking USD real-asset exposure.',
        risks: ['Cross-border AML/KYC and source-of-funds verification is mandatory.', 'FX and tax (FIRPTA) considerations affect net economics.'],
        nextAction: 'Engage a multilingual brokerage/referral partner with verified international buyer demand.',
    },
    {
        type: 'buyer',
        segment: 'Accredited fractional-ownership buyer',
        companyType: 'Accredited individual investor (fractional)',
        investmentFocus: 'Fractional luxury real-estate positions, low minimum entry',
        publicSource: 'Accredited-investor networks · the IVX investor portal waitlist · fractional-ownership communities',
        applies: (d) => d.isFractional && d.isLuxury,
        signal: (d) => `Low minimum${d.minOwnershipUsd ? ` (~$${d.minOwnershipUsd.toLocaleString('en-US')})` : ''} opens this luxury asset to accredited fractional buyers.`,
        risks: ['Securities/accredited-investor rules apply to fractional offerings — confirm with counsel.', 'Fractional liquidity is limited.'],
        nextAction: 'Confirm the offering structure + accreditation flow, then open the fractional waitlist.',
    },
    // Investors
    {
        type: 'investor',
        segment: 'Multifamily / value-add investor (Southeast US)',
        companyType: 'Real-estate investor / operator',
        investmentFocus: 'Cash-flowing or value-add multifamily, Southeast US',
        publicSource: 'SEC Form D filers · regional REIA groups · multifamily investor LinkedIn search',
        applies: (d) => d.isSouthFlorida || d.isDevelopment,
        signal: (d) => `Deal ranks ${d.weightedScore}/100${d.roiPercent ? ` at ${d.roiPercent}% ROI` : ''} — fits a value-add multifamily thesis.`,
        risks: ['Investor return assumptions must be backed by a real proforma.', 'Interest-rate and cap-rate movement affects underwriting.'],
        nextAction: 'Match this deal to value-add investors and share the underwriting proforma.',
    },
    {
        type: 'investor',
        segment: 'Real-estate syndicator / fund GP',
        companyType: 'Syndicator / fund general partner',
        investmentFocus: 'Aggregating LP capital into larger RE positions',
        publicSource: 'SEC Form D (Reg D 506) filers · syndication podcasts/communities · fund databases',
        applies: (d) => d.isFractional || d.weightedScore >= 60,
        signal: (d) => `Fractional/JV structure${d.roiPercent ? ` with ${d.roiPercent}% stated ROI` : ''} is co-syndication-ready.`,
        risks: ['Securities compliance + LP disclosures required before pooling capital.', 'GP/LP economics must be negotiated upfront.'],
        nextAction: 'Approach a syndicator to co-raise on this position; agree on carry/fee split.',
    },
    {
        type: 'investor',
        segment: 'Family office — real assets allocation',
        companyType: 'Single / multi-family office',
        investmentFocus: 'Direct real-estate + JV positions for long-hold real-asset allocation',
        publicSource: 'Family-office directories · wealth-management referral networks · real-assets conferences',
        applies: (d) => d.isLuxury || d.priceUsd !== null && d.priceUsd >= 1_000_000,
        signal: (d) => `Institutional-quality luxury asset${d.priceUsd ? ` (~$${(d.priceUsd / 1_000_000).toFixed(2)}M)` : ''} suits a family-office real-assets sleeve.`,
        risks: ['Family offices require institutional-grade diligence + reporting.', 'Longer decision cycles; relationship-driven.'],
        nextAction: 'Prepare an institutional one-pager and route via a wealth-management introducer.',
    },
    // Developers
    {
        type: 'developer',
        segment: 'Land acquisition / redevelopment group',
        companyType: 'Developer / redevelopment group',
        investmentFocus: 'Entitled land, teardowns, value-add redevelopment in South Florida',
        publicSource: 'Permit/entitlement records · local builder associations · land-broker networks',
        applies: (d) => d.isDevelopment,
        signal: (d) => `Development/value-add profile (completion ${Math.round(d.completionScore)}/100) fits a redevelopment group.`,
        risks: ['Entitlement, permitting, and construction risk apply.', 'Cost overruns can erode the spread.'],
        nextAction: 'Share the site/scope with a vetted redevelopment partner for a build cost read.',
    },
    {
        type: 'developer',
        segment: 'Luxury builder / general contractor',
        companyType: 'Luxury builder / GC',
        investmentFocus: 'Ground-up and renovation of high-end South Florida residences',
        publicSource: 'Licensed-contractor registries · luxury build portfolios · architect referral networks',
        applies: (d) => d.isDevelopment && d.isLuxury,
        signal: () => 'High-end build/renovation scope fits a luxury GC partnership.',
        risks: ['GC capacity and schedule risk.', 'Quality control is critical at the luxury tier.'],
        nextAction: 'Request a build budget + timeline from a luxury GC before committing.',
    },
    // Partners
    {
        type: 'partner',
        segment: 'Private credit / bridge lender (CRE)',
        companyType: 'Private lender / debt fund',
        investmentFocus: 'Bridge / construction / acquisition financing on luxury CRE',
        publicSource: 'NMLS-registered private lenders · CRE debt brokers · private-credit fund directories',
        applies: (d) => d.priceUsd !== null && d.priceUsd >= 1_000_000,
        signal: (d) => `Financeable luxury asset${d.priceUsd ? ` (~$${(d.priceUsd / 1_000_000).toFixed(2)}M)` : ''} supports a bridge/acquisition facility.`,
        risks: ['Leverage magnifies losses and can force a sale in a downturn.', 'Rate and covenant terms must be modeled before drawing debt.'],
        nextAction: 'Request indicative term sheets from 2–3 private CRE lenders.',
    },
    {
        type: 'partner',
        segment: 'Wealth manager / RIA (client capital)',
        companyType: 'RIA / wealth manager',
        investmentFocus: 'Allocating qualified-client capital to vetted real-asset deals',
        publicSource: 'SEC/FINRA IAPD adviser search · RIA networks · wealth-management conferences',
        applies: (d) => d.isLuxury || d.isFractional,
        signal: () => 'Vetted luxury/fractional deals fit an RIA seeking real-asset allocations for qualified clients.',
        risks: ['Suitability + fiduciary rules govern adviser allocations.', 'Requires clean offering docs.'],
        nextAction: 'Build an adviser-ready data room and approach RIAs with qualified clients.',
    },
    {
        type: 'partner',
        segment: 'Capital raiser / placement agent',
        companyType: 'Placement agent / capital raiser',
        investmentFocus: 'Sourcing investor capital for vetted real-estate offerings',
        publicSource: 'Broker-dealer/placement-agent registries · capital-introduction networks',
        applies: (d) => d.isFractional || d.weightedScore >= 60,
        signal: () => 'A structured, scored offering is placement-agent-ready for a capital raise.',
        risks: ['Placement agents must be properly licensed (broker-dealer).', 'Fees affect net proceeds.'],
        nextAction: 'Engage a licensed placement agent and define the raise mandate + fee.',
    },
    {
        type: 'partner',
        segment: 'Luxury brokerage / referral partner',
        companyType: 'Luxury real-estate brokerage',
        investmentFocus: 'Buyer sourcing + co-marketing for South Florida luxury listings',
        publicSource: 'Top South Florida luxury brokerages · agent production rankings · referral networks',
        applies: (d) => d.isSouthFlorida && d.isLuxury,
        signal: () => 'A South Florida luxury listing is ideal for a co-marketing / referral brokerage partnership.',
        risks: ['Co-broke/referral terms must be agreed in writing.', 'Brand alignment matters at the luxury tier.'],
        nextAction: 'Sign a co-marketing/referral agreement with a top South Florida luxury brokerage.',
    },
];
/**
 * Derive scored prospect profiles from the capital signal. Every profile is
 * grounded in a real deal (placed in `evidence`) and de-duped by (type+segment),
 * keeping the highest-fit instance and accumulating matched deals.
 */
export function deriveProspects(signal) {
    if (!signal.ok || signal.deals.length === 0)
        return [];
    const byKey = new Map();
    for (const deal of signal.deals) {
        for (const tpl of TEMPLATES) {
            if (!tpl.applies(deal))
                continue;
            const scores = {
                confidence: confidenceScore(deal),
                relevance: relevanceScore(deal),
                dealFit: dealFitScore(tpl.type, deal),
            };
            const market = normalizeMarket(deal.location) ?? 'South Florida (market TBD)';
            const candidate = {
                type: tpl.type,
                segment: tpl.segment,
                companyType: tpl.companyType,
                market,
                investmentFocus: tpl.investmentFocus,
                publicSource: tpl.publicSource,
                scores,
                rationale: `Selected because IVX deal "${deal.name}" is a ${dealDescriptor(deal)} — a high-probability fit for this ${tpl.type} segment.`,
                evidence: `Grounded in live jv_deals "${deal.name}"${deal.location ? ` (${deal.location})` : ''}: ${deal.priceUsd ? `price ~$${deal.priceUsd.toLocaleString('en-US')}` : 'price n/a'}, ${deal.roiPercent ? `${deal.roiPercent}% ROI` : 'ROI n/a'}, ${deal.minOwnershipUsd ? `min $${deal.minOwnershipUsd.toLocaleString('en-US')}` : 'min n/a'}, deal score ${deal.weightedScore}/100.`,
                signal: tpl.signal(deal),
                risks: tpl.risks,
                nextAction: tpl.nextAction,
                matchedDealNames: [deal.name],
                complianceNote: DEFAULT_COMPLIANCE_NOTE,
            };
            const key = `${tpl.type}::${tpl.segment.toLowerCase()}`;
            const prior = byKey.get(key);
            const priorOverall = prior ? prior.scores.dealFit ?? 0 : -1;
            if (!prior) {
                byKey.set(key, candidate);
            }
            else {
                // Keep the higher deal-fit instance; accumulate matched deal names.
                const merged = Array.from(new Set([...(prior.matchedDealNames ?? []), deal.name]));
                if ((scores.dealFit ?? 0) > priorOverall) {
                    byKey.set(key, { ...candidate, matchedDealNames: merged });
                }
                else {
                    byKey.set(key, { ...prior, matchedDealNames: merged });
                }
            }
        }
    }
    return Array.from(byKey.values());
}
function dealDescriptor(deal) {
    const parts = [];
    if (deal.isSouthFlorida)
        parts.push('South Florida');
    if (deal.isLuxury)
        parts.push('luxury');
    if (deal.isFractional)
        parts.push('fractional');
    if (deal.isDevelopment)
        parts.push('development/value-add');
    parts.push('real-estate deal');
    return parts.join(' ');
}
/**
 * Run one full scan: collect deal signals → derive scored prospect profiles →
 * persist (de-duped) → return the refreshed, ranked list.
 */
export async function runCapitalNetworkScan() {
    const { withAgentRun } = await import('./ivx-agent-activity-store');
    return withAgentRun({
        kind: 'capital_matching',
        label: 'Capital matching',
        why: 'Match IVX South Florida luxury deals to the highest-probability buyer / investor / partner profiles.',
        detail: 'Collecting deal signals and deriving scored capital-source profiles…',
        proofOf: (result) => `Generated ${result.generatedCount} prospect profile(s); ${result.prospects.length} total.`,
    }, async () => {
        const signal = await collectCapitalSignals();
        const candidates = deriveProspects(signal);
        if (candidates.length > 0) {
            await upsertProspects(candidates);
        }
        const prospects = await listProspects();
        console.log('[IVXCapitalNetwork] SCAN', {
            marker: IVX_CAPITAL_NETWORK_ENGINE_MARKER,
            ok: signal.ok,
            deals: signal.deals.length,
            generated: candidates.length,
            total: prospects.length,
        });
        return {
            marker: IVX_CAPITAL_NETWORK_ENGINE_MARKER,
            scannedAt: signal.scannedAt,
            ok: signal.ok,
            reason: signal.reason,
            generatedCount: candidates.length,
            prospects,
        };
    });
}
