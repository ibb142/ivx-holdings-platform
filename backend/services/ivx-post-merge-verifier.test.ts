import { test, expect } from 'bun:test';
import { createHash } from 'node:crypto';
import { createExecutionRecord } from './ivx-execution-record';
import { observePostMerge, applyPostMergeReceipt, createPostMergeReconciler, type PostMergeStore } from './ivx-post-merge-verifier';
import type { IVXWorkerJob } from './ivx-senior-developer-worker';
import type { PatrolObservation } from './ivx-autonomous-recovery-health';

const merge = 'a'.repeat(40), head = 'b'.repeat(40), older = 'c'.repeat(40);
const time = Date.parse('2026-09-13T06:00:00Z');
const iso = (offset = 0) => new Date(time + offset).toISOString();
const config = { apiKey: 'fixture-secret', apiServiceId: 'srv-api', workerServiceId: 'srv-worker', productionBaseUrl: 'https://api.ivxholding.com' };
function job(): IVXWorkerJob {
  return { jobId: 'original-job', ownerId: 'original-owner', status: 'completed', stage: 'COMPLETED', createdAt: iso(-120_000),
    attempts: 1, finishedAt: iso(-60_000), input: { ownerApproved: true, executionMode: 'code_change', agentNumber: 1,
      taskId: `landing-remediation:${older}:structure.header`, goal: 'Repair original missing videos' },
    result: { jobId: 'original-job', commitSha: head, prMerged: true, prMergeCommitSha: merge, ciChecksGreen: true,
      testsRun: true, testsPassed: true, endToEndProductionComplete: false, deployRequested: false, deployApproved: false,
      executionRecord: createExecutionRecord({ task_id: 'original-task', task_type: 'CODE_FIX', user_request: 'Repair missing videos' }),
    } } as IVXWorkerJob;
}
function patrol(outcome = 'PASS', unit = 'structure.header', sha = merge): PatrolObservation[] {
  const summary = 'LANDING_P0_RESULT ' + JSON.stringify({ v: 1, unit_id: unit, agent_number: 1,
    production_sha: sha, status: outcome, started_at: iso(-20_000), completed_at: iso(-10_000),
    api_checks: 1, browser_checks: 0, evidence: ['GET /: checked actual header markup'] });
  return [{ task_id: 'patrol-1', assigned_agent_number: 1, evidence: { evidenceId: 'real-receipt-id', source: 'continuous-patrol:1',
    commitSha: sha, createdAt: iso(-5000), summary, contentHash: createHash('sha256').update(summary).digest('hex') } as any }];
}
function http(options: { workerSha?: string; deploymentStatus?: string; healthSha?: string; ready?: unknown; repo?: string;
  html?: boolean; failRender?: boolean; finalSha?: string } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  let versions = 0;
  const fetcher = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input); calls.push({ url, init });
    if (url.startsWith('https://api.render.com/')) {
      if (options.failRender) throw new Error('secret from upstream must never escape');
      const worker = url.includes('srv-worker');
      if (!url.includes('/deploys')) return Response.json({ repo: options.repo ?? 'https://github.com/ibb142/ivx-holdings-platform',
        branch: 'main', type: worker ? 'background_worker' : 'web_service' });
      return Response.json([{ deploy: { id: worker ? 'dep-worker' : 'dep-api',
        commit: { id: worker ? options.workerSha ?? merge : merge }, status: options.deploymentStatus ?? 'live', finishedAt: iso(-30_000) }, cursor: 'cursor' }]);
    }
    if (options.html) return new Response('<html>SPA fallback</html>');
    if (url.endsWith('/health/ready')) return Response.json(options.ready ?? { ok: true, ready: true, status: 'ready',
      checks: Object.fromEntries(['ai', 'database', 'auth', 'queue'].map(name => [name, { ok: true }])) });
    if (url.endsWith('/version')) versions++;
    return Response.json({ ok: true, commit: versions > 1 && options.finalSha ? options.finalSha : options.healthSha ?? merge });
  }) as typeof fetch;
  return { fetcher, calls };
}
const inspect = async (options: Parameters<typeof http>[0] = {}, rows = patrol(), target = job()) => {
  const f = http(options);
  return { receipt: await observePostMerge(target, config, async () => rows, f.fetcher, () => time), calls: f.calls };
};

test('real Render wrappers, both services, merge SHA and the exact functional observation produce bounded evidence', async () => {
  const { receipt, calls } = await inspect();
  expect(receipt.status).toBe('verified');
  const result = applyPostMergeReceipt(job().result!, receipt);
  expect(result.commitSha).toBe(head);
  expect(result.liveCommit).toBe(merge);
  expect(result.endToEndProductionComplete).toBe(true);
  expect(result.deployRequested).toBe(false);
  expect(result.deployApproved).toBe(false);
  expect(result.executionRecord?.acceptance_criteria).toEqual(['landing:structure.header']);
  expect(result.executionRecord?.verified_at).toBe(time);
  expect(receipt.worker?.deployId).toBe('dep-worker');
  expect(calls.every(call => call.init.method === 'GET' && call.init.redirect === 'error' && call.init.signal)).toBe(true);
  expect(calls.filter(call => !call.url.startsWith('https://api.render.com/')).every(call => !(call.init.headers as any).Authorization)).toBe(true);
  expect(JSON.stringify(receipt)).not.toContain(config.apiKey);
});

