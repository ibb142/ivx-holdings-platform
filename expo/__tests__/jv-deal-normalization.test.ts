import { describe, expect, test } from 'bun:test';
import { normalizeJVDeal, formatDealField, isSameDeal } from '../lib/normalize-jv-deal';
import { formatCurrency, formatCurrencySafe, formatPercentageSafe, safeNumber, isValidNumber, formatCurrencyCompact, formatCurrencyWithDecimals } from '../lib/formatters';

describe('JV Deal Normalization — NaN elimination + canonical mapping', () => {
  // Phase 9 test matrix: missing capital, missing ROI, legacy field mapping,
  // zero value, malformed numeric string, wrong property association,
  // duplicate title with different UUIDs, publish/unpublish, display-order,
  // admin/public parity, media-to-deal linkage, stale-cache rejection

  test('missing capital_required → null (not zero, not NaN)', () => {
    const deal = normalizeJVDeal({
      id: 'test-001',
      title: 'Test Deal',
      total_investment: null,
      expected_roi: 15,
    });
    expect(deal.capitalRequired).toBeNull();
    expect(deal.totalInvestment).toBeNull();
    expect(formatDealField(deal.capitalRequired, 'currency')).toBe('Not entered');
  });

  test('missing ROI → null (not zero, not NaN)', () => {
    const deal = normalizeJVDeal({
      id: 'test-002',
      title: 'Test Deal',
      total_investment: 1000000,
      expected_roi: null,
    });
    expect(deal.targetRoiPercent).toBeNull();
    expect(deal.expectedRoi).toBeNull();
    expect(formatDealField(deal.targetRoiPercent, 'percent')).toBe('Not entered');
  });

  test('legacy field mapping: totalInvestment → total_investment', () => {
    const deal = normalizeJVDeal({
      id: 'test-003',
      title: 'Legacy Deal',
      totalInvestment: 500000,
      expectedROI: 12.5,
      propertyValue: 750000,
      minInvestment: 25000,
    });
    expect(deal.totalInvestment).toBe(500000);
    expect(deal.expectedRoi).toBe(12.5);
    expect(deal.estimatedValue).toBe(750000);
    expect(deal.minimumInvestment).toBe(25000);
  });

  test('confirmed zero → 0 (not null, not NaN)', () => {
    const deal = normalizeJVDeal({
      id: 'test-004',
      title: 'Zero Deal',
      total_investment: 0,
      expected_roi: 0,
      sale_price: 0,
      min_investment: 0,
    });
    expect(deal.totalInvestment).toBe(0);
    expect(deal.expectedRoi).toBe(0);
    expect(deal.salePrice).toBe(0);
    expect(deal.minimumInvestment).toBe(0);
    expect(formatDealField(0, 'currency')).toBe('$0');
    expect(formatDealField(0, 'percent')).toBe('0.0%');
  });

  test('malformed numeric string → null + invalidFields flag', () => {
    const deal = normalizeJVDeal({
      id: 'test-005',
      title: 'Malformed Deal',
      total_investment: 'not-a-number',
      expected_roi: 'abc',
    });
    expect(deal.totalInvestment).toBeNull();
    expect(deal.expectedRoi).toBeNull();
    expect(deal.invalidFields).toContain('total_investment');
    expect(deal.invalidFields).toContain('expected_roi');
  });

  test('wrong property association: different UUIDs are not the same deal', () => {
    const dealA = normalizeJVDeal({ id: 'deal-A', title: 'Same Title' });
    const dealB = normalizeJVDeal({ id: 'deal-B', title: 'Same Title' });
    expect(isSameDeal(dealA, dealB)).toBe(false);
    expect(isSameDeal(dealA, dealA)).toBe(true);
  });

  test('duplicate title with different UUIDs: identity preserved by ID', () => {
    const deal1 = normalizeJVDeal({ id: 'jv-001', title: 'Jacksonville', project_name: 'IVX Jacksonville Prime' });
    const deal2 = normalizeJVDeal({ id: 'jv-002', title: 'Jacksonville', project_name: 'Different Project' });
    expect(deal1.id).toBe('jv-001');
    expect(deal2.id).toBe('jv-002');
    expect(deal1.id).not.toBe(deal2.id);
  });

  test('publish/unpublish: published flag preserved', () => {
    const published = normalizeJVDeal({ id: 'test-006', title: 'Published', published: true });
    const unpublished = normalizeJVDeal({ id: 'test-007', title: 'Unpublished', published: false });
    expect(published.published).toBe(true);
    expect(unpublished.published).toBe(false);
  });

  test('display-order changes: order preserved', () => {
    const deal = normalizeJVDeal({ id: 'test-008', title: 'Ordered', display_order: 5 });
    expect(deal.displayOrder).toBe(5);
  });

  test('admin/public parity: same raw deal → same normalized output', () => {
    const raw = {
      id: 'parity-001',
      title: 'Parity Test',
      project_name: 'Parity Project',
      total_investment: 1000000,
      expected_roi: 15,
      min_investment: 50000,
      published: true,
    };
    const adminView = normalizeJVDeal(raw);
    const publicView = normalizeJVDeal(raw);
    expect(adminView).toEqual(publicView);
    expect(adminView.id).toBe('parity-001');
    expect(adminView.totalInvestment).toBe(1000000);
    expect(adminView.targetRoiPercent).toBe(15);
    expect(adminView.minimumInvestment).toBe(50000);
  });

  test('media-to-deal linkage: photos deduplicated', () => {
    const deal = normalizeJVDeal({
      id: 'test-009',
      title: 'Photo Test',
      photos: [
        'https://example.com/photo1.jpg',
        'https://example.com/photo1.jpg',
        'https://example.com/photo1.jpg',
        'https://example.com/photo2.jpg',
      ],
    });
    expect(deal.photos.length).toBe(2);
    expect(deal.photos).toContain('https://example.com/photo1.jpg');
    expect(deal.photos).toContain('https://example.com/photo2.jpg');
  });

  test('stale-cache rejection: different updatedAt → different data', () => {
    const oldDeal = normalizeJVDeal({
      id: 'stale-001',
      title: 'Stale',
      total_investment: 100000,
      updated_at: '2026-01-01T00:00:00Z',
    });
    const newDeal = normalizeJVDeal({
      id: 'stale-001',
      title: 'Stale',
      total_investment: 200000,
      updated_at: '2026-07-22T00:00:00Z',
    });
    expect(oldDeal.totalInvestment).toBe(100000);
    expect(newDeal.totalInvestment).toBe(200000);
    expect(oldDeal.updatedAt).not.toBe(newDeal.updatedAt);
  });
});

