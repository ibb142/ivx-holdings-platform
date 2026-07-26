import { describe, expect, it } from 'bun:test';
import { INVESTOR_REPORT_COLUMNS, buildInvestorReportRows, generateInvestorReport, investorToCsvRow, IVX_INVESTOR_REPORT_MARKER, } from './ivx-investor-report';
function makeInvestor(overrides = {}) {
    return {
        cik: '0001035443',
        accessionNumber: '0001035443-26-000002',
        entityName: 'ALEXANDRIA REAL ESTATE EQUITIES, INC.',
        entityType: 'Corporation',
        jurisdiction: 'MARYLAND',
        businessStreet: '26 NORTH EUCLID AVENUE',
        businessCity: 'PASADENA',
        businessState: 'CA',
        businessZip: '91101',
        businessPhone: '6265780777',
        industryGroup: 'Real Estate',
        relatedPersons: [
            { firstName: 'Joel', lastName: 'Marcus', fullName: 'Joel Marcus', relationships: ['Executive Officer', 'Director'], city: 'Pasadena', stateOrCountry: 'CA' },
        ],
        totalOfferingAmountUsd: 50_000_000,
        totalAmountSoldUsd: 12_000_000,
        minimumInvestmentUsd: 25_000,
        investorsAlreadyInvested: 14,
        filingDate: '2026-01-15',
        dateOfFirstSale: '2026-01-10',
        filingUrl: 'https://www.sec.gov/Archives/edgar/data/1035443/x/primary_doc.xml',
        ...overrides,
    };
}
function makeResult(investors, ok = true, error = null) {
    return {
        ok,
        discoveryClass: 'buyers',
        query: 'real estate',
        minOfferingUsd: 10_000_000,
        source: 'SEC EDGAR Form D',
        fetchedAt: new Date().toISOString(),
        totalFilingsMatched: investors.length,
        scannedFilings: investors.length,
        investors,
        resultCount: investors.length,
        error,
        complianceNote: 'note',
    };
}
describe('investorToCsvRow', () => {
    it('flattens a real investor with named principals joined', () => {
        const row = investorToCsvRow(makeInvestor());
        expect(row.entityName).toBe('ALEXANDRIA REAL ESTATE EQUITIES, INC.');
        expect(row.namedPrincipals).toBe('Joel Marcus (Executive Officer, Director)');
        expect(row.secFilingUrl).toContain('sec.gov');
        expect(row.totalOfferingAmountUsd).toBe(50_000_000);
    });
    it('keeps unknown values empty (never fabricates)', () => {
        const row = investorToCsvRow(makeInvestor({ totalOfferingAmountUsd: null, businessPhone: null, relatedPersons: [] }));
        expect(row.totalOfferingAmountUsd).toBe('');
        expect(row.businessPhone).toBe('');
        expect(row.namedPrincipals).toBe('');
    });
});
describe('buildInvestorReportRows', () => {
    it('maps every investor to a row', () => {
        const rows = buildInvestorReportRows(makeResult([makeInvestor(), makeInvestor({ cik: '2' })]));
        expect(rows).toHaveLength(2);
        expect(INVESTOR_REPORT_COLUMNS).toContain('secFilingUrl');
    });
});
describe('generateInvestorReport', () => {
    it('returns honest discovery_failed when the SEC scan fails (no report, no link)', async () => {
        const result = await generateInvestorReport({
            query: 'real estate',
            delayMs: 0,
            fetchImpl: async () => new Response('rate limited', { status: 429 }),
        });
        expect(result.ok).toBe(false);
        expect(result.status).toBe('discovery_failed');
        expect(result.jobId).toBeNull();
        expect(result.deliverable).toBeNull();
        expect(result.rowCount).toBe(0);
        expect(result.message).toMatch(/not generated|no valid link/i);
        expect(result.marker).toBe(IVX_INVESTOR_REPORT_MARKER);
    });
    it('does NOT generate a report when the discovery returns zero records (honest no_records)', async () => {
        const result = await generateInvestorReport({
            query: 'real estate',
            discoveryClass: 'buyers',
            delayMs: 0,
            // Empty EDGAR result set → 0 records → no report, no link.
            fetchImpl: async () => new Response(JSON.stringify({ hits: { total: { value: 0 }, hits: [] } }), { status: 200 }),
        });
        expect(result.ok).toBe(false);
        expect(result.status).toBe('no_records');
        expect(result.jobId).toBeNull();
        expect(result.deliverable).toBeNull();
        expect(result.message).toMatch(/0 real|not generated|no valid link/i);
    });
});
