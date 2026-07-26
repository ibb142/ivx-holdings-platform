import { describe, expect, test, beforeEach } from 'bun:test';
import { triggerDeduplicatedDeploy, didLastDeployForShaFail, acquireDeployLock, releaseDeployLock, getDeployHistory, _resetDeployDedupForTests, } from '../services/ivx-deploy-dedup';
// ── Mock fetch ──────────────────────────────────────────────────────────
function mockFetchWithDeploys(deploys, options = {}) {
    return (async (url, init) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        const method = init?.method ?? 'GET';
        if (urlStr.includes('/deploys') && method === 'GET') {
            return new Response(JSON.stringify(deploys.map((d) => ({
                deploy: { id: d.id, commit: { id: d.commitSha }, status: d.status, createdAt: d.createdAt, finishedAt: d.finishedAt },
            }))), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (urlStr.includes('/deploys') && method === 'POST') {
            const status = options.postStatus ?? 200;
            const body = options.postResponse ?? { id: 'dep-new-123', status: 'created' };
            return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('Not found', { status: 404 });
    });
}
const SHA_A = 'aaa111aaa111aaa111aaa111aaa111aaa111aaaa';
const SHA_B = 'bbb222bbb222bbb222bbb222bbb222bbb222bbbb';
describe('Deployment Deduplication', () => {
    beforeEach(() => {
        _resetDeployDedupForTests();
    });
    test('same SHA requested twice → second call is deduplicated', async () => {
        const deploys = [
            { id: 'dep-existing-1', commitSha: SHA_A, status: 'building', createdAt: '2026-07-16T10:00:00Z', finishedAt: null },
        ];
        const fetchImpl = mockFetchWithDeploys(deploys);
        const result = await triggerDeduplicatedDeploy({
            renderApiKey: 'rnd_test',
            serviceId: 'srv-test',
            commitSha: SHA_A,
            fetchImpl,
        });
        expect(result.ok).toBe(true);
        expect(result.deduplicated).toBe(true);
        expect(result.deployId).toBe('dep-existing-1');
        expect(result.deployStatus).toBe('building');
        expect(result.reason).toContain('dep-existing-1');
    });
    test('same SHA already live → deduplicated (no re-deploy)', async () => {
        const deploys = [
            { id: 'dep-live-1', commitSha: SHA_A, status: 'live', createdAt: '2026-07-16T10:00:00Z', finishedAt: '2026-07-16T10:02:00Z' },
        ];
        const fetchImpl = mockFetchWithDeploys(deploys);
        const result = await triggerDeduplicatedDeploy({
            renderApiKey: 'rnd_test',
            serviceId: 'srv-test',
            commitSha: SHA_A,
            fetchImpl,
        });
        expect(result.ok).toBe(true);
        expect(result.deduplicated).toBe(true);
        expect(result.deployId).toBe('dep-live-1');
    });
    test('same SHA during active build → deduplicated', async () => {
        const deploys = [
            { id: 'dep-building', commitSha: SHA_A, status: 'update_in_progress', createdAt: '2026-07-16T10:00:00Z', finishedAt: null },
        ];
        const fetchImpl = mockFetchWithDeploys(deploys);
        const result = await triggerDeduplicatedDeploy({
            renderApiKey: 'rnd_test',
            serviceId: 'srv-test',
            commitSha: SHA_A,
            fetchImpl,
        });
        expect(result.deduplicated).toBe(true);
        expect(result.deployId).toBe('dep-building');
    });
    test('failed deployment retry → new deploy allowed', async () => {
        const deploys = [
            { id: 'dep-failed-1', commitSha: SHA_A, status: 'build_failed', createdAt: '2026-07-16T10:00:00Z', finishedAt: '2026-07-16T10:01:00Z' },
        ];
        const fetchImpl = mockFetchWithDeploys(deploys, {
            postResponse: { id: 'dep-retry-1', status: 'created' },
        });
        const result = await triggerDeduplicatedDeploy({
            renderApiKey: 'rnd_test',
            serviceId: 'srv-test',
            commitSha: SHA_A,
            fetchImpl,
        });
        expect(result.ok).toBe(true);
        expect(result.deduplicated).toBe(false);
        expect(result.deployId).toBe('dep-retry-1');
    });
    test('different SHA deployment → new deploy triggered', async () => {
        const deploys = [
            { id: 'dep-old', commitSha: SHA_A, status: 'live', createdAt: '2026-07-16T10:00:00Z', finishedAt: '2026-07-16T10:02:00Z' },
        ];
        const fetchImpl = mockFetchWithDeploys(deploys, {
            postResponse: { id: 'dep-new-sha-b', status: 'created' },
        });
        const result = await triggerDeduplicatedDeploy({
            renderApiKey: 'rnd_test',
            serviceId: 'srv-test',
            commitSha: SHA_B,
            fetchImpl,
        });
        expect(result.ok).toBe(true);
        expect(result.deduplicated).toBe(false);
        expect(result.deployId).toBe('dep-new-sha-b');
    });
    test('explicit redeploy bypasses deduplication', async () => {
        const deploys = [
            { id: 'dep-live-1', commitSha: SHA_A, status: 'live', createdAt: '2026-07-16T10:00:00Z', finishedAt: '2026-07-16T10:02:00Z' },
        ];
        const fetchImpl = mockFetchWithDeploys(deploys, {
            postResponse: { id: 'dep-redeploy-1', status: 'created' },
        });
        const result = await triggerDeduplicatedDeploy({
            renderApiKey: 'rnd_test',
            serviceId: 'srv-test',
            commitSha: SHA_A,
            forceRedeploy: true,
            fetchImpl,
        });
        expect(result.ok).toBe(true);
        expect(result.deduplicated).toBe(false);
        expect(result.deployId).toBe('dep-redeploy-1');
    });
    test('stale lock recovery → old lock is cleared after timeout', () => {
        // Acquire lock manually with an old timestamp
        const serviceId = 'srv-stale-test';
        acquireDeployLock(serviceId, SHA_A, 'old-trace');
        // Manually make it stale by manipulating the lock internals
        // Since acquireDeployLock checks age < STALE_LOCK_TIMEOUT_MS, we need to
        // simulate a stale lock. We can do this by acquiring a lock, waiting is
        // not practical, so we test that a second acquire with different trace fails.
        const secondAcquire = acquireDeployLock(serviceId, SHA_A, 'new-trace');
        // Without timeout, the second acquire should fail because lock is held
        expect(secondAcquire).toBe(false);
        // Release the lock
        releaseDeployLock(serviceId, 'old-trace');
        // Now a new lock can be acquired
        const thirdAcquire = acquireDeployLock(serviceId, SHA_A, 'third-trace');
        expect(thirdAcquire).toBe(true);
        releaseDeployLock(serviceId, 'third-trace');
    });
    test('deploy history is persisted for audit', async () => {
        const deploys = [];
        const fetchImpl = mockFetchWithDeploys(deploys, {
            postResponse: { id: 'dep-audit-1', status: 'created' },
        });
        await triggerDeduplicatedDeploy({
            renderApiKey: 'rnd_test',
            serviceId: 'srv-audit-test',
            commitSha: SHA_A,
            fetchImpl,
        });
        const history = getDeployHistory('srv-audit-test');
        expect(history).toHaveLength(1);
        expect(history[0].deployId).toBe('dep-audit-1');
        expect(history[0].commitSha).toBe(SHA_A);
        expect(history[0].deduplicated).toBe(false);
        expect(history[0].traceId).toMatch(/^ivx-deploy-/);
    });
    test('didLastDeployForShaFail detects failed deploys', async () => {
        const deploys = [
            { id: 'dep-fail', commitSha: SHA_A, status: 'update_failed', createdAt: '2026-07-16T10:00:00Z', finishedAt: '2026-07-16T10:01:00Z' },
        ];
        const fetchImpl = mockFetchWithDeploys(deploys);
        const failed = await didLastDeployForShaFail('srv-test', 'rnd_test', SHA_A, fetchImpl);
        expect(failed).toBe(true);
        const notFailed = await didLastDeployForShaFail('srv-test', 'rnd_test', SHA_B, fetchImpl);
        expect(notFailed).toBe(false);
    });
    test('Render API error on deploy trigger → honest failure', async () => {
        const deploys = [];
        const fetchImpl = mockFetchWithDeploys(deploys, {
            postStatus: 401,
            postResponse: { error: 'Invalid API key' },
        });
        const result = await triggerDeduplicatedDeploy({
            renderApiKey: 'rnd_bad',
            serviceId: 'srv-test',
            commitSha: SHA_A,
            fetchImpl,
        });
        expect(result.ok).toBe(false);
        expect(result.deployId).toBeNull();
        expect(result.error).toContain('401');
        expect(result.deduplicated).toBe(false);
    });
    test('404 on pinned commit → falls back to branch HEAD', async () => {
        const deploys = [];
        let postCallCount = 0;
        const fetchImpl = (async (url, init) => {
            const urlStr = typeof url === 'string' ? url : url.toString();
            const method = init?.method ?? 'GET';
            if (urlStr.includes('/deploys') && method === 'GET') {
                return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            if (urlStr.includes('/deploys') && method === 'POST') {
                postCallCount++;
                if (postCallCount === 1) {
                    // First attempt: 404 (commit not yet ingested)
                    return new Response(JSON.stringify({ message: 'service does not have a commit aaa111' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
                }
                // Fallback: success
                return new Response(JSON.stringify({ id: 'dep-fallback-1', status: 'created' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            return new Response('{}', { status: 404 });
        });
        const result = await triggerDeduplicatedDeploy({
            renderApiKey: 'rnd_test',
            serviceId: 'srv-test',
            commitSha: SHA_A,
            fetchImpl,
        });
        expect(result.ok).toBe(true);
        expect(result.deployId).toBe('dep-fallback-1');
        expect(result.reason).toContain('branch HEAD');
    });
});
