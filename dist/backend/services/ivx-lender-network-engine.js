/**
 * IVX Private Lender Network — engine (owner-only).
 *
 * Module 3 of the IVX Autonomous Business Execution Engine. Derives the highest-
 * probability PRIVATE LENDER segments for IVX's South Florida luxury real-estate
 * offerings, in the five families the owner asked for:
 *   - hard money lenders
 *   - private lenders
 *   - bridge lenders
 *   - construction lenders
 *   - commercial lenders
 *
 * HARD HONESTY RULES (same as the capital-network engine):
 *   - NEVER fabricate named individuals/companies/contact details. Records are
 *     high-probability LENDER PROFILES (segments / archetypes) grounded in IVX's
 *     real deal data and the LEGITIMATE public sourcing channel where such
 *     lenders can actually be found + consented (NMLS registry, public intake
 *     forms, state lender-license databases).
 *   - Optimize for the highest-probability fit (quality), not the largest name count.
 *   - Unknown values stay null/empty — never invented.
 *   - Every profile carries an explicit compliance/privacy note.
 *
 * Deterministic + runtime-light: pure functions over already-collected deal
 * signals (lazy-imported), no AI/network of its own, fully unit-testable.
 */
import { rankDeals } from './ivx-deal-intelligence';
import { readLandingProjects } from './ivx-project-data';
import { upsertLenders, listLenders, lenderCountsByCategory, DEFAULT_LENDER_COMPLIANCE_NOTE, } from './ivx-lender-network-store';
export const IVX_LENDER_NETWORK_ENGINE_MARKER = 'ivx-lender-network-engine-sfla-2026-07-04';
/** Read live jv_deals + projects and rank them, mirroring the capital-network approach. */
async function readRankedDeals() {
    const scannedAt = new Date().toISOString();
    try {
        const projectResult = await readLandingProjects();
        const rawDeals = projectResult.projects;
        if (rawDeals.length === 0) {
            return { scannedAt, ok: true, reason: 'No jv_deals rows; lender engine returned segment defaults.', deals: [] };
        }
        const projectNameById = new Map(rawDeals.map((p) => [p.id, p.name]));
        const projectLocationById = new Map(rawDeals.map((p) => [p.id, p.location ?? null]));
        const scores = rankDeals(rawDeals);
        const deals = scores.map((s) => {
            const projectId = s.id;
            const location = projectLocationById.get(projectId) ?? null;
            const name = projectNameById.get(projectId) ?? s.name;
            const lower = `${name} ${location ?? ''}`.toLowerCase();
            const metrics = s.metrics;
            const isSouthFlorida = /(miami|fort lauderdale|naples|west palm|palm beach|brickell|coral gables|sunny isles|aventura|boca|south florida|broward|miami-dade)/.test(lower);
            const isLuxury = metrics.priceUsd !== null && metrics.priceUsd >= 1_000_000 || /(waterfront|penthouse|luxury|condo|estate)/.test(lower);
            const isFractional = metrics.minOwnershipUsd !== null && metrics.minOwnershipUsd < 100_000;
            const isDevelopment = /(development|construction|ground-up|renovation|value-add|distressed|redevelopment)/.test(lower);
            return {
                id: s.id,
                name,
                location,
                priceUsd: metrics.priceUsd,
                roiPercent: metrics.roiPercent,
                minOwnershipUsd: metrics.minOwnershipUsd,
                weightedScore: s.weightedScore,
                completionScore: s.completionScore,
                dataCompleteness: metrics.dataCompleteness,
                isSouthFlorida,
                isLuxury,
                isFractional,
                isDevelopment,
            };
        });
        return { scannedAt, ok: true, reason: null, deals };
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : 'deal read failed';
        return { scannedAt, ok: false, reason, deals: [] };
    }
}
/** The five lender families the owner asked for, as grounded segment archetypes. */
const LENDER_ARCHETYPES = [
    {
        category: 'hard_money',
        name: 'South Florida hard money lender (asset-based)',
        companyType: 'Hard money / asset-based private lender',
        loanTypes: ['Acquisition', 'Refinance', 'Cash-out', 'Fix-and-flip'],
        maxLtvPercent: 75,
        interestRateRangeLowPct: 10,
        interestRateRangeHighPct: 16,
        marketsServed: ['Miami-Dade', 'Broward', 'Palm Beach', 'Naples'],
        loanSizeMinUsd: 250_000,
        loanSizeMaxUsd: 10_000_000,
        approvalRequirements: ['As-is appraisal', 'Title report', 'Borrower entity docs', 'Exit strategy'],
        publicSource: 'NMLS-registered hard money lenders · Florida OFR lender license database · private-lender directories',
        contactChannel: 'NMLS Consumer Access lookup by NMLS ID · lender public intake forms',
        applies: (d) => d.priceUsd !== null && d.priceUsd >= 500_000,
        baseFit: 82,
        rationale: 'Asset-based hard money funds fast on South Florida luxury collateral with flexible borrower credit.',
        nextAction: 'Request 2–3 hard money term sheets citing the asset ARV and exit plan.',
    },
    {
        category: 'private',
        name: 'Private credit / debt fund (CRE senior debt)',
        companyType: 'Private lender / debt fund',
        loanTypes: ['Senior acquisition', 'Bridge-to-stabilization', 'Mezzanine'],
        maxLtvPercent: 70,
        interestRateRangeLowPct: 8,
        interestRateRangeHighPct: 13,
        marketsServed: ['Miami-Dade', 'Broward', 'Palm Beach', 'Naples', 'Tampa'],
        loanSizeMinUsd: 1_000_000,
        loanSizeMaxUsd: 50_000_000,
        approvalRequirements: ['Sponsor track record', 'Operating statement / rent roll', 'Appraisal', 'Business plan'],
        publicSource: 'NMLS-registered private lenders · CRE debt brokers · private-credit fund directories',
        contactChannel: 'Lender public website intake forms · debt-broker introductions',
        applies: (d) => d.priceUsd !== null && d.priceUsd >= 1_000_000,
        baseFit: 78,
        rationale: 'Private credit funds underwrite luxury CRE with structured senior debt on strong sponsorship.',
        nextAction: 'Prepare a sponsor packet + operating model and request indicative term sheets from 2–3 debt funds.',
    },
    {
        category: 'bridge',
        name: 'Bridge lender (CRE short-term)',
        companyType: 'Bridge lender / transitional debt fund',
        loanTypes: ['Bridge acquisition', 'Bridge-to-sale', 'Bridge-to-takeout'],
        maxLtvPercent: 72,
        interestRateRangeLowPct: 9,
        interestRateRangeHighPct: 14,
        marketsServed: ['Miami-Dade', 'Broward', 'Palm Beach', 'Naples'],
        loanSizeMinUsd: 750_000,
        loanSizeMaxUsd: 25_000_000,
        approvalRequirements: ['Exit strategy', 'Appraisal', 'Sponsor financials', 'Business plan'],
        publicSource: 'NMLS-registered bridge lenders · CRE debt broker networks · private-credit fund directories',
        contactChannel: 'Lender public intake forms · broker introductions',
        applies: (d) => d.priceUsd !== null && d.priceUsd >= 750_000 && (d.isLuxury || d.isDevelopment),
        baseFit: 76,
        rationale: 'Bridge debt funds the gap between acquisition and stabilized takeout on luxury/transitional assets.',
        nextAction: 'Define the takeout (perm loan / agency / sale) and request 2 bridge term sheets.',
    },
    {
        category: 'construction',
        name: 'Construction lender (ground-up / renovation)',
        companyType: 'Construction lender / build-to-rent debt fund',
        loanTypes: ['Ground-up construction', 'Heavy rehab', 'Vertical improvements'],
        maxLtvPercent: 75,
        interestRateRangeLowPct: 10,
        interestRateRangeHighPct: 15,
        marketsServed: ['Miami-Dade', 'Broward', 'Palm Beach', 'Naples'],
        loanSizeMinUsd: 500_000,
        loanSizeMaxUsd: 30_000_000,
        approvalRequirements: ['Approved plans + permits', 'GC contract / budget', 'Appraisal (as-completed)', 'Sponsor track record'],
        publicSource: 'NMLS-registered construction lenders · Florida OFR lender database · CRE debt brokers',
        contactChannel: 'Lender public intake forms · contractor/architect referrals',
        applies: (d) => d.isDevelopment && (d.priceUsd === null || d.priceUsd >= 500_000),
        baseFit: 80,
        rationale: 'Construction debt funds ground-up and value-add luxury builds in South Florida with funded draws.',
        nextAction: 'Assemble approved plans, GC budget, and as-completed appraisal; request 2 construction term sheets.',
    },
    {
        category: 'commercial',
        name: 'Commercial lender (bank / agency CRE)',
        companyType: 'Bank / agency / life-co commercial lender',
        loanTypes: ['Permanent agency', 'Bank balance-sheet', 'Life-co perm'],
        maxLtvPercent: 65,
        interestRateRangeLowPct: 6,
        interestRateRangeHighPct: 9,
        marketsServed: ['Miami-Dade', 'Broward', 'Palm Beach', 'Naples', 'Tampa', 'Orlando'],
        loanSizeMinUsd: 2_000_000,
        loanSizeMaxUsd: 100_000_000,
        approvalRequirements: ['Stabilized NOI / DSCR ≥ 1.25', 'Sponsor financials', 'Appraisal', 'Environmental report'],
        publicSource: 'FDIC bank directory · Fannie Mae / Freddie Mac lender finder · life-co placement agents',
        contactChannel: 'Bank commercial lending intake · agency lender finder · placement agents',
        applies: (d) => d.priceUsd !== null && d.priceUsd >= 2_000_000 && !d.isDevelopment,
        baseFit: 72,
        rationale: 'Stabilized South Florida luxury CRE qualifies for lowest-cost agency/bank permanent debt.',
        nextAction: 'Once stabilized, request quotes from 2 agency-approved lenders + 1 bank balance-sheet lender.',
    },
];
function dealFitBonus(archetype, deals) {
    if (deals.length === 0)
        return 0;
    const matched = deals.filter(archetype.applies);
    if (matched.length === 0)
        return -8;
    const avgLuxury = matched.filter((d) => d.isLuxury).length / matched.length;
    const avgSouthFlorida = matched.filter((d) => d.isSouthFlorida).length / matched.length;
    return Math.round(avgLuxury * 6 + avgSouthFlorida * 8 + Math.min(matched.length, 4));
}
function matchedDealNames(archetype, deals) {
    return deals.filter(archetype.applies).slice(0, 5).map((d) => d.name);
}
/**
 * Derive lender profiles from live jv_deals signals and upsert them. When no
 * deals are present, the archetypes are still written at their base fit so the
 * owner always sees the canonical five lender families the engine tracks.
 */
