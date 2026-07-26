/**
 * IVX Self-Upgrade Tool System — Approved Tool Catalog + Safety Scanner.
 *
 * The "approved source" from which the installer can add new tools. Each catalog
 * entry is a REAL, in-process executable tool definition with a deterministic
 * handler, a sandbox fixture (input + expectation) the tester runs before
 * activation, and an optional rollback proof.
 *
 * No tool here touches the network, the filesystem, a database, money, or
 * external services — they are deliberately safe, read-only, deterministic
 * primitives so the self-upgrade lane can install + activate them without owner
 * approval. The scanner + approval mapping enforce that any tool with a
 * destructive permission CANNOT be auto-installed.
 *
 * Pure + deterministic — no I/O at module scope; fully unit-testable.
 */
import { createHash } from 'node:crypto';
export const IVX_TOOL_CATALOG_MARKER = 'ivx-tool-catalog-2026-06-05';
/**
 * Owner-facing evidence labels for a tool's output (extends the platform
 * EVIDENCE_CLASSIFICATION with FAILED so a tool failure is explicitly labeled).
 */
export const TOOL_OUTPUT_LABEL = {
    VERIFIED: 'VERIFIED',
    UNVERIFIED: 'UNVERIFIED',
    NOT_EXECUTED: 'NOT EXECUTED',
    SIMULATED: 'SIMULATED',
    FAILED: 'FAILED',
};
const asText = (value) => (typeof value === 'string' ? value : '');
/**
 * The approved source catalog. Three safe, deterministic, read-only primitives
 * IVX can install + use without owner approval.
 */
export const APPROVED_TOOL_CATALOG = [
    {
        name: 'text_analyzer',
        purpose: 'Count characters, words, lines, and sentences in a block of text.',
        permissions: ['read_only'],
        riskLevel: 'low',
        requiredSecrets: [],
        run: (input) => {
            const text = asText(input.text);
            const characters = text.length;
            const words = text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;
            const lines = text.length === 0 ? 0 : text.split(/\r\n|\r|\n/).length;
            const sentences = (text.match(/[.!?]+(\s|$)/g) ?? []).length;
            return { ok: true, output: { characters, words, lines, sentences } };
        },
        sandbox: {
            input: { text: 'Hello world. This is IVX.' },
            expect: (out) => out.ok && out.output.words === 5 && out.output.sentences === 2,
        },
    },
    {
        name: 'sha256_digest',
        purpose: 'Compute the SHA-256 hex digest of a text input (integrity checks).',
        permissions: ['read_only'],
        riskLevel: 'low',
        requiredSecrets: [],
        run: (input) => {
            const text = asText(input.text);
            const hex = createHash('sha256').update(text, 'utf8').digest('hex');
            return { ok: true, output: { algorithm: 'sha256', hex, length: hex.length } };
        },
        sandbox: {
            input: { text: 'ivx' },
            // Known SHA-256 of "ivx".
            expect: (out) => out.ok &&
                out.output.hex === createHash('sha256').update('ivx', 'utf8').digest('hex') &&
                out.output.length === 64,
        },
    },
    {
        name: 'json_validator',
        purpose: 'Validate and pretty-print a JSON string; report parse errors honestly.',
        permissions: ['read_only'],
        riskLevel: 'low',
        requiredSecrets: [],
        run: (input) => {
            const raw = asText(input.json);
            try {
                const parsed = JSON.parse(raw);
                return {
                    ok: true,
                    output: { valid: true, formatted: JSON.stringify(parsed, null, 2) },
                };
            }
            catch (error) {
                const message = error instanceof Error ? error.message : 'Invalid JSON.';
                return { ok: true, output: { valid: false, error: message } };
            }
        },
        sandbox: {
            input: { json: '{"a":1}' },
            expect: (out) => out.ok && out.output.valid === true,
        },
    },
];
/** Look up a catalog tool by name (case-insensitive). */
export function getCatalogTool(name) {
    const target = name.trim().toLowerCase();
    return APPROVED_TOOL_CATALOG.find((tool) => tool.name.toLowerCase() === target) ?? null;
}
/** List the catalog (names + purpose + risk), for the dashboard / installer UI. */
export function listCatalog() {
    return APPROVED_TOOL_CATALOG.map((tool) => ({
        name: tool.name,
        purpose: tool.purpose,
        riskLevel: tool.riskLevel,
        permissions: [...tool.permissions],
        requiredSecrets: [...tool.requiredSecrets],
    }));
}
/**
 * Map a tool's permissions to the owner-approval categories it trips. These map
 * the destructive permissions to the platform's six guarded categories.
 */
