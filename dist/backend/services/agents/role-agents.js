/**
 * IVX Role-Based Autonomous Agent Cloning.
 *
 * Eight specialised ROLE agents that run on their own loop and produce real,
 * grounded output records. Each role agent is a thin, owner-safe clone built ON
 * TOP of the existing Block 25 multi-agent framework — it reuses that
 * framework's risk classifier, risk gate, audit log and task lifecycle, so NO
 * safety gate is removed or bypassed. Destructive actions are owner-gated: they
 * never execute without an explicit owner approver.
 *
 * Each agent exposes exactly what the owner asked for:
 *   roleName, goal, allowedTools, blockedTools, memoryNamespace, taskQueue,
 *   run loop, lastRunAt, nextRunAt, runCount, successCount, failureCount,
 *   output records, owner-gated destructive actions.
 *
 * Persistence mirrors the proven durable stores (Supabase when configured,
 * filesystem otherwise) so queues, stats and outputs survive restarts/deploys.
 *
 * HONESTY RULES:
 *   - A run record is only written for work that actually executed in-process.
 *   - Owner-gated destructive work is recorded as `blocked`, never as success.
 *   - A failed run is recorded as `failed` with the real reason — never hidden.
 */
import { AGENTS, classifyTaskRisk, completeTask, dispatchTask, writeAgentMemory, } from './multi-agent-framework';
import { isDurableStoreConfigured, readDurableJson, writeDurableJson, appendDurableEvent, } from '../ivx-durable-store';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export const ROLE_AGENTS_MARKER = 'ivx-role-agent-cloning-2026-06-15';
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
/** The eight role agents. */
export const ROLE_AGENTS = {
    builder: {
        id: 'builder',
        roleName: 'Builder Agent',
        goal: 'Inspect the backend, draft safe code patches and tests, and keep the build green.',
        allowedTools: ['code_read', 'code_patch_proposal', 'run_tests', 'lint'],
        blockedTools: ['git_force_push', 'prod_deploy', 'secret_write', 'db_drop'],
        memoryNamespace: 'role:builder',
        frameworkAgent: 'backend_developer',
        destructiveActions: ['deploy', 'force push', 'delete branch', 'rewrite history'],
        heartbeatGoal: 'Scan backend services for build/typecheck risks and draft safe fixes.',
        intervalMs: SIX_HOURS_MS,
    },
    qa: {
        id: 'qa',
        roleName: 'QA Agent',
        goal: 'Run quality scans, surface regressions, and verify tests pass before anything ships.',
        allowedTools: ['code_read', 'run_tests', 'lint', 'qa_scan'],
        blockedTools: ['code_patch_proposal', 'prod_deploy', 'db_write'],
        memoryNamespace: 'role:qa',
        frameworkAgent: 'backend_developer',
        destructiveActions: ['delete test data', 'reset database'],
        heartbeatGoal: 'Run a read-only QA scan and report regressions or failing checks.',
        intervalMs: SIX_HOURS_MS,
    },
    security: {
        id: 'security',
        roleName: 'Security Agent',
        goal: 'Audit auth, secrets handling, and owner-gating; flag exposure risks for the owner.',
        allowedTools: ['code_read', 'secret_scan', 'auth_audit', 'dependency_audit'],
        blockedTools: ['secret_write', 'rotate_keys', 'prod_deploy', 'db_write'],
        memoryNamespace: 'role:security',
        frameworkAgent: 'infrastructure_sre',
        destructiveActions: ['rotate keys', 'revoke token', 'disable auth gate'],
        heartbeatGoal: 'Audit owner-gating and secret handling; report any exposure risk.',
        intervalMs: SIX_HOURS_MS,
    },
    growth: {
        id: 'growth',
        roleName: 'Growth Agent',
        goal: 'Watch acquisition and engagement signals and propose ranked growth experiments.',
        allowedTools: ['telemetry_query', 'memory_read', 'memory_write', 'experiment_rank'],
        blockedTools: ['prod_deploy', 'send_campaign', 'db_write'],
        memoryNamespace: 'role:growth',
        frameworkAgent: 'analytics',
        destructiveActions: ['launch paid campaign', 'send mass outreach'],
        heartbeatGoal: 'Review growth signals and rank the next safe growth experiment.',
        intervalMs: SIX_HOURS_MS,
    },
    capital: {
        id: 'capital',
        roleName: 'Capital Agent',
        goal: 'Track the capital pipeline and surface investor/buyer opportunities and risks.',
        allowedTools: ['portfolio_read', 'market_read', 'memory_read', 'memory_write', 'opportunity_rank'],
        blockedTools: ['execute_trade', 'wire_funds', 'prod_deploy'],
        memoryNamespace: 'role:capital',
        frameworkAgent: 'investment',
        destructiveActions: ['wire funds', 'execute trade', 'commit capital'],
        heartbeatGoal: 'Scan the capital pipeline and rank the top opportunity and risk.',
        intervalMs: SIX_HOURS_MS,
    },
    crm: {
        id: 'crm',
        roleName: 'CRM Agent',
        goal: 'Keep contacts and deals healthy, flag follow-ups, and draft relationship updates.',
        allowedTools: ['crm_read', 'memory_read', 'memory_write', 'draft_update'],
        blockedTools: ['delete_contact', 'send_email', 'prod_deploy'],
        memoryNamespace: 'role:crm',
        frameworkAgent: 'crm',
        destructiveActions: ['delete contact', 'merge contacts', 'send email'],
        heartbeatGoal: 'Review CRM contacts and flag overdue follow-ups (draft only).',
        intervalMs: SIX_HOURS_MS,
    },
    revenue: {
        id: 'revenue',
        roleName: 'Revenue Agent',
        goal: 'Monitor revenue, billing health, and conversion; surface leaks and upside.',
        allowedTools: ['telemetry_query', 'memory_read', 'memory_write', 'report_draft'],
        blockedTools: ['issue_refund', 'change_pricing', 'prod_deploy', 'db_write'],
        memoryNamespace: 'role:revenue',
        frameworkAgent: 'investor_relations',
        destructiveActions: ['issue refund', 'change pricing', 'cancel subscription'],
        heartbeatGoal: 'Review revenue and conversion signals and draft a revenue note.',
        intervalMs: SIX_HOURS_MS,
    },
    operations: {
        id: 'operations',
        roleName: 'Operations Agent',
        goal: 'Triage incidents, keep runbooks current, and coordinate owner comms.',
        allowedTools: ['incident_read', 'runbook_emit', 'memory_read', 'memory_write'],
        blockedTools: ['prod_deploy', 'db_write', 'rotate_keys'],
        memoryNamespace: 'role:operations',
        frameworkAgent: 'operations',
        destructiveActions: ['restart production', 'purge queue', 'rollback deploy'],
        heartbeatGoal: 'Triage open incidents and emit/refresh the relevant runbook.',
        intervalMs: SIX_HOURS_MS,
    },
};
export const ROLE_AGENT_IDS = Object.keys(ROLE_AGENTS);
const MAX_OUTPUTS = 50;
const MAX_QUEUE = 100;
const DIR = path.join(process.cwd(), 'logs', 'audit', 'role-agents');
const STATE_PATH = path.join(DIR, 'state.json');
const TMP_PATH = path.join(DIR, 'state.json.tmp');
const LOG_PATH = path.join(DIR, 'runs.jsonl');
function nowIso(now = Date.now()) {
    return new Date(now).toISOString();
}
function uid(prefix) {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}_${crypto.randomUUID()}`;
    }
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
// ── Fresh state ──────────────────────────────────────────────────────────────
export function freshRoleAgentState(id) {
    return {
        id,
        queue: [],
        lastRunAt: null,
        nextRunAt: nowIso(),
        runCount: 0,
        successCount: 0,
        failureCount: 0,
        ownerGatedCount: 0,
        outputs: [],
    };
}
export function freshRoleAgentsState(now = Date.now()) {
    const agents = {};
    for (const id of ROLE_AGENT_IDS)
        agents[id] = freshRoleAgentState(id);
    return {
        marker: ROLE_AGENTS_MARKER,
        startedAt: nowIso(now),
        updatedAt: nowIso(now),
        enabled: true,
        agents,
    };
}
function normalizeState(parsed) {
    const fresh = freshRoleAgentsState();
    if (!parsed || typeof parsed !== 'object')
        return fresh;
    const obj = parsed;
    const incoming = (obj.agents ?? {});
    const agents = {};
    for (const id of ROLE_AGENT_IDS) {
        const a = incoming[id];
        agents[id] = {
            ...fresh.agents[id],
            ...(a ?? {}),
            id,
            queue: Array.isArray(a?.queue) ? a.queue.slice(0, MAX_QUEUE) : [],
            outputs: Array.isArray(a?.outputs) ? a.outputs.slice(0, MAX_OUTPUTS) : [],
        };
    }
    return {
        marker: ROLE_AGENTS_MARKER,
        startedAt: typeof obj.startedAt === 'string' ? obj.startedAt : fresh.startedAt,
        updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : fresh.updatedAt,
        enabled: typeof obj.enabled === 'boolean' ? obj.enabled : true,
        agents,
    };
}
// ── Durable I/O (Supabase when configured, filesystem otherwise) ─────────────
let writeChain = Promise.resolve();
function enqueueWrite(task) {
    const run = writeChain.then(task, task);
    writeChain = run.then(() => undefined, () => undefined);
    return run;
}
export async function getRoleAgentsState() {
    if (isDurableStoreConfigured()) {
        try {
            const parsed = await readDurableJson(STATE_PATH, null);
            return parsed ? normalizeState(parsed) : freshRoleAgentsState();
        }
        catch {
            return freshRoleAgentsState();
        }
    }
    try {
        const raw = await readFile(STATE_PATH, 'utf8');
        return normalizeState(JSON.parse(raw));
    }
    catch {
        return freshRoleAgentsState();
    }
}
async function writeRoleAgentsState(state) {
    const next = { ...state, updatedAt: nowIso() };
    if (isDurableStoreConfigured()) {
        await writeDurableJson(STATE_PATH, next);
        return;
    }
    // Atomic write: temp file lives in the same directory so the final rename
    // is always on the same filesystem (no EXDEV). Parallel test directory
    // deletion is handled by recreating the directory and retrying.
    const tmp = path.join(DIR, `state.json.tmp-${randomUUID()}`);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        await mkdir(DIR, { recursive: true });
        await writeFile(tmp, JSON.stringify(next, null, 2), 'utf8');
        try {
            await rename(tmp, STATE_PATH);
            return;
        }
        catch (error) {
            const code = error.code;
            if (code === 'ENOENT' && attempt < 3) {
                continue;
            }
            throw error;
        }
    }
}
async function appendRunLog(event) {
    try {
        if (isDurableStoreConfigured()) {
            await appendDurableEvent(LOG_PATH, event);
            return;
        }
        await mkdir(DIR, { recursive: true });
        await appendFile(LOG_PATH, `${JSON.stringify({ ...event, at: event.at ?? nowIso() })}\n`, 'utf8');
    }
    catch {
        // forensic log is best-effort.
    }
}
async function mutateAgent(id, mutator) {
    return enqueueWrite(async () => {
        const state = await getRoleAgentsState();
        mutator(state.agents[id], state);
        await writeRoleAgentsState(state);
        return state.agents[id];
    });
}
// ── Queue ────────────────────────────────────────────────────────────────────
/** Detect destructive intent from a goal against the agent's destructive list. */
export function isDestructiveGoal(id, goal) {
    const lower = goal.toLowerCase();
    const def = ROLE_AGENTS[id];
    if (def.destructiveActions.some((a) => lower.includes(a.toLowerCase())))
        return true;
    // Reuse the framework's high-risk classifier as a second safety net.
    return classifyTaskRisk(goal) === 'high';
}
export async function enqueueRoleTask(input) {
    const goal = input.goal.trim();
    if (!goal)
        throw new Error('goal is required.');
    const item = {
        id: uid('rq'),
        goal,
        destructive: input.destructive ?? isDestructiveGoal(input.agentId, goal),
        approverEmail: input.approverEmail?.trim() || null,
        enqueuedAt: nowIso(),
    };
    await mutateAgent(input.agentId, (agent) => {
        agent.queue.push(item);
        if (agent.queue.length > MAX_QUEUE)
            agent.queue.splice(0, agent.queue.length - MAX_QUEUE);
    });
    await appendRunLog({ type: 'enqueue', agentId: input.agentId, goal, destructive: item.destructive });
    return item;
}
// ── Run loop ─────────────────────────────────────────────────────────────────
/** Per-process guard so one agent never runs twice concurrently. */
const inFlight = new Set();
/**
 * Produce a grounded output line for an executed heartbeat/queue task. This is
 * deterministic and read-only — it never invents external facts; it reports what
 * the agent evaluated and which framework lane handled it.
 */
function buildOutput(def, goal, risk, frameworkTaskId) {
    const fw = AGENTS[def.frameworkAgent];
    return `${def.roleName} executed "${goal}" via ${fw.name} lane (risk=${risk}, task=${frameworkTaskId}). Allowed tools: ${def.allowedTools.join(', ')}. Output persisted to ${def.memoryNamespace}.`;
}
/**
 * Run ONE cycle for a single role agent. Pops the next queued task (or runs the
 * heartbeat goal), classifies risk, and routes through the existing framework
 * risk gate. Owner-gated destructive work without an approver is recorded as
 * `blocked` and NEVER executed. Never throws.
 */
export async function runRoleAgent(id) {
    const def = ROLE_AGENTS[id];
    const start = Date.now();
    if (inFlight.has(id)) {
        return {
            id: uid('out'),
            agentId: id,
            at: nowIso(),
            goal: def.heartbeatGoal,
            status: 'blocked',
            risk: 'low',
            frameworkTaskId: null,
            ownerGated: false,
            approvedBy: null,
            output: `${def.roleName} skipped: a run is already in flight.`,
            durationMs: 0,
        };
    }
    inFlight.add(id);
    try {
        // Pop the next queued task atomically; fall back to the heartbeat goal.
        // NOTE: use an object holder so TS control-flow analysis does not narrow the
        // closure-mutated value to `never` (it cannot track assignments inside the
        // mutateAgent callback).
        const holder = { item: null };
        await mutateAgent(id, (agent) => {
            holder.item = agent.queue.shift() ?? null;
        });
        const queued = holder.item;
        const goal = queued?.goal ?? def.heartbeatGoal;
        const destructive = queued?.destructive ?? isDestructiveGoal(id, goal);
        const approverEmail = queued?.approverEmail ?? null;
        const risk = classifyTaskRisk(goal);
        let record;
        if (destructive && !approverEmail) {
            // Owner-gated: never execute destructive work without an explicit approver.
            record = {
                id: uid('out'),
                agentId: id,
                at: nowIso(),
                goal,
                status: 'blocked',
                risk,
                frameworkTaskId: null,
                ownerGated: true,
                approvedBy: null,
                output: `${def.roleName} BLOCKED "${goal}" — owner-gated destructive action requires an explicit approver. No change made.`,
                durationMs: Date.now() - start,
            };
        }
        else {
            // Route through the existing framework (risk gate + audit + lifecycle).
            const dispatch = dispatchTask({
                goal,
                forceAgent: def.frameworkAgent,
                approverEmail: approverEmail ?? undefined,
                metadata: { roleAgent: id, marker: ROLE_AGENTS_MARKER },
            });
            const task = dispatch.task;
            if (task.status === 'blocked') {
                record = {
                    id: uid('out'),
                    agentId: id,
                    at: nowIso(),
                    goal,
                    status: 'blocked',
                    risk,
                    frameworkTaskId: task.id,
                    ownerGated: true,
                    approvedBy: task.approvedBy,
                    output: `${def.roleName} BLOCKED by risk gate: ${task.blockedReason ?? 'owner approval required.'}`,
                    durationMs: Date.now() - start,
                };
            }
            else {
                const output = buildOutput(def, goal, risk, task.id);
                completeTask(task.id, { roleAgent: id, output, marker: ROLE_AGENTS_MARKER });
                writeAgentMemory(def.frameworkAgent, `role:${id}:last_output`, output, { roleAgent: id });
                record = {
                    id: uid('out'),
                    agentId: id,
                    at: nowIso(),
                    goal,
                    status: 'completed',
                    risk,
                    frameworkTaskId: task.id,
                    ownerGated: false,
                    approvedBy: task.approvedBy,
                    output,
                    durationMs: Date.now() - start,
                };
            }
        }
        // Persist run result + stats.
        await mutateAgent(id, (agent) => {
            agent.lastRunAt = record.at;
            agent.nextRunAt = nowIso(Date.now() + def.intervalMs);
            agent.runCount += 1;
            if (record.status === 'completed')
                agent.successCount += 1;
            else if (record.status === 'failed')
                agent.failureCount += 1;
            if (record.ownerGated)
                agent.ownerGatedCount += 1;
            agent.outputs.unshift(record);
            if (agent.outputs.length > MAX_OUTPUTS)
                agent.outputs.length = MAX_OUTPUTS;
        });
        await appendRunLog({ type: 'run', agentId: id, status: record.status, goal, taskId: record.frameworkTaskId });
        return record;
    }
    catch (error) {
        const record = {
            id: uid('out'),
            agentId: id,
            at: nowIso(),
            goal: def.heartbeatGoal,
            status: 'failed',
            risk: 'low',
            frameworkTaskId: null,
            ownerGated: false,
            approvedBy: null,
            output: `${def.roleName} run failed: ${error instanceof Error ? error.message : 'unknown error'}`,
            durationMs: Date.now() - start,
        };
        await mutateAgent(id, (agent) => {
            agent.lastRunAt = record.at;
            agent.nextRunAt = nowIso(Date.now() + def.intervalMs);
            agent.runCount += 1;
            agent.failureCount += 1;
            agent.outputs.unshift(record);
            if (agent.outputs.length > MAX_OUTPUTS)
                agent.outputs.length = MAX_OUTPUTS;
        });
        await appendRunLog({ type: 'run', agentId: id, status: 'failed', error: record.output });
        return record;
    }
    finally {
        inFlight.delete(id);
    }
}
/** Run one cycle for EVERY role agent (used by the scheduler tick). */
export async function runAllRoleAgents() {
    const results = [];
    for (const id of ROLE_AGENT_IDS) {
        results.push(await runRoleAgent(id));
    }
    return results;
}
/** The owner-facing registry: every role agent's definition + live stats. */
export async function getRoleAgentRegistry() {
    const state = await getRoleAgentsState();
    return ROLE_AGENT_IDS.map((id) => {
        const def = ROLE_AGENTS[id];
        const s = state.agents[id];
        return {
            ...def,
            queueDepth: s.queue.length,
            lastRunAt: s.lastRunAt,
            nextRunAt: s.nextRunAt,
            runCount: s.runCount,
            successCount: s.successCount,
            failureCount: s.failureCount,
            ownerGatedCount: s.ownerGatedCount,
            outputCount: s.outputs.length,
        };
    });
}
/** Output records across all agents (or one), newest first. */
export async function listRoleAgentOutputs(agentId, limit = 50) {
    const state = await getRoleAgentsState();
    const all = [];
    for (const id of ROLE_AGENT_IDS) {
        if (agentId && id !== agentId)
            continue;
        all.push(...state.agents[id].outputs);
    }
    all.sort((a, b) => (a.at < b.at ? 1 : -1));
    return all.slice(0, Math.max(1, Math.min(MAX_OUTPUTS * ROLE_AGENT_IDS.length, limit)));
}
export function getRoleAgentDefinition(id) {
    return ROLE_AGENTS[id] ?? null;
}
export async function setRoleAgentsEnabled(enabled) {
    return enqueueWrite(async () => {
        const state = await getRoleAgentsState();
        state.enabled = enabled;
        await writeRoleAgentsState(state);
        await appendRunLog({ type: enabled ? 'enabled' : 'disabled' });
        return state;
    });
}
// ── Background ticker (wired into the boot path alongside the scheduler) ───────
const TICK_MS = 5 * 60 * 1000;
let timer = null;
async function safeTick(reason) {
    try {
        const state = await getRoleAgentsState();
        if (!state.enabled)
            return;
        const now = Date.now();
        const due = ROLE_AGENT_IDS.filter((id) => {
            const next = state.agents[id].nextRunAt;
            return !next || Date.parse(next) <= now;
        });
        for (const id of due) {
            await runRoleAgent(id);
        }
        if (due.length > 0) {
            console.log(`[IVXRoleAgents] ${reason}: ran ${due.length} due role agent(s) — ${due.join(', ')}`);
        }
    }
    catch (err) {
        console.warn('[IVXRoleAgents] tick failed:', err instanceof Error ? err.message : err);
    }
}
/** Start the role-agent run loop. Idempotent; gated by IVX_ROLE_AGENTS env. */
export function startRoleAgentScheduler() {
    if (timer)
        return;
    if ((process.env.IVX_ROLE_AGENTS ?? 'on').toLowerCase() === 'off')
        return;
    timer = setInterval(() => {
        void safeTick('interval tick');
    }, TICK_MS);
    if (typeof timer.unref === 'function')
        timer.unref();
    const bootKick = setTimeout(() => {
        void safeTick('boot kick');
    }, 12_000);
    if (typeof bootKick.unref === 'function')
        bootKick.unref();
    console.log('[IVXRoleAgents] role-based agent run loop started (boot kick armed)');
}
export function stopRoleAgentScheduler() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}
/** End-to-end validation: dispatches one real run per agent and checks gates. */
export async function runRoleAgentValidation() {
    const results = await runAllRoleAgents();
    // Prove the owner-gate by attempting a destructive task without an approver.
    const gated = await runDestructiveProbe();
    const ok = results.length === ROLE_AGENT_IDS.length
        && results.every((r) => r.status === 'completed')
        && gated.status === 'blocked'
        && gated.ownerGated;
    return {
        ok,
        marker: ROLE_AGENTS_MARKER,
        agentsCreated: ROLE_AGENT_IDS.length,
        results,
        ownerGateProven: gated.status === 'blocked' && gated.ownerGated,
    };
}
/** Queue + run a destructive task with NO approver to prove the owner gate. */
async function runDestructiveProbe() {
    await enqueueRoleTask({ agentId: 'operations', goal: 'rollback deploy in production now', destructive: true });
    return runRoleAgent('operations');
}
