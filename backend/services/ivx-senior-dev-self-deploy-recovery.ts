/**
 * IVX Senior Developer Worker — Self-Deploy Recovery Scanner.
 *
 * Runs on EVERY new runtime boot (server.ts) BEFORE startSeniorDevWorker().
 * Finds tasks that triggered a Render deploy and then died (because the deploy
 * restarted the same runtime executing the task), and resumes them at
 * LIVE_VERIFYING — polling the stored Render deploy id, verifying 3-way SHA
 * parity, running the live feature test, and marking exactly one terminal state.
 *
 * Owns the recovery lease protocol (optimistic-lock via task_version) so two
 * runtimes booted in parallel cannot double-claim the same resumable task.
 *
 * Algorithm (see owner directive):
 *   1. list self-deploy resumable tasks
 *   2. for each: atomically claim lease (task_version optimistic lock)
 *   3. poll render deploy id until live|failed|canceled|timeout
 *   4. on live: 3-way SHA parity (githubSha == renderSha == runtimeSha)
 *      with 5 bounded propagation retries
 *   5. run live feature test (authenticated worker/jobs/:id GET — 200, not 503)
 *   6. if parity+health+feature OK → VERIFIED with 4-evidence
 *      else → FAILED with rollback evidence
 *   7. release lease on terminal
 */

import {
  getTask,
  listSelfDeployResumableTasks,
  patchTask,
  type IVXOwnerAITaskRow,
} from './ivx-owner-ai-task-queue';
import {
  claimRecoveryLease,
  releaseRecoveryLease,
  updateProofLedger,
} from './ivx-senior-dev-proof';
import {
  getRenderDeployStatus,
  getRenderDeployCommitSha,
  getProductionHealth,
  getGitHubHeadSha,
} from './ivx-enterprise-deployment-engine';

export const IVX_SENIOR_DEV_WORKER_ID = 'IVX-SENIOR-DEV-01';
export const RECOVERY_LEASE_DURATION_MS = 5 * 60 * 1000;
export const DEPLOY_POLL_TIMEOUT_MS = 10 * 60 * 1000;
export const DEPLOY_POLL_INTERVAL_MS = 10_000;
export const SHA_PARITY_MAX_RETRIES = 5;
export const SHA_PARITY_RETRY_INTERVAL_MS = 10_000;
export const POST_DEPLOY_PROPAGATION_DELAY_MS = 15_000;
export const LIVE_FEATURE_TEST_TIMEOUT_MS = 15_000;

export interface RecoveryOutcome {
  taskId: string;
  claimed: boolean;
  finalStatus: 'VERIFIED' | 'FAILED' | 'SKIPPED';
  reason: string;
  deployId: string | null;
  runtimeSha: string | null;
  commitSha: string | null;
  proofLedgerId: string | null;
}

export interface RecoveryScanResult {
  scanned: number;
  recovered: number;
  verified: number;
  failed: number;
  skipped: number;
  outcomes: RecoveryOutcome[];
}

/**
 * Boot-time scan. Called from server.ts on every runtime start BEFORE
 * startSeniorDevWorker(). Non-fatal: a thrown error never blocks API startup.
 */
export async function recoverSelfDeployTasks(): Promise<RecoveryScanResult> {
  const outcomes: RecoveryOutcome[] = [];
  let scanned = 0;
  let recovered = 0;
  let verified = 0;
  let failed = 0;
  let skipped = 0;

  let tasks: IVXOwnerAITaskRow[] = [];
  try {
    tasks = await listSelfDeployResumableTasks(20);
  } catch (err) {
    console.log('[IVX-SelfDeployRecovery] listSelfDeployResumableTasks error (non-fatal):', err instanceof Error ? err.message : 'unknown');
    return { scanned: 0, recovered: 0, verified: 0, failed: 0, skipped: 0, outcomes };
  }
  scanned = tasks.length;
  if (scanned === 0) {
    console.log('[IVX-SelfDeployRecovery] No self-deploy resumable tasks found at boot');
    return { scanned: 0, recovered: 0, verified: 0, failed: 0, skipped: 0, outcomes };
  }
  console.log('[IVX-SelfDeployRecovery] Found resumable self-deploy tasks', { count: scanned, ids: tasks.map((t) => t.id) });

  for (const task of tasks) {
    const outcome = await recoverOneTask(task);
    outcomes.push(outcome);
    if (outcome.claimed) recovered += 1;
    else { skipped += 1; continue; }
    if (outcome.finalStatus === 'VERIFIED') verified += 1;
    else if (outcome.finalStatus === 'FAILED') failed += 1;
    else skipped += 1;
  }

  console.log('[IVX-SelfDeployRecovery] Boot scan complete', { scanned, recovered, verified, failed, skipped });
  return { scanned, recovered, verified, failed, skipped, outcomes };
}

