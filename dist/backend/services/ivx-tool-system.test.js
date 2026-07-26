import { describe, expect, it } from 'bun:test';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
// Isolate the durable tool registry so this suite starts from a clean store and
// never inherits self-registered tools (e.g. the app generator) from other runs.
process.env.IVX_TOOL_REGISTRY_DIR = nodePath.join(tmpdir(), `ivx-tool-system-registry-${process.pid}-${Date.now()}`);
import { APPROVED_TOOL_CATALOG, TOOL_OUTPUT_LABEL, deriveRiskLevel, evaluateToolApproval, getCatalogTool, scanToolForSafety, } from './ivx-tool-catalog';
import { testTool } from './ivx-tool-tester';
import { proposeNextTool, runSelfUpgrade, useTool, } from './ivx-tool-self-upgrade';
import { installToolByName } from './ivx-tool-installer';
import { buildToolSystemDashboard } from './ivx-tool-system-dashboard';
import { getToolByName, listTools } from './ivx-tool-registry-store';
// A well-formed but DESTRUCTIVE tool used to prove the approval gate.
const destructiveTool = {
    name: 'test_destructive_writer',
    purpose: 'Writes to the filesystem (destructive) — used only to prove the approval gate.',
    permissions: ['filesystem_write'],
    riskLevel: 'high',
    requiredSecrets: [],
    run: () => ({ ok: true, output: { wrote: true } }),
    sandbox: { input: {}, expect: (out) => out.ok },
    rollback: () => true,
};
describe('ivx-tool-catalog: safety scanner + approval mapping', () => {
    it('every catalog tool is safe + read-only + needs no approval', () => {
        expect(APPROVED_TOOL_CATALOG.length).toBeGreaterThanOrEqual(3);
        for (const def of APPROVED_TOOL_CATALOG) {
            const scan = scanToolForSafety(def);
            expect(scan.safe).toBe(true);
            expect(scan.requiresApproval).toBe(false);
            expect(scan.riskLevel).toBe('low');
            expect(scan.issues).toHaveLength(0);
        }
    });
    it('maps destructive permissions to the right approval categories', () => {
        expect(evaluateToolApproval(['spend_money']).categories).toContain('payments');
        expect(evaluateToolApproval(['database_write']).categories).toContain('production_schema');
        expect(evaluateToolApproval(['filesystem_write']).categories).toContain('deletes');
        expect(evaluateToolApproval(['send_external']).categories).toContain('external_publishing');
        expect(evaluateToolApproval(['read_only'], ['OPENAI_API_KEY']).categories).toContain('credential_changes');
        expect(evaluateToolApproval(['read_only']).requiresApproval).toBe(false);
    });
    it('derives risk level from permissions (highest wins)', () => {
        expect(deriveRiskLevel(['read_only'])).toBe('low');
        expect(deriveRiskLevel(['network'])).toBe('medium');
        expect(deriveRiskLevel(['send_external'])).toBe('high');
        expect(deriveRiskLevel(['spend_money'])).toBe('critical');
    });
    it('flags a value-looking required secret as unsafe', () => {
        const bad = {
            ...destructiveTool,
            name: 'test_bad_secret',
            permissions: ['read_only'],
            requiredSecrets: ['sk-this-is-clearly-a-secret-value-not-an-env-name-aaaaaaaaaaaaaaaaa'],
            rollback: undefined,
        };
        expect(scanToolForSafety(bad).safe).toBe(false);
    });
    it('flags a writing tool with no rollback as unsafe', () => {
        const noRollback = { ...destructiveTool, name: 'test_no_rollback', rollback: undefined };
        expect(scanToolForSafety(noRollback).safe).toBe(false);
    });
});
describe('ivx-tool-tester: 5-phase gate', () => {
    it('passes a safe catalog tool with all phases labeled', () => {
        const def = getCatalogTool('text_analyzer');
        const result = testTool(def, {});
        expect(result.passed).toBe(true);
        expect(result.overallLabel).toBe(TOOL_OUTPUT_LABEL.VERIFIED);
        const phases = result.phases.map((p) => p.phase);
        expect(phases).toEqual(['import', 'permission', 'sandbox', 'real_api', 'rollback']);
        // No external API needed → honest NOT EXECUTED skip that still passes.
        const realApi = result.phases.find((p) => p.phase === 'real_api');
        expect(realApi.label).toBe(TOOL_OUTPUT_LABEL.NOT_EXECUTED);
        expect(realApi.passed).toBe(true);
        // Read-only → rollback verified with no side effects.
        expect(result.phases.find((p) => p.phase === 'rollback').label).toBe(TOOL_OUTPUT_LABEL.VERIFIED);
    });
    it('fails a tool whose sandbox expectation is not met', () => {
        const broken = {
            name: 'test_broken_sandbox',
            purpose: 'Always returns the wrong answer.',
            permissions: ['read_only'],
            riskLevel: 'low',
            requiredSecrets: [],
            run: () => ({ ok: true, output: { value: 1 } }),
            sandbox: { input: {}, expect: (out) => out.output.value === 999 },
        };
        const result = testTool(broken, {});
        expect(result.passed).toBe(false);
        expect(result.phases.find((p) => p.phase === 'sandbox').label).toBe(TOOL_OUTPUT_LABEL.FAILED);
    });
    it('skips the real API test honestly when a required secret is missing', () => {
        const needsSecret = {
            name: 'test_needs_secret',
            purpose: 'Needs a key.',
            permissions: ['network'],
            riskLevel: 'medium',
            requiredSecrets: ['SOME_API_KEY'],
            run: () => ({ ok: true, output: {} }),
            sandbox: { input: {}, expect: (out) => out.ok },
        };
        const result = testTool(needsSecret, {});
        const realApi = result.phases.find((p) => p.phase === 'real_api');
        expect(realApi.label).toBe(TOOL_OUTPUT_LABEL.NOT_EXECUTED);
        expect(realApi.detail).toContain('SOME_API_KEY');
    });
});
describe('ivx-tool-installer: gates', () => {
    it('rejects an unknown tool', async () => {
        const result = await installToolByName('does_not_exist_tool');
        expect(result.ok).toBe(false);
        expect(result.status).toBe('blocked_unknown_tool');
    });
});
describe('ivx-tool self-upgrade: end-to-end success test', () => {
    it('proposes, builds, tests, registers, activates, and USES one safe tool with proof', async () => {
        // The BLOCK success test.
        const proposal = await proposeNextTool();
        expect(proposal).not.toBeNull();
        const proof = await runSelfUpgrade(proposal.name);
        expect(proof.ok).toBe(true);
        expect(proof.finalLabel).toBe(TOOL_OUTPUT_LABEL.VERIFIED);
        // Tested (all phases passed).
        expect(proof.install?.test?.passed).toBe(true);
        // Registered + enabled.
        expect(proof.registered?.enabled).toBe(true);
        expect(proof.registered?.testStatus).toBe('passed');
        // Used (real verified run recorded).
        expect(proof.usage?.used).toBe(true);
        expect(proof.usage?.label).toBe(TOOL_OUTPUT_LABEL.VERIFIED);
        // Durable: the tool is in the registry, enabled, with a real run recorded.
        const record = await getToolByName(proposal.name);
        expect(record?.enabled).toBe(true);
        expect(record?.runCount).toBeGreaterThanOrEqual(1);
        expect(record?.lastSuccessfulRunAt).not.toBeNull();
    });
    it('refuses to USE a tool that is not registered (NOT EXECUTED)', async () => {
        const usage = await useTool('never_registered_tool', {});
        expect(usage.used).toBe(false);
        expect(usage.label).toBe(TOOL_OUTPUT_LABEL.NOT_EXECUTED);
    });
    it('dashboard reports the active tool with risk + a last successful run', async () => {
        await runSelfUpgrade('sha256_digest');
        const dashboard = await buildToolSystemDashboard();
        expect(dashboard.summary.total).toBeGreaterThanOrEqual(1);
        const active = dashboard.activeTools.find((t) => t.name === 'sha256_digest');
        expect(active).toBeTruthy();
        expect(active?.enabled).toBe(true);
        expect(active?.riskLevel).toBe('low');
        expect(active?.lastSuccessfulRunAt).not.toBeNull();
        // The approval-gate map is always present for the owner.
        expect(dashboard.approvalGates.length).toBe(6);
    });
    it('all installed tools come from the approved catalog (no rogue tools)', async () => {
        const tools = await listTools();
        for (const t of tools) {
            expect(getCatalogTool(t.name)).not.toBeNull();
        }
    });
});
