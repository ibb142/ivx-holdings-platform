import { describe, expect, it } from 'bun:test';
import { deriveProspects, normalizeMarket, } from './ivx-capital-network-engine';
import { clampScore, computeProspectOverall } from './ivx-capital-network-store';
function makeDeal(overrides = {}) {
    return {
        id: overrides.id ?? 'casa-rosario-001',
        name: overrides.name ?? 'Casa Rosario',
        location: overrides.location ?? 'Pembroke Pines, FL',
        priceUsd: overrides.priceUsd ?? 1_400_000,
        roiPercent: overrides.roiPercent ?? 30,
        minOwnershipUsd: overrides.minOwnershipUsd ?? 50,
        weightedScore: overrides.weightedScore ?? 90,
        completionScore: overrides.completionScore ?? 70,
        dataCompleteness: overrides.dataCompleteness ?? 1,
        isSouthFlorida: overrides.isSouthFlorida ?? true,
        isLuxury: overrides.isLuxury ?? true,
        isFractional: overrides.isFractional ?? true,
        isDevelopment: overrides.isDevelopment ?? false,
    };
}
function snapshot(deals) {
    return {
        scannedAt: new Date().toISOString(),
        ok: deals.length > 0,
        reason: deals.length > 0 ? null : 'no deals',
        deals,
        markets: deals.map((d) => d.location ?? '').filter(Boolean),
    };
}
describe('capital-network store scoring', () => {
    it('clampScore clamps to a 0–100 integer', () => {
        expect(clampScore(-10)).toBe(0);
        expect(clampScore(150)).toBe(100);
        expect(clampScore(63.7)).toBe(64);
        expect(clampScore('nope')).toBe(0);
    });
    it('computeProspectOverall stays in range and rewards deal fit', () => {
        const low = computeProspectOverall({ confidence: 10, relevance: 10, dealFit: 10 });
        const high = computeProspectOverall({ confidence: 90, relevance: 90, dealFit: 90 });
        expect(low).toBeGreaterThanOrEqual(0);
        expect(high).toBeLessThanOrEqual(100);
        expect(high).toBeGreaterThan(low);
        // Deal fit is weighted highest.
        const fitHeavy = computeProspectOverall({ confidence: 0, relevance: 0, dealFit: 100 });
        const confHeavy = computeProspectOverall({ confidence: 100, relevance: 0, dealFit: 0 });
        expect(fitHeavy).toBeGreaterThan(confHeavy);
    });
});
describe('deriveProspects', () => {
    it('returns nothing for an empty / failed signal', () => {
        expect(deriveProspects(snapshot([]))).toEqual([]);
        expect(deriveProspects({ scannedAt: '', ok: false, reason: 'down', deals: [], markets: [] })).toEqual([]);
    });
    it('derives buyer/investor/developer/partner profiles grounded in the real deal', () => {
        const out = deriveProspects(snapshot([makeDeal({ isDevelopment: true })]));
        expect(out.length).toBeGreaterThan(0);
        const types = new Set(out.map((p) => p.type));
        expect(types.has('buyer')).toBe(true);
        expect(types.has('investor')).toBe(true);
        expect(types.has('developer')).toBe(true);
        expect(types.has('partner')).toBe(true);
        for (const p of out) {
            expect(p.segment.trim().length).toBeGreaterThan(0);
            // Grounded: evidence references the real deal name (never fabricated).
            expect(p.evidence).toContain('Casa Rosario');
            expect(p.publicSource.trim().length).toBeGreaterThan(0);
            expect(p.nextAction.trim().length).toBeGreaterThan(0);
            expect((p.complianceNote ?? '').toLowerCase()).toContain('never invents');
            expect(p.matchedDealNames ?? []).toContain('Casa Rosario');
            for (const v of [p.scores.confidence, p.scores.relevance, p.scores.dealFit]) {
                expect(v).toBeGreaterThanOrEqual(0);
                expect(v).toBeLessThanOrEqual(100);
            }
        }
    });
    it('rates a South Florida luxury deal more relevant than a generic out-of-market deal', () => {
        const sfla = deriveProspects(snapshot([makeDeal()]));
        const generic = deriveProspects(snapshot([
            makeDeal({
                id: 'generic-1',
                name: 'Midwest Warehouse',
                location: 'Columbus, OH',
                priceUsd: 400_000,
                isSouthFlorida: false,
                isLuxury: false,
                isFractional: false,
                isDevelopment: true,
            }),
        ]));
        const sflaInvestor = sfla.find((p) => p.type === 'investor');
        const genericInvestor = generic.find((p) => p.type === 'investor');
        expect(sflaInvestor).toBeDefined();
        expect(genericInvestor).toBeDefined();
        expect(sflaInvestor.scores.relevance).toBeGreaterThan(genericInvestor.scores.relevance ?? 0);
    });
    it('de-dupes a segment across deals and accumulates matched deal names', () => {
        const out = deriveProspects(snapshot([
            makeDeal({ id: 'a', name: 'Casa Rosario' }),
            makeDeal({ id: 'b', name: 'Bayfront Tower', location: 'Miami, FL' }),
        ]));
        const segments = out.map((p) => `${p.type}::${p.segment}`);
        // No duplicate (type, segment) keys.
        expect(new Set(segments).size).toBe(segments.length);
        // At least one profile is matched to both deals.
        const multi = out.find((p) => (p.matchedDealNames ?? []).length >= 2);
        expect(multi).toBeDefined();
        expect(multi.matchedDealNames).toContain('Casa Rosario');
        expect(multi.matchedDealNames).toContain('Bayfront Tower');
    });
});
describe('normalizeMarket', () => {
    it('returns a trimmed market or null', () => {
        expect(normalizeMarket('  Pembroke Pines, FL  ')).toBe('Pembroke Pines, FL');
        expect(normalizeMarket('')).toBeNull();
        expect(normalizeMarket(null)).toBeNull();
    });
});
