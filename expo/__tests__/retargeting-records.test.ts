import { describe, expect, test } from 'bun:test';
import { parseRetargetingRecords, retargetingValue } from '../lib/retargeting-records';

describe('retargeting database response boundary', () => {
  test('an empty select is a real empty list', () => {
    expect(parseRetargetingRecords([])).toEqual([]);
  });
  test('preserves database columns and nulls without inventing campaign metrics', () => {
    const rows = [{ id: 'campaign-record', campaign_id: 'campaign-1', spend: '12.50', clicks: 0, conversions: null }];
    expect(parseRetargetingRecords(rows)).toEqual(rows);
    expect(retargetingValue(rows[0].clicks)).toBe('0');
    expect(retargetingValue(rows[0].conversions)).toBe('—');
    expect(retargetingValue(rows[0].spend)).toBe('12.50');
  });
  test('rejects malformed rows and legacy envelopes instead of marking them empty', () => {
    for (const value of [null, undefined, { campaigns: [] }, [null], [[]], ['invalid']]) {
      expect(() => parseRetargetingRecords(value)).toThrow();
    }
  });
  test('nullable and structured fields never become invalid React text children', () => {
    for (const value of [undefined, null, {}, [], NaN, Infinity]) expect(retargetingValue(value)).toBe('—');
    expect(retargetingValue(false)).toBe('No');
  });
});
