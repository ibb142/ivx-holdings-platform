/**
 * IVX Engineering OS routes (owner-only).
 *
 * Exposes the 24/7 engineering mapping: the 12-team registry, the
 * continuous-loop task pipeline with its enforcement rules (RM-only deploy,
 * owner approval, VERIFIED evidence gate) and the 2-hour report.
 *
 * Reads require an owner session; mutations require a real registered owner
 * bearer. Owner approval of a production deploy additionally requires the
 * explicit confirmation phrase — a plain call returns 409 confirmationRequired.
 */
import {
  IVXOwnerApprovalError,
  assertIVXOwnerOnly,
  assertIVXRegisteredOwnerBearer,
  ownerOnlyJson,
  ownerOnlyOptions,
} from './owner-only';
import {
  IVX_ENGINEERING_OS_MARKER,
  IVX_ENGINEERING_PIPELINE,
  IVX_ENGINEERING_TEAMS,
  IVX_RELEASE_MANAGER_TEAM_ID,
  activateEngineeringOS,
  advanceEngineeringTask,
  approveEngineeringTask,
  createEngineeringTask,
  generateAndPostEngineeringReport,
  getEngineeringActivation,
  getLatestEngineeringReport,
  listEngineeringTasks,
  listEngineeringTeams,
  recordEngineeringEvidence,
  syncEngineeringTeams,
  type IVXEngineeringStage,
} from '../services/ivx-engineering-os';

export const IVX_ENGINEERING_APPROVAL_PHRASE = 'CONFIRM_IVX_PRODUCTION_APPROVAL';
export const IVX_ENGINEERING_ACTIVATION_PHRASE = 'CONFIRM_IVX_ENGINEERING_OS_ACTIVATION';

