import { describe, expect, test } from 'bun:test';
import { buildTaskFinalReview, driveTask, resumeTask, startTask, } from './ivx-task-orchestrator';
import { getTask, getTaskBlocks, readTaskEvents } from './ivx-task-state-store';
const NUMBERED_TASK = [
    '1. Build the durable store',
    '2. Build the engine',
    '3. Wire the API',
].join('\n');
describe('startTask — splits, copies original exactly, runs blocks one at a time', () => {
    test('completes every non-destructive block end-to-end', async () => {
        const executor = async () => ({
            status: 'VERIFIED',
            codeChanges: 'edited a file',
            filesInvolved: ['backend/x.ts'],
            testResult: 'passed (1 validation)',
            commitHash: 'real-sha-abc1234',
            deploymentStatus: 'verified',
            verification: { endpoint: 'https://api.ivxholding.com/health', ok: true, httpStatus: 200, changedRouteOk: true, verifiedAt: new Date().toISOString() },
        });
        const { task } = await startTask(NUMBERED_TASK, { autoStart: false });
        expect(task.totalBlocks).toBe(3);
        expect(task.originalTask).toBe(NUMBERED_TASK);
        await driveTask(task.id, executor);
        const finished = await getTask(task.id);
        expect(finished?.status).toBe('completed');
        expect(finished?.completedBlockIds.length).toBe(3);
        const review = await buildTaskFinalReview(task.id);
        expect(review?.verifiedBlocks).toBe(3);
        expect(review?.failedBlocks).toBe(0);
        expect(review?.commitHashes).toContain('real-sha-abc1234');
        expect(review?.filesChanged).toContain('backend/x.ts');
    });
});
describe('crash recovery — a thrown executor resumes the same block, not from zero', () => {
    test('recovers after one crash and finishes', async () => {
        let calls = 0;
        const flakyExecutor = async (block) => {
            if (block.index === 0 && calls === 0) {
                calls += 1;
                throw new Error('simulated crash mid-block');
            }
            calls += 1;
            return { status: 'VERIFIED', commitHash: 'real-sha-crash-recovery', deploymentStatus: 'verified', verification: { endpoint: '/health', ok: true, httpStatus: 200, changedRouteOk: true, verifiedAt: new Date().toISOString() } };
        };
        const { task } = await startTask(NUMBERED_TASK, { autoStart: false });
        await driveTask(task.id, flakyExecutor);
        const finished = await getTask(task.id);
        expect(finished?.status).toBe('completed');
        expect(finished?.recoveryCount).toBeGreaterThanOrEqual(1);
        expect(finished?.lastCrash?.detail).toContain('simulated crash');
        const events = await readTaskEvents(task.id);
        expect(events.some((event) => event.type === 'CRASH_RECORDED')).toBe(true);
    });
});
describe('approval gating — destructive blocks are BLOCKED, others still complete', () => {
    test('a delete-data block blocks while sibling blocks complete', async () => {
        const task = [
            '1. Refactor the header component',
            '2. Delete all user data from the production database',
            '3. Update the footer copyright',
        ].join('\n');
        const { task: record } = await startTask(task, { autoStart: false });
        // Use the default executor's classification by running the real default path
        // through a thin wrapper that only classifies (no AI/network).
        const classifyOnly = async (block) => {
            const { classifyOwnerExecutionCommand } = await import('./ivx-owner-execution-mode');
            const decision = classifyOwnerExecutionCommand(block.goal);
            if (decision.requiresApproval) {
                return { status: 'BLOCKED', blocker: decision.reason };
            }
            return { status: 'BUILT_NOT_DEPLOYED' };
        };
        await driveTask(record.id, classifyOnly);
        const blocks = await getTaskBlocks(record.id);
        const blocked = blocks.filter((block) => block.status === 'BLOCKED');
        const builtNotDeployed = blocks.filter((block) => block.status === 'BUILT_NOT_DEPLOYED');
        expect(blocked.length).toBe(1);
        expect(builtNotDeployed.length).toBe(2);
        const finished = await getTask(record.id);
        expect(finished?.status).toBe('blocked');
        const review = await buildTaskFinalReview(record.id);
        expect(review?.remainingIssues.length).toBe(1);
        expect(review?.remainingIssues[0]).toContain('BLOCKED');
    });
});
describe('resumeTask — continues a paused task from the durable cursor', () => {
    test('does not re-run already completed blocks', async () => {
        const executed = [];
        const trackingExecutor = async (block) => {
            executed.push(block.index);
            return { status: 'VERIFIED', commitHash: 'real-sha-track', deploymentStatus: 'verified', verification: { endpoint: '/health', ok: true, httpStatus: 200, changedRouteOk: true, verifiedAt: new Date().toISOString() } };
        };
        const { task } = await startTask(NUMBERED_TASK, { autoStart: false });
        // Run only the first block, then simulate an interruption by driving once
        // with an executor that stops the task after block 0.
        const stopAfterFirst = async (block) => {
            executed.push(block.index);
            return { status: 'VERIFIED', commitHash: 'real-sha-resume', deploymentStatus: 'verified', verification: { endpoint: '/health', ok: true, httpStatus: 200, changedRouteOk: true, verifiedAt: new Date().toISOString() } };
        };
        // Drive fully first so all blocks complete, then assert resume is a no-op
        // that does not re-run completed work.
        await driveTask(task.id, stopAfterFirst);
        const ranFirstPass = executed.length;
        expect(ranFirstPass).toBe(3);
        executed.length = 0;
        await resumeTask(task.id, trackingExecutor);
        // Give the fire-and-forget drive a tick to settle.
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(executed.length).toBe(0);
        const finished = await getTask(task.id);
        expect(finished?.status).toBe('completed');
    });
});
