/**
 * IVX Self-Upgrade Tool System — Self-Upgrade Agent.
 *
 * IVX can PROPOSE and BUILD new tools, but must NOT activate them until the test
 * gate passes. This agent chains the full safe lifecycle end-to-end:
 *   propose (pick an approved, not-yet-installed safe tool)
 *   → build (register PENDING via the installer)
 *   → test (the 5-phase gate runs inside the installer)
 *   → activate ONLY if every phase passed
 *   → use (execute the freshly-activated tool once, recording a real run)
 *   → proof (a labeled, evidence-backed report).
 *
 * This is the BLOCK success test: "IVX creates one new safe tool, tests it,
 * registers it, uses it, and returns proof." Every output is labeled with the
 * tool-output evidence vocabulary; nothing is faked.
 */
import { APPROVED_TOOL_CATALOG, getCatalogTool, scanToolForSafety, TOOL_OUTPUT_LABEL, } from './ivx-tool-catalog';
import { installToolDefinition } from './ivx-tool-installer';
import { getToolByName, recordToolRun, } from './ivx-tool-registry-store';
export const IVX_TOOL_SELF_UPGRADE_MARKER = 'ivx-tool-self-upgrade-2026-06-05';
/**
 * Propose the next safe tool to build: the first approved-catalog tool that is
 * (a) not already installed and (b) safe + non-approval-gated, so the agent can
 * build it autonomously. Returns null when every safe tool is already installed.
 */
export async function proposeNextTool() {
    for (const def of APPROVED_TOOL_CATALOG) {
        const scan = scanToolForSafety(def);
        if (!scan.safe || scan.requiresApproval)
            continue;
        const existing = await getToolByName(def.name);
        if (existing && existing.enabled && existing.testStatus === 'passed')
            continue;
        return {
            name: def.name,
            purpose: def.purpose,
            riskLevel: scan.riskLevel,
            requiresApproval: scan.requiresApproval,
            approvalCategories: scan.approvalCategories,
            rationale: existing
                ? `"${def.name}" is registered but not yet verified/enabled — rebuild + re-test to activate it.`
                : `"${def.name}" is a safe, deterministic, read-only primitive (risk ${scan.riskLevel}) not yet in the registry — safe to build autonomously without owner approval.`,
        };
    }
    return null;
}
/**
 * Execute an ENABLED, verified tool once and record a real run. Refuses to run a
 * tool that is not enabled/passed (returns a NOT EXECUTED proof) so a tool can
 * never be "used" before it has passed the gate.
 */
export async function useTool(name, input) {
    const record = await getToolByName(name);
    const def = getCatalogTool(name);
    if (!record || !def) {
        return {
            used: false,
            label: TOOL_OUTPUT_LABEL.NOT_EXECUTED,
            input,
            output: null,
            detail: `Tool "${name}" is not registered — nothing to run.`,
        };
    }
    if (!record.enabled || record.testStatus !== 'passed') {
        return {
            used: false,
            label: TOOL_OUTPUT_LABEL.NOT_EXECUTED,
            input,
            output: null,
            detail: `Tool "${name}" is not active (enabled=${record.enabled}, testStatus=${record.testStatus}) — it must pass the test gate before use.`,
        };
    }
    try {
        const output = def.run(input);
        const label = output.ok ? TOOL_OUTPUT_LABEL.VERIFIED : TOOL_OUTPUT_LABEL.FAILED;
        if (output.ok) {
            await recordToolRun(record.id, label);
        }
        return {
            used: output.ok,
            label,
            input,
            output,
            detail: output.ok
                ? `Tool "${name}" executed and produced a real, verified result.`
                : `Tool "${name}" ran but reported a failure: ${output.error ?? 'unknown'}.`,
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'tool handler threw.';
        return {
            used: false,
            label: TOOL_OUTPUT_LABEL.FAILED,
            input,
            output: null,
            detail: `Tool "${name}" threw during execution: ${message}`,
        };
    }
}
/**
 * Run the full self-upgrade lifecycle for ONE tool. If `name` is omitted, the
 * agent proposes the next safe tool itself. This is the end-to-end success-test
 * entry point: propose → build → test → activate → use → proof.
 */
export async function runSelfUpgrade(name, env = process.env) {
    // 1. Propose.
    let proposal;
    if (name) {
        const def = getCatalogTool(name);
        if (!def) {
            return {
                marker: IVX_TOOL_SELF_UPGRADE_MARKER,
                ok: false,
                proposal: null,
                install: null,
                usage: null,
                registered: null,
                finalLabel: TOOL_OUTPUT_LABEL.NOT_EXECUTED,
                summary: `No approved-catalog tool named "${name}" — self-upgrade restricted to the approved source.`,
            };
        }
        const scan = scanToolForSafety(def);
        proposal = {
            name: def.name,
            purpose: def.purpose,
            riskLevel: scan.riskLevel,
            requiresApproval: scan.requiresApproval,
            approvalCategories: scan.approvalCategories,
            rationale: `Owner-requested build of approved tool "${def.name}".`,
        };
    }
    else {
        proposal = await proposeNextTool();
    }
    if (!proposal) {
        return {
            marker: IVX_TOOL_SELF_UPGRADE_MARKER,
            ok: true,
            proposal: null,
            install: null,
            usage: null,
            registered: null,
            finalLabel: TOOL_OUTPUT_LABEL.NOT_EXECUTED,
            summary: 'No new safe tool to build — every approved safe tool is already verified and enabled.',
        };
    }
    // 2–4. Build → test → activate (the installer enforces "no activation without passing").
    const def = getCatalogTool(proposal.name);
    const install = await installToolDefinition(def, { source: 'self_upgrade', env });
    if (!install.ok) {
        return {
            marker: IVX_TOOL_SELF_UPGRADE_MARKER,
            ok: false,
            proposal,
            install,
            usage: null,
            registered: install.registered,
            finalLabel: install.status === 'tests_failed' ? TOOL_OUTPUT_LABEL.FAILED : TOOL_OUTPUT_LABEL.NOT_EXECUTED,
            summary: `Self-upgrade halted before activation: ${install.reason}`,
        };
    }
    // 5. Use the freshly-activated tool once.
    const usage = await useTool(proposal.name, def.sandbox.input);
    const registered = await getToolByName(proposal.name);
    const ok = install.ok && usage.used;
    return {
        marker: IVX_TOOL_SELF_UPGRADE_MARKER,
        ok,
        proposal,
        install,
        usage,
        registered,
        finalLabel: ok ? TOOL_OUTPUT_LABEL.VERIFIED : usage.label,
        summary: ok
            ? `IVX proposed, built, tested (all phases passed), registered, ENABLED, and USED "${proposal.name}" — verified end-to-end with proof.`
            : `Tool "${proposal.name}" installed + enabled, but the post-activation use did not verify: ${usage.detail}`,
    };
}
