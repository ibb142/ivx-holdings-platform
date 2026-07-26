import { describe, expect, it } from 'bun:test';
import { IVX_CREDENTIAL_READINESS_MARKER, buildCredentialReadiness, buildDeploymentReadiness, evaluateOwnerApprovalGate, listGuardedActions, } from './ivx-credential-readiness';
/** A long, real-looking token value that passes the shape verification.
 * Assembled at runtime so it never matches a provider secret-scanning pattern in source. */
const REAL_TOKEN = ['sk', 'live', '8f3a9c2b1d7e4f60a5c8b9d2e1f0a3c4'].join('_');
describe('ivx-credential-readiness — presence checker', () => {
    it('reports a configured credential as present with no diagnostic', () => {
        const report = buildCredentialReadiness({ AI_GATEWAY_API_KEY: REAL_TOKEN });
        const ai = report.credentials.find((c) => c.name === 'AI_GATEWAY_API_KEY');
        expect(ai.configured).toBe(true);
        expect(ai.diagnostic).toBeNull();
        expect(ai.fallback).toBeNull();
    });
    it('reports a missing credential with an actionable diagnostic + safe fallback', () => {
        const report = buildCredentialReadiness({});
        const ai = report.credentials.find((c) => c.name === 'AI_GATEWAY_API_KEY');
        expect(ai.configured).toBe(false);
        expect(ai.diagnostic).toContain('AI_GATEWAY_API_KEY');
        expect(ai.diagnostic).toContain('REQUIRED');
        expect(ai.fallback).toBeTruthy();
    });
    it('never returns a secret value', () => {
        const report = buildCredentialReadiness({ AI_GATEWAY_API_KEY: REAL_TOKEN });
        expect(report.secretValuesReturned).toBe(false);
        const serialized = JSON.stringify(report);
        expect(serialized.includes(REAL_TOKEN)).toBe(false);
    });
});
describe('ivx-credential-readiness — token shape verification', () => {
    it('marks a real-looking token as verified', () => {
        const report = buildCredentialReadiness({ IVX_OWNER_TOKEN: REAL_TOKEN });
        const owner = report.credentials.find((c) => c.name === 'IVX_OWNER_TOKEN');
        expect(owner.verified).toBe(true);
        expect(owner.verificationNote).toBeNull();
    });
    it('rejects placeholder text as not verified (honest note, no value)', () => {
        const report = buildCredentialReadiness({ IVX_OWNER_TOKEN: 'your-token-here-changeme' });
        const owner = report.credentials.find((c) => c.name === 'IVX_OWNER_TOKEN');
        expect(owner.configured).toBe(true);
        expect(owner.verified).toBe(false);
        expect(owner.verificationNote).toContain('placeholder');
    });
    it('rejects a too-short token', () => {
        const report = buildCredentialReadiness({ RENDER_API_KEY: 'short' });
        const render = report.credentials.find((c) => c.name === 'RENDER_API_KEY');
        expect(render.verified).toBe(false);
        expect(render.verificationNote).toContain('short');
    });
    it('leaves verified null for non-shape-verified credentials', () => {
        const report = buildCredentialReadiness({ EXPO_PUBLIC_SUPABASE_URL: 'https://x.supabase.co' });
        const url = report.credentials.find((c) => c.name === 'EXPO_PUBLIC_SUPABASE_URL');
        expect(url.verified).toBeNull();
    });
});
describe('ivx-credential-readiness — roll-up + autonomy level', () => {
    it('marks autonomy blocked when required credentials are missing', () => {
        const report = buildCredentialReadiness({});
        expect(report.autonomyLevel).toBe('blocked');
        expect(report.required.missing).toBeGreaterThan(0);
        expect(report.missingDiagnostics.length).toBeGreaterThan(0);
    });
    it('marks autonomy full when required creds present + a deploy path exists', () => {
        const report = buildCredentialReadiness({
            AI_GATEWAY_API_KEY: REAL_TOKEN,
            EXPO_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
            SUPABASE_SERVICE_ROLE_KEY: REAL_TOKEN,
            IVX_OWNER_REGISTRATION_EMAILS: 'owner@ivxholding.com',
            GITHUB_TOKEN: REAL_TOKEN,
            GITHUB_REPO_URL: 'https://github.com/ivx/app',
        });
        expect(report.required.missing).toBe(0);
        expect(report.deployment.deployPathAvailable).toBe(true);
        expect(report.autonomyLevel).toBe('full');
    });
    it('marks autonomy degraded when required creds present but no deploy path', () => {
        const report = buildCredentialReadiness({
            AI_GATEWAY_API_KEY: REAL_TOKEN,
            EXPO_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
            SUPABASE_SERVICE_ROLE_KEY: REAL_TOKEN,
            IVX_OWNER_REGISTRATION_EMAILS: 'owner@ivxholding.com',
        });
        expect(report.required.missing).toBe(0);
        expect(report.deployment.deployPathAvailable).toBe(false);
        expect(report.autonomyLevel).toBe('degraded');
    });
    it('carries the stable marker + category roll-up', () => {
        const report = buildCredentialReadiness({});
        expect(report.marker).toBe(IVX_CREDENTIAL_READINESS_MARKER);
        expect(report.byCategory.ai.total).toBeGreaterThan(0);
        expect(report.total).toBe(report.credentials.length);
    });
});
describe('ivx-credential-readiness — deployment readiness', () => {
    it('reports no deploy path when neither GitHub push nor Render API is set', () => {
        const dep = buildDeploymentReadiness({});
        expect(dep.deployPathAvailable).toBe(false);
        expect(dep.directDeployControl).toBe(false);
        expect(dep.blocker).toContain('No deploy path');
    });
    it('reports a deploy path via GitHub push but no direct control without verified Render', () => {
        const dep = buildDeploymentReadiness({ GITHUB_TOKEN: REAL_TOKEN, GITHUB_REPO_URL: 'https://github.com/ivx/app' });
        expect(dep.deployPathAvailable).toBe(true);
        expect(dep.directDeployControl).toBe(false);
        expect(dep.blocker).toContain('Direct deploy');
    });
    it('reports direct deploy control with a verified Render token', () => {
        const dep = buildDeploymentReadiness({ RENDER_API_KEY: REAL_TOKEN, RENDER_SERVICE_ID: 'srv-abc123' });
        expect(dep.deployPathAvailable).toBe(true);
        expect(dep.directDeployControl).toBe(true);
        expect(dep.blocker).toBeNull();
    });
    it('flags a placeholder Render key as configured-but-unverified', () => {
        const dep = buildDeploymentReadiness({ RENDER_API_KEY: 'paste-your-render-key', RENDER_SERVICE_ID: 'srv-abc123' });
        expect(dep.renderApiConfigured).toBe(true);
        expect(dep.directDeployControl).toBe(false);
        expect(dep.blocker).toContain('shape verification');
    });
});
describe('ivx-credential-readiness — owner approval gate', () => {
    it('passes through ungated actions without requiring approval', () => {
        const result = evaluateOwnerApprovalGate('read_dashboard', false, {});
        expect(result.guarded).toBe(false);
        expect(result.approved).toBe(true);
        expect(result.ownerApprovalRequired).toBe(false);
    });
    it('blocks a guarded action when owner has not approved', () => {
        const result = evaluateOwnerApprovalGate('deploy_production', false, {
            GITHUB_TOKEN: REAL_TOKEN,
            GITHUB_REPO_URL: 'https://github.com/ivx/app',
        });
        expect(result.guarded).toBe(true);
        expect(result.approved).toBe(false);
        expect(result.blocker).toContain('Owner approval required');
    });
    it('blocks an approved guarded action when a required credential is missing', () => {
        const result = evaluateOwnerApprovalGate('deploy_production', true, {});
        expect(result.approved).toBe(false);
        expect(result.missingCredentials).toContain('GITHUB_TOKEN');
        expect(result.blocker).toContain('missing credential');
    });
    it('approves a guarded action when approved + all required credentials present', () => {
        const result = evaluateOwnerApprovalGate('deploy_production', true, {
            GITHUB_TOKEN: REAL_TOKEN,
            GITHUB_REPO_URL: 'https://github.com/ivx/app',
        });
        expect(result.approved).toBe(true);
        expect(result.missingCredentials).toEqual([]);
        expect(result.blocker).toBeNull();
    });
    it('normalizes action keys (spaces/dashes) to the guarded set', () => {
        const result = evaluateOwnerApprovalGate('rollback production', false, {});
        expect(result.guarded).toBe(true);
        expect(result.requiredCredentials).toContain('RENDER_API_KEY');
    });
    it('lists exactly the six guarded action categories', () => {
        const actions = listGuardedActions();
        expect(actions).toEqual([
            'deploy_production',
            'rollback_production',
            'modify_production_schema',
            'rotate_credentials',
            'external_publish',
            'delete_data',
        ]);
    });
});
