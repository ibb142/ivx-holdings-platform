import { expect, test } from 'bun:test';
import { assertLedgerPageRequest, readLedgerEntries } from './ivx-senior-ledger-page';

test('pages preserve order and exact results while bounding each database response', async () => {
  const all = Array.from({ length: 123 }, (_, i) => ({ jobId: `job-${i}`, evidence: { original: i } }));
  const calls: unknown[] = [];
  const version = '2026-09-13T12:00:00.000Z';
  const rows = await readLedgerEntries(100, async (size, offset, expected) => {
    calls.push([size, offset, expected]);
    return { entries: all.slice(offset, offset + size), total: all.length, offset,
      nextOffset: offset + size < all.length ? offset + size : null, updatedAt: version };
  });
  expect(rows).toEqual(all.slice(0, 100));
  expect(calls).toEqual([[50, 0, null], [50, 50, version]]);
});

test('a changed revision or interrupted page never returns mixed or partial proof', async () => {
  for (const failure of ['changed', 'unavailable']) {
    let calls = 0;
    await expect(readLedgerEntries(100, async () => {
      if (calls++ && failure === 'unavailable') throw new Error('database unavailable');
      return { entries: [{ jobId: `job-${calls}` }], total: 100, offset: calls - 1, nextOffset: calls,
        updatedAt: calls === 1 ? '2026-09-13T12:00:00Z' : '2026-09-13T12:01:00Z' };
    })).rejects.toThrow(failure === 'changed' ? 'Ledger changed' : 'database unavailable');
  }
});

test('invalid sizes and cursors are rejected before a database read', () => {
  for (const [limit, offset] of [[0, 0], [51, 0], [25, -1], [25, 201], [NaN, 0]]) {
    expect(() => assertLedgerPageRequest(limit!, offset!, null)).toThrow();
  }
  expect(() => assertLedgerPageRequest(25, 0, 'invalid')).toThrow();
  expect(() => assertLedgerPageRequest(25, 0, null)).not.toThrow();
});
