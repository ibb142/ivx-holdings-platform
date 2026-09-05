import { describe, expect, it } from 'bun:test';
import {
  DAY_MS,
  conservativeProductiveMs,
  conservativeProductiveOverlapMs,
  parseLandingProductivityEvidence,
} from './ivx-agent-productivity-verifier.js';

describe('IVX 112 productivity verifier enterprise invariants', () => {
  it('parses PASS/FAIL/BLOCKED evidence without coercing status', () => {
    const make = (status: string) => `LANDING_P0_RESULT ${JSON.stringify({
      unit_id: 'u1', agent_number: 7, status,
      started_at: '2026-09-04T00:00:00.000Z',
      completed_at: '2026-09-04T01:00:00.000Z',
      productive_seconds: 3600,
      production_sha: 'abc',
    })}`;
    expect(parseLandingProductivityEvidence(make('PASS'))?.status).toBe('PASS');
    expect(parseLandingProductivityEvidence(make('FAIL'))?.status).toBe('FAIL');
    expect(parseLandingProductivityEvidence(make('BLOCKED'))?.status).toBe('BLOCKED');
  });

  it('rejects malformed status', () => {
    const summary = `LANDING_P0_RESULT ${JSON.stringify({
      unit_id: 'u1', agent_number: 7, status: 'WORKING',
      started_at: '2026-09-04T00:00:00.000Z',
      completed_at: '2026-09-04T01:00:00.000Z',
      productive_seconds: 3600,
      production_sha: 'abc',
    })}`;
    expect(parseLandingProductivityEvidence(summary)).toBeNull();
  });

  it('clips crossing-window evidence conservatively and never credits pre-window-only time', () => {
    const windowStart = 100_000;
    const windowEnd = windowStart + DAY_MS;
    const start = windowStart - 2 * 60 * 60 * 1000;
    const end = windowStart + 2 * 60 * 60 * 1000;
    const productive = 3 * 60 * 60 * 1000;
    expect(conservativeProductiveOverlapMs(start, end, productive, windowStart, windowEnd))
      .toBe(1 * 60 * 60 * 1000);
  });

  it('credits zero when all claimed productivity could have occurred before the 24h boundary', () => {
    const windowStart = 100_000;
    const windowEnd = windowStart + DAY_MS;
    const start = windowStart - 4 * 60 * 60 * 1000;
    const end = windowStart + 1 * 60 * 60 * 1000;
    const productive = 2 * 60 * 60 * 1000;
    expect(conservativeProductiveOverlapMs(start, end, productive, windowStart, windowEnd)).toBe(0);
  });

  it('never exceeds physical overlap or 24h cap', () => {
    const windowStart = 0;
    const windowEnd = DAY_MS;
    const start = 0;
    const end = 30 * 60 * 60 * 1000;
    const productive = 30 * 60 * 60 * 1000;
    expect(conservativeProductiveOverlapMs(start, end, productive, windowStart, windowEnd)).toBe(DAY_MS);
    expect(conservativeProductiveMs(30 * 60 * 60 * 1000, 0)).toBe(DAY_MS);
  });

  it('uses MAX not SUM for ambiguous overlapping sources', () => {
    const campaign = 8 * 60 * 60 * 1000;
    const evidence = 10 * 60 * 60 * 1000;
    expect(conservativeProductiveMs(campaign, evidence)).toBe(evidence);
  });
});
