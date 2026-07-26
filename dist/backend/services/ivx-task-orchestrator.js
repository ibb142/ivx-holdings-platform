/**
 * IVX crash-safe task orchestrator.
 *
 * Receives a large owner task, copies it EXACTLY, splits it into ordered blocks,
 * then executes the blocks ONE AT A TIME — persisting each block's result before
 * the next starts. This makes large senior-developer tasks crash-safe:
 *
 *   - A crash/reload/timeout loses at most the single in-flight block.
 *   - `resumeTask` continues from the last unfinished block (durable cursor) —
 *     never restarting from zero, never re-running completed blocks, never
 *     losing the original owner task.
 *   - Non-destructive blocks execute without an approval prompt; only the six
 *     guarded categories (delete data / prod schema / secrets / billing /
 *     security / external access) are marked BLOCKED for explicit confirmation.
 *   - After every block finishes, a final review aggregates the proof.
 *
 * The block executor is injectable so the engine is unit-testable without the AI
 * gateway / network / git. The default executor delegates non-destructive work to
 * the senior-developer runtime in `systemMode`.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { classifyOwnerExecutionCommand } from './ivx-owner-execution-mode';
import { splitTaskIntoBlocks } from './ivx-task-block-splitter';
import { appendTaskEvent, createTask, findResumeBlock, getTask, getTaskBlocks, updateTask, updateTaskBlock, } from './ivx-task-state-store';
/** Hard caps so a runaway/never-completing loop can't spin forever. */
const MAX_RECOVERIES = 10;
const MAX_ATTEMPTS_PER_BLOCK = 2;
/** Tracks tasks currently being driven in this process to avoid double-running. */
const activeRuns = new Set();
/**
 * Default executor: classify the block, gate destructive work, otherwise run the
 * senior-developer runtime end-to-end in systemMode. Dynamically imports the heavy
 * runtime so the read-only orchestration paths stay lightweight.
 */
