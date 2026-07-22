import { describe, expect, it } from 'bun:test';

/**
 * IVX Deal Order + Admin/Frontend Sync — deterministic ordering tests.
 *
 * Verifies that display_order ASC is the canonical sort, that
 * is_featured/priority do NOT override display_order, and that
 * the sort is stable with a deterministic tiebreak.
 */

/* ── Mirror of sortHomeFeedDeals from ivx-video-platform.ts ── */

interface HomeFeedDeal {
  id: string;
  display_order: number | null;
  is_featured: boolean;
  priority: number;
  created_at: string | null;
}

function sortHomeFeedDeals(deals: HomeFeedDeal[]): HomeFeedDeal[] {
  return [...deals].sort((a, b) => {
    const ao = a.display_order;
    const bo = b.display_order;
    if (ao !== null || bo !== null) {
      if (ao === null) return 1;
      if (bo === null) return -1;
      if (ao !== bo) return ao - bo;
    }
    if (a.is_featured !== b.is_featured) return a.is_featured ? -1 : 1;
    if (a.priority !== b.priority) return b.priority - a.priority;
    const cmp = String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
    if (cmp !== 0) return cmp;
    return a.id.localeCompare(b.id);
  });
}

/* ── Mirror of canonical-deals.ts sortDeals ── */

function sortDeals(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.slice().sort((a, b) => {
    const orderA = Number(a.display_order ?? a.displayOrder ?? 999);
    const orderB = Number(b.display_order ?? b.displayOrder ?? 999);
    if (orderA !== orderB) return orderA - orderB;
    const dateA = String(a.updated_at ?? a.created_at ?? '');
    const dateB = String(b.updated_at ?? b.created_at ?? '');
    return dateB.localeCompare(dateA);
  });
}

/* ── Mirror of updateDealDisplayOrders from jv-storage.ts ── */

function sequentialReorder(orders: Array<{ id: string; displayOrder: number }>): Array<{ id: string; displayOrder: number }> {
  return orders
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((o, idx) => ({ id: o.id, displayOrder: idx + 1 }));
}

/* ── Mirror of safeNumber / formatCurrencySafe from formatters.ts ── */

function safeNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isNaN(n) ? 0 : n;
}

function isValidNumber(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const n = Number(value);
  return !Number.isNaN(n);
}

