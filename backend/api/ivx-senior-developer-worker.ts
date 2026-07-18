/**
 * Owner-gated HTTP surface for the IVX self-hosted Senior Developer Worker.
 *
 * These endpoints let IVX IA (or the owner directly) submit and track real
 * development tasks WITHOUT Rork acting as the executor. Every mutating route
 * requires a verified registered-owner bearer (or the system key). The worker
 * itself runs the real GitHub/Render/test pipeline.
 */
import {
  IVX_SENIOR_DEV_WORKER_MARKER,
  buildSeniorDeveloperWorkerStatus,
  enqueueOrAttachSeniorDeveloperJob,
  cancelSeniorDeveloperJob,
  getActiveJobForOwner,
  getSeniorDeveloperJob,
  getSeniorDeveloperLastProof,
  listSeniorDeveloperJobs,
  listSeniorDeveloperProofLedger,
  resumeSeniorDeveloperJob,
  type IVXWorkerJobInput,
} from '../services/ivx-senior-developer-worker';
import {
  IVXOwnerApprovalError,
  assertIVXOwnerOnly,
  assertIVXRegisteredOwnerBearer,
  ownerOnlyJson,
  ownerOnlyOptions,
} from './owner-only';

type WorkerEnqueueRequest = {
  goal?: unknown;
  templateMode?: unknown;
  proposedPlan?: unknown;
  filesAffected?: unknown;
  riskLevel?: unknown;
  rollbackOption?: unknown;
  approvePatch?: unknown;
  approveGitDeploy?: unknown;
  validationMode?: unknown;
};

const TEMPLATE_MODES = [
  'NEW_APP_FROM_SCRATCH',
  'NEW_MODULE_FROM_SCRATCH',
  'NEW_FEATURE',
  'BUG_FIX',
  'REFACTOR',
  'BUSINESS_WORKFLOW',
  'INVESTOR_WORKFLOW',
  'CRM_WORKFLOW',
] as const;

type WorkerTemplateMode = (typeof TEMPLATE_MODES)[number];

function normalizeTemplateMode(value: unknown): WorkerTemplateMode {
  const raw = readTrimmed(value).toUpperCase();
  return (TEMPLATE_MODES as readonly string[]).includes(raw) ? (raw as WorkerTemplateMode) : 'NEW_FEATURE';
}

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readBoolean(value: unknown): boolean {
  return value === true || readTrimmed(value).toLowerCase() === 'true';
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => readTrimmed(item)).filter(Boolean))).slice(0, 25);
}

function normalizeRiskLevel(value: unknown): 'low' | 'medium' | 'high' {
  const risk = readTrimmed(value).toLowerCase();
  return risk === 'low' || risk === 'high' ? risk : 'medium';
}

function normalizeValidationMode(value: unknown): 'focused' | 'typecheck' {
  return readTrimmed(value).toLowerCase() === 'typecheck' ? 'typecheck' : 'focused';
}

function statusForError(error: unknown): number {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  // Auth guard failures must return 401/403, never 500.
  if (message.includes('missing bearer token') || message.includes('invalid or expired')) return 401;
  if (message.includes('privileged ivx access is required') || message.includes('owner') || message.includes('auth guard failed') || message.includes('auth config failed') || message.includes('role guard failed')) return 403;
  return 500;
}

function errorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : 'IVX senior developer worker failed.';
  if (error instanceof IVXOwnerApprovalError) {
    return ownerOnlyJson({
      ok: false,
      ownerOnly: true,
      marker: IVX_SENIOR_DEV_WORKER_MARKER,
      error: message.slice(0, 500),
      ownerApproval: error.proof,
      exactBlocker: error.proof.blocker ?? message.slice(0, 500),
      secretValuesReturned: false,
      timestamp: new Date().toISOString(),
    }, error.status);
  }
  return ownerOnlyJson({
    ok: false,
    marker: IVX_SENIOR_DEV_WORKER_MARKER,
    error: message.slice(0, 500),
    secretValuesReturned: false,
    timestamp: new Date().toISOString(),
  }, statusForError(error));
}

export function OPTIONS(): Response {
  return ownerOnlyOptions();
}

