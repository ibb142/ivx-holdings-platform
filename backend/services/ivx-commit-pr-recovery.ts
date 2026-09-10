export type RecoveredPullRequest = { prNumber: number; prUrl: string };

/** Recover identity from an exact repository, branch, SHA and base match.
 * No timing heuristic and no commit on an unrelated branch can complete a job.
 */
export async function recoverCommittedPullRequest(input: {
  repo: string; branch: string; commitSha: string;
  read: (url: string) => Promise<Response>;
}): Promise<RecoveredPullRequest> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(input.repo) || !/^[a-f0-9]{40}$/i.test(input.commitSha) || !input.branch) {
    throw new Error('PR_RECOVERY_IDENTITY_REQUIRED: repository, branch and commit SHA are required');
  }
  const query = new URLSearchParams({ state: 'all', base: 'main', head: `${input.repo.split('/')[0]}:${input.branch}`, per_page: '100' });
  const response = await input.read(`https://api.github.com/repos/${input.repo}/pulls?${query}`);
  if (!response.ok) throw new Error(`PR_RECOVERY_LOOKUP_FAILED: HTTP ${response.status}`);
  const rows: unknown = await response.json();
  if (!Array.isArray(rows) || rows.length >= 100) throw new Error('PR_RECOVERY_INCOMPLETE: bounded lookup is incomplete');
  const matches = rows.filter(row => row?.head?.sha === input.commitSha && row?.head?.ref === input.branch
    && row?.head?.repo?.full_name?.toLowerCase() === input.repo.toLowerCase()
    && row?.base?.ref === 'main' && row?.base?.repo?.full_name?.toLowerCase() === input.repo.toLowerCase()
    && Number.isInteger(row?.number) && row.number > 0);
  if (matches.length !== 1) throw new Error(`PR_RECOVERY_AMBIGUOUS: expected one exact pull request, found ${matches.length}`);
  return { prNumber: matches[0].number, prUrl: `https://github.com/${input.repo}/pull/${matches[0].number}` };
}
