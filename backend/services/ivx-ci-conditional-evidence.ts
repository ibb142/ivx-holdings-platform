type Run = { name: string; status: string; conclusion: string | null; details_url?: string | null };
export const MOBILE_CHECK = 'Maestro E2E (mobile surface) — HARD GATE';
/** ivx-e2e.yml skips mobile only when its classifier says this PR has no
 * mobile impact. Both dependencies must succeed; missing/failed dependencies
 * cannot authorize a skip. Keep the original skipped conclusion as evidence.
 */
export function verifiedMobileSkip(runs: readonly Run[]): boolean {
  const passed = (name: string) => { const r = runs.find(row => row.name === name); return r?.status === 'completed' && r.conclusion === 'success'; };
  const mobile = runs.find(r => r.name === MOBILE_CHECK);
  return mobile?.status === 'completed' && mobile.conclusion === 'skipped'
    && passed('Mobile impact classifier')
    && passed('TypeScript typecheck — HARD GATE');
}

// GitHub does not expand the matrix when the entire production-only job is
// omitted for a PR. Expanded production browser jobs never match this name.
export const LANDING_PR_BROWSER_CHECK = 'Browser / ${{ matrix.unit }}';
export async function verifyLandingPrBrowserSkip(input: {
  runs: readonly Run[]; commitSha: string; repo: string;
  read: (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
}): Promise<'verified' | 'pending' | 'rejected'> {
  const target = input.runs.find(run => run.name === LANDING_PR_BROWSER_CHECK);
  if (target?.status !== 'completed' || target.conclusion !== 'skipped') return 'rejected';
  let runId: string;
  try {
    const url = new URL(target.details_url ?? '');
    const prefix = `/${input.repo}/actions/runs/`;
    if (url.origin !== 'https://github.com' || !url.pathname.startsWith(prefix)) return 'rejected';
    const match = /^(\d+)\/job\/\d+$/.exec(url.pathname.slice(prefix.length));
    if (!match) return 'rejected';
    runId = match[1];
  } catch { return 'rejected'; }
  try {
    const response = await input.read(`https://api.github.com/repos/${input.repo}/actions/runs/${runId}`);
    if (!response.ok) return 'pending';
    const metadata = await response.json() as { head_sha?: string; event?: string; path?: string };
    if (metadata.head_sha !== input.commitSha || metadata.event !== 'pull_request'
      || metadata.path !== '.github/workflows/landing-19-qa.yml') return 'rejected';
  } catch { return 'pending'; }
  for (const name of ['19-agent regression checks', 'Isolated Auth and Postgres acceptance']) {
    const dependency = input.runs.find(run => run.name === name);
    if (!dependency || dependency.status !== 'completed') return 'pending';
    if (dependency.conclusion !== 'success') return 'rejected';
    // Do not combine similarly named checks from another workflow run.
    try {
      const url = new URL(dependency.details_url ?? '');
      if (url.origin !== 'https://github.com' || !url.pathname.startsWith(`/${input.repo}/actions/runs/${runId}/job/`)) return 'rejected';
    } catch { return 'rejected'; }
  }
  return 'verified';
}
