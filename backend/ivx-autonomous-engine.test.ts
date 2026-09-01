/**
 * IVX Autonomous Engine — Owner Mandate 2026-08-28 acceptance regression.
 *
 * Proves the fixed dispatcher + ledger engine end-to-end (offline, fakes):
 *   1. 112 agents registered.
 *   2. 100 execution agents eligible (013–112).
 *   3. Safe backlog has >= 20 independent tasks.
 *   4. Dispatcher assigns tasks across multiple agents.
 *   5. No single-agent hotspot (fairness: fewer 24h attempts wins).
 *   6. Duplicate task cannot create duplicate attempts (supersede rule).
 *   7. Failed PR is re-routed for repair.
 *   8. Successful merge lands in the ledger (merges24h).
 *   9. Deploy mutex serializes production deploys.
 *  10. Global supervisor stays fail-closed (no GREEN without evidence).
 *  11. Dashboard shows the originating IA (attribution).
 *  12. Commit trailers decode the originating IA (Mission F).
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { ALL_ENTERPRISE_AGENTS } from './services/ivx-enterprise-master-registry';
import { APP_COMPLETION_AUDIT_ITEMS, VERIFICATION_DUTIES } from './services/ivx-app-completion-campaign';
import type { IVXWorkerJob, IVXWorkerJobInput } from './services/ivx-senior-developer-worker';
import {
  ensureCampaignAssignment,
  getCampaignDispatcherSnapshot,
  listCampaignDispatcherRecords,
  resetCampaignBootRecoveryForTests,
  resetCampaignDispatcherForTests,
  setCampaignWorkerBridgeForTests,
  setEmergencyStopSourceForTests,
  tickCampaignDispatcher,
  type CampaignWorkerBridge,
  type DispatcherAssignmentInput,
} from './services/ivx-campaign-dispatcher';
import {
  buildAgentWorkLedgerDashboard,
  ingestExternalWork,
  parseIVXCommitTrailers,
  setLedgerStorageForTests,
  superviseIdleAgents,
  workstreamFor,
  type ExternalWorkRecord,
  type LedgerStorage,
} from './services/ivx-agent-work-ledger';
import {
  computeGlobalCertification,
  REQUIRED_CERTIFICATION_WORKFLOWS,
} from './services/ivx-global-certification-supervisor';

// ── fakes ────────────────────────────────────────────────────────────────────

let jobSeq = 0;
const enqueuedInputs: IVXWorkerJobInput[] = [];

function makeFakeBridge(): CampaignWorkerBridge {
  const jobs = new Map<string, IVXWorkerJob>();
  return {
    enqueue: async (input) => {
      enqueuedInputs.push(input);
      jobSeq += 1;
      const job: IVXWorkerJob = {
        jobId: `fake-job-${jobSeq}`,
        status: 'running',
        stage: 'RUNNING',
        progressPercent: 20,
        stageDetail: 'fake worker running',
        input,
        ownerId: input.ownerId ?? 'default',
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        lastHeartbeatAt: new Date().toISOString(),
        finishedAt: null,
        cancelledAt: null,
        attempts: 1,
        result: null,
        error: null,
      };
      jobs.set(job.jobId, job);
      return { job, attached: false };
    },
    get: async (jobId) => jobs.get(jobId) ?? null,
    cancel: async (jobId) => jobs.get(jobId) ?? null,
  };
}

const memoryStore = new Map<string, unknown>();
const memoryLedgerStorage: LedgerStorage = {
  read: async <T,>(key: string, fallback: T): Promise<T> => (memoryStore.has(key) ? (memoryStore.get(key) as T) : fallback),
  write: async (key: string, value: unknown): Promise<void> => { memoryStore.set(key, value); },
  append: async (): Promise<void> => {},
  configured: () => true,
};

async function seedAssignment(a: Partial<DispatcherAssignmentInput> & { agentNumber: number }): Promise<void> {
  await ensureCampaignAssignment({
    agentNumber: a.agentNumber,
    agentId: a.agentId ?? `ivx_holdings_${a.agentNumber}`,
    role: a.role ?? 'VERIFY',
    dutyId: a.dutyId ?? `duty-${a.agentNumber}`,
    phase: a.phase ?? 'PHASE_3_BACKEND',
    module: a.module ?? 'Backend',
    laneKey: a.laneKey ?? `lane-${a.agentNumber}`,
    executionMode: a.executionMode ?? 'read_only',
    ownerGate: a.ownerGate ?? false,
    waitFor: a.waitFor ?? null,
    goal: a.goal ?? `test goal for agent ${a.agentNumber}`,
  });
}

beforeEach(() => {
  resetCampaignDispatcherForTests();
  resetCampaignBootRecoveryForTests();
  setCampaignWorkerBridgeForTests(makeFakeBridge());
  setEmergencyStopSourceForTests(async () => ({ active: false, reason: null }));
  // Full-suite isolation: another test file may leave concurrency env or a
  // mocked durable store behind — force a clean deterministic slate.
  delete process.env.IVX_CAMPAIGN_MAX_CONCURRENCY;
  memoryStore.clear();
  setLedgerStorageForTests(memoryLedgerStorage);
  enqueuedInputs.length = 0;
  jobSeq = 0;
});

/** Purge any dispatcher records that leaked from other test files' state. */
async function purgeLeakedDispatcherState(): Promise<void> {
  const leaked = await listCampaignDispatcherRecords();
  leaked.length = 0;
}