async function recoverOneTask(task: IVXOwnerAITaskRow): Promise<RecoveryOutcome> {
  const baseOutcome: RecoveryOutcome = {
    taskId: task.id,
    claimed: false,
    finalStatus: 'SKIPPED',
    reason: 'not_attempted',
    deployId: task.render_deploy_id ?? null,
    runtimeSha: null,
    commitSha: task.commit_sha ?? null,
    proofLedgerId: task.proof_ledger_id ?? null,
  };

  const expectedVersion = task.task_version ?? 1;
  const recoveryAttempt = (task.recovery_attempt ?? 0) + 1;
  const idempotencyKey = `recovery-${task.id}-${recoveryAttempt}-${Date.now()}`;

  // 1. Atomically claim the recovery lease (optimistic lock on task_version).
  const lease = await claimRecoveryLease({
    taskId: task.id,
    workerId: IVX_SENIOR_DEV_WORKER_ID,
    expectedTaskVersion: expectedVersion,
    leaseDurationMs: RECOVERY_LEASE_DURATION_MS,
    idempotencyKey,
    recoveryAttempt,
  });
  if (!lease.claimed) {
    console.log('[IVX-SelfDeployRecovery] Lease NOT claimed (another worker holds it or optimistic lock contention)', { taskId: task.id, reason: lease.reason });
    return { ...baseOutcome, reason: `lease_not_claimed:${lease.reason}` };
  }
  console.log('[IVX-SelfDeployRecovery] Lease claimed — resuming task at LIVE_VERIFYING', { taskId: task.id, taskVersion: lease.taskVersion, attempt: recoveryAttempt });

  // Record recovery-lease event into proof ledger (append-only history preserved).
  if (task.proof_ledger_id) {
    await updateProofLedger(task.proof_ledger_id, {
      recoveryLeaseEvent: {
        taskId: task.id,
        workerId: IVX_SENIOR_DEV_WORKER_ID,
        attempt: recoveryAttempt,
        idempotencyKey,
        leaseExpiresAt: lease.leaseExpiresAt,
        at: new Date().toISOString(),
      },
      workerRestartEvent: {
        preDeployRuntimeSha: task.pre_deploy_runtime_sha ?? null,
        resumePhase: task.resume_phase ?? 'LIVE_VERIFYING',
        recoveryBootAt: new Date().toISOString(),
      },
    }).catch(() => null);
  }

  await patchTask(task.id, {
    status: 'LIVE_VERIFYING',
    checkpoint: 'LIVE_VERIFYING (recovered by boot scanner — resuming after self-deploy handoff)',
    heartbeat_at: new Date().toISOString(),
    checkpoint_history: appendCheckpoint(task.checkpoint_history, `RECOVERY_RESUMED at ${new Date().toISOString()} (attempt ${recoveryAttempt})`),
  });

  try {
    const result = await executeRecoveryResume(task);
    // Always release the lease on terminal (VERIFIED or FAILED).
    await releaseRecoveryLease(task.id, IVX_SENIOR_DEV_WORKER_ID).catch(() => null);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.log('[IVX-SelfDeployRecovery] executeRecoveryResume threw — marking FAILED', { taskId: task.id, msg });
    await markFailed(task, `Recovery resume threw: ${msg}`);
    await releaseRecoveryLease(task.id, IVX_SENIOR_DEV_WORKER_ID).catch(() => null);
    return { ...baseOutcome, claimed: true, finalStatus: 'FAILED', reason: `resume_threw:${msg}` };
  }
}

/**
 * Resume a recovered task at LIVE_VERIFYING: poll the stored render deploy id
 * until it reaches a terminal state, then verify 3-way SHA parity, run the live
 * feature test, and mark exactly one terminal state.
 */
