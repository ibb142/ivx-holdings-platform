import { describe, expect, test } from 'bun:test';

// Test the realtime delta update logic without React/Supabase deps
// by simulating the same applyDeltaToQueryCache algorithm

function applyDelta(
  items: Array<{ id: string; [key: string]: unknown }>,
  event: 'INSERT' | 'UPDATE' | 'DELETE',
  record: { id: string; [key: string]: unknown },
): Array<{ id: string; [key: string]: unknown }> {
  const recordId = String(record.id);
  const existingIndex = items.findIndex(item => String(item.id) === recordId);

  switch (event) {
    case 'INSERT': {
      if (existingIndex >= 0) {
        const updated = [...items];
        updated[existingIndex] = record;
        return updated;
      }
      return [record, ...items];
    }
    case 'UPDATE': {
      if (existingIndex >= 0) {
        const updated = [...items];
        updated[existingIndex] = record;
        return updated;
      }
      return items;
    }
    case 'DELETE': {
      if (existingIndex >= 0) {
        return items.filter((_, i) => i !== existingIndex);
      }
      return items;
    }
    default:
      return items;
  }
}

describe('Realtime delta — INSERT', () => {
  test('adds new record at beginning', () => {
    const items = [{ id: 'd1', title: 'Deal 1' }];
    const result = applyDelta(items, 'INSERT', { id: 'd2', title: 'Deal 2' });
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('d2');
  });

  test('updates in place if already exists (no duplicate)', () => {
    const items = [{ id: 'd1', title: 'Old' }];
    const result = applyDelta(items, 'INSERT', { id: 'd1', title: 'New' });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('New');
  });
});

describe('Realtime delta — UPDATE', () => {
  test('updates existing record by stable ID', () => {
    const items = [{ id: 'd1', title: 'Old', published: false }];
    const result = applyDelta(items, 'UPDATE', { id: 'd1', title: 'New', published: true });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('New');
    expect(result[0].published).toBe(true);
  });

  test('ignores update for record not in current page', () => {
    const items = [{ id: 'd1', title: 'Deal 1' }];
    const result = applyDelta(items, 'UPDATE', { id: 'd99', title: 'Not in page' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('d1');
  });
});

describe('Realtime delta — DELETE', () => {
  test('removes record by stable ID', () => {
    const items = [{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }];
    const result = applyDelta(items, 'DELETE', { id: 'd2' });
    expect(result).toHaveLength(2);
    expect(result.map(r => r.id)).toEqual(['d1', 'd3']);
  });

  test('no-op if record not found', () => {
    const items = [{ id: 'd1' }];
    const result = applyDelta(items, 'DELETE', { id: 'd99' });
    expect(result).toHaveLength(1);
  });
});

describe('Realtime delta — preserves pagination state', () => {
  test('does not add extra records beyond page on UPDATE', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: `d${i}` }));
    const result = applyDelta(items, 'UPDATE', { id: 'd5', updated: true });
    expect(result).toHaveLength(10);
  });

  test('INSERT adds one but does not duplicate', () => {
    const items = [{ id: 'd1' }, { id: 'd2' }];
    const result = applyDelta(items, 'INSERT', { id: 'd3' });
    expect(result).toHaveLength(3);
    const ids = result.map(r => r.id);
    expect(new Set(ids).size).toBe(3);
  });
});
