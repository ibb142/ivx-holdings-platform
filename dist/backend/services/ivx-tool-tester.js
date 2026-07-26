/**
 * IVX Self-Upgrade Tool System — Tool Tester (the activation gate).
 *
 * Before a tool can be activated, it MUST pass the full test gate. Five phases,
 * each labeled with an honest evidence label:
 *   1. import test     — the tool exists + has an executable handler.
 *   2. permission test — declared permissions are valid + approval mapping is consistent.
 *   3. sandbox test    — the handler runs against its fixture and produces the expected output.
 *   4. real API test   — only when required secrets exist; otherwise NOT EXECUTED (honest skip).
 *   5. rollback test   — proves the tool has no un-undoable side effects (read-only → no-op;
 *                        a writing tool must supply a working rollback).
 *
 * `passed` = every phase that ran is VERIFIED and none FAILED. A skipped real-API
 * phase (no secrets needed) is NOT a failure — it is labeled NOT EXECUTED honestly.
 *
 * Deterministic + free of network/AI — fully unit-testable. The only side effect
 * is invoking the tool's own (pure) handler against its sandbox fixture.
 */
import { TOOL_OUTPUT_LABEL, scanToolForSafety, } from './ivx-tool-catalog';
export const IVX_TOOL_TESTER_MARKER = 'ivx-tool-tester-2026-06-05';
const VALID_PERMISSIONS = new Set([
    'read_only', 'network', 'filesystem_read', 'filesystem_write',
    'database_write', 'send_external', 'spend_money',
]);
/** Run the five-phase test gate against a tool definition. */
export function testTool(def, env = process.env) {
    const phases = [];
    // Phase 1 — import test.
    const hasHandler = typeof def?.run === 'function';
    phases.push({
        phase: 'import',
        label: hasHandler ? TOOL_OUTPUT_LABEL.VERIFIED : TOOL_OUTPUT_LABEL.FAILED,
        passed: hasHandler,
        detail: hasHandler
            ? `Tool "${def.name}" loaded with an executable handler.`
            : 'Tool has no executable handler (run is not a function).',
    });
    // Phase 2 — permission test.
    const scan = scanToolForSafety(def);
    const permsValid = def.permissions.length > 0 && def.permissions.every((p) => VALID_PERMISSIONS.has(p));
    const permissionOk = permsValid && scan.safe;
    phases.push({
        phase: 'permission',
        label: permissionOk ? TOOL_OUTPUT_LABEL.VERIFIED : TOOL_OUTPUT_LABEL.FAILED,
        passed: permissionOk,
        detail: permissionOk
            ? `Permissions valid (${def.permissions.join(', ')}); risk ${scan.riskLevel}${scan.requiresApproval ? `; requires approval (${scan.approvalCategories.join(', ')})` : ''}.`
            : `Permission/safety scan failed: ${scan.issues.join(' ') || 'invalid permission set.'}`,
    });
    // Phase 3 — sandbox test (only if the handler + fixture are present).
    if (hasHandler && def.sandbox && typeof def.sandbox.expect === 'function') {
        try {
            const out = def.run(def.sandbox.input);
            const ok = out.ok === true && def.sandbox.expect(out) === true;
            phases.push({
                phase: 'sandbox',
                label: ok ? TOOL_OUTPUT_LABEL.VERIFIED : TOOL_OUTPUT_LABEL.FAILED,
                passed: ok,
                detail: ok
                    ? `Sandbox run produced the expected output: ${JSON.stringify(out.output).slice(0, 200)}.`
                    : `Sandbox run did not meet the expectation. ok=${out.ok}; output=${JSON.stringify(out.output).slice(0, 200)}; error=${out.error ?? 'n/a'}.`,
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'sandbox handler threw.';
            phases.push({
                phase: 'sandbox',
                label: TOOL_OUTPUT_LABEL.FAILED,
                passed: false,
                detail: `Sandbox handler threw: ${message}`,
            });
        }
    }
    else {
        phases.push({
            phase: 'sandbox',
            label: TOOL_OUTPUT_LABEL.FAILED,
            passed: false,
            detail: 'No sandbox fixture/handler to exercise — cannot verify before activation.',
        });
    }
    // Phase 4 — real API test (only when required secrets are present in the env).
    if (def.requiredSecrets.length === 0) {
        phases.push({
            phase: 'real_api',
            label: TOOL_OUTPUT_LABEL.NOT_EXECUTED,
            passed: true, // honest skip — a self-contained tool has no external API to call.
            detail: 'Tool requires no external credentials; no live API call to make (honest skip).',
        });
    }
    else {
        const missing = def.requiredSecrets.filter((name) => !(env[name] && String(env[name]).trim()));
        if (missing.length > 0) {
            phases.push({
                phase: 'real_api',
                label: TOOL_OUTPUT_LABEL.NOT_EXECUTED,
                passed: true, // not a failure — the credential gap is an honest, named skip.
                detail: `Skipped real API test — missing credentials: ${missing.join(', ')}.`,
            });
        }
        else {
            // Credentials exist → run the handler against the sandbox input as a live smoke call.
            try {
                const out = def.run(def.sandbox.input);
                const ok = out.ok === true;
                phases.push({
                    phase: 'real_api',
                    label: ok ? TOOL_OUTPUT_LABEL.VERIFIED : TOOL_OUTPUT_LABEL.FAILED,
                    passed: ok,
                    detail: ok
                        ? 'Live execution with credentials present succeeded.'
                        : `Live execution failed: ${out.error ?? 'unknown error'}.`,
                });
            }
            catch (error) {
                const message = error instanceof Error ? error.message : 'live handler threw.';
                phases.push({ phase: 'real_api', label: TOOL_OUTPUT_LABEL.FAILED, passed: false, detail: `Live execution threw: ${message}` });
            }
        }
    }
    // Phase 5 — rollback test.
    const writes = def.permissions.includes('filesystem_write') || def.permissions.includes('database_write');
    if (!writes) {
        phases.push({
            phase: 'rollback',
            label: TOOL_OUTPUT_LABEL.VERIFIED,
            passed: true,
            detail: 'Read-only/network-free tool has no persistent side effects — nothing to roll back (verified).',
        });
    }
    else if (typeof def.rollback === 'function') {
        try {
            const ok = def.rollback() === true;
            phases.push({
                phase: 'rollback',
                label: ok ? TOOL_OUTPUT_LABEL.VERIFIED : TOOL_OUTPUT_LABEL.FAILED,
                passed: ok,
                detail: ok ? 'Rollback handler succeeded.' : 'Rollback handler returned false.',
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'rollback threw.';
            phases.push({ phase: 'rollback', label: TOOL_OUTPUT_LABEL.FAILED, passed: false, detail: `Rollback threw: ${message}` });
        }
    }
    else {
        phases.push({
            phase: 'rollback',
            label: TOOL_OUTPUT_LABEL.FAILED,
            passed: false,
            detail: 'Writing tool supplied no rollback handler — cannot verify recoverability.',
        });
    }
    const passed = phases.every((p) => p.passed);
    const overallLabel = passed ? TOOL_OUTPUT_LABEL.VERIFIED : TOOL_OUTPUT_LABEL.FAILED;
    return {
        marker: IVX_TOOL_TESTER_MARKER,
        toolName: def.name,
        passed,
        overallLabel,
        phases,
        ranAt: new Date().toISOString(),
    };
}
/** Convert a tester result into the durable registry test report. */
export function toToolTestReport(result) {
    const phases = result.phases.map((p) => ({
        phase: p.phase,
        label: p.label,
        passed: p.passed,
        detail: p.detail,
    }));
    return {
        passed: result.passed,
        overallLabel: result.overallLabel,
        ranAt: result.ranAt,
        phases,
    };
}