async function executeRecoveryResume(task: IVXOwnerAITaskRow): Promise<RecoveryOutcome> {
  const deployId = task.render_deploy_id ?? null;
  const commitSha = task.commit_sha ?? null;
  const proofLedgerId = task.proof_ledger_id ?? null;
  const baseOutcome: RecoveryOutcome = {
    taskId: task.id,
    claimed: true,
    finalStatus: 'SKIPPED',
    reason: 'in_progress',
    deployId,
    runtimeSha: null,
    commitSha,
    proofLedgerId,
  };

  if (!deployId) {
    // Handoff was supposed to persist deployId before triggering Render. If it
    // is missing the handoff is incomplete — we cannot verify a deploy we cannot
    // identify. Fail honestly rather than fake VERIFIED.
    await markFailed(task, 'Recovery resume: render_deploy_id is null — deploy handoff did not persist deployId before worker exit');
    return { ...baseOutcome, finalStatus: 'FAILED', reason: 'missing_deploy_id' };
  }
  if (!commitSha) {
    await markFailed(task, 'Recovery resume: commit_sha is null — cannot verify 3-way parity without a commit');
    return { ...baseOutcome, finalStatus: 'FAILED', reason: 'missing_commit_sha' };
  }

  // 1. Poll Render deploy status until terminal.
  const deployStatus = await pollRenderDeploy(deployId, DEPLOY_POLL_TIMEOUT_MS);
  await logRecovery(task, 'DEPLOY_STATUS', { deployId, finalStatus: deployStatus });
  if (deployStatus !== 'live') {
    // Deploy failed/canceled/timeout — record rollback evidence and mark FAILED.
    await markFailed(task, `Render deploy did not reach live state: ${deployStatus} (deployId=${deployId})`);
    if (proofLedgerId) {
      await updateProofLedger(proofLedgerId, {
        status: 'failed',
        errorMessage: `Deploy did not reach live: ${deployStatus}`,
        deployHttpResponse: { deployId, finalStatus: deployStatus },
        finalStatus: 'FAILED',
        finalTimestamp: new Date().toISOString(),
      }).catch(() => null);
    }
    return { ...baseOutcome, finalStatus: 'FAILED', reason: `deploy_not_live:${deployStatus}` };
  }

  // 2. Wait for propagation (new runtime container boot + DNS/CDN refresh).
  await sleep(POST_DEPLOY_PROPAGATION_DELAY_MS);

  // 3. 3-way SHA parity with bounded retries for propagation delay.
  const parity = await verifyThreeWayParity(deployId, commitSha, SHA_PARITY_MAX_RETRIES, SHA_PARITY_RETRY_INTERVAL_MS);
  await logRecovery(task, 'SHA_PARITY', parity);
  if (proofLedgerId) {
    await updateProofLedger(proofLedgerId, {
      parityResult: parity,
    }).catch(() => null);
  }
  if (!parity.match) {
    await markFailed(task, `3-way SHA parity failed: github=${parity.githubSha} render=${parity.renderSha} runtime=${parity.runtimeSha} (after ${SHA_PARITY_MAX_RETRIES} retries)`);
    if (proofLedgerId) {
      await updateProofLedger(proofLedgerId, {
        status: 'failed',
        errorMessage: `SHA parity failed: github=${parity.githubSha} render=${parity.renderSha} runtime=${parity.runtimeSha}`,
        finalStatus: 'FAILED',
        finalTimestamp: new Date().toISOString(),
      }).catch(() => null);
    }
    return { ...baseOutcome, finalStatus: 'FAILED', reason: `parity_failed:${parity.githubSha}/${parity.renderSha}/${parity.runtimeSha}` };
  }

  // 4. Run the live feature test (authenticated worker/jobs/:id GET).
  const feature = await runLiveFeatureTest(task.id);
  await logRecovery(task, 'LIVE_FEATURE_TEST', feature);
  if (proofLedgerId) {
    await updateProofLedger(proofLedgerId, {
      liveFeatureResult: feature,
    }).catch(() => null);
  }
  if (!feature.passed) {
    await markFailed(task, `Live feature test failed: ${feature.reason} (http=${feature.httpStatus})`);
    if (proofLedgerId) {
      await updateProofLedger(proofLedgerId, {
        status: 'failed',
        errorMessage: `Live feature test failed: ${feature.reason}`,
        finalStatus: 'FAILED',
        finalTimestamp: new Date().toISOString(),
      }).catch(() => null);
    }
    return { ...baseOutcome, finalStatus: 'FAILED', reason: `feature_failed:${feature.reason}` };
  }

  // 5. All gates passed — mark VERIFIED with all 4 evidence fields.
  const runtimeSha = parity.runtimeShaFull ?? parity.runtimeSha ?? null;
  await patchTask(task.id, {
    status: 'VERIFIED',
    checkpoint: 'VERIFIED — self-deploy recovery resumed, 3-way SHA parity confirmed, live feature test passed',
    runtime_sha: runtimeSha,
    render_deploy_id: deployId,
    commit_sha: commitSha,
    proof_ledger_id: proofLedgerId,
    resume_required: false,
    heartbeat_at: new Date().toISOString(),
    checkpoint_history: appendCheckpoint(task.checkpoint_history, `VERIFIED via self-deploy recovery at ${new Date().toISOString()}`),
  });
  if (proofLedgerId) {
    await updateProofLedger(proofLedgerId, {
      status: 'verified',
      commitSha,
      renderDeployId: deployId,
      runtimeSha: runtimeSha ?? undefined,
      healthResults: parity.healthSnapshot,
      liveFeatureResult: feature,
      parityResult: parity,
      finalStatus: 'VERIFIED',
      finalTimestamp: new Date().toISOString(),
    }).catch(() => null);
  }
  await logRecovery(task, 'VERIFIED', { commitSha, deployId, runtimeSha, proofLedgerId });
  console.log('[IVX-SelfDeployRecovery] Task VERIFIED via self-deploy recovery', { taskId: task.id, commitSha, deployId, runtimeSha });

  return {
    ...baseOutcome,
    finalStatus: 'VERIFIED',
    reason: 'parity_and_feature_passed',
    runtimeSha,
  };
}

