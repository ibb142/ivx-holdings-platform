/**
 * IVX Failure Recovery API — owner-only endpoints for the controlled failure
 * and recovery QA system (2026-07-27).
 *
 * Routes:
 *   GET  /api/ivx/failure-recovery/status           → recovery system status
 *   POST /api/ivx/failure-recovery/register          → register a recoverable job
 *   POST /api/ivx/failure-recovery/checkpoint        → save a checkpoint
 *   POST /api/ivx/failure-recovery/complete          → mark job completed
 *   POST /api/ivx/failure-recovery/fail              → report a failure
 *   POST /api/ivx/failure-recovery/resume            → resume a paused job
 *   GET  /api/ivx/failure-recovery/job/:id           → get a checkpoint
 *   GET  /api/ivx/failure-recovery/checkpoints       → list all checkpoints
 *   GET  /api/ivx/failure-recovery/deadletter        → list deadletter entries
 *   POST /api/ivx/failure-recovery/deadletter/:id/inspect   → mark inspected
 *   POST /api/ivx/failure-recovery/deadletter/:id/replay    → replay entry
 *   POST /api/ivx/failure-recovery/deadletter/:id/discard   → discard entry
 *   POST /api/ivx/failure-recovery/rehydrate         → trigger boot rehydration
 *   POST /api/ivx/failure-recovery/inject-failure    → arm controlled failure injection
 *   POST /api/ivx/failure-recovery/execute           → execute a job with recovery
 */
import {
  IVX_FAILURE_RECOVERY_MARKER,
  registerRecoverableJob,
  saveCheckpoint,
  completeJob,
  reportFailure,
  resumeJob,
  getCheckpoint,
  listCheckpoints,
  listDeadletter,
  inspectDeadletterEntry,
  replayDeadletterEntry,
  discardDeadletterEntry,
  rehydrateOnBoot,
  getRecoveryStatus,
  armFailureInjection,
  disarmFailureInjection,
  executeWithRecovery,
  type RegisterJobInput,
} from '../services/ivx-failure-recovery';
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';

export const OPTIONS = (): Response => ownerOnlyOptions();

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** GET /api/ivx/failure-recovery/status */
export async function handleRecoveryStatusRequest(request: Request): Promise<Response> {
  try {
    const owner = await assertIVXOwnerOnly(request);
    if (!owner.userId) return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'IVX owner authentication required.';
    return ownerOnlyJson({ ok: false, error: message }, 401);
  }
  const status = await getRecoveryStatus();
  return ownerOnlyJson({ ok: true, ...status });
}

/** POST /api/ivx/failure-recovery/register */
export async function handleRecoveryRegisterRequest(request: Request): Promise<Response> {
  let owner;
  try {
    owner = await assertIVXOwnerOnly(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'IVX owner authentication required.';
    return ownerOnlyJson({ ok: false, error: message }, 401);
  }
  if (!owner.userId) return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);

  const body = await readBody(request);
  const idempotencyKey = readTrimmed(body.idempotencyKey);
  const kind = readTrimmed(body.kind);
  const description = readTrimmed(body.description);
  if (!idempotencyKey || !kind) {
    return ownerOnlyJson({ ok: false, error: 'idempotencyKey and kind are required.' }, 400);
  }

  const input: RegisterJobInput = {
    idempotencyKey,
    kind,
    description: description || kind,
    totalSteps: Number.isFinite(Number(body.totalSteps)) ? Math.max(1, Number(body.totalSteps)) : 5,
    maxAttempts: Number.isFinite(Number(body.maxAttempts)) ? Math.min(Math.max(Number(body.maxAttempts), 1), 10) : 3,
    baseBackoffMs: Number.isFinite(Number(body.baseBackoffMs)) ? Math.max(100, Number(body.baseBackoffMs)) : 1000,
  };

  const result = await registerRecoverableJob(input);
  return ownerOnlyJson({
    ok: true,
    job: result.job,
    isIdempotencyHit: result.isIdempotencyHit,
  });
}

/** POST /api/ivx/failure-recovery/checkpoint */
export async function handleRecoveryCheckpointRequest(request: Request): Promise<Response> {
  let owner;
  try {
    owner = await assertIVXOwnerOnly(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'IVX owner authentication required.';
    return ownerOnlyJson({ ok: false, error: message }, 401);
  }
  if (!owner.userId) return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);

  const body = await readBody(request);
  const jobId = readTrimmed(body.jobId);
  const completedStep = Number(body.completedStep);
  if (!jobId || !Number.isFinite(completedStep)) {
    return ownerOnlyJson({ ok: false, error: 'jobId and completedStep are required.' }, 400);
  }

  const checkpoint = await saveCheckpoint(jobId, completedStep, body.stepResult);
  if (!checkpoint) return ownerOnlyJson({ ok: false, error: 'job not found' }, 404);
  return ownerOnlyJson({ ok: true, checkpoint });
}

