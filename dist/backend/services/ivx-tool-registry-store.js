/**
 * IVX Self-Upgrade Tool System — Tool Registry (durable, owner-managed).
 *
 * After IVX is independent from Rork, IVX must be able to add, test, verify, and
 * use its own tools safely. The registry is the single source of truth for every
 * IVX-native tool: name, purpose, permissions, risk level, enabled/disabled,
 * required secrets, and test status.
 *
 * HARD HONESTY RULE (platform-wide, enforced here):
 *   - A tool is only `enabled` after it has PASSED the full test gate. Registering
 *     a tool never enables it; activation requires `testStatus === 'passed'`.
 *   - `lastSuccessfulRunAt` only advances on a REAL successful execution.
 *   - Required secrets are env-var NAMES only — never secret values.
 *
 * Durable layout (mirrors the proven ivx-investor-crm-store pattern):
 *   logs/audit/tool-registry/tools.jsonl  append-only event log
 *   logs/audit/tool-registry/tools.json   materialised current state
 *
 * Runtime-light + deterministic: only filesystem I/O, no AI/network. Fully testable.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
export const IVX_TOOL_REGISTRY_MARKER = 'ivx-tool-registry-2026-06-05';
/**
 * Registry root, resolved lazily so the location can be isolated per-process via
 * the `IVX_TOOL_REGISTRY_DIR` env var (used by tests to avoid polluting the
 * shared durable store). When unset, production behaviour is unchanged.
 */
