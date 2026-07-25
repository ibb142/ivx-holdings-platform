/**
 * IVX Senior Developer — Branch + Pull Request flow proof (owner-only).
 *
 *   GET  /api/ivx/senior-developer/branch-pr-proof   capability descriptor + last proof
 *   POST /api/ivx/senior-developer/branch-pr-proof   execute a REAL branch+PR cycle
 *
 * FINAL MANDATE Phase 1 (2026-07-18): SD-0001 must prove the branch + pull
 * request flow with live GitHub evidence (not a narrative). The POST handler:
 *   1. Reads the configured repo's main branch HEAD.
 *   2. Creates a real branch `sd0001/branch-pr-proof-<ts>`.
 *   3. Commits a proof file to that branch via the GitHub contents API.
 *   4. Opens a real pull request against main.
 *   5. Closes the PR (unmerged) so main stays clean — the PR remains as
 *      permanent, publicly-auditable evidence.
 *
 * No secret values are ever returned. All GitHub calls use the backend
 * runtime's GITHUB_TOKEN / GITHUB_REPO_URL environment variables.
 */

import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';

export const IVX_BRANCH_PR_PROOF_MARKER = 'ivx-branch-pr-proof-2026-07-18';

const GITHUB_API = 'https://api.github.com';

type RepoInfo = { owner: string; repo: string };

type StepResult = {
  step: string;
  ok: boolean;
  httpStatus: number | null;
  detail: string;
};

export type BranchPrProofResult = {
  ok: boolean;
  marker: string;
  executedAt: string;
  repo: string;
  baseBranch: string;
  baseSha: string | null;
  branch: string | null;
  commitSha: string | null;
  prNumber: number | null;
  prUrl: string | null;
  prState: string | null;
  steps: StepResult[];
  error: string | null;
};

function readTrimmedEnv(name: string): string {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

function parseRepoUrl(url: string): RepoInfo | null {
  const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?/i);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

async function githubFetch(
  token: string,
  path: string,
  init?: { method?: string; body?: Record<string, unknown> },
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, data };
}

