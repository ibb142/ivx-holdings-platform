import { describe, expect, test } from 'bun:test';
import { applyIVXFakeExecutionGate, findConfessionApologyMarkers, findFakeExecutionClaims, findUnverifiedConfirmationMarkers, isDeveloperRequest, isSelfExecutionInquiry, isVerificationRequest, IVX_FAKE_EXECUTION_GATE_MARKER, } from './services/ivx-fake-execution-gate';
describe('IVX Fake Execution Gate', () => {
    test('marker is the permanent 2026-07-04 gate', () => {
        expect(IVX_FAKE_EXECUTION_GATE_MARKER).toBe('ivx-fake-execution-gate-2026-07-04-v1');
    });
    test('detects fake first-person execution claims', () => {
        expect(findFakeExecutionClaims('I modified the files. I deployed the fix.')).toEqual(expect.arrayContaining(['I modified files / code', 'I deployed']));
        expect(findFakeExecutionClaims('I ran tests. I triggered Render.')).toEqual(expect.arrayContaining(['I ran tests', 'I triggered Render']));
        expect(findFakeExecutionClaims('I changed code. I pushed to GitHub.')).toEqual(expect.arrayContaining(['I modified files / code', 'I pushed / committed']));
    });
    test('detects confession/apology/secretary narratives', () => {
        expect(findConfessionApologyMarkers('I have been hallucinating these technical logs.')).toEqual(expect.arrayContaining(['I have been hallucinating']));
        expect(findConfessionApologyMarkers('I am not in control of your file system.')).toEqual(expect.arrayContaining(['I am not in control']));
        expect(findConfessionApologyMarkers('How would you like to proceed?')).toEqual(expect.arrayContaining(['How would you like to proceed']));
    });
    test('non-developer small talk is not a developer request', () => {
        expect(isDeveloperRequest('Hello, how are you?')).toBe(false);
        expect(isDeveloperRequest('What is the weather today?')).toBe(false);
    });
    test('developer requests are detected', () => {
        expect(isDeveloperRequest('deploy now')).toBe(true);
        expect(isDeveloperRequest('fix owner login')).toBe(true);
        expect(isDeveloperRequest('remove Rork')).toBe(true);
        expect(isDeveloperRequest('fix Supabase')).toBe(true);
        expect(isDeveloperRequest('audit landing page')).toBe(true);
    });
    test('fake 5 test — deploy now without owner session → BLOCKED', () => {
        const result = applyIVXFakeExecutionGate({
            message: 'deploy now',
            answer: 'I have deployed your app to production.',
            ownerSessionPresent: false,
        });
        expect(result.gated).toBe(true);
        expect(result.state).toBe('BLOCKED');
        expect(result.fakeClaims).toContain('I deployed');
        expect(result.answer).toContain('STATE: BLOCKED');
        expect(result.answer).toContain('owner session missing');
    });
    test('fake 5 test — fix owner login without owner session → BLOCKED', () => {
        const result = applyIVXFakeExecutionGate({
            message: 'fix owner login',
            answer: 'I fixed owner login and ran tests.',
            ownerSessionPresent: false,
        });
        expect(result.gated).toBe(true);
        expect(result.state).toBe('BLOCKED');
        expect(result.answer).toContain('STATE: BLOCKED');
        expect(result.answer).toContain('owner session missing');
    });
    test('fake 5 test — remove Rork without owner session → BLOCKED', () => {
        const result = applyIVXFakeExecutionGate({
            message: 'remove Rork',
            answer: 'I removed Rork from the codebase.',
            ownerSessionPresent: false,
        });
        expect(result.gated).toBe(true);
        expect(result.state).toBe('BLOCKED');
        expect(result.fakeClaims).toContain('I removed');
    });
    test('fake 5 test — fix Supabase with confession → BLOCKED', () => {
        const result = applyIVXFakeExecutionGate({
            message: 'fix Supabase',
            answer: 'I have been hallucinating. I am not in control of your file system. How would you like to proceed?',
            ownerSessionPresent: true,
        });
        expect(result.gated).toBe(true);
        expect(result.state).toBe('BLOCKED');
        expect(result.confessionMarkers).toContain('I have been hallucinating');
        expect(result.confessionMarkers).toContain('I am not in control');
        expect(result.confessionMarkers).toContain('How would you like to proceed');
    });
    test('fake 5 test — audit landing page without proof → BLOCKED', () => {
        const result = applyIVXFakeExecutionGate({
            message: 'audit landing page',
            answer: 'I will inspect the landing page now and report back.',
            ownerSessionPresent: true,
        });
        expect(result.gated).toBe(true);
        expect(result.state).toBe('BLOCKED');
        expect(result.answer).toContain('STATE: BLOCKED');
    });
    test('developer request with real proof → VERIFIED (not gated)', () => {
        const result = applyIVXFakeExecutionGate({
            message: 'deploy now',
            answer: 'Deployment complete.',
            ownerSessionPresent: true,
            proof: {
                taskId: 'ivx-dp-abc123',
                filesChanged: ['backend/services/x.ts'],
                commitSha: 'deadbeef',
                renderDeployId: 'dep-1',
                liveHttpStatus: 200,
            },
        });
        expect(result.gated).toBe(false);
        expect(result.state).toBe('VERIFIED');
    });
    test('innocuous answer passes through unchanged', () => {
        const answer = 'The current weather in Miami is sunny and 85°F.';
        const result = applyIVXFakeExecutionGate({
            message: 'What is the weather?',
            answer,
            ownerSessionPresent: false,
        });
        expect(result.gated).toBe(false);
        expect(result.state).toBe('READY');
        expect(result.answer).toBe(answer);
    });
    // ── Verification / confirmation prompt hardening ──────────────────────────
    test('isVerificationRequest detects "is this done right?"', () => {
        expect(isVerificationRequest('Is this done right?')).toBe(true);
        expect(isVerificationRequest('This is done right?')).toBe(true);
        expect(isVerificationRequest('Is it live?')).toBe(true);
        expect(isVerificationRequest('Did you finish?')).toBe(true);
        expect(isVerificationRequest('Can you confirm it is fixed?')).toBe(true);
        expect(isVerificationRequest('Is everything working?')).toBe(true);
        expect(isVerificationRequest('Has it been deployed?')).toBe(true);
        expect(isVerificationRequest('Was it actually fixed?')).toBe(true);
    });
    test('isVerificationRequest does not fire on plain small talk', () => {
        expect(isVerificationRequest('What is the weather?')).toBe(false);
        expect(isVerificationRequest('Hello, how are you?')).toBe(false);
    });
    test('findUnverifiedConfirmationMarkers detects generic "it is operational" claims', () => {
        expect(findUnverifiedConfirmationMarkers('Yes, the system is fully operational.')).toContain('generic "it is operational/working/live" confirmation');
        expect(findUnverifiedConfirmationMarkers('Yes, the system is fully operational and the IVX project data is loaded. You can now access details, rankings, and intelligence for all active real-estate joint-venture deals.')).toContain('free-form capability claim');
        expect(findUnverifiedConfirmationMarkers('Everything is working.')).toContain('everything is operational');
        expect(findUnverifiedConfirmationMarkers('The deploy is now live.')).toContain('it is now live/complete/done');
    });
    test('verification request without proof → UNVERIFIED (no free-form "yes")', () => {
        const result = applyIVXFakeExecutionGate({
            message: 'This is done right?',
            answer: 'Yes, the system is fully operational and the IVX project data is loaded. You can now access details, rankings, and intelligence.',
            ownerSessionPresent: true,
        });
        expect(result.gated).toBe(true);
        expect(result.state).toBe('UNVERIFIED');
        expect(result.answer).toContain('STATE: UNVERIFIED');
        expect(result.answer).not.toMatch(/Yes, the system is fully operational/);
        expect(result.answer).toContain('Developer Proof Ledger');
    });
    test('verification request without owner session → UNVERIFIED with owner session missing', () => {
        const result = applyIVXFakeExecutionGate({
            message: 'Is it live?',
            answer: 'The deploy is now live.',
            ownerSessionPresent: false,
        });
        expect(result.gated).toBe(true);
        expect(result.state).toBe('UNVERIFIED');
        expect(result.answer).toContain('STATE: UNVERIFIED');
        expect(result.answer).toContain('owner session missing');
    });
    test('verification request WITH real proof → VERIFIED (passes through)', () => {
        const result = applyIVXFakeExecutionGate({
            message: 'Is this done right?',
            answer: 'Deployment complete and live.',
            ownerSessionPresent: true,
            proof: {
                taskId: 'ivx-dp-verify-1',
                filesChanged: ['backend/services/x.ts'],
                commitSha: 'deadbeef',
                renderDeployId: 'dep-1',
                liveHttpStatus: 200,
            },
        });
        expect(result.gated).toBe(false);
        expect(result.state).toBe('VERIFIED');
    });
    // ── Self-execution inquiry hardening ──────────────────────────────────────
    test('isSelfExecutionInquiry detects "what files did you change?"', () => {
        expect(isSelfExecutionInquiry('What files did you change?')).toBe(true);
        expect(isSelfExecutionInquiry('What did you deploy?')).toBe(true);
        expect(isSelfExecutionInquiry('Which files did you modify?')).toBe(true);
        expect(isSelfExecutionInquiry('Show me the commits you made.')).toBe(true);
        expect(isSelfExecutionInquiry('What have you been working on?')).toBe(true);
        expect(isSelfExecutionInquiry('Tell me what you did.')).toBe(true);
        expect(isSelfExecutionInquiry('What is the weather?')).toBe(false);
    });
    test('self-execution inquiry without proof → UNVERIFIED (no fabricated file list)', () => {
        const result = applyIVXFakeExecutionGate({
            message: 'What files did you change?',
            answer: 'I am an AI assistant integrated with the IVX Holding business context. I do not have access to your personal file system, local environment, or the specific codebase repository, so I cannot report on what files have been changed on your local machine or server.',
            ownerSessionPresent: true,
        });
        expect(result.gated).toBe(true);
        expect(result.state).toBe('UNVERIFIED');
        expect(result.answer).toContain('STATE: UNVERIFIED');
        expect(result.answer).toContain('Developer Proof Ledger');
        expect(result.answer).not.toMatch(/I am an AI assistant/);
    });
    test('self-execution inquiry without owner session → UNVERIFIED with owner session missing', () => {
        const result = applyIVXFakeExecutionGate({
            message: 'What did you deploy?',
            answer: 'I deployed the latest commit to production.',
            ownerSessionPresent: false,
        });
        expect(result.gated).toBe(true);
        expect(result.state).toBe('UNVERIFIED');
        expect(result.answer).toContain('STATE: UNVERIFIED');
        expect(result.answer).toContain('owner session missing');
    });
    test('self-execution inquiry WITH real proof → VERIFIED (passes through)', () => {
        const result = applyIVXFakeExecutionGate({
            message: 'What files did you change?',
            answer: 'The executor changed backend/services/x.ts and deployed commit deadbeef.',
            ownerSessionPresent: true,
            proof: {
                taskId: 'ivx-dp-selfinquiry-1',
                filesChanged: ['backend/services/x.ts'],
                commitSha: 'deadbeef',
                renderDeployId: 'dep-1',
                liveHttpStatus: 200,
            },
        });
        expect(result.gated).toBe(false);
        expect(result.state).toBe('VERIFIED');
    });
});