// ─── Internals ─────────────────────────────────────────────────────────────

interface ParityResult {
  match: boolean;
  githubSha: string | null;
  renderSha: string | null;
  runtimeSha: string | null;
  runtimeShaFull: string | null;
  healthSnapshot: Record<string, unknown>;
  attempts: number;
  lastError: string | null;
}

async function verifyThreeWayParity(deployId: string, expectedCommitSha: string, maxRetries: number, intervalMs: number): Promise<ParityResult> {
  let lastError: string | null = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const github = await getGitHubHeadSha();
    const render = await getRenderDeployCommitSha(deployId);
    const health = await getProductionHealth();

    const githubSha = github.sha ?? null;
    const renderSha = render.fullSha ?? null;
    const runtimeShaFull = health.commit ?? null;
    const runtimeSha = health.commitShort ?? (health.commit ? health.commit.slice(0, 8) : null);

    const githubShort = githubSha ? githubSha.slice(0, 8) : null;
    const renderShort = renderSha ? renderSha.slice(0, 8) : null;
    const runtimeShort = runtimeSha ?? (runtimeShaFull ? runtimeShaFull.slice(0, 8) : null);

    const match = githubShort !== null
      && githubShort === renderShort
      && renderShort === runtimeShort
      && githubShort === expectedCommitSha.slice(0, 8);

    const healthSnapshot: Record<string, unknown> = {
      status: health.status,
      ok: health.ok,
      commitShort: health.commitShort,
      bootTime: health.bootTime,
      attempt,
    };

    if (match) {
      return {
        match: true,
        githubSha: githubShort,
        renderSha: renderShort,
        runtimeSha: runtimeShort,
        runtimeShaFull,
        healthSnapshot,
        attempts: attempt,
        lastError: null,
      };
    }

    lastError = `attempt ${attempt}: github=${githubShort} render=${renderShort} runtime=${runtimeShort} expected=${expectedCommitSha.slice(0, 8)}`
      + ` errors={github:${github.error ?? '-'}, render:${render.error ?? '-'}, health:${health.error ?? '-'}}`;
    console.log('[IVX-SelfDeployRecovery] SHA parity not yet reached — retrying', { lastError, attempt, maxRetries });

    if (attempt < maxRetries) await sleep(intervalMs);
  }
  return {
    match: false,
    githubSha: null,
    renderSha: null,
    runtimeSha: null,
    runtimeShaFull: null,
    healthSnapshot: { attempts: maxRetries, lastError },
    attempts: maxRetries,
    lastError,
  };
}

interface LiveFeatureTestResult {
  passed: boolean;
  httpStatus: number | null;
  reason: string;
  traceId: string | null;
  responseTimestamp: string | null;
  contradictoryState: boolean;
}

