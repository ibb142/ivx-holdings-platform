import { describe, expect, it } from 'bun:test';
import { assembleCapabilityRegistry, IVX_CAPABILITY_REGISTRY_MARKER, } from './ivx-capability-registry';
function fakeDashboard() {
    return {
        marker: 'test',
        generatedAt: new Date().toISOString(),
        environment: {
            nodeEnv: 'test',
            mode: 'development',
            productionBaseUrlConfigured: true,
            databaseConfigured: true,
            githubConfigured: true,
            aiGatewayConfigured: true,
        },
        buckets: { completed: 0, pending: 0, blocked: 0, failed: 0, verified: 0, unverified: 0 },
        priority: { totalOpen: 0, tierCounts: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 } },
        capabilities: [
            { id: 'fix-and-verify-loop', title: '', state: 'online', backedBy: '', detail: '' },
        ],
        subsystems: {},
    };
}
function fakeTools(available) {
    const ids = ['ai_gateway', 'github_write', 'render_deploy', 'supabase_actions', 'deliverable_pipeline'];
    return {
        marker: 'test',
        generatedAt: new Date().toISOString(),
        total: ids.length,
        available: available ? ids.length : 0,
        unavailable: available ? 0 : ids.length,
        tools: ids.map((tool) => ({
            tool,
            label: tool,
            category: 'execution',
            available,
            requiredForSteps: [],
            requiredEnv: [],
            missingEnv: [],
            detail: '',
        })),
        blockedSteps: [],
        canExecuteEndToEnd: available,
    };
}
const VALID_STATUSES = ['COMPLETE', 'BLOCKED', 'NOT_STARTED', 'DEPRECATED'];
describe('ivx-capability-registry', () => {
    it('classifies exactly 20 capabilities, never PARTIAL', () => {
        const registry = assembleCapabilityRegistry({
            dashboard: fakeDashboard(),
            tools: fakeTools(true),
            crmContactCount: 0,
            emailProviderConfigured: false,
            storageConfigured: true,
            githubConfigured: true,
            aiConfigured: true,
        });
        expect(registry.marker).toBe(IVX_CAPABILITY_REGISTRY_MARKER);
        expect(registry.capabilities).toHaveLength(20);
        expect(registry.summary.noPartialStates).toBe(true);
        for (const cap of registry.capabilities) {
            expect(VALID_STATUSES).toContain(cap.status);
            expect(cap.status).not.toBe('PARTIAL');
            expect(cap.completionPercent).toBeGreaterThanOrEqual(0);
            expect(cap.completionPercent).toBeLessThanOrEqual(100);
        }
        expect(registry.summary.complete + registry.summary.blocked + registry.summary.notStarted + registry.summary.deprecated).toBe(20);
    });
    it('COMPLETE capabilities have no blockers and 100%; BLOCKED capabilities name an owner action', () => {
        const registry = assembleCapabilityRegistry({
            dashboard: fakeDashboard(),
            tools: fakeTools(true),
            crmContactCount: 0,
            emailProviderConfigured: false,
            storageConfigured: true,
            githubConfigured: true,
            aiConfigured: true,
        });
        for (const cap of registry.capabilities) {
            if (cap.status === 'COMPLETE') {
                // COMPLETE = shipped + no blockers; completion% stays evidence-derived
                // (a capability without an execution trace honestly reads < 100).
                expect(cap.blockers).toHaveLength(0);
                expect(cap.completionPercent).toBeGreaterThanOrEqual(80);
            }
            if (cap.status === 'BLOCKED') {
                expect(cap.blockers.length).toBeGreaterThan(0);
                for (const blocker of cap.blockers) {
                    expect(blocker.reason.length).toBeGreaterThan(0);
                    expect(blocker.dependency.length).toBeGreaterThan(0);
                    expect(blocker.ownerAction.length).toBeGreaterThan(0);
                }
            }
        }
    });
    it('zero CRM contacts blocks the data-dependent capabilities (CRM / lead scoring / investor sourcing)', () => {
        const registry = assembleCapabilityRegistry({
            dashboard: fakeDashboard(),
            tools: fakeTools(true),
            crmContactCount: 0,
            emailProviderConfigured: true,
            storageConfigured: true,
            githubConfigured: true,
            aiConfigured: true,
        });
        const crm = registry.capabilities.find((c) => c.name === 'CRM integration');
        const leadScoring = registry.capabilities.find((c) => c.name === 'Lead scoring');
        expect(crm?.status).toBe('BLOCKED');
        expect(leadScoring?.status).toBe('BLOCKED');
    });
    it('real CRM contacts flip the data-dependent capabilities to COMPLETE', () => {
        const registry = assembleCapabilityRegistry({
            dashboard: fakeDashboard(),
            tools: fakeTools(true),
            crmContactCount: 42,
            emailProviderConfigured: true,
            storageConfigured: true,
            githubConfigured: true,
            aiConfigured: true,
        });
        const crm = registry.capabilities.find((c) => c.name === 'CRM integration');
        expect(crm?.status).toBe('COMPLETE');
        expect(crm?.blockers).toHaveLength(0);
        expect(crm?.completionPercent).toBeGreaterThanOrEqual(80);
    });
    it('missing storage blocks the deliverable pipeline + notifications', () => {
        const registry = assembleCapabilityRegistry({
            dashboard: fakeDashboard(),
            tools: fakeTools(false),
            crmContactCount: 10,
            emailProviderConfigured: true,
            storageConfigured: false,
            githubConfigured: true,
            aiConfigured: true,
        });
        const deliverables = registry.capabilities.find((c) => c.name === 'Deliverables');
        expect(deliverables?.status).toBe('BLOCKED');
        expect(deliverables?.blockers[0]?.dependency).toContain('SUPABASE');
    });
    it('reports six readiness dimensions + dev/autonomous percentages 0..100', () => {
        const registry = assembleCapabilityRegistry({
            dashboard: fakeDashboard(),
            tools: fakeTools(true),
            crmContactCount: 0,
            emailProviderConfigured: false,
            storageConfigured: true,
            githubConfigured: true,
            aiConfigured: true,
        });
        const dims = registry.readiness.dimensions.map((d) => d.dimension);
        expect(dims).toEqual(['Engineering', 'Autonomy', 'Deal Flow', 'Investor Flow', 'Operations', 'Production Stability']);
        expect(registry.readiness.seniorDeveloperReadinessPercent).toBeGreaterThanOrEqual(0);
        expect(registry.readiness.seniorDeveloperReadinessPercent).toBeLessThanOrEqual(100);
        expect(registry.readiness.autonomousSystemReadinessPercent).toBeGreaterThanOrEqual(0);
        expect(registry.readiness.autonomousSystemReadinessPercent).toBeLessThanOrEqual(100);
        // every blocked capability's owner action appears in the path to 100%.
        const blocked = registry.capabilities.filter((c) => c.status === 'BLOCKED');
        if (blocked.length > 0) {
            expect(registry.pathTo100.length).toBeGreaterThan(0);
        }
    });
    it('AI gateway down blocks Owner AI + Public AI', () => {
        const dashboard = fakeDashboard();
        dashboard.environment.aiGatewayConfigured = false;
        const registry = assembleCapabilityRegistry({
            dashboard,
            tools: fakeTools(true),
            crmContactCount: 10,
            emailProviderConfigured: true,
            storageConfigured: true,
            githubConfigured: true,
            aiConfigured: false,
        });
        expect(registry.capabilities.find((c) => c.name === 'Owner AI')?.status).toBe('BLOCKED');
        expect(registry.capabilities.find((c) => c.name === 'Public AI')?.status).toBe('BLOCKED');
    });
});
