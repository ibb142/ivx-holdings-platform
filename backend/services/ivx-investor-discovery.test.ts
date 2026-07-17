import { describe, expect, it } from 'bun:test';
import {
  buildFilingUrl,
  discoverInvestors,
  parseFormD,
  parseRelatedPersons,
} from './ivx-investor-discovery';

const SAMPLE_FORM_D = `<?xml version="1.0"?>
<edgarSubmission>
  <primaryIssuer>
    <cik>0001035443</cik>
    <entityName>ALEXANDRIA REAL ESTATE EQUITIES, INC.</entityName>
    <issuerAddress>
      <street1>26 NORTH EUCLID AVENUE</street1>
      <city>PASADENA</city>
      <stateOrCountry>CA</stateOrCountry>
      <zipCode>91101</zipCode>
    </issuerAddress>
    <issuerPhoneNumber>6265780777</issuerPhoneNumber>
    <jurisdictionOfInc>MARYLAND</jurisdictionOfInc>
    <entityType>Corporation</entityType>
  </primaryIssuer>
  <relatedPersonsList>
    <relatedPersonInfo>
      <relatedPersonName>
        <firstName>Joel</firstName>
        <middleName>S.</middleName>
        <lastName>Marcus</lastName>
      </relatedPersonName>
      <relatedPersonAddress>
        <city>Pasadena</city>
        <stateOrCountry>CA</stateOrCountry>
      </relatedPersonAddress>
      <relatedPersonRelationshipList>
        <relationship>Executive Officer</relationship>
        <relationship>Director</relationship>
      </relatedPersonRelationshipList>
    </relatedPersonInfo>
  </relatedPersonsList>
  <offeringData>
    <industryGroup>
      <industryGroupType>Real Estate</industryGroupType>
    </industryGroup>
    <minimumInvestmentAccepted>25000</minimumInvestmentAccepted>
    <offeringSalesAmounts>
      <totalOfferingAmount>50000000</totalOfferingAmount>
      <totalAmountSold>12000000</totalAmountSold>
    </offeringSalesAmounts>
    <investors>
      <totalNumberAlreadyInvested>14</totalNumberAlreadyInvested>
    </investors>
  </offeringData>
</edgarSubmission>`;

describe('parseRelatedPersons', () => {
  it('extracts real named principals with relationships', () => {
    const people = parseRelatedPersons(SAMPLE_FORM_D);
    expect(people).toHaveLength(1);
    expect(people[0].fullName).toBe('Joel Marcus');
    expect(people[0].relationships).toEqual(['Executive Officer', 'Director']);
    expect(people[0].stateOrCountry).toBe('CA');
  });

  it('returns empty when there is no related-persons block', () => {
    expect(parseRelatedPersons('<edgarSubmission></edgarSubmission>')).toEqual([]);
  });
});

describe('parseFormD', () => {
  it('parses a real entity with offering amount and principals', () => {
    const url = 'https://www.sec.gov/Archives/edgar/data/1035443/x/primary_doc.xml';
    const record = parseFormD(SAMPLE_FORM_D, '0001035443', '0001035443-26-000002', url);
    expect(record).not.toBeNull();
    expect(record!.entityName).toBe('ALEXANDRIA REAL ESTATE EQUITIES, INC.');
    expect(record!.businessCity).toBe('PASADENA');
    expect(record!.businessPhone).toBe('6265780777');
    expect(record!.totalOfferingAmountUsd).toBe(50000000);
    expect(record!.totalAmountSoldUsd).toBe(12000000);
    expect(record!.minimumInvestmentUsd).toBe(25000);
    expect(record!.investorsAlreadyInvested).toBe(14);
    expect(record!.industryGroup).toBe('Real Estate');
    expect(record!.relatedPersons).toHaveLength(1);
    expect(record!.filingUrl).toBe(url);
  });

  it('returns null when there is no entity name (never fabricates)', () => {
    expect(parseFormD('<edgarSubmission></edgarSubmission>', '1', 'a', 'u')).toBeNull();
  });

  it('keeps offering amount null when the filer left it indefinite', () => {
    const xml = SAMPLE_FORM_D.replace('<totalOfferingAmount>50000000</totalOfferingAmount>', '<totalOfferingAmount>Indefinite</totalOfferingAmount>');
    const record = parseFormD(xml, '1', 'a', 'u');
    expect(record!.totalOfferingAmountUsd).toBeNull();
  });
});

describe('buildFilingUrl', () => {
  it('builds the official SEC archives URL', () => {
    const url = buildFilingUrl('0001035443', '0001035443-26-000002', 'primary_doc.xml');
    expect(url).toBe('https://www.sec.gov/Archives/edgar/data/1035443/000103544326000002/primary_doc.xml');
  });
});

describe('discoverInvestors', () => {
  function makeFetch(): (url: string) => Promise<Response> {
    return async (url: string) => {
      if (url.includes('efts.sec.gov')) {
        // The engine pages through results (100 hits/page). Return the real hits
        // only on the first page (from=0) and an empty page afterwards, so the
        // scan terminates instead of re-counting the same filings every page.
        const fromMatch = url.match(/[?&]from=(\d+)/);
        const from = fromMatch ? Number(fromMatch[1]) : 0;
        const hits = from === 0
          ? [
              { _id: '0001035443-26-000002:primary_doc.xml', _source: { ciks: ['0001035443'], adsh: '0001035443-26-000002', file_date: '2026-01-15' } },
              { _id: '0009999999-26-000009:primary_doc.xml', _source: { ciks: ['0009999999'], adsh: '0009999999-26-000009', file_date: '2026-02-01' } },
            ]
          : [];
        return new Response(
          JSON.stringify({ hits: { total: { value: 2 }, hits } }),
          { status: 200 },
        );
      }
      if (url.includes('1035443')) {
        return new Response(SAMPLE_FORM_D, { status: 200 });
      }
      // Small offering — should be filtered out for the buyers class ($100K+).
      const small = SAMPLE_FORM_D
        .replace('ALEXANDRIA REAL ESTATE EQUITIES, INC.', 'SMALL FUND LLC')
        .replace('<totalOfferingAmount>50000000</totalOfferingAmount>', '<totalOfferingAmount>50000</totalOfferingAmount>');
      return new Response(small, { status: 200 });
    };
  }

  it('returns real entities and filters to $100K+ for the buyers class', async () => {
    const result = await discoverInvestors({ discoveryClass: 'buyers', fetchImpl: makeFetch(), delayMs: 0 });
    expect(result.ok).toBe(true);
    expect(result.minOfferingUsd).toBe(100_000);
    expect(result.investors).toHaveLength(1);
    expect(result.investors[0].entityName).toBe('ALEXANDRIA REAL ESTATE EQUITIES, INC.');
    expect(result.investors[0].totalOfferingAmountUsd).toBe(50000000);
  });

  it('includes all real entities for the jv_deals class (no minimum)', async () => {
    const result = await discoverInvestors({ discoveryClass: 'jv_deals', fetchImpl: makeFetch(), delayMs: 0 });
    expect(result.ok).toBe(true);
    expect(result.minOfferingUsd).toBe(0);
    expect(result.investors).toHaveLength(2);
  });

  it('returns an honest error when the SEC search fails (never fabricates)', async () => {
    const result = await discoverInvestors({
      fetchImpl: async () => new Response('rate limited', { status: 429 }),
      delayMs: 0,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('429');
    expect(result.investors).toHaveLength(0);
  });
});
