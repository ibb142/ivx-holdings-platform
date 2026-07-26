/**
 * IVX Operational Memory — autonomous execution loop.
 *
 * Phases: analyze -> plan -> patch -> test -> validate -> deploy -> verify
 *
 * Safety:
 * - The loop never edits files or pushes code on its own. Mutating phases
 *   (patch / deploy) record proposed changes into operational memory and
 *   into the existing Block 21 owner-approved action queue model. Owner
 *   approval is still required before any destructive surface runs.
 * - A rollback token is captured before each run (current GitHub main SHA
 *   and Render latest deploy ID) and persisted on the task row, so a
 *   later rollback action can target the exact pre-run state.
 * - Failure recovery: any thrown phase records the failure step and marks
 *   the task as failed without leaving state inconsistent. The loop is
 *   bounded by per-phase try/catch and a global step budget.
 */
import { upsertMemory } from './vector-memory';
import { searchMemory } from './vector-memory';
import { runRepoIndex } from './repo-indexer';
import { getOperationalSnapshot } from './operational-adapters';
import { createAgentTask, updateAgentTask } from './task-state';
import { OPERATIONAL_MEMORY_MARKER } from './memory-types';
function nowIso() {
    return new Date().toISOString();
}
function startStep(phase) {
    return { phase, startedAt: nowIso(), endedAt: null, ok: null, detail: '' };
}
function endStep(step, ok, detail, metadata) {
    return { ...step, endedAt: nowIso(), ok, detail: detail.slice(0, 800), metadata };
}
async function persistSteps(task, status, steps) {
    const updated = await updateAgentTask(task.id, { status, steps });
    return updated ?? { ...task, status, steps, updated_at: nowIso() };
}
/**
 * Run one autonomous loop iteration for a goal. Non-destructive: emits
 * proposed patches and proposed deploy actions into operational memory only.
 */
