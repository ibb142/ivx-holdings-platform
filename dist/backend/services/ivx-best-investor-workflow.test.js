import { describe, expect, it } from 'bun:test';
import { extractDealQuery, selectDealForQuery, rankInvestorsForDeal, IVX_BEST_INVESTOR_WORKFLOW_MARKER, } from './ivx-best-investor-workflow';
function deal(overrides = {}) {
    return {
        id: 'casa-rosario-001',
        name: 'Casa Rosario',
        location: 'Pembroke Pines, FL',
        price: '$1,400,000',
        roi: '30%',
        timeline: '14-24 months',
        ownershipMinimum: '$50',
        status: 'active',
        published: true,
        mediaCount: 0,
        ...overrides,
    };
}
function investor(overrides = {}) {
    const now = new Date().toISOString();
    return {
        id: 'investor-1',
        name: 'Jane Capital',
        partyType: 'investor',
        company: 'Capital Co',
        email: '',
        phone: '',
        location: 'Miami, FL',
        investmentType: 'Family office',
        accreditedStatus: 'accredited',
        preferredMarkets: ['Pembroke Pines'],
        preferredAssetClasses: ['Luxury condos'],
        typicalCheckSize: '$2,000,000',
        investmentTimeline: '24 months',
        notes: '',
        lastContactDate: null,
        leadScore: 80,
        relationshipScore: 70,
        status: 'prospect',
        source: 'owner_entered',
        sourceDetail: '',
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}
describe('extractDealQuery', () => {
    it('strips the natural-language wrapper to the deal phrase', () => {
        expect(extractDealQuery('Find the best investor for Casa Rosario')).toBe('casa rosario');
        expect(extractDealQuery('best investor for deal Casa Rosario?')).toBe('casa rosario');
        expect(extractDealQuery('who is the best investor for the Casa Rosario project')).toBe('casa rosario');
    });
});
describe('selectDealForQuery', () => {
    const projects = [deal(), deal({ id: 'perez', name: 'Perez Residence', location: 'Miami, FL' })];
    it('matches by exact and substring name', () => {
        expect(selectDealForQuery(projects, 'casa rosario')?.id).toBe('casa-rosario-001');
        expect(selectDealForQuery(projects, 'perez')?.id).toBe('perez');
    });
    it('returns null when nothing credibly matches and a query is given', () => {
        expect(selectDealForQuery(projects, 'nonexistent tower')).toBeNull();
    });
    it('returns null for an empty project list', () => {
        expect(selectDealForQuery([], 'casa rosario')).toBeNull();
    });
});
describe('rankInvestorsForDeal', () => {
    it('ranks best-first and picks the top investor-role contact', () => {
        const strong = investor({ id: 'a', name: 'Strong Fit' });
        const weak = investor({
            id: 'b',
            name: 'Weak Fit',
            preferredMarkets: ['Seattle'],
            typicalCheckSize: '$10',
            investmentTimeline: '3 months',
            relationshipScore: 0,
        });
        const { ranked, bestInvestor } = rankInvestorsForDeal(deal(), [weak, strong]);
        expect(ranked).toHaveLength(2);
        expect(ranked[0].matchScore).toBeGreaterThanOrEqual(ranked[1].matchScore);
        expect(bestInvestor?.contactId).toBe('a');
        expect(bestInvestor?.role).toBe('investor');
    });
    it('returns no best investor for an empty CRM', () => {
        const { ranked, bestInvestor } = rankInvestorsForDeal(deal(), []);
        expect(ranked).toHaveLength(0);
        expect(bestInvestor).toBeNull();
    });
});
describe('marker', () => {
    it('is stable', () => {
        expect(IVX_BEST_INVESTOR_WORKFLOW_MARKER).toBe('ivx-best-investor-workflow-2026-05-31');
    });
});