test('API live alone, superseded deploys, foreign services and PR-head health cannot certify the merge', async () => {
  for (const options of [{ workerSha: older }, { deploymentStatus: 'deactivated' }, { repo: 'https://github.com/other/repo' }, { healthSha: head }]) {
    expect((await inspect(options)).receipt.status).not.toBe('verified');
  }
});

test('HTTP 200 HTML, empty readiness and a degraded 200 stay unverified', async () => {
  for (const options of [{ html: true }, { ready: {} }, { ready: { ok: true, ready: true, degraded: true } }]) {
    const { receipt } = await inspect(options);
    expect(receipt.status).toBe('awaiting_health');
    expect(applyPostMergeReceipt(job().result!, receipt).endToEndProductionComplete).toBe(false);
  }
});

test('healthy infrastructure cannot invent acceptance for a generic task, another unit, stale SHA, or a failing unit', async () => {
  const generic = job(); generic.input.taskId = 'owner-original-request';
  for (const [rows, target] of [[patrol('FAIL'), job()], [patrol('PASS', 'other-unit'), job()],
    [patrol('PASS', 'structure.header', older), job()], [patrol(), generic]] as const) {
    const { receipt } = await inspect({}, rows, target);
    const result = applyPostMergeReceipt(target.result!, receipt);
    expect(receipt.status).toBe('awaiting_acceptance');
    expect(result.deployVerified).toBe(true);
    expect(result.endToEndProductionComplete).toBe(false);
    expect(result.executionRecord?.verified_at).toBeNull();
  }
});

test('a deploy change during acceptance or corrupt evidence cannot create a seal', async () => {
  expect((await inspect({ finalSha: older })).receipt.status).toBe('awaiting_health');
  const corrupt = patrol(); corrupt[0].evidence!.contentHash = 'wrong';
  expect((await inspect({}, corrupt)).receipt.status).toBe('awaiting_acceptance');
  const { receipt } = await inspect({ failRender: true });
  expect(receipt.status).toBe('unavailable');
  expect(JSON.stringify(receipt)).not.toContain('secret from upstream');
});

test('a video-presence PASS cannot certify authentic decoded property footage', async () => {
  const target = job(); target.input.taskId = `landing-remediation:${older}:deals.videos-present`;
  const { receipt } = await inspect({}, patrol('PASS', 'deals.videos-present'), target);
  expect(receipt.acceptance?.outcome).toBe('PASS');
  expect(receipt.status).toBe('awaiting_acceptance');
  expect(receipt.reason).toBe('authentic_media_acceptance_missing');
  expect(applyPostMergeReceipt(target.result!, receipt).endToEndProductionComplete).toBe(false);
});

function durableFixture() {
  let current = job(), ledger: any = null, clock = time, rejectCommit = false;
  const store: PostMergeStore = {
    list: async () => [structuredClone(current)],
    claim: async (expected, next) => {
      if (JSON.stringify(current) !== JSON.stringify(expected)) throw new Error('CAS');
      current = structuredClone(next);
    },
    commit: async (expected, next) => {
      if (rejectCommit || JSON.stringify(current) !== JSON.stringify(expected)) throw new Error('atomic commit rejected');
      current = structuredClone(next); ledger = structuredClone(next.result);
    },
  };
  return { store, now: () => clock, advance: () => { clock += 91_000; },
    current: () => current, ledger: () => ledger, reject: (value: boolean) => { rejectCommit = value; } };
}

test('concurrent replicas probe once, persist the same job, and cannot grant new deployment approval', async () => {
  const f = durableFixture(); let probes = 0;
  const observe = async () => { probes++; return (await inspect()).receipt; };
  await Promise.all([createPostMergeReconciler(f.store, observe, f.now)(), createPostMergeReconciler(f.store, observe, f.now)()]);
  expect(probes).toBe(1);
  expect(f.current().jobId).toBe('original-job');
  expect(f.current().result).toEqual(f.ledger());
  expect(f.current().result?.endToEndProductionComplete).toBe(true);
  expect(f.current().result?.deployApproved).toBe(false);
});

test('restart after an interrupted observation waits for the persisted lease and resumes without another code job', async () => {
  const f = durableFixture();
  await createPostMergeReconciler(f.store, async () => { throw new Error('container stopped'); }, f.now)();
  let probes = 0;
  const resumed = createPostMergeReconciler(f.store, async () => { probes++; return (await inspect()).receipt; }, f.now);
  await resumed(); expect(probes).toBe(0); expect(f.ledger()).toBeNull();
  f.advance(); await resumed();
  expect(probes).toBe(1); expect(f.current().attempts).toBe(1);
  expect(f.current().result?.postMergeVerification?.attempts).toBe(2);
  expect(f.current().result).toEqual(f.ledger());
});

test('failed atomic persistence never leaves a partial success and a subsequent worker retries it', async () => {
  const f = durableFixture(); f.reject(true);
  const observe = async () => (await inspect()).receipt;
  expect(await createPostMergeReconciler(f.store, observe, f.now)()).toBe(false);
  expect(f.current().result?.endToEndProductionComplete).toBe(false);
  expect(f.ledger()).toBeNull();
  f.reject(false); f.advance();
  expect(await createPostMergeReconciler(f.store, observe, f.now)()).toBe(true);
  expect(f.current().result).toEqual(f.ledger());
});
