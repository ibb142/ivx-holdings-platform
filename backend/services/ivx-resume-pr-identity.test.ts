import { test, expect } from 'bun:test';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./ivx-autonomous-coder.ts', import.meta.url), 'utf8');
const body = source.slice(source.indexOf('async function fetchPullRequestState('), source.indexOf('\nexport type IVXAutonomousCoderResumeInput'));
const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(body);
const sha = 'a'.repeat(40);
const expected = { commitSha: sha, branch: 'same-job-branch' };
const correct = { number: 7, state: 'closed', merged: true, merge_commit_sha: 'b'.repeat(40),
  head: { sha, ref: expected.branch, repo: { full_name: 'owner/app' } },
  base: { ref: 'main', repo: { full_name: 'owner/app' } } };
function read(data: unknown) {
  return new Function('readOwnerRuntimeVariable', 'parseGithubRepoUrl', 'fetch', 'GITHUB_API_BASE_URL', code + '\nreturn fetchPullRequestState;')(
    async () => 'fixture-only', () => ({ owner: 'owner', repo: 'app' }), async () => Response.json(data), 'https://api.github.com');
}

test('an already merged PR with another head cannot complete the persisted task', async () => {
  await expect(read({ ...correct, head: { ...correct.head, sha: 'c'.repeat(40) } })(7, expected)).rejects.toThrow('PR_RESUME_IDENTITY_MISMATCH');
});
test('resume rejects a different repository, branch, base or PR number', async () => {
  for (const change of [{ number: 8 }, { head: { ...correct.head, ref: 'other' } },
    { head: { ...correct.head, repo: { full_name: 'other/app' } } },
    { base: { ...correct.base, ref: 'staging' } }, { base: { ...correct.base, repo: { full_name: 'other/app' } } }]) {
    await expect(read({ ...correct, ...change })(7, expected)).rejects.toThrow('PR_RESUME_IDENTITY_MISMATCH');
  }
});
test('an exact persisted PR identity remains resumable after merge', async () => {
  expect(await read(correct)(7, expected)).toMatchObject({ state: 'closed', merged: true, mergeCommitSha: 'b'.repeat(40) });
});
