import { describe, expect, it } from 'bun:test';
import { mergeCheckedPullRequest } from './ivx-checked-pr-merge';

const input = { repository: 'owner/repo', token: 'test-only', prNumber: 1, checkedHeadSha: 'a'.repeat(40), title: 'Repair' };
describe('checked PR merge', () => {
  it('binds the merge to the tested commit even if the PR head changes', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const result = await mergeCheckedPullRequest(input, (async (url, init) => {
      calls.push({ url: String(url), init: init! });
      if (init?.method === 'GET') return Response.json({ state: 'open', merged: false, head: { sha: input.checkedHeadSha } });
      return Response.json({ merged: true, sha: 'b'.repeat(40) });
    }) as typeof fetch);
    expect(result.mergeCommitSha).toBe('b'.repeat(40));
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toEndWith('/pulls/1');
    expect(JSON.parse(calls[1].init.body as string).sha).toBe(input.checkedHeadSha);
    expect(calls[1].url).toEndWith('/pulls/1/merge');
  });
  for (const pr of [
    { state: 'closed', merged: false, head: { sha: input.checkedHeadSha } },
    { state: 'unknown', merged: false, head: { sha: input.checkedHeadSha } },
    { state: 'open', merged: false, head: { sha: 'c'.repeat(40) } },
    { state: 'open', merged: false, draft: true, head: { sha: input.checkedHeadSha } },
  ]) {
    it(`refuses a final PR state that is no longer mergeable: ${JSON.stringify(pr)}`, async () => {
      const methods: string[] = [];
      await expect(mergeCheckedPullRequest(input, (async (_url, init) => {
        methods.push(init?.method ?? 'GET');
        return init?.method === 'GET' ? Response.json(pr) : Response.json({ merged: true, sha: 'b'.repeat(40) });
      }) as typeof fetch)).rejects.toThrow('PR must remain open');
      expect(methods).toEqual(['GET']);
    });
  }
  it('fails closed when the final PR state cannot be read', async () => {
    const methods: string[] = [];
    await expect(mergeCheckedPullRequest(input, (async (_url, init) => {
      methods.push(init?.method ?? 'GET');
      return new Response('Unavailable', { status: 503 });
    }) as typeof fetch)).rejects.toThrow('PR state verification failed');
    expect(methods).toEqual(['GET']);
  });
  for (const status of [403, 405, 409, 500]) {
    it(`preserves protections and does not replay HTTP ${status}`, async () => {
      const calls: string[] = [];
      await expect(mergeCheckedPullRequest(input, (async (url, init) => {
        calls.push(String(url));
        if (init?.method === 'GET') return Response.json({ state: 'open', merged: false, head: { sha: input.checkedHeadSha } });
        return new Response('Required review or status check', { status });
      }) as typeof fetch)).rejects.toThrow(`HTTP ${status}`);
      expect(calls).toEqual(['https://api.github.com/repos/owner/repo/pulls/1', 'https://api.github.com/repos/owner/repo/pulls/1/merge']);
    });
  }
  it('does not replay a lost response or accept an unconfirmed merge', async () => {
    let calls = 0;
    await expect(mergeCheckedPullRequest(input, (async () => { calls++; throw new Error('lost response'); }) as typeof fetch)).rejects.toThrow('lost response');
    expect(calls).toBe(1);
    await expect(mergeCheckedPullRequest(input, (async (_url, init) => init?.method === 'GET'
      ? Response.json({ state: 'open', merged: false, head: { sha: input.checkedHeadSha } })
      : Response.json({ merged: false, sha: null })) as typeof fetch)).rejects.toThrow('did not confirm');
  });
});
