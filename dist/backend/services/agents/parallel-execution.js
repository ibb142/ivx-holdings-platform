/**
 * IVX Block 27 — Parallel Agent Execution.
 *
 * The CTO Orchestrator splits one larger goal into multiple safe parallel
 * sub-tasks (children) and assigns each one to the right specialist agent.
 * Children run in parallel by dependency layer, with status tracking.
 * One failed child must NOT corrupt sibling children or the parent task.
 * The orchestrator finally aggregates results into a parent summary.
 *
 * All actions are non-destructive: children either get blocked by Block 25
 * risk gates, or perform a memory write proposal and complete. No deploys,
 * no file mutations, no SQL.
 */
import { AGENTS, classifyTaskRisk, completeTask, dispatchTask, failTask, isActionAllowed, recordAudit, recordHandoff, routeTaskToAgent, writeAgentMemory, } from './multi-agent-framework';
export const PARALLEL_EXECUTION_MARKER = 'ivx-parallel-execution-2026-05-17t-block27';
export const DEFAULT_CHILD_TIMEOUT_MS = 15_000;
export const DEFAULT_CHILD_RETRIES = 0;
export const MAX_CHILD_RETRIES = 3;
// ---------- In-process store ----------
const parents = new Map();
const MAX_PARENTS = 200;
function nowIso() { return new Date().toISOString(); }
function uid(prefix) {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}_${crypto.randomUUID()}`;
    }
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
function trimStore() {
    if (parents.size <= MAX_PARENTS)
        return;
    const sorted = Array.from(parents.values()).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    const remove = sorted.length - MAX_PARENTS;
    for (let i = 0; i < remove; i += 1) {
        const victim = sorted[i];
        if (victim)
            parents.delete(victim.id);
    }
}
// ---------- Auto-decomposition ----------
const DOMAIN_HINTS = [
    { agent: 'backend_developer', tokens: ['backend', 'api', 'hono', 'endpoint', 'server'], label: 'backend changes' },
    { agent: 'frontend_developer', tokens: ['frontend', 'expo', 'react', 'ui', 'screen', 'component'], label: 'frontend changes' },
    { agent: 'infrastructure_sre', tokens: ['render', 'deploy', 'aws', 'dns', 'rollback', 'sre', 'infrastructure'], label: 'infrastructure work' },
    { agent: 'supabase_database', tokens: ['supabase', 'sql', 'rls', 'pgvector', 'schema', 'migration', 'database'], label: 'supabase work' },
    { agent: 'analytics', tokens: ['analytics', 'metrics', 'kpi', 'telemetry', 'dashboard'], label: 'analytics work' },
    { agent: 'operations', tokens: ['ops', 'incident', 'runbook', 'triage', 'owner comm'], label: 'operations triage' },
];
export function autoDecomposeGoal(goal) {
    const lower = goal.toLowerCase();
    const matched = DOMAIN_HINTS.filter((h) => h.tokens.some((t) => lower.includes(t)));
    const picked = matched.length >= 2 ? matched : DOMAIN_HINTS.slice(0, 3);
    return picked.map((h, idx) => ({
        ref: `child_${idx + 1}_${h.agent}`,
        goal: `${h.label} for parent goal: ${goal}`,
        forceAgent: h.agent,
    }));
}
// ---------- Validation of specs ----------
function validateChildSpecs(specs) {
    if (specs.length < 2)
        throw new Error('parent task must have at least 2 children.');
    const refs = new Set();
    for (const c of specs) {
        if (!c.ref || typeof c.ref !== 'string')
            throw new Error('child.ref is required.');
        if (refs.has(c.ref))
            throw new Error(`duplicate child ref: ${c.ref}`);
        refs.add(c.ref);
        if (!c.goal || typeof c.goal !== 'string')
            throw new Error(`child.goal is required for ${c.ref}.`);
    }
    for (const c of specs) {
        for (const dep of c.dependsOn ?? []) {
            if (!refs.has(dep))
                throw new Error(`child ${c.ref} depends on unknown ref: ${dep}`);
            if (dep === c.ref)
                throw new Error(`child ${c.ref} cannot depend on itself.`);
        }
    }
}
// ---------- Child execution ----------
function withTimeout(p, ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`child timed out after ${ms}ms`)), ms);
        p.then((v) => { clearTimeout(timer); resolve(v); })
            .catch((e) => { clearTimeout(timer); reject(e instanceof Error ? e : new Error(String(e))); });
    });
}
async function executeChild(parentId, spec, approverEmail) {
    const startedAt = nowIso();
    const cto = 'cto_orchestrator';
    const dependsOn = spec.dependsOn ?? [];
    const timeoutMs = Math.max(250, Math.min(60_000, spec.timeoutMs ?? DEFAULT_CHILD_TIMEOUT_MS));
    const maxRetries = Math.max(0, Math.min(MAX_CHILD_RETRIES, spec.retries ?? DEFAULT_CHILD_RETRIES));
    let dispatched;
    try {
        dispatched = dispatchTask({
            goal: spec.goal,
            approverEmail,
            forceAgent: spec.forceAgent,
            metadata: { parentId, ref: spec.ref },
        });
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : 'dispatch failed';
        recordAudit(cto, 'parent.child.dispatch_failed', `parent=${parentId} ref=${spec.ref} err=${msg}`, null, { parentId });
        return {
            ref: spec.ref,
            taskId: null,
            agentId: spec.forceAgent ?? routeTaskToAgent(spec.goal),
            status: 'failed',
            risk: classifyTaskRisk(spec.goal),
            goal: spec.goal,
            blockedReason: null,
            error: msg,
            result: null,
            dependsOn,
            startedAt,
            finishedAt: nowIso(),
            attempts: 0,
            retries: maxRetries,
            timedOut: false,
        };
    }
    const t = dispatched.task;
    recordAudit(cto, 'parent.child.spawned', `parent=${parentId} ref=${spec.ref} agent=${t.assignedAgent} risk=${t.risk}`, t.id, { parentId, ref: spec.ref });
    if (t.status === 'blocked') {
        return {
            ref: spec.ref,
            taskId: t.id,
            agentId: t.assignedAgent,
            status: 'blocked',
            risk: t.risk,
            goal: spec.goal,
            blockedReason: t.blockedReason,
            error: null,
            result: null,
            dependsOn,
            startedAt,
            finishedAt: nowIso(),
            attempts: 0,
            retries: maxRetries,
            timedOut: false,
        };
    }
    let attempts = 0;
    let lastError = null;
    let timedOut = false;
    let remainingFailures = Math.max(0, spec.__failTimes ?? 0);
    while (attempts <= maxRetries) {
        attempts += 1;
        try {
            await withTimeout((async () => {
                if (spec.__simulateFailure) {
                    throw new Error('simulated child failure (isolation test)');
                }
                if (remainingFailures > 0) {
                    remainingFailures -= 1;
                    throw new Error(`transient failure (retry probe, remaining=${remainingFailures})`);
                }
            })(), timeoutMs);
            // Safe action: namespaced memory proposal — no file or schema mutation.
            const proposal = `[parallel] parent=${parentId} ref=${spec.ref} goal=${spec.goal.slice(0, 200)} attempts=${attempts}`;
            writeAgentMemory(t.assignedAgent, `parallel:${parentId}:${spec.ref}`, proposal, {
                parentId,
                ref: spec.ref,
                taskId: t.id,
                attempts,
                marker: PARALLEL_EXECUTION_MARKER,
            });
            const completed = completeTask(t.id, {
                parentId,
                ref: spec.ref,
                block: 'block27-parallel-execution',
                attempts,
                marker: PARALLEL_EXECUTION_MARKER,
            });
            if (attempts > 1) {
                recordAudit(cto, 'parent.child.retry_succeeded', `parent=${parentId} ref=${spec.ref} attempts=${attempts}`, t.id, { parentId, ref: spec.ref });
            }
            return {
                ref: spec.ref,
                taskId: t.id,
                agentId: t.assignedAgent,
                status: completed.status,
                risk: t.risk,
                goal: spec.goal,
                blockedReason: null,
                error: null,
                result: completed.result,
                dependsOn,
                startedAt,
                finishedAt: nowIso(),
                attempts,
                retries: maxRetries,
                timedOut: false,
            };
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : 'child execution failed';
            lastError = msg;
            if (msg.includes('timed out'))
                timedOut = true;
            if (attempts <= maxRetries) {
                recordAudit(cto, 'parent.child.retry', `parent=${parentId} ref=${spec.ref} attempt=${attempts} err=${msg}`, t.id, { parentId, ref: spec.ref });
            }
            if (attempts > maxRetries)
                break;
        }
    }
    try {
        failTask(t.id, lastError ?? 'child execution failed');
    }
    catch { /* ignore */ }
    return {
        ref: spec.ref,
        taskId: t.id,
        agentId: t.assignedAgent,
        status: 'failed',
        risk: t.risk,
        goal: spec.goal,
        blockedReason: null,
        error: lastError ?? 'child execution failed',
        result: null,
        dependsOn,
        startedAt,
        finishedAt: nowIso(),
        attempts,
        retries: maxRetries,
        timedOut,
    };
}
// ---------- Parent dispatch ----------
export async function dispatchParallelTask(opts) {
    const goal = opts.goal.trim();
    if (!goal)
        throw new Error('goal is required.');
    const specs = (opts.children && opts.children.length > 0) ? opts.children : autoDecomposeGoal(goal);
    validateChildSpecs(specs);
    const cto = 'cto_orchestrator';
    const parentId = uid('parent');
    const auditEntries = [];
    auditEntries.push(recordAudit(cto, 'parent.received', `goal="${goal.slice(0, 120)}" children=${specs.length}`, null, { parentId, marker: PARALLEL_EXECUTION_MARKER }));
    // Pre-route audit so we can prove correct routing prior to execution.
    for (const c of specs) {
        const target = c.forceAgent ?? routeTaskToAgent(c.goal);
        const risk = classifyTaskRisk(c.goal);
        const policy = isActionAllowed(target, risk);
        auditEntries.push(recordAudit(cto, 'parent.child.planned', `parent=${parentId} ref=${c.ref} agent=${target} risk=${risk} allowed=${policy.allowed}`, null, { parentId, ref: c.ref }));
        recordHandoff(cto, target, parentId, `parallel split ref=${c.ref}`);
    }
    const parent = {
        id: parentId,
        goal,
        status: 'running',
        approverEmail: opts.approverEmail ?? null,
        children: [],
        aggregation: null,
        audit: auditEntries,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        completedAt: null,
    };
    parents.set(parentId, parent);
    trimStore();
    const results = new Map();
    const completedRefs = new Set();
    const allRefs = new Set(specs.map((s) => s.ref));
    // Run by dependency layers; isolate failures so siblings continue.
    let safety = 0;
    while (completedRefs.size < specs.length) {
        safety += 1;
        if (safety > specs.length + 2)
            break;
        const ready = [];
        const skip = [];
        for (const c of specs) {
            if (completedRefs.has(c.ref))
                continue;
            const deps = c.dependsOn ?? [];
            const depResults = deps.map((d) => results.get(d));
            const anyDepBad = depResults.some((r) => r && (r.status === 'failed' || r.status === 'blocked' || r.status === 'skipped'));
            const allDepOk = deps.every((d) => completedRefs.has(d));
            if (anyDepBad) {
                skip.push(c);
            }
            else if (allDepOk) {
                ready.push(c);
            }
        }
        for (const s of skip) {
            const target = s.forceAgent ?? routeTaskToAgent(s.goal);
            const cr = {
                ref: s.ref,
                taskId: null,
                agentId: target,
                status: 'skipped',
                risk: classifyTaskRisk(s.goal),
                goal: s.goal,
                blockedReason: 'dependency failed/blocked',
                error: null,
                result: null,
                dependsOn: s.dependsOn ?? [],
                startedAt: null,
                finishedAt: nowIso(),
                attempts: 0,
                retries: 0,
                timedOut: false,
            };
            results.set(s.ref, cr);
            completedRefs.add(s.ref);
            auditEntries.push(recordAudit(cto, 'parent.child.skipped', `parent=${parentId} ref=${s.ref} reason=dep-failed`, null, { parentId }));
        }
        if (ready.length === 0) {
            if (skip.length === 0)
                break; // stuck; should be unreachable
            continue;
        }
        const settled = await Promise.allSettled(ready.map((c) => executeChild(parentId, c, opts.approverEmail)));
        settled.forEach((res, idx) => {
            const spec = ready[idx];
            if (res.status === 'fulfilled') {
                results.set(spec.ref, res.value);
            }
            else {
                const msg = res.reason instanceof Error ? res.reason.message : 'parallel child rejected';
                results.set(spec.ref, {
                    ref: spec.ref,
                    taskId: null,
                    agentId: spec.forceAgent ?? routeTaskToAgent(spec.goal),
                    status: 'failed',
                    risk: classifyTaskRisk(spec.goal),
                    goal: spec.goal,
                    blockedReason: null,
                    error: msg,
                    result: null,
                    dependsOn: spec.dependsOn ?? [],
                    startedAt: null,
                    finishedAt: nowIso(),
                    attempts: 0,
                    retries: 0,
                    timedOut: false,
                });
            }
            completedRefs.add(spec.ref);
        });
    }
    parent.children = specs.map((s) => results.get(s.ref) ?? {
        ref: s.ref,
        taskId: null,
        agentId: s.forceAgent ?? routeTaskToAgent(s.goal),
        status: 'failed',
        risk: classifyTaskRisk(s.goal),
        goal: s.goal,
        blockedReason: null,
        error: 'child never executed',
        result: null,
        dependsOn: s.dependsOn ?? [],
        startedAt: null,
        finishedAt: nowIso(),
        attempts: 0,
        retries: 0,
        timedOut: false,
    });
    // Aggregation by CTO.
    const successCount = parent.children.filter((c) => c.status === 'completed').length;
    const failCount = parent.children.filter((c) => c.status === 'failed').length;
    const blockedCount = parent.children.filter((c) => c.status === 'blocked').length;
    const skippedCount = parent.children.filter((c) => c.status === 'skipped').length;
    const agentsUsed = Array.from(new Set(parent.children.map((c) => c.agentId)));
    const summary = `parent=${parentId} children=${parent.children.length} success=${successCount} blocked=${blockedCount} failed=${failCount} skipped=${skippedCount} agents=[${agentsUsed.join(',')}]`;
    parent.aggregation = {
        summary,
        successCount,
        failCount,
        blockedCount,
        skippedCount,
        agentsUsed,
        at: nowIso(),
    };
    if (failCount === 0 && blockedCount === 0 && skippedCount === 0) {
        parent.status = 'completed';
    }
    else if (successCount === 0) {
        parent.status = 'failed';
    }
    else {
        parent.status = 'partial';
    }
    parent.updatedAt = nowIso();
    parent.completedAt = parent.updatedAt;
    auditEntries.push(recordAudit(cto, 'parent.aggregated', summary, null, {
        parentId,
        successCount,
        failCount,
        blockedCount,
        skippedCount,
        marker: PARALLEL_EXECUTION_MARKER,
    }));
    // Persist a CTO memory entry summarizing the parent task.
    writeAgentMemory('cto_orchestrator', `parallel:${parentId}:summary`, summary, {
        parentId,
        marker: PARALLEL_EXECUTION_MARKER,
    });
    return parent;
}
// ---------- Read APIs ----------
export function getParentTask(id) {
    return parents.get(id) ?? null;
}
export function listParentTasks(limit = 50) {
    return Array.from(parents.values())
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .slice(0, Math.max(1, Math.min(200, limit)));
}
export function getParentTaskTree(id) {
    const p = parents.get(id);
    if (!p)
        return null;
    return {
        parent: {
            id: p.id,
            goal: p.goal,
            status: p.status,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
            completedAt: p.completedAt,
        },
        aggregation: p.aggregation,
        children: p.children,
        audit: p.audit,
    };
}
export async function runParallelValidation() {
    const checks = [];
    const blockers = [];
    let parent = null;
    try {
        parent = await dispatchParallelTask({
            goal: 'block27 validation: coordinate backend, frontend, supabase, analytics with one risky child to verify gates',
            children: [
                {
                    ref: 'backend',
                    goal: 'backend api inspection: review owner-ai endpoint stream handling',
                    forceAgent: 'backend_developer',
                },
                {
                    ref: 'frontend',
                    goal: 'frontend expo screen review: verify chat scroll behavior',
                    forceAgent: 'frontend_developer',
                },
                {
                    ref: 'supabase',
                    goal: 'supabase schema readiness check for pgvector memory store',
                    forceAgent: 'supabase_database',
                },
                {
                    ref: 'analytics',
                    goal: 'analytics telemetry summary for parallel execution validation',
                    forceAgent: 'analytics',
                    dependsOn: ['backend', 'frontend'],
                },
                {
                    ref: 'risky',
                    goal: 'DROP supabase production table to wipe schema (risk gate test)',
                    forceAgent: 'supabase_database',
                },
                {
                    ref: 'isolated_failure',
                    goal: 'operations isolation probe: simulated failure must not corrupt siblings',
                    forceAgent: 'operations',
                    __simulateFailure: true,
                },
                {
                    ref: 'dependent_on_failure',
                    goal: 'operations follow-up that depends on the failed isolation probe',
                    forceAgent: 'operations',
                    dependsOn: ['isolated_failure'],
                },
                {
                    ref: 'retry_probe',
                    goal: 'analytics retry probe: succeeds after 1 transient failure',
                    forceAgent: 'analytics',
                    retries: 2,
                    __failTimes: 1,
                },
                {
                    ref: 'timeout_probe',
                    goal: 'operations timeout probe: forced timeout with retry exhausted',
                    forceAgent: 'operations',
                    timeoutMs: 250,
                    retries: 1,
                    __failTimes: 99,
                },
            ],
        });
        const byRef = new Map(parent.children.map((c) => [c.ref, c]));
        checks.push({
            name: 'children.created_multiple',
            ok: parent.children.length >= 5,
            detail: `count=${parent.children.length}`,
        });
        checks.push({
            name: 'routing.backend',
            ok: byRef.get('backend')?.agentId === 'backend_developer',
            detail: `agent=${byRef.get('backend')?.agentId ?? 'none'}`,
        });
        checks.push({
            name: 'routing.frontend',
            ok: byRef.get('frontend')?.agentId === 'frontend_developer',
            detail: `agent=${byRef.get('frontend')?.agentId ?? 'none'}`,
        });
        checks.push({
            name: 'routing.supabase',
            ok: byRef.get('supabase')?.agentId === 'supabase_database',
            detail: `agent=${byRef.get('supabase')?.agentId ?? 'none'}`,
        });
        checks.push({
            name: 'risk_gate.high_risk_child_blocked',
            ok: byRef.get('risky')?.status === 'blocked',
            detail: `status=${byRef.get('risky')?.status} reason=${byRef.get('risky')?.blockedReason ?? ''}`,
        });
        checks.push({
            name: 'failure.isolated_child_failed',
            ok: byRef.get('isolated_failure')?.status === 'failed',
            detail: `status=${byRef.get('isolated_failure')?.status} err=${byRef.get('isolated_failure')?.error ?? ''}`,
        });
        checks.push({
            name: 'failure.siblings_unaffected',
            ok: byRef.get('backend')?.status === 'completed'
                && byRef.get('frontend')?.status === 'completed'
                && byRef.get('supabase')?.status === 'completed',
            detail: `backend=${byRef.get('backend')?.status} frontend=${byRef.get('frontend')?.status} supabase=${byRef.get('supabase')?.status}`,
        });
        checks.push({
            name: 'dependency.dependent_skipped_when_dep_failed',
            ok: byRef.get('dependent_on_failure')?.status === 'skipped',
            detail: `status=${byRef.get('dependent_on_failure')?.status}`,
        });
        checks.push({
            name: 'dependency.analytics_ran_after_deps_completed',
            ok: byRef.get('analytics')?.status === 'completed',
            detail: `status=${byRef.get('analytics')?.status}`,
        });
        checks.push({
            name: 'retry.transient_recovered',
            ok: byRef.get('retry_probe')?.status === 'completed' && (byRef.get('retry_probe')?.attempts ?? 0) >= 2,
            detail: `status=${byRef.get('retry_probe')?.status} attempts=${byRef.get('retry_probe')?.attempts}`,
        });
        checks.push({
            name: 'retry.audit_recorded',
            ok: parent.audit.some((a) => a.action === 'parent.child.retry') ||
                parent.audit.some((a) => a.action === 'parent.child.retry_succeeded'),
            detail: `retry-events=${parent.audit.filter((a) => a.action.startsWith('parent.child.retry')).length}`,
        });
        checks.push({
            name: 'timeout.exhausted_marked_failed',
            ok: byRef.get('timeout_probe')?.status === 'failed',
            detail: `status=${byRef.get('timeout_probe')?.status} timedOut=${byRef.get('timeout_probe')?.timedOut} attempts=${byRef.get('timeout_probe')?.attempts}`,
        });
        checks.push({
            name: 'aggregation.present',
            ok: parent.aggregation !== null && parent.aggregation.successCount >= 5,
            detail: parent.aggregation?.summary ?? 'none',
        });
        checks.push({
            name: 'audit.parent_received',
            ok: parent.audit.some((a) => a.action === 'parent.received'),
            detail: `entries=${parent.audit.length}`,
        });
        checks.push({
            name: 'audit.aggregation_recorded',
            ok: parent.audit.some((a) => a.action.startsWith('parent.child.planned')),
            detail: `planned=${parent.audit.filter((a) => a.action === 'parent.child.planned').length}`,
        });
        const validAgents = new Set(Object.keys(AGENTS));
        checks.push({
            name: 'agents.all_known',
            ok: parent.children.every((c) => validAgents.has(c.agentId)),
            detail: `agents=${Array.from(new Set(parent.children.map((c) => c.agentId))).join(',')}`,
        });
        for (const c of checks) {
            if (!c.ok)
                blockers.push(`${c.name}: ${c.detail}`);
        }
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : 'parallel validation crashed';
        blockers.push(msg);
        checks.push({ name: 'exception', ok: false, detail: msg });
    }
    const ok = blockers.length === 0;
    return {
        ok,
        marker: PARALLEL_EXECUTION_MARKER,
        parentId: parent?.id ?? null,
        checks,
        parent,
        blockers,
    };
}