export async function runLenderNetworkScan() {
    const snapshot = await readRankedDeals();
    const deals = snapshot.deals;
    const inputs = LENDER_ARCHETYPES.map((archetype) => {
        const bonus = dealFitBonus(archetype, deals);
        const fitScore = Math.max(0, Math.min(100, archetype.baseFit + bonus));
        return {
            category: archetype.category,
            name: archetype.name,
            companyType: archetype.companyType,
            loanTypes: archetype.loanTypes,
            maxLtvPercent: archetype.maxLtvPercent,
            interestRateRangeLowPct: archetype.interestRateRangeLowPct,
            interestRateRangeHighPct: archetype.interestRateRangeHighPct,
            marketsServed: archetype.marketsServed,
            loanSizeMinUsd: archetype.loanSizeMinUsd,
            loanSizeMaxUsd: archetype.loanSizeMaxUsd,
            approvalRequirements: archetype.approvalRequirements,
            publicSource: archetype.publicSource,
            contactChannel: archetype.contactChannel,
            fitScore,
            rationale: archetype.rationale,
            nextAction: archetype.nextAction,
            matchedDealNames: matchedDealNames(archetype, deals),
        };
    });
    const lenders = await upsertLenders(inputs);
    const countsByCategory = await lenderCountsByCategory();
    return {
        ok: snapshot.ok,
        marker: IVX_LENDER_NETWORK_ENGINE_MARKER,
        scannedAt: snapshot.scannedAt,
        dealsScanned: deals.length,
        lendersUpserted: lenders.length,
        lenders,
        countsByCategory,
        reason: snapshot.reason,
    };
}
/** Read-only dashboard snapshot (no scan). */
export async function buildLenderNetworkDashboard() {
    const lenders = await listLenders();
    const countsByCategory = await lenderCountsByCategory();
    const topByCategory = {};
    for (const category of Object.keys(countsByCategory)) {
        topByCategory[category] = lenders.find((l) => l.category === category) ?? null;
    }
    return {
        ok: true,
        marker: IVX_LENDER_NETWORK_ENGINE_MARKER,
        lenders,
        countsByCategory,
        totalLenders: lenders.length,
        topByCategory,
    };
}
export { DEFAULT_LENDER_COMPLIANCE_NOTE };