/** POST /api/ivx/failure-recovery/complete */
export async function handleRecoveryCompleteRequest(request: Request): Promise<Response> {
  let owner;
  try {
    owner = await assertIVXOwnerOnly(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'IVX owner authentication required.';
    return ownerOnlyJson({ ok: false, error: message }, 401);
  }
  if (!owner.userId) return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);

  const body = await readBody(request);
  const jobId = readTrimmed(body.jobId);
  if (!jobId) return ownerOnlyJson({ ok: false, error: 'jobId is required.' }, 400);

  const checkpoint = await completeJob(jobId, body.result ?? null);
  if (!checkpoint) return ownerOnlyJson({ ok: false, error: 'job not found' }, 404);
  return ownerOnlyJson({ ok: true, checkpoint });
}

/** POST /api/ivx/failure-recovery/fail */
export async function handleRecoveryFailRequest(request: Request): Promise<Response> {
  let owner;
  try {
    owner = await assertIVXOwnerOnly(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'IVX owner authentication required.';
    return ownerOnlyJson({ ok: false, error: message }, 401);
  }
  if (!owner.userId) return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);

  const body = await readBody(request);
  const jobId = readTrimmed(body.jobId);
  if (!jobId) return ownerOnlyJson({ ok: false, error: 'jobId is required.' }, 400);

  const error = body.error ?? body.message ?? 'Unknown failure';
  const result = await reportFailure(jobId, error);
  return ownerOnlyJson({
    ok: true,
    retried: result.retried,
    deadlettered: result.deadlettered,
    nextAttemptIn: result.nextAttemptIn,
    job: result.job,
  });
}

/** POST /api/ivx/failure-recovery/resume */
export async function handleRecoveryResumeRequest(request: Request): Promise<Response> {
  let owner;
  try {
    owner = await assertIVXOwnerOnly(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'IVX owner authentication required.';
    return ownerOnlyJson({ ok: false, error: message }, 401);
  }
  if (!owner.userId) return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);

  const body = await readBody(request);
  const jobId = readTrimmed(body.jobId);
  if (!jobId) return ownerOnlyJson({ ok: false, error: 'jobId is required.' }, 400);

  const result = await resumeJob(jobId);
  return ownerOnlyJson({
    ok: true,
    resumed: result.resumed,
    fromStep: result.fromStep,
    job: result.job,
  });
}

/** GET /api/ivx/failure-recovery/job/:id */
export async function handleRecoveryGetJobRequest(request: Request, jobId: string): Promise<Response> {
  let owner;
  try {
    owner = await assertIVXOwnerOnly(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'IVX owner authentication required.';
    return ownerOnlyJson({ ok: false, error: message }, 401);
  }
  if (!owner.userId) return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);

  const checkpoint = getCheckpoint(jobId);
  if (!checkpoint) return ownerOnlyJson({ ok: false, error: 'job not found' }, 404);
  return ownerOnlyJson({ ok: true, checkpoint });
}

/** GET /api/ivx/failure-recovery/checkpoints */
export async function handleRecoveryListCheckpointsRequest(request: Request): Promise<Response> {
  let owner;
  try {
    owner = await assertIVXOwnerOnly(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'IVX owner authentication required.';
    return ownerOnlyJson({ ok: false, error: message }, 401);
  }
  if (!owner.userId) return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);

  return ownerOnlyJson({ ok: true, checkpoints: listCheckpoints() });
}

/** GET /api/ivx/failure-recovery/deadletter */
export async function handleRecoveryListDeadletterRequest(request: Request): Promise<Response> {
  let owner;
  try {
    owner = await assertIVXOwnerOnly(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'IVX owner authentication required.';
    return ownerOnlyJson({ ok: false, error: message }, 401);
  }
  if (!owner.userId) return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);

  return ownerOnlyJson({ ok: true, deadletter: listDeadletter() });
}

/** POST /api/ivx/failure-recovery/deadletter/:id/inspect */
export async function handleRecoveryInspectDeadletterRequest(request: Request, jobId: string): Promise<Response> {
  let owner;
  try {
    owner = await assertIVXOwnerOnly(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'IVX owner authentication required.';
    return ownerOnlyJson({ ok: false, error: message }, 401);
  }
  if (!owner.userId) return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);

  const entry = await inspectDeadletterEntry(jobId);
  if (!entry) return ownerOnlyJson({ ok: false, error: 'deadletter entry not found' }, 404);
  return ownerOnlyJson({ ok: true, entry });
}