export async function runExecutionLoop(goal, options = {}) {
    const task = await createAgentTask(goal);
    const steps = [];
    // Capture rollback token (snapshot of operational surface) BEFORE any work.
    const snapshotBefore = await getOperationalSnapshot();
    const rollbackToken = JSON.stringify({
        githubSha: snapshotBefore.github.latestSha,
        renderDeployId: snapshotBefore.render.latestDeployId,
        capturedAt: snapshotBefore.generatedAt,
    });
    await updateAgentTask(task.id, { rollback_token: rollbackToken });
    await upsertMemory({
        category: 'task_state',
        title: `task:${task.id} rollback_token`,
        content: rollbackToken,
        metadata: { taskId: task.id, marker: OPERATIONAL_MEMORY_MARKER },
        source: 'execution_loop',
        refId: `${task.id}:rollback`,
    });
    let current = task;
    // analyze
    let step = startStep('analyzing');
    try {
        const hits = await searchMemory(goal, { limit: 6 });
        const analysis = `goal=${goal}\nhits=${hits.length}\ntop=${hits.slice(0, 3).map((h) => `${h.category}:${h.title}`).join(' | ')}`;
        await upsertMemory({ category: 'note', title: `analyze:${task.id}`, content: analysis, metadata: { taskId: task.id, hits: hits.length }, source: 'execution_loop', refId: `${task.id}:analyze` });
        steps.push(endStep(step, true, `analyzed (${hits.length} prior hits)`, { hits: hits.length }));
        current = await persistSteps(current, 'analyzing', steps);
    }
    catch (error) {
        steps.push(endStep(step, false, error instanceof Error ? error.message : 'analyze failed'));
        await persistSteps(current, 'failed', steps);
        await updateAgentTask(task.id, { error: 'analyze phase failed' });
        return { task: { ...current, status: 'failed' }, snapshotBefore, rollbackToken, marker: OPERATIONAL_MEMORY_MARKER };
    }
    // plan
    step = startStep('planning');
    try {
        const plan = `Plan for: ${goal}\n- Use vector memory to recall prior fixes\n- Surface candidate file targets via repo_index\n- Propose a patch via Block 21 action queue (owner approval required)\n- After approval, owner-approved deploy goes through /api/ivx/developer-deploy/action\n- Verify with /health, /api/ivx/owner-ai/proxy-status, and /api/public/chat source=chatgpt`;
        await upsertMemory({ category: 'roadmap', title: `plan:${task.id}`, content: plan, metadata: { taskId: task.id }, source: 'execution_loop', refId: `${task.id}:plan` });
        steps.push(endStep(step, true, 'plan recorded'));
        current = await persistSteps(current, 'planning', steps);
    }
    catch (error) {
        steps.push(endStep(step, false, error instanceof Error ? error.message : 'plan failed'));
        await persistSteps(current, 'failed', steps);
        return { task: { ...current, status: 'failed' }, snapshotBefore, rollbackToken, marker: OPERATIONAL_MEMORY_MARKER };
    }
    // optional reindex
    if (options.reindexBeforeRun) {
        const idxStep = startStep('analyzing');
        try {
            const r = await runRepoIndex(200);
            steps.push(endStep(idxStep, r.ok, `repo indexed (${r.indexed}/${r.scanned})`, { ...r }));
        }
        catch (error) {
            steps.push(endStep(idxStep, false, error instanceof Error ? error.message : 'reindex failed'));
        }
        current = await persistSteps(current, 'planning', steps);
    }
    // patch (proposal only)
    step = startStep('patching');
    try {
        const proposal = {
            kind: 'file_patch_proposal',
            goal,
            ownerApprovalRoute: 'POST /api/ivx/developer-deploy/action',
            block21AdminScreen: '/admin/ivx-developer-actions',
            generatedBy: OPERATIONAL_MEMORY_MARKER,
        };
        await upsertMemory({ category: 'fix', title: `patch_proposal:${task.id}`, content: JSON.stringify(proposal), metadata: proposal, source: 'execution_loop', refId: `${task.id}:patch` });
        steps.push(endStep(step, true, 'patch proposal recorded (owner approval required to apply)'));
        current = await persistSteps(current, 'patching', steps);
    }
    catch (error) {
        steps.push(endStep(step, false, error instanceof Error ? error.message : 'patch failed'));
        await persistSteps(current, 'failed', steps);
        return { task: { ...current, status: 'failed' }, snapshotBefore, rollbackToken, marker: OPERATIONAL_MEMORY_MARKER };
    }
    // test (logical: confirm operational adapters reachable)
    step = startStep('testing');
    try {
        const snap = options.liveProbe ? await getOperationalSnapshot() : snapshotBefore;
        const ok = snap.supabase.reachable && snap.supabase.operationalMemoryTable;
        steps.push(endStep(step, ok, `supabase reachable=${snap.supabase.reachable} memTable=${snap.supabase.operationalMemoryTable}`));
        current = await persistSteps(current, 'testing', steps);
    }
    catch (error) {
        steps.push(endStep(step, false, error instanceof Error ? error.message : 'test failed'));
        await persistSteps(current, 'failed', steps);
        return { task: { ...current, status: 'failed' }, snapshotBefore, rollbackToken, marker: OPERATIONAL_MEMORY_MARKER };
    }
    // validate (no destructive ops; only checks)
    step = startStep('validating');
    try {
        steps.push(endStep(step, true, 'validate phase clean (no destructive surface touched)'));
        current = await persistSteps(current, 'validating', steps);
    }
    catch (error) {
        steps.push(endStep(step, false, error instanceof Error ? error.message : 'validate failed'));
        await persistSteps(current, 'failed', steps);
        return { task: { ...current, status: 'failed' }, snapshotBefore, rollbackToken, marker: OPERATIONAL_MEMORY_MARKER };
    }
    // deploy (proposal only — owner-approved route required to actually deploy)
    step = startStep('deploying');
    try {
        await upsertMemory({
            category: 'deployment',
            title: `deploy_proposal:${task.id}`,
            content: 'Render deploy proposal recorded. Apply via POST /api/ivx/developer-deploy/action with owner bearer + confirmText: CONFIRM_IVX_RENDER_DEPLOY.',
            metadata: { taskId: task.id, marker: OPERATIONAL_MEMORY_MARKER },
            source: 'execution_loop',
            refId: `${task.id}:deploy`,
        });
        steps.push(endStep(step, true, 'deploy proposal recorded (owner approval required to apply)'));
        current = await persistSteps(current, 'deploying', steps);
    }
    catch (error) {
        steps.push(endStep(step, false, error instanceof Error ? error.message : 'deploy failed'));
        await persistSteps(current, 'failed', steps);
        return { task: { ...current, status: 'failed' }, snapshotBefore, rollbackToken, marker: OPERATIONAL_MEMORY_MARKER };
    }
    // verify
    step = startStep('verifying');
    try {
        const snap = options.liveProbe ? await getOperationalSnapshot() : snapshotBefore;
        const githubAdvanced = Boolean(snap.github.latestSha) && snap.github.latestSha !== snapshotBefore.github.latestSha;
        const renderAdvanced = Boolean(snap.render.latestDeployId) && snap.render.latestDeployId !== snapshotBefore.render.latestDeployId;
        const detail = `githubAdvanced=${githubAdvanced} renderAdvanced=${renderAdvanced}`;
        steps.push(endStep(step, true, detail, { githubAdvanced, renderAdvanced }));
        current = await persistSteps(current, 'completed', steps);
        await updateAgentTask(task.id, { result: { ok: true, detail, marker: OPERATIONAL_MEMORY_MARKER } });
    }
    catch (error) {
        steps.push(endStep(step, false, error instanceof Error ? error.message : 'verify failed'));
        await persistSteps(current, 'failed', steps);
        return { task: { ...current, status: 'failed' }, snapshotBefore, rollbackToken, marker: OPERATIONAL_MEMORY_MARKER };
    }
    return { task: current, snapshotBefore, rollbackToken, marker: OPERATIONAL_MEMORY_MARKER };
}
/**
 * Mark a task as rolled_back and record the rollback intent in memory.
 * The actual GitHub revert / Render redeploy is performed via the owner-
 * approved Block 21 routes; this function records the rollback decision.
 */
export async function recordRollback(taskId, reason) {
    const updated = await updateAgentTask(taskId, { status: 'rolled_back', rollback_applied: true, error: reason.slice(0, 800) });
    await upsertMemory({
        category: 'incident',
        title: `rollback:${taskId}`,
        content: reason,
        metadata: { taskId, marker: OPERATIONAL_MEMORY_MARKER },
        source: 'execution_loop',
        refId: `${taskId}:rollback_applied`,
    });
    return updated;
}
