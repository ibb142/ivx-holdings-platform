/**
 * IVX Autonomous Mode API (owner-only).
 *
 * The single entry point that runs the full 12-step autonomous lifecycle for an
 * owner task — with the six human-approval safety gates enforced server-side:
 *   POST /api/ivx/autonomous-mode/run    { task, conversationId? } → full proof report
 *   GET  /api/ivx/autonomous-mode/tools  → live tool/access availability report
 *
 * Owner-gated via the same guard as the rest of the IVX developer surface.
 */
import { runAutonomousMode } from '../services/ivx-autonomous-mode';
import { checkToolAvailability } from '../services/ivx-tool-availability';
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
export const OPTIONS = () => ownerOnlyOptions();
async function requireOwner(request) {
    try {
        const owner = await assertIVXOwnerOnly(request);
        if (!owner.userId) {
            return { ok: false, response: ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401) };
        }
        return { ok: true };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'IVX owner authentication required.';
        const status = message.toLowerCase().includes('missing bearer') ? 401 : 403;
        return { ok: false, response: ownerOnlyJson({ ok: false, error: message }, status) };
    }
}
/** GET /api/ivx/autonomous-mode/tools — live tool/access availability. */
export async function handleAutonomousModeToolsRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    try {
        const report = checkToolAvailability();
        return ownerOnlyJson({ ok: true, report });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to check tool availability.' }, 500);
    }
}
/** POST /api/ivx/autonomous-mode/run — run the full autonomous lifecycle for a task. */
export async function handleAutonomousModeRunRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    let body;
    try {
        body = (await request.json());
    }
    catch {
        return ownerOnlyJson({ ok: false, error: 'Invalid JSON body.' }, 400);
    }
    const task = typeof body.task === 'string' ? body.task.trim() : '';
    if (!task) {
        return ownerOnlyJson({ ok: false, error: 'A non-empty "task" string is required.' }, 400);
    }
    try {
        const report = await runAutonomousMode(task, {
            conversationId: typeof body.conversationId === 'string' ? body.conversationId : null,
            approverEmail: typeof body.approverEmail === 'string' ? body.approverEmail : undefined,
        });
        // HTTP stays 200 — the lifecycle ran; the truthful outcome lives in finalStatus.
        return ownerOnlyJson({ ok: true, report });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Autonomous mode run failed.' }, 500);
    }
}
