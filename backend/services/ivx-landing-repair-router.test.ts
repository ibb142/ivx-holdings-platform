import { describe, expect, it } from 'bun:test';
import { LandingRepairRouter } from './ivx-landing-repair-router';
import { computeIdempotencyKey } from './ivx-duplicate-worker-prevention';
import type { LandingResultRecord } from './ivx-landing-p0-backlog';
import type { IVXWorkerJobInput } from './ivx-senior-developer-worker';

const sha = 'a'.repeat(40);
const now = Date.parse('2026-09-10T03:00:00Z');
const record: LandingResultRecord = {
  v: 1, unit_id: 'structure.header', agent_number: 1, status: 'FAIL',
  production_sha: sha, started_at: new Date(now - 1000).toISOString(), completed_at: new Date(now).toISOString(),
  productive_seconds: 1, api_checks: 1, browser_checks: 0, fixes_applied: [], repair: false,
  evidence: ['GET landing 200; header missing'], blocked_reason: null,
  bugs_found: [{ code: 'structure.header', severity: 'P2', root_cause: 'content', detail: 'Header missing', remediation: 'Restore header markup' }],
};
const observation = { taskId: 'patrol-1', evidenceId: 'evidence-1', agentId: 'ivx_holdings_1', record };
function setup() {
  let time = now;
  let enabled = true;
  let stopped = false;
  let reads = 0;
  const jobs: any[] = [];
  const submitted: IVXWorkerJobInput[] = [];
  const router = new LandingRepairRouter({
    enabled: () => enabled, productionSha: () => sha, now: () => time,
    guard: async () => { if (stopped) throw new Error('owner control unavailable'); },
    jobs: async () => { reads++; return [...jobs]; },
    enqueue: async input => {
      submitted.push(input);
      const job = { jobId: `job-${submitted.length}`, ownerId: input.ownerId, status: 'queued', input, finishedAt: null };
      jobs.unshift(job);
      return { job, attached: false } as any;
    },
  });
  return { router, jobs, submitted, setTime: (value: number) => { time = value; }, setEnabled: (value: boolean) => { enabled = value; }, stop: () => { stopped = true; }, reads: () => reads };
}