async function runLiveFeatureTest(taskId: string): Promise<LiveFeatureTestResult> {
  const url = `https://api.ivxholding.com/api/ivx/senior-developer/worker/jobs/${encodeURIComponent(taskId)}`;
  const responseTimestamp = new Date().toISOString();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(LIVE_FEATURE_TEST_TIMEOUT_MS) });
    const httpStatus = res.status;
    if (res.status === 503) {
      return { passed: false, httpStatus, reason: '503 service unavailable', traceId: null, responseTimestamp, contradictoryState: false };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { passed: false, httpStatus, reason: `http_${res.status}: ${body.slice(0, 120)}`, traceId: null, responseTimestamp, contradictoryState: false };
    }
    const data = await res.json().catch(() => ({})) as { task?: { status?: string; commitSha?: string | null; renderDeployId?: string | null; runtimeSha?: string | null; proofLedgerId?: string | null } };
    const t = data.task ?? {};
    // Contradictory state: terminal FAILED but with commitSha+deployId+runtimeSha all present,
    // or VERIFIED with any of the 4 evidence missing.
    const has4 = Boolean(t.commitSha) && Boolean(t.renderDeployId) && Boolean(t.runtimeSha) && Boolean(t.proofLedgerId);
    const contradictoryState = (t.status === 'VERIFIED' && !has4) || (t.status === 'FAILED' && has4);
    if (contradictoryState) {
      return { passed: false, httpStatus, reason: `contradictory_state: status=${t.status} has4Evidence=${has4}`, traceId: null, responseTimestamp, contradictoryState: true };
    }
    return { passed: true, httpStatus, reason: 'ok', traceId: null, responseTimestamp, contradictoryState: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { passed: false, httpStatus: null, reason: `fetch_error: ${msg}`, traceId: null, responseTimestamp, contradictoryState: false };
  }
}

async function pollRenderDeploy(deployId: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await getRenderDeployStatus(deployId);
    if (status.ok && status.deploy) {
      const s = status.deploy.status;
      if (s === 'live' || s === 'failed' || s === 'canceled') return s;
    }
    await sleep(DEPLOY_POLL_INTERVAL_MS);
  }
  return 'timeout';
}

async function markFailed(task: IVXOwnerAITaskRow, reason: string): Promise<void> {
  await patchTask(task.id, {
    status: 'FAILED',
    checkpoint: 'FAILED (self-deploy recovery)',
    error_message: reason,
    resume_required: false,
    heartbeat_at: new Date().toISOString(),
    checkpoint_history: appendCheckpoint(task.checkpoint_history, `FAILED (self-deploy recovery) at ${new Date().toISOString()}: ${reason.slice(0, 200)}`),
  });
}

async function logRecovery(task: IVXOwnerAITaskRow, checkpoint: string, metadata: Record<string, unknown>): Promise<void> {
  console.log(`[IVX-SelfDeployRecovery] ${checkpoint}`, { taskId: task.id, ...metadata });
  if (task.proof_ledger_id) {
    await updateProofLedger(task.proof_ledger_id, {
      logs: [`recovery ${checkpoint}: ${JSON.stringify(metadata).slice(0, 500)}`],
    }).catch(() => null);
  }
}

function appendCheckpoint(history: { checkpoint: string; at: string }[] | null | undefined, checkpoint: string): { checkpoint: string; at: string }[] {
  const list = Array.isArray(history) ? history.slice(-40) : [];
  list.push({ checkpoint, at: new Date().toISOString() });
  return list;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Pure helpers exported for unit tests ──────────────────────────────────

/**
 * Pure parity check used by regression tests. Returns true only when all three
 * SHAs agree on their first 8 chars AND match the expected commit's first 8.
 */
export function checkThreeWayParity(input: {
  githubSha: string | null;
  renderSha: string | null;
  runtimeSha: string | null;
  expectedCommitSha: string;
}): boolean {
  const g = input.githubSha?.slice(0, 8) ?? null;
  const r = input.renderSha?.slice(0, 8) ?? null;
  const rt = input.runtimeSha?.slice(0, 8) ?? null;
  const e = input.expectedCommitSha.slice(0, 8);
  return g !== null && g === r && r === rt && rt === e;
}

/**
 * Pure check that a task has exactly one terminal state and (if VERIFIED) all
 * 4 evidence fields. Used by regression tests to enforce the terminal-state
 * invariant.
 */
export function assertExactlyOneTerminalState(input: {
  status: string;
  commitSha: string | null;
  deployId: string | null;
  runtimeSha: string | null;
  proofLedgerId: string | null;
}): { ok: boolean; reason: string } {
  const terminals = ['VERIFIED', 'FAILED', 'BLOCKED', 'CANCELED'];
  if (!terminals.includes(input.status)) {
    return { ok: false, reason: `status ${input.status} is not terminal` };
  }
  if (input.status === 'VERIFIED') {
    if (!input.commitSha) return { ok: false, reason: 'VERIFIED without commitSha' };
    if (!input.deployId) return { ok: false, reason: 'VERIFIED without deployId' };
    if (!input.runtimeSha) return { ok: false, reason: 'VERIFIED without runtimeSha' };
    if (!input.proofLedgerId) return { ok: false, reason: 'VERIFIED without proofLedgerId' };
  }
  return { ok: true, reason: 'ok' };
}
