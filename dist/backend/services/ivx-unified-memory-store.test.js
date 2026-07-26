/**
 * Tests for the IVX Unified Executive Memory store (BLOCK 39).
 *
 * Pure helpers (filter/summarize/validate/title-normalize) need no I/O. The
 * durable round-trip uses UNIQUE titles + cleanup so it never collides with the
 * shared on-disk store and proves remember → recall → refine → forget across a
 * fresh read (the way a new process re-hydrates).
 */
import { describe, expect, test } from 'bun:test';
import { IVX_UNIFIED_MEMORY_MARKER, validateMemoryInput, normalizeMemoryTitle, filterMemories, summarizeMemoryRecords, remember, recall, getMemory, forget, } from './ivx-unified-memory-store';
function uniqueSuffix() {
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
function rec(partial) {
    return {
        id: partial.id ?? 'id',
        kind: partial.kind ?? 'goal',
        title: partial.title ?? 'Title',
        summary: partial.summary ?? '',
        data: partial.data ?? {},
        tags: partial.tags ?? [],
        source: partial.source ?? 'system',
        status: partial.status ?? 'active',
        relatedIds: partial.relatedIds ?? [],
        createdAt: partial.createdAt ?? '2026-06-02T00:00:00.000Z',
        updatedAt: partial.updatedAt ?? '2026-06-02T00:00:00.000Z',
    };
}
describe('validateMemoryInput', () => {
    test('requires a valid kind', () => {
        const result = validateMemoryInput({ kind: 'nonsense', title: 'X' });
        expect(result.ok).toBe(false);
    });
    test('requires a non-empty title', () => {
        const result = validateMemoryInput({ kind: 'goal', title: '   ' });
        expect(result.ok).toBe(false);
    });
    test('accepts a valid input', () => {
        expect(validateMemoryInput({ kind: 'decision', title: 'Engage investor' }).ok).toBe(true);
    });
});
describe('normalizeMemoryTitle', () => {
    test('lowercases + collapses whitespace', () => {
        expect(normalizeMemoryTitle('  Engage   Investor ')).toBe('engage investor');
    });
});
describe('filterMemories', () => {
    const records = [
        rec({ id: '1', kind: 'goal', title: 'Raise capital', tags: ['capital'], updatedAt: '2026-06-02T01:00:00.000Z' }),
        rec({ id: '2', kind: 'outcome', title: 'Closed deal', tags: ['win'], source: 'owner_ai', updatedAt: '2026-06-02T03:00:00.000Z' }),
        rec({ id: '3', kind: 'goal', title: 'Hire team', tags: ['team'], status: 'archived', updatedAt: '2026-06-02T02:00:00.000Z' }),
    ];
    test('filters by kind', () => {
        expect(filterMemories(records, { kind: 'goal' }).map((r) => r.id).sort()).toEqual(['1', '3']);
    });
    test('filters by tag + source + status', () => {
        expect(filterMemories(records, { source: 'owner_ai' }).map((r) => r.id)).toEqual(['2']);
        expect(filterMemories(records, { tag: 'team' }).map((r) => r.id)).toEqual(['3']);
        expect(filterMemories(records, { status: 'archived' }).map((r) => r.id)).toEqual(['3']);
    });
    test('search matches title/summary/tags case-insensitively', () => {
        expect(filterMemories(records, { search: 'CLOSED' }).map((r) => r.id)).toEqual(['2']);
    });
    test('sorts newest-updated first + honours limit', () => {
        expect(filterMemories(records).map((r) => r.id)).toEqual(['2', '3', '1']);
        expect(filterMemories(records, { limit: 1 }).map((r) => r.id)).toEqual(['2']);
    });
});
describe('summarizeMemoryRecords', () => {
    test('rolls up by kind + source with marker + last-updated', () => {
        const summary = summarizeMemoryRecords([
            rec({ kind: 'goal', source: 'owner_ai', updatedAt: '2026-06-02T01:00:00.000Z' }),
            rec({ kind: 'goal', source: 'crm_ai', updatedAt: '2026-06-02T05:00:00.000Z' }),
            rec({ kind: 'outcome', source: 'owner_ai', updatedAt: '2026-06-02T02:00:00.000Z' }),
        ]);
        expect(summary.marker).toBe(IVX_UNIFIED_MEMORY_MARKER);
        expect(summary.total).toBe(3);
        expect(summary.byKind.goal).toBe(2);
        expect(summary.byKind.outcome).toBe(1);
        expect(summary.bySource.owner_ai).toBe(2);
        expect(summary.lastUpdatedAt).toBe('2026-06-02T05:00:00.000Z');
    });
    test('empty store is honest zeros + null last-updated', () => {
        const summary = summarizeMemoryRecords([]);
        expect(summary.total).toBe(0);
        expect(summary.lastUpdatedAt).toBeNull();
    });
});
describe('durable round-trip (cross-session)', () => {
    test('remember → recall → refine (merge) → forget', async () => {
        const tag = `block39_${uniqueSuffix()}`;
        const title = `Raise seed round ${uniqueSuffix()}`;
        const created = await remember({
            kind: 'goal',
            title,
            summary: 'Close a $500k round',
            tags: [tag, 'capital'],
            source: 'owner_ai',
            data: { target: 500000 },
        });
        expect(created.ok).toBe(true);
        if (!created.ok)
            return;
        expect(created.refined).toBe(false);
        const id = created.record.id;
        // Fresh read from disk re-hydrates the record (cross-session proof).
        const recalled = await recall({ tag });
        expect(recalled.some((r) => r.id === id)).toBe(true);
        // Same kind+title refines instead of duplicating + merges data/tags.
        const refined = await remember({
            kind: 'goal',
            title: `  ${title.toUpperCase()}  `,
            tags: ['priority'],
            data: { stage: 'active' },
        });
        expect(refined.ok).toBe(true);
        if (!refined.ok)
            return;
        expect(refined.refined).toBe(true);
        expect(refined.record.id).toBe(id);
        expect(refined.record.data.target).toBe(500000);
        expect(refined.record.data.stage).toBe('active');
        expect(refined.record.tags).toContain('priority');
        expect(refined.record.tags).toContain('capital');
        // Only one record exists for that tag (no duplicate).
        expect((await recall({ tag })).filter((r) => r.id === id)).toHaveLength(1);
        expect(await forget(id)).toBe(true);
        expect(await getMemory(id)).toBeNull();
    });
});