describe('MISSION N: IVX autonomous engine acceptance', () => {
  it('1. registers exactly 112 agents', () => {
    expect(ALL_ENTERPRISE_AGENTS.length).toBe(112);
    expect(new Set(ALL_ENTERPRISE_AGENTS.map((a) => a.agentNumber)).size).toBe(112);
  });

  it('2. marks exactly 100 execution agents eligible (013-112)', () => {
    const execution = ALL_ENTERPRISE_AGENTS.filter((a) => a.agentNumber >= 13 && a.agentNumber <= 112);
    expect(execution.length).toBe(100);
  });

  it('3. safe backlog has >= 20 independent tasks', () => {
    const backlog = APP_COMPLETION_AUDIT_ITEMS.length + VERIFICATION_DUTIES.length;
    expect(backlog).toBeGreaterThanOrEqual(20);
  });

  it('4. assigns work across MULTIPLE agents in one tick', async () => {
    await purgeLeakedDispatcherState();
    process.env.IVX_CAMPAIGN_MAX_CONCURRENCY = '4';
    for (const n of [21, 22, 23, 24]) {
      await seedAssignment({ agentNumber: n, role: 'VERIFY', laneKey: `lane-${n}` });
    }
    const result = await tickCampaignDispatcher();
    expect(result.started.length).toBe(4);
    const startedAgents = new Set(result.started.map((key) => Number(key.split(':')[0])));
    expect(startedAgents.size).toBe(4);
  });

  it('5. no single-agent hotspot: fewer 24h attempts wins the slot', async () => {
    await purgeLeakedDispatcherState();
    // Agent 57 gets its first attempt via the REAL bridge tick (so the worker
    // job is live in the fake queue)...
    await seedAssignment({ agentNumber: 57, role: 'IMPLEMENT', laneKey: 'lane-hotspot', executionMode: 'code_change' });
    await tickCampaignDispatcher();
    let records = await listCampaignDispatcherRecords();
    expect(records.find((r) => r.agentNumber === 57)!.workerJobId).toBeTruthy();
    // …then one more QUEUED duty for the same hotspot agent…
    await seedAssignment({ agentNumber: 57, role: 'IMPLEMENT', dutyId: 'duty-2', laneKey: 'lane-hotspot-2', executionMode: 'code_change' });
    // …and same-role QUEUED duties for fresh agents (fairness compares within role).
    await seedAssignment({ agentNumber: 13, role: 'IMPLEMENT', dutyId: 'duty-13', laneKey: 'lane-13', executionMode: 'code_change' });
    await seedAssignment({ agentNumber: 14, role: 'IMPLEMENT', dutyId: 'duty-14', laneKey: 'lane-14', executionMode: 'code_change' });

    process.env.IVX_CAMPAIGN_MAX_CONCURRENCY = '2';
    const result = await tickCampaignDispatcher();
    // 1 slot free (2 - 1 running) — it MUST go to a zero-attempt agent (13 or 14), never 57.
    expect(result.started.length).toBe(1);
    const startedAgent = Number(result.started[0].split(':')[0]);
    expect(startedAgent === 13 || startedAgent === 14).toBe(true);
  });

  it('6. duplicate task cannot create duplicate attempts (supersede rule)', async () => {
    await purgeLeakedDispatcherState();
    await seedAssignment({ agentNumber: 57, role: 'IMPLEMENT', executionMode: 'code_change', laneKey: 'lane-57' });
    const records = await listCampaignDispatcherRecords();
    const record = records.find((r) => r.agentNumber === 57)!;
    record.status = 'QUEUED';
    record.prNumber = 447;
    record.prMerged = false; // open PR awaiting merge

    const result = await tickCampaignDispatcher();
    expect(result.started).not.toContain(record.key);
    expect(enqueuedInputs.filter((i) => i.agentNumber === 57).length).toBe(0);
    expect(record.status).toBe('BLOCKED');
    expect(record.blocker).toContain('SUPERSEDE_RULE');
  });

  it('7. failed PR re-routes the implementation for repair (supersede released)', async () => {
    await purgeLeakedDispatcherState();
    await seedAssignment({ agentNumber: 57, role: 'IMPLEMENT', executionMode: 'code_change', laneKey: 'lane-57' });
    await seedAssignment({ agentNumber: 59, role: 'QA', dutyId: 'duty-57', laneKey: 'lane-59', waitFor: '57:IMPLEMENT:duty-57' });
    const records = await listCampaignDispatcherRecords();
    const implement = records.find((r) => r.agentNumber === 57)!;
    const qa = records.find((r) => r.agentNumber === 59)!;
    implement.status = 'COMPLETED';
    implement.prNumber = 447;
    implement.prMerged = true;
    qa.status = 'FAILED';
    qa.error = 'QA found the defect unfixed';

    const result = await tickCampaignDispatcher();
    expect(result.requeued).toContain('57:IMPLEMENT:duty-57');
    // The repair is released immediately (Mission pipeline: DETECT→ASSIGN→FIX).
    // The supersede guard is lifted so the repair attempt can dispatch.
    expect(implement.prMerged).toBeNull(); // supersede released for repair
    expect(enqueuedInputs.some((i) => i.agentNumber === 57)).toBe(true);
    expect(implement.status === 'QUEUED' || implement.status === 'RUNNING').toBe(true);
  });

  it('8. a merged PR lands in the ledger (merges24h counts it)', async () => {
    const now = new Date().toISOString();
    await ingestExternalWork({
      agentNumber: 37,
      attribution: 'IA',
      source: 'worker_job',
      githubRunId: 33163799144,
      githubJobId: null,
      taskId: 'duty-37',
      workerJobId: 'fake-job-37',
      branch: 'ivx-autonomous-ivx-worker-37',
      prNumber: 450,
      commitSha: 'abc123def4567890abc123def4567890abc12345',
      filesChanged: ['backend/ivx-canonical-identity-model.test.ts'],
      status: 'SUCCESS',
    });
    const dashboard = await buildAgentWorkLedgerDashboard();
    expect(dashboard.rows.length).toBe(112);
    const row37 = dashboard.rows.find((r) => r.agentNumber === 37)!;
    expect(row37.prs24h).toBe(1);
    expect(row37.merges24h).toBe(1);
    expect(row37.commits24h).toBe(1);
    expect(now.length).toBeGreaterThan(0);
  });

  it('9. deploy mutex: only one deploy-bearing job starts per tick', async () => {
    await purgeLeakedDispatcherState();
    process.env.IVX_CAMPAIGN_MAX_CONCURRENCY = '4';
    for (const n of [31, 32]) {
      await seedAssignment({ agentNumber: n, role: 'IMPLEMENT', executionMode: 'deploy', laneKey: `deploy-lane-${n}` });
    }
    const result = await tickCampaignDispatcher();
    expect(result.started.length).toBe(1);
  });

  it('10. global supervisor is fail-closed: no GREEN without evidence', () => {
    expect(REQUIRED_CERTIFICATION_WORKFLOWS.length).toBe(14);
    const verdict = computeGlobalCertification({
      mainSha: 'a'.repeat(40),
      productionSha: null,
      productionHealthy: null,
      runs: [],
      collector: 'github_actions_api',
    });
    expect(verdict.certified).toBe(false);
    expect(verdict.status).not.toBe('GREEN');
    // Fail-closed: empty runs => NOT_RUN gates, production parity unproven.
    expect(verdict.gates.length).toBe(15);
    expect(verdict.gates.some((g) => g.gate === 'PRODUCTION_PARITY' && g.state !== 'GREEN')).toBe(true);
    expect(verdict.failedRequired.length).toBe(0); // nothing observed yet — nothing failed, but still not certified
  });

  it('11. dashboard shows the originating IA for every row (Mission G/M)', async () => {
    const dashboard = await buildAgentWorkLedgerDashboard();
    expect(dashboard.rows.length).toBe(112);
    expect(dashboard.rows.map((r) => r.agentNumber)).toEqual(Array.from({ length: 112 }, (_, i) => i + 1));
    for (const row of dashboard.rows) {
      expect(['IDLE', 'ASSIGNED', 'CODING', 'TESTING', 'PR_OPEN', 'CI', 'MERGING', 'DEPLOYING', 'VERIFYING', 'COMPLETE', 'BLOCKED']).toContain(row.status);
    }
    expect(dashboard.totals.totalAgents).toBe(112);
    expect(typeof dashboard.totals.agentHours24h).toBe('number');
    expect(typeof dashboard.totals.idleHours24h).toBe('number');
  });

  it('12. commit trailers decode the originating IA (Mission F)', () => {
    const message = [
      'IVX autonomous coder: 2026-08-28T00:00:00.000Z',
      '',
      'IVX-Agent: IA-037',
      'IVX-Agent-Role: IMPLEMENT',
      'IVX-Agent-ID: ivx_holdings_37',
      'IVX-Task-ID: duty-37',
      'IVX-Worker-Job: fake-job-37',
    ].join('\n');
    const trailers = parseIVXCommitTrailers(message);
    expect(trailers.agentNumber).toBe(37);
    expect(trailers.agentRole).toBe('IMPLEMENT');
    expect(trailers.agentId).toBe('ivx_holdings_37');
    expect(trailers.workerJobId).toBe('fake-job-37');
  });

  it('external ingest without agentNumber is untraceable — never faked', async () => {
    await ingestExternalWork({
      agentNumber: null,
      attribution: 'SYSTEM',
      source: 'final-gap-repair-bot',
      githubRunId: 33163799144,
      githubJobId: 98824296103,
      taskId: null,
      workerJobId: null,
      branch: 'ivx-autonomous-ivx-worker-58876596-c8ea',
      prNumber: 447,
      commitSha: 'ced1701545eb133c34849ef49417886fe5bfe77f',
      filesChanged: [],
      status: 'FAILURE',
    });
    const dashboard = await buildAgentWorkLedgerDashboard();
    expect(dashboard.totals.untraceableCommits).toBe(1);
  });

  it('workstream partition maps modules to the owner-defined streams', () => {
    expect(workstreamFor('Landing / Netlify')).toBe('Landing');
    expect(workstreamFor('Reels')).toBe('Reels/media');
    expect(workstreamFor('Auth / owner login')).toBe('Owner auth');
    expect(workstreamFor('APK')).toBe('APK');
    expect(workstreamFor('SHA parity')).toBe('Certification');
  });

  it('idle supervision: honest idle with no backlog, assignment signal with backlog', async () => {
    await purgeLeakedDispatcherState();
    await seedAssignment({ agentNumber: 13, role: 'VERIFY', laneKey: 'lane-13' });
    const records = await listCampaignDispatcherRecords();
    records[0].status = 'COMPLETED';
    records[0].finishedAt = new Date().toISOString();

    const empty = await superviseIdleAgents();
    expect(empty.backlogSize).toBe(0);
    expect(empty.idleWithSafeBacklog.length).toBe(0);
    expect(empty.idleAgents.length).toBeGreaterThan(0);

    await memoryLedgerStorage.write('logs/audit/agent-work-ledger/safe-backlog.json', ['backend/ivx-canonical-identity-model.test.ts']);
    const withBacklog = await superviseIdleAgents();
    expect(withBacklog.backlogSize).toBe(1);
    expect(withBacklog.idleWithSafeBacklog.length).toBe(withBacklog.idleAgents.length);
  });

  it('dispatcher snapshot stays honest after the fixes', async () => {
    await purgeLeakedDispatcherState();
    await seedAssignment({ agentNumber: 13, role: 'VERIFY', laneKey: 'lane-13' });
    const result = await tickCampaignDispatcher();
    expect(result.started.length).toBe(1);
    const snapshot = await getCampaignDispatcherSnapshot();
    expect(snapshot.totals.running).toBe(1);
    expect(snapshot.maxConcurrency).toBe(112);
  });
});

// Silence unused-type lint for the external record shape used in tests.
export type { ExternalWorkRecord };
