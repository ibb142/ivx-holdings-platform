import { describe, expect, it } from 'bun:test';
import { clampScore, computeOverallScore, } from './ivx-opportunity-store';
import { buildProfitLadder, buildResearchLayer, deriveOpportunities, deriveAlerts, } from './ivx-opportunity-engine';
import { selectBestOpportunity } from './ivx-opportunity-dashboard';
function makeDealScore(overrides = {}) {
    return {
        id: 'deal-1',
        name: 'Casa Rosario',
        roiScore: 100,
        timelineScore: 90,
        riskScore: 80,
        completionScore: 70,
        weightedScore: 90,
        recommendation: 'buy',
        rationale: 'Strong deal.',
        risks: [],
        metrics: {
            roiPercent: 30,
            priceUsd: 1_400_000,
            minOwnershipUsd: 50,
            timelineMonths: 18,
            status: 'active',
            published: true,
            mediaCount: 0,
            dataCompleteness: 1,
        },
        ...overrides,
    };
}
function baseSignal(overrides = {}) {
    return {
        scannedAt: new Date().toISOString(),
        deals: { ok: true, publishedProjects: 3, rankedDeals: [makeDealScore()], reason: null },
        competitor: { missingCapabilities: 2, partialCapabilities: 1 },
        reliability: { openIncidents: 0 },
        ...overrides,
    };
}
function makeOpportunity(overrides = {}) {
    const scores = { evidence: 80, risk: 70, speed: 60, capital: 90, upside: 85 };
    return {
        id: 'opp-1',
        title: 'Test opportunity',
        summary: 'x',
        category: 'real_estate',
        capitalRequiredUsd: 50,
        upsideLowUsd: 100,
        upsideHighUsd: 200,
        timeline: '~18 months',
        scores,
        overall: computeOverallScore(scores),
        confidence: 80,
        evidence: 'x',
        evidenceLinks: [],
        riskWarnings: [],
        legalWarning: 'x',
        nextActions: [],
        profitLadder: [],
        executionPlan: {
            actionPlan: [], contacts: [], documentsNeeded: [], fundingPath: '', expectedUpside: '', worstCaseRisk: '', nextThreeActions: [],
        },
        status: 'new',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...overrides,
    };
}
describe('opportunity scoring', () => {
    it('clamps scores to 0–100 integers', () => {
        expect(clampScore(150)).toBe(100);
        expect(clampScore(-10)).toBe(0);
        expect(clampScore(42.6)).toBe(43);
        expect(clampScore('nope')).toBe(0);
    });
    it('overall score is monotonic in upside', () => {
        const low = computeOverallScore({ evidence: 50, risk: 50, speed: 50, capital: 50, upside: 10 });
        const high = computeOverallScore({ evidence: 50, risk: 50, speed: 50, capital: 50, upside: 90 });
        expect(high).toBeGreaterThan(low);
    });
    it('overall score rewards evidence', () => {
        const weak = computeOverallScore({ evidence: 10, risk: 50, speed: 50, capital: 50, upside: 50 });
        const strong = computeOverallScore({ evidence: 95, risk: 50, speed: 50, capital: 50, upside: 50 });
        expect(strong).toBeGreaterThan(weak);
    });
});
describe('profit ladder', () => {
    it('produces all eight tiers from $1 to $100M+', () => {
        const ladder = buildProfitLadder('real_estate', 50, 420_000);
        expect(ladder).toHaveLength(8);
        expect(ladder[0].tier).toBe('$1 → $10');
        expect(ladder[7].tier).toBe('$10M → $100M+');
    });
    it('flags rungs beyond the evidenced ceiling as speculative with a clear warning', () => {
        const ladder = buildProfitLadder('real_estate', 50, 1_000);
        const beyond = ladder.find((s) => s.toUsd > 1_000);
        expect(beyond).toBeDefined();
        expect(beyond.probability).toBe('speculative');
        expect(beyond.proof.toLowerCase()).toContain('no ivx data');
    });
    it('every rung carries a legal warning', () => {
        const ladder = buildProfitLadder('financing', null, null);
        expect(ladder.every((s) => s.legalWarning.length > 0)).toBe(true);
    });
});
describe('opportunity derivation', () => {
    it('derives a deal-grounded opportunity with evidence and a profit ladder', () => {
        const opps = deriveOpportunities(baseSignal());
        const deal = opps.find((o) => o.title.includes('Casa Rosario'));
        expect(deal).toBeDefined();
        expect(deal.evidence).toContain('Casa Rosario');
        expect((deal?.profitLadder ?? []).length).toBe(8);
        expect((deal?.executionPlan?.nextThreeActions ?? []).length).toBe(3);
    });
    it('never fabricates upside when price or ROI is missing', () => {
        const signal = baseSignal({
            deals: { ok: true, publishedProjects: 1, rankedDeals: [makeDealScore({ metrics: { ...makeDealScore().metrics, roiPercent: null, priceUsd: null } })], reason: null },
        });
        const opps = deriveOpportunities(signal);
        const deal = opps[0];
        expect(deal.upsideLowUsd).toBeNull();
        expect(deal.upsideHighUsd).toBeNull();
    });
    it('generates investor + financing + capability opportunities from the right signals', () => {
        const opps = deriveOpportunities(baseSignal());
        const categories = new Set(opps.map((o) => o.category));
        expect(categories.has('investor')).toBe(true);
        expect(categories.has('financing')).toBe(true);
        expect(categories.has('technology_business')).toBe(true);
    });
    it('produces no opportunities when there are no signals at all', () => {
        const empty = baseSignal({
            deals: { ok: false, publishedProjects: 0, rankedDeals: [], reason: 'no source' },
            competitor: { missingCapabilities: 0, partialCapabilities: 0 },
        });
        expect(deriveOpportunities(empty)).toHaveLength(0);
    });
});
describe('alerts + best selection + research layer', () => {
    it('raises a high-upside alert for strong opportunities', () => {
        const alerts = deriveAlerts([makeOpportunity({ scores: { evidence: 70, risk: 60, speed: 60, capital: 80, upside: 80 } })]);
        expect(alerts.some((a) => a.type === 'high_upside')).toBe(true);
    });
    it('selects the highest-overall active opportunity', () => {
        const best = selectBestOpportunity([
            makeOpportunity({ id: 'a', overall: 40, scores: { evidence: 40, risk: 40, speed: 40, capital: 40, upside: 40 } }),
            makeOpportunity({ id: 'b', overall: 90, scores: { evidence: 90, risk: 90, speed: 90, capital: 90, upside: 90 } }),
        ]);
        expect(best?.id).toBe('b');
    });
    it('ignores dismissed/closed opportunities when selecting best', () => {
        const best = selectBestOpportunity([
            makeOpportunity({ id: 'a', overall: 95, status: 'dismissed' }),
            makeOpportunity({ id: 'b', overall: 50, status: 'new' }),
        ]);
        expect(best?.id).toBe('b');
    });
    it('reports the multi-AI research layer sources', () => {
        const research = buildResearchLayer();
        const kinds = new Set(research.map((r) => r.kind));
        expect(kinds.has('internal_ai')).toBe(true);
        expect(kinds.has('external_ai')).toBe(true);
        expect(kinds.has('document_analysis')).toBe(true);
    });
});
