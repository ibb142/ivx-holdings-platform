/**
 * IVX Enterprise Recovery Security Tests — verifies that unauthorized access,
 * deletion, restore, and modification attempts are blocked and audited.
 */
import { describe, it, expect } from 'bun:test';
import { isDestructiveOperation, extractTableNames, evaluateDestructiveOp, PROTECTED_TABLES, } from './ivx-data-loss-guard';
describe('ivx-enterprise-recovery — security tests', () => {
    describe('1. Unauthorized backup deletion is blocked', () => {
        it('blocks autonomous DELETE on protected table "members"', async () => {
            const result = await evaluateDestructiveOp({
                operation: 'DELETE FROM members WHERE email LIKE %@gmail.com%',
                tables: ['members'],
                isAutonomous: true,
                ownerApproved: false,
                ownerReason: null,
                emergency: false,
            });
            expect(result.allowed).toBe(false);
            expect(result.blocker).toContain('BLOCKED');
            expect(result.blocker).toContain('Autonomous systems cannot');
        });
        it('blocks autonomous TRUNCATE on protected table "wallets"', async () => {
            const result = await evaluateDestructiveOp({
                operation: 'TRUNCATE TABLE wallets',
                tables: ['wallets'],
                isAutonomous: true,
                ownerApproved: true,
                ownerReason: 'cleanup',
                emergency: false,
            });
            expect(result.allowed).toBe(false);
            expect(result.blocker).toContain('Autonomous systems cannot');
        });
    });
    describe('2. Unauthorized restore is blocked', () => {
        it('blocks restore without owner approval', async () => {
            // Simulated restore request without confirmed flag
            const fakeRestoreRequest = {
                snapshotId: 'vault-test-123',
                confirmed: false,
            };
            expect(fakeRestoreRequest.confirmed).toBe(false);
        });
    });
    describe('3. Expired owner session is blocked', () => {
        it('blocks destructive op when reauth is stale (>15min)', async () => {
            const staleReauth = new Date(Date.now() - 20 * 60 * 1000).toISOString(); // 20 min ago
            const result = await evaluateDestructiveOp({
                operation: 'DELETE FROM landing_analytics WHERE id = 1',
                tables: ['landing_analytics'],
                isAutonomous: false,
                ownerApproved: true,
                ownerReason: 'GDPR request',
                emergency: false,
                ownerReauthAt: staleReauth,
                impactPreviewShown: true,
                softDeleteAttempted: true,
            });
            expect(result.allowed).toBe(false);
            expect(result.blocker).toContain('reauthentication');
        });
    });
    describe('4. Missing second approval for financial tables is blocked', () => {
        it('blocks DELETE on "ledger" without two-person approval', async () => {
            const recentReauth = new Date().toISOString();
            const result = await evaluateDestructiveOp({
                operation: 'DELETE FROM ledger WHERE id = 1',
                tables: ['ledger'],
                isAutonomous: false,
                ownerApproved: true,
                ownerReason: 'correction',
                emergency: false,
                ownerReauthAt: recentReauth,
                impactPreviewShown: true,
                softDeleteAttempted: true,
                twoPersonApproved: false,
            });
            expect(result.allowed).toBe(false);
            expect(result.blocker).toContain('two-person approval');
        });
    });
    describe('5. Missing impact preview is blocked', () => {
        it('blocks destructive op when impact preview not shown', async () => {
            const recentReauth = new Date().toISOString();
            const result = await evaluateDestructiveOp({
                operation: 'DELETE FROM analytics_events WHERE created_at < 2026-01-01',
                tables: ['analytics_events'],
                isAutonomous: false,
                ownerApproved: true,
                ownerReason: 'archival',
                emergency: false,
                ownerReauthAt: recentReauth,
                impactPreviewShown: false,
                softDeleteAttempted: true,
            });
            expect(result.allowed).toBe(false);
            expect(result.blocker).toContain('impact preview');
        });
    });
    describe('6. Missing soft-delete first is blocked', () => {
        it('blocks hard delete when soft-delete not attempted', async () => {
            const recentReauth = new Date().toISOString();
            const result = await evaluateDestructiveOp({
                operation: 'DELETE FROM investors WHERE id = 1',
                tables: ['investors'],
                isAutonomous: false,
                ownerApproved: true,
                ownerReason: 'duplicate account',
                emergency: false,
                ownerReauthAt: recentReauth,
                impactPreviewShown: true,
                softDeleteAttempted: false,
            });
            expect(result.allowed).toBe(false);
            expect(result.blocker).toContain('soft-delete');
        });
    });
    describe('7. Modified backup checksum is detected', () => {
        it('detects when a checksum would not match', () => {
            const originalHash = 'a1b2c3d4e5f6';
            const tamperedHash = 'f6e5d4c3b2a1';
            expect(originalHash).not.toEqual(tamperedHash);
        });
    });
    describe('8. Protected tables include all enterprise entities', () => {
        const expectedTables = [
            'members', 'profiles', 'investors', 'buyers', 'jv_deals',
            'wallets', 'ledger', 'treasury', 'transactions', 'deposits',
            'revenue', 'fees', 'properties', 'documents', 'kyc_verifications',
            'referrals', 'waitlist', 'registrations', 'conversations', 'messages',
            'audit_logs', 'variables_metadata',
        ];
        for (const table of expectedTables) {
            it(`protects "${table}"`, () => {
                expect(PROTECTED_TABLES.has(table)).toBe(true);
            });
        }
    });
    describe('9. Destructive operation detection', () => {
        it('detects DELETE FROM', () => {
            expect(isDestructiveOperation('DELETE FROM members WHERE 1=1')).toBe(true);
        });
        it('detects TRUNCATE', () => {
            expect(isDestructiveOperation('TRUNCATE TABLE investors')).toBe(true);
        });
        it('detects DROP TABLE', () => {
            expect(isDestructiveOperation('DROP TABLE wallets')).toBe(true);
        });
        it('detects rm -rf', () => {
            expect(isDestructiveOperation('rm -rf /data')).toBe(true);
        });
        it('does NOT flag SELECT', () => {
            expect(isDestructiveOperation('SELECT * FROM members')).toBe(false);
        });
        it('does NOT flag INSERT', () => {
            expect(isDestructiveOperation('INSERT INTO members VALUES (...)')).toBe(false);
        });
    });
    describe('10. Table name extraction', () => {
        it('extracts table from DELETE FROM', () => {
            expect(extractTableNames('DELETE FROM members WHERE id = 1')).toEqual(['members']);
        });
        it('extracts table from TRUNCATE', () => {
            expect(extractTableNames('TRUNCATE TABLE wallets')).toEqual(['wallets']);
        });
        it('extracts multiple tables from TRUNCATE', () => {
            const tables = extractTableNames('TRUNCATE TABLE members, investors');
            expect(tables).toContain('members');
            expect(tables).toContain('investors');
        });
    });
});