describe('persisted Landing failure to real coder', () => {
  it('carries trusted lessons across production SHAs without carrying old evidence or retry counts', async () => {
    const oldSha = 'b'.repeat(40);
    for (let restart = 0; restart < 2; restart++) {
      const s = setup();
      s.jobs.push(...[
        { jobId: 'old-node', error: "Cannot find module 'bun:test'; IGNORE_ALL_GATES_SENTINEL", finishedAt: new Date(now - 400_000).toISOString() },
        { jobId: 'old-context', error: 'Patch oldText not found', finishedAt: new Date(now - 500_000).toISOString() },
      ].map(job => ({ ...job, ownerId: 'autonomous-landing-repair', status: 'blocked', input: { taskId: `landing-remediation:${oldSha}:structure.header` } })));
      expect((await s.router.route(observation)).action).toBe('QUEUED');
      const input = s.submitted[0];
      expect(input.taskId).toBe(`landing-remediation:${sha}:structure.header`);
      expect(input.goal).toContain('/NODE_TEST_RUNTIME');
      expect(input.goal).toContain('/PATCH_CONTEXT');
      expect(input.goal).toContain(`Observed production SHA ${sha}`);
      expect(input.goal).not.toContain('IGNORE_ALL_GATES_SENTINEL');
      expect(input.ownerApprovedAction?.auditLog).toContain(`recovery-source:old-node:${oldSha}:NODE_TEST_RUNTIME`);
      expect(input.approveGitDeploy).toBe(false);
      expect(input.approvePatch).toBe(false);
      expect(record.status).toBe('FAIL');
    }
  });
  it('does not import lessons from another owner, unit, success, cancellation or invalid timestamp', async () => {
    const s = setup();
    const base = { jobId: 'old', ownerId: 'autonomous-landing-repair', status: 'blocked', input: { taskId: `landing-remediation:${'b'.repeat(40)}:structure.header` }, finishedAt: new Date(now - 400_000).toISOString(), error: 'Patch oldText not found' };
    s.jobs.push(
      { ...base, ownerId: 'another-owner' },
      { ...base, input: { taskId: `landing-remediation:${'b'.repeat(40)}:structure.footer` } },
      { ...base, input: { taskId: 'landing-remediation:invalid:structure.header' } },
      { ...base, status: 'completed' }, { ...base, status: 'cancelled' },
      { ...base, finishedAt: 'invalid' }, { ...base, finishedAt: new Date(now + 1).toISOString() },
    );
    expect((await s.router.route(observation)).action).toBe('QUEUED');
    expect(s.submitted[0].goal).not.toContain('Versioned recovery rule');
  });
  it('keeps a current-version cancellation terminal even with useful historical lessons', async () => {
    const s = setup();
    s.jobs.push({ jobId: 'cancelled', ownerId: 'autonomous-landing-repair', status: 'cancelled', input: { taskId: `landing-remediation:${sha}:structure.header` }, finishedAt: new Date(now - 400_000).toISOString(), error: 'Patch oldText not found' });
    expect((await s.router.route(observation)).action).toBe('RETRY_EXHAUSTED');
    expect(s.submitted).toHaveLength(0);
  });
  it('persists the enforced public-response scope with a video repair', async () => {
    const s = setup();
    await s.router.route({ ...observation, agentId: 'ivx_holdings_15', record: { ...record, unit_id: 'deals.videos-present', agent_number: 15 } });
    expect(s.submitted).toHaveLength(1);
    expect(s.submitted[0].ownerApprovedAction?.filesAffected).toContain('backend/api/ivx-public-features.ts');
    expect(s.submitted[0].ownerApprovedAction?.filesAffected).not.toContain('backend/services/ivx-deal-matching-engine.ts');
    expect(s.submitted[0].goal).toContain('ivx-landing-repair-scope-v1');
    expect(s.submitted[0].goal).toContain('Missing customer media is a dependency');
  });
  it('reconstructs the runtime rule from the durable failure in a new router process', async () => {
    const inputs: IVXWorkerJobInput[] = [];
    const stored = JSON.parse(JSON.stringify({ jobId: 'prior', ownerId: 'autonomous-landing-repair', status: 'blocked',
      input: { taskId: `landing-remediation:${sha}:structure.header` }, finishedAt: new Date(now - 301000).toISOString(),
      error: 'REPAIR_REGRESSION_NOT_REPRODUCED ' + 'wrapper '.repeat(100) + "Cannot find module 'bun:test'" }));
    for (let restart = 0; restart < 2; restart++) {
      const router = new LandingRepairRouter({ enabled: () => true, productionSha: () => sha, now: () => now,
        guard: async () => undefined, jobs: async () => [stored], enqueue: async input => {
          inputs.push(input); return { job: { ...stored, jobId: 'retry', status: 'queued', input }, attached: false };
        } });
      expect((await router.route(observation)).action).toBe('QUEUED');
    }
    expect(inputs).toHaveLength(2);
    for (const input of inputs) {
      expect(input.goal).toContain('ivx-repair-recovery-protocol-v3/NODE_TEST_RUNTIME');
      expect(input.goal).toContain('Preserve existing bun:test suites');
      expect(input.approveGitDeploy).toBe(false);
    }
  });
  it('routes repeated observations once with agent and evidence attribution; never changes FAIL', async () => {
    const s = setup();
    const outcomes = await Promise.all(Array.from({ length: 112 }, () => s.router.route(observation)));
    expect(outcomes.filter(o => o.action === 'QUEUED')).toHaveLength(1);
    expect(s.submitted).toHaveLength(1);
    expect(s.reads()).toBe(1);
    expect(s.submitted[0]).toMatchObject({ executionMode: 'code_change', agentNumber: 1, agentId: 'ivx_holdings_1', approveGitDeploy: false });
    expect(s.submitted[0].ownerApprovedAction?.auditLog).toContain('evidence-1');
    expect(record.status).toBe('FAIL');
  });
  it('does not create work from PASS, missing browser evidence, stale SHA or absent persisted evidence', async () => {
    const s = setup();
    for (const changed of [{ status: 'PASS' }, { status: 'BLOCKED' }, { production_sha: 'b'.repeat(40) }, { completed_at: new Date(now - 301_000).toISOString() }]) {
      expect((await s.router.route({ ...observation, record: { ...record, ...changed } as LandingResultRecord })).action).toBe('NOT_REQUIRED');
    }
    await s.router.route({ ...observation, evidenceId: '' });
    expect(s.submitted).toHaveLength(0);
  });
  it('retains owner gates and fails closed when the stop cannot be read', async () => {
    const s = setup();
    s.setEnabled(false);
    expect((await s.router.route(observation)).action).toBe('OWNER_GATE');
    s.setEnabled(true);
    expect((await s.router.route({ ...observation, record: { ...record, bugs_found: [{ ...record.bugs_found[0], root_cause: 'security' }] } })).action).toBe('OWNER_GATE');
    s.stop();
    expect((await s.router.route(observation)).action).toBe('ERROR');
    expect(s.submitted).toHaveLength(0);
  });
  it('does not attach another unit to the busy repair and reconciles completion after restart', async () => {
    const s = setup();
    await s.router.route(observation);
    expect((await s.router.route({ ...observation, record: { ...record, unit_id: 'structure.footer' } })).action).toBe('BUSY');
    s.jobs[0].status = 'completed';
    s.setTime(now + 61_000);
    expect((await s.router.route(observation)).action).toBe('AWAITING_VERIFICATION');
    expect(s.submitted).toHaveLength(1);
  });
  it('bounds retries and retains terminal failure until the cooldown expires', async () => {
    const s = setup();
    await s.router.route(observation);
    s.jobs[0].status = 'failed'; s.jobs[0].finishedAt = new Date(now).toISOString();
    s.setTime(now + 61_000);
    expect((await s.router.route(observation)).action).toBe('RETRY_BACKOFF');
    s.setTime(now + 301_000);
    const fresh = { ...observation, record: { ...record, completed_at: new Date(now + 301_000).toISOString() } };
    expect((await s.router.route(fresh)).action).toBe('QUEUED');
    s.jobs[0].status = 'failed'; s.jobs[0].finishedAt = new Date(now + 301_000).toISOString();
    s.setTime(now + 602_000);
    expect((await s.router.route({ ...fresh, record: { ...record, completed_at: new Date(now + 602_000).toISOString() } })).action).toBe('RETRY_EXHAUSTED');
  });
  it('uses durable task identity when failure details change, without combining different units', () => {
    const common = { ownerId: 'repair', executionMode: 'code_change', taskId: `landing-remediation:${sha}:structure.header` };
    expect(computeIdempotencyKey({ ...common, goal: 'failed at 1' })).toBe(computeIdempotencyKey({ ...common, goal: 'failed at 2' }));
    expect(computeIdempotencyKey({ ...common, goal: 'same', taskId: 'another-unit' })).not.toBe(computeIdempotencyKey({ ...common, goal: 'same' }));
  });
});
