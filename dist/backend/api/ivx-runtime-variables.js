/**
 * IVX Runtime Variables API (owner-only).
 *
 * Makes every required credential/variable visible, status-classified, masked,
 * and verifiable from the owner dashboard:
 *   GET  /api/ivx/runtime-variables          → presence/status report (no probes)
 *   POST /api/ivx/runtime-variables/verify    → run REAL verification probes
 *   POST /api/ivx/runtime-variables/sync      → push a runtime-present var into
 *                                               the Render service env (real
 *                                               injection path). { name }
 *
 * Never returns a secret value — only presence/masked + verification pass/fail.
 * Sync mutations require the stronger registered-owner bearer guard.
 */
import { buildRuntimeVariablesReport, buildRuntimeVariablesAudit, verifyAllVariables, verifyVariable, syncVariableToRender, saveVariableValue, } from '../services/ivx-runtime-variables';
import { assertIVXOwnerOnly, assertIVXRegisteredOwnerBearer, IVXOwnerApprovalError, ownerOnlyJson, ownerOnlyOptions, } from './owner-only';
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
function readRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
async function parseBody(request) {
    try {
        return readRecord(await request.json());
    }
    catch {
        return {};
    }
}
/** GET /api/ivx/runtime-variables — presence/status report (no network probes). */
export async function handleRuntimeVariablesRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    try {
        const report = buildRuntimeVariablesReport();
        return ownerOnlyJson({ ok: true, report });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to build runtime-variables report.' }, 500);
    }
}
/**
 * POST /api/ivx/runtime-variables/verify — run REAL verification probes.
 * Body: { name?: string } — verify a single variable, or all when absent.
 */
export async function handleRuntimeVariablesVerifyRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    try {
        const body = await parseBody(request);
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (name) {
            const result = await verifyVariable(name);
            return ownerOnlyJson({ ok: true, result });
        }
        const report = await verifyAllVariables();
        return ownerOnlyJson({ ok: true, report });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Verification failed.' }, 500);
    }
}
/**
 * POST /api/ivx/runtime-variables/save — write a NEW value for a variable into the
 * Render service env (backend secret store). Stronger registered-owner gate; the
 * value is written but never echoed back. Runs verification immediately after save.
 * Body: { name: string, value: string }
 */
export async function handleRuntimeVariablesSaveRequest(request) {
    let approvalProof = null;
    try {
        const { approval } = await assertIVXRegisteredOwnerBearer(request, 'runtime_variables_save');
        approvalProof = approval;
    }
    catch (error) {
        if (error instanceof IVXOwnerApprovalError) {
            return ownerOnlyJson({ ok: false, error: error.message, approval: error.proof }, error.status);
        }
        const message = error instanceof Error ? error.message : 'Owner approval required.';
        return ownerOnlyJson({ ok: false, error: message }, 403);
    }
    try {
        const body = await parseBody(request);
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const value = typeof body.value === 'string' ? body.value : '';
        if (!name) {
            return ownerOnlyJson({ ok: false, error: 'A variable name is required.' }, 400);
        }
        if (!value.trim()) {
            return ownerOnlyJson({ ok: false, error: 'A non-empty value is required to save.' }, 400);
        }
        const result = await saveVariableValue(name, value);
        let verification = null;
        if (result.ok) {
            verification = await verifyVariable(name);
        }
        return ownerOnlyJson({ ok: result.ok, name, result, verification, approval: approvalProof }, result.ok ? 200 : 502);
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Save failed.' }, 500);
    }
}
/** GET /api/ivx/runtime-variables/audit — cross-scope per-variable audit (no probes). */
export async function handleRuntimeVariablesAuditRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    try {
        const audit = buildRuntimeVariablesAudit();
        return ownerOnlyJson({ ok: true, audit });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to build runtime-variables audit.' }, 500);
    }
}
/**
 * POST /api/ivx/runtime-variables/sync — push a runtime-present variable into
 * the Render service env (the real injection path). Stronger owner gate.
 * Body: { name: string }
 */
export async function handleRuntimeVariablesSyncRequest(request) {
    let approvalProof = null;
    try {
        const { approval } = await assertIVXRegisteredOwnerBearer(request, 'runtime_variables_sync');
        approvalProof = approval;
    }
    catch (error) {
        if (error instanceof IVXOwnerApprovalError) {
            return ownerOnlyJson({ ok: false, error: error.message, approval: error.proof }, error.status);
        }
        const message = error instanceof Error ? error.message : 'Owner approval required.';
        return ownerOnlyJson({ ok: false, error: message }, 403);
    }
    try {
        const body = await parseBody(request);
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name) {
            return ownerOnlyJson({ ok: false, error: 'A variable name is required.' }, 400);
        }
        const result = await syncVariableToRender(name);
        return ownerOnlyJson({ ok: result.ok, name, result, approval: approvalProof }, result.ok ? 200 : 502);
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Sync failed.' }, 500);
    }
}
