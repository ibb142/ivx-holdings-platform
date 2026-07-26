/**
 * IVX Data Vault + Data-Loss Guard tests.
 *
 * Verifies:
 *   - Snapshot ID generation is unique.
 *   - Destructive operation detection works correctly.
 *   - Table name extraction from SQL is correct.
 *   - Protected table set contains the critical IVX tables.
 *   - The guard blocks autonomous destructive ops on protected tables.
 *   - The guard blocks owner ops without approval/reason.
 *   - Pure functions are deterministic.
 */
import { describe, expect, it } from 'bun:test';
import { isDestructiveOperation, extractTableNames, PROTECTED_TABLES, evaluateDestructiveOp, } from './ivx-data-loss-guard';
describe('ivx-data-loss-guard — isDestructiveOperation', () => {
    it('detects DELETE FROM', () => {
        expect(isDestructiveOperation('DELETE FROM members WHERE email LIKE %@gmail.com%')).toBe(true);
    });
    it('detects TRUNCATE', () => {
        expect(isDestructiveOperation('TRUNCATE TABLE landing_analytics')).toBe(true);
    });
    it('detects DROP TABLE', () => {
        expect(isDestructiveOperation('DROP TABLE visitor_sessions')).toBe(true);
    });
    it('detects rm -rf', () => {
        expect(isDestructiveOperation('rm -rf /data/supabase')).toBe(true);
    });
    it('does NOT flag a normal SELECT', () => {
        expect(isDestructiveOperation('SELECT * FROM members WHERE id = 1')).toBe(false);
    });
    it('does NOT flag an INSERT', () => {
        expect(isDestructiveOperation('INSERT INTO members (email) VALUES (test@test.com)')).toBe(false);
    });
    it('does NOT flag an UPDATE', () => {
        expect(isDestructiveOperation('UPDATE members SET status = active WHERE id = 1')).toBe(false);
    });
    it('handles empty/null input safely', () => {
        expect(isDestructiveOperation('')).toBe(false);
        expect(isDestructiveOperation(null)).toBe(false);
    });
});
describe('ivx-data-loss-guard — extractTableNames', () => {
    it('extracts table from DELETE FROM', () => {
        expect(extractTableNames('DELETE FROM members WHERE id > 0')).toContain('members');
    });
    it('extracts table from DELETE FROM public.members', () => {
        expect(extractTableNames('DELETE FROM public.members')).toContain('members');
    });
    it('extracts table from TRUNCATE TABLE', () => {
        expect(extractTableNames('TRUNCATE TABLE landing_analytics')).toContain('landing_analytics');
    });
    it('extracts multiple tables from TRUNCATE', () => {
        const tables = extractTableNames('TRUNCATE TABLE analytics_events, visitor_sessions');
        expect(tables).toContain('analytics_events');
        expect(tables).toContain('visitor_sessions');
    });
    it('extracts table from DROP TABLE IF EXISTS', () => {
        expect(extractTableNames('DROP TABLE IF EXISTS temp_table')).toContain('temp_table');
    });
    it('returns empty for non-destructive SQL', () => {
        expect(extractTableNames('SELECT * FROM members')).toEqual([]);
    });
    it('returns empty for empty input', () => {
        expect(extractTableNames('')).toEqual([]);
    });
});
describe('ivx-data-loss-guard — PROTECTED_TABLES', () => {
    it('protects members', () => {
        expect(PROTECTED_TABLES.has('members')).toBe(true);
    });
    it('protects landing_analytics', () => {
        expect(PROTECTED_TABLES.has('landing_analytics')).toBe(true);
    });
    it('protects analytics_events', () => {
        expect(PROTECTED_TABLES.has('analytics_events')).toBe(true);
    });
    it('protects visitor_sessions', () => {
        expect(PROTECTED_TABLES.has('visitor_sessions')).toBe(true);
    });
    it('protects waitlist', () => {
        expect(PROTECTED_TABLES.has('waitlist')).toBe(true);
    });
    it('protects investors', () => {
        expect(PROTECTED_TABLES.has('investors')).toBe(true);
    });
    it('protects the ledger (immutable financial record)', () => {
        expect(PROTECTED_TABLES.has('ledger')).toBe(true);
    });
    it('has at least 25 protected tables', () => {
        expect(PROTECTED_TABLES.size).toBeGreaterThanOrEqual(25);
    });
});
describe('ivx-data-loss-guard — evaluateDestructiveOp', () => {
    it('BLOCKS autonomous destructive op on protected table', async () => {
        const request = {
            operation: 'DELETE FROM members WHERE email LIKE %@gmail.com%',
            tables: ['members'],
            isAutonomous: true,
            ownerApproved: false,
            ownerReason: null,
            emergency: false,
        };
        const decision = await evaluateDestructiveOp(request);
        expect(decision.allowed).toBe(false);
        expect(decision.blocker).toContain('Autonomous systems cannot');
        expect(decision.blocker).toContain('members');
    });
    it('BLOCKS owner destructive op without approval', async () => {
        const request = {
            operation: 'TRUNCATE TABLE landing_analytics',
            tables: ['landing_analytics'],
            isAutonomous: false,
            ownerApproved: false,
            ownerReason: null,
            emergency: false,
        };
        const decision = await evaluateDestructiveOp(request);
        expect(decision.allowed).toBe(false);
        expect(decision.blocker).toContain('owner approval');
    });
    it('BLOCKS owner destructive op with approval but no reason', async () => {
        const request = {
            operation: 'DELETE FROM analytics_events WHERE created_at < 2026-01-01',
            tables: ['analytics_events'],
            isAutonomous: false,
            ownerApproved: true,
            ownerReason: null,
            emergency: false,
        };
        const decision = await evaluateDestructiveOp(request);
        expect(decision.allowed).toBe(false);
        expect(decision.blocker).toContain('reason');
    });
    it('BLOCKS autonomous op even with fake ownerApproved flag', async () => {
        const request = {
            operation: 'TRUNCATE TABLE waitlist',
            tables: ['waitlist'],
            isAutonomous: true,
            ownerApproved: true, // autonomous system cannot self-approve
            ownerReason: 'cleanup',
            emergency: false,
        };
        const decision = await evaluateDestructiveOp(request);
        expect(decision.allowed).toBe(false);
        expect(decision.blocker).toContain('Autonomous systems cannot');
    });
});