describe('Formatter NaN guards — never render $NaN or undefined%', () => {
  test('formatCurrency(NaN) → $0 (not $NaN)', () => {
    expect(formatCurrency(NaN)).toBe('$0');
    expect(formatCurrency(NaN, true)).toBe('0.00');
  });

  test('formatCurrency(undefined) → $0', () => {
    expect(formatCurrency(undefined as unknown as number)).toBe('$0');
  });

  test('formatCurrency(null) → $0', () => {
    expect(formatCurrency(null as unknown as number)).toBe('$0');
  });

  test('formatCurrencySafe(null) → "Not entered"', () => {
    expect(formatCurrencySafe(null)).toBe('Not entered');
    expect(formatCurrencySafe(undefined)).toBe('Not entered');
    expect(formatCurrencySafe('')).toBe('Not entered');
  });

  test('formatCurrencySafe(0) → "$0" (confirmed zero)', () => {
    expect(formatCurrencySafe(0)).toBe('$0');
  });

  test('formatCurrencySafe("not-a-number") → "Invalid data"', () => {
    expect(formatCurrencySafe('not-a-number')).toBe('Invalid data');
  });

  test('formatPercentageSafe(null) → "Not entered"', () => {
    expect(formatPercentageSafe(null)).toBe('Not entered');
    expect(formatPercentageSafe(undefined)).toBe('Not entered');
  });

  test('formatPercentageSafe(NaN) → "Invalid data"', () => {
    expect(formatPercentageSafe(NaN)).toBe('Invalid data');
  });

  test('safeNumber(NaN) → 0', () => {
    expect(safeNumber(NaN)).toBe(0);
    expect(safeNumber(null)).toBe(0);
    expect(safeNumber(undefined)).toBe(0);
    expect(safeNumber('')).toBe(0);
    expect(safeNumber('abc')).toBe(0);
    expect(safeNumber(42)).toBe(42);
  });

  test('isValidNumber: null → false, 0 → true, NaN → false', () => {
    expect(isValidNumber(null)).toBe(false);
    expect(isValidNumber(undefined)).toBe(false);
    expect(isValidNumber(0)).toBe(true);
    expect(isValidNumber(42)).toBe(true);
    expect(isValidNumber(NaN)).toBe(false);
    expect(isValidNumber('abc')).toBe(false);
  });

  test('formatCurrencyCompact(NaN) → $0.00 (not $NaN)', () => {
    expect(formatCurrencyCompact(NaN)).toBe('$0.00');
  });

  test('formatCurrencyWithDecimals(NaN) → $0.00 (not $NaN)', () => {
    const result = formatCurrencyWithDecimals(NaN);
    expect(result).toBe('$0.00');
    expect(result).not.toContain('NaN');
  });
});

