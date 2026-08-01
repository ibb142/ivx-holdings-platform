import { describe, expect, it } from 'bun:test';
import { createItem, listItems } from './gate5-materialize-test-item-store';

describe('Item store', () => {
  it('creates and lists Item', async () => {
    const before = await listItems();
    expect(Array.isArray(before)).toBe(true);
  });
});