/** POST /api/ivx/failure-recovery/deadletter/:id/replay */
export async function handleRecoveryReplayDeadletterRequest(request: Request, jobId: string): Promise<Response> {
  let owner;
  try {
    owner = await assertIVXOwnerOnly(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'IVX owner authentication required.';
    return ownerOnlyJson({ ok: false, error: message }, 401);
  }
  if (!owner.userId) return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);

  const result = await replayDeadletterEntry(jobId);
  if (!result.replayed) return ownerOnlyJson({ ok: false, error: 'deadletter entry not found' }, 404);
  return ownerOnlyJson({ ok: true, job: result.job });
}

/** POST /api/ivx/failure-recovery/deadletter/:id/discard */
export async function handleRecoveryDiscardDeadletterRequest(request: Request, jobId: string): Promise<Response> {
  let owner;
  try {
    owner = await assertIVXOwnerOnly(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'IVX owner authentication required.';
    return ownerOnlyJson({ ok: false, error: message }, 401);
  }
  if (!owner.userId) return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);

  const discarded = await discardDeadletterEntry(jobId);
  if (!discarded) return ownerOnlyJson({ ok: false, error: 'deadletter entry not found' }, 404);
  return ownerOnlyJson({ ok: true, discarded: true });
}

/** POST /api/ivx/failure-recovery/rehydrate */
export async function handleRecoveryRehydrateRequest(request: Request): Promise<Response> {
  let owner;
  try {
    owner = await assertIVXOwnerOnly(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'IVX owner authentication required.';
    return ownerOnlyJson({ ok: false, error: message }, 401);
  }
  if (!owner.userId) return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);

  const result = await rehydrateOnBoot();
  return ownerOnlyJson({ ok: true, ...result });
}

/** POST /api/ivx/failure-recovery/inject-failure */
export async function handleRecoveryInjectFailureRequest(request: Request): Promise<Response> {
  let owner;
  try {
    owner = await assertIVXOwnerOnly(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'IVX owner authentication required.';
    return ownerOnlyJson({ ok: false, error: message }, 401);
  }
  if (!owner.userId) return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);

  const body = await readBody(request);
  const jobId = readTrimmed(body.jobId);
  const failAtStep = Number(body.failAtStep);
  const failureClass = readTrimmed(body.failureClass) === 'permanent' ? 'permanent' : 'transient';
  const errorMessage = readTrimmed(body.errorMessage) || 'Injected controlled failure';
  if (!jobId || !Number.isFinite(failAtStep)) {
    return ownerOnlyJson({ ok: false, error: 'jobId and failAtStep are required.' }, 400);
  }

  if (body.disarm === true) {
    disarmFailureInjection(jobId);
    return ownerOnlyJson({ ok: true, disarmed: true });
  }

  armFailureInjection(jobId, { failAtStep, failureClass: failureClass as 'transient' | 'permanent', errorMessage });
  return ownerOnlyJson({ ok: true, armed: true, jobId, failAtStep, failureClass, errorMessage });
}

/** POST /api/ivx/failure-recovery/execute */
export async function handleRecoveryExecuteRequest(request: Request): Promise<Response> {
  let owner;
  try {
    owner = await assertIVXOwnerOnly(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'IVX owner authentication required.';
    return ownerOnlyJson({ ok: false, error: message }, 401);
  }
  if (!owner.userId) return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);

  const body = await readBody(request);
  const jobId = readTrimmed(body.jobId);
  if (!jobId) return ownerOnlyJson({ ok: false, error: 'jobId is required.' }, 400);

  // The caller provides step descriptions; we execute them with recovery.
  // Diagnose failed job or step for actionable repair
const stepDescriptions = Array.isArray(body.steps) ? body.steps : [];
  const steps = stepDescriptions.map((desc: unknown) => {
    return async (_stepIndex: number, _results: Record<number, unknown>) => {
      // In production, steps are server-side functions. For the QA endpoint,
      // each step is a simulated async operation.
      return { description: typeof desc === 'string' ? desc : `step ${_stepIndex}`, completed: true };
    };
  });

  const result = await executeWithRecovery(jobId, steps);
  return ownerOnlyJson({
    ok: true,
    completed: result.completed,
    job: result.job,
  });
}

export { IVX_FAILURE_RECOVERY_MARKER };
