import { describe, expect, test } from 'bun:test';
import {
  IVX_SENIOR_DEV_WORKER_MARKER,
  buildSeniorDeveloperWorkerStatus,
  enqueueOrAttachSeniorDeveloperJob,
  enqueueSeniorDeveloperJob,
  cancelSeniorDeveloperJob,
  resumeSeniorDeveloperJob,
  getActiveJobForOwner,
  getSeniorDeveloperJob,
  listSeniorDeveloperJobs,
  expireStaleJobs,
  summarizeProof,
  type IVXWorkerJobInput,
} from './services/ivx-senior-developer-worker';
import type { IVXSeniorDeveloperRunProof } from './services/ivx-senior-developer-runtime';

function makeProof(overrides: Partial<IVXSeniorDeveloperRunProof> = {}): IVXSeniorDeveloperRunProof {
  const base = {
    ok: true,
    endToEndProductionComplete: true,
    jobId: 'job-1',
    goal: 'Build a new module from scratch',
    changedFiles: ['backend/services/example.ts'],
    validations: [
      { block: 35, command: 'bun test routing', cwd: '.', ok: true, exitCode: 0, durationMs: 10, stdoutTail: '', stderrTail: '', error: null },
      { block: 35, command: 'bunx tsc --noEmit', cwd: '.', ok: true, exitCode: 0, durationMs: 20, stdoutTail: '', stderrTail: '', error: null },
    ],
    gitDeployOperator: {
      block: 36,
      status: 'executed' as const,
      github: { repoConfigured: true, tokenConfigured: true, canCommitWithApproval: true, commitAttempted: true, commitSha: 'deadbeef', commitUrl: 'https://github.com/x/y/commit/deadbeef', branch: 'main', committedPaths: ['backend/services/example.ts'], error: null, accessCheck: null },
      render: { serviceConfigured: true, apiKeyConfigured: true, canDeployWithApproval: true, deployAttempted: true, deployId: 'dep-1', deployStatus: 'live', deployUrl: null, error: null },
      requiredConfirmationText: 'CONFIRM_IVX_GIT_DEPLOY_OPERATOR',
      reason: 'executed',
      secretValuesReturned: false as const,
    },
    productionVerification: { endpoint: 'https://api.ivxholding.com/health', attempted: true, ok: true, httpStatus: 200, bodyPreview: '{}', error: null },
    generatedFeature: { built: true, feature: { slug: 'new-module' }, liveRoute: '/x', listRoute: '/y', visibleAfterDeployCompletes: true },
    auditFiles: { json: 'logs/audit/job-1.json', jsonl: 'logs/audit/job-1.jsonl' },
    generatedAt: '2026-06-16T00:00:00.000Z',
  };
  return { ...base, ...overrides } as unknown as IVXSeniorDeveloperRunProof;
}

function makeInput(overrides: Partial<IVXWorkerJobInput> = {}): IVXWorkerJobInput {
  return {
    goal: 'inspect the repo only',
    ownerApproved: true,
    approvePatch: false,
    approveGitDeploy: false,
    validationMode: 'focused',
    systemMode: false,
    ownerApprovedAction: null,
    ownerId: 'test-owner',
    ...overrides,
  };
}

describe('summarizeProof', () => {
  test('maps a successful end-to-end proof to a COMPLETE secret-safe result', () => {
    const result = summarizeProof('job-1', makeProof(), {
      requestedCommit: 'deadbeef',
      liveCommit: 'deadbeef',
      match: true,
      deploymentId: 'dep-1',
      deployStatus: 'live',
      deployPolled: true,
      deployReachedTerminalState: true,
      deployPollAttempts: 1,
      versionEndpoint: 'https://api.ivxholding.com/version',
      versionHttpStatus: 200,
      versionAttempts: 1,
      error: null,
      secretValuesReturned: false,
    });

    expect(result.finalStatus).toBe('COMPLETE');
    expect(result.commitCreated).toBe(true);
    expect(result.commitSha).toBe('deadbeef');
    expect(result.pushed).toBe(true);
    expect(result.deployVerified).toBe(true);
    expect(result.commitMatch).toBe(true);
    expect(result.testsPassed).toBe(true);
    expect(result.typecheckRun).toBe(true);
    expect(result.healthOk).toBe(true);
    expect(JSON.stringify(result)).not.toContain('Bearer');
  });

  test('reports LOCAL_ONLY when validation passed but deploy was not end-to-end', () => {
    const proof = makeProof({ endToEndProductionComplete: false, ok: true });
    const result = summarizeProof('job-2', proof, null);
    expect(result.finalStatus).toBe('LOCAL_ONLY');
    expect(result.deployVerified).toBe(false);
  });

  test('reports BLOCKED when credentials are missing', () => {
    const proof = makeProof({
      ok: false,
      endToEndProductionComplete: false,
      gitDeployOperator: {
        ...makeProof().gitDeployOperator,
        status: 'blocked_missing_credentials',
        reason: 'GITHUB_TOKEN missing',
      } as IVXSeniorDeveloperRunProof['gitDeployOperator'],
    });
    const result = summarizeProof('job-3', proof, null);
    expect(result.finalStatus).toBe('BLOCKED');
    expect(result.error).toContain('GITHUB_TOKEN');
  });
});

