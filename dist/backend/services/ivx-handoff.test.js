import { describe, expect, test } from 'bun:test';
import { buildHandoffManifest, IVX_HANDOFF_MARKER } from './ivx-handoff';
describe('buildHandoffManifest', () => {
    test('covers all ten operator capabilities in owner order', async () => {
        const manifest = await buildHandoffManifest();
        expect(manifest.marker).toBe(IVX_HANDOFF_MARKER);
        expect(manifest.capabilities).toHaveLength(10);
        expect(manifest.capabilities.map((c) => c.id)).toEqual([
            '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
        ]);
        const expectedCapabilities = [
            'Inspect code',
            'Create tasks',
            'Generate patches',
            'Run checks',
            'Request approval',
            'Commit / push when approved',
            'Deploy',
            'Run Supabase actions',
            'Monitor live errors',
            'Generate final reports',
        ];
        expect(manifest.capabilities.map((c) => c.capability)).toEqual(expectedCapabilities);
    });
    test('every capability resolves to a real backing subsystem, owner-gated route, and readiness', async () => {
        const manifest = await buildHandoffManifest();
        for (const cap of manifest.capabilities) {
            expect(cap.backedBy.trim().length).toBeGreaterThan(0);
            expect(cap.route.includes('/api/ivx/') || cap.route.includes('/health')).toBe(true);
            expect(cap.authGate.toLowerCase()).toContain('owner');
            expect(['ready', 'partial', 'blocked']).toContain(cap.readiness);
            // A blocked capability MUST name the missing prerequisite (no silent gaps).
            if (cap.readiness === 'blocked') {
                expect(cap.missing && cap.missing.trim().length > 0).toBe(true);
            }
        }
    });
    test('destructive operator actions require explicit owner approval', async () => {
        const manifest = await buildHandoffManifest();
        const byId = (id) => manifest.capabilities.find((c) => c.id === id);
        // commit/push (6), deploy (7), and Supabase actions (8) must be approval-gated.
        expect(byId('6').requiresOwnerApproval).toBe(true);
        expect(byId('7').requiresOwnerApproval).toBe(true);
        expect(byId('8').requiresOwnerApproval).toBe(true);
        // inspection (1) and monitoring (9) are read-only — no approval needed.
        expect(byId('1').requiresOwnerApproval).toBe(false);
        expect(byId('9').requiresOwnerApproval).toBe(false);
    });
    test('summary totals are internally consistent and blocked items surface as owner actions', async () => {
        const manifest = await buildHandoffManifest();
        const { ready, partial, blocked, total } = manifest.summary;
        expect(ready + partial + blocked).toBe(total);
        expect(total).toBe(10);
        expect(manifest.handoffReady).toBe(blocked === 0);
        const blockedCaps = manifest.capabilities.filter((c) => c.readiness === 'blocked');
        for (const cap of blockedCaps) {
            expect(manifest.ownerActionsRequired.some((a) => a.includes(cap.capability))).toBe(true);
        }
    });
});
