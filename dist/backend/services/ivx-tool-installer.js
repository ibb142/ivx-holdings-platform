/**
 * IVX Self-Upgrade Tool System — Tool Installer.
 *
 * Adds a new tool from the APPROVED catalog only. The install flow enforces three
 * non-negotiable safety rules from the owner spec:
 *   - no auto-install without a safety scan,
 *   - no secret exposure (required secrets are env-var NAMES, never values),
 *   - no destructive tools without owner approval.
 *
 * Install flow: scan → (gate destructive behind approval) → register PENDING
 * (disabled, untested) → run the full test gate → enable ONLY if every phase
 * passed. The tool can never become enabled without passing verification.
 *
 * Deterministic + free of network/AI; the only side effect is the durable
 * registry write. Fully unit-testable.
 */
import { getCatalogTool, scanToolForSafety, } from './ivx-tool-catalog';
import { getToolByName, recordToolTest, registerTool, setToolEnabled, } from './ivx-tool-registry-store';
import { testTool, toToolTestReport } from './ivx-tool-tester';
export const IVX_TOOL_INSTALLER_MARKER = 'ivx-tool-installer-2026-06-05';
/**
 * Install a tool definition through the full safety + test gate. Used by the
 * self-upgrade agent and the owner API.
 */
export async function installToolDefinition(def, options = {}) {
    const env = options.env ?? process.env;
    const scan = scanToolForSafety(def);
    // Rule: no unsafe tool may be installed at all.
    if (!scan.safe) {
        return {
            marker: IVX_TOOL_INSTALLER_MARKER,
            ok: false,
            toolName: def.name,
            status: 'blocked_unsafe',
            registered: null,
            scan,
            test: null,
            reason: `Tool failed the safety scan and was not installed: ${scan.issues.join(' ')}`,
        };
    }
    // Rule: no destructive tool without explicit owner approval.
    if (scan.requiresApproval && !options.ownerApproved) {
        return {
            marker: IVX_TOOL_INSTALLER_MARKER,
            ok: false,
            toolName: def.name,
            status: 'blocked_requires_approval',
            registered: null,
            scan,
            test: null,
            reason: `Tool requires owner approval before install because it touches: ${scan.approvalCategories.join(', ')}. Re-run with ownerApproved=true to authorize.`,
        };
    }
    // Register PENDING (disabled, untested) — registration never enables.
    const registered = await registerTool({
        name: def.name,
        purpose: def.purpose,
        permissions: def.permissions,
        riskLevel: scan.riskLevel,
        requiredSecrets: def.requiredSecrets,
        requiresApproval: scan.requiresApproval,
        approvalCategories: scan.approvalCategories,
        source: options.source ?? 'approved_catalog',
    });
    // Run the full test gate.
    const test = testTool(def, env);
    const afterTest = await recordToolTest(registered.id, toToolTestReport(test));
    if (!test.passed) {
        return {
            marker: IVX_TOOL_INSTALLER_MARKER,
            ok: false,
            toolName: def.name,
            status: 'tests_failed',
            registered: afterTest ?? registered,
            scan,
            test,
            reason: `Tool registered but NOT enabled — it failed the test gate: ${test.phases
                .filter((p) => !p.passed)
                .map((p) => `${p.phase} (${p.label})`)
                .join(', ') || 'unknown failure'}.`,
        };
    }
    // Activate only after every phase passed.
    const enabled = await setToolEnabled(registered.id, true);
    return {
        marker: IVX_TOOL_INSTALLER_MARKER,
        ok: true,
        toolName: def.name,
        status: 'installed_and_enabled',
        registered: enabled ?? afterTest ?? registered,
        scan,
        test,
        reason: `Tool passed every test phase and is now ENABLED (risk ${scan.riskLevel}).`,
    };
}
/** Install a tool by its catalog name. Rejects unknown tools. */
export async function installToolByName(name, options = {}) {
    const def = getCatalogTool(name);
    if (!def) {
        return {
            marker: IVX_TOOL_INSTALLER_MARKER,
            ok: false,
            toolName: name,
            status: 'blocked_unknown_tool',
            registered: null,
            scan: null,
            test: null,
            reason: `No approved-catalog tool named "${name}". Installs are restricted to the approved source.`,
        };
    }
    return installToolDefinition(def, options);
}
/** Whether a tool of this name is already registered (any state). */
export async function isToolInstalled(name) {
    return (await getToolByName(name)) !== null;
}
