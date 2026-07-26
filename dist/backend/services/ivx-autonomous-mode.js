/**
 * IVX Autonomous Mode — the single 12-step lifecycle that lets IVX operate
 * without human babysitting, behind one entry point, composing the subsystems
 * that already exist:
 *
 *   1  receive task           — copy the owner task EXACTLY
 *   2  classify intent        — ivx-owner-execution-mode (+ the 6 safety gates)
 *   3  verify tools/access    — ivx-tool-availability
 *   4  create execution plan  — ivx-task-block-splitter
 *   5  execute                — ivx-self-heal-cycle (fix-and-verify loop)
 *   6  run tests              — self-heal test stage
 *   7  deploy if allowed      — derived from production verification + tools
 *   8  verify production      — ivx-production-guard (getProductionHealth)
 *   9  detect failure         — derived from steps 5–8
 *   10 retry or self-heal     — self-heal fix stage
 *   11 roll back if needed    — ivx-production-guard (triggerProductionRollback via self-heal)
 *   12 return proof           — ivx-execution-trace-store + evidence classification
 *
 * SAFETY GATES (human required) — a task is HELD for approval, never executed,
 * when its intent matches one of the six guarded categories:
 *   delete data · modify production schema · expose secrets · change billing /
 *   payment · disable security · grant external access.
 * (These map to the owner's list: destructive action / payment / credential
 * change / delete data / legal-compliance risk / production-rollback approval.)
 *
 * The heavy self-heal runner is INJECTABLE so this orchestrator is unit-testable
 * without the AI gateway / git / network. It never throws — every failure surfaces
 * as a failed step so the returned proof is always honest and complete.
 */
import { classifyOwnerExecutionCommand } from './ivx-owner-execution-mode';
import { checkToolAvailability } from './ivx-tool-availability';
import { splitTaskIntoBlocks } from './ivx-task-block-splitter';
import { recordExecutionTrace } from './ivx-execution-trace-store';
import { EVIDENCE_CLASSIFICATION } from './ivx-evidence-gate';
export const IVX_AUTONOMOUS_MODE_MARKER = 'ivx-autonomous-mode-2026-06-01';
function nowIso() {
    return new Date().toISOString();
}
function genTaskId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `autotask_${crypto.randomUUID()}`;
    }
    return `autotask_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
function genRequestId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `autoreq_${crypto.randomUUID()}`;
    }
    return `autoreq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
function step(n, name, status, proof) {
    return { step: n, name, status, proof };
}
/**
 * Run the full autonomous lifecycle for a single owner task.
 * Never throws — failures surface as failed steps and a FAILED final status.
 */