/** GET worker status — capability snapshot. Owner-gated (read). */
export async function handleSeniorDeveloperWorkerStatusRequest(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    return ownerOnlyJson({ ...buildSeniorDeveloperWorkerStatus(), ownerOnly: true });
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST a new owner-approved job to the worker queue. */
export async function handleSeniorDeveloperWorkerEnqueueRequest(request: Request): Promise<Response> {
  try {
    const { approval } = await assertIVXRegisteredOwnerBearer(request, 'senior_developer_worker_enqueue');
    const body = await request.json().catch((): WorkerEnqueueRequest => ({}));
    const goal = readTrimmed(body.goal);
    const templateMode = normalizeTemplateMode(body.templateMode);
    const isSystemMode = approval.role === 'system' && approval.guardMode === 'system_bypass';
    const proposedPlan = readTrimmed(body.proposedPlan);
    const filesAffected = readStringArray(body.filesAffected);
    const riskLevel = normalizeRiskLevel(body.riskLevel);
    const rollbackOption = readTrimmed(body.rollbackOption);
    const approveGitDeploy = readBoolean(body.approveGitDeploy);

    if (!goal) {
      return ownerOnlyJson({
        ok: false,
        marker: IVX_SENIOR_DEV_WORKER_MARKER,
        error: 'A senior developer goal is required.',
        ownerApproval: approval,
        secretValuesReturned: false,
        timestamp: new Date().toISOString(),
      }, 400);
    }

    if (!isSystemMode && approveGitDeploy && (!proposedPlan || filesAffected.length === 0 || !rollbackOption)) {
      return ownerOnlyJson({
        ok: false,
        marker: IVX_SENIOR_DEV_WORKER_MARKER,
        error: 'Owner-approved production mutation requires a visible proposed plan, files affected, risk level, and rollback option before commit/deploy.',
        exactBlocker: 'approval_contract_missing_plan_files_or_rollback',
        requiredFields: ['proposedPlan', 'filesAffected', 'riskLevel', 'rollbackOption'],
        ownerApproval: approval,
        secretValuesReturned: false,
        timestamp: new Date().toISOString(),
      }, 400);
    }

    const ownerApprovedAction = {
      proposedPlan,
      filesAffected,
      riskLevel,
      rollbackOption,
      rollbackAvailable: rollbackOption.length > 0,
      auditLog: [
        `templateMode=${templateMode}`,
        `ownerSessionDetected=${approval.ownerSessionDetected}`,
        `bearerAccepted=${approval.bearerAccepted}`,
        `ownerVerified=${approval.ownerVerified}`,
        `role=${approval.role}`,
        `guardMode=${approval.guardMode}`,
        `filesAffected=${filesAffected.join(', ')}`,
        `riskLevel=${riskLevel}`,
      ],
      secretValuesReturned: false as const,
    };

    // Prefix the execution template so the worker scaffolds the right shape of
    // work (whole app, module, feature, fix, refactor, or a business workflow).
    const ownerId = approval.ownerSessionDetected ? (approval as Record<string, unknown>).userId as string ?? 'owner' : 'owner';
    const input: IVXWorkerJobInput = {
      goal: `[TEMPLATE_MODE:${templateMode}] ${goal}`,
      ownerApproved: true,
      approvePatch: readBoolean(body.approvePatch),
      approveGitDeploy,
      validationMode: normalizeValidationMode(body.validationMode),
      systemMode: isSystemMode,
      ownerApprovedAction,
      ownerId,
    };

    const { job, attached, activeJobId } = await enqueueOrAttachSeniorDeveloperJob(input);
    const statusCode = attached ? 409 : 202;
    return ownerOnlyJson({
      ok: attached ? false : true,
      ownerOnly: true,
      ownerApproval: approval,
      marker: IVX_SENIOR_DEV_WORKER_MARKER,
      job,
      jobId: job.jobId,
      attached,
      activeJobId: activeJobId ?? (attached ? job.jobId : null),
      templateMode,
      poll: `GET /api/ivx/senior-developer/worker/jobs/${job.jobId}`,
      message: attached
        ? `A job is already running for this owner. Your request was attached to the active job (${job.jobId}). Poll its status instead of creating a duplicate.`
        : 'Job enqueued. Poll the job endpoint for status updates.',
      secretValuesReturned: false,
      timestamp: new Date().toISOString(),
    }, statusCode);
  } catch (error) {
    return errorResponse(error);
  }
}

/** GET the active job for the current owner. Returns 204 if no active job. */
export async function handleSeniorDeveloperWorkerActiveJobRequest(request: Request): Promise<Response> {
  try {
    const { context, approval } = await assertIVXRegisteredOwnerBearer(request, 'senior_developer_worker_active');
    const ownerId = approval.ownerSessionDetected && context.userId ? context.userId : 'owner';
    const job = await getActiveJobForOwner(ownerId);
    if (!job) {
      return ownerOnlyJson({
        ok: true,
        ownerOnly: true,
        marker: IVX_SENIOR_DEV_WORKER_MARKER,
        activeJob: null,
        message: 'No active job for this owner.',
        secretValuesReturned: false,
      });
    }
    return ownerOnlyJson({
      ok: true,
      ownerOnly: true,
      marker: IVX_SENIOR_DEV_WORKER_MARKER,
      activeJob: job,
      jobId: job.jobId,
      stage: job.stage,
      progressPercent: job.progressPercent,
      stageDetail: job.stageDetail,
      secretValuesReturned: false,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST cancel a job by id. Owner-gated. */
export async function handleSeniorDeveloperWorkerCancelJobRequest(request: Request, jobId: string): Promise<Response> {
  try {
    const approval = await assertIVXRegisteredOwnerBearer(request, 'senior_developer_worker_cancel');
    const job = await cancelSeniorDeveloperJob(jobId);
    if (!job) {
      return ownerOnlyJson({
        ok: false,
        ownerOnly: true,
        marker: IVX_SENIOR_DEV_WORKER_MARKER,
        error: `No senior developer worker job found with id ${jobId}.`,
        secretValuesReturned: false,
        timestamp: new Date().toISOString(),
      }, 404);
    }
    return ownerOnlyJson({
      ok: true,
      ownerOnly: true,
      ownerApproval: approval,
      marker: IVX_SENIOR_DEV_WORKER_MARKER,
      job,
      cancelled: true,
      secretValuesReturned: false,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST resume a job by id. Owner-gated. */
export async function handleSeniorDeveloperWorkerResumeJobRequest(request: Request, jobId: string): Promise<Response> {
  try {
    const approval = await assertIVXRegisteredOwnerBearer(request, 'senior_developer_worker_resume');
    const job = await resumeSeniorDeveloperJob(jobId);
    if (!job) {
      return ownerOnlyJson({
        ok: false,
        ownerOnly: true,
        marker: IVX_SENIOR_DEV_WORKER_MARKER,
        error: `No senior developer worker job found with id ${jobId}.`,
        secretValuesReturned: false,
        timestamp: new Date().toISOString(),
      }, 404);
    }
    return ownerOnlyJson({
      ok: true,
      ownerOnly: true,
      ownerApproval: approval,
      marker: IVX_SENIOR_DEV_WORKER_MARKER,
      job,
      resumed: true,
      secretValuesReturned: false,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** GET one job by id. Owner-gated (read). */
export async function handleSeniorDeveloperWorkerJobRequest(request: Request, jobId: string): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const job = await getSeniorDeveloperJob(jobId);
    if (!job) {
      return ownerOnlyJson({
        ok: false,
        ownerOnly: true,
        marker: IVX_SENIOR_DEV_WORKER_MARKER,
        error: `No senior developer worker job found with id ${jobId}.`,
        secretValuesReturned: false,
        timestamp: new Date().toISOString(),
      }, 404);
    }
    return ownerOnlyJson({ ok: true, ownerOnly: true, marker: IVX_SENIOR_DEV_WORKER_MARKER, job, secretValuesReturned: false });
  } catch (error) {
    return errorResponse(error);
  }
}

/** GET recent jobs. Owner-gated (read). */
export async function handleSeniorDeveloperWorkerJobsRequest(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const jobs = await listSeniorDeveloperJobs(25);
    return ownerOnlyJson({ ok: true, ownerOnly: true, marker: IVX_SENIOR_DEV_WORKER_MARKER, jobs, secretValuesReturned: false });
  } catch (error) {
    return errorResponse(error);
  }
}

/** GET the durable proof ledger. Owner-gated (read). */
export async function handleSeniorDeveloperWorkerLedgerRequest(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const ledger = await listSeniorDeveloperProofLedger(25);
    return ownerOnlyJson({ ok: true, ownerOnly: true, marker: IVX_SENIOR_DEV_WORKER_MARKER, ledger, secretValuesReturned: false });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * GET the last proof — compact view of the most recent worker ledger entry.
 * Owner-gated (read). Returns nulls when the ledger is empty.
 */
export async function handleSeniorDeveloperWorkerLastProofRequest(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const proof = await getSeniorDeveloperLastProof();
    return ownerOnlyJson({
      ok: true,
      ownerOnly: true,
      marker: IVX_SENIOR_DEV_WORKER_MARKER,
      ...proof,
      secretValuesReturned: false,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
