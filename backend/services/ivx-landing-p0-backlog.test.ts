/**
 * Landing P0 backlog + continuous worker-pool lifecycle — fail-closed tests.
 *
 * Runs against the isolated file store (Supabase never touched) exactly like the
 * engineering-cycle ownership tests.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { rename, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  getAllTasks,
  getTaskById,
  leaseNextTask,
  recoverStrandedTasksInPlace,
  transitionTaskState,
  type Task,
} from './ivx-autonomous-task-engine';
import {
  aggregateLandingStatus,
  assignAgentForUnit,
  decodeLandingResult,
  encodeLandingResult,
  LANDING_P0_LANES,
  LANDING_P0_PREFIX,
  LANDING_P0_UNITS,
  laneFor,
  landingRepairKey,
  landingTaskKey,
  parseLandingTaskKey,
  readOwnerPriority,
  seedLandingP0Backlog,
  type LandingResultRecord,
} from './ivx-landing-p0-backlog';
import { __resetLandingExecutorCachesForTests, executeLandingUnit, scanForSecrets } from './ivx-landing-p0-executor';
import { classifyContinuityResult } from './ivx-autonomous-runtime-enforcer';

const STORE_FILE = path.join(process.cwd(), 'logs', 'audit', 'task-engine', 'tasks.json');
const BACKUP_FILE = `${STORE_FILE}.landing-p0-test-backup`;
const SHA = 'landing-p0-test-sha-0001';

beforeAll(async () => {
  try { await rename(STORE_FILE, BACKUP_FILE); } catch { /* no prior store */ }
});

afterAll(async () => {
  try { await rm(STORE_FILE, { force: true }); } catch { /* ignore */ }
  try { await rename(BACKUP_FILE, STORE_FILE); } catch { /* keep test store */ }
});

beforeEach(() => {
  __resetLandingExecutorCachesForTests();
});

function makeTask(overrides: Partial<Task>): Task {
  const now = new Date().toISOString();
  return {
    taskId: overrides.taskId ?? `task_${Math.random().toString(36).slice(2, 10)}`,
    objectiveId: null,
    parentTaskId: null,
    title: 'synthetic',
    description: 'synthetic',
    taskType: 'qa',
    state: 'QUEUED',
    idempotencyKey: `synthetic:${Math.random()}`,
    assignedAgentNumber: null,
    assignedEngine: null,
    priority: 'critical',
    acceptanceCriteria: [],
    dependencies: [],
    executionOrder: 0,
    leaseHolder: null,
    leaseExpiresAt: null,
    lastHeartbeatAt: null,
    retryCount: 0,
    maxRetries: 2,
    error: null,
    blocker: null,
    evidence: [],
    filesChanged: [],
    recordsChanged: 0,
    commitSha: null,
    deploymentId: null,
    ...overrides,
  } as Task;
}