// ─── HTTP 409 FIX: Per-Owner Single-Flight Queue Tests ──────────────────────

describe('per-owner single-flight queue', () => {
  test('rejects a job without verified owner approval', async () => {
    await expect(
      enqueueOrAttachSeniorDeveloperJob(makeInput({ ownerApproved: false })),
    ).rejects.toThrow(/owner approval/i);
  });

  test('enqueues an owner-approved job and exposes it via getJob/listJobs', async () => {
    const { job, attached, activeJobId } = await enqueueOrAttachSeniorDeveloperJob(makeInput({ ownerId: 'test-enqueue' }));

    expect(job.jobId).toMatch(/^ivx-worker-/);
    expect(attached).toBe(false);
    expect(activeJobId).toBe(null);
    expect(job.stage).toBe('QUEUED');
    expect(job.progressPercent).toBe(0);

    const fetched = await getSeniorDeveloperJob(job.jobId);
    expect(fetched?.jobId).toBe(job.jobId);

    const jobs = await listSeniorDeveloperJobs(50);
    expect(jobs.some((j) => j.jobId === job.jobId)).toBe(true);
  });

  test('second request for same owner ATTACHES to the running job (no HTTP 409 discard)', async () => {
    // First request — creates a new job.
    const first = await enqueueOrAttachSeniorDeveloperJob(makeInput({ ownerId: 'test-attach' }));
    expect(first.attached).toBe(false);

    // Second request for the same owner — should ATTACH to the first job.
    const second = await enqueueOrAttachSeniorDeveloperJob(makeInput({ ownerId: 'test-attach' }));
    expect(second.attached).toBe(true);
    expect(second.activeJobId).toBe(first.job.jobId);
    expect(second.job.jobId).toBe(first.job.jobId);
  });

  test('different owners can have separate active jobs', async () => {
    const ownerA = await enqueueOrAttachSeniorDeveloperJob(makeInput({ ownerId: 'owner-A' }));
    const ownerB = await enqueueOrAttachSeniorDeveloperJob(makeInput({ ownerId: 'owner-B' }));
    expect(ownerA.attached).toBe(false);
    expect(ownerB.attached).toBe(false);
    expect(ownerA.job.jobId).not.toBe(ownerB.job.jobId);

    // Second request for owner-A should attach to owner-A's job.
    const ownerASecond = await enqueueOrAttachSeniorDeveloperJob(makeInput({ ownerId: 'owner-A' }));
    expect(ownerASecond.attached).toBe(true);
    expect(ownerASecond.job.jobId).toBe(ownerA.job.jobId);
  });

  test('getActiveJobForOwner returns the active job for an owner', async () => {
    const { job } = await enqueueOrAttachSeniorDeveloperJob(makeInput({ ownerId: 'test-active-lookup' }));
    const active = await getActiveJobForOwner('test-active-lookup');
    expect(active).not.toBe(null);
    expect(active?.jobId).toBe(job.jobId);
  });

  test('getActiveJobForOwner returns null for an owner with no active job', async () => {
    const active = await getActiveJobForOwner('nonexistent-owner-xyz');
    expect(active).toBe(null);
  });
});

// ─── Cancel and Resume Tests ─────────────────────────────────────────────────

