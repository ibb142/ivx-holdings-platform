import { test, afterEach } from 'bun:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fetchLandingGitHubRead, resetLandingGitHubReadForTests } from './ivx-landing-github-read';
import { hasLandingCtaTarget, executeLandingUnit, __resetLandingExecutorCachesForTests } from './ivx-landing-p0-executor';
import type { LandingUnit } from './ivx-landing-p0-backlog';

const originalToken = process.env.GITHUB_TOKEN;
const originalRepo = process.env.IVX_LANDING_REPO;
afterEach(() => {
  if (originalToken === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = originalToken;
  if (originalRepo === undefined) delete process.env.IVX_LANDING_REPO; else process.env.IVX_LANDING_REPO = originalRepo;
  resetLandingGitHubReadForTests();
  __resetLandingExecutorCachesForTests();
});
const sha = 'a'.repeat(40);
const ctx = { agentId: 'synthetic-agent', agentNumber: 1, taskId: 'synthetic-task', sourceSha: sha, productionSha: sha, repair: false };
const ciUnit: LandingUnit = { unitId: 'synthetic-ci', lane: 'e2e', workstream: 'synthetic', title: 'Synthetic browser evidence', severity: 'P0', check: { kind: 'ci', workflow: 'Synthetic workflow', check: 'browser' } };
const castFetch = (fn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): typeof fetch => fn as typeof fetch;

test('public metadata works without a configured token and only issues a bounded GET', async () => {
  delete process.env.GITHUB_TOKEN;
  const response = await fetchLandingGitHubRead('commits/main', castFetch(async (url, init) => {
    assert.equal(String(url), 'https://api.github.com/repos/ibb142/ivx-holdings-platform/commits/main');
    assert.equal(init?.method, 'GET');
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    assert.ok(init?.signal);
    return Response.json({ sha });
  }));
  assert.deepEqual(await response.json(), { sha });
});

test('a valid token is retained without an anonymous retry', async () => {
  process.env.GITHUB_TOKEN = 'synthetic-valid-token';
  let calls = 0;
  await fetchLandingGitHubRead('commits/main', castFetch(async (_url, init) => {
    calls += 1;
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer synthetic-valid-token');
    return Response.json({ sha });
  }));
  assert.equal(calls, 1);
});

test('401 retries public metadata once and suppresses the rejected credential on the next read', async () => {
  process.env.GITHUB_TOKEN = 'synthetic-expired-token';
  const auth: Array<string | null> = [];
  const fetchImpl = castFetch(async (_url, init) => {
    const header = new Headers(init?.headers).get('authorization');
    auth.push(header);
    return header ? new Response('Bad credentials', { status: 401 }) : Response.json({ sha });
  });
  assert.equal((await fetchLandingGitHubRead('commits/main', fetchImpl)).status, 200);
  await fetchLandingGitHubRead(`actions/runs?head_sha=${sha}&per_page=100`, fetchImpl);
  assert.deepEqual(auth, ['Bearer synthetic-expired-token', null, null]);
});

test('permission, missing-resource, rate-limit and server errors are never retried anonymously', async () => {
  process.env.GITHUB_TOKEN = 'synthetic-token';
  for (const status of [403, 404, 429, 500]) {
    let calls = 0;
    const response = await fetchLandingGitHubRead('commits/main', castFetch(async () => {
      calls += 1;
      return new Response('', { status });
    }));
    assert.equal(response.status, status);
    assert.equal(calls, 1);
  }
});

test('other repositories, write endpoints, arbitrary URLs and malformed SHAs fail before network access', async () => {
  let calls = 0;
  const fetchImpl = castFetch(async () => { calls += 1; return Response.json({}); });
  for (const path of ['issues', 'actions/workflows/deploy/dispatches', 'https://example.com', 'commits/main/../../issues', 'actions/runs?head_sha=bad&per_page=100']) {
    await assert.rejects(fetchLandingGitHubRead(path, fetchImpl), /Unsupported/);
  }
  process.env.IVX_LANDING_REPO = 'synthetic/private-repository';
  await assert.rejects(fetchLandingGitHubRead('commits/main', fetchImpl), /repository does not match/);
  assert.equal(calls, 0);
});

test('112 parallel CI observations share one public evidence read after a rejected token', async () => {
  process.env.GITHUB_TOKEN = 'synthetic-expired-token';
  let calls = 0;
  const fetchImpl = castFetch(async (_url, init) => {
    calls += 1;
    if (new Headers(init?.headers).has('authorization')) return new Response('', { status: 401 });
    return Response.json({ workflow_runs: [{ id: 1, name: 'Synthetic workflow', head_sha: sha, status: 'completed', conclusion: 'success', html_url: 'https://github.com/synthetic/repository/actions/runs/1', updated_at: new Date().toISOString() }] });
  });
  const observations = await Promise.all(Array.from({ length: 112 }, (_, index) => executeLandingUnit(ciUnit, { ...ctx, agentNumber: index + 1 }, { fetchImpl })));
  assert.equal(calls, 2);
  assert.ok(observations.every((value) => value.record.status === 'PASS'));
});

test('a successful workflow from a different SHA never certifies the current deployment', async () => {
  delete process.env.GITHUB_TOKEN;
  const result = await executeLandingUnit(ciUnit, ctx, { fetchImpl: castFetch(async () => Response.json({ workflow_runs: [{ id: 2, name: 'Synthetic workflow', head_sha: 'b'.repeat(40), status: 'completed', conclusion: 'success', updated_at: new Date().toISOString() }] })) });
  assert.equal(result.record.status, 'BLOCKED');
});

test('missing, running and failed CI evidence remain blocked or failed', async () => {
  delete process.env.GITHUB_TOKEN;
  for (const scenario of [
    { runs: [], expected: 'BLOCKED' },
    { runs: [{ status: 'in_progress', conclusion: null }], expected: 'BLOCKED' },
    { runs: [{ status: 'completed', conclusion: 'failure' }], expected: 'FAIL' },
  ]) {
    __resetLandingExecutorCachesForTests();
    const result = await executeLandingUnit(ciUnit, ctx, { fetchImpl: castFetch(async () => Response.json({ workflow_runs: scenario.runs.map((run) => ({ id: 3, name: 'Synthetic workflow', head_sha: sha, updated_at: new Date().toISOString(), ...run })) })) });
    assert.equal(result.record.status, scenario.expected);
  }
});

test('real fragment and contact destinations pass while empty, missing and duplicate targets fail', () => {
  const markup = '<section id="join"></section><section id="investor-chat"></section>';
  for (const href of ['#join', '#investor-chat', 'mailto:qa@example.com', 'tel:+13055550100', '/register', 'https://example.com/register']) assert.equal(hasLandingCtaTarget({ href }, markup), true, href);
  for (const href of ['', '#', '#missing', '#%invalid', 'mailto:', 'tel:', 'javascript:void(0)', 'data:text/html,hello']) assert.equal(hasLandingCtaTarget({ href }, markup), false, href);
  assert.equal(hasLandingCtaTarget({ href: '#join' }, `${markup}<div id="join"></div>`), false);
  assert.equal(hasLandingCtaTarget({ href: '#missing' }, '<!-- <div id="missing"></div> -->'), false);
});

test('the published landing source has one registration anchor and no broken CTA destinations', async () => {
  const html = await readFile(new URL('../../expo/ivxholding-landing/index.html', import.meta.url), 'utf8');
  assert.equal([...html.matchAll(/\bid="join"/g)].length, 1);
  const unit: LandingUnit = { unitId: 'navigation.cta-targets', lane: 'structure', workstream: 'navigation', title: 'CTA targets', severity: 'P0', check: { kind: 'html', asserts: [{ assert: 'cta-present' }] } };
  const result = await executeLandingUnit(unit, ctx, { fetchImpl: castFetch(async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })) });
  assert.equal(result.record.status, 'PASS', JSON.stringify(result.record.bugs_found));
});
