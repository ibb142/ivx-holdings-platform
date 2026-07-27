import { describe, test, expect } from 'bun:test';
import {
  scoreLead,
  classifyLeadTemperature,
  type LeadScoringInput,
  type LeadTemperature,
} from '../services/ivx-lead-scoring-helper';

describe('ivx-lead-scoring-helper', () => {
  const baseInput: LeadScoringInput = {
    filingType: '1-D',
    offeringAmount: 5_000_000,
    amountSold: 0,
    investorsCount: 0,
    signedDate: new Date().toISOString(),
    submissionDate: new Date().toISOString(),
    industry: 'real_estate',
    isAmendment: false,
  };

  test('hot lead: recent, large offering, high-value industry', () => {
    const r = scoreLead(baseInput);
    expect(r.score).toBeGreaterThanOrEqual(65);
    expect(r.temperature).toBe('hot');
    expect(r.components.recency).toBe(100);
    expect(r.components.dealSize).toBe(70);
    expect(r.components.clarity).toBe(100);
    expect(r.rationale).toHaveLength(4);
  });

  test('cold lead: old filing, small offering, amendment', () => {
    const r = scoreLead({
      ...baseInput,
      offeringAmount: 10_000,
      signedDate: '2024-01-01T00:00:00Z',
      submissionDate: '2024-01-01T00:00:00Z',
      isAmendment: true,
      filingType: '1-D/A',
      industry: 'other',
    });
    expect(r.score).toBeLessThan(50);
    expect(r.temperature).toBe('cold');
    expect(r.components.recency).toBe(10);
    expect(r.components.dealSize).toBe(20);
    expect(r.components.clarity).toBe(50);
  });

  test('warm lead: moderate recency and size', () => {
    const r = scoreLead({
      ...baseInput,
      offeringAmount: 500_000,
      signedDate: new Date(Date.now() - 45 * 86_400_000).toISOString(),
      industry: 'technology',
    });
    expect(r.temperature).toBe('warm');
    expect(r.score).toBeGreaterThanOrEqual(35);
    expect(r.score).toBeLessThan(65);
  });

  test('momentum scoring: 75% sold with 10+ investors = high momentum', () => {
    const r = scoreLead({
      ...baseInput,
      offeringAmount: 10_000_000,
      amountSold: 8_000_000,
      investorsCount: 12,
    });
    expect(r.components.momentum).toBe(100);
  });

  test('classifyLeadTemperature returns the same temperature as scoreLead', () => {
    const t: LeadTemperature = classifyLeadTemperature(baseInput);
    const r = scoreLead(baseInput);
    expect(t).toBe(r.temperature);
  });

  test('score is bounded 0-100', () => {
    const r1 = scoreLead({ ...baseInput, offeringAmount: 100_000_000, amountSold: 99_000_000, investorsCount: 50 });
    expect(r1.score).toBeLessThanOrEqual(100);
    expect(r1.score).toBeGreaterThanOrEqual(0);
    const r2 = scoreLead({ filingType: '1-D/A' });
    expect(r2.score).toBeGreaterThanOrEqual(0);
    expect(r2.score).toBeLessThanOrEqual(100);
  });

  test('components are each 0-100', () => {
    const r = scoreLead(baseInput);
    for (const v of Object.values(r.components)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});
