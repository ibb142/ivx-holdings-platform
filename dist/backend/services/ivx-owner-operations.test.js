import { describe, expect, it } from 'bun:test';
import { buildOwnerConnectionVault, buildOwnerActionCatalog, buildRorkRemovalPreflight, buildOperationEvidenceReport, testOwnerConnection, IVX_OWNER_OPERATIONS_MARKER, } from './ivx-owner-operations';
const FULL_ENV = {
    GITHUB_TOKEN: 'gh_xxx',
    GITHUB_REPO_URL: 'https://github.com/x/y.git',
    RENDER_API_KEY: 'rnd_xxx',
    RENDER_SERVICE_ID: 'srv-1',
    SUPABASE_SERVICE_ROLE_KEY: 'svc',
    EXPO_PUBLIC_SUPABASE_URL: 'https://ref.supabase.co',
    AWS_ACCESS_KEY_ID: 'AKIA',
    AWS_SECRET_ACCESS_KEY: 'secret',
    AWS_REGION: 'us-east-1',
    PRODUCTION_BASE_URL: 'https://api.ivxholding.com',
    AI_GATEWAY_API_KEY: 'key',
    MESHY_API_KEY: 'meshy',
};
// ---------------------------------------------------------------------------
// Credential vault
// ---------------------------------------------------------------------------
describe('buildOwnerConnectionVault', () => {
    it('returns all eight connection cards with the marker', () => {
        const vault = buildOwnerConnectionVault({});
        expect(vault.marker).toBe(IVX_OWNER_OPERATIONS_MARKER);
        expect(vault.connections).toHaveLength(8);
        const ids = vault.connections.map((c) => c.id).sort();
        expect(ids).toEqual(['ai_gateway', 'aws', 'crm_import', 'domain', 'github', 'model_3d', 'render', 'supabase']);
    });
    it('never returns secret values — only presence + env names', () => {
        const vault = buildOwnerConnectionVault(FULL_ENV);
        expect(vault.secretValuesReturned).toBe(false);
        const serialized = JSON.stringify(vault);
        expect(serialized).not.toContain('gh_xxx');
        expect(serialized).not.toContain('rnd_xxx');
        expect(serialized).not.toContain('svc');
        // env NAMES are fine to expose
        const github = vault.connections.find((c) => c.id === 'github');
        expect(github?.requiredSecrets).toContain('GITHUB_TOKEN');
    });
    it('reports missing connections with exact missing secrets on an empty env', () => {
        const vault = buildOwnerConnectionVault({});
        const github = vault.connections.find((c) => c.id === 'github');
        expect(github?.status).toBe('missing');
        expect(github?.missingSecrets).toEqual(['GITHUB_TOKEN', 'GITHUB_REPO_URL']);
        // crm_import is always configured (in-process, no secrets)
        const crm = vault.connections.find((c) => c.id === 'crm_import');
        expect(crm?.status).toBe('configured');
        expect(vault.allConfigured).toBe(false);
        expect(vault.missingConnections).toContain('github');
    });
    it('flips a connection to configured once its secrets are present', () => {
        const vault = buildOwnerConnectionVault(FULL_ENV);
        const github = vault.connections.find((c) => c.id === 'github');
        expect(github?.status).toBe('configured');
        expect(github?.missingSecrets).toEqual([]);
        expect(vault.allConfigured).toBe(true);
        expect(vault.missingConnections).toEqual([]);
    });
    it('treats the 3D provider as satisfied when ANY of its keys is present', () => {
        const withMeshy = buildOwnerConnectionVault({ MESHY_API_KEY: 'm' });
        expect(withMeshy.connections.find((c) => c.id === 'model_3d')?.status).toBe('configured');
        const withTripo = buildOwnerConnectionVault({ TRIPO_API_KEY: 't' });
        expect(withTripo.connections.find((c) => c.id === 'model_3d')?.status).toBe('configured');
        const none = buildOwnerConnectionVault({});
        expect(none.connections.find((c) => c.id === 'model_3d')?.status).toBe('missing');
    });
});
// ---------------------------------------------------------------------------
// Connection test (live probe, injected fetch)
// ---------------------------------------------------------------------------
describe('testOwnerConnection', () => {
    const okFetch = async () => new Response('{}', { status: 200 });
    const authFail = async () => new Response('no', { status: 401 });
    const netFail = async () => {
        throw new Error('ENOTFOUND');
    };
    it('returns missing (no probe) when required secrets are absent', async () => {
        const result = await testOwnerConnection('github', {}, okFetch);
        expect(result.status).toBe('missing');
        expect(result.missingSecrets).toContain('GITHUB_TOKEN');
        expect(result.secretValuesReturned).toBe(false);
    });
    it('returns connected when the probe succeeds', async () => {
        const result = await testOwnerConnection('github', FULL_ENV, okFetch);
        expect(result.status).toBe('connected');
        expect(result.httpStatus).toBe(200);
    });
    it('returns invalid when the probe is rejected by auth', async () => {
        const result = await testOwnerConnection('render', FULL_ENV, authFail);
        expect(result.status).toBe('invalid');
        expect(result.httpStatus).toBe(401);
    });
    it('returns invalid when the host is unreachable', async () => {
        const result = await testOwnerConnection('supabase', FULL_ENV, netFail);
        expect(result.status).toBe('invalid');
        expect(result.httpStatus).toBeNull();
    });
    it('returns configured (no live probe) for non-testable providers when present', async () => {
        const result = await testOwnerConnection('aws', FULL_ENV, okFetch);
        expect(result.status).toBe('configured');
    });
});
// ---------------------------------------------------------------------------
// Action catalog
// ---------------------------------------------------------------------------
describe('buildOwnerActionCatalog', () => {
    it('exposes every owner one-click action with risk + approval + rollback', () => {
        const catalog = buildOwnerActionCatalog();
        const ids = catalog.actions.map((a) => a.id);
        expect(ids).toContain('test_all_systems');
        expect(ids).toContain('fix_crash');
        expect(ids).toContain('deploy_update');
        expect(ids).toContain('rollback_last_deploy');
        expect(ids).toContain('remove_rork');
        expect(ids).toContain('verify_production');
        expect(ids).toContain('import_contacts');
        expect(ids).toContain('generate_proof_report');
        for (const action of catalog.actions) {
            expect(action.whatHappens.length).toBeGreaterThan(0);
            expect(action.rollbackPath.length).toBeGreaterThan(0);
            expect(action.backingRoute.length).toBeGreaterThan(0);
        }
    });
    it('gates high-risk actions behind owner approval and keeps read-only actions safe', () => {
        const catalog = buildOwnerActionCatalog();
        const deploy = catalog.actions.find((a) => a.id === 'deploy_update');
        expect(deploy?.riskLevel).toBe('high');
        expect(deploy?.requiresApproval).toBe(true);
        expect(deploy?.approvalCategory).toBe('production_deploy');
        const test = catalog.actions.find((a) => a.id === 'test_all_systems');
        expect(test?.riskLevel).toBe('safe');
        expect(test?.requiresApproval).toBe(false);
    });
});
// ---------------------------------------------------------------------------
// Rork removal preflight
// ---------------------------------------------------------------------------
describe('buildRorkRemovalPreflight', () => {
    it('is VERIFIED when GitHub + Render are configured', () => {
        const vault = buildOwnerConnectionVault(FULL_ENV);
        const preflight = buildRorkRemovalPreflight(vault);
        expect(preflight.ready).toBe(true);
        expect(preflight.status).toBe('VERIFIED');
        expect(preflight.missingConnections).toEqual([]);
    });
    it('is BLOCKED_MISSING_OWNER_CONNECTION naming the exact missing connection', () => {
        const vault = buildOwnerConnectionVault({ GITHUB_TOKEN: 'g', GITHUB_REPO_URL: 'https://github.com/x/y.git' });
        const preflight = buildRorkRemovalPreflight(vault);
        expect(preflight.ready).toBe(false);
        expect(preflight.status).toBe('BLOCKED_MISSING_OWNER_CONNECTION');
        expect(preflight.missingConnections).toContain('render');
        const render = preflight.requiredConnections.find((c) => c.connection === 'render');
        expect(render?.satisfied).toBe(false);
        expect(render?.missing).toBeTruthy();
    });
});
// ---------------------------------------------------------------------------
// Evidence report
// ---------------------------------------------------------------------------
describe('buildOperationEvidenceReport', () => {
    it('builds a VERIFIED report with operation + trace ids and no blocker', () => {
        const report = buildOperationEvidenceReport({
            action: 'deploy_update',
            status: 'VERIFIED',
            filesChanged: ['backend/hono.ts'],
            commitSha: 'abc1234',
            testsRun: ['typecheck'],
            deployId: 'dep-1',
            healthResult: 'HTTP 200',
            rollbackTarget: 'dep-0',
        });
        expect(report.operationId).toMatch(/^op_/);
        expect(report.traceId).toMatch(/^trace_/);
        expect(report.status).toBe('VERIFIED');
        expect(report.blocker).toBeNull();
        expect(report.secretValuesReturned).toBe(false);
    });
    it('keeps the blocker for non-verified statuses and generates unique operation ids', () => {
        const blocked = buildOperationEvidenceReport({
            action: 'remove_rork',
            status: 'BLOCKED',
            blocker: 'Render not connected.',
        });
        expect(blocked.status).toBe('BLOCKED');
        expect(blocked.blocker).toBe('Render not connected.');
        const a = buildOperationEvidenceReport({ action: 'x', status: 'FAILED' });
        const b = buildOperationEvidenceReport({ action: 'x', status: 'FAILED' });
        expect(a.operationId).not.toBe(b.operationId);
    });
});
