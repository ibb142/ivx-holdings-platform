import { describe, expect, test } from 'bun:test';
import { parseContentRangeCount, detectCountIntent, buildCountGroundingBlock, } from './ivx-db-count';
describe('parseContentRangeCount', () => {
    test('parses the total after the slash', () => {
        expect(parseContentRangeCount('0-24/573')).toBe(573);
        expect(parseContentRangeCount('0-0/150')).toBe(150);
        expect(parseContentRangeCount('*/0')).toBe(0);
    });
    test('returns null for unknown / malformed headers', () => {
        expect(parseContentRangeCount(null)).toBeNull();
        expect(parseContentRangeCount('')).toBeNull();
        expect(parseContentRangeCount('0-24/*')).toBeNull();
        expect(parseContentRangeCount('garbage')).toBeNull();
    });
});
describe('detectCountIntent', () => {
    test('detects investor / buyer / deal count questions', () => {
        expect(detectCountIntent('How many investors do I have?')).toEqual(['investors']);
        expect(detectCountIntent('number of buyers in the system')).toEqual(['buyers']);
        expect(detectCountIntent('count of JV deals')).toEqual(['jv_deals']);
        expect(detectCountIntent('how many projects are live')).toEqual(['jv_deals']);
    });
    test('detects multiple targets in one question', () => {
        const targets = detectCountIntent('how many investors and buyers do we have?');
        expect(targets).toContain('investors');
        expect(targets).toContain('buyers');
    });
    test('ignores non-count questions even when entities are mentioned', () => {
        expect(detectCountIntent('Tell me about my investors')).toEqual([]);
        expect(detectCountIntent('What is the best deal?')).toEqual([]);
        expect(detectCountIntent('How do I reset my password?')).toEqual([]);
    });
    test('returns empty for empty input', () => {
        expect(detectCountIntent('')).toEqual([]);
        expect(detectCountIntent('   ')).toEqual([]);
    });
});
function result(overrides) {
    return {
        target: 'investors',
        ok: true,
        count: 150,
        table: 'investors',
        httpStatus: 200,
        reason: 'ok',
        detail: 'ok',
        queriedAt: '2026-06-14T00:00:00.000Z',
        executed: true,
        ...overrides,
    };
}
describe('buildCountGroundingBlock', () => {
    test('renders exact counts and forbids query narration', () => {
        const report = {
            results: [result({ target: 'investors', count: 150 })],
            anyExecuted: true,
            anyOk: true,
        };
        const block = buildCountGroundingBlock(report);
        expect(block).toContain('150');
        expect(block).toContain('count=exact');
        expect(block).toContain('Do NOT estimate, round, or invent');
        expect(block).toContain('I am running these queries now');
    });
    test('states honest reason for missing tables instead of a number', () => {
        const report = {
            results: [
                result({ target: 'buyers', ok: false, count: null, table: null, reason: 'table_not_found', detail: 'No Supabase table for buyers exists.' }),
            ],
            anyExecuted: true,
            anyOk: false,
        };
        const block = buildCountGroundingBlock(report);
        expect(block).toContain('NO LIVE COUNT');
        expect(block).toContain('No Supabase table for buyers exists.');
    });
    test('returns null when there are no results', () => {
        expect(buildCountGroundingBlock({ results: [], anyExecuted: false, anyOk: false })).toBeNull();
    });
});
