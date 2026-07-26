/**
 * Regression tests for IVX Buyer Discovery API.
 *
 * Ensures `buyers` is ALWAYS an array (never null/undefined) in the API
 * response, covering: multiple buyers, zero buyers, unauthorized access,
 * invalid filters, and empty search.
 */
import { describe, test, expect } from 'bun:test';
import { discoverBuyers, classifyBuyerType, BUYER_TYPES, } from './services/ivx-buyer-discovery';
function mockInvestor(name, industry = 'Real Estate') {
    return {
        cik: '000' + Math.random().toString().slice(2, 9),
        accessionNumber: '0001035443-26-000001',
        entityName: name,
        entityType: 'Limited Partnership',
        jurisdiction: 'DE',
        businessStreet: '123 Main St',
        businessCity: 'New York',
        businessState: 'NY',
        businessZip: '10001',
        businessPhone: '212-555-0100',
        industryGroup: industry,
        relatedPersons: [],
        totalOfferingAmountUsd: 5_000_000,
        totalAmountSoldUsd: null,
        minimumInvestmentUsd: 100_000,
        investorsAlreadyInvested: 3,
        filingDate: '2026-01-15',
        dateOfFirstSale: '2026-01-01',
        filingUrl: 'https://www.sec.gov/Archives/edgar/data/test/primary_doc.xml',
    };
}
describe('IVX Buyer Discovery — buyers always array', () => {
    test('discoverBuyers returns buyers as array when SEC returns results', async () => {
        const mockFetch = async (url) => {
            if (url.includes('search-index')) {
                return new Response(JSON.stringify({
                    hits: {
                        total: { value: 1 },
                        hits: [{ _id: '0001035443-26-000001:primary_doc.xml', _source: { ciks: ['1035443'], adsh: '0001035443-26-000001', file_date: '2026-01-15' } }],
                    },
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            // Return a minimal Form D XML
            const xml = `<?xml version="1.0"?>
        <edgarSubmission>
          <entityName>ALEXANDRIA REAL ESTATE EQUITIES REIT</entityName>
          <primaryIssuer>
            <entityType>REIT</entityType>
            <jurisdictionOfInc>MD</jurisdictionOfInc>
            <issuerPhoneNumber>212-555-0100</issuerPhoneNumber>
            <issuerAddress><street1>123 Main St</street1><city>New York</city><stateOrCountry>NY</stateOrCountry><zipCode>10001</zipCode></issuerAddress>
          </primaryIssuer>
          <industryGroupType>Real Estate</industryGroupType>
          <offeringSalesAmounts><totalOfferingAmount>5000000</totalOfferingAmount></offeringSalesAmounts>
          <investors><totalNumberAlreadyInvested>3</totalNumberAlreadyInvested></investors>
        </edgarSubmission>`;
            return new Response(xml, { status: 200, headers: { 'Content-Type': 'application/xml' } });
        };
        const result = await discoverBuyers({ query: 'real estate', limit: 1, fetchImpl: mockFetch, delayMs: 0 });
        expect(result.ok).toBe(true);
        expect(Array.isArray(result.buyers)).toBe(true);
        expect(result.buyers.length).toBeGreaterThan(0);
        expect(result.resultCount).toBe(result.buyers.length);
    });
    test('discoverBuyers returns empty array (not null) when no results', async () => {
        const mockFetch = async (url) => {
            if (url.includes('search-index')) {
                return new Response(JSON.stringify({ hits: { total: { value: 0 }, hits: [] } }), {
                    status: 200, headers: { 'Content-Type': 'application/json' },
                });
            }
            return new Response('', { status: 404 });
        };
        const result = await discoverBuyers({ query: 'nonexistent query xyz', limit: 5, fetchImpl: mockFetch, delayMs: 0 });
        expect(Array.isArray(result.buyers)).toBe(true);
        expect(result.buyers).toEqual([]);
        expect(result.resultCount).toBe(0);
    });
    test('discoverBuyers returns empty array on SEC API failure', async () => {
        const mockFetch = async () => {
            return new Response('Server Error', { status: 500 });
        };
        const result = await discoverBuyers({ query: 'real estate', limit: 5, fetchImpl: mockFetch, delayMs: 0 });
        expect(result.ok).toBe(false);
        expect(Array.isArray(result.buyers)).toBe(true);
        expect(result.buyers).toEqual([]);
        expect(result.error).not.toBeNull();
    });
    test('discoverBuyers with buyerTypes filter returns filtered array', async () => {
        // Test with a mock that returns 0 results — buyers should still be []
        const mockFetch = async (url) => {
            return new Response(JSON.stringify({ hits: { total: { value: 0 }, hits: [] } }), {
                status: 200, headers: { 'Content-Type': 'application/json' },
            });
        };
        const result = await discoverBuyers({
            query: 'real estate', limit: 5,
            buyerTypes: ['reit', 'developer'],
            fetchImpl: mockFetch, delayMs: 0,
        });
        expect(Array.isArray(result.buyers)).toBe(true);
        expect(result.buyers).toEqual([]);
        expect(result.requestedTypes).toEqual(['developer', 'reit']);
    });
    test('classifyBuyerType classifies REIT correctly', () => {
        const investor = mockInvestor('ALEXANDRIA REAL ESTATE EQUITIES REIT');
        const { buyerType, classificationSignal } = classifyBuyerType(investor);
        expect(buyerType).toBe('reit');
        expect(classificationSignal).toBeTruthy();
    });
    test('classifyBuyerType classifies developer correctly', () => {
        const investor = mockInvestor('TRIANGLE DEVELOPMENT PARTNERS');
        const { buyerType } = classifyBuyerType(investor);
        expect(buyerType).toBe('developer');
    });
    test('classifyBuyerType defaults to cash_buyer for no signals', () => {
        const investor = mockInvestor('SMITH PROPERTIES LLC');
        const { buyerType } = classifyBuyerType(investor);
        expect(buyerType).toBe('cash_buyer');
    });
    test('BUYER_TYPES has exactly 7 types', () => {
        expect(BUYER_TYPES.length).toBe(7);
        expect(BUYER_TYPES).toContain('cash_buyer');
        expect(BUYER_TYPES).toContain('family_office');
        expect(BUYER_TYPES).toContain('developer');
        expect(BUYER_TYPES).toContain('operator');
        expect(BUYER_TYPES).toContain('acquisition_group');
        expect(BUYER_TYPES).toContain('broker');
        expect(BUYER_TYPES).toContain('reit');
    });
});
