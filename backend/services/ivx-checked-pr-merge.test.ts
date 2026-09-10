import { describe, expect, it } from 'bun:test';
import { mergeCheckedPullRequest } from './ivx-checked-pr-merge';

const input = { repository: 'owner/repo', token: 'test-only', prNumber: 1, checkedHeadSha: 'a'.repeat(40), title: 'Repair' };
describe('checked PR merge', () => {
  it('binds the merge to the tested commit even if the PR head changes', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const result = await mergeCheckedPullRequest(input, (async (url, init) => {
      calls.push({ url: String(url), init: init! });
      return Response.json({ merged: true, sha: 'b'.repeat(40) });
    }) as typeof fetch);
    expect(result.mergeCommitSha).toBe('b'.repeat(40));
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].init.body as string).sha).toBe(input.checkedHeadSha);
    expect(calls[0].url).toEndWith('/pulls/1/merge');
  });
  for (const status of [403, 405, 409, 500]) {
    it(`preserves protections and does not replay HTTP ${status}`, async () => {
      const calls: string[] = [];
      await expect(mergeCheckedPullRequest(input, (async (url) => {
        calls.push(String(url));
        return new Response('Required review or status check', { status });
      }) as typeof fetch)).rejects.toThrow(`HTTP ${status}`);
      expect(calls).toEqual(['https://api.github.com/repos/owner/repo/pulls/1/merge']);
    });
  }
  it('does not replay a lost response or accept an unconfirmed merge', async () => {
    let calls = 0;
    await expect(mergeCheckedPullRequest(input, (async () => { calls++; throw new Error('lost response'); }) as typeof fetch)).rejects.toThrow('lost response');
    expect(calls).toBe(1);
    await expect(mergeCheckedPullRequest(input, (async () => Response.json({ merged: false, sha: null })) as typeof fetch)).rejects.toThrow('did not confirm');
  });
});