describe('Production deal records — canonical identity verification', () => {
  test('Perez Residence: stable UUID, correct developer, correct location', () => {
    const raw = {
      id: 'perez-residence-001',
      title: 'PEREZ RESIDENCE',
      project_name: 'ONE STOP DEVELOPMENT LLC',
      partner_name: 'ONE STOP DEVELOPMENT LLC',
      partner_type: 'developer',
      property_address: 'SW 70 Place, Southwest Ranches, FL',
      city: 'Southwest Ranches',
      state: 'FL',
      country: 'US',
      zip_code: '33330',
      total_investment: 2500000,
      expected_roi: 25,
      min_investment: 50000,
      estimated_value: 3125000,
      published: true,
      display_order: 1,
      type: 'development',
    };
    const deal = normalizeJVDeal(raw);
    expect(deal.id).toBe('perez-residence-001');
    expect(deal.title).toBe('PEREZ RESIDENCE');
    expect(deal.developerName).toBe('ONE STOP DEVELOPMENT LLC');
    expect(deal.location).toBe('Southwest Ranches, FL, US');
    expect(deal.totalInvestment).toBe(2500000);
    expect(deal.expectedRoi).toBe(25);
    expect(deal.minimumInvestment).toBe(50000);
    expect(deal.estimatedValue).toBe(3125000);
    expect(deal.published).toBe(true);
    expect(deal.displayOrder).toBe(1);
  });

  test('Casa Rosario: stable UUID, correct developer, correct location', () => {
    const raw = {
      id: 'casa-rosario-001',
      title: 'Casa Rosario',
      project_name: 'Casa Rosario',
      partner_name: 'ONE STOP DEVELOPMENT TWO LLC',
      partner_type: 'developer',
      property_address: 'Pembroke Pines, FL',
      city: 'Pembroke Pines',
      state: 'FL',
      country: 'USA',
      zip_code: '33332',
      total_investment: 1400000,
      expected_roi: 30,
      min_investment: 50,
      propertyValue: 1400000,
      estimated_value: 1400000,
      published: true,
      display_order: 2,
      type: 'jv',
    };
    const deal = normalizeJVDeal(raw);
    expect(deal.id).toBe('casa-rosario-001');
    expect(deal.title).toBe('Casa Rosario');
    expect(deal.developerName).toBe('ONE STOP DEVELOPMENT TWO LLC');
    expect(deal.location).toBe('Pembroke Pines, FL, USA');
    expect(deal.totalInvestment).toBe(1400000);
    expect(deal.expectedRoi).toBe(30);
    expect(deal.minimumInvestment).toBe(50);
  });

  test('Jacksonville: stable UUID, company name as title, project name separate', () => {
    const raw = {
      id: 'JV-202603-5190',
      title: 'ONE STOP CONSTRUCTORS INC',
      project_name: 'IVX JACKSONVILLE PRIME',
      property_address: '215 E 3rd St, Jacksonville, FL 32206',
      city: 'Jacksonville',
      state: 'FL',
      country: 'US',
      zip_code: '32206',
      total_investment: 400000,
      expected_roi: 9.5,
      min_investment: 50000,
      published: true,
      display_order: 3,
      type: 'profit_sharing',
    };
    const deal = normalizeJVDeal(raw);
    expect(deal.id).toBe('JV-202603-5190');
    expect(deal.title).toBe('ONE STOP CONSTRUCTORS INC');
    expect(deal.projectName).toBe('IVX JACKSONVILLE PRIME');
    expect(deal.location).toBe('Jacksonville, FL, US');
    expect(deal.totalInvestment).toBe(400000);
    expect(deal.expectedRoi).toBe(9.5);
    expect(deal.minimumInvestment).toBe(50000);
  });

  test('ONE STOP entities are NOT mixed: different UUIDs, different developers', () => {
    const perez = normalizeJVDeal({
      id: 'perez-residence-001',
      title: 'PEREZ RESIDENCE',
      project_name: 'ONE STOP DEVELOPMENT LLC',
      partner_name: 'ONE STOP DEVELOPMENT LLC',
    });
    const jacksonville = normalizeJVDeal({
      id: 'JV-202603-5190',
      title: 'ONE STOP CONSTRUCTORS INC',
      project_name: 'IVX JACKSONVILLE PRIME',
    });
    const casa = normalizeJVDeal({
      id: 'casa-rosario-001',
      title: 'Casa Rosario',
      partner_name: 'ONE STOP DEVELOPMENT TWO LLC',
    });

    // Three different UUIDs
    expect(perez.id).not.toBe(jacksonville.id);
    expect(perez.id).not.toBe(casa.id);
    expect(jacksonville.id).not.toBe(casa.id);

    // Perez developer = ONE STOP DEVELOPMENT LLC
    expect(perez.developerName).toContain('ONE STOP DEVELOPMENT LLC');
    // Jacksonville title = ONE STOP CONSTRUCTORS INC (different entity)
    expect(jacksonville.title).toContain('ONE STOP CONSTRUCTORS INC');
    // Casa Rosario developer = ONE STOP DEVELOPMENT TWO LLC (different entity)
    expect(casa.developerName).toContain('ONE STOP DEVELOPMENT TWO LLC');
  });
});