/** Execute the real branch + PR proof cycle. Never returns secret values. */
export async function runBranchPrProof(): Promise<BranchPrProofResult> {
  const executedAt = new Date().toISOString();
  const steps: StepResult[] = [];
  const result: BranchPrProofResult = {
    ok: false,
    marker: IVX_BRANCH_PR_PROOF_MARKER,
    executedAt,
    repo: '',
    baseBranch: 'main',
    baseSha: null,
    branch: null,
    commitSha: null,
    prNumber: null,
    prUrl: null,
    prState: null,
    steps,
    error: null,
  };

  const token = readTrimmedEnv('GITHUB_TOKEN');
  const repoUrl = readTrimmedEnv('GITHUB_REPO_URL');
  if (!token || !repoUrl) {
    result.error = 'GITHUB_TOKEN or GITHUB_REPO_URL is not configured in this runtime.';
    steps.push({ step: 'credentials', ok: false, httpStatus: null, detail: result.error });
    return result;
  }
  const repoInfo = parseRepoUrl(repoUrl);
  if (!repoInfo) {
    result.error = 'GITHUB_REPO_URL could not be parsed into owner/repo.';
    steps.push({ step: 'credentials', ok: false, httpStatus: null, detail: result.error });
    return result;
  }
  result.repo = `${repoInfo.owner}/${repoInfo.repo}`;
  steps.push({ step: 'credentials', ok: true, httpStatus: null, detail: 'GITHUB_TOKEN + GITHUB_REPO_URL present.' });

  const base = `/repos/${encodeURIComponent(repoInfo.owner)}/${encodeURIComponent(repoInfo.repo)}`;
  const timestampSlug = executedAt.replace(/[:.]/g, '-').toLowerCase();
  const branchName = `sd0001/branch-pr-proof-${timestampSlug}`;

  // 1. Read main HEAD.
  const ref = await githubFetch(token, `${base}/git/ref/heads/main`);
  const baseSha = typeof (ref.data.object as Record<string, unknown> | undefined)?.sha === 'string'
    ? String((ref.data.object as Record<string, unknown>).sha)
    : null;
  steps.push({ step: 'read_main_head', ok: ref.ok && Boolean(baseSha), httpStatus: ref.status, detail: baseSha ? `main HEAD ${baseSha.slice(0, 12)}` : 'failed to read main HEAD' });
  if (!ref.ok || !baseSha) {
    result.error = `GitHub main ref lookup failed (HTTP ${ref.status}).`;
    return result;
  }
  result.baseSha = baseSha;

  // 2. Create the proof branch.
  const createRef = await githubFetch(token, `${base}/git/refs`, {
    method: 'POST',
    body: { ref: `refs/heads/${branchName}`, sha: baseSha },
  });
  steps.push({ step: 'create_branch', ok: createRef.ok, httpStatus: createRef.status, detail: createRef.ok ? `branch ${branchName} created from ${baseSha.slice(0, 12)}` : 'branch creation failed' });
  if (!createRef.ok) {
    result.error = `GitHub branch creation failed (HTTP ${createRef.status}).`;
    return result;
  }
  result.branch = branchName;

  // 3. Commit a proof file to the branch.
  const proofPath = `logs/audit/sd-0001/branch-pr-proof-${timestampSlug}.md`;
  const proofBody = [
    '# SD-0001 Branch + PR Flow Proof',
    '',
    `- Executed at: ${executedAt}`,
    `- Base branch: main @ ${baseSha}`,
    `- Proof branch: ${branchName}`,
    '- Purpose: FINAL MANDATE Phase 1 — live verification that the IVX Senior',
    '  Developer runtime can create a branch, commit to it, and open a pull',
    '  request using the production backend credentials.',
    '- This PR is closed without merging; main is never touched.',
    '',
  ].join('\n');
  const contentB64 = Buffer.from(proofBody, 'utf8').toString('base64');
  const commit = await githubFetch(token, `${base}/contents/${proofPath.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'PUT',
    body: {
      message: `SD-0001 branch+PR flow proof (${executedAt}) [proof-only branch]`,
      content: contentB64,
      branch: branchName,
    },
  });
  const commitSha = typeof (commit.data.commit as Record<string, unknown> | undefined)?.sha === 'string'
    ? String((commit.data.commit as Record<string, unknown>).sha)
    : null;
  steps.push({ step: 'commit_to_branch', ok: commit.ok && Boolean(commitSha), httpStatus: commit.status, detail: commitSha ? `commit ${commitSha.slice(0, 12)} on ${branchName}` : 'commit failed' });
  if (!commit.ok || !commitSha) {
    result.error = `GitHub commit to proof branch failed (HTTP ${commit.status}).`;
    return result;
  }
  result.commitSha = commitSha;

  // 4. Open the pull request.
  const pr = await githubFetch(token, `${base}/pulls`, {
    method: 'POST',
    body: {
      title: `SD-0001 branch+PR flow proof — ${executedAt}`,
      head: branchName,
      base: 'main',
      body: 'Automated FINAL MANDATE Phase 1 capability proof. This PR is closed without merging and exists solely as auditable evidence that the branch + pull request flow works end to end.',
    },
  });
  const prNumber = typeof pr.data.number === 'number' ? pr.data.number : null;
  const prUrl = typeof pr.data.html_url === 'string' ? pr.data.html_url : null;
  steps.push({ step: 'open_pr', ok: pr.ok && Boolean(prNumber), httpStatus: pr.status, detail: prNumber ? `PR #${prNumber} opened` : 'PR creation failed' });
  if (!pr.ok || !prNumber) {
    result.error = `GitHub PR creation failed (HTTP ${pr.status}).`;
    return result;
  }
  result.prNumber = prNumber;
  result.prUrl = prUrl;

  // 5. Close the PR (unmerged) so main stays clean; the PR remains as evidence.
  const close = await githubFetch(token, `${base}/pulls/${prNumber}`, {
    method: 'PATCH',
    body: { state: 'closed' },
  });
  const prState = typeof close.data.state === 'string' ? close.data.state : null;
  steps.push({ step: 'close_pr_unmerged', ok: close.ok, httpStatus: close.status, detail: close.ok ? `PR #${prNumber} closed unmerged (evidence preserved)` : 'PR close failed (PR remains open)' });
  result.prState = prState ?? (close.ok ? 'closed' : 'open');

  result.ok = true;
  return result;
}

export function OPTIONS(): Response {
  return ownerOnlyOptions();
}

export async function handleIVXBranchPrProofStatusRequest(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    return ownerOnlyJson({
      ok: true,
      marker: IVX_BRANCH_PR_PROOF_MARKER,
      capability: 'branch_pr_flow',
      description: 'POST executes a real GitHub branch + pull request cycle (branch -> commit -> PR -> close unmerged) and returns verifiable identifiers.',
      routes: {
        status: 'GET /api/ivx/senior-developer/branch-pr-proof',
        execute: 'POST /api/ivx/senior-developer/branch-pr-proof',
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return ownerOnlyJson({ ok: false, marker: IVX_BRANCH_PR_PROOF_MARKER, error: error instanceof Error ? error.message : 'status failed' }, 403);
  }
}

export async function handleIVXBranchPrProofRequest(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const proof = await runBranchPrProof();
    return ownerOnlyJson({ ...proof }, proof.ok ? 200 : 502);
  } catch (error) {
    return ownerOnlyJson({ ok: false, marker: IVX_BRANCH_PR_PROOF_MARKER, error: error instanceof Error ? error.message : 'branch+PR proof failed' }, 500);
  }
}