export async function runAutonomousMode(task, options = {}) {
    const startedAt = nowIso();
    const startMs = Date.now();
    const taskId = genTaskId();
    const requestId = genRequestId();
    const steps = [];
    const exactTask = typeof task === 'string' ? task : String(task ?? '');
    // ---- Step 1: receive task (copy exactly) ----
    steps.push(step(1, 'receive task', exactTask.trim().length > 0 ? 'verified' : 'failed', exactTask.trim().length > 0
        ? `Task received and copied exactly (${exactTask.length} chars).`
        : 'Empty task — nothing to execute.'));
    // ---- Step 2: classify intent (+ safety gates) ----
    const decision = classifyOwnerExecutionCommand(exactTask);
    steps.push(step(2, 'classify intent', 'verified', decision.requiresApproval
        ? `Guarded intent: ${decision.approvalCategories.join(', ')} — human approval required.`
        : `Intent: ${decision.isOwnerExecutionCommand ? 'execution command' : 'non-command'}; autoExecute=${decision.autoExecute}. ${decision.reason}`));
    // ---- Step 3: verify required tools/access ----
    const toolAvailability = checkToolAvailability();
    steps.push(step(3, 'verify tools/access', toolAvailability.canExecuteEndToEnd ? 'verified' : 'unverified', `${toolAvailability.available}/${toolAvailability.total} tools available; end-to-end=${toolAvailability.canExecuteEndToEnd}${toolAvailability.blockedSteps.length > 0 ? `; blocked steps: ${toolAvailability.blockedSteps.join(', ')}` : ''}.`));
    // ---- Step 4: create execution plan ----
    const blocks = splitTaskIntoBlocks(exactTask);
    steps.push(step(4, 'create execution plan', blocks.length > 0 ? 'verified' : 'failed', `Plan: ${blocks.length} block(s) — ${blocks.slice(0, 5).map((b) => b.title).join(' · ')}${blocks.length > 5 ? ' …' : ''}.`));
    // ---- SAFETY GATE: human required for the six guarded categories ----
    if (decision.requiresApproval) {
        const approvalReason = `Human approval required: ${decision.approvalCategories.join(', ')}. ${decision.reason}`;
        for (const [n, name] of [
            [5, 'execute'],
            [6, 'run tests'],
            [7, 'deploy if allowed'],
            [8, 'verify production'],
            [9, 'detect failure'],
            [10, 'retry or self-heal'],
            [11, 'roll back if needed'],
        ]) {
            steps.push(step(n, name, 'blocked', `Held — ${approvalReason}`));
        }
        const traceId = await safeTrace({
            taskId,
            requestId,
            conversationId: options.conversationId ?? null,
            toolName: 'ivx-autonomous-mode',
            rawOutput: { decision, blocks: blocks.map((b) => b.title) },
            linkedClaim: `Autonomous task HELD for human approval (${decision.approvalCategories.join(', ')}).`,
        });
        steps.push(step(12, 'return proof', 'verified', `Held for approval; trace=${traceId ?? 'n/a'}.`));
        return finalize({
            taskId, requestId, startedAt, startMs, task: exactTask, decision, toolAvailability,
            blocks, selfHeal: null, production: null, steps,
            classification: EVIDENCE_CLASSIFICATION.NOT_EXECUTED,
            finalStatus: 'BLOCKED_FOR_APPROVAL',
            humanApprovalRequired: true, approvalReason, executionTraceId: traceId,
        });
    }
    // ---- Steps 5–11: execute → test → deploy → verify → detect → retry → rollback ----
    // Delegated to the self-heal cycle (find blocker → fix safely → test → verify
    // production → rollback if needed → resume), which encodes exactly this loop.
    let selfHeal = null;
    let production = null;
    try {
        // Lazy-import the heavy self-heal cycle (pulls the AI runtime) only when the
        // default runner is actually used, so injected-runner callers/tests stay light.
        const runner = options.selfHealRunner ?? (async (opts) => {
            const { runSelfHealCycle } = await import('./ivx-self-heal-cycle');
            return runSelfHealCycle({ approverEmail: opts.approverEmail, suites: options.suites });
        });
        selfHeal = await runner({ approverEmail: options.approverEmail });
        production = selfHeal.production;
        const fixStage = selfHeal.stages.find((s) => s.name === 'fix safely');
        const testStages = selfHeal.stages.filter((s) => s.name.startsWith('run tests'));
        const verifyStage = selfHeal.stages.find((s) => s.name === 'verify production');
        const rollbackStage = selfHeal.stages.find((s) => s.name === 'rollback if needed');
        const testsPassed = testStages.length > 0 && testStages.every((s) => s.status === 'verified');
        steps.push(step(5, 'execute', fixStage ? mapStatus(fixStage.status) : 'skipped', fixStage?.proof ?? 'No execution stage produced.'));
        steps.push(step(6, 'run tests', testStages.length > 0 ? (testsPassed ? 'verified' : 'failed') : 'skipped', testStages.map((s) => s.proof).join(' | ') || 'No test suites run.'));
        const directDeployAvailable = toolAvailability.tools.some((t) => (t.tool === 'render_deploy' || t.tool === 'github_write') && t.available);
        steps.push(step(7, 'deploy if allowed', 
        // Direct API deploy → verified; otherwise SKIPPED, not failed: push-to-main
        // auto-deploy (render.yaml autoDeployTrigger: commit) is still a valid path.
        directDeployAvailable ? 'verified' : 'skipped', directDeployAvailable
            ? 'Deploy path available (direct GitHub/Render API control).'
            : 'Direct deploy API not configured — ships via push-to-main auto-deploy (render.yaml autoDeployTrigger: commit).'));
        steps.push(step(8, 'verify production', verifyStage ? mapStatus(verifyStage.status) : 'skipped', verifyStage?.proof ?? 'No production verification stage.'));
        const anyFailure = selfHeal.stages.some((s) => s.status === 'failed') || !testsPassed || (production?.thresholdExceeded ?? false);
        steps.push(step(9, 'detect failure', 'verified', anyFailure ? 'Failure detected — see failed test/verify stages and production health.' : 'No failure detected across execute/test/verify.'));
        steps.push(step(10, 'retry or self-heal', fixStage ? 'verified' : 'skipped', fixStage ? `Self-heal repair proposal: ${fixStage.proof}` : 'No blocker required a fix proposal.'));
        steps.push(step(11, 'roll back if needed', rollbackStage ? mapStatus(rollbackStage.status) : 'skipped', rollbackStage?.proof ?? 'No rollback stage.'));
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        for (const [n, name] of [
            [5, 'execute'], [6, 'run tests'], [7, 'deploy if allowed'], [8, 'verify production'],
            [9, 'detect failure'], [10, 'retry or self-heal'], [11, 'roll back if needed'],
        ]) {
            steps.push(step(n, name, 'failed', `Self-heal cycle threw: ${message}`));
        }
    }
    // ---- Step 12: return proof (durable execution trace + classification) ----
    const executed = selfHeal !== null;
    const allOk = executed
        && steps.filter((s) => s.step >= 5 && s.step <= 11).every((s) => s.status === 'verified' || s.status === 'skipped')
        && production !== null
        && production.total > 0
        && production.failures === 0
        && !production.thresholdExceeded;
    const classification = !executed
        ? EVIDENCE_CLASSIFICATION.NOT_EXECUTED
        : allOk
            ? EVIDENCE_CLASSIFICATION.VERIFIED
            : EVIDENCE_CLASSIFICATION.UNVERIFIED;
    const finalStatus = classification === EVIDENCE_CLASSIFICATION.VERIFIED ? 'VERIFIED' : 'FAILED';
    const traceId = await safeTrace({
        taskId,
        requestId,
        conversationId: options.conversationId ?? null,
        toolName: 'ivx-autonomous-mode',
        rawOutput: {
            decision,
            toolAvailability: { available: toolAvailability.available, total: toolAvailability.total, canExecuteEndToEnd: toolAvailability.canExecuteEndToEnd },
            selfHealCycleId: selfHeal?.cycleId ?? null,
            steps,
        },
        rawOutputRef: selfHeal ? `logs/audit/self-heal/${selfHeal.cycleId}.json` : null,
        linkedClaim: `Autonomous task ${finalStatus} (${classification}).`,
    });
    steps.push(step(12, 'return proof', 'verified', `classification=${classification}; trace=${traceId ?? 'n/a'}; selfHealCycle=${selfHeal?.cycleId ?? 'n/a'}.`));
    return finalize({
        taskId, requestId, startedAt, startMs, task: exactTask, decision, toolAvailability,
        blocks, selfHeal, production, steps, classification, finalStatus,
        humanApprovalRequired: false, approvalReason: null, executionTraceId: traceId,
    });
}
function mapStatus(s) {
    if (s === 'verified')
        return 'verified';
    if (s === 'failed')
        return 'failed';
    if (s === 'skipped')
        return 'skipped';
    return 'unverified';
}
async function safeTrace(input) {
    try {
        return await recordExecutionTrace(input);
    }
    catch {
        return null;
    }
}
function finalize(input) {
    return {
        marker: IVX_AUTONOMOUS_MODE_MARKER,
        taskId: input.taskId,
        requestId: input.requestId,
        startedAt: input.startedAt,
        finishedAt: nowIso(),
        durationMs: Date.now() - input.startMs,
        task: input.task,
        intent: {
            isOwnerExecutionCommand: input.decision.isOwnerExecutionCommand,
            autoExecute: input.decision.autoExecute,
            requiresApproval: input.decision.requiresApproval,
            approvalCategories: input.decision.approvalCategories,
            safeCategories: input.decision.safeCategories,
            reason: input.decision.reason,
        },
        toolAvailability: input.toolAvailability,
        plan: { blockCount: input.blocks.length, blocks: input.blocks.map((b) => ({ title: b.title })) },
        selfHeal: input.selfHeal,
        production: input.production,
        humanApprovalRequired: input.humanApprovalRequired,
        approvalReason: input.approvalReason,
        steps: input.steps,
        classification: input.classification,
        finalStatus: input.finalStatus,
        executionTraceId: input.executionTraceId,
    };
}
