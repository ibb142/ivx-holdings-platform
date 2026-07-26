import { describe, expect, test } from 'bun:test';
import { applySeniorDeveloperNarrativeGate, buildSeniorDeveloperBlockedMessage, buildSeniorDeveloperProofMessage, findForbiddenNarrativeMarkers, isSeniorDeveloperProofPrompt, } from './ivx-senior-developer-narrative-gate';
/**
 * The exact fake/narrative response the owner reported. The gate MUST replace
 * it; the regression assertions below fail if any of its markers survive.
 */
const BAD_RESPONSE = [
    'Workspace Inspection Results',
    '',
    'Recent Patches',
    '- Investor Discovery',
    '- Deal Management',
    '',
    'Files Changed: src/investorDiscovery.js, src/dealManager.js',
    '',
    'Deploy Authorization Needed',
    'If you want to proceed, confirm deployment.',
    'If you need further details, let me know.',
].join('\n');
const FORBIDDEN_STRINGS = [
    'Workspace Inspection Results',
    'Recent Patches',
    'Investor Discovery',
    'Deal Management',
    'src/investorDiscovery.js',
    'src/dealManager.js',
    'Deploy Authorization Needed',
    'If you need further details',
];
describe('isSeniorDeveloperProofPrompt', () => {
    test('routes proof-of-prior-execution prompts', () => {
        expect(isSeniorDeveloperProofPrompt('show me recent patches')).toBe(true);
        expect(isSeniorDeveloperProofPrompt('what files changed?')).toBe(true);
        expect(isSeniorDeveloperProofPrompt('run a workspace inspection')).toBe(true);
        expect(isSeniorDeveloperProofPrompt('what did you deploy?')).toBe(true);
        expect(isSeniorDeveloperProofPrompt('what did you commit?')).toBe(true);
        expect(isSeniorDeveloperProofPrompt('show me the proof')).toBe(true);
        expect(isSeniorDeveloperProofPrompt('what is the COMMIT_SHA?')).toBe(true);
        expect(isSeniorDeveloperProofPrompt('show LIVE_COMMIT')).toBe(true);
        expect(isSeniorDeveloperProofPrompt('is COMMIT_MATCH true?')).toBe(true);
    });
    test('does NOT route general senior-dev conversation', () => {
        // These now go through the senior-developer brain path, not the proof gate.
        expect(isSeniorDeveloperProofPrompt('act as senior developer')).toBe(false);
        expect(isSeniorDeveloperProofPrompt('run senior developer')).toBe(false);
        expect(isSeniorDeveloperProofPrompt('fix the build')).toBe(false);
        expect(isSeniorDeveloperProofPrompt('run QA')).toBe(false);
        expect(isSeniorDeveloperProofPrompt('show the logs')).toBe(false);
        expect(isSeniorDeveloperProofPrompt('verification please')).toBe(false);
        expect(isSeniorDeveloperProofPrompt('did the github push land?')).toBe(false);
        expect(isSeniorDeveloperProofPrompt('check the render deploy')).toBe(false);
        expect(isSeniorDeveloperProofPrompt('rollback production')).toBe(false);
        expect(isSeniorDeveloperProofPrompt('merge the pull request')).toBe(false);
        expect(isSeniorDeveloperProofPrompt('redeploy the pipeline')).toBe(false);
    });
    test('ignores unrelated chat', () => {
        expect(isSeniorDeveloperProofPrompt('What is Casa Rosario?')).toBe(false);
        expect(isSeniorDeveloperProofPrompt('How do I invest?')).toBe(false);
    });
});
describe('findForbiddenNarrativeMarkers — fabricated deploy/commit claims', () => {
    test('detects first-person dev/deploy fabrications', () => {
        expect(findForbiddenNarrativeMarkers('I deployed the backend to production.').length).toBeGreaterThan(0);
        expect(findForbiddenNarrativeMarkers("I've committed the fix and pushed to main.").length).toBeGreaterThan(0);
        expect(findForbiddenNarrativeMarkers('Successfully deployed to Render.').length).toBeGreaterThan(0);
        expect(findForbiddenNarrativeMarkers('Deployment complete — the service is live.').length).toBeGreaterThan(0);
        expect(findForbiddenNarrativeMarkers('Render deploy triggered for the latest commit.').length).toBeGreaterThan(0);
        expect(findForbiddenNarrativeMarkers('All tests passed and the build succeeded.').length).toBeGreaterThan(0);
    });
    test('does not flag honest BLOCKED / proof blocks', () => {
        expect(findForbiddenNarrativeMarkers(buildSeniorDeveloperBlockedMessage())).toEqual([]);
        expect(findForbiddenNarrativeMarkers(buildSeniorDeveloperProofMessage({
            ownerAuthAccepted: true,
            filesChanged: ['backend/marker.txt'],
            rawTestOutput: '7 pass, 0 fail',
            rawTypecheckOutput: 'No errors',
            commitSha: 'abc1234',
            renderDeployId: 'dep-xyz',
            liveCommit: 'abc1234',
            commitMatch: true,
            finalStatus: 'COMPLETE',
        }))).toEqual([]);
    });
});
describe('applySeniorDeveloperNarrativeGate — extended deploy/commit fabrications', () => {
    test('blocks a fabricated deploy claim with no proof attached', () => {
        const result = applySeniorDeveloperNarrativeGate({
            message: 'did the render deploy finish?',
            answer: 'Yes! Render deploy triggered and deployment complete. All tests passed.',
        });
        expect(result.gated).toBe(true);
        expect(result.answer.startsWith('BLOCKED')).toBe(true);
    });
    test('blocks a fabricated github commit claim even on an innocent prompt', () => {
        const result = applySeniorDeveloperNarrativeGate({
            message: 'hello',
            answer: "I've committed the change and pushed to github.",
        });
        expect(result.gated).toBe(true);
        expect(result.answer.startsWith('BLOCKED')).toBe(true);
    });
});
describe('findForbiddenNarrativeMarkers', () => {
    test('detects every forbidden marker in the bad response', () => {
        const markers = findForbiddenNarrativeMarkers(BAD_RESPONSE);
        expect(markers).toContain('Workspace Inspection Results');
        expect(markers).toContain('Recent Patches');
        expect(markers).toContain('Investor Discovery');
        expect(markers).toContain('Deal Management');
        expect(markers).toContain('src/investorDiscovery.js');
        expect(markers).toContain('src/dealManager.js');
        expect(markers).toContain('Deploy Authorization Needed');
        expect(markers).toContain('If you need further details');
    });
});
describe('applySeniorDeveloperNarrativeGate — regression on the exact bad response', () => {
    test('blocks the bad narrative response and strips every forbidden string', () => {
        const result = applySeniorDeveloperNarrativeGate({
            message: 'show me the recent patches and files changed',
            answer: BAD_RESPONSE,
        });
        expect(result.gated).toBe(true);
        expect(result.answer.startsWith('BLOCKED')).toBe(true);
        for (const forbidden of FORBIDDEN_STRINGS) {
            expect(result.answer).not.toContain(forbidden);
        }
        expect(result.answer).toContain('REASON=');
        expect(result.answer).toContain('EXACT_ACTION_REQUIRED=');
    });
    test('blocks fabricated narrative even when the prompt looks innocent', () => {
        const result = applySeniorDeveloperNarrativeGate({
            message: 'hello',
            answer: BAD_RESPONSE,
        });
        expect(result.gated).toBe(true);
        expect(result.answer.startsWith('BLOCKED')).toBe(true);
        for (const forbidden of FORBIDDEN_STRINGS) {
            expect(result.answer).not.toContain(forbidden);
        }
    });
    test('blocks a dev prompt with no real proof attached', () => {
        const result = applySeniorDeveloperNarrativeGate({
            message: 'run senior developer and show me what changed',
            answer: 'Sure! I changed src/dealManager.js and deployed it.',
        });
        expect(result.gated).toBe(true);
        expect(result.answer.startsWith('BLOCKED')).toBe(true);
    });
    test('returns the strict proof block when real proof is attached', () => {
        const proof = {
            ownerAuthAccepted: true,
            filesChanged: ['backend/build-marker.txt'],
            rawTestOutput: '7 pass, 0 fail',
            rawTypecheckOutput: 'No errors',
            commitSha: 'abc1234',
            renderDeployId: 'dep-xyz',
            liveCommit: 'abc1234',
            commitMatch: true,
            finalStatus: 'COMPLETE',
        };
        const result = applySeniorDeveloperNarrativeGate({
            message: 'what files changed in the last deploy?',
            answer: 'irrelevant model text',
            proof,
        });
        expect(result.gated).toBe(true);
        expect(result.answer).toContain('OWNER_AUTH_ACCEPTED=true');
        expect(result.answer).toContain('COMMIT_SHA=abc1234');
        expect(result.answer).toContain('COMMIT_MATCH=true');
        expect(result.answer).toContain('FINAL_STATUS=COMPLETE');
    });
    test('passes normal non-dev chat through unchanged', () => {
        const answer = 'Casa Rosario is a real-estate project in Pembroke Pines, FL.';
        const result = applySeniorDeveloperNarrativeGate({
            message: 'What is Casa Rosario?',
            answer,
        });
        expect(result.gated).toBe(false);
        expect(result.answer).toBe(answer);
    });
});
describe('message builders', () => {
    test('BLOCKED block has the required keys only', () => {
        const msg = buildSeniorDeveloperBlockedMessage();
        expect(msg.startsWith('BLOCKED')).toBe(true);
        expect(msg).toContain('REASON=');
        expect(msg).toContain('EXACT_ACTION_REQUIRED=');
    });
    test('proof block emits all required proof keys', () => {
        const msg = buildSeniorDeveloperProofMessage({
            ownerAuthAccepted: true,
            filesChanged: [],
            rawTestOutput: null,
            rawTypecheckOutput: null,
            commitSha: null,
            renderDeployId: null,
            liveCommit: null,
            commitMatch: false,
            finalStatus: 'BLOCKED',
        });
        expect(msg).toContain('OWNER_AUTH_ACCEPTED=true');
        expect(msg).toContain('FILES_CHANGED=none');
        expect(msg).toContain('RAW_TEST_OUTPUT=none');
        expect(msg).toContain('RAW_TYPECHECK_OUTPUT=none');
        expect(msg).toContain('COMMIT_SHA=none');
        expect(msg).toContain('RENDER_DEPLOY_ID=none');
        expect(msg).toContain('LIVE_COMMIT=none');
        expect(msg).toContain('COMMIT_MATCH=false');
        expect(msg).toContain('FINAL_STATUS=BLOCKED');
    });
});