export const defaultBlockExecutor = async (block) => {
    const decision = classifyOwnerExecutionCommand(block.goal);
    if (decision.requiresApproval) {
        return {
            status: 'BLOCKED',
            blocker: `Requires explicit owner approval — ${decision.reason}`,
        };
    }
    try {
        const { runIVXSeniorDeveloperTask } = await import('./ivx-senior-developer-runtime');
        const proof = await runIVXSeniorDeveloperTask({
            goal: block.goal,
            systemMode: true,
            approvePatch: true,
            approveGitDeploy: true,
        });
        const validation = proof.validations.find((entry) => entry.command) ?? proof.validations[0] ?? null;
        const validationPassed = proof.validations.length > 0 && proof.validations.every((entry) => entry.ok);
        const commitSha = proof.gitDeployOperator.github.commitSha;
        const committed = proof.gitDeployOperator.status === 'executed' && Boolean(commitSha);
        const deployed = proof.gitDeployOperator.status === 'executed' && proof.gitDeployOperator.render.deployAttempted;
        const verified = proof.productionVerification.ok;
        // Capture the real post-deploy verification evidence (endpoint + HTTP status +
        // changed-route check) so the monitor can prove the live app responded — not
        // just show a "verified" word. Only attach it once a deploy actually happened.
        const verification = deployed
            ? {
                endpoint: proof.productionVerification.endpoint,
                ok: proof.productionVerification.ok,
                httpStatus: proof.productionVerification.httpStatus,
                changedRouteOk: proof.changedRouteVerification.ok,
                verifiedAt: new Date().toISOString(),
            }
            : null;
        // REAL lifecycle: a block is only VERIFIED when it has a real commit SHA,
        // a real Render deploy, and production /health shows the new commit.
        // Code built but never deployed is BUILT_NOT_DEPLOYED — NOT a success.
        let status;
        if (verified && committed && deployed) {
            status = 'VERIFIED';
        }
        else if (!proof.ok) {
            status = 'FAILED';
        }
        else if (committed && deployed) {
            // Deployed but production verification failed — still not verified.
            status = 'BUILT_NOT_DEPLOYED';
        }
        else {
            // Code was written/validated but never pushed or deployed.
            status = 'BUILT_NOT_DEPLOYED';
        }
        // Surface the real reason a block did not complete (failing validation
        // detail, then the git/deploy operator reason) so the owner sees the exact
        // blocker in the task API instead of a generic message.
        // Real code the block wrote, for the live coding stream: prefer the applied
        // unified diff, then any generated-feature source file, so the monitor animates
        // the actual characters IVX produced — not a placeholder.
        const diffText = proof.patchProposal.diffPreview && proof.patchProposal.status === 'proposed'
            ? proof.patchProposal.diffPreview
            : null;
        const generatedSource = await readGeneratedFeatureSource(proof.generatedFeature.feature?.sourceFile ?? null);
        const codeDiff = [diffText, generatedSource].filter((part) => Boolean(part && part.trim())).join('\n\n') || null;
        const failingValidation = proof.validations.find((entry) => !entry.ok) ?? null;
        const realBlocker = proof.ok
            ? null
            : (failingValidation?.error
                ?? failingValidation?.stderrTail
                ?? proof.gitDeployOperator.reason
                ?? 'Senior-developer runtime reported the block did not complete end-to-end.');
        // A BUILT_NOT_DEPLOYED block must surface the real deploy blocker so the
        // owner sees exactly why it did not ship — not a fake "completed".
        const deployBlocker = !committed
            ? (proof.gitDeployOperator.github.error ?? 'GitHub commit/push did not succeed — no real commit SHA.')
            : !deployed
                ? (proof.gitDeployOperator.render.error ?? 'Render deploy was not triggered.')
                : !verified
                    ? (proof.productionVerification.error ?? 'Production /health did not show the new commit.')
                    : null;
        return {
            status,
            codeChanges: proof.changedFiles.length > 0 ? proof.changedFiles.join(', ') : 'No code change required (target already satisfies the goal).',
            codeDiff,
            filesInvolved: proof.changedFiles,
            validationCommand: validation?.command ?? null,
            testResult: proof.validations.length > 0 ? `${validationPassed ? 'passed' : 'failed'} (${proof.validations.length} validation${proof.validations.length === 1 ? '' : 's'})` : null,
            commitHash: committed ? commitSha ?? null : null,
            deploymentStatus: deployed ? (verified ? 'verified' : 'deployed-not-verified') : 'not-deployed',
            verification,
            blocker: realBlocker ?? deployBlocker,
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Block execution failed.';
        return { status: 'FAILED', error: message, blocker: message };
    }
};
/**
 * Read the source of a generated feature file so the live coding stream can show
 * the real characters written. Stays inside the repo, caps size, and never throws.
 */
async function readGeneratedFeatureSource(sourceFile) {
    if (!sourceFile || typeof sourceFile !== 'string') {
        return null;
    }
    try {
        const root = process.cwd();
        const resolved = path.resolve(root, sourceFile);
        if (!resolved.startsWith(root)) {
            return null;
        }
        const contents = await readFile(resolved, 'utf8');
        return contents.length > 12000 ? `${contents.slice(0, 12000)}\n… (truncated)` : contents;
    }
    catch {
        return null;
    }
}
function isTerminalTaskStatus(status) {
    return status === 'completed' || status === 'cancelled';
}
/**
 * Drive a task to completion in the background, one block at a time. Safe to call
 * fire-and-forget. Re-reads task + blocks each loop so a pause/cancel issued via
 * the API takes effect between blocks, and so a crash mid-block resumes cleanly.
 */
export async function driveTask(taskId, executor = defaultBlockExecutor) {
    if (activeRuns.has(taskId)) {
        return;
    }
    activeRuns.add(taskId);
    try {
        let task = await getTask(taskId);
        if (!task) {
            return;
        }
        await updateTask(taskId, { status: 'running', error: null });
        while (true) {
            task = await getTask(taskId);
            if (!task) {
                return;
            }
            if (task.status === 'paused' || task.status === 'cancelled') {
                await appendTaskEvent(taskId, { type: 'TASK_HALTED', blockId: null, detail: task.status });
                return;
            }
            const blocks = await getTaskBlocks(taskId);
            const block = findResumeBlock(blocks);
            if (!block) {
                // No runnable block left — settle the task status from the block roll-ups.
                await finalizeTaskStatus(taskId);
                return;
            }
            if (block.attempts >= MAX_ATTEMPTS_PER_BLOCK) {
                await updateTaskBlock(taskId, block.id, {
                    status: 'FAILED',
                    error: `Exceeded ${MAX_ATTEMPTS_PER_BLOCK} attempts.`,
                    blocker: block.blocker ?? `Block failed after ${MAX_ATTEMPTS_PER_BLOCK} attempts.`,
                });
                continue;
            }
            await updateTaskBlock(taskId, block.id, {
                status: 'RUNNING',
                startedAt: block.startedAt ?? new Date().toISOString(),
                attempts: block.attempts + 1,
            });
            await appendTaskEvent(taskId, { type: 'BLOCK_STARTED', blockId: block.id, detail: block.title });
            let result;
            try {
                result = await executor(block, task);
            }
            catch (error) {
                // A thrown executor is treated as a recoverable crash — persist details
                // and let the loop resume this same block (until attempts are exhausted).
                const message = error instanceof Error ? error.message : 'Executor crashed.';
                await recordCrash(taskId, block.id, message);
                await updateTaskBlock(taskId, block.id, { status: 'PENDING', error: message });
                const after = await getTask(taskId);
                if (!after || after.recoveryCount >= MAX_RECOVERIES) {
                    await updateTaskBlock(taskId, block.id, { status: 'FAILED', blocker: `Crash recovery cap reached: ${message}` });
                    await finalizeTaskStatus(taskId);
                    return;
                }
                continue;
            }
            const completedAt = ['VERIFIED', 'BUILT_NOT_DEPLOYED', 'BLOCKED', 'FAILED'].includes(result.status) ? new Date().toISOString() : null;
            await updateTaskBlock(taskId, block.id, {
                status: result.status,
                codeChanges: result.codeChanges ?? block.codeChanges,
                codeDiff: result.codeDiff ?? block.codeDiff,
                validationCommand: result.validationCommand ?? block.validationCommand,
                testResult: result.testResult ?? block.testResult,
                commitHash: result.commitHash ?? block.commitHash,
                deploymentStatus: result.deploymentStatus ?? block.deploymentStatus,
                verification: result.verification ?? block.verification,
                filesInvolved: result.filesInvolved ?? block.filesInvolved,
                blocker: result.blocker ?? null,
                error: result.error ?? null,
                completedAt,
            });
            if (result.deploymentStatus) {
                await updateTask(taskId, { deploymentStatus: result.deploymentStatus });
            }
            // Emit the real written code as a forensics event so the live coding stream
            // can render the exact characters IVX produced for this block.
            if (result.codeDiff && result.codeDiff.trim()) {
                await appendTaskEvent(taskId, {
                    type: 'CODE_STREAM',
                    blockId: block.id,
                    detail: result.codeDiff.slice(0, 8000),
                });
            }
            // BLOCKED / FAILED blocks do not stop the run — the loop advances to the
            // next runnable block so independent work still completes. The final review
            // surfaces every blocked/failed block to the owner.
        }
    }
    finally {
        activeRuns.delete(taskId);
    }
}
/**
 * Settle the overall task status from the authoritative block roll-ups.
 * A task is only 'completed' (success) when ALL blocks are VERIFIED.
 * BUILT_NOT_DEPLOYED blocks mean the task is NOT complete — the code was
 * written but never shipped, so the task stays 'blocked' with the real reason.
 */
async function finalizeTaskStatus(taskId) {
    const blocks = await getTaskBlocks(taskId);
    const anyFailed = blocks.some((block) => block.status === 'FAILED');
    const anyBlocked = blocks.some((block) => block.status === 'BLOCKED');
    const anyBuiltNotDeployed = blocks.some((block) => block.status === 'BUILT_NOT_DEPLOYED');
    const allVerified = blocks.length > 0 && blocks.every((block) => block.status === 'VERIFIED');
    let status;
    if (allVerified) {
        status = 'completed';
    }
    else if (anyFailed) {
        status = 'failed';
    }
    else if (anyBlocked || anyBuiltNotDeployed) {
        // BUILT_NOT_DEPLOYED is a deploy blocker — the task did not ship.
        status = 'blocked';
    }
    else {
        status = 'blocked';
    }
    const deployBlocker = anyBuiltNotDeployed
        ? `${blocks.filter((b) => b.status === 'BUILT_NOT_DEPLOYED').length} block(s) built but never deployed (BUILT_NOT_DEPLOYED).`
        : null;
    const settled = await updateTask(taskId, { status, completedAt: allVerified ? new Date().toISOString() : null, error: deployBlocker });
    await appendTaskEvent(taskId, { type: `TASK_${status.toUpperCase()}`, blockId: null, detail: `${blocks.length} blocks${deployBlocker ? ` — ${deployBlocker}` : ''}` });
    return settled;
}
/** Persist crash details and bump the recovery counter. */
export async function recordCrash(taskId, blockId, detail) {
    const task = await getTask(taskId);
    await updateTask(taskId, {
        lastCrash: { at: new Date().toISOString(), detail, blockId },
        recoveryCount: (task?.recoveryCount ?? 0) + 1,
    });
    await appendTaskEvent(taskId, { type: 'CRASH_RECORDED', blockId, detail });
}
/** Create a crash-safe task: copy the original exactly, split into blocks, start. */
export async function startTask(ownerCommand, options = {}) {
    const original = ownerCommand;
    const planned = splitTaskIntoBlocks(original);
    const { task, blocks } = await createTask({
        ownerCommand: original,
        originalTask: original,
        blocks: planned.length > 0 ? planned : [{ title: 'Task', goal: original }],
    });
    console.log('[IVXTaskOrchestrator] TASK_CREATED', { taskId: task.id, totalBlocks: task.totalBlocks });
    if (options.autoStart !== false) {
        void driveTask(task.id, options.executor ?? defaultBlockExecutor);
    }
    return { task, blocks };
}
/**
 * Resume a task after a crash, pause, or process restart. Continues from the last
 * unfinished block — completed blocks are kept, the original task is preserved.
 */
export async function resumeTask(taskId, executor = defaultBlockExecutor) {
    const task = await getTask(taskId);
    if (!task) {
        return null;
    }
    if (isTerminalTaskStatus(task.status)) {
        return task;
    }
    if (activeRuns.has(taskId)) {
        return task;
    }
    const blocks = await getTaskBlocks(taskId);
    const resumeBlock = findResumeBlock(blocks);
    // A RUNNING block left over from a crash should be retried, not abandoned.
    if (resumeBlock && resumeBlock.status === 'RUNNING') {
        await updateTaskBlock(taskId, resumeBlock.id, { status: 'PENDING' });
    }
    await appendTaskEvent(taskId, {
        type: 'TASK_RESUMED',
        blockId: resumeBlock?.id ?? null,
        detail: resumeBlock ? `from block ${resumeBlock.index + 1}` : 'no unfinished block',
    });
    const resumed = await updateTask(taskId, { status: 'running', error: null });
    void driveTask(taskId, executor);
    return resumed ?? task;
}
export async function pauseTask(taskId) {
    const task = await getTask(taskId);
    if (!task || isTerminalTaskStatus(task.status)) {
        return task;
    }
    return await updateTask(taskId, { status: 'paused' });
}
export async function cancelTask(taskId) {
    const task = await getTask(taskId);
    if (!task) {
        return null;
    }
    return await updateTask(taskId, { status: 'cancelled', completedAt: new Date().toISOString() });
}
/** Assemble the end-to-end final owner report from durable block state. */
export async function buildTaskFinalReview(taskId) {
    const task = await getTask(taskId);
    if (!task) {
        return null;
    }
    const blocks = await getTaskBlocks(taskId);
    const filesChanged = [...new Set(blocks.flatMap((block) => block.filesInvolved))].filter(Boolean);
    const commitHashes = [...new Set(blocks.map((block) => block.commitHash).filter((hash) => Boolean(hash)))];
    const remainingIssues = blocks
        .filter((block) => block.status === 'FAILED' || block.status === 'BLOCKED')
        .map((block) => `Block ${block.index + 1} (${block.title}) — ${block.status}: ${block.blocker ?? block.error ?? 'see logs'}`);
    const testsPassed = blocks.filter((block) => (block.testResult ?? '').toLowerCase().startsWith('passed')).length;
    return {
        taskId: task.id,
        originalTask: task.originalTask,
        status: task.status,
        totalBlocks: blocks.length,
        completedBlocks: blocks.filter((block) => block.status === 'VERIFIED' || block.status === 'BUILT_NOT_DEPLOYED').length,
        builtNotDeployedBlocks: blocks.filter((block) => block.status === 'BUILT_NOT_DEPLOYED').length,
        failedBlocks: blocks.filter((block) => block.status === 'FAILED').length,
        blockedBlocks: blocks.filter((block) => block.status === 'BLOCKED').length,
        verifiedBlocks: blocks.filter((block) => block.status === 'VERIFIED').length,
        deployedBlocks: blocks.filter((block) => block.status === 'VERIFIED').length,
        filesChanged,
        commitHashes,
        deploymentStatus: task.deploymentStatus,
        testsPassed,
        remainingIssues,
        blocks,
    };
}
/**
 * On boot, find tasks that were mid-flight (running) when the process died and
 * resume them from their durable cursor. Returns the ids it resumed.
 */
export async function recoverInterruptedTasks(listFn, executor = defaultBlockExecutor) {
    const tasks = await listFn();
    const resumed = [];
    for (const task of tasks) {
        if (task.status === 'running' && !activeRuns.has(task.id)) {
            await recordCrash(task.id, task.currentBlockId, 'Process restart detected — resuming from durable cursor.');
            await resumeTask(task.id, executor);
            resumed.push(task.id);
        }
    }
    return resumed;
}