describe('cancel and resume', () => {
  test('cancel marks a job as cancelled', async () => {
    const { job } = await enqueueOrAttachSeniorDeveloperJob(makeInput({ ownerId: 'test-cancel' }));
    const cancelled = await cancelSeniorDeveloperJob(job.jobId);
    expect(cancelled).not.toBe(null);
    expect(cancelled?.status).toBe('cancelled');
    expect(cancelled?.cancelledAt).not.toBe(null);
    expect(cancelled?.finishedAt).not.toBe(null);
  });

  test('cancel returns null for a nonexistent job', async () => {
    const result = await cancelSeniorDeveloperJob('nonexistent-job-id');
    expect(result).toBe(null);
  });

  test('resume resets a queued job back to queued state', async () => {
    const { job } = await enqueueOrAttachSeniorDeveloperJob(makeInput({ ownerId: 'test-resume' }));
    const resumed = await resumeSeniorDeveloperJob(job.jobId);
    expect(resumed).not.toBe(null);
    expect(resumed?.status).toBe('queued');
    expect(resumed?.stage).toBe('QUEUED');
    expect(resumed?.stageDetail).toContain('resumed');
  });

  test('resume returns null for a nonexistent job', async () => {
    const result = await resumeSeniorDeveloperJob('nonexistent-job-id');
    expect(result).toBe(null);
  });
});

// ─── Stale Job Expiration Tests ──────────────────────────────────────────────

describe('stale job expiration', () => {
  test('expireStaleJobs does not throw and returns an array', async () => {
    const expired = await expireStaleJobs();
    expect(Array.isArray(expired)).toBe(true);
  });

  test('expireStaleJobs does not expire fresh queued jobs', async () => {
    const { job } = await enqueueOrAttachSeniorDeveloperJob(makeInput({ ownerId: 'test-fresh' }));
    const expired = await expireStaleJobs();
    expect(expired).not.toContain(job.jobId);
  });
});

// ─── Worker Status Tests ─────────────────────────────────────────────────────

describe('buildSeniorDeveloperWorkerStatus', () => {
  test('declares Rork is not required as the executor and all capabilities are present', () => {
    const status = buildSeniorDeveloperWorkerStatus();
    expect(status.rorkRequiredAsExecutor).toBe(false);
    const capabilities = status.capabilities as Record<string, boolean>;
    expect(capabilities.commitService).toBe(true);
    expect(capabilities.renderDeploy).toBe(true);
    expect(capabilities.proofLedger).toBe(true);
    expect(capabilities.ownerApprovalGate).toBe(true);
  });

  test('reports per-owner single-flight and cancel/resume capabilities', () => {
    const status = buildSeniorDeveloperWorkerStatus();
    expect(status.perOwnerSingleFlight).toBe(true);
    const capabilities = status.capabilities as Record<string, boolean>;
    expect(capabilities.perOwnerSingleFlight).toBe(true);
    expect(capabilities.staleJobExpiration).toBe(true);
    expect(capabilities.cancelJob).toBe(true);
    expect(capabilities.resumeJob).toBe(true);
    expect(capabilities.attachToRunningJob).toBe(true);
    expect(capabilities.realTimeStageUpdates).toBe(true);
  });

  test('reports granular stages in status', () => {
    const status = buildSeniorDeveloperWorkerStatus();
    const stages = status.granularStages as string[];
    expect(stages).toContain('QUEUED');
    expect(stages).toContain('RUNNING');
    expect(stages).toContain('PATCHING');
    expect(stages).toContain('TESTING');
    expect(stages).toContain('COMMITTING');
    expect(stages).toContain('DEPLOYING');
    expect(stages).toContain('VERIFYING');
    expect(stages).toContain('COMPLETED');
    expect(stages).toContain('FAILED');
  });

  test('reports cancel and resume routes in status', () => {
    const status = buildSeniorDeveloperWorkerStatus();
    const routes = status.routes as Record<string, string>;
    expect(routes.cancel).toContain('cancel');
    expect(routes.resume).toContain('resume');
    expect(routes.active).toContain('active');
  });

  test('reports stale job timeout configuration', () => {
    const status = buildSeniorDeveloperWorkerStatus();
    expect(typeof status.staleJobTimeoutMs).toBe('number');
    expect(status.staleJobTimeoutMs).toBeGreaterThan(0);
    expect(typeof status.staleCheckIntervalMs).toBe('number');
    expect(status.staleCheckIntervalMs).toBeGreaterThan(0);
  });
});

// ─── Backwards-Compatible Enqueue Tests ──────────────────────────────────────

describe('backwards-compatible enqueue', () => {
  test('enqueueSeniorDeveloperJob still works (delegates to enqueueOrAttach)', async () => {
    const job = await enqueueSeniorDeveloperJob(makeInput({ ownerId: 'test-backwards-compat' }));
    expect(job.jobId).toMatch(/^ivx-worker-/);
    expect(['queued', 'running', 'completed', 'failed', 'blocked', 'cancelled',
      'patching', 'testing', 'committing', 'deploying', 'verifying']).toContain(job.status);
  });
});
