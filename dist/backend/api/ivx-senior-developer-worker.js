/**
 * Owner-gated HTTP surface for the IVX self-hosted Senior Developer Worker.
 *
 * These endpoints let IVX IA (or the owner directly) submit and track real
 * development tasks WITHOUT Rork acting as the executor. Every mutating route
 * requires a verified registered-owner bearer (or the system key). The worker
 * itself runs the real GitHub/Render/test pipeline.
 */
import { IVX_SENIOR_DEV_WORKER_MARKER, buildSeniorDeveloperWorkerStatus, enqueueOrAttachSeniorDeveloperJob, cancelSeniorDeveloperJob, getActiveJobForOwner, getSeniorDeveloperJob, getSeniorDeveloperLastProof, listSeniorDeveloperJobs, listSeniorDeveloperProofLedger, resumeSeniorDeveloperJob, } from '../services/ivx-senior-developer-worker';
import { IVXOwnerApprovalError, assertIVXOwnerOnly, assertIVXRegisteredOwnerBearer, ownerOnlyJson, ownerOnlyOptions, } from './owner-only';
import { authorizeInternalDeploymentRequest, InternalDeployAuthError } from '../services/ivx-internal-deploy-auth';
const TEMPLATE_MODES = [
    'NEW_APP_FROM_SCRATCH',
    'NEW_MODULE_FROM_SCRATCH',
    'NEW_FEATURE',
    'BUG_FIX',
    'REFACTOR',
    'BUSINESS_WORKFLOW',
    'INVESTOR_WORKFLOW',
    'CRM_WORKFLOW',
];
function normalizeTemplateMode(value) {
    const raw = readTrimmed(value).toUpperCase();
    return TEMPLATE_MODES.includes(raw) ? raw : 'NEW_FEATURE';
}
function readTrimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function readBoolean(value) {
    return value === true || readTrimmed(value).toLowerCase() === 'true';
}
function readStringArray(value) {
    if (!Array.isArray(value))
        return [];
    return Array.from(new Set(value.map((item) => readTrimmed(item)).filter(Boolean))).slice(0, 25);
}
function normalizeRiskLevel(value) {
    const risk = readTrimmed(value).toLowerCase();
    return risk === 'low' || risk === 'high' ? risk : 'medium';
}
function normalizeValidationMode(value) {
    return readTrimmed(value).toLowerCase() === 'typecheck' ? 'typecheck' : 'focused';
}
const EXECUTION_MODES = ['read_only', 'qa_only', 'code_change', 'deploy'];
/**
 * Production mutations must not fall through to the legacy executor: it can
 * classify an implementation request as QA-only and reuse old deploy evidence.
 */
