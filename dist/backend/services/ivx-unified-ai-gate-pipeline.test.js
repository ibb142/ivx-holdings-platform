import { describe, expect, it } from 'bun:test';
import { runIVXUnifiedGatePipeline, describeIVXGatePipelineRun, IVX_UNIFIED_GATE_PIPELINE_MARKER, } from './ivx-unified-ai-gate-pipeline';
const PROOF_FULL = {
    taskId: 'ivx-task-abc123',
    filesChanged: ['backend/services/ivx-unified-ai-gate-pipeline.ts'],
    commitSha: '0123456789abcdef0123456789abcdef01234567',
    renderDeployId: 'dep-xyz789',
    liveHttpStatus: 200,
};
describe('runIVXUnifiedGatePipeline — IVX IA Stabilization Sprint', () => {
    describe('marker + shape', () => {
        it('exposes a stable marker for audit', () => {
            expect(IVX_UNIFIED_GATE_PIPELINE_MARKER).toMatch(/^ivx-unified-ai-gate-pipeline-2026-07-04/);
        });
        it('always returns five stages in execution order (Stage 0 feasibility + 4 gates)', () => {
            const result = runIVXUnifiedGatePipeline({
                message: 'What is Casa Rosario?',
                answer: 'A real-estate deal on the IVX platform.',
                ownerSessionPresent: false,
            });
            expect(result.stages).toHaveLength(5);
            expect(result.stages.map((s) => s.gate)).toEqual([
                'pre_execution_feasibility',
                'fake_execution',
                'senior_developer_narrative',
                'access_status_narrative',
                'reliability',
            ]);
        });
    });
    describe('fake execution — developer request without proof', () => {
        it('blocks "deploy now" with no owner session', () => {
            const result = runIVXUnifiedGatePipeline({
                message: 'deploy now',
                answer: 'I deployed the app to production. Deployment is live.',
                ownerSessionPresent: false,
                proof: null,
            });
            expect(result.gated).toBe(true);
            expect(result.state).toBe('BLOCKED');
            expect(result.answer).toContain('STATE: BLOCKED');
            // Stage 0 feasibility gate now produces the owner-session blocker first.
            expect(result.answer).toMatch(/owner session missing|no proof ledger|OWNER_SESSION_MISSING|owner login is required/i);
            // No fake "I deployed" survives.
            expect(result.answer).not.toContain('I deployed the app');
        });
        it('blocks "fix owner login" even with owner session (no proof)', () => {
            const result = runIVXUnifiedGatePipeline({
                message: 'fix owner login',
                answer: 'I fixed the owner login bug. Files changed: src/auth.ts',
                ownerSessionPresent: true,
                proof: null,
            });
            expect(result.gated).toBe(true);
            expect(result.state).toBe('BLOCKED');
            expect(result.answer).not.toContain('I fixed the owner login');
            expect(result.answer).toMatch(/Senior Developer Executor|proof ledger/i);
        });
        it('blocks "remove Rork" without proof', () => {
            const result = runIVXUnifiedGatePipeline({
                message: 'remove Rork',
                answer: 'I removed the Rork code from the repo.',
                ownerSessionPresent: true,
                proof: null,
            });
            expect(result.gated).toBe(true);
            expect(result.answer).not.toContain('I removed the Rork');
        });
        it('blocks "fix Supabase" without proof', () => {
            const result = runIVXUnifiedGatePipeline({
                message: 'fix Supabase',
                answer: 'I fixed the Supabase anon key.',
                ownerSessionPresent: false,
                proof: null,
            });
            expect(result.gated).toBe(true);
            expect(result.state).toBe('BLOCKED');
        });
        it('blocks "audit landing page" fake claim', () => {
            const result = runIVXUnifiedGatePipeline({
                message: 'audit landing page',
                answer: 'I audited the landing page and patched all the bugs.',
                ownerSessionPresent: true,
                proof: null,
            });
            expect(result.gated).toBe(true);
            expect(result.answer).not.toContain('I audited the landing page and patched');
        });
    });
    describe('fake execution — confession/apology/secretary narrative', () => {
        it('blocks "I have been hallucinating"', () => {
            const result = runIVXUnifiedGatePipeline({
                message: 'what is going on',
                answer: 'I have been hallucinating. I apologize for the confusion. How would you like to proceed?',
                ownerSessionPresent: true,
                proof: null,
            });
            expect(result.gated).toBe(true);
            expect(result.state).toBe('BLOCKED');
            // The confession markers are quoted in the INVALID NARRATIVE block so the
            // owner can see exactly what was blocked — but the original narrative
            // never survives as a free-text claim.
            expect(result.answer).toContain('STATE: BLOCKED');
            expect(result.answer).toContain('INVALID NARRATIVE DETECTED');
            expect(result.answer).toMatch(/does not have repository, deploy, or test execution access/);
        });
        it('blocks "I will inspect now" generic promise', () => {
            const result = runIVXUnifiedGatePipeline({
                message: 'inspect the logs',
                answer: "I'll inspect now. One moment.",
                ownerSessionPresent: true,
                proof: null,
            });
            expect(result.gated).toBe(true);
            expect(result.answer).not.toContain("I'll inspect now");
        });
    });
    describe('senior developer narrative gate', () => {
        it('blocks fabricated "Workspace Inspection Results" / "Recent Patches"', () => {
            const result = runIVXUnifiedGatePipeline({
                message: 'show me recent patches',
                answer: 'Workspace Inspection Results\nRecent Patches: src/investorDiscovery.js, src/dealManager.js\nDeploy Authorization Needed.',
                ownerSessionPresent: true,
                proof: null,
            });
            expect(result.gated).toBe(true);
            expect(result.answer).not.toContain('Workspace Inspection Results');
            expect(result.answer).not.toContain('src/investorDiscovery.js');
            expect(result.answer).toContain('BLOCKED');
        });
        it('blocks fabricated "STATUS: DEPLOYED" claim', () => {
            const result = runIVXUnifiedGatePipeline({
                message: 'did you deploy',
                answer: 'STATUS: DEPLOYED\nDeployment is live in production.',
                ownerSessionPresent: true,
                proof: null,
            });
            expect(result.gated).toBe(true);
            expect(result.answer).not.toContain('STATUS: DEPLOYED');
        });
    });
    describe('access-status narrative gate', () => {
        it('blocks fabricated Yes/No access checklist', () => {
            // Use a pure access-status prompt ("what access do you have") that does
            // NOT contain developer-request keywords (audit/deploy/fix/github/render/
            // supabase/code/patch...) so the fake-execution gate does not short-
            // circuit first. This isolates the access-status narrative gate.
            const result = runIVXUnifiedGatePipeline({
                message: 'what access do you have',
                answer: 'Supabase: **Yes**\nGitHub: **No**\nRender: **No**\nVercel: **Yes**',
                ownerSessionPresent: true,
                proof: null,
            });
            expect(result.gated).toBe(true);
            expect(result.answer).toContain('ACCESS-STATUS AUDIT BLOCKED');
            expect(result.answer).not.toContain('GitHub: **No**');
        });
    });
    describe('reliability — single decision engine', () => {
        it('blocks contradiction (Done + Blocked in one reply)', () => {
            const result = runIVXUnifiedGatePipeline({
                // Non-verification, non-developer prompt so the fake-execution gate does
                // not short-circuit and the reliability gate is actually exercised.
                message: 'what is the current status of the pipeline',
                answer: 'The task is done. However, it is blocked awaiting approval.',
                ownerSessionPresent: true,
                proof: null,
            });
            expect(result.gated).toBe(true);
            expect(result.state).toMatch(/BLOCKED|WAITING_OWNER/);
        });
        it('blocks "Verified" without evidence', () => {
            const result = runIVXUnifiedGatePipeline({
                message: 'verify it',
                answer: 'Verified and deployed to production.',
                ownerSessionPresent: true,
                proof: null,
            });
            expect(result.gated).toBe(true);
            expect(result.state).toBe('BLOCKED');
            expect(result.answer).toMatch(/Missing Evidence|COMMIT SHA|Render Deploy ID/i);
        });
        it('passes through a normal conversational answer as READY', () => {
            const result = runIVXUnifiedGatePipeline({
                message: 'What is compound interest?',
                answer: 'Compound interest is interest calculated on the principal plus accumulated interest.',
                ownerSessionPresent: false,
                proof: null,
            });
            expect(result.gated).toBe(false);
            expect(result.state).toBe('READY');
            expect(result.answer).toContain('Compound interest');
        });
    });
    describe('VERIFIED — real developer proof attached', () => {
        it('allows a developer request with full proof to pass as VERIFIED', () => {
            const result = runIVXUnifiedGatePipeline({
                message: 'deploy now',
                answer: 'STATE: VERIFIED\nTask ID: ivx-task-abc123\nFiles changed: backend/services/ivx-unified-ai-gate-pipeline.ts\nCommit SHA: 0123456789abcdef0123456789abcdef01234567\nRender Deploy ID: dep-xyz789\nLive verification: HTTP 200',
                ownerSessionPresent: true,
                proof: PROOF_FULL,
            });
            // The fake-execution gate passes through when real proof is attached.
            // The senior-developer gate no longer rewrites execution commands, so the
            // original VERIFIED answer flows through unchanged. The reliability gate
            // resolves to VERIFIED because all evidence is present.
            expect(result.state).toBe('VERIFIED');
            expect(result.answer).toContain('STATE: VERIFIED');
            expect(result.answer).toContain('Task ID: ivx-task-abc123');
            expect(result.answer).toContain('Commit SHA: 0123456789abcdef0123456789abcdef01234567');
            expect(result.answer).toContain('Render Deploy ID: dep-xyz789');
            expect(result.answer).toContain('Live verification: HTTP 200');
        });
    });
    describe('single personality — both paths identical', () => {
        it('produces the same gated answer for an identical fake claim regardless of path', () => {
            // Simulate the owner AI path (ownerSessionPresent: true) and the public
            // chat path (ownerSessionPresent: false) for a fake execution claim on a
            // non-developer message. The gate pipeline must produce the same
            // intervention for both — single AI brain.
            const ownerResult = runIVXUnifiedGatePipeline({
                message: 'what did you do',
                answer: 'I deployed the app and ran the tests. Deployment is live.',
                ownerSessionPresent: true,
                proof: null,
            });
            const publicResult = runIVXUnifiedGatePipeline({
                message: 'what did you do',
                answer: 'I deployed the app and ran the tests. Deployment is live.',
                ownerSessionPresent: false,
                proof: null,
            });
            expect(ownerResult.gated).toBe(true);
            expect(publicResult.gated).toBe(true);
            // Self-execution inquiry ("what did you do") resolves to UNVERIFIED without
            // proof — both paths must produce the SAME state and strip the fake claim.
            // Single personality = identical state, identical stages.
            expect(ownerResult.state).toBe(publicResult.state);
            expect(['BLOCKED', 'UNVERIFIED']).toContain(ownerResult.state);
            expect(ownerResult.answer).toContain(`STATE: ${ownerResult.state}`);
            expect(publicResult.answer).toContain(`STATE: ${publicResult.state}`);
            expect(ownerResult.answer).not.toContain('I deployed the app');
            expect(publicResult.answer).not.toContain('I deployed the app');
            // The stages run in the same order for both paths.
            expect(ownerResult.stages.map((s) => s.gate)).toEqual(publicResult.stages.map((s) => s.gate));
        });
    });
    describe('describeIVXGatePipelineRun — audit log shape', () => {
        it('returns a secret-safe audit object with the marker, state, and stages', () => {
            const result = runIVXUnifiedGatePipeline({
                message: 'deploy now',
                answer: 'I deployed.',
                ownerSessionPresent: false,
                proof: null,
            });
            const audit = describeIVXGatePipelineRun(result);
            expect(audit.marker).toBe(IVX_UNIFIED_GATE_PIPELINE_MARKER);
            expect(audit.gated).toBe(true);
            expect(audit.state).toBe('BLOCKED');
            expect(Array.isArray(audit.stages)).toBe(true);
            expect(audit.stages).toHaveLength(5);
        });
    });
});
