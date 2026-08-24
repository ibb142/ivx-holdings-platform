import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  IVX_AUTONOMOUS_INTELLIGENCE_MISSION_SCHEDULER_MARKER,
  buildMissionGoal,
  isMissionStateCertified,
  isTerminalMissionStatus,
  startAutonomousIntelligenceMissionScheduler,
  stopAutonomousIntelligenceMissionScheduler,
  getMissionSchedulerStatus,
  verifyLiveDeployForState,
  type MissionSchedulerState,
} from './ivx-autonomous-intelligence-mission-scheduler';
import {
  listSeniorDeveloperJobs,
  type IVXWorkerJobResult,
} from './ivx-senior-developer-worker';

async function clearSchedulerState(): Promise<void> {
  try {
    const { isDurableStoreConfigured, writeDurableJson } = await import('./ivx-durable-store');
    if (isDurableStoreConfigured()) {
      await writeDurableJson('logs/audit/autonomous-intelligence-mission-scheduler/state.json', null);
    }
  } catch {
    // best-effort cleanup for tests
  }
}

async function clearMissionJobs(): Promise<void> {
  const jobs = await listSeniorDeveloperJobs(100);
  const toCancel = jobs.filter(
    (j) =>
      j.ownerId === 'ivx-autonomous-intelligence-mission-scheduler' &&
      !['completed', 'failed', 'blocked', 'cancelled'].includes(j.status),
  );
  await Promise.all(
    toCancel.map(async (j) => {
      const { cancelSeniorDeveloperJob } = await import('./ivx-senior-developer-worker');
      await cancelSeniorDeveloperJob(j.jobId);
    }),
  );
}

