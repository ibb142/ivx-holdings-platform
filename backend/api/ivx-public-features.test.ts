import { describe, expect, test } from 'bun:test';
import { normalizePublicLandingDeals } from './ivx-public-features';

describe('public landing deals', () => {
  test('removes the known Casa placeholder and enforces canonical landing order', () => {
    const deals = normalizePublicLandingDeals([
      { id: 'ivx-deal-casa-rosario-2026', title: 'Casa Rosario — Mixed-Use Development', display_order: 999 },
      { id: 'JV-202603-5190', title: 'ONE STOP CONSTRUCTORS INC', display_order: 3 },
      { id: 'casa-rosario-001', title: 'Casa Rosario', display_order: 2 },
      { id: 'perez-residence-001', title: 'ONE STOP DEVELOPMENT LLC', display_order: 1 },
    ]);

    expect(deals.map((deal) => deal.id)).toEqual([
      'perez-residence-001',
      'casa-rosario-001',
      'JV-202603-5190',
    ]);
    expect(deals[2].title).toBe('IVX JACKSONVILLE PRIME');
  });

  test('does not hide a placeholder when no canonical Casa row exists', () => {
    const deals = normalizePublicLandingDeals([
      { id: 'ivx-deal-casa-rosario-2026', title: 'Casa Rosario', display_order: 9 },
      { id: 'future-deal', title: 'Future', display_order: 4 },
    ]);
    expect(deals.map((deal) => deal.id)).toEqual(['future-deal', 'ivx-deal-casa-rosario-2026']);
  });
});