describe('Landing P0 partition (owner-mandated lanes)', () => {
  it('defines >= 112 distinct atomic units with unique ids', () => {
    const ids = LANDING_P0_UNITS.map((u) => u.unitId);
    expect(ids.length).toBeGreaterThanOrEqual(112);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('lanes cover IA-001..IA-112 exactly once, in the owner-specified ranges', () => {
    const covered = new Set<number>();
    for (const lane of LANDING_P0_LANES) {
      for (let n = lane.from; n <= lane.to; n += 1) { expect(covered.has(n)).toBe(false); covered.add(n); }
    }
    expect([...covered].sort((a, b) => a - b)).toEqual(Array.from({ length: 112 }, (_, i) => i + 1));
    expect(laneFor('structure')).toMatchObject({ from: 1, to: 12 });
    expect(laneFor('e2e')).toMatchObject({ from: 109, to: 112 });
  });

  it('every unit is assigned inside its lane and every one of the 112 agents receives at least one unit', () => {
    const assigned = new Set<number>();
    for (const unit of LANDING_P0_UNITS) {
      const agent = assignAgentForUnit(unit);
      const lane = laneFor(unit.lane);
      expect(agent).toBeGreaterThanOrEqual(lane.from);
      expect(agent).toBeLessThanOrEqual(lane.to);
      assigned.add(agent);
    }
    expect(assigned.size).toBe(112);
  });

  it('task keys bind SHA + unit and round-trip (audit + repair)', () => {
    expect(parseLandingTaskKey(landingTaskKey(SHA, 'deals.order'))).toEqual({ sha: SHA, unitId: 'deals.order', repair: false, defectCode: null });
    expect(parseLandingTaskKey(landingRepairKey(SHA, 'deals.order', 'deals.order'))).toEqual({ sha: SHA, unitId: 'deals.order', repair: true, defectCode: 'deals.order' });
    expect(parseLandingTaskKey(`module-audit:${SHA}:ivx_holdings_1:1:backend/api/x.ts`)).toBeNull();
  });

  it('mission is OFF in tests unless forced on via env (no network)', async () => {
    const previous = process.env.IVX_LANDING_P0_MISSION;
    delete process.env.IVX_LANDING_P0_MISSION;
    expect((await readOwnerPriority()).active).toBe(false);
    process.env.IVX_LANDING_P0_MISSION = 'on';
    const forced = await readOwnerPriority();
    expect(forced).toMatchObject({ active: true, mission: 'landing', source: 'env' });
    if (previous === undefined) delete process.env.IVX_LANDING_P0_MISSION; else process.env.IVX_LANDING_P0_MISSION = previous;
  });
});

describe('Landing P0 seeding + continuous claim lifecycle (isolated file store)', () => {
  it('seeds one real task per unit for the SHA, idempotently, with the certificate gated on every other unit', async () => {
    const first = await seedLandingP0Backlog(SHA);
    expect(first.error).toBeNull();
    expect(first.created).toBe(LANDING_P0_UNITS.length);
    const second = await seedLandingP0Backlog(SHA);
    expect(second.created).toBe(0);
    expect(second.existing).toBe(LANDING_P0_UNITS.length);

    const tasks = (await getAllTasks()).filter((t) => t.idempotencyKey.startsWith(`${LANDING_P0_PREFIX}${SHA}:`));
    expect(tasks.length).toBe(LANDING_P0_UNITS.length);
    expect(tasks.every((t) => t.state === 'QUEUED' && t.priority === 'critical' && t.assignedAgentNumber !== null)).toBe(true);
    const certificate = tasks.find((t) => t.idempotencyKey.endsWith(':e2e.certificate'));
    expect(certificate?.dependencies.length).toBe(LANDING_P0_UNITS.length - 1);
  });

  it('IA-112 (certificate owner) cannot lease the gated certificate, but steals eligible Landing work from another lane', async () => {
    const own = await leaseNextTask('agent:ivx_holdings_112', 112);
    expect(own.task).toBeNull();

    const stolen = await leaseNextTask('agent:ivx_holdings_112', 112, { stealPrefix: LANDING_P0_PREFIX });
    expect(stolen.ok).toBe(true);
    expect(stolen.task).not.toBeNull();
    expect(stolen.task?.idempotencyKey.startsWith(LANDING_P0_PREFIX)).toBe(true);
    expect(stolen.task?.assignedAgentNumber).not.toBe(112);
    expect(stolen.task?.state).toBe('LEASED');
    const stored = await getTaskById(stolen.task!.taskId);
    expect(stored?.leaseHolder).toBe('agent:ivx_holdings_112');

    // The same task can never be leased twice (atomic lease under the mutation lock).
    const again = await leaseNextTask('agent:ivx_holdings_1', 1, { stealPrefix: LANDING_P0_PREFIX });
    expect(again.task?.taskId).not.toBe(stolen.task?.taskId);
  });

  it('module-audit ownership is unchanged: without stealPrefix an agent only sees its own lane', async () => {
    const lane13 = await leaseNextTask('agent:ivx_holdings_13', 13);
    expect(lane13.task).not.toBeNull();
    expect(lane13.task?.assignedAgentNumber).toBe(13);
    // Release for other tests.
    await transitionTaskState(lane13.task!.taskId, 'QUEUED');
  });
});

describe('Stranded task recovery (redeploy/crash survivors)', () => {
  it('requeues STALE, heartbeat-less RUNNING and abandoned mid-completion tasks; exhausts retries fail-closed', () => {
    const now = Date.now();
    const old = new Date(now - 60 * 60 * 1000).toISOString();
    const stale = makeTask({ taskId: 'stale', state: 'STALE', updatedAt: old } as Partial<Task>);
    const running = makeTask({ taskId: 'running', state: 'RUNNING', lastHeartbeatAt: old, leaseHolder: 'dead' });
    const execDone = makeTask({ taskId: 'exec', state: 'EXECUTION_COMPLETED', updatedAt: old } as Partial<Task>);
    const freshExec = makeTask({ taskId: 'fresh-exec', state: 'EXECUTION_COMPLETED', updatedAt: new Date(now - 1000).toISOString() } as Partial<Task>);
    const exhausted = makeTask({ taskId: 'exhausted', state: 'STALE', retryCount: 2, maxRetries: 2, updatedAt: old } as Partial<Task>);
    const exhaustedExec = makeTask({ taskId: 'exhausted-exec', state: 'EXECUTION_COMPLETED', retryCount: 2, maxRetries: 2, updatedAt: old } as Partial<Task>);
    const tasks = [stale, running, execDone, freshExec, exhausted, exhaustedExec];

    const recovery = recoverStrandedTasksInPlace(tasks, now);
    expect(recovery.requeued.sort()).toEqual(['exec', 'running', 'stale']);
    expect(recovery.expired).toEqual(['exhausted']);
    expect(recovery.failed).toEqual(['exhausted-exec']);
    expect(stale.state).toBe('QUEUED');
    expect(stale.retryCount).toBe(1);
    expect(running.state).toBe('QUEUED');
    expect(running.leaseHolder).toBeNull();
    expect(execDone.state).toBe('QUEUED');
    expect(freshExec.state).toBe('EXECUTION_COMPLETED');
    expect(exhausted.state).toBe('EXPIRED');
    expect(exhaustedExec.state).toBe('FAILED');
  });
});

describe('Truthful continuity classification', () => {
  it('never counts idle or ALREADY_VERIFIED reruns as completed work', () => {
    expect(classifyContinuityResult({ ok: true, action: 'NO_TASK_AVAILABLE', taskId: null, states: [] })).toBe('idle');
    expect(classifyContinuityResult({ ok: true, action: 'TASK_COMPLETED', taskId: 'task_1', states: ['ALREADY_VERIFIED'] })).toBe('idle');
    expect(classifyContinuityResult({ ok: true, action: 'TASK_COMPLETED', taskId: 'task_1', states: ['LEASED', 'RUNNING', 'VERIFIED'] })).toBe('completed');
    expect(classifyContinuityResult({ ok: true, action: 'TASK_BLOCKED', taskId: 'task_1', states: ['LEASED', 'RUNNING', 'BLOCKED'] })).toBe('blocked');
    expect(classifyContinuityResult({ ok: true, action: 'TASK_COMPLETED', taskId: null, states: [] })).toBe('failed');
    expect(classifyContinuityResult({ ok: false, action: 'CYCLE_ERROR', taskId: null, states: [] })).toBe('failed');
  });
});

describe('Status aggregation (owner report)', () => {
  function record(unitId: string, status: LandingResultRecord['status'], bugs: LandingResultRecord['bugs_found'] = []): LandingResultRecord {
    const now = new Date().toISOString();
    return { v: 1, unit_id: unitId, agent_number: 1, status, started_at: now, completed_at: now, productive_seconds: 90, production_sha: SHA, api_checks: 2, browser_checks: 0, bugs_found: bugs, fixes_applied: [], blocked_reason: status === 'BLOCKED' ? 'no CI run' : null, evidence: [], repair: false };
  }
  function evidence(rec: LandingResultRecord) {
    return { evidenceId: `ev_${rec.unit_id}`, evidenceType: 'production_verification' as const, source: rec.unit_id, contentHash: 'h0', summary: encodeLandingResult(rec), createdAt: rec.completed_at, commitSha: null, deploymentId: null };
  }

  it('decodes its own evidence and reports counts, bugs, gates and certificate fail-closed', () => {
    const passRec = record('api.health', 'PASS');
    const failRec = record('deals.order', 'FAIL', [{ code: 'deals.order', severity: 'P1', detail: 'order wrong', root_cause: 'content', remediation: 'reorder' }]);
    const blockedRec = record('e2e.production-browser-suite', 'BLOCKED');
    expect(decodeLandingResult(encodeLandingResult(passRec))).toEqual(passRec);
    const tasks: Task[] = [
      makeTask({ taskId: 'a', idempotencyKey: landingTaskKey(SHA, 'api.health'), state: 'VERIFIED', assignedAgentNumber: 73, evidence: [evidence(passRec)], updatedAt: passRec.completed_at } as Partial<Task>),
      makeTask({ taskId: 'b', idempotencyKey: landingTaskKey(SHA, 'deals.order'), state: 'VERIFIED', assignedAgentNumber: 19, evidence: [evidence(failRec)], updatedAt: failRec.completed_at } as Partial<Task>),
      makeTask({ taskId: 'c', idempotencyKey: landingTaskKey(SHA, 'e2e.production-browser-suite'), state: 'BLOCKED', assignedAgentNumber: 111, blocker: 'no CI run', evidence: [evidence(blockedRec)], updatedAt: blockedRec.completed_at } as Partial<Task>),
      makeTask({ taskId: 'd', idempotencyKey: landingTaskKey(SHA, 'reels.unique'), state: 'RUNNING', assignedAgentNumber: 39, leaseHolder: 'agent:ivx_holdings_39', lastHeartbeatAt: new Date().toISOString() }),
      makeTask({ taskId: 'e', idempotencyKey: landingTaskKey('other-sha', 'api.health'), state: 'VERIFIED' }),
    ];
    const status = aggregateLandingStatus({ tasks, productionSha: SHA, mainSha: SHA, registeredAgents: 112, failedAgents: 0, nowMs: Date.now(), mission: { active: true, priority: 'P0-OWNER', mission: 'landing', source: 'env', fetchedAt: new Date().toISOString() } });
    expect(status.backlog).toMatchObject({ total: 4, completed: 2, active: 1, blocked: 1, remaining: 2 });
    expect(status.agents).toMatchObject({ registered: 112, workingNow: 1, blocked: 1, failed: 0, idle: 110 });
    expect(status.hours24h.productive).toBeCloseTo(0.08, 2);
    expect(status.hours24h.idle).toBeNull();
    expect(status.bugs).toMatchObject({ found: 1, open: 1, p0Open: 0, p1Open: 1 });
    expect(status.qa.productionE2E).toBe('PENDING');
    expect(status.certificate).toBe('FAIL');
    expect(status.sha.match).toBe(true);
    expect(status.topBlockers[0]).toContain('e2e.production-browser-suite');
  });
});

describe('Executor produces real evidence from live responses (injected fetch)', () => {
  const landingHtml = `<!doctype html><html lang="en"><head><title>IVX</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
    <body><nav><a href="/deals">Deals</a><a href="/reels">Reels</a><a href="/register">Register</a></nav><main><h1>Invest with IVX</h1>
    <section></section><section></section><section></section><button aria-label="Open menu"></button><button>Sign in</button>
    <img src="/a.jpg" alt="a"><img src="/b.jpg" alt="b" loading="lazy"></main><footer>IVX</footer></body></html>`;
  const fakeFetch: typeof fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.endsWith('ivxholding.com/')) return new Response(landingHtml, { status: 200, headers: { 'content-type': 'text/html' } });
    if (url.endsWith('/api/deals')) return new Response(JSON.stringify({ deals: [{ id: 'perez', title: 'Perez Residence', price: 950000, city: 'Miami', images: ['https://cdn.example/perez.jpg'] }, { id: 'casa', title: 'Casa Rosario', targetRaise: 500000, city: 'Tampa', images: ['https://cdn.example/casa.jpg'] }, { id: 'jax', title: 'Jacksonville Duplex', irr: 12, city: 'Jacksonville', images: ['https://cdn.example/jax.jpg'] }], count: 3 }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  const ctx = { agentId: 'ivx_holdings_1', agentNumber: 1, taskId: 'task_test', sourceSha: SHA, productionSha: SHA, repair: false };

  it('PASSes real HTML assertions and records productive seconds + api checks', async () => {
    const unit = LANDING_P0_UNITS.find((u) => u.unitId === 'structure.hero')!;
    const { record, full } = await executeLandingUnit(unit, ctx, { fetchImpl: fakeFetch });
    expect(record.status).toBe('PASS');
    expect(full.api_checks.length).toBeGreaterThan(0);
    expect(full.schema).toBe('ivx-landing-p0-evidence-v1');
    expect(full.commit_sha).toBeNull();
  });

  it('FAILs with a defect carrying the unit severity when markup is missing', async () => {
    const unit = LANDING_P0_UNITS.find((u) => u.unitId === 'structure.header')!;
    const { record } = await executeLandingUnit(unit, ctx, { fetchImpl: fakeFetch });
    expect(record.status).toBe('FAIL');
    expect(record.bugs_found[0]).toMatchObject({ severity: 'P2', root_cause: 'content' });
    expect(record.bugs_found[0].detail).toContain('<header>');
  });

  it('verifies deal ordering from the live deals API', async () => {
    const unit = LANDING_P0_UNITS.find((u) => u.unitId === 'deals.order')!;
    const { record } = await executeLandingUnit(unit, ctx, { fetchImpl: fakeFetch });
    expect(record.status).toBe('PASS');
  });

  it('BLOCKS (never PASSes) browser-only units when no CI evidence can be read', async () => {
    const previous = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    const unit = LANDING_P0_UNITS.find((u) => u.unitId === 'reels.production-render-browser')!;
    const { record } = await executeLandingUnit(unit, ctx, { fetchImpl: fakeFetch });
    expect(record.status).toBe('BLOCKED');
    expect(record.blocked_reason).toContain('GITHUB_TOKEN');
    if (previous !== undefined) process.env.GITHUB_TOKEN = previous;
  });

  it('secret scan flags service_role JWTs and provider keys but not a public anon JWT', () => {
    const anon = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: 'anon', iss: 'supabase' })).toString('base64url')}.signaturesignature`;
    const service = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: 'service_role', iss: 'supabase' })).toString('base64url')}.signaturesignature`;
    expect(scanForSecrets(`window.__cfg={key:"${anon}"}`)).toEqual([]);
    expect(scanForSecrets(`window.__cfg={key:"${service}"}`)).toContain('service_role_jwt');
    expect(scanForSecrets('AI_GATEWAY_API_KEY=vck_abcdefghijklmnop')).toContain('vercel_gateway_key');
  });
});
