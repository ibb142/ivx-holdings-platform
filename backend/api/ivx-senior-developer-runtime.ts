import {
  IVX_GIT_DEPLOY_CONFIRM_TEXT,
  IVX_SAFE_PATCH_CONFIRM_TEXT,
  IVX_SENIOR_DEVELOPER_RUNTIME_MARKER,
  auditIVXGithubRuntimeAccess,
  auditIVXProductionCredentialRuntime,
  buildIVXSeniorDeveloperStatusSnapshot,
  listSeniorDeveloperWorkSessions,
  runIVXSeniorDeveloperTask,
} from '../services/ivx-senior-developer-runtime';
import { checkPreExecutionGate } from '../services/ivx-pre-execution-gate-middleware';
import {
  enqueueOrAttachSeniorDeveloperJob,
  getActiveJobForOwner,
  type IVXWorkerJobInput,
} from '../services/ivx-senior-developer-worker';
import {
  IVXOwnerApprovalError,
  assertIVXOwnerOnly,
  assertIVXRegisteredOwnerBearer,
  ownerOnlyJson,
  ownerOnlyOptions,
} from './owner-only';

type SeniorDeveloperRiskLevel = 'low' | 'medium' | 'high';

type SeniorDeveloperRunRequest = {
  goal?: unknown;
  proposedPlan?: unknown;
  filesAffected?: unknown;
  riskLevel?: unknown;
  rollbackOption?: unknown;
  approvePatch?: unknown;
  patchConfirmationText?: unknown;
  approveGitDeploy?: unknown;
  gitDeployConfirmationText?: unknown;
  validationMode?: unknown;
};

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

function normalizeRiskLevel(value: unknown): SeniorDeveloperRiskLevel {
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
  const message = error instanceof Error ? error.message : 'IVX senior developer runtime failed.';
  if (error instanceof IVXOwnerApprovalError) {
    return ownerOnlyJson({
      ok: false,
      ownerOnly: true,
      marker: IVX_SENIOR_DEVELOPER_RUNTIME_MARKER,
      error: message.slice(0, 500),
      ownerApproval: error.proof,
      exactBlocker: error.proof.blocker ?? message.slice(0, 500),
      secretValuesReturned: false,
      timestamp: new Date().toISOString(),
    }, error.status);
  }

  return ownerOnlyJson({
    ok: false,
    marker: IVX_SENIOR_DEVELOPER_RUNTIME_MARKER,
    error: message.slice(0, 500),
    secretValuesReturned: false,
    timestamp: new Date().toISOString(),
  }, statusForError(error));
}

export function OPTIONS(): Response {
  return ownerOnlyOptions();
}

