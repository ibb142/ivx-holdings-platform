import { expect, test } from 'bun:test';
import { MOBILE_CHECK, verifiedMobileSkip, LANDING_PR_BROWSER_CHECK, verifyLandingPrBrowserSkip } from './ivx-ci-conditional-evidence';
const run = (name: string, conclusion: string | null = 'success', status = 'completed') => ({ name, conclusion, status });
const dependencies = [run('Mobile impact classifier'), run('TypeScript typecheck — HARD GATE')];
test('accepts the workflow conditional skip only with both successful dependencies', () => {
  expect(verifiedMobileSkip([...dependencies, run(MOBILE_CHECK, 'skipped')])).toBe(true);
});
test('missing, pending and failed classifier do not authorize mobile skip', () => {
  for (const classifier of [[], [run('Mobile impact classifier', null, 'in_progress')], [run('Mobile impact classifier', 'failure')]]) {
    expect(verifiedMobileSkip([...classifier, dependencies[1], run(MOBILE_CHECK, 'skipped')])).toBe(false);
  }
});
test('failed typecheck and actual mobile failures remain blocked', () => {
  expect(verifiedMobileSkip([dependencies[0], run(dependencies[1].name, 'failure'), run(MOBILE_CHECK, 'skipped')])).toBe(false);
  for (const conclusion of ['failure', 'cancelled', 'timed_out']) {
    expect(verifiedMobileSkip([...dependencies, run(MOBILE_CHECK, conclusion)])).toBe(false);
  }
});

const sha = 'a'.repeat(40);
const repo = 'fixture-owner/fixture-repo';
const url = (id: number, run = 123) => `https://github.com/${repo}/actions/runs/${run}/job/${id}`;
const landing = [
  { ...run(LANDING_PR_BROWSER_CHECK, 'skipped'), details_url: url(1) },
  { ...run('19-agent regression checks'), details_url: url(2) },
  { ...run('Isolated Auth and Postgres acceptance'), details_url: url(3) },
];
const metadata = { head_sha: sha, event: 'pull_request', path: '.github/workflows/landing-19-qa.yml' };
const verify = (runs = landing, value = metadata) => verifyLandingPrBrowserSkip({ runs, commitSha: sha, repo, read: async actual => {
  expect(actual).toBe(`https://api.github.com/repos/${repo}/actions/runs/123`);
  return { ok: true, json: async () => value };
} });

test('verifies the PR-only browser omission from exact workflow, SHA and same-run checks', async () => {
  expect(await verify()).toBe('verified');
});
test('never authorizes a production, stale-SHA or unrelated workflow omission', async () => {
  for (const value of [{ ...metadata, event: 'push' }, { ...metadata, head_sha: 'b'.repeat(40) }, { ...metadata, path: '.github/workflows/other.yml' }]) {
    expect(await verify(landing, value)).toBe('rejected');
  }
  for (const conclusion of ['failure', 'cancelled', 'timed_out']) {
    expect(await verify([{ ...landing[0], conclusion }, ...landing.slice(1)])).toBe('rejected');
  }
});
test('pending checks or unreadable metadata wait without authorizing a merge', async () => {
  expect(await verify(landing.slice(0, 2))).toBe('pending');
  expect(await verify([landing[0], { ...landing[1], status: 'in_progress', conclusion: null }, landing[2]])).toBe('pending');
  expect(await verifyLandingPrBrowserSkip({ runs: landing, repo, commitSha: sha, read: async () => ({ ok: false, json: async () => ({}) }) })).toBe('pending');
});
test('rejects failed dependencies, mixed workflow runs and foreign check links', async () => {
  expect(await verify([landing[0], { ...landing[1], conclusion: 'failure' }, landing[2]])).toBe('rejected');
  expect(await verify([landing[0], { ...landing[1], details_url: url(2, 456) }, landing[2]])).toBe('rejected');
  expect(await verify([{ ...landing[0], details_url: 'https://example.test/actions/runs/123/job/1' }, ...landing.slice(1)])).toBe('rejected');
});
