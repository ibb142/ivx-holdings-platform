import { describe, expect, it } from 'bun:test';
import { classifyMatchRole, matchDealToContacts, scoreDealMatch, summarizeMatching, } from './ivx-deal-matching-engine';
function deal(overrides = {}) {
    return {
        id: overrides.id ?? 'casa-rosario-001',
        name: overrides.name ?? 'Casa Rosario',
        location: overrides.location ?? 'Pembroke Pines, FL',
        price: overrides.price ?? '$1,400,000',
        roi: overrides.roi ?? '30%',
        timeline: overrides.timeline ?? '14-24 months',
        ownershipMinimum: overrides.ownershipMinimum ?? '$50,000',
        status: overrides.status ?? 'active',
        published: overrides.published ?? true,
        mediaCount: overrides.mediaCount ?? 2,
    };
}
function contact(overrides = {}) {
    const now = new Date().toISOString();
    return {
        id: overrides.id ?? 'investor-1',
        name: overrides.name ?? 'Jane Capital',
        partyType: overrides.partyType ?? 'investor',
        company: overrides.company ?? 'Capital Partners',
        email: '', phone: '', location: '',
        investmentType: overrides.investmentType ?? 'Family office',
        accreditedStatus: overrides.accreditedStatus ?? 'unknown',
        preferredMarkets: overrides.preferredMarkets ?? [],
        preferredAssetClasses: overrides.preferredAssetClasses ?? [],
        typicalCheckSize: overrides.typicalCheckSize ?? '',
        investmentTimeline: overrides.investmentTimeline ?? '',
        notes: '',
        lastContactDate: overrides.lastContactDate ?? null,
        leadScore: overrides.leadScore ?? 0,
        relationshipScore: overrides.relationshipScore ?? 0,
        status: overrides.status ?? 'prospect',
        source: 'owner_entered',
        sourceDetail: '',
        createdAt: now,
        updatedAt: now,
    };
}
describe('classifyMatchRole', () => {
    it('classifies role from investment type keywords', () => {
        expect(classifyMatchRole('Private credit lender')).toBe('lender');
        expect(classifyMatchRole('Luxury brokerage referral partner')).toBe('partner');
        expect(classifyMatchRole('End-user buyer / second home')).toBe('buyer');
        expect(classifyMatchRole('Family office')).toBe('investor');
        expect(classifyMatchRole('')).toBe('investor');
    });
});
describe('scoreDealMatch — evidence only, no fabrication', () => {
    it('does not score a fit dimension when data is missing on either side', () => {
        const match = scoreDealMatch(deal(), contact());
        expect(match.geographyFit.available).toBe(false);
        expect(match.capitalFit.available).toBe(false);
        expect(match.timelineFit.available).toBe(false);
        expect(match.matchScore).toBe(0);
        expect(match.riskNotes.length).toBeGreaterThan(0);
    });
    it('scores a well-fit investor highly with evidence', () => {
        const match = scoreDealMatch(deal(), contact({
            preferredMarkets: ['South Florida', 'Pembroke Pines'],
            typicalCheckSize: '$250,000',
            investmentTimeline: '24 months',
            relationshipScore: 80,
            accreditedStatus: 'accredited',
        }));
        expect(match.geographyFit.score).toBe(100);
        expect(match.capitalFit.available).toBe(true);
        expect(match.timelineFit.score).toBe(100);
        expect(match.matchScore).toBeGreaterThanOrEqual(70);
        expect(match.evidence.length).toBeGreaterThan(2);
    });
    it('flags a check below the minimum', () => {
        const match = scoreDealMatch(deal(), contact({ typicalCheckSize: '$10,000' }));
        expect(match.capitalFit.available).toBe(true);
        expect(match.capitalFit.score).toBe(30);
    });
    it('penalizes geography mismatch', () => {
        const match = scoreDealMatch(deal(), contact({ preferredMarkets: ['Seattle'] }));
        expect(match.geographyFit.score).toBe(30);
    });
});
describe('matchDealToContacts', () => {
    it('ranks matches and picks the best contact per role', () => {
        const contacts = [
            contact({ id: 'a', name: 'Strong Investor', investmentType: 'Family office', preferredMarkets: ['Pembroke Pines'], typicalCheckSize: '$300k', investmentTimeline: '36 months', relationshipScore: 90 }),
            contact({ id: 'b', name: 'Weak Investor', investmentType: 'Family office', preferredMarkets: ['Denver'], typicalCheckSize: '$5,000' }),
            contact({ id: 'c', name: 'Bridge Lender', investmentType: 'Private credit lender', preferredMarkets: ['Miami'], typicalCheckSize: '$2M', investmentTimeline: '12 months' }),
        ];
        const set = matchDealToContacts(deal(), contacts);
        expect(set.totalContacts).toBe(3);
        expect(set.matches[0]?.matchScore ?? 0).toBeGreaterThanOrEqual(set.matches[1]?.matchScore ?? 0);
        expect(set.best.investor?.name).toBe('Strong Investor');
        expect(set.best.lender?.name).toBe('Bridge Lender');
        expect(set.best.buyer).toBeNull();
    });
});
describe('summarizeMatching', () => {
    it('counts strong matches across deal sets', () => {
        const strong = scoreDealMatch(deal(), contact({
            preferredMarkets: ['Pembroke Pines'], typicalCheckSize: '$300k', investmentTimeline: '36 months', relationshipScore: 90,
        }));
        const set = { dealId: 'd', dealName: 'Casa Rosario', dealLocation: 'Pembroke Pines, FL', dealSummary: '', totalContacts: 1, matches: [strong], best: { investor: strong, buyer: null, lender: null, partner: null } };
        const summary = summarizeMatching([set], 1);
        expect(summary.deals).toBe(1);
        expect(summary.contacts).toBe(1);
        expect(summary.strongMatches).toBe(1);
    });
});