function errorResponse(error: unknown): Response {
  if (error instanceof IVXOwnerApprovalError) {
    return ownerOnlyJson({ status: 'error', error: error.message, approval: error.proof }, error.status);
  }
  const msg = error instanceof Error ? error.message : 'IVX engineering OS route failed.';
  const status = /bearer|unauthorized|forbidden|token/i.test(msg) ? 401 : 500;
  return ownerOnlyJson({ status: 'error', error: msg }, status);
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = (await request.json()) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function OPTIONS(): Response { return ownerOnlyOptions(); }

/** GET /api/ivx/engineering-os/teams — code registry + live DB state. */
export async function handleEngineeringTeams(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const dbTeams = await listEngineeringTeams();
    return ownerOnlyJson({
      status: 'ok',
      marker: IVX_ENGINEERING_OS_MARKER,
      releaseManagerTeamId: IVX_RELEASE_MANAGER_TEAM_ID,
      registry: IVX_ENGINEERING_TEAMS,
      dbTeams,
      dbSynced: dbTeams.length === IVX_ENGINEERING_TEAMS.length,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST /api/ivx/engineering-os/teams/sync — upsert the 12-team registry. */
export async function handleEngineeringTeamsSync(request: Request): Promise<Response> {
  try {
    await assertIVXRegisteredOwnerBearer(request, 'engineering_teams_sync');
    const result = await syncEngineeringTeams();
    return ownerOnlyJson({ status: result.ok ? 'ok' : 'error', ...result }, result.ok ? 200 : 502);
  } catch (error) {
    return errorResponse(error);
  }
}

/** GET /api/ivx/engineering-os/status — pipeline, rules and task counts. */
export async function handleEngineeringStatus(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const [tasks, activation] = await Promise.all([listEngineeringTasks(200), getEngineeringActivation()]);
    const countBy = (status: string): number => tasks.filter((t) => t.status === status).length;
    return ownerOnlyJson({
      status: 'ok',
      marker: IVX_ENGINEERING_OS_MARKER,
      activation,
      pipeline: IVX_ENGINEERING_PIPELINE,
      rules: {
        releaseManagerOnlyDeploy: IVX_RELEASE_MANAGER_TEAM_ID,
        ownerApprovalRequiredBeforeProductionDeploy: true,
        verifiedRequires: ['commitSha', 'renderDeployId', 'testResults', 'healthVerification'],
        emergencyStopEnforcedAtDeploy: true,
        reportCadenceHours: 2,
      },
      counts: {
        total: tasks.length,
        queued: countBy('QUEUED'),
        running: countBy('RUNNING'),
        waitingApproval: countBy('WAITING_APPROVAL'),
        retrying: countBy('RETRYING'),
        verified: countBy('VERIFIED'),
        failed: countBy('FAILED'),
        blocked: countBy('BLOCKED'),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** GET /api/ivx/engineering-os/tasks — recent tasks. */
export async function handleEngineeringTasksList(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const tasks = await listEngineeringTasks(100);
    return ownerOnlyJson({ status: 'ok', tasks });
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST /api/ivx/engineering-os/tasks — create a task at COLLECT_BUGS. */
export async function handleEngineeringTaskCreate(request: Request): Promise<Response> {
  try {
    const { context } = await assertIVXRegisteredOwnerBearer(request, 'engineering_task_create');
    const body = await readBody(request);
    const result = await createEngineeringTask({
      title: readString(body.title),
      detail: readString(body.detail) || null,
      teamId: readString(body.teamId),
      createdBy: context.email ?? null,
    });
    return ownerOnlyJson({ status: result.ok ? 'ok' : 'error', task: result.task, error: result.error }, result.ok ? 201 : 400);
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST /api/ivx/engineering-os/tasks/advance — one pipeline step with all gates. */
export async function handleEngineeringTaskAdvance(request: Request): Promise<Response> {
  try {
    await assertIVXRegisteredOwnerBearer(request, 'engineering_task_advance');
    const body = await readBody(request);
    const toStage = readString(body.toStage) as IVXEngineeringStage;
    if (!IVX_ENGINEERING_PIPELINE.includes(toStage)) {
      return ownerOnlyJson({ status: 'error', error: `Unknown stage '${toStage}'.`, pipeline: IVX_ENGINEERING_PIPELINE }, 400);
    }
    const result = await advanceEngineeringTask({
      taskId: readString(body.taskId),
      toStage,
      actorTeamId: readString(body.actorTeamId),
    });
    return ownerOnlyJson(
      { status: result.ok ? 'ok' : 'error', task: result.task, blocker: result.blocker, detail: result.detail },
      result.ok ? 200 : 409,
    );
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST /api/ivx/engineering-os/tasks/evidence — attach proof fields. */
export async function handleEngineeringTaskEvidence(request: Request): Promise<Response> {
  try {
    await assertIVXRegisteredOwnerBearer(request, 'engineering_task_evidence');
    const body = await readBody(request);
    const result = await recordEngineeringEvidence({
      taskId: readString(body.taskId),
      evidence: {
        commitSha: readString(body.commitSha) || null,
        renderDeployId: readString(body.renderDeployId) || null,
        testResults: readString(body.testResults) || null,
        healthVerification: readString(body.healthVerification) || null,
      },
    });
    return ownerOnlyJson({ status: result.ok ? 'ok' : 'error', task: result.task, error: result.error }, result.ok ? 200 : 400);
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * POST /api/ivx/engineering-os/tasks/approve — owner approval for a
 * production deploy. Requires confirm:true + the exact confirmation phrase;
 * otherwise responds 409 confirmationRequired (sensitive-action pattern).
 */
export async function handleEngineeringTaskApprove(request: Request): Promise<Response> {
  try {
    const { context } = await assertIVXRegisteredOwnerBearer(request, 'engineering_task_approve');
    const body = await readBody(request);
    if (body.confirm !== true || readString(body.confirmText) !== IVX_ENGINEERING_APPROVAL_PHRASE) {
      return ownerOnlyJson({
        status: 'error',
        confirmationRequired: true,
        error: `Owner approval of a production deploy requires confirm:true and confirmText:"${IVX_ENGINEERING_APPROVAL_PHRASE}".`,
      }, 409);
    }
    const result = await approveEngineeringTask({
      taskId: readString(body.taskId),
      approvedBy: context.email ?? 'owner',
    });
    return ownerOnlyJson({ status: result.ok ? 'ok' : 'error', task: result.task, error: result.error }, result.ok ? 200 : 400);
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * POST /api/ivx/engineering-os/activate — owner-approved Phase 1 activation.
 * Flips all 12 teams to ACTIVE. Requires confirm:true + the exact activation
 * phrase; otherwise responds 409 confirmationRequired (sensitive-action pattern).
 */
export async function handleEngineeringActivate(request: Request): Promise<Response> {
  try {
    const { context } = await assertIVXRegisteredOwnerBearer(request, 'engineering_os_activate');
    const body = await readBody(request);
    if (body.confirm !== true || readString(body.confirmText) !== IVX_ENGINEERING_ACTIVATION_PHRASE) {
      return ownerOnlyJson({
        status: 'error',
        confirmationRequired: true,
        error: `Engineering OS activation requires confirm:true and confirmText:"${IVX_ENGINEERING_ACTIVATION_PHRASE}".`,
      }, 409);
    }
    const result = await activateEngineeringOS({ approvedBy: context.email ?? 'owner' });
    const activation = await getEngineeringActivation();
    return ownerOnlyJson({
      status: result.ok ? 'ok' : 'error',
      activatedTeams: result.activatedTeams,
      alreadyActive: result.alreadyActive,
      approvedBy: result.approvedBy,
      activation,
      error: result.error,
    }, result.ok ? 200 : 502);
  } catch (error) {
    return errorResponse(error);
  }
}

/** GET /api/ivx/engineering-os/report — latest stored 2-hour report. */
export async function handleEngineeringReportLatest(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const report = await getLatestEngineeringReport();
    return ownerOnlyJson({ status: 'ok', report });
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST /api/ivx/engineering-os/report/run — generate + post a report now. */
export async function handleEngineeringReportRun(request: Request): Promise<Response> {
  try {
    await assertIVXRegisteredOwnerBearer(request, 'engineering_report_run');
    const result = await generateAndPostEngineeringReport();
    return ownerOnlyJson({
      status: result.ok ? 'ok' : 'error',
      reportId: result.reportId,
      postedToChat: result.postedToChat,
      body: result.body,
      error: result.error,
    }, result.ok ? 200 : 502);
  } catch (error) {
    return errorResponse(error);
  }
}