function registryRoot() {
    const override = process.env.IVX_TOOL_REGISTRY_DIR;
    if (override && override.trim().length > 0) {
        return override;
    }
    return path.join(process.cwd(), 'logs', 'audit', 'tool-registry');
}
function toolsStatePath() {
    return path.join(registryRoot(), 'tools.json');
}
function nowIso() {
    return new Date().toISOString();
}
function createId(prefix) {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
async function readJsonFile(file, fallback) {
    try {
        const raw = await readFile(file, 'utf8');
        return JSON.parse(raw);
    }
    catch {
        return fallback;
    }
}
async function writeJsonFile(file, value) {
    await mkdir(registryRoot(), { recursive: true });
    await writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}
async function appendEvent(event) {
    try {
        await mkdir(registryRoot(), { recursive: true });
        await appendFile(path.join(registryRoot(), 'tools.jsonl'), `${JSON.stringify(event)}\n`, 'utf8');
    }
    catch {
        // Forensic log is best-effort; never break a registry write on log failure.
    }
}
/** List all registered tools, most-recently-updated first. */
export async function listTools() {
    const items = await readJsonFile(toolsStatePath(), []);
    return [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function getTool(id) {
    const items = await readJsonFile(toolsStatePath(), []);
    return items.find((item) => item.id === id) ?? null;
}
export async function getToolByName(name) {
    const target = name.trim().toLowerCase();
    const items = await readJsonFile(toolsStatePath(), []);
    return items.find((item) => item.name.toLowerCase() === target) ?? null;
}
/**
 * Register a tool (or refresh an existing one by name). A newly registered tool
 * is ALWAYS `enabled: false` + `testStatus: 'untested'` — activation only happens
 * after the test gate passes via `recordToolTest` + `setToolEnabled`.
 */
export async function registerTool(input) {
    const items = await readJsonFile(toolsStatePath(), []);
    const name = input.name.trim();
    const existingIndex = items.findIndex((item) => item.name.toLowerCase() === name.toLowerCase());
    const prior = existingIndex >= 0 ? items[existingIndex] : undefined;
    const record = {
        id: prior?.id ?? createId('tool'),
        name,
        purpose: input.purpose.trim(),
        permissions: Array.from(new Set(input.permissions)),
        riskLevel: input.riskLevel,
        // Registration never auto-enables — a fresh/refreshed definition must re-pass tests.
        enabled: false,
        requiredSecrets: Array.from(new Set((input.requiredSecrets ?? []).map((s) => s.trim()).filter(Boolean))),
        testStatus: 'untested',
        requiresApproval: input.requiresApproval ?? false,
        approvalCategories: Array.from(new Set(input.approvalCategories ?? [])),
        source: input.source?.trim() || 'self_upgrade',
        lastTestReport: prior?.lastTestReport ?? null,
        lastSuccessfulRunAt: prior?.lastSuccessfulRunAt ?? null,
        lastRunLabel: prior?.lastRunLabel ?? null,
        runCount: prior?.runCount ?? 0,
        createdAt: prior?.createdAt ?? nowIso(),
        updatedAt: nowIso(),
    };
    if (existingIndex >= 0) {
        items[existingIndex] = record;
    }
    else {
        items.push(record);
    }
    await writeJsonFile(toolsStatePath(), items);
    await appendEvent({ type: prior ? 'reregister' : 'register', toolId: record.id, name: record.name, at: record.updatedAt });
    return record;
}
/** Persist a test report and update the tool's testStatus accordingly. */
export async function recordToolTest(id, report) {
    const items = await readJsonFile(toolsStatePath(), []);
    const index = items.findIndex((item) => item.id === id);
    if (index === -1)
        return null;
    const prior = items[index];
    const updated = {
        ...prior,
        testStatus: report.passed ? 'passed' : 'failed',
        lastTestReport: report,
        // A failed re-test must disable a previously-enabled tool.
        enabled: report.passed ? prior.enabled : false,
        updatedAt: nowIso(),
    };
    items[index] = updated;
    await writeJsonFile(toolsStatePath(), items);
    await appendEvent({ type: 'test', toolId: id, passed: report.passed, at: updated.updatedAt });
    return updated;
}
/**
 * Enable or disable a tool. A tool can only be enabled once it has PASSED its
 * test gate — attempting to enable an untested/failed tool returns null.
 */
export async function setToolEnabled(id, enabled) {
    const items = await readJsonFile(toolsStatePath(), []);
    const index = items.findIndex((item) => item.id === id);
    if (index === -1)
        return null;
    const prior = items[index];
    if (enabled && prior.testStatus !== 'passed') {
        // Refuse to activate a tool that has not passed verification.
        return null;
    }
    const updated = { ...prior, enabled, updatedAt: nowIso() };
    items[index] = updated;
    await writeJsonFile(toolsStatePath(), items);
    await appendEvent({ type: enabled ? 'enable' : 'disable', toolId: id, at: updated.updatedAt });
    return updated;
}
/** Record a real successful run of a tool (advances run count + last-success time). */
export async function recordToolRun(id, label) {
    const items = await readJsonFile(toolsStatePath(), []);
    const index = items.findIndex((item) => item.id === id);
    if (index === -1)
        return null;
    const prior = items[index];
    const updated = {
        ...prior,
        lastSuccessfulRunAt: nowIso(),
        lastRunLabel: label,
        runCount: prior.runCount + 1,
        updatedAt: nowIso(),
    };
    items[index] = updated;
    await writeJsonFile(toolsStatePath(), items);
    await appendEvent({ type: 'run', toolId: id, label, at: updated.updatedAt });
    return updated;
}
/** Remove a tool from the registry. Returns true if a tool was removed. */
export async function deleteTool(id) {
    const items = await readJsonFile(toolsStatePath(), []);
    const next = items.filter((item) => item.id !== id);
    if (next.length === items.length)
        return false;
    await writeJsonFile(toolsStatePath(), next);
    await appendEvent({ type: 'delete', toolId: id, at: nowIso() });
    return true;
}
/** Read-only roll-up over the registry for the dashboard header. */
export async function summarizeTools(env = process.env) {
    const items = await readJsonFile(toolsStatePath(), []);
    const byRisk = { low: 0, medium: 0, high: 0, critical: 0 };
    let enabled = 0;
    let passed = 0;
    let failed = 0;
    let untested = 0;
    let requiringApproval = 0;
    let missingSecrets = 0;
    for (const item of items) {
        byRisk[item.riskLevel] = (byRisk[item.riskLevel] ?? 0) + 1;
        if (item.enabled)
            enabled += 1;
        if (item.testStatus === 'passed')
            passed += 1;
        else if (item.testStatus === 'failed')
            failed += 1;
        else
            untested += 1;
        if (item.requiresApproval)
            requiringApproval += 1;
        if (item.requiredSecrets.some((name) => !(env[name] && String(env[name]).trim()))) {
            missingSecrets += 1;
        }
    }
    return {
        marker: IVX_TOOL_REGISTRY_MARKER,
        generatedAt: nowIso(),
        total: items.length,
        enabled,
        disabled: items.length - enabled,
        passed,
        failed,
        untested,
        byRisk,
        requiringApproval,
        missingSecrets,
    };
}
