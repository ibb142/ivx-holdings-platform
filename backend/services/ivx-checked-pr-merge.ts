/** Merge only the head whose checks were verified; repository rules remain authoritative. */
export async function mergeCheckedPullRequest(input: {
  repository: string;
  token: string;
  prNumber: number;
  checkedHeadSha: string;
  title: string;
}, fetchImpl: typeof fetch = fetch): Promise<{ merged: boolean; mergeCommitSha: string | null }> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(input.repository) || !/^[a-f0-9]{40}$/i.test(input.checkedHeadSha)
    || !Number.isSafeInteger(input.prNumber) || input.prNumber < 1 || !input.token) {
    throw new Error('A repository, credential, PR and checked head SHA are required to merge');
  }
  // Do not retry an ambiguous mutation or change branch protection after a rejection.
  // The existing resume path can read the PR state before any subsequent attempt.
  const response = await fetchImpl(`https://api.github.com/repos/${input.repository}/pulls/${input.prNumber}/merge`, {
    method: 'PUT', redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${input.token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ sha: input.checkedHeadSha, commit_title: input.title, merge_method: 'squash' }),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`GitHub PR merge refused (HTTP ${response.status}); checked head and repository protections preserved`);
  }
  const result = await response.json() as { merged?: unknown; sha?: unknown };
  if (result.merged !== true || typeof result.sha !== 'string' || !/^[a-f0-9]{40}$/i.test(result.sha)) {
    throw new Error('GitHub did not confirm a merge commit; reconcile PR state before retry');
  }
  return { merged: true, mergeCommitSha: result.sha };
}
