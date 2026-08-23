import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  IVX_AUTONOMOUS_INTELLIGENCE_MISSION_SCHEDULER_MARKER,
  startAutonomousIntelligenceMissionScheduler,
  stopAutonomousIntelligenceMissionScheduler,
  getMissionSchedulerStatus,
  verifyLiveDeployForState,
  type MissionSchedulerState,
} from './ivx-autonomous-intelligence-mission-scheduler';
import {
  listSeniorDeveloperJobs,
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

async function writeSchedulerState(state: Record<string, unknown>): Promise<void> {
  try {
    const { isDurableStoreConfigured, writeDurableJson } = await import('./ivx-durable-store');
    if (isDurableStoreConfigured()) {
      await writeDurableJson('logs/audit/autonomous-intelligence-mission-scheduler/state.json', state);
    }
  } catch {
    // best-effort setup for tests
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

  it('exports a stable marker', () => {
    expect(IVX_AUTONOMOUS_INTELLIGENCE_MISSION_SCHEDULER_MARKER).toContain('ivx-autonomous-intelligence-mission-scheduler');
    expect(IVX_AUTONOMOUS_INTELLIGENCE_MISSION_SCHEDULER_MARKER).toContain('2026-08-23');
  });

  it('fails closed when the senior developer worker is not enabled', async () => {
    process.env.IVX_SENIOR_DEV_WORKER_ENABLED = 'false';
    await startAutonomousIntelligenceMissionScheduler();
    const status = await getMissionSchedulerStatus();
    expect(status.ok).toBe(false);
    expect(status.state.status).toBe('failed');
    expect(status.state.error).toContain('IVX_SENIOR_DEV_WORKER_ENABLED');
  });

  it('getMissionSchedulerStatus returns a secret-safe, structured state', async () => {
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
    const validStatuses = ['queued', 'running', 'patching', 'testing', 'committing', 'completed', 'failed'];
    expect(validStatuses).toContain(status.state.status);

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

  it('backfills live verification and clears stale resume error when the merged commit is the current deploy', () => {
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
      stageDetail: 'Restart resume: PR #256 already merged.',
      inspectedFiles: [],
      changedFiles: [],
      commitSha: 'pre-sha',
      prNumber: 256,
      prUrl: 'https://github.com/ibb142/ivx-holdings-platform/pull/256',
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
    expect(verified.healthOk).toBe(true);
    if (previousSha !== undefined) {
      process.env.RENDER_GIT_COMMIT = previousSha;
    } else {
      delete process.env.RENDER_GIT_COMMIT;
    }
  });

  it('leaves the error intact when the merged commit does not match the current deploy', () => {
    const mergeSha = 'abc123def456';
    const previousSha = process.env.RENDER_GIT_COMMIT;
    process.env.RENDER_GIT_COMMIT = 'different-sha';
    const state: MissionSchedulerState = {
      ...({} as MissionSchedulerState),
      marker: IVX_AUTONOMOUS_INTELLIGENCE_MISSION_SCHEDULER_MARKER,
      startedAt: new Date().toISOString(),
      schedulerJobId: 'scheduler-test-2',
      deploySha: 'different-sha',
      missionJobId: 'ivx-worker-resume-test',
      status: 'completed',
      stage: 'COMPLETED',
      progressPercent: 100,
      stageDetail: 'Restart resume: PR #256 already merged.',
      inspectedFiles: [],
      changedFiles: [],
      commitSha: 'pre-sha',
      prNumber: 256,
      prUrl: 'https://github.com/ibb142/ivx-holdings-platform/pull/256',
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
    expect(verified.error).toBe(state.error);
    expect(verified.liveCommit).toBeNull();
    if (previousSha !== undefined) {
      process.env.RENDER_GIT_COMMIT = previousSha;
    } else {
      delete process.env.RENDER_GIT_COMMIT;
    }
  });
});
