import { describe, expect, test } from 'bun:test';
import { buildDealIntelligenceBlock, compareDeals, parseCurrency, parsePercent, parseTimelineMonths, rankDeals, recommendInvestment, scoreDeal, } from './ivx-deal-intelligence';
function project(overrides) {
    return {
        id: 'p-1',
        name: 'Test Deal',
        location: 'Miami, FL',
        price: '$1,000,000',
        roi: '20%',
        timeline: '18 months',
        ownershipMinimum: '$50',
        status: 'active',
        published: true,
        mediaCount: 3,
        ...overrides,
    };
}
const casaRosario = project({
    id: 'casa-rosario-001',
    name: 'Casa Rosario',
    location: 'Pembroke Pines, FL',
    price: '$1,400,000',
    roi: '30%',
    timeline: '14-24 months',
    ownershipMinimum: '$50',
});
const perez = project({
    id: 'perez-001',
    name: 'Perez Residence',
    location: 'Miami, FL',
    price: '$3,125,000',
    roi: '25%',
    timeline: '24 months',
    ownershipMinimum: '$100',
});
function projectsResult(projects) {
    return {
        ok: true,
        configured: true,
        source: 'supabase:jv_deals',
        fetchedAt: '2026-05-30T00:00:00.000Z',
        httpStatus: 200,
        totalRows: projects.length,
        publishedCount: projects.length,
        projects,
        projectNames: projects.map((p) => p.name),
        error: null,
        missingEnv: [],
    };
}
describe('value parsers', () => {
    test('parseCurrency handles $, commas, and M/K suffixes', () => {
        expect(parseCurrency('$1,400,000')).toBe(1_400_000);
        expect(parseCurrency('1.4M')).toBe(1_400_000);
        expect(parseCurrency('$50')).toBe(50);
        expect(parseCurrency(null)).toBeNull();
        expect(parseCurrency('n/a')).toBeNull();
    });
    test('parsePercent strips % sign', () => {
        expect(parsePercent('30%')).toBe(30);
        expect(parsePercent('25')).toBe(25);
        expect(parsePercent(null)).toBeNull();
    });
    test('parseTimelineMonths handles ranges, years, and non-durations', () => {
        expect(parseTimelineMonths('14-24 months')).toBe(19);
        expect(parseTimelineMonths('18 months')).toBe(18);
        expect(parseTimelineMonths('2 years')).toBe(24);
        expect(parseTimelineMonths('Monthly')).toBeNull();
        expect(parseTimelineMonths(null)).toBeNull();
    });
});
describe('scoreDeal', () => {
    test('produces a 0-100 weighted score and buy/hold/avoid', () => {
        const score = scoreDeal(casaRosario);
        expect(score.weightedScore).toBeGreaterThan(0);
        expect(score.weightedScore).toBeLessThanOrEqual(100);
        expect(['buy', 'hold', 'avoid', 'insufficient-data']).toContain(score.recommendation);
        expect(score.metrics.roiPercent).toBe(30);
        expect(score.metrics.priceUsd).toBe(1_400_000);
        expect(score.rationale).toContain('Casa Rosario');
    });
    test('higher ROI scores higher than lower ROI, all else equal', () => {
        const high = scoreDeal(project({ roi: '35%' }));
        const low = scoreDeal(project({ roi: '8%' }));
        expect(high.roiScore).toBeGreaterThan(low.roiScore);
        expect(high.weightedScore).toBeGreaterThan(low.weightedScore);
    });
    test('flags missing economics as risk and lowers confidence', () => {
        const score = scoreDeal(project({ price: null, roi: null, ownershipMinimum: null, timeline: null, location: null }));
        expect(score.risks.length).toBeGreaterThan(0);
        expect(score.risks.join(' ')).toContain('Missing price');
        expect(score.recommendation).toBe('insufficient-data');
    });
    test('long timeline is surfaced as a risk', () => {
        const score = scoreDeal(project({ timeline: '40 months' }));
        expect(score.risks.join(' ')).toContain('Long completion horizon');
    });
});
describe('rankDeals', () => {
    test('orders by weighted score descending', () => {
        const ranked = rankDeals([perez, casaRosario]);
        expect(ranked).toHaveLength(2);
        for (let i = 1; i < ranked.length; i += 1) {
            expect(ranked[i - 1].weightedScore).toBeGreaterThanOrEqual(ranked[i].weightedScore);
        }
    });
});
describe('compareDeals', () => {
    test('compares two named deals and explains differences', () => {
        const comparison = compareDeals([casaRosario, perez], 'Casa Rosario', 'Perez Residence');
        expect(comparison.found).toBe(true);
        expect(comparison.a?.name).toBe('Casa Rosario');
        expect(comparison.b?.name).toBe('Perez Residence');
        expect(comparison.differences.some((d) => d.startsWith('Expected ROI'))).toBe(true);
        expect(comparison.summary).toContain('/100');
    });
    test('reports missing deals honestly', () => {
        const comparison = compareDeals([casaRosario], 'Casa Rosario', 'Nonexistent Tower');
        expect(comparison.found).toBe(false);
        expect(comparison.missing).toContain('Nonexistent Tower');
    });
});
describe('recommendInvestment', () => {
    test('recommends a top pick that clears the minimum', () => {
        const rec = recommendInvestment([casaRosario, perez], 100_000);
        expect(rec.topPick).not.toBeNull();
        expect(rec.affordable.length).toBeGreaterThan(0);
        expect(rec.rationale).toContain('100,000');
        expect(rec.caution.toLowerCase()).toContain('not financial advice');
    });
    test('separates deals blocked by a higher minimum', () => {
        const expensive = project({ name: 'Big Min', ownershipMinimum: '$500,000' });
        const rec = recommendInvestment([expensive], 100_000);
        expect(rec.blockedByMinimum.map((s) => s.name)).toContain('Big Min');
    });
});
describe('buildDealIntelligenceBlock', () => {
    test('renders ranking, highest ROI, and risk guidance', () => {
        const block = buildDealIntelligenceBlock(projectsResult([casaRosario, perez]));
        expect(block).not.toBeNull();
        expect(block).toContain('IVX DEAL INTELLIGENCE');
        expect(block).toContain('RANKING');
        expect(block).toContain('Casa Rosario');
        expect(block).toContain('HIGHEST ROI: Casa Rosario at 30%');
        expect(block).toContain('decision support');
    });
    test('returns null when there are no published projects', () => {
        expect(buildDealIntelligenceBlock(projectsResult([]))).toBeNull();
    });
});
