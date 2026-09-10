import { afterEach, describe, expect, it } from 'bun:test';
import { createAutonomousGithubTokenResolver } from './ivx-autonomous-github-credentials';
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
describe('autonomous GitHub credential preflight', () => {
  it('uses an existing rotated owner credential after definitive environment rejection', async () => {
    const requests: Array<{ url: string; authorization: string }> = [];
    globalThis.fetch = (async (url, init) => {
      const authorization = new Headers(init?.headers).get('authorization') ?? '';
      requests.push({ url: String(url), authorization });
      expect(init?.method ?? 'GET').toBe('GET');
      return new Response(null, { status: authorization === 'Bearer rotated-test-token' ? 200 : 401 });
    }) as typeof fetch;
    const resolve = createAutonomousGithubTokenResolver();
    const read = async (stored: boolean) => stored ? 'rotated-test-token' : 'expired-test-token';
    expect(await resolve('https://github.com/owner/repo.git', read)).toBe('rotated-test-token');
    expect(await resolve('https://github.com/owner/repo.git', read)).toBe('rotated-test-token');
    expect(requests).toHaveLength(2);
    expect(requests.every(row => row.url === 'https://api.github.com/repos/owner/repo')).toBe(true);
  });
  it('fails before coding when all configured credentials are rejected, without exposing tokens', async () => {
    globalThis.fetch = (async () => new Response(null, { status: 401 })) as typeof fetch;
    const resolve = createAutonomousGithubTokenResolver();
    await expect(resolve('https://github.com/owner/repo', async () => 'secret-test-token')).rejects.toThrow('GitHub credential preflight failed (HTTP 401)');
  });
  it('does not probe another credential after a timeout or permission/rate-limit rejection', async () => {
    for (const status of [403, 429, 503]) {
      let reads = 0;
      globalThis.fetch = (async () => new Response(null, { status })) as typeof fetch;
      await expect(createAutonomousGithubTokenResolver()('https://github.com/owner/repo', async () => { reads++; return 'test'; })).rejects.toThrow(`HTTP ${status}`);
      expect(reads).toBe(1);
    }
    let reads = 0;
    globalThis.fetch = (async () => { throw new Error('test timeout'); }) as typeof fetch;
    await expect(createAutonomousGithubTokenResolver()('https://github.com/owner/repo', async () => { reads++; return 'test'; })).rejects.toThrow('timeout');
    expect(reads).toBe(1);
  });
});
