/**
 * IVX 112-Agent Campaign Dispatcher — concurrency & honesty test suite.
 *
 * Covers the 24 mandated scenarios (Phase 8): bounded concurrency, lane
 * serialization, duplicate prevention, idempotency, failure/retry, handoffs,
 * owner controls, emergency stop, stale recovery, restart recovery, heartbeat,
 * deploy mutex, owner gates, and dashboard-count integrity.
 *
 * Uses a fake worker bridge — no real LLM/git in unit tests. The real bridge
 * is exercised by the live runtime and CI.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { IVXWorkerJob, IVXWorkerJobInput } from './services/ivx-senior-developer-worker';
import {
  CampaignWorkerBridge,
  DispatcherAssignmentInput,
  MAX_CAMPAIGN_RETRIES,
  campaignDispatcherControl,
  ensureCampaignAssignment,
  getCampaignDispatcherSnapshot,
  listCampaignDispatcherRecords,
  resetCampaignBootRecoveryForTests,
  resetCampaignDispatcherForTests,
  runCampaignBootRecovery,
  setCampaignWorkerBridgeForTests,
  setEmergencyStopSourceForTests,
  tickCampaignDispatcher,
} from './services/ivx-campaign-dispatcher';
import {
  buildAppCompletionCampaign,
  buildDispatcherAssignmentInputs,
} from './services/ivx-app-completion-campaign';

// ── Fake worker bridge ───────────────────────────────────────────────────────

type FakeJob = {
  jobId: string;
  status: string;
  error: string | null;
  result: Record<string, unknown> | null;
  lastHeartbeatAt: string;
  finishedAt: string | null;
};

function makeFakeBridge() {
  const jobs = new Map<string, FakeJob>();
  const enqueued: Array<{ jobId: string; input: IVXWorkerJobInput }> = [];
  const cancelled: string[] = [];
  let nextId = 1;
  const bridge: CampaignWorkerBridge = {
    enqueue: async (input) => {
      const job: FakeJob = {
        jobId: `fake-job-${nextId}`,
        status: 'running',
        error: null,
        result: null,
        lastHeartbeatAt: new Date().toISOString(),
        finishedAt: null,
      };
      nextId += 1;
      jobs.set(job.jobId, job);
      enqueued.push({ jobId: job.jobId, input });
      return { job: job as unknown as IVXWorkerJob, attached: false };
    },
    get: async (jobId) => (jobs.get(jobId) as unknown as IVXWorkerJob) ?? null,
    cancel: async (jobId) => {
      cancelled.push(jobId);
      const job = jobs.get(jobId);
      if (job) {
        job.status = 'cancelled';
        job.finishedAt = new Date().toISOString();
      }
      return (job as unknown as IVXWorkerJob) ?? null;
    },
  };
  const completeJob = (jobId: string, result: Record<string, unknown> = {}) => {
    const job = jobs.get(jobId);
    if (!job) throw new Error(`unknown fake job ${jobId}`);
    job.status = 'completed';
    job.result = {
      changedFiles: [], testsRun: true, testsPassed: true, typecheckPassed: true,
      commitSha: null, prNumber: null, prUrl: null, deployId: null, healthOk: null,
      ...result,
    };
    job.finishedAt = new Date().toISOString();
  };
  const failJob = (jobId: string, error = 'simulated worker failure') => {
    const job = jobs.get(jobId);
    if (!job) throw new Error(`unknown fake job ${jobId}`);
    job.status = 'failed';
    job.error = error;
    job.finishedAt = new Date().toISOString();
  };
  return { bridge, jobs, enqueued, cancelled, completeJob, failJob };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function assignment(overrides: Partial<DispatcherAssignmentInput> = {}): DispatcherAssignmentInput {
  return {
    agentNumber: 1,
    agentId: 'ivx_holdings_1',
    role: 'IMPLEMENT',
    dutyId: 'duty-1',
    phase: 'PHASE_3_BACKEND',
    module: 'Test module',
    laneKey: 'lane-a',
    executionMode: 'code_change',
    ownerGate: false,
    waitFor: null,
    goal: 'test goal',
    ...overrides,
  };
}

let fake: ReturnType<typeof makeFakeBridge>;
let savedConcurrency: string | undefined;

beforeEach(() => {
  fake = makeFakeBridge();
  resetCampaignDispatcherForTests();
  setCampaignWorkerBridgeForTests(fake.bridge);
  setEmergencyStopSourceForTests(null);
  savedConcurrency = process.env.IVX_CAMPAIGN_MAX_CONCURRENCY;
});

afterEach(() => {
  setCampaignWorkerBridgeForTests(null);
  setEmergencyStopSourceForTests(null);
  resetCampaignDispatcherForTests();
  if (savedConcurrency === undefined) delete process.env.IVX_CAMPAIGN_MAX_CONCURRENCY;
  else process.env.IVX_CAMPAIGN_MAX_CONCURRENCY = savedConcurrency;
});

async function records(): Promise<ReturnType<typeof listCampaignDispatcherRecords> extends Promise<infer T> ? T : never> {
  return listCampaignDispatcherRecords();
}

async function findRecord(key: string) {
  const all = await records();
  return all.find((r) => r.key === key) ?? null;
}

describe('IVX campaign dispatcher — bounded concurrency (Phase 8 scenarios 1-3)', () => {
  it('1. runs concurrent independent jobs in different lanes', async () => {
    await ensureCampaignAssignment(assignment({ agentNumber: 1, dutyId: 'd1', laneKey: 'lane-a' }));
    await ensureCampaignAssignment(assignment({ agentNumber: 2, dutyId: 'd2', laneKey: 'lane-b' }));
    const tick = await tickCampaignDispatcher();
    expect(tick.started.length).toBe(2);
    expect(fake.enqueued.length).toBe(2);
    const r1 = await findRecord('1:IMPLEMENT:d1');
    const r2 = await findRecord('2:IMPLEMENT:d2');
    expect(r1?.workerJobId).toBeTruthy();
    expect(r2?.workerJobId).toBeTruthy();
    expect(r1?.status).toBe('RUNNING');
    expect(r2?.status).toBe('RUNNING');
  });

  it('2. enforces the configurable maximum concurrency', async () => {
    process.env.IVX_CAMPAIGN_MAX_CONCURRENCY = '2';
    for (let i = 1; i <= 4; i += 1) {
      await ensureCampaignAssignment(assignment({ agentNumber: i, dutyId: `d${i}`, laneKey: `lane-${i}` }));
    }
    const tick = await tickCampaignDispatcher();
    expect(tick.maxConcurrency).toBe(2);
    expect(tick.started.length).toBe(2);
    expect(fake.enqueued.length).toBe(2);
    // Second tick: two jobs still running → no further dispatch.
    await tickCampaignDispatcher();
    expect(fake.enqueued.length).toBe(2);
  });

  it('3. serializes jobs that conflict on the same file lane', async () => {
    await ensureCampaignAssignment(assignment({ agentNumber: 1, dutyId: 'd1', laneKey: 'shared-file.ts' }));
    await ensureCampaignAssignment(assignment({ agentNumber: 2, dutyId: 'd2', laneKey: 'shared-file.ts' }));
    await tickCampaignDispatcher();
    expect(fake.enqueued.length).toBe(1);
    const r1 = await findRecord('1:IMPLEMENT:d1');
    const r2 = await findRecord('2:IMPLEMENT:d2');
    expect(r1?.workerJobId).toBeTruthy();
    expect(r2?.workerJobId).toBeNull();
    // Still serialized while the first job runs.
    await tickCampaignDispatcher();
    expect(fake.enqueued.length).toBe(1);
  });
});

describe('IVX campaign dispatcher — duplication & idempotency (scenarios 4-5)', () => {
  it('4. prevents duplicate records and duplicate jobs', async () => {
    const input = assignment({ agentNumber: 1, dutyId: 'd1' });
    await ensureCampaignAssignment(input);
    await ensureCampaignAssignment(input);
    expect((await records()).length).toBe(1);
    await tickCampaignDispatcher();
    await tickCampaignDispatcher();
    expect(fake.enqueued.length).toBe(1);
  });

  it('5. is idempotent per assignment key (same key returns the same record)', async () => {
    const a = await ensureCampaignAssignment(assignment({ agentNumber: 7, dutyId: 'dx' }));
    const b = await ensureCampaignAssignment(assignment({ agentNumber: 7, dutyId: 'dx' }));
    expect(a.key).toBe(b.key);
    expect((await records()).length).toBe(1);
  });
});

describe('IVX campaign dispatcher — failure, retry & repair (scenarios 6-8)', () => {
  it('6. a failed implementation auto-retries up to the limit, then stays FAILED', async () => {
    await ensureCampaignAssignment(assignment({ agentNumber: 1, dutyId: 'd1' }));
    for (let i = 0; i < MAX_CAMPAIGN_RETRIES + 2; i += 1) {
      await tickCampaignDispatcher();
      const rec = await findRecord('1:IMPLEMENT:d1');
      if (rec?.workerJobId) fake.failJob(rec.workerJobId);
    }
    const rec = await findRecord('1:IMPLEMENT:d1');
    expect(rec?.status).toBe('FAILED');
    expect(rec?.retryCount).toBe(MAX_CAMPAIGN_RETRIES);
    expect(fake.enqueued.length).toBe(MAX_CAMPAIGN_RETRIES + 1);
  });

  it('7. a failed QA returns the implementation for repair and waits again', async () => {
    await ensureCampaignAssignment(assignment({ agentNumber: 1, dutyId: 'item-1', laneKey: 'lane-a' }));
    await ensureCampaignAssignment(assignment({
      agentNumber: 2, role: 'QA', dutyId: 'item-1', executionMode: 'qa_only',
      laneKey: 'qa:item-1', waitFor: '1:IMPLEMENT:item-1',
    }));
    // Implement runs and completes.
    await tickCampaignDispatcher();
    const impl = await findRecord('1:IMPLEMENT:item-1');
    const firstImplJobId = impl!.workerJobId!; // captured now — records are live objects
    fake.completeJob(firstImplJobId, { commitSha: 'abc123', changedFiles: ['a.ts'] });
    await tickCampaignDispatcher();
    // QA is released and dispatched.
    const qa = await findRecord('2:QA:item-1');
    expect(qa?.workerJobId).toBeTruthy();
    // QA fails → implementation returns for repair, QA waits again.
    fake.failJob(qa!.workerJobId!, 'regression found');
    await tickCampaignDispatcher();
    const implAfter = await findRecord('1:IMPLEMENT:item-1');
    const qaAfter = await findRecord('2:QA:item-1');
    // Implementation was returned for repair and re-dispatched in the same tick.
    expect(implAfter?.retryCount).toBe(1);
    expect(implAfter?.attempts).toBe(2);
    expect(implAfter?.status).toBe('RUNNING');
    expect(implAfter?.workerJobId).not.toBe(firstImplJobId);
    expect(qaAfter?.status).toBe('AWAITING_IMPLEMENT');
    expect(qaAfter?.workerJobId).toBeNull();
  });

  it('8. retry counts increment and persist across ticks', async () => {
    await ensureCampaignAssignment(assignment({ agentNumber: 1, dutyId: 'd1' }));
    await tickCampaignDispatcher();
    let rec = await findRecord('1:IMPLEMENT:d1');
    fake.failJob(rec!.workerJobId!);
    await tickCampaignDispatcher();
    rec = await findRecord('1:IMPLEMENT:d1');
    expect(rec?.retryCount).toBe(1);
    expect(rec?.attempts).toBe(2);
  });
});

describe('IVX campaign dispatcher — owner controls (scenarios 9-13)', () => {
  it('9. stop_agent cancels the real worker job for that agent', async () => {
    await ensureCampaignAssignment(assignment({ agentNumber: 5, dutyId: 'd1' }));
    await tickCampaignDispatcher();
    const rec = await findRecord('5:IMPLEMENT:d1');
    const jobId = rec!.workerJobId!;
    const result = await campaignDispatcherControl('stop_agent', 5);
    expect(result.cancelledWorkerJobs).toContain(jobId);
    const after = await findRecord('5:IMPLEMENT:d1');
    expect(after?.status).toBe('CANCELLED');
  });

  it('10. pause_all prevents new jobs from starting', async () => {
    await ensureCampaignAssignment(assignment({ agentNumber: 1, dutyId: 'd1' }));
    await campaignDispatcherControl('pause_all');
    const tick = await tickCampaignDispatcher();
    expect(tick.started.length).toBe(0);
    expect(fake.enqueued.length).toBe(0);
  });

  it('11. resume_all allows jobs to start again', async () => {
    await ensureCampaignAssignment(assignment({ agentNumber: 1, dutyId: 'd1' }));
    await campaignDispatcherControl('pause_all');
    await tickCampaignDispatcher();
    expect(fake.enqueued.length).toBe(0);
    await campaignDispatcherControl('resume_all');
    await tickCampaignDispatcher();
    expect(fake.enqueued.length).toBe(1);
  });

  it('12. stop_all cancels running jobs, cancels queued jobs and blocks new starts', async () => {
    await ensureCampaignAssignment(assignment({ agentNumber: 1, dutyId: 'd1', laneKey: 'lane-a' }));
    await ensureCampaignAssignment(assignment({ agentNumber: 2, dutyId: 'd2', laneKey: 'lane-b' }));
    process.env.IVX_CAMPAIGN_MAX_CONCURRENCY = '1';
    await tickCampaignDispatcher();
    expect(fake.enqueued.length).toBe(1);
    const result = await campaignDispatcherControl('stop_all');
    expect(result.cancelledWorkerJobs.length).toBe(1);
    const r1 = await findRecord('1:IMPLEMENT:d1');
    const r2 = await findRecord('2:IMPLEMENT:d2');
    expect(r1?.status).toBe('CANCELLED');
    expect(r2?.status).toBe('CANCELLED');
    await campaignDispatcherControl('resume_all');
    const tick = await tickCampaignDispatcher();
    expect(tick.started.length).toBe(0);
    expect(fake.enqueued.length).toBe(1);
  });

  it('13. stop_agent leaves other agents untouched', async () => {
    await ensureCampaignAssignment(assignment({ agentNumber: 1, dutyId: 'd1', laneKey: 'lane-a' }));
    await ensureCampaignAssignment(assignment({ agentNumber: 2, dutyId: 'd2', laneKey: 'lane-b' }));
    await campaignDispatcherControl('stop_agent', 1);
    const tick = await tickCampaignDispatcher();
    expect(tick.started.length).toBe(1);
    expect(fake.enqueued[0]?.input.ownerId).toBe('campaign-agent-2');
    const r2 = await findRecord('2:IMPLEMENT:d2');
    expect(r2?.status).toBe('RUNNING');
  });
});

describe('IVX campaign dispatcher — emergency stop & recovery (scenarios 14-16)', () => {
  it('14. owner emergency stop cancels running jobs and blocks all starts', async () => {
    await ensureCampaignAssignment(assignment({ agentNumber: 1, dutyId: 'd1', laneKey: 'lane-a' }));
    await ensureCampaignAssignment(assignment({ agentNumber: 2, dutyId: 'd2', laneKey: 'lane-b' }));
    process.env.IVX_CAMPAIGN_MAX_CONCURRENCY = '1';
    await tickCampaignDispatcher();
    setEmergencyStopSourceForTests(async () => ({ active: true, reason: 'unit-test estop' }));
    const tick = await tickCampaignDispatcher();
    expect(tick.emergencyStop).toBe(true);
    expect(tick.started.length).toBe(0);
    const r1 = await findRecord('1:IMPLEMENT:d1');
    const r2 = await findRecord('2:IMPLEMENT:d2');
    expect(r1?.status).toBe('BLOCKED');
    expect(r1?.blocker).toContain('EMERGENCY_STOP');
    expect(r2?.status).toBe('BLOCKED');
    const snapshot = await getCampaignDispatcherSnapshot();
    expect(snapshot.emergencyStop).toBe(true);
  });

  it('15. stale running jobs are cancelled and requeued within retry limits', async () => {
    await ensureCampaignAssignment(assignment({ agentNumber: 1, dutyId: 'd1' }));
    await tickCampaignDispatcher();
    const rec = await findRecord('1:IMPLEMENT:d1');
    const oldJobId = rec!.workerJobId!;
    // Simulate a worker whose heartbeat died 11 minutes ago.
    const job = fake.jobs.get(oldJobId)!;
    job.lastHeartbeatAt = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    await tickCampaignDispatcher(); // sync propagates the stale heartbeat
    await tickCampaignDispatcher(); // stale sweep detects and recovers
    expect(fake.cancelled).toContain(oldJobId);
    const after = await findRecord('1:IMPLEMENT:d1');
    expect(after?.retryCount).toBe(1);
    // The stale job was replaced by a fresh dispatch after recovery.
    expect(after?.workerJobId).not.toBe(oldJobId);
    expect(after?.status).toBe('RUNNING');
  });

  it('16. survives a process restart (memory-only fallback) without duplicate records', async () => {
    const input = assignment({ agentNumber: 1, dutyId: 'd1' });
    await ensureCampaignAssignment(input);
    await tickCampaignDispatcher();
    expect(fake.enqueued.length).toBe(1);
    // Simulate a restart: in-memory state is dropped, durable store unconfigured.
    resetCampaignDispatcherForTests();
    const fresh = makeFakeBridge();
    setCampaignWorkerBridgeForTests(fresh.bridge);
    // Re-ensure assignments (the boot/dashboard sync path) — no duplicates.
    await ensureCampaignAssignment(input);
    await ensureCampaignAssignment(input);
    expect((await records()).length).toBe(1);
    await tickCampaignDispatcher();
    expect(fresh.enqueued.length).toBe(1);
    setCampaignWorkerBridgeForTests(fake.bridge);
  });
});

describe('IVX campaign dispatcher — heartbeats & handoffs (scenarios 17-19)', () => {
  it('17. propagates the real worker heartbeat into the record', async () => {
    await ensureCampaignAssignment(assignment({ agentNumber: 1, dutyId: 'd1' }));
    await tickCampaignDispatcher();
    const rec = await findRecord('1:IMPLEMENT:d1');
    const stamp = new Date(Date.now() - 30_000).toISOString();
    fake.jobs.get(rec!.workerJobId!)!.lastHeartbeatAt = stamp;
    await tickCampaignDispatcher();
    const after = await findRecord('1:IMPLEMENT:d1');
    expect(after?.lastHeartbeatAt).toBe(stamp);
  });

  it('18. QA only starts after the implementation completed with evidence', async () => {
    await ensureCampaignAssignment(assignment({ agentNumber: 1, dutyId: 'item-1', laneKey: 'lane-a' }));
    await ensureCampaignAssignment(assignment({
      agentNumber: 2, role: 'QA', dutyId: 'item-1', executionMode: 'qa_only',
      laneKey: 'qa:item-1', waitFor: '1:IMPLEMENT:item-1',
    }));
    await tickCampaignDispatcher();
    let qa = await findRecord('2:QA:item-1');
    expect(qa?.workerJobId).toBeNull(); // implement still running
    const impl = await findRecord('1:IMPLEMENT:item-1');
    fake.completeJob(impl!.workerJobId!, { commitSha: 'abc123' });
    await tickCampaignDispatcher();
    qa = await findRecord('2:QA:item-1');
    expect(qa?.workerJobId).toBeTruthy();
    expect(qa?.status).toBe('RUNNING');
  });

  it('19. QA completion closes the item with full evidence on both records', async () => {
    // Use a REAL campaign implement/QA pair so the merged campaign reflects it.
    const campaign = buildAppCompletionCampaign();
    const inputs = buildDispatcherAssignmentInputs(campaign);
    const implInput = inputs.find((i) => i.role === 'IMPLEMENT' && !i.ownerGate)!;
    const qaInput = inputs.find((i) => i.role === 'QA' && i.dutyId === implInput.dutyId)!;
    await ensureCampaignAssignment(implInput);
    await ensureCampaignAssignment(qaInput);
    await tickCampaignDispatcher();
    const impl = await findRecord(`${implInput.agentNumber}:IMPLEMENT:${implInput.dutyId}`);
    fake.completeJob(impl!.workerJobId!, { commitSha: 'abc123', changedFiles: ['a.ts'] });
    await tickCampaignDispatcher();
    const qa = await findRecord(`${qaInput.agentNumber}:QA:${qaInput.dutyId}`);
    fake.completeJob(qa!.workerJobId!, { testsPassed: true });
    await tickCampaignDispatcher();
    const implFinal = await findRecord(`${implInput.agentNumber}:IMPLEMENT:${implInput.dutyId}`);
    const qaFinal = await findRecord(`${qaInput.agentNumber}:QA:${qaInput.dutyId}`);
    expect(implFinal?.status).toBe('COMPLETED');
    expect(qaFinal?.status).toBe('COMPLETED');
    expect(implFinal?.commitSha).toBe('abc123');
    // The campaign reflects the real completed state for both agents.
    const merged = buildAppCompletionCampaign(undefined, await records());
    const a1 = merged.assignments.find((a) => a.agentNumber === implInput.agentNumber && a.role === 'IMPLEMENT');
    const a2 = merged.assignments.find((a) => a.agentNumber === qaInput.agentNumber && a.role === 'QA');
    expect(a1?.status).toBe('COMPLETED');
    expect(a2?.status).toBe('COMPLETED');
    expect(a1?.commitSha).toBe('abc123');
  });
});

describe('IVX campaign dispatcher — evidence, deploy mutex & owner gates (scenarios 20-22)', () => {
  it('20. completion evidence propagates from the real worker result', async () => {
    await ensureCampaignAssignment(assignment({ agentNumber: 1, dutyId: 'd1' }));
    await tickCampaignDispatcher();
    const rec = await findRecord('1:IMPLEMENT:d1');
    fake.completeJob(rec!.workerJobId!, {
      changedFiles: ['src/a.ts', 'src/b.ts'],
      commitSha: 'deadbeef',
      prNumber: 42,
      prUrl: 'https://github.com/ibb142/ivx-holdings-platform/pull/42',
      deployId: 'dep-1',
      healthOk: true,
    });
    await tickCampaignDispatcher();
    const after = await findRecord('1:IMPLEMENT:d1');
    expect(after?.status).toBe('COMPLETED');
    expect(after?.changedFiles).toEqual(['src/a.ts', 'src/b.ts']);
    expect(after?.commitSha).toBe('deadbeef');
    expect(after?.prNumber).toBe(42);
    expect(after?.deployId).toBe('dep-1');
    expect(after?.healthOk).toBe(true);
    expect(after?.testsPassed).toBe(true);
  });

  it('21. serializes deploy-bearing jobs (deploy mutex)', async () => {
    await ensureCampaignAssignment(assignment({ agentNumber: 1, dutyId: 'd1', laneKey: 'lane-a', executionMode: 'deploy' }));
    await ensureCampaignAssignment(assignment({ agentNumber: 2, dutyId: 'd2', laneKey: 'lane-b', executionMode: 'deploy' }));
    process.env.IVX_CAMPAIGN_MAX_CONCURRENCY = '4';
    await tickCampaignDispatcher();
    expect(fake.enqueued.length).toBe(1);
    const r2 = await findRecord('2:IMPLEMENT:d2');
    expect(r2?.workerJobId).toBeNull();
  });

  it('22. owner-gated dangerous items never dispatch without owner approval', async () => {
    // Campaign gates #57/#58 were lifted by recorded owner approval (2026-08-22),
    // so the campaign contains no gated items — exercise the gate mechanism
    // with a synthetic gated assignment instead.
    const gatedInput = assignment({ ownerGate: true, dutyId: 't-synthetic-owner-gate' });
    await ensureCampaignAssignment(gatedInput);
    await tickCampaignDispatcher();
    expect(fake.enqueued.length).toBe(0);
    const rec = await findRecord(`${gatedInput.agentNumber}:IMPLEMENT:${gatedInput.dutyId}`);
    expect(rec?.status).toBe('PENDING_OWNER');
    expect(rec?.blocker).toContain('OWNER_GATE');
  });
});

describe('IVX campaign dispatcher — full campaign mapping (scenarios 23-24)', () => {
  it('23. maps all 112 campaign assignments to dispatcher records', async () => {
    const campaign = buildAppCompletionCampaign();
    const inputs = buildDispatcherAssignmentInputs(campaign);
    expect(inputs.length).toBe(112);
    for (const input of inputs) {
      await ensureCampaignAssignment(input);
    }
    const all = await records();
    expect(all.length).toBe(112);
    expect(new Set(all.map((r) => r.key)).size).toBe(112);
    // QA records wait on their implementer; owner-gated items wait on the owner.
    const qaWaits = all.filter((r) => r.role === 'QA' && r.waitForKey);
    expect(qaWaits.length).toBeGreaterThan(0);
    for (const qa of qaWaits) {
      expect(all.some((r) => r.key === qa.waitForKey && r.role === 'IMPLEMENT')).toBe(true);
    }
    // All campaign owner gates were lifted by recorded owner approval (2026-08-22).
    const gated = all.filter((r) => r.status === 'PENDING_OWNER');
    expect(gated.length).toBe(0);
  });

  it('24. dashboard counts equal the persisted runtime state', async () => {
    const campaign = buildAppCompletionCampaign();
    for (const input of buildDispatcherAssignmentInputs(campaign)) {
      await ensureCampaignAssignment(input);
    }
    const tick = await tickCampaignDispatcher();
    const all = await records();
    const snapshot = await getCampaignDispatcherSnapshot();
    const totalFromSnapshot = snapshot.totals.pendingOwner + snapshot.totals.awaitingImplement
      + snapshot.totals.queued + snapshot.totals.running + snapshot.totals.completed
      + snapshot.totals.failed + snapshot.totals.blocked + snapshot.totals.cancelled;
    expect(snapshot.totals.records).toBe(all.length);
    expect(totalFromSnapshot).toBe(all.length);
    expect(snapshot.totals.running).toBe(tick.activeCount);
    // Campaign counts derive from the same records — no synthetic values.
    const merged = buildAppCompletionCampaign(undefined, all);
    const totalFromCampaign = Object.values(merged.counts).reduce((s, n) => s + n, 0);
    expect(totalFromCampaign).toBe(112);
    const runningInRecords = all.filter((r) => r.status === 'RUNNING').length;
    const runningInCampaign = merged.counts.RUNNING + merged.counts.FIXING
      + merged.counts.TESTING + merged.counts.DEPLOYING + merged.counts.VERIFYING;
    expect(runningInCampaign).toBeGreaterThanOrEqual(runningInRecords);
    expect(snapshot.totals.running).toBe(runningInRecords);
  });
});

describe('IVX campaign dispatcher — boot recovery', () => {
  it('25. boot recovery requeues FAILED records once per boot with a reset retry budget', async () => {
    await ensureCampaignAssignment(assignment({ agentNumber: 1, dutyId: 'd-boot' }));
    for (let i = 0; i < MAX_CAMPAIGN_RETRIES + 2; i += 1) {
      await tickCampaignDispatcher();
      const rec = await findRecord('1:IMPLEMENT:d-boot');
      if (rec?.workerJobId) fake.failJob(rec.workerJobId);
    }
    const failed = await findRecord('1:IMPLEMENT:d-boot');
    expect(failed?.status).toBe('FAILED');
    expect(failed?.retryCount).toBe(MAX_CAMPAIGN_RETRIES);

    resetCampaignBootRecoveryForTests();
    const recovered = await runCampaignBootRecovery();
    expect(recovered).toBe(1);
    const after = await findRecord('1:IMPLEMENT:d-boot');
    expect(after?.status).toBe('QUEUED');
    expect(after?.stage).toContain('BOOT RECOVERY');
    expect(after?.retryCount).toBe(0);
    expect(after?.error).toBeNull();

    // Idempotent within the same boot — a second call recovers nothing.
    const again = await runCampaignBootRecovery();
    expect(again).toBe(0);
  });
});
