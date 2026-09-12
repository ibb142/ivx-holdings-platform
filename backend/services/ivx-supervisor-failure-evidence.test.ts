import { afterEach, expect, spyOn, test } from 'bun:test';
import { collectSupervisorFailureEvidence } from './ivx-supervisor-failure-evidence';

const mission = { workflow: 'IVX 112 Exact SHA Auto-Deploy Certificate', mainSha: 'a'.repeat(40), runId: 34673339092, conclusion: 'failure', reason: 'failed' };
const run = { id: mission.runId, name: mission.workflow, head_sha: mission.mainSha, head_branch: 'main', status: 'completed', conclusion: 'failure', run_attempt: 2, path: '.github/workflows/ivx-112-exact-sha-autodeploy-cert.yml' };
let fetchMock: ReturnType<typeof spyOn>;
afterEach(() => fetchMock?.mockRestore());

function respond(log: string, overrides: Partial<typeof run> = {}, currentSha = mission.mainSha) {
  const paths: string[] = [];
  fetchMock = spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    if (path.endsWith(`/actions/runs/${mission.runId}`)) return Response.json({ ...run, ...overrides });
    if (path.includes('/contents/')) return Response.json({ encoding: 'base64', content: Buffer.from('run: grep startRealExecutionCertificateRun backend/services/ivx-real-execution-certificate.ts').toString('base64') });
    if (path.endsWith('/attempts/2/jobs')) return Response.json({ jobs: [
      { id: 10, run_id: run.id, conclusion: 'success', steps: [] },
      { id: 11, run_id: run.id, conclusion: 'failure', steps: [{ name: 'Start real certificate', conclusion: 'failure' }] },
    ] });
    if (path.endsWith('/actions/jobs/11/logs')) return new Response(log);
    if (path.endsWith('/git/ref/heads/main')) return Response.json({ object: { sha: currentSha } });
    throw new Error(`Unexpected request: ${path}`);
  });
  return paths;
}

test('collects the exact failed attempt, implementation entry point and real error before planning', async () => {
  const paths = respond('startup ok\n{"ok":false,"error":"Failed to enqueue 112 durable tasks: The operation was aborted due to timeout"}\n##[error]Process completed with exit code 1.');
  const result = await collectSupervisorFailureEvidence(mission);
  expect(result).toMatchObject({ mainSha: mission.mainSha, runId: mission.runId, runAttempt: 2, implementationPaths: ['backend/services/ivx-real-execution-certificate.ts'] });
  expect(result.jobs).toHaveLength(1);
  expect(result.jobs[0].logExcerpt).toContain('Failed to enqueue 112 durable tasks');
  expect(result.jobs[0].logPrefixSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(paths.some(path => path.includes('/attempts/2/jobs'))).toBe(true);
  expect(paths.some(path => path.includes('/actions/jobs/10/'))).toBe(false);
});

test('a rerun on another SHA or a recovered run cannot authorize a repair', async () => {
  respond('error', { head_sha: 'b'.repeat(40) });
  await expect(collectSupervisorFailureEvidence(mission)).rejects.toThrow('identity changed');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fetchMock.mockRestore();
  respond('error', { conclusion: 'success' });
  await expect(collectSupervisorFailureEvidence(mission)).rejects.toThrow('identity changed');
});

test('diagnostic excerpts redact credentials before they become durable goals', async () => {
  const token = 'github_pat_' + 'x'.repeat(40);
  respond(`error: ${token}\nerror: Bearer private-value\nerror password=private-password\nerror: https://user:private-pass@example.com`);
  const json = JSON.stringify(await collectSupervisorFailureEvidence(mission));
  for (const secret of [token, 'private-value', 'private-password', 'private-pass']) expect(json).not.toContain(secret);
  expect(json).toContain('[redacted');
});

test('main advancing during log collection invalidates the old repair scope', async () => {
  respond('error: failed queue write', {}, 'c'.repeat(40));
  await expect(collectSupervisorFailureEvidence(mission)).rejects.toThrow('MAIN changed');
});

test('unreadable or empty diagnostics stay blocked', async () => {
  respond('all commands completed successfully');
  await expect(collectSupervisorFailureEvidence(mission)).rejects.toThrow('no diagnostic error excerpt');
  fetchMock.mockRestore();
  fetchMock = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 503 }));
  await expect(collectSupervisorFailureEvidence(mission)).rejects.toThrow('GitHub HTTP 503');
});

test('oversized logs retain bounded and explicitly partial evidence', async () => {
  respond('error: useful bounded context\n' + 'x'.repeat(600_000));
  const result = await collectSupervisorFailureEvidence(mission);
  expect(result.jobs[0].logTruncated).toBe(true);
  expect(result.jobs[0].logExcerpt.length).toBeLessThanOrEqual(6000);
});