export function resolveWorkerExecutionMode(value, approvePatch, approveGitDeploy) {
    if (approveGitDeploy)
        return 'deploy';
    if (approvePatch)
        return 'code_change';
    const requested = readTrimmed(value).toLowerCase();
    if (EXECUTION_MODES.includes(requested)) {
        return requested;
    }
    return 'read_only';
}
function statusForError(error) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    // Auth guard failures must return 401/403, never 500.
    if (message.includes('missing bearer token') || message.includes('invalid or expired'))
        return 401;
    if (message.includes('privileged ivx access is required') || message.includes('owner') || message.includes('auth guard failed') || message.includes('auth config failed') || message.includes('role guard failed'))
        return 403;
    return 500;
}
function errorResponse(error) {
    const message = error instanceof Error ? error.message : 'IVX senior developer worker failed.';
    if (error instanceof InternalDeployAuthError) {
        return ownerOnlyJson({ ok: false, marker: IVX_SENIOR_DEV_WORKER_MARKER, error: message.slice(0, 500), secretValuesReturned: false, timestamp: new Date().toISOString() }, error.status);
    }
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
export function OPTIONS() {
    return ownerOnlyOptions();
}
/** Dedicated worker-only endpoint that atomically validates and consumes one approval. */
export async function handleInternalDeploymentAuthorizationConsumeRequest(request) {
    try {
        const authorization = await authorizeInternalDeploymentRequest(request);
        return ownerOnlyJson({
            ok: true,
            marker: IVX_SENIOR_DEV_WORKER_MARKER,
            authorization: {
                workerId: authorization.workerId,
                approvalId: authorization.approvalId,
                requestedCommitSha: authorization.requestedCommitSha,
                action: authorization.action,
            },
            secretValuesReturned: false,
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        return errorResponse(error);
    }
}
/** GET worker status — capability snapshot. Owner-gated (read). */
export async function handleSeniorDeveloperWorkerStatusRequest(request) {
    try {
        await assertIVXOwnerOnly(request);
        return ownerOnlyJson({ ...buildSeniorDeveloperWorkerStatus(), ownerOnly: true });
    }
    catch (error) {
        return errorResponse(error);
    }
}
/** POST a new owner-approved job to the worker queue. */
export async function handleSeniorDeveloperWorkerEnqueueRequest(request) {
    try {
        const signedWorkerRequest = request.headers.has('X-IVX-Deploy-Signature');
        const internalAuthorization = signedWorkerRequest ? await authorizeInternalDeploymentRequest(request) : null;
        const ownerAuthorization = internalAuthorization ? null : await assertIVXRegisteredOwnerBearer(request, 'senior_developer_worker_enqueue');
        const approval = ownerAuthorization?.approval ?? {
            ownerSessionDetected: true,
            bearerAccepted: true,
            ownerVerified: true,
            ownerEmailMatched: true,
            ownerEmailMasked: 'internal-worker',
            userId: `worker:${internalAuthorization?.workerId ?? 'unknown'}`,
            role: 'internal_worker',
            guardMode: 'strict',
            allowlistConfigured: true,
            action: 'senior_developer_worker_enqueue',
            blocker: null,
            secretValuesReturned: false,
        };
        const body = await request.json().catch(() => ({}));
        const goal = readTrimmed(body.goal);
        const templateMode = normalizeTemplateMode(body.templateMode);
        const isSystemMode = (approval.role === 'system' && approval.guardMode === 'system_bypass') || internalAuthorization !== null;
        const proposedPlan = readTrimmed(body.proposedPlan);
        const filesAffected = readStringArray(body.filesAffected);
        const riskLevel = normalizeRiskLevel(body.riskLevel);
        const rollbackOption = readTrimmed(body.rollbackOption);
        const approveGitDeploy = readBoolean(body.approveGitDeploy);
        const approvePatch = readBoolean(body.approvePatch);
        const executionMode = resolveWorkerExecutionMode(body.executionMode, approvePatch, approveGitDeploy);
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
                ...(internalAuthorization ? [`internalWorkerId=${internalAuthorization.workerId}`, `ownerApprovalId=${internalAuthorization.approvalId}`, `requestedCommitSha=${internalAuthorization.requestedCommitSha}`] : []),
            ],
            secretValuesReturned: false,
        };
        // Prefix the execution template so the worker scaffolds the right shape of
        // work (whole app, module, feature, fix, refactor, or a business workflow).
        const ownerId = internalAuthorization ? `worker:${internalAuthorization.workerId}` : (approval.ownerSessionDetected ? approval.userId ?? 'owner' : 'owner');
        const input = {
            goal: `[TEMPLATE_MODE:${templateMode}] ${goal}`,
            ownerApproved: true,
            approvePatch,
            approveGitDeploy,
            executionMode,
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
            executionMode,
            poll: `GET /api/ivx/senior-developer/worker/jobs/${job.jobId}`,
            message: attached
                ? `A job is already running for this owner. Your request was attached to the active job (${job.jobId}). Poll its status instead of creating a duplicate.`
                : 'Job enqueued. Poll the job endpoint for status updates.',
            secretValuesReturned: false,
            timestamp: new Date().toISOString(),
        }, statusCode);
    }
    catch (error) {
        return errorResponse(error);
    }
}
/** GET the active job for the current owner. Returns 204 if no active job. */
export async function handleSeniorDeveloperWorkerActiveJobRequest(request) {
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
    }
    catch (error) {
        return errorResponse(error);
    }
}
/** POST cancel a job by id. Owner-gated. */
export async function handleSeniorDeveloperWorkerCancelJobRequest(request, jobId) {
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
    }
    catch (error) {
        return errorResponse(error);
    }
}
/** POST resume a job by id. Owner-gated. */
export async function handleSeniorDeveloperWorkerResumeJobRequest(request, jobId) {
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
    }
    catch (error) {
        return errorResponse(error);
    }
}
/** GET one job by id. Owner-gated (read). */
export async function handleSeniorDeveloperWorkerJobRequest(request, jobId) {
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
    }
    catch (error) {
        return errorResponse(error);
    }
}
/** GET recent jobs. Owner-gated (read). */
export async function handleSeniorDeveloperWorkerJobsRequest(request) {
    try {
        await assertIVXOwnerOnly(request);
        const jobs = await listSeniorDeveloperJobs(25);
        return ownerOnlyJson({ ok: true, ownerOnly: true, marker: IVX_SENIOR_DEV_WORKER_MARKER, jobs, secretValuesReturned: false });
    }
    catch (error) {
        return errorResponse(error);
    }
}
/** GET the durable proof ledger. Owner-gated (read). */
export async function handleSeniorDeveloperWorkerLedgerRequest(request) {
    try {
        await assertIVXOwnerOnly(request);
        const ledger = await listSeniorDeveloperProofLedger(25);
        return ownerOnlyJson({ ok: true, ownerOnly: true, marker: IVX_SENIOR_DEV_WORKER_MARKER, ledger, secretValuesReturned: false });
    }
    catch (error) {
        return errorResponse(error);
    }
}
/**
 * GET the last proof — compact view of the most recent worker ledger entry.
 * Owner-gated (read). Returns nulls when the ledger is empty.
 */
export async function handleSeniorDeveloperWorkerLastProofRequest(request) {
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
    }
    catch (error) {
        return errorResponse(error);
    }
}
