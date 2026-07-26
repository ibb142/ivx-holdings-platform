import { describe, expect, it } from 'bun:test';
import { categorizeLead, deriveIvxMarkets, scoreLead, summarizeLeadScores, } from './ivx-lead-scoring-engine';
function baseRecord(overrides = {}) {
    const now = new Date().toISOString();
    return {
        id: overrides.id ?? 'investor-1',
        name: overrides.name ?? 'Jane Capital',
        partyType: overrides.partyType ?? 'investor',
        company: overrides.company ?? 'Capital Partners',
        email: overrides.email ?? '',
        phone: overrides.phone ?? '',
        location: overrides.location ?? '',
        investmentType: overrides.investmentType ?? '',
        accreditedStatus: overrides.accreditedStatus ?? 'unknown',
        preferredMarkets: overrides.preferredMarkets ?? [],
        preferredAssetClasses: overrides.preferredAssetClasses ?? [],
        typicalCheckSize: overrides.typicalCheckSize ?? '',
        investmentTimeline: overrides.investmentTimeline ?? '',
        notes: overrides.notes ?? '',
        lastContactDate: overrides.lastContactDate ?? null,
        leadScore: overrides.leadScore ?? 0,
        relationshipScore: overrides.relationshipScore ?? 0,
        status: overrides.status ?? 'prospect',
        source: overrides.source ?? 'owner_entered',
        sourceDetail: overrides.sourceDetail ?? '',
        createdAt: now,
        updatedAt: now,
    };
}
const REFERENCE = Date.parse('2026-05-31T00:00:00.000Z');
function context(overrides = {}) {
    return {
        ivxMarkets: overrides.ivxMarkets ?? ['pembroke pines, fl', 'jacksonville fl'],
        ivxAssetClasses: overrides.ivxAssetClasses ?? ['luxury homes', 'waterfront', 'multifamily'],
        referenceDate: overrides.referenceDate ?? REFERENCE,
    };
}
describe('categorizeLead', () => {
    it('buckets hot/warm/cold by threshold', () => {
        expect(categorizeLead(85)).toBe('hot');
        expect(categorizeLead(70)).toBe('hot');
        expect(categorizeLead(60)).toBe('warm');
        expect(categorizeLead(45)).toBe('warm');
        expect(categorizeLead(20)).toBe('cold');
    });
});
describe('deriveIvxMarkets', () => {
    it('lowercases, de-dups, and drops null locations', () => {
        expect(deriveIvxMarkets(['Pembroke Pines, FL', 'pembroke pines, fl', null, 'Miami']))
            .toEqual(['pembroke pines, fl', 'miami']);
    });
});
describe('scoreLead — evidence only, no fabrication', () => {
    it('marks website activity unavailable and excludes it from the denominator', () => {
        const score = scoreLead(baseRecord(), context());
        const website = score.signals.find((s) => s.key === 'websiteActivity');
        expect(website?.available).toBe(false);
        expect(website?.score).toBe(0);
    });
    it('a bare prospect with no evidence scores low (cold) on status only', () => {
        const score = scoreLead(baseRecord({ status: 'prospect' }), context());
        expect(score.evidenceCount).toBe(1); // only communication/status
        expect(score.category).toBe('cold');
    });
    it('a fully-evidenced, well-fit, recently-engaged investor scores hot', () => {
        const record = baseRecord({
            status: 'active',
            lastContactDate: '2026-05-25',
            typicalCheckSize: '$1,000,000',
            relationshipScore: 90,
            leadScore: 85,
            preferredMarkets: ['South Florida', 'Pembroke Pines'],
            preferredAssetClasses: ['Luxury homes'],
        });
        const score = scoreLead(record, context());
        expect(score.evidenceCount).toBe(7);
        expect(score.overall).toBeGreaterThanOrEqual(70);
        expect(score.category).toBe('hot');
    });
    it('rewards recent engagement over stale contact', () => {
        const recent = scoreLead(baseRecord({ lastContactDate: '2026-05-28' }), context());
        const stale = scoreLead(baseRecord({ lastContactDate: '2025-09-01' }), context());
        const recentSig = recent.signals.find((s) => s.key === 'engagement');
        const staleSig = stale.signals.find((s) => s.key === 'engagement');
        expect(recentSig?.score ?? 0).toBeGreaterThan(staleSig?.score ?? 0);
    });
    it('scores geography fit only when both sides have data', () => {
        const noMarkets = scoreLead(baseRecord({ preferredMarkets: [] }), context());
        expect(noMarkets.signals.find((s) => s.key === 'geographyFit')?.available).toBe(false);
        const matched = scoreLead(baseRecord({ preferredMarkets: ['Pembroke Pines'] }), context());
        expect(matched.signals.find((s) => s.key === 'geographyFit')?.score).toBe(100);
        const unmatched = scoreLead(baseRecord({ preferredMarkets: ['Seattle'] }), context());
        expect(unmatched.signals.find((s) => s.key === 'geographyFit')?.score).toBe(30);
        const noContext = scoreLead(baseRecord({ preferredMarkets: ['Pembroke Pines'] }), context({ ivxMarkets: [] }));
        expect(noContext.signals.find((s) => s.key === 'geographyFit')?.available).toBe(false);
    });
    it('larger check size yields a higher capital-capacity sub-score', () => {
        const big = scoreLead(baseRecord({ typicalCheckSize: '$2M' }), context());
        const small = scoreLead(baseRecord({ typicalCheckSize: '$60,000' }), context());
        const bigSig = big.signals.find((s) => s.key === 'capitalCapacity');
        const smallSig = small.signals.find((s) => s.key === 'capitalCapacity');
        expect(bigSig?.score ?? 0).toBeGreaterThan(smallSig?.score ?? 0);
    });
});
describe('summarizeLeadScores', () => {
    it('rolls up hot/warm/cold counts and the average', () => {
        const leads = [
            scoreLead(baseRecord({ id: 'a', status: 'active', lastContactDate: '2026-05-28', typicalCheckSize: '$2M', relationshipScore: 95, leadScore: 90, preferredMarkets: ['Pembroke Pines'], preferredAssetClasses: ['Luxury homes'] }), context()),
            scoreLead(baseRecord({ id: 'b', status: 'prospect' }), context()),
        ];
        const summary = summarizeLeadScores(leads);
        expect(summary.total).toBe(2);
        expect(summary.hot + summary.warm + summary.cold).toBe(2);
        expect(summary.scored).toBe(2);
        expect(summary.avgScore).toBeGreaterThan(0);
    });
});
