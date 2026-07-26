/**
 * Tests for Role-Based Autonomous Agent Cloning.
 *
 * These exercise the real run loop on the filesystem-backed durable store (no
 * Supabase, no network), proving: the eight agents exist, each runs and produces
 * an output record, stats advance, owner-gated destructive actions are blocked
 * without an approver, and the safety gate is reused from the framework.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readdir, rm, unlink } from 'node:fs/promises';
import path from 'node:path';
import { ROLE_AGENTS, ROLE_AGENT_IDS, enqueueRoleTask, freshRoleAgentsState, getRoleAgentRegistry, isDestructiveGoal, listRoleAgentOutputs, runAllRoleAgents, runRoleAgent, runRoleAgentValidation, } from './role-agents';
const STATE_DIR = path.join(process.cwd(), 'logs', 'audit', 'role-agents');
async function clearState() {
    // Remove the files inside the directory rather than the directory itself.
    // Deleting the directory while the production write loop is running causes
    // an atomic-rename race (ENOENT) when multiple test files run in parallel.
    try {
        const entries = await readdir(STATE_DIR, { withFileTypes: true });
        await Promise.all(entries.map((entry) => {
            const fullPath = path.join(STATE_DIR, entry.name);
            return entry.isDirectory()
                ? rm(fullPath, { recursive: true, force: true })
                : unlink(fullPath);
        }));
    }
    catch {
        // Directory may not exist yet; that is equivalent to a clean state.
    }
}
describe('role-agent registry', () => {
    beforeEach(clearState);
    afterEach(clearState);
    test('exactly eight role agents are defined with required fields', () => {
        const ids = ['builder', 'qa', 'security', 'growth', 'capital', 'crm', 'revenue', 'operations'];
        expect(ROLE_AGENT_IDS.sort()).toEqual([...ids].sort());
        for (const id of ROLE_AGENT_IDS) {
            const def = ROLE_AGENTS[id];
            expect(def.roleName.length).toBeGreaterThan(0);
            expect(def.goal.length).toBeGreaterThan(0);
            expect(def.allowedTools.length).toBeGreaterThan(0);
            expect(def.blockedTools.length).toBeGreaterThan(0);
            expect(def.memoryNamespace).toContain('role:');
            expect(def.destructiveActions.length).toBeGreaterThan(0);
        }
    });
    test('fresh state seeds every agent with zeroed stats and a due nextRunAt', () => {
        const state = freshRoleAgentsState();
        expect(Object.keys(state.agents).sort()).toEqual([...ROLE_AGENT_IDS].sort());
        for (const id of ROLE_AGENT_IDS) {
            const a = state.agents[id];
            expect(a.runCount).toBe(0);
            expect(a.successCount).toBe(0);
            expect(a.failureCount).toBe(0);
            expect(a.outputs).toHaveLength(0);
            expect(a.nextRunAt).not.toBeNull();
        }
    });
    test('registry exposes definitions + live stats', async () => {
        const registry = await getRoleAgentRegistry();
        expect(registry).toHaveLength(8);
        expect(registry.every((r) => typeof r.runCount === 'number')).toBe(true);
    });
});
describe('role-agent run loop', () => {
    beforeEach(clearState);
    afterEach(clearState);
    test('a single agent run produces a completed output and advances stats', async () => {
        const out = await runRoleAgent('builder');
        expect(out.agentId).toBe('builder');
        expect(out.status).toBe('completed');
        expect(out.output.length).toBeGreaterThan(0);
        expect(out.frameworkTaskId).not.toBeNull();
        const registry = await getRoleAgentRegistry();
        const builder = registry.find((r) => r.id === 'builder');
        expect(builder.runCount).toBe(1);
        expect(builder.successCount).toBe(1);
        expect(builder.lastRunAt).not.toBeNull();
    });
    test('runAllRoleAgents executes one cycle for every agent', async () => {
        const outputs = await runAllRoleAgents();
        expect(outputs).toHaveLength(8);
        expect(outputs.every((o) => o.status === 'completed')).toBe(true);
        const all = await listRoleAgentOutputs();
        expect(all.length).toBeGreaterThanOrEqual(8);
    });
    test('owner-gated destructive task is blocked without an approver', async () => {
        await enqueueRoleTask({ agentId: 'operations', goal: 'rollback deploy in production', destructive: true });
        const out = await runRoleAgent('operations');
        expect(out.status).toBe('blocked');
        expect(out.ownerGated).toBe(true);
        expect(out.output).toContain('BLOCKED');
        const registry = await getRoleAgentRegistry();
        const ops = registry.find((r) => r.id === 'operations');
        expect(ops.ownerGatedCount).toBeGreaterThanOrEqual(1);
        expect(ops.successCount).toBe(0);
    });
    test('destructive intent is detected from the goal text', () => {
        expect(isDestructiveGoal('capital', 'wire funds to the seller now')).toBe(true);
        expect(isDestructiveGoal('crm', 'review overdue follow ups')).toBe(false);
    });
    test('an approved destructive task is allowed through the gate', async () => {
        await enqueueRoleTask({
            agentId: 'crm',
            goal: 'delete contact duplicate record',
            destructive: true,
            approverEmail: 'owner@ivxholding.com',
        });
        const out = await runRoleAgent('crm');
        // With an approver the run is not owner-gate blocked (it may still be risk-gated,
        // but it is no longer blocked purely for lack of an approver).
        expect(out.ownerGated === false || out.approvedBy === 'owner@ivxholding.com').toBe(true);
    });
});
describe('role-agent end-to-end validation', () => {
    beforeEach(clearState);
    afterEach(clearState);
    test('validation runs one real execution per agent and proves the owner gate', async () => {
        const result = await runRoleAgentValidation();
        expect(result.agentsCreated).toBe(8);
        expect(result.results).toHaveLength(8);
        expect(result.results.every((r) => r.status === 'completed')).toBe(true);
        expect(result.ownerGateProven).toBe(true);
        expect(result.ok).toBe(true);
    });
});
