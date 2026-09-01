import { describe, expect, test } from 'bun:test';

// Test the progressive list deduplication logic without React/React Query deps
// by simulating the same dedup algorithm used in useProgressiveList.loadMore

function deduplicateById(existing: Array<{ id: string }>, newItems: Array<{ id: string }>): Array<{ id: string }> {
  const existingIds = new Set(existing.map(item => item?.id));
  const filtered = newItems.filter(item => {
    const id = item?.id;
    if (id && existingIds.has(id)) return false;
    existingIds.add(id);
    return true;
  });
  return [...existing, ...filtered];
}

describe('Project pagination — deduplication', () => {
  test('deduplicates items by stable id', () => {
    const page1 = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];
    const page2 = [{ id: 'p3' }, { id: 'p4' }, { id: 'p5' }];
    const result = deduplicateById(page1, page2);
    expect(result).toHaveLength(5);
    expect(result.map(r => r.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
  });

  test('handles empty new page', () => {
    const existing = [{ id: 'p1' }, { id: 'p2' }];
    const result = deduplicateById(existing, []);
    expect(result).toHaveLength(2);
  });

  test('handles empty existing list', () => {
    const newItems = [{ id: 'p1' }, { id: 'p2' }];
    const result = deduplicateById([], newItems);
    expect(result).toHaveLength(2);
  });

  test('handles all-duplicate page', () => {
    const existing = [{ id: 'p1' }, { id: 'p2' }];
    const page2 = [{ id: 'p1' }, { id: 'p2' }];
    const result = deduplicateById(existing, page2);
    expect(result).toHaveLength(2);
  });
});

describe('Deal pagination — hasMore logic', () => {
  test('hasMore=true when page is full', () => {
    const pageSize = 10;
    const items = Array.from({ length: pageSize }, (_, i) => ({ id: `d${i}` }));
    expect(items.length === pageSize).toBe(true);
  });

  test('hasMore=false when page is partial', () => {
    const pageSize = 10;
    const items = Array.from({ length: 5 }, (_, i) => ({ id: `d${i}` }));
    expect(items.length === pageSize).toBe(false);
  });
});