const PERMISSION_APPROVAL_MAP = [
    { permission: 'spend_money', category: 'payments' },
    { permission: 'database_write', category: 'production_schema' },
    { permission: 'filesystem_write', category: 'deletes' },
    { permission: 'send_external', category: 'external_publishing' },
];
/**
 * Determine whether a tool needs owner approval to install + the exact
 * categories. Read-only / network-free tools require none. A tool that declares
 * required secrets that look like credentials trips `credential_changes`.
 */
export function evaluateToolApproval(permissions, requiredSecrets = []) {
    const categories = new Set();
    for (const { permission, category } of PERMISSION_APPROVAL_MAP) {
        if (permissions.includes(permission))
            categories.add(category);
    }
    // A tool that requires a credential/secret to operate is a credential-change risk.
    if (requiredSecrets.some((s) => /key|token|secret|password|credential/i.test(s))) {
        categories.add('credential_changes');
    }
    return { requiresApproval: categories.size > 0, categories: [...categories] };
}
/** Derive a risk level from a tool's permission set (highest wins). */
export function deriveRiskLevel(permissions) {
    if (permissions.includes('spend_money') || permissions.includes('database_write'))
        return 'critical';
    if (permissions.includes('send_external') || permissions.includes('filesystem_write'))
        return 'high';
    if (permissions.includes('network') || permissions.includes('filesystem_read'))
        return 'medium';
    return 'low';
}
/**
 * Safety-scan a tool definition before install:
 *   - the handler must exist + be a function (no empty/unexecutable tools),
 *   - a sandbox fixture must be present (the tester needs it),
 *   - required secrets must be NAMES only (reject any value-looking secret),
 *   - a tool that writes MUST declare a rollback,
 *   - destructive permissions flag `requiresApproval` (the installer refuses to
 *     auto-install these without an explicit owner approval flag).
 *
 * `safe` = no hard issues. A tool can be `safe:true` AND `requiresApproval:true`
 * (well-formed but destructive); the installer still gates it behind approval.
 */
export function scanToolForSafety(def) {
    const issues = [];
    if (typeof def.run !== 'function') {
        issues.push('Tool has no executable handler (run is not a function).');
    }
    if (!def.sandbox || typeof def.sandbox.expect !== 'function') {
        issues.push('Tool has no sandbox fixture — cannot be verified before activation.');
    }
    for (const secret of def.requiredSecrets) {
        // Reject anything that looks like an actual secret VALUE (long opaque blob,
        // contains "=", or whitespace) — required secrets must be env-var names.
        if (/\s/.test(secret) || secret.includes('=') || secret.length > 64) {
            issues.push(`Required secret "${secret.slice(0, 12)}…" looks like a value, not an env-var name.`);
        }
    }
    const writes = def.permissions.includes('filesystem_write') ||
        def.permissions.includes('database_write');
    if (writes && typeof def.rollback !== 'function') {
        issues.push('Tool can write but declares no rollback — refused for safety.');
    }
    const approval = evaluateToolApproval(def.permissions, def.requiredSecrets);
    return {
        safe: issues.length === 0,
        riskLevel: deriveRiskLevel(def.permissions),
        requiresApproval: approval.requiresApproval,
        approvalCategories: approval.categories,
        issues,
    };
}
