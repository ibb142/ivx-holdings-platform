import { describe, expect, it } from 'bun:test';
import { clampScore, computeIdeaPriority, } from './ivx-innovation-store';
import { deriveIdeasFromSignals, parseRoiPercent, } from './ivx-innovation-engine';
import { estimateIdeaValueUsd, IDEA_VALUE_CEILING_USD } from './ivx-innovation-dashboard';
function baseSignal(overrides = {}) {
    return {
        scannedAt: new Date().toISOString(),
        ivxData: { ok: true, publishedProjects: 3, projectsWithoutMedia: 0, avgRoiPercent: null, reason: null },
        userBehavior: { estimatedConversations: 0, note: '' },
        performance: { openIncidents: 0, failedWork: 0, blockedWork: 0 },
        market: { portfolioConcentration: 'diversifying', publishedProjects: 3 },
        competitor: { missingCapabilities: 0, partialCapabilities: 0 },
        ...overrides,
    };
}
function makeIdea(scores, status) {
    return {
        id: 'idea-x',
        title: 'x',
        summary: 'x',
        category: 'product',
        signalSource: 'ivx_data',
        evidence: 'x',
        scores,
        priority: computeIdeaPriority(scores),
        status,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
}
describe('clampScore', () => {
    it('clamps to 0–100 integers and handles junk', () => {
        expect(clampScore(150)).toBe(100);
        expect(clampScore(-5)).toBe(0);
        expect(clampScore(42.6)).toBe(43);
        expect(clampScore('nope')).toBe(0);
        expect(clampScore(undefined)).toBe(0);
    });
});
describe('computeIdeaPriority', () => {
    it('rewards impact/revenue and penalizes complexity', () => {
        const easy = computeIdeaPriority({ confidence: 80, impact: 80, feasibility: 80, revenue: 80, complexity: 10 });
        const hard = computeIdeaPriority({ confidence: 80, impact: 80, feasibility: 80, revenue: 80, complexity: 95 });
        expect(easy).toBeGreaterThan(hard);
        expect(easy).toBeLessThanOrEqual(100);
        expect(hard).toBeGreaterThanOrEqual(0);
    });
    it('returns 0 for an all-zero score vector', () => {
        expect(computeIdeaPriority({ confidence: 0, impact: 0, feasibility: 0, revenue: 0, complexity: 0 })).toBe(0);
    });
});
describe('parseRoiPercent', () => {
    it('extracts a percentage from common strings', () => {
        expect(parseRoiPercent('30%')).toBe(30);
        expect(parseRoiPercent('expected 14.5% return')).toBe(14.5);
        expect(parseRoiPercent('n/a')).toBeNull();
        expect(parseRoiPercent(null)).toBeNull();
    });
});
describe('deriveIdeasFromSignals', () => {
    it('generates a media-fix idea only when projects lack media', () => {
        const without = deriveIdeasFromSignals(baseSignal());
        expect(without.some((i) => i.signalSource === 'ivx_data' && /media/i.test(i.title))).toBe(false);
        const withGap = deriveIdeasFromSignals(baseSignal({
            ivxData: { ok: true, publishedProjects: 3, projectsWithoutMedia: 2, avgRoiPercent: 20, reason: null },
        }));
        expect(withGap.some((i) => /visual deal sheets/i.test(i.title))).toBe(true);
    });
    it('proposes a liquidity marketplace when the portfolio is thin or empty', () => {
        const thin = deriveIdeasFromSignals(baseSignal({
            market: { portfolioConcentration: 'thin', publishedProjects: 1 },
        }));
        expect(thin.some((i) => i.category === 'business_model')).toBe(true);
    });
    it('proposes a reliability watchdog when performance signals are negative', () => {
        const ideas = deriveIdeasFromSignals(baseSignal({
            performance: { openIncidents: 2, failedWork: 1, blockedWork: 0 },
        }));
        expect(ideas.some((i) => i.signalSource === 'performance')).toBe(true);
    });
    it('grounds every idea with concrete evidence and valid scores', () => {
        const ideas = deriveIdeasFromSignals(baseSignal({
            ivxData: { ok: true, publishedProjects: 3, projectsWithoutMedia: 1, avgRoiPercent: 25, reason: null },
            performance: { openIncidents: 1, failedWork: 0, blockedWork: 0 },
            competitor: { missingCapabilities: 1, partialCapabilities: 2 },
        }));
        expect(ideas.length).toBeGreaterThan(0);
        for (const idea of ideas) {
            expect(idea.evidence.trim().length).toBeGreaterThan(0);
            for (const value of Object.values(idea.scores)) {
                expect(value).toBeGreaterThanOrEqual(0);
                expect(value).toBeLessThanOrEqual(100);
            }
        }
    });
});
describe('estimateIdeaValueUsd', () => {
    it('values shipped/approved fully, proposed at a discount, rejected at zero', () => {
        const scores = { confidence: 60, impact: 80, feasibility: 60, revenue: 90, complexity: 40 };
        const shipped = estimateIdeaValueUsd(makeIdea(scores, 'shipped'));
        const proposed = estimateIdeaValueUsd(makeIdea(scores, 'proposed'));
        const rejected = estimateIdeaValueUsd(makeIdea(scores, 'rejected'));
        expect(shipped).toBeGreaterThan(proposed);
        expect(proposed).toBeGreaterThan(0);
        expect(rejected).toBe(0);
        expect(shipped).toBeLessThanOrEqual(IDEA_VALUE_CEILING_USD);
    });
});
