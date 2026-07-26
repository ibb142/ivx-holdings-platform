import { describe, expect, it } from 'bun:test';
import { scoreDiscoveredLead, draftOutreach, classifySouthFlorida, classifyLeadCategory, isVerifiableSecLead, } from './ivx-lead-discovery';
function investor(overrides = {}) {
    return {
        cik: overrides.cik ?? '0001234567',
        accessionNumber: overrides.accessionNumber ?? '0001234567-26-000001',
        entityName: overrides.entityName ?? 'Rosario Capital Partners LP',
        entityType: overrides.entityType ?? 'Limited Partnership',
        jurisdiction: overrides.jurisdiction ?? 'DE',
        businessStreet: overrides.businessStreet ?? '100 Biscayne Blvd',
        businessCity: overrides.businessCity ?? 'Miami',
        businessState: overrides.businessState ?? 'FL',
        businessZip: overrides.businessZip ?? '33131',
        businessPhone: overrides.businessPhone ?? '3055551212',
        industryGroup: overrides.industryGroup ?? 'Real Estate',
        relatedPersons: overrides.relatedPersons ?? [
            { firstName: 'Jane', lastName: 'Doe', fullName: 'Jane Doe', relationships: ['Executive Officer'], city: 'Miami', stateOrCountry: 'FL' },
        ],
        totalOfferingAmountUsd: 'totalOfferingAmountUsd' in overrides ? (overrides.totalOfferingAmountUsd ?? null) : 50_000_000,
        totalAmountSoldUsd: overrides.totalAmountSoldUsd ?? null,
        minimumInvestmentUsd: overrides.minimumInvestmentUsd ?? null,
        investorsAlreadyInvested: overrides.investorsAlreadyInvested ?? null,
        filingDate: overrides.filingDate ?? new Date().toISOString().slice(0, 10),
        dateOfFirstSale: overrides.dateOfFirstSale ?? null,
        filingUrl: overrides.filingUrl ?? 'https://www.sec.gov/Archives/edgar/data/1234567/000123456726000001/primary_doc.xml',
    };
}
describe('scoreDiscoveredLead — deterministic, explainable ranking', () => {
    it('scores a strong, recent, real-estate filing highly with reasons', () => {
        const { score, reasons } = scoreDiscoveredLead(investor(), 'real estate');
        expect(score).toBeGreaterThan(60);
        expect(score).toBeLessThanOrEqual(100);
        expect(reasons.length).toBeGreaterThan(0);
        expect(reasons.some((r) => r.includes('capital'))).toBe(true);
        expect(reasons.some((r) => r.toLowerCase().includes('industry'))).toBe(true);
    });
    it('does not fabricate capital points when the offering is undisclosed', () => {
        const { score, reasons } = scoreDiscoveredLead(investor({ totalOfferingAmountUsd: null }), 'real estate');
        expect(reasons.some((r) => r.includes('not disclosed'))).toBe(true);
        const withCapital = scoreDiscoveredLead(investor(), 'real estate').score;
        expect(score).toBeLessThan(withCapital);
    });
    it('ranks a bigger offering above a smaller one, all else equal', () => {
        const big = scoreDiscoveredLead(investor({ totalOfferingAmountUsd: 80_000_000 }), 'real estate').score;
        const small = scoreDiscoveredLead(investor({ totalOfferingAmountUsd: 2_000_000 }), 'real estate').score;
        expect(big).toBeGreaterThan(small);
    });
    it('clamps the score to the 0–100 range', () => {
        const { score } = scoreDiscoveredLead(investor({ totalOfferingAmountUsd: 100_000_000_000 }), 'real estate');
        expect(score).toBeLessThanOrEqual(100);
        expect(score).toBeGreaterThanOrEqual(0);
    });
});
describe('draftOutreach — compliant, staged-only drafts', () => {
    it('addresses a named principal when present and includes an opt-out', () => {
        const draft = draftOutreach(investor(), 'investor');
        expect(draft.subject).toContain('IVX Holdings');
        expect(draft.body).toContain('Jane Doe');
        expect(draft.body.toLowerCase()).toContain('reply stop');
        expect(draft.body.toLowerCase()).toContain('not an offer to sell securities');
    });
    it('falls back to the entity team when no principal is named', () => {
        const draft = draftOutreach(investor({ relatedPersons: [] }), 'buyer');
        expect(draft.body).toContain('Rosario Capital Partners LP team');
        expect(draft.subject.toLowerCase()).toContain('acquisition');
    });
});
describe('classifySouthFlorida — derived from real filing address only', () => {
    it('maps Miami-Dade, Broward, and Palm Beach cities to their tri-county tags', () => {
        expect(classifySouthFlorida('Miami', 'FL')).toBe('miami');
        expect(classifySouthFlorida('Fort Lauderdale', 'FL')).toBe('broward');
        expect(classifySouthFlorida('Boca Raton', 'FL')).toBe('palm_beach');
    });
    it('tags other Florida cities as florida, other US states as national, and abroad as international', () => {
        expect(classifySouthFlorida('Orlando', 'FL')).toBe('florida');
        expect(classifySouthFlorida('New York', 'NY')).toBe('national');
        expect(classifySouthFlorida('London', 'X1')).toBe('international');
        expect(classifySouthFlorida(null, null)).toBe('national');
    });
});
describe('classifyLeadCategory — real signals, never fabricated', () => {
    it('detects family offices, lenders, developers, and tokenization from the entity name', () => {
        expect(classifyLeadCategory(investor({ entityName: 'Sunrise Family Office LLC' }), 'jv_deals')).toBe('family_office');
        expect(classifyLeadCategory(investor({ entityName: 'Coastal Bridge Lending Fund' }), 'jv_deals')).toBe('private_lender');
        expect(classifyLeadCategory(investor({ entityName: 'Atlantic Development Builders' }), 'jv_deals')).toBe('developer');
        expect(classifyLeadCategory(investor({ entityName: 'Miami RWA Token Holdings' }), 'jv_deals')).toBe('tokenization_contact');
    });
    it('defaults a buyers-class entity with no stronger signal to buyer', () => {
        expect(classifyLeadCategory(investor({ entityName: 'Acme Acquisitions Co' }), 'buyers')).toBe('buyer');
    });
});
describe('isVerifiableSecLead — quarantine gate for fabricated/stub records', () => {
    it('accepts a real SEC-sourced record and rejects anything else', () => {
        expect(isVerifiableSecLead({ source: 'public_source', sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1/2/primary_doc.xml' })).toBe(true);
        expect(isVerifiableSecLead({ source: 'public_source', sourceUrl: 'https://demo.example.com/fake' })).toBe(false);
        expect(isVerifiableSecLead({ source: 'public_source', sourceUrl: '' })).toBe(false);
    });
});
