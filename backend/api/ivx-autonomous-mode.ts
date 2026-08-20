/**
 * IVX Autonomous Mode API (owner-only).
 *
 * Owner-triggered runs use the intelligent wrapper: the builder performs the
 * lifecycle, while an independent quality controller decides whether the
 * evidence is strong enough to remain VERIFIED.
 */
import { runIntelligentAutonomousMode } from '../services/ivx-autonomous-intelligent-mode';
import { checkToolAvailability } from '../services/ivx-tool-availability';
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';

export const OPTIONS = (): Response => ownerOnlyOptions();

async function requireOwner(request: Request): Promise<{ ok: true } | { ok: false; response: Response }> {
  try {
    const owner = await assertIVXOwnerOnly(request);
    if (!owner.userId) {
      return { ok: false, response: ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401) };
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'IVX owner authentication required.';
    const status = message.toLowerCase().includes('missing bearer') ? 401 : 403;
    return { ok: false, response: ownerOnlyJson({ ok: false, error: message }, status) };
  }
}

/** GET /api/ivx/autonomous-mode/tools — live tool/access availability. */
export async function handleAutonomousModeToolsRequest(request: Request): Promise<Response> {
  const auth = await requireOwner(request);
  if (!auth.ok) return auth.response;
  try {
    const report = checkToolAvailability();
    return ownerOnlyJson({ ok: true, report });
  } catch (error) {
    return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to check tool availability.' }, 500);
  }
}

/** POST /api/ivx/autonomous-mode/run — run and independently certify the autonomous lifecycle. */
export async function handleAutonomousModeRunRequest(request: Request): Promise<Response> {
  const auth = await requireOwner(request);
  if (!auth.ok) return auth.response;

  let body: { task?: unknown; conversationId?: unknown; approverEmail?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return ownerOnlyJson({ ok: false, error: 'Invalid JSON body.' }, 400);
  }

  const task = typeof body.task === 'string' ? body.task.trim() : '';
  if (!task) {
    return ownerOnlyJson({ ok: false, error: 'A non-empty "task" string is required.' }, 400);
  }

  try {
    const report = await runIntelligentAutonomousMode(task, {
      conversationId: typeof body.conversationId === 'string' ? body.conversationId : null,
      approverEmail: typeof body.approverEmail === 'string' ? body.approverEmail : undefined,
    });
    return ownerOnlyJson({ ok: true, report });
  } catch (error) {
    return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Autonomous mode run failed.' }, 500);
  }
}