describe('ivx-autonomous-intelligence-mission-scheduler', () => {
  beforeEach(async () => {
    stopAutonomousIntelligenceMissionScheduler();
    await clearSchedulerState();
    await clearMissionJobs();
  });

  afterEach(() => {
    stopAutonomousIntelligenceMissionScheduler();
  });

  it('exports the v2 stable marker', () => {
    expect(IVX_AUTONOMOUS_INTELLIGENCE_MISSION_SCHEDULER_MARKER).toBe(
      'ivx-autonomous-intelligence-mission-scheduler-v2-2026-08-24',
    );
  });

  it('builds the evidence task with a host-generated exact timestamp', () => {
    const createdAt = '2026-08-24T01:05:00.000Z';
    const goal = buildMissionGoal(createdAt);
    expect(goal).toContain(`"createdAt": "${createdAt}"`);
    expect(goal).toContain('Copy it exactly');
    expect(goal).not.toContain('createdAt": current ISO');
  });

  it('classifies terminal states so completed missions cannot replay on deploy', () => {
    expect(isTerminalMissionStatus('completed')).toBe(true);
    expect(isTerminalMissionStatus('failed')).toBe(true);
    expect(isTerminalMissionStatus('blocked')).toBe(true);
    expect(isTerminalMissionStatus('cancelled')).toBe(true);
    expect(isTerminalMissionStatus('running')).toBe(false);
    expect(isTerminalMissionStatus('verifying')).toBe(false);
  });

  it('fails closed when the senior developer worker is not enabled', async () => {
    process.env.IVX_SENIOR_DEV_WORKER_ENABLED = 'false';
    await startAutonomousIntelligenceMissionScheduler();
    const status = await getMissionSchedulerStatus();
    expect(status.ok).toBe(false);
    expect(status.state.status).toBe('failed');
    expect(status.state.error).toContain('IVX_SENIOR_DEV_WORKER_ENABLED');
  });

  it('getMissionSchedulerStatus returns a secret-safe structured state', async () => {
    const status = await getMissionSchedulerStatus();
    expect(typeof status.ok).toBe('boolean');
    expect(status.marker).toBe(IVX_AUTONOMOUS_INTELLIGENCE_MISSION_SCHEDULER_MARKER);
    expect(typeof status.schedulerJobId).toBe('string');
    expect(status.state.missionJobId).toBeNull();
  });

  it('startAutonomousIntelligenceMissionScheduler enqueues a real worker job', async () => {
    process.env.IVX_SENIOR_DEV_WORKER_ENABLED = 'true';
    await startAutonomousIntelligenceMissionScheduler();
    const status = await getMissionSchedulerStatus();
    expect(typeof status.state.missionJobId).toBe('string');
    expect(status.state.missionJobId).toMatch(/^ivx-worker-/);

    const job = (await listSeniorDeveloperJobs(10)).find(
      (j) => j.jobId === status.state.missionJobId,
    );
    expect(job).toBeDefined();
    expect(job!.ownerId).toBe('ivx-autonomous-intelligence-mission-scheduler');
    expect(job!.input.ownerApproved).toBe(true);
    expect(job!.input.executionMode).toBe('code_change');
    expect(job!.input.goal).toContain(IVX_AUTONOMOUS_INTELLIGENCE_MISSION_SCHEDULER_MARKER);
    expect(job!.input.goal).toContain('expo/evidence/autonomous/ivx-autonomous-intelligence-mission-scheduler-cert.json');
  });

  it('does not create duplicate jobs when already active', async () => {
    process.env.IVX_SENIOR_DEV_WORKER_ENABLED = 'true';
    await startAutonomousIntelligenceMissionScheduler();
    const first = await getMissionSchedulerStatus();
    await startAutonomousIntelligenceMissionScheduler();
    const second = await getMissionSchedulerStatus();
    expect(first.state.missionJobId).toBe(second.state.missionJobId);
  });

  it('backfills matching live SHA but does not fabricate health success', () => {
    const mergeSha = 'abc123def456';
    const previousSha = process.env.RENDER_GIT_COMMIT;
    process.env.RENDER_GIT_COMMIT = mergeSha;
    const state: MissionSchedulerState = {
      marker: IVX_AUTONOMOUS_INTELLIGENCE_MISSION_SCHEDULER_MARKER,
      startedAt: new Date().toISOString(),
      schedulerJobId: 'scheduler-test-1',
      deploySha: mergeSha,
      missionJobId: 'ivx-worker-resume-test',
      status: 'completed',
      stage: 'COMPLETED',
      progressPercent: 100,
      stageDetail: 'Restart resume.',
      inspectedFiles: [],
      changedFiles: [],
      commitSha: 'pre-sha',
      prNumber: 296,
      prUrl: 'https://github.com/ibb142/ivx-holdings-platform/pull/296',
      prMerged: true,
      prMergeCommitSha: mergeSha,
      deployId: null,
      liveCommit: null,
      healthOk: null,
      completedAt: new Date().toISOString(),
      error: 'Code-change job produced no changed files; stale evidence is not accepted.',
      updatedAt: new Date().toISOString(),
    };
    const verified = verifyLiveDeployForState(state);
    expect(verified.error).toBeNull();
    expect(verified.liveCommit).toBe(mergeSha);
    expect(verified.healthOk).toBeNull();
    if (previousSha !== undefined) process.env.RENDER_GIT_COMMIT = previousSha;
    else delete process.env.RENDER_GIT_COMMIT;
  });

  it('requires full worker + CI + exact-SHA live proof before ok=true', () => {
    const sha = 'abc123def456';
    const state: MissionSchedulerState = {
      marker: IVX_AUTONOMOUS_INTELLIGENCE_MISSION_SCHEDULER_MARKER,
      startedAt: new Date().toISOString(),
      schedulerJobId: 'scheduler-certified',
      deploySha: sha,
      missionJobId: 'ivx-worker-certified',
      status: 'completed',
      stage: 'COMPLETED',
      progressPercent: 100,
      stageDetail: 'certified',
      inspectedFiles: ['backend/services/ivx-autonomous-intelligence-mission-scheduler.ts'],
      changedFiles: ['expo/evidence/autonomous/ivx-autonomous-intelligence-mission-scheduler-cert.json'],
      commitSha: 'commit-sha',
      prNumber: 296,
      prUrl: 'https://github.com/ibb142/ivx-holdings-platform/pull/296',
      prMerged: true,
      prMergeCommitSha: sha,
      deployId: 'deploy-1',
      liveCommit: sha,
      healthOk: true,
      completedAt: new Date().toISOString(),
      error: null,
      updatedAt: new Date().toISOString(),
    };
    const worker = {
      jobId: state.missionJobId,
      ok: true,
      testsRun: true,
      testsPassed: true,
      typecheckRun: true,
      typecheckPassed: true,
      commitCreated: true,
      commitSha: 'commit-sha',
      prMerged: true,
      ciChecksGreen: true,
      prMergeCommitSha: sha,
      finalStatus: 'COMPLETE',
      error: null,
    } as IVXWorkerJobResult;
    expect(isMissionStateCertified(state, worker, sha)).toBe(true);
    expect(isMissionStateCertified({ ...state, healthOk: false }, worker, sha)).toBe(false);
    expect(isMissionStateCertified(state, { ...worker, ciChecksGreen: false }, sha)).toBe(false);
    expect(isMissionStateCertified(state, worker, 'different-sha')).toBe(false);
  });
});