export async function handleIVXSeniorDeveloperStatusRequest(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const recentSessions = await listSeniorDeveloperWorkSessions(20);
    return ownerOnlyJson({
      ...buildIVXSeniorDeveloperStatusSnapshot(),
      ownerOnly: true,
      workSessionMemory: {
        durable: recentSessions.some((session) => session.durable),
        recentSessionCount: recentSessions.length,
        recentSessions,
      },
      routes: {
        status: 'GET /api/ivx/senior-developer/status',
        githubAudit: 'GET /api/ivx/senior-developer/github-audit',
        credentialAudit: 'GET /api/ivx/senior-developer/credential-audit',
        run: 'POST /api/ivx/senior-developer/run (requires real Supabase owner bearer + IVX_OWNER_REGISTRATION_EMAILS match for mutation)',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleIVXSeniorDeveloperGithubAuditRequest(request: Request): Promise<Response> {
  try {
    const { approval } = await assertIVXRegisteredOwnerBearer(request, 'senior_developer_github_audit');
    const github = await auditIVXGithubRuntimeAccess();
    return ownerOnlyJson({
      ok: github.canReadRepo && github.canPush,
      ownerOnly: true,
      ownerApproval: approval,
      marker: IVX_SENIOR_DEVELOPER_RUNTIME_MARKER,
      github,
      deniedByGithub: Boolean(github.auth.httpStatus && github.auth.httpStatus >= 400)
        || Boolean(github.repository.httpStatus && github.repository.httpStatus >= 400)
        || Boolean(github.branchRef.httpStatus && github.branchRef.httpStatus >= 400)
        || (github.canReadRepo && !github.canPush),
      secretValuesReturned: false,
      timestamp: new Date().toISOString(),
    }, github.canReadRepo && github.canPush ? 200 : 409);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleIVXSeniorDeveloperCredentialAuditRequest(request: Request): Promise<Response> {
  try {
    const { approval } = await assertIVXRegisteredOwnerBearer(request, 'senior_developer_github_render_audit');
    const audit = await auditIVXProductionCredentialRuntime();
    return ownerOnlyJson({
      ok: audit.ok,
      ownerOnly: true,
      ownerApproval: approval,
      marker: IVX_SENIOR_DEVELOPER_RUNTIME_MARKER,
      audit,
      exactBlocker: audit.ok ? null : audit.blockers[0] ?? 'Credential/runtime audit did not pass.',
      secretValuesReturned: false,
      timestamp: new Date().toISOString(),
    }, audit.ok ? 200 : 409);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleIVXSeniorDeveloperRunRequest(request: Request): Promise<Response> {
  try {
    const { approval } = await assertIVXRegisteredOwnerBearer(request, 'senior_developer_git_commit_render_deploy');
    const body = await request.json().catch((): SeniorDeveloperRunRequest => ({}));
    const goal = readTrimmed(body.goal);
    const isSystemMode = approval.role === 'system' && approval.guardMode === 'system_bypass';
    const proposedPlan = readTrimmed(body.proposedPlan);
    const filesAffected = readStringArray(body.filesAffected);
    const riskLevel = normalizeRiskLevel(body.riskLevel);
    const rollbackOption = readTrimmed(body.rollbackOption);
    const approveGitDeploy = readBoolean(body.approveGitDeploy);
    if (!goal) {
      return ownerOnlyJson({
        ok: false,
        marker: IVX_SENIOR_DEVELOPER_RUNTIME_MARKER,
        error: 'A senior developer goal is required.',
        requiredPatchConfirmationText: IVX_SAFE_PATCH_CONFIRM_TEXT,
        requiredGitDeployConfirmationText: IVX_GIT_DEPLOY_CONFIRM_TEXT,
        ownerApproval: approval,
        secretValuesReturned: false,
        timestamp: new Date().toISOString(),
      }, 400);
    }

    // ─── Pre-Execution Feasibility Gate (Stage 0) ───────────────────────────
    // Runs BEFORE the senior developer executor executes any patch, commit, push,
    // or deploy. The owner session is verified (assertIVXRegisteredOwnerBearer
    // succeeded above), so ownerSessionPresent = true.
    try {
      const gate = await checkPreExecutionGate(request, {
        prompt: goal,
        ownerSessionPresent: true,
        entryPoint: 'senior-developer-run',
      });
      if (gate.blocked && gate.response) {
        return gate.response;
      }
    } catch (gateError) {
      console.log('[IVXSeniorDeveloperRun] Pre-execution gate error (non-blocking):', gateError instanceof Error ? gateError.message : 'unknown');
    }

    if (!isSystemMode && approveGitDeploy && (!proposedPlan || filesAffected.length === 0 || !rollbackOption)) {
      return ownerOnlyJson({
        ok: false,
        marker: IVX_SENIOR_DEVELOPER_RUNTIME_MARKER,
        error: 'Owner-approved senior developer mutation requires a visible proposed plan, files affected, risk level, and rollback option before GitHub/Render execution.',
        exactBlocker: 'approval_contract_missing_plan_files_or_rollback',
        requiredFields: ['proposedPlan', 'filesAffected', 'riskLevel', 'rollbackOption'],
        ownerApproval: approval,
        secretValuesReturned: false,
        timestamp: new Date().toISOString(),
      }, 400);
    }

    const approvedAction = {
      proposedPlan,
      filesAffected,
      riskLevel,
      rollbackOption,
      rollbackAvailable: rollbackOption.length > 0,
      auditLog: [
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

    // ─── Per-Owner Single-Flight Queue (HTTP 409 FIX) ──────────────────
    // Route through the worker queue instead of synchronous execution.
    // If an active job already exists for this owner, ATTACH to it (return
    // its jobId) instead of creating a duplicate or returning HTTP 409.
    // The user's request is NEVER discarded — it is queued or attached.
    const ownerId = approval.ownerSessionDetected ? (approval as Record<string, unknown>).userId as string ?? 'owner' : 'owner';
    const activeJob = await getActiveJobForOwner(ownerId);
    if (activeJob) {
      return ownerOnlyJson({
        ok: false,
        ownerOnly: true,
        ownerApproval: approval,
        marker: IVX_SENIOR_DEVELOPER_RUNTIME_MARKER,
        error: 'A senior developer task is already running for this owner.',
        jobId: activeJob.jobId,
        activeJobId: activeJob.jobId,
        attached: true,
        activeJob,
        poll: `GET /api/ivx/senior-developer/worker/jobs/${activeJob.jobId}`,
        cancel: `POST /api/ivx/senior-developer/worker/jobs/${activeJob.jobId}/cancel`,
        message: `Your request was attached to the active job (${activeJob.jobId}). Poll its status or cancel it instead of creating a duplicate.`,
        secretValuesReturned: false,
        timestamp: new Date().toISOString(),
      }, 409);
    }

    // No active job — enqueue a new one through the worker queue.
    const workerInput: IVXWorkerJobInput = {
      goal,
      ownerApproved: true,
      approvePatch: readBoolean(body.approvePatch),
      approveGitDeploy,
      validationMode: normalizeValidationMode(body.validationMode),
      systemMode: isSystemMode,
      ownerApprovedAction: approvedAction,
      ownerId,
    };
    const { job, attached: wasAttached } = await enqueueOrAttachSeniorDeveloperJob(workerInput);

    // If the race condition produced an attach (another request enqueued
    // between our check and our enqueue), return the active job.
    if (wasAttached) {
      return ownerOnlyJson({
        ok: false,
        ownerOnly: true,
        ownerApproval: approval,
        marker: IVX_SENIOR_DEVELOPER_RUNTIME_MARKER,
        error: 'A senior developer task is already running for this owner.',
        jobId: job.jobId,
        activeJobId: job.jobId,
        attached: true,
        job,
        poll: `GET /api/ivx/senior-developer/worker/jobs/${job.jobId}`,
        cancel: `POST /api/ivx/senior-developer/worker/jobs/${job.jobId}/cancel`,
        message: `Your request was attached to the active job (${job.jobId}).`,
        secretValuesReturned: false,
        timestamp: new Date().toISOString(),
      }, 409);
    }

    return ownerOnlyJson({
      ok: true,
      ownerOnly: true,
      ownerApproval: approval,
      marker: IVX_SENIOR_DEVELOPER_RUNTIME_MARKER,
      jobId: job.jobId,
      job,
      stage: job.stage,
      progressPercent: job.progressPercent,
      stageDetail: job.stageDetail,
      poll: `GET /api/ivx/senior-developer/worker/jobs/${job.jobId}`,
      cancel: `POST /api/ivx/senior-developer/worker/jobs/${job.jobId}/cancel`,
      resume: `POST /api/ivx/senior-developer/worker/jobs/${job.jobId}/resume`,
      message: 'Task enqueued. Poll the job endpoint for real-time stage and progress updates.',
      secretValuesReturned: false,
      timestamp: new Date().toISOString(),
    }, 202);
  } catch (error) {
    return errorResponse(error);
  }
}
