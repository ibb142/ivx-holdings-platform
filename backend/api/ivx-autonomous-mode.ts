/**
 * IVX Autonomous Mode API.
 *
 * Runs the full 12-step autonomous lifecycle for an owner task. Interactive
 * owner sessions and the repo/ref/workflow-scoped GitHub Actions OIDC machine
 * identity may invoke the low-risk autonomous loop. Guarded destructive/payment/
 * credential/security actions remain held by the lifecycle safety gates.
 */
import { runAutonomousMode } from '../services/ivx-autonomous-mode';
import { checkToolAvailability } from '../services/ivx-tool-availability';
import { verifyIVXGitHubActionsOIDCRequest } from '../services/ivx-github-actions-oidc';
import { buildAutonomousMissionContext, getProjectCompletionMandate } from '../services/ivx-project-vision';
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';

export const OPTIONS = (): Response => ownerOnlyOptions();

async function requireOwnerOrTrustedAutomation(request: Request): Promise<{ ok: true; source: 'owner' | 'github_oidc' } | { ok: false; response: Response }> {
  if (await verifyIVXGitHubActionsOIDCRequest(request)) {
    return { ok: true, source: 'github_oidc' };
  }
  try {
    const owner = await assertIVXOwnerOnly(request);
    if (!owner.userId) {
      return { ok: false, response: ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401) };
    }
    return { ok: true, source: 'owner' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'IVX owner authentication required.';
    const status = message.toLowerCase().includes('missing bearer') ? 401 : 403;
    return { ok: false, response: ownerOnlyJson({ ok: false, error: message }, status) };
  }
}

/** GET /api/ivx/autonomous-mode/tools — live tool/access availability + mission mandate. */
export async function handleAutonomousModeToolsRequest(request: Request): Promise<Response> {
  const auth = await requireOwnerOrTrustedAutomation(request);
  if (!auth.ok) return auth.response;
  try {
    const report = checkToolAvailability();
    return ownerOnlyJson({ ok: true, authSource: auth.source, report, mission: getProjectCompletionMandate() });
  } catch (error) {
    return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to check tool availability.' }, 500);
  }
}

/** POST /api/ivx/autonomous-mode/run — run the full autonomous lifecycle with the permanent IVX mission context. */
export async function handleAutonomousModeRunRequest(request: Request): Promise<Response> {
  const auth = await requireOwnerOrTrustedAutomation(request);
  if (!auth.ok) return auth.response;

  let body: { task?: unknown; conversationId?: unknown; approverEmail?: unknown; includeMission?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return ownerOnlyJson({ ok: false, error: 'Invalid JSON body.' }, 400);
  }

  const ownerTask = typeof body.task === 'string' ? body.task.trim() : '';
  if (!ownerTask) {
    return ownerOnlyJson({ ok: false, error: 'A non-empty "task" string is required.' }, 400);
  }

  try {
    // Mission context is on by default so Autonomous never interprets an empty
    // known-work queue as "the app is finished". Tests/internal callers can opt
    // out explicitly when they need exact legacy task text.
    const task = body.includeMission === false ? ownerTask : buildAutonomousMissionContext(ownerTask);
    const report = await runAutonomousMode(task, {
      conversationId: typeof body.conversationId === 'string' ? body.conversationId : null,
      approverEmail: typeof body.approverEmail === 'string' ? body.approverEmail : undefined,
    });
    return ownerOnlyJson({
      ok: true,
      authSource: auth.source,
      ownerTask,
      mission: getProjectCompletionMandate(),
      report,
    });
  } catch (error) {
    return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Autonomous mode run failed.' }, 500);
  }
}
