import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { executeRealTool } from './ivx-agent-real-tools';

/**
 * Regression guard for the `crm_read` / `crm_write` source-reference defect.
 *
 * The IVX 112 senior gate requires every agent to publish a real, independently
 * resolvable sourceReference as evidence. 28 of the 112 agents ran on the
 * internal CRM tools and emitted `supabase://ivx_crm_prospects?...` — an
 * invented scheme that resolves nowhere and therefore proves nothing.
 *
 * These tests assert the tools publish the exact HTTPS PostgREST URL that was
 * actually fetched, and that no credential ever leaks into that URL.
 *
 * The tool under test is NOT stubbed. Only the network boundary (`fetch`) is
 * replaced, so the real permission matrix, evidence hashing, and source-
 * reference construction all execute for real.
 */

const ORIGINAL_FETCH = globalThis.fetch;
const SERVICE_KEY = 'test-service-role-key-000000000000000000';
const PROJECT_URL = 'https://qtestproject.supabase.co';

type FetchCall = { url: string; init?: RequestInit };

let calls: FetchCall[] = [];

/** Minimal PostgREST stand-in: every table probe succeeds with a row array. */
function installFetchStub(rows: unknown[]): void {
  calls = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

beforeEach(() => {
  process.env.SUPABASE_URL = PROJECT_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  installFetchStub([
    { id: 'rec-1', name: 'Acme Capital', prospect_type: 'buyer', created_at: '2026-08-20T00:00:00Z' },
    { id: 'rec-2', name: 'Beta Partners', prospect_type: 'buyer', created_at: '2026-08-20T00:00:01Z' },
  ]);
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe('crm_read source reference', () => {
  it('publishes a resolvable https PostgREST URL, never the supabase:// scheme', async () => {
    const result = await executeRealTool('ivx_holdings_10', 10, 'crm_read', {
      prospectType: 'buyer',
      limit: 10,
    });

    expect(result.ok).toBe(true);
    expect(result.sourceReference.startsWith('https://')).toBe(true);
    expect(result.sourceReference).not.toContain('supabase://');
    expect(result.sourceReference).toContain('/rest/v1/ivx_crm_prospects');
  });

  it('never leaks the service-role key or apikey into the source reference', async () => {
    const result = await executeRealTool('ivx_holdings_14', 14, 'crm_read', {
      prospectType: 'investor',
      limit: 10,
    });

    expect(result.ok).toBe(true);
    expect(result.sourceReference).not.toContain(SERVICE_KEY);
    expect(result.sourceReference.toLowerCase()).not.toContain('apikey');
    expect(result.sourceReference.toLowerCase()).not.toContain('authorization');
  });

  it('reports the source reference as resolvable and still hashes real content', async () => {
    const result = await executeRealTool('ivx_holdings_18', 18, 'crm_read', {
      prospectType: 'buyer',
      limit: 10,
    });

    expect(result.extract.sourceReferenceResolvable).toBe(true);
    expect(String(result.extract.restEndpoint).startsWith('https://')).toBe(true);
    // Evidence integrity must survive the change.
    expect(result.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.toolResultId).toContain('crm_read');
    expect(result.httpStatus).toBe(200);
  });

  it('emits a source reference that matches the URL actually fetched', async () => {
    const result = await executeRealTool('ivx_holdings_22', 22, 'crm_read', {
      prospectType: 'buyer',
      limit: 10,
    });

    const prospectCalls = calls.filter((c) => c.url.includes('ivx_crm_prospects'));
    expect(prospectCalls.length).toBeGreaterThan(0);
    const fetched = prospectCalls[prospectCalls.length - 1].url;
    expect(result.sourceReference).toBe(fetched);
  });

  it('covers every agent number that previously emitted a non-resolvable reference', async () => {
    // The exact 28 agents flagged by the senior-gate audit.
    const flagged = [
      10, 14, 18, 20, 21, 22, 26, 30, 34, 38, 42, 46, 50, 54, 58, 62, 66, 70, 74, 78, 82, 86, 90, 94,
      98, 102, 106, 110,
    ];

    for (const agentNumber of flagged) {
      const result = await executeRealTool(`ivx_holdings_${agentNumber}`, agentNumber, 'crm_read', {
        prospectType: 'buyer',
        limit: 10,
      });
      expect(result.ok).toBe(true);
      expect(result.sourceReference.startsWith('https://')).toBe(true);
    }
  });
});