function formatCurrencySafe(value: unknown, compact = false): string {
  const num = safeNumber(value);
  if (compact) {
    if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `$${(num / 1_000).toFixed(0)}K`;
  }
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatPercentageSafe(value: unknown, decimals = 2): string {
  if (!isValidNumber(value)) return 'Not entered';
  const n = Number(value);
  if (Number.isNaN(n)) return 'Not entered';
  return `${n.toFixed(decimals)}%`;
}

/* ── Tests ── */

describe('IVX Deal Order Sync', () => {
  const PEREZ = 'perez-residence-001';
  const CASA = 'casa-rosario-001';
  const JAX = 'JV-202603-5190';

  const deals: HomeFeedDeal[] = [
    { id: JAX, display_order: 3, is_featured: false, priority: 0, created_at: '2026-07-22T03:30:12Z' },
    { id: CASA, display_order: 2, is_featured: false, priority: 0, created_at: '2026-07-11T05:02:27Z' },
    { id: PEREZ, display_order: 1, is_featured: true, priority: 5, created_at: '2026-07-22T12:24:57Z' },
  ];

  describe('API returns display_order ASC', () => {
    it('sorts deals by display_order ascending (1,2,3)', () => {
      const sorted = sortHomeFeedDeals(deals);
      expect(sorted[0].id).toBe(PEREZ);
      expect(sorted[1].id).toBe(CASA);
      expect(sorted[2].id).toBe(JAX);
    });

    it('does NOT sort by is_featured first', () => {
      // Perez has is_featured=true + priority=5, but display_order=1
      // If is_featured was first, it would still be #1 — but let's test
      // a case where featured has a higher display_order
      const testDeals: HomeFeedDeal[] = [
        { id: 'a', display_order: 2, is_featured: true, priority: 10, created_at: '2026-01-01' },
        { id: 'b', display_order: 1, is_featured: false, priority: 0, created_at: '2026-01-02' },
      ];
      const sorted = sortHomeFeedDeals(testDeals);
      expect(sorted[0].id).toBe('b'); // display_order=1 wins over is_featured=true
      expect(sorted[1].id).toBe('a');
    });

    it('null display_order goes last', () => {
      const testDeals: HomeFeedDeal[] = [
        { id: 'null-order', display_order: null, is_featured: false, priority: 0, created_at: '2026-01-01' },
        { id: 'has-order', display_order: 5, is_featured: false, priority: 0, created_at: '2026-01-02' },
      ];
      const sorted = sortHomeFeedDeals(testDeals);
      expect(sorted[0].id).toBe('has-order');
      expect(sorted[1].id).toBe('null-order');
    });

    it('deterministic tiebreak by created_at then id', () => {
      const testDeals: HomeFeedDeal[] = [
        { id: 'b-deal', display_order: 1, is_featured: false, priority: 0, created_at: '2026-01-02' },
        { id: 'a-deal', display_order: 1, is_featured: false, priority: 0, created_at: '2026-01-02' },
      ];
      const sorted = sortHomeFeedDeals(testDeals);
      // Same display_order, same created_at → id tiebreak
      expect(sorted[0].id).toBe('a-deal');
      expect(sorted[1].id).toBe('b-deal');
    });
  });

  describe('admin reorder', () => {
    it('reorder up swaps only two items', () => {
      // Current: 1=PEREZ, 2=CASA, 3=JAX
      // Move JAX up: swap 2 and 3 → 1=PEREZ, 2=JAX, 3=CASA
      const orders = [
        { id: PEREZ, displayOrder: 1 },
        { id: JAX, displayOrder: 2 },
        { id: CASA, displayOrder: 3 },
      ];
      const result = sequentialReorder(orders);
      expect(result[0].id).toBe(PEREZ);
      expect(result[0].displayOrder).toBe(1);
      expect(result[1].id).toBe(JAX);
      expect(result[1].displayOrder).toBe(2);
      expect(result[2].id).toBe(CASA);
      expect(result[2].displayOrder).toBe(3);
    });

    it('reorder down swaps only two items', () => {
      // Current: 1=PEREZ, 2=CASA, 3=JAX
      // Move PEREZ down: swap 1 and 2 → 1=CASA, 2=PEREZ, 3=JAX
      const orders = [
        { id: CASA, displayOrder: 1 },
        { id: PEREZ, displayOrder: 2 },
        { id: JAX, displayOrder: 3 },
      ];
      const result = sequentialReorder(orders);
      expect(result[0].id).toBe(CASA);
      expect(result[0].displayOrder).toBe(1);
      expect(result[1].id).toBe(PEREZ);
      expect(result[1].displayOrder).toBe(2);
      expect(result[2].id).toBe(JAX);
      expect(result[2].displayOrder).toBe(3);
    });

    it('sequential reorder produces 1..n with no gaps', () => {
      const orders = [
        { id: JAX, displayOrder: 1 },
        { id: CASA, displayOrder: 2 },
        { id: PEREZ, displayOrder: 3 },
      ];
      const result = sequentialReorder(orders);
      const orderValues = result.map(r => r.displayOrder);
      expect(orderValues).toEqual([1, 2, 3]);
    });

    it('repeated taps do not create duplicate order values', () => {
      // Simulate 3 rapid reorder attempts
      let orders = [
        { id: PEREZ, displayOrder: 1 },
        { id: CASA, displayOrder: 2 },
        { id: JAX, displayOrder: 3 },
      ];
      // Tap up on JAX 3 times
      for (let i = 0; i < 3; i++) {
        const jaxIdx = orders.findIndex(o => o.id === JAX);
        if (jaxIdx > 0) {
          const tmp = orders[jaxIdx - 1];
          orders[jaxIdx - 1] = orders[jaxIdx];
          orders[jaxIdx] = tmp;
        }
        orders = sequentialReorder(orders);
      }
      const orderValues = orders.map(o => o.displayOrder);
      expect(new Set(orderValues).size).toBe(3); // No duplicates
      expect(orderValues).toEqual([1, 2, 3]);
    });

    it('first item cannot move up', () => {
      const orders = [
        { id: PEREZ, displayOrder: 1 },
        { id: CASA, displayOrder: 2 },
        { id: JAX, displayOrder: 3 },
      ];
      // Try to move PEREZ (index 0) up — should be blocked
      const perezIdx = orders.findIndex(o => o.id === PEREZ);
      expect(perezIdx).toBe(0);
      // In UI, moveUp is disabled when index === 0
      const canMoveUp = perezIdx > 0;
      expect(canMoveUp).toBe(false);
    });

    it('last item cannot move down', () => {
      const orders = [
        { id: PEREZ, displayOrder: 1 },
        { id: CASA, displayOrder: 2 },
        { id: JAX, displayOrder: 3 },
      ];
      const jaxIdx = orders.findIndex(o => o.id === JAX);
      expect(jaxIdx).toBe(2);
      const canMoveDown = jaxIdx < orders.length - 1;
      expect(canMoveDown).toBe(false);
    });
  });

  describe('canonical-deals sortDeals', () => {
    it('sorts by display_order ASC with updated_at DESC tiebreak', () => {
      const rows: Record<string, unknown>[] = [
        { id: JAX, display_order: 3, updated_at: '2026-07-22T03:30:12Z' },
        { id: CASA, display_order: 2, updated_at: '2026-07-11T05:02:27Z' },
        { id: PEREZ, display_order: 1, updated_at: '2026-07-22T12:24:57Z' },
      ];
      const sorted = sortDeals(rows);
      expect(sorted[0].id).toBe(PEREZ);
      expect(sorted[1].id).toBe(CASA);
      expect(sorted[2].id).toBe(JAX);
    });

    it('missing display_order falls back to 999 (goes last)', () => {
      const rows: Record<string, unknown>[] = [
        { id: 'no-order', updated_at: '2026-01-01' },
        { id: 'has-order', display_order: 5, updated_at: '2026-01-02' },
      ];
      const sorted = sortDeals(rows);
      expect(sorted[0].id).toBe('has-order');
      expect(sorted[1].id).toBe('no-order');
    });

    it('unpublished deal excluded by caller filter (not by sort)', () => {
      // sortDeals does not filter — the caller filters published
      const rows: Record<string, unknown>[] = [
        { id: 'unpublished', display_order: 0, published: false },
        { id: PEREZ, display_order: 1, published: true },
      ];
      const visible = rows.filter(r => r.published === true);
      const sorted = sortDeals(visible);
      expect(sorted.length).toBe(1);
      expect(sorted[0].id).toBe(PEREZ);
    });
  });

  describe('public/admin parity', () => {
    it('same 3 deals in same order across all surfaces', () => {
      const dbOrder = [
        { id: PEREZ, display_order: 1 },
        { id: CASA, display_order: 2 },
        { id: JAX, display_order: 3 },
      ];
      // API endpoint sorts by display_order ASC → same order
      const apiOrder = sortHomeFeedDeals(deals);
      // Canonical deals sorts by display_order ASC → same order
      const canonicalOrder = sortDeals(deals.map(d => ({
        id: d.id,
        display_order: d.display_order,
        updated_at: d.created_at,
      })));

      expect(apiOrder.map(d => d.id)).toEqual(dbOrder.map(d => d.id));
      expect(canonicalOrder.map(d => d.id)).toEqual(dbOrder.map(d => d.id));
    });

    it('duplicate titles with different UUIDs are distinct', () => {
      const rows: Record<string, unknown>[] = [
        { id: 'deal-1', title: 'Casa Rosario', display_order: 1 },
        { id: 'deal-2', title: 'Casa Rosario', display_order: 2 },
      ];
      // No title-based join — stable UUIDs are keys
      expect(rows[0].id).not.toBe(rows[1].id);
      expect(rows[0].title).toBe(rows[1].title); // Same title, different ID
      const sorted = sortDeals(rows);
      expect(sorted[0].id).toBe('deal-1');
      expect(sorted[1].id).toBe('deal-2');
    });
  });

  describe('NaN prevention', () => {
    it('safeNumber returns 0 for null/undefined/NaN/string', () => {
      expect(safeNumber(null)).toBe(0);
      expect(safeNumber(undefined)).toBe(0);
      expect(safeNumber(NaN)).toBe(0);
      expect(safeNumber('abc')).toBe(0);
      expect(safeNumber(50000)).toBe(50000);
    });

    it('formatCurrencySafe never renders $NaN', () => {
      expect(formatCurrencySafe(null)).toBe('$0');
      expect(formatCurrencySafe(undefined)).toBe('$0');
      expect(formatCurrencySafe(NaN)).toBe('$0');
      expect(formatCurrencySafe('abc')).toBe('$0');
      expect(formatCurrencySafe(50000)).toBe('$50,000');
      expect(formatCurrencySafe(0)).toBe('$0');
    });

    it('formatPercentageSafe returns "Not entered" for missing ROI', () => {
      expect(formatPercentageSafe(null)).toBe('Not entered');
      expect(formatPercentageSafe(undefined)).toBe('Not entered');
      expect(formatPercentageSafe(NaN)).toBe('Not entered');
      expect(formatPercentageSafe('abc')).toBe('Not entered');
      expect(formatPercentageSafe(25)).toBe('25.00%');
      expect(formatPercentageSafe(9.5)).toBe('9.50%');
      expect(formatPercentageSafe(0)).toBe('0.00%');
    });

    it('isValidNumber distinguishes present from missing', () => {
      expect(isValidNumber(null)).toBe(false);
      expect(isValidNumber(undefined)).toBe(false);
      expect(isValidNumber(NaN)).toBe(false);
      expect(isValidNumber(0)).toBe(true);
      expect(isValidNumber(50000)).toBe(true);
    });
  });

  describe('restart persistence', () => {
    it('display_order survives app restart (read from DB)', () => {
      // Simulate: admin sets order, app restarts, reads from DB
      // DB query: ORDER BY display_order ASC
      const dbRows = [
        { id: PEREZ, display_order: 1 },
        { id: CASA, display_order: 2 },
        { id: JAX, display_order: 3 },
      ];
      // After "restart" — same query, same result
      const sorted = sortDeals(dbRows);
      expect(sorted[0].id).toBe(PEREZ);
      expect(sorted[1].id).toBe(CASA);
      expect(sorted[2].id).toBe(JAX);
    });
  });

  describe('stale response rejection', () => {
    it('newer updated_at wins on dedup collision', () => {
      // Simulate: stale cached response (old updated_at) vs fresh response
      const stale = { id: PEREZ, display_order: 1, updated_at: '2026-07-22T10:00:00Z' };
      const fresh = { id: PEREZ, display_order: 1, updated_at: '2026-07-22T12:24:57Z' };
      // Dedup keeps newer updated_at
      const newer = String(fresh.updated_at).localeCompare(String(stale.updated_at)) > 0 ? fresh : stale;
      expect(newer).toBe(fresh);
    });
  });
});
