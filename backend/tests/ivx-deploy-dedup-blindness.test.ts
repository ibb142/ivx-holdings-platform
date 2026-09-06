import { describe, expect, test, beforeEach } from 'bun:test';
import {
  triggerDeduplicatedDeploy,
  _resetDeployDedupForTests,
  type RenderDeployRecord,
} from '../services/ivx-deploy-dedup';

const SHA = 'abc123abc123abc123abc123abc123abc123abcd';

function mockFetch(deploys: RenderDeployRecord[], getStatus = 200): typeof fetch {
  return (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET') {
      if (getStatus !== 200) return new Response('render unavailable', { status: getStatus });
      return new Response(JSON.stringify(deploys.map((d) => ({ deploy: {
        id: d.id,
        commit: { id: d.commitSha },
        status: d.status,
        createdAt: d.createdAt,
        finishedAt: d.finishedAt,
      }}))), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ id: 'SHOULD-NOT-BE-CREATED', status: 'created' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

describe('IVX deploy dedupe blindness protections', () => {
  beforeEach(() => _resetDeployDedupForTests());

  for (const status of ['queued', 'build_in_progress', 'pre_deploy_in_progress', 'update_in_progress', 'live']) {
    test(`same SHA in Render status ${status} is deduplicated`, async () => {
      const result = await triggerDeduplicatedDeploy({
        renderApiKey: 'rnd_test',
        serviceId: 'srv-test',
        commitSha: SHA,
        fetchImpl: mockFetch([{ id: `dep-${status}`, commitSha: SHA, status, createdAt: new Date().toISOString(), finishedAt: null }]),
      });
      expect(result.ok).toBe(true);
      expect(result.deduplicated).toBe(true);
      expect(result.deployId).toBe(`dep-${status}`);
    });
  }

  test('Render pre-check failure fails closed instead of blind redeploying', async () => {
    const result = await triggerDeduplicatedDeploy({
      renderApiKey: 'rnd_test',
      serviceId: 'srv-test',
      commitSha: SHA,
      fetchImpl: mockFetch([], 503),
    });
    expect(result.ok).toBe(false);
    expect(result.deployId).toBeNull();
    expect(result.error).toContain('blind deploy blocked');
  });
});
