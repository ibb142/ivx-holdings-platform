import { describe, expect, test } from 'bun:test';
import { verifyLiveCommitMatch, } from './services/ivx-senior-developer-runtime';
/**
 * Proves the final deployment-proof loop: poll the Render deploy until it is
 * live, read the live /version (or /health) commit, and compare it against the
 * requested commit. Every external call is injected so the loop runs instantly
 * and deterministically without touching Render or production.
 */
const COMMIT = 'a3574873bffab26db7482bc343b938741df673ec';
function liveAfter(reads) {
    let index = 0;
    return async () => {
        const commit = reads[Math.min(index, reads.length - 1)];
        index += 1;
        return {
            commit,
            httpStatus: commit ? 200 : 503,
            endpoint: 'https://api.ivxholding.com/version',
            error: commit ? null : 'no commit',
        };
    };
}
function deployStates(states) {
    let index = 0;
    return async () => {
        const poll = states[Math.min(index, states.length - 1)];
        index += 1;
        return poll;
    };
}
describe('verifyLiveCommitMatch', () => {
    test('returns match:true once the deploy is live and /version serves the requested commit', async () => {
        const result = await verifyLiveCommitMatch({
            requestedCommit: COMMIT,
            deploymentId: 'dep_123',
            deployPollIntervalMs: 0,
            versionPollIntervalMs: 0,
            sleep: async () => { },
            pollDeploymentStatus: deployStates([
                { status: 'build_in_progress', live: false, finished: false, error: null },
                { status: 'live', live: true, finished: true, error: null },
            ]),
            readLiveVersion: liveAfter([COMMIT]),
        });
        expect(result.requestedCommit).toBe(COMMIT);
        expect(result.liveCommit).toBe(COMMIT);
        expect(result.match).toBe(true);
        expect(result.deploymentId).toBe('dep_123');
        expect(result.deployStatus).toBe('live');
        expect(result.deployReachedTerminalState).toBe(true);
        expect(result.error).toBeNull();
        expect(result.secretValuesReturned).toBe(false);
    });
    test('polls the live version until production catches up to the requested commit', async () => {
        const result = await verifyLiveCommitMatch({
            requestedCommit: COMMIT,
            deploymentId: 'dep_456',
            maxVersionAttempts: 5,
            deployPollIntervalMs: 0,
            versionPollIntervalMs: 0,
            sleep: async () => { },
            pollDeploymentStatus: deployStates([{ status: 'live', live: true, finished: true, error: null }]),
            // First two reads still serve the OLD commit, third serves the new one.
            readLiveVersion: liveAfter(['oldcommit000', 'oldcommit000', COMMIT]),
        });
        expect(result.match).toBe(true);
        expect(result.liveCommit).toBe(COMMIT);
        expect(result.versionAttempts).toBe(3);
    });
    test('returns match:false when production keeps serving a different commit', async () => {
        const result = await verifyLiveCommitMatch({
            requestedCommit: COMMIT,
            deploymentId: 'dep_789',
            maxVersionAttempts: 2,
            deployPollIntervalMs: 0,
            versionPollIntervalMs: 0,
            sleep: async () => { },
            pollDeploymentStatus: deployStates([{ status: 'live', live: true, finished: true, error: null }]),
            readLiveVersion: liveAfter(['differentcommit']),
        });
        expect(result.match).toBe(false);
        expect(result.liveCommit).toBe('differentcommit');
        expect(result.requestedCommit).toBe(COMMIT);
    });
    test('stops deploy polling on a terminal failure and reports the failed status', async () => {
        const result = await verifyLiveCommitMatch({
            requestedCommit: COMMIT,
            deploymentId: 'dep_fail',
            maxVersionAttempts: 1,
            deployPollIntervalMs: 0,
            versionPollIntervalMs: 0,
            sleep: async () => { },
            pollDeploymentStatus: deployStates([
                { status: 'build_failed', live: false, finished: true, error: null },
            ]),
            readLiveVersion: liveAfter(['oldcommit000']),
        });
        expect(result.deployStatus).toBe('build_failed');
        expect(result.deployReachedTerminalState).toBe(true);
        expect(result.deployPollAttempts).toBe(1);
        expect(result.match).toBe(false);
    });
    test('skips deploy polling when no deploymentId is provided but still verifies the live commit', async () => {
        const result = await verifyLiveCommitMatch({
            requestedCommit: COMMIT,
            deploymentId: null,
            deployPollIntervalMs: 0,
            versionPollIntervalMs: 0,
            sleep: async () => { },
            readLiveVersion: liveAfter([COMMIT]),
        });
        expect(result.deployPolled).toBe(false);
        expect(result.deployPollAttempts).toBe(0);
        expect(result.deploymentId).toBeNull();
        expect(result.match).toBe(true);
        expect(result.liveCommit).toBe(COMMIT);
    });
    test('captures the version read error without leaking secrets when the commit cannot be read', async () => {
        const result = await verifyLiveCommitMatch({
            requestedCommit: COMMIT,
            deploymentId: null,
            maxVersionAttempts: 1,
            deployPollIntervalMs: 0,
            versionPollIntervalMs: 0,
            sleep: async () => { },
            readLiveVersion: liveAfter([null]),
        });
        expect(result.match).toBe(false);
        expect(result.liveCommit).toBeNull();
        expect(result.error).toContain('version read');
        expect(result.secretValuesReturned).toBe(false);
    });
});
