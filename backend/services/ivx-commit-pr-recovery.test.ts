import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recoverCommittedPullRequest } from './ivx-commit-pr-recovery';

const repo = 'owner/application';
const branch = 'ivx-autonomous-repair-example';
const commitSha = 'a'.repeat(40);
const pull = { number: 17, head: { sha: commitSha, ref: branch, repo: { full_name: repo } }, base: { ref: 'main', repo: { full_name: repo } } };
test('recovers the exact previously created PR without creating or merging anything', async () => {
  const requests: string[] = [];
  const result = await recoverCommittedPullRequest({ repo, branch, commitSha, read: async url => { requests.push(url); return Response.json([pull]); } });
  assert.deepEqual(result, { prNumber: 17, prUrl: 'https://github.com/owner/application/pull/17' });
  assert.equal(requests.length, 1);
  const url = new URL(requests[0]);
  assert.equal(url.searchParams.get('head'), `owner:${branch}`);
  assert.equal(url.searchParams.get('state'), 'all');
});
test('rejects a different commit, branch, repository, base or ambiguous identity', async () => {
  const wrong = [
    { ...pull, head: { ...pull.head, sha: 'b'.repeat(40) } },
    { ...pull, head: { ...pull.head, ref: 'other' } },
    { ...pull, head: { ...pull.head, repo: { full_name: 'other/application' } } },
    { ...pull, base: { ...pull.base, ref: 'preview' } },
    { ...pull, base: { ...pull.base, repo: { full_name: 'other/application' } } },
  ];
  for (const rows of [...wrong.map(row => [row]), [], [pull, { ...pull, number: 18 }]]) {
    await assert.rejects(recoverCommittedPullRequest({ repo, branch, commitSha, read: async () => Response.json(rows) }), /PR_RECOVERY_AMBIGUOUS/);
  }
});
test('rejects unreadable, malformed and truncated lookups without inventing a PR', async () => {
  for (const response of [new Response('', { status: 503 }), Response.json({}), Response.json(Array(100).fill(pull))]) {
    await assert.rejects(recoverCommittedPullRequest({ repo, branch, commitSha, read: async () => response }), /PR_RECOVERY_(LOOKUP_FAILED|INCOMPLETE)/);
  }
  let calls = 0;
  await assert.rejects(recoverCommittedPullRequest({ repo, branch, commitSha: 'unknown', read: async () => { calls++; return Response.json([pull]); } }), /IDENTITY_REQUIRED/);
  assert.equal(calls, 0);
});
