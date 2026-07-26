/**
 * IVX South Florida Luxury Capital Intelligence Network — dashboard aggregator (owner-only).
 *
 * BLOCK 17 (revised). Read-only reduction of the durable prospect store into the
 * owner tablet dashboard:
 *   - Best Buyer / Investor / Developer / Partner today
 *   - Best Market today (from real deal locations)
 *   - Best Follow-Up today (the single highest-fit next action)
 *   - Buyer / Investor intelligence groupings
 *   - Opportunity matching (IVX deal → best-fit prospect profiles)
 *
 * Never mutates. Deterministic + runtime-light. Carries the compliance/privacy
 * disclaimer so the owner always sees that these are PROFILES, not fabricated people.
 */
import { listProspects, DEFAULT_COMPLIANCE_NOTE, } from './ivx-capital-network-store';
export const IVX_CAPITAL_NETWORK_DASHBOARD_MARKER = 'ivx-capital-network-dashboard-sfla-2026-05-30';
function activeOnly(items) {
    return items.filter((p) => p.status !== 'dismissed');
}
/** Build an AI recommendation from the highest-fit active prospect of a type. */
function recommendBest(items, type) {
    const pool = type === 'any' ? items : items.filter((p) => p.type === type);
    const best = [...pool].sort((a, b) => b.overall - a.overall)[0] ?? null;
    if (!best) {
        return {
            prospect: null,
            why: 'No qualifying segment yet — run a scan once IVX has a published South Florida luxury deal.',
            evidence: 'No prospect profiles derived (0 matching deals).',
            confidence: 0,
            risks: [],
            nextAction: 'Publish or refresh a deal in jv_deals, then re-scan the capital network.',
        };
    }
    return {
        prospect: best,
        why: best.rationale,
        evidence: best.evidence,
        confidence: best.scores.confidence,
        risks: best.risks,
        nextAction: best.nextAction,
    };
}
function pickBestMarket(items) {
    if (items.length === 0)
        return null;
    const byMarket = new Map();
    for (const p of items) {
        const key = p.market || 'South Florida (market TBD)';
        const arr = byMarket.get(key) ?? [];
        arr.push(p);
        byMarket.set(key, arr);
    }
    let best = null;
    for (const [market, group] of byMarket) {
        const avgFit = Math.round(group.reduce((sum, g) => sum + g.overall, 0) / group.length);
        const topSegment = [...group].sort((a, b) => b.overall - a.overall)[0]?.segment ?? null;
        const candidate = { market, prospectCount: group.length, avgFit, topSegment };
        if (!best || candidate.avgFit > best.avgFit || (candidate.avgFit === best.avgFit && candidate.prospectCount > best.prospectCount)) {
            best = candidate;
        }
    }
    return best;
}
/** Invert prospects → matches by IVX deal (opportunity matching). */
function buildMatches(items) {
    const byDeal = new Map();
    for (const p of items) {
        for (const dealName of p.matchedDealNames) {
            const arr = byDeal.get(dealName) ?? [];
            arr.push({ id: p.id, type: p.type, segment: p.segment, dealFit: p.scores.dealFit, overall: p.overall });
            byDeal.set(dealName, arr);
        }
    }
    return Array.from(byDeal.entries())
        .map(([dealName, prospects]) => ({
        dealName,
        prospects: prospects.sort((a, b) => b.overall - a.overall).slice(0, 6),
    }))
        .sort((a, b) => (b.prospects[0]?.overall ?? 0) - (a.prospects[0]?.overall ?? 0));
}
export async function buildCapitalNetworkDashboard() {
    const all = await listProspects();
    const active = activeOnly(all);
    const totals = {
        total: all.length,
        buyer: all.filter((p) => p.type === 'buyer').length,
        investor: all.filter((p) => p.type === 'investor').length,
        developer: all.filter((p) => p.type === 'developer').length,
        partner: all.filter((p) => p.type === 'partner').length,
    };
    return {
        marker: IVX_CAPITAL_NETWORK_DASHBOARD_MARKER,
        generatedAt: new Date().toISOString(),
        totals,
        bestBuyerToday: recommendBest(active, 'buyer'),
        bestInvestorToday: recommendBest(active, 'investor'),
        bestDeveloperToday: recommendBest(active, 'developer'),
        bestPartnerToday: recommendBest(active, 'partner'),
        bestFollowUpToday: recommendBest(active, 'any'),
        bestMarketToday: pickBestMarket(active),
        buyerIntelligence: active.filter((p) => p.type === 'buyer').slice(0, 8),
        investorIntelligence: active.filter((p) => p.type === 'investor' || p.type === 'partner').slice(0, 8),
        matches: buildMatches(active),
        topProspects: active.slice(0, 12),
        disclaimer: DEFAULT_COMPLIANCE_NOTE,
    };
}
