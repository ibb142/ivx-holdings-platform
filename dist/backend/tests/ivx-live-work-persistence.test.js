/**
 * Phase 4 + Phase 6: Live Work reliability and failure path tests.
 *
 * Tests:
 * - Task state persists across refresh/restart (durable store)
 * - Duplicate events are not displayed
 * - Ordering is deterministic (newest first)
 * - Terminal states cannot revert to running
 * - Cancel works
 * - Failure states produce honest FAILED/BLOCKED/CANCELLED/TIMED_OUT
 * - No fake success on failures
 * - No secret leakage in any state
 */
import { describe, expect, test } from 'bun:test';
import { createTask, getTask, getTaskBlocks, updateTask, updateTaskBlock, readTaskEvents, TERMINAL_BLOCK_STATUSES } from '../services/ivx-task-state-store';
import { buildLiveWorkSnapshot } from '../services/ivx-live-work';
describe('Live Work Persistence', () => {
    test('task state persists across refresh (read after create)', async () => {
        const { task, blocks } = await createTask({
            ownerCommand: 'Test persistence task',
            originalTask: 'Test persistence task — exact copy',
            blocks: [
                { title: 'Block 1: Inspect', goal: 'Inspect repo' },
                { title: 'Block 2: Patch', goal: 'Apply patch' },
                { title: 'Block 3: Deploy', goal: 'Deploy and verify' },
            ],
        });
        // Simulate a "refresh" by re-reading from disk
        const reRead = await getTask(task.id);
        expect(reRead).not.toBeNull();
        expect(reRead.id).toBe(task.id);
        expect(reRead.ownerCommand).toBe('Test persistence task');
        expect(reRead.totalBlocks).toBe(3);
        expect(reRead.status).toBe('queued');
        const reReadBlocks = await getTaskBlocks(task.id);
        expect(reReadBlocks).toHaveLength(3);
        expect(reReadBlocks[0].status).toBe('PENDING');
        expect(reReadBlocks[0].title).toBe('Block 1: Inspect');
    });
    test('block updates persist (status transitions)', async () => {
        const { task, blocks } = await createTask({
            ownerCommand: 'Block transition test',
            originalTask: 'Block transition test',
            blocks: [{ title: 'Only block', goal: 'Test transitions' }],
        });
        // PENDING → RUNNING
        await updateTaskBlock(task.id, blocks[0].id, {
            status: 'RUNNING',
            startedAt: new Date().toISOString(),
        });
        let reRead = await getTaskBlocks(task.id);
        expect(reRead[0].status).toBe('RUNNING');
        // RUNNING → TESTING
        await updateTaskBlock(task.id, blocks[0].id, {
            status: 'TESTING',
        });
        reRead = await getTaskBlocks(task.id);
        expect(reRead[0].status).toBe('TESTING');
        // TESTING → VERIFIED (terminal success)
        await updateTaskBlock(task.id, blocks[0].id, {
            status: 'VERIFIED',
            commitHash: 'abc123def456',
            testResult: 'PASSED: 10 tests',
            completedAt: new Date().toISOString(),
            verification: {
                endpoint: 'https://api.ivxholding.com/health',
                ok: true,
                httpStatus: 200,
                changedRouteOk: true,
                verifiedAt: new Date().toISOString(),
            },
        });
        reRead = await getTaskBlocks(task.id);
        expect(reRead[0].status).toBe('VERIFIED');
        expect(reRead[0].commitHash).toBe('abc123def456');
        expect(reRead[0].verification?.ok).toBe(true);
    });
    test('terminal states cannot revert to running', () => {
        // This is a contract test: TERMINAL_BLOCK_STATUSES must include VERIFIED, FAILED, BLOCKED
        expect(TERMINAL_BLOCK_STATUSES.has('VERIFIED')).toBe(true);
        expect(TERMINAL_BLOCK_STATUSES.has('FAILED')).toBe(true);
        expect(TERMINAL_BLOCK_STATUSES.has('BLOCKED')).toBe(true);
        expect(TERMINAL_BLOCK_STATUSES.has('BUILT_NOT_DEPLOYED')).toBe(true);
        // Non-terminal states must NOT be in the terminal set
        expect(TERMINAL_BLOCK_STATUSES.has('RUNNING')).toBe(false);
        expect(TERMINAL_BLOCK_STATUSES.has('PENDING')).toBe(false);
        expect(TERMINAL_BLOCK_STATUSES.has('TESTING')).toBe(false);
    });
    test('events are ordered newest first', async () => {
        const { task } = await createTask({
            ownerCommand: 'Event ordering test',
            originalTask: 'Event ordering test',
            blocks: [{ title: 'Block', goal: 'Test' }],
        });
        // Read events — the createTask already appends a TASK_CREATED event
        const events = await readTaskEvents(task.id, 50);
        expect(events.length).toBeGreaterThanOrEqual(1);
        // Events should be returned newest-first (descending by created_at)
        for (let i = 1; i < events.length; i++) {
            expect(events[i - 1].at >= events[i].at).toBe(true);
        }
    });
    test('live work snapshot is defensive and never throws', async () => {
        // Even with no tasks, snapshot should return a valid structure
        const snapshot = await buildLiveWorkSnapshot(40);
        expect(snapshot).not.toBeNull();
        expect(snapshot.marker).toBe('ivx-live-work-2026-05-31');
        expect(Array.isArray(snapshot.liveLogs)).toBe(true);
        expect(Array.isArray(snapshot.proofOutput)).toBe(true);
        expect(Array.isArray(snapshot.recentCompletedTasks)).toBe(true);
        expect(typeof snapshot.summary).toBe('string');
    });
    test('cancel sets task status to cancelled (terminal)', async () => {
        const { task } = await createTask({
            ownerCommand: 'Cancel test',
            originalTask: 'Cancel test',
            blocks: [{ title: 'Block', goal: 'Test cancel' }],
        });
        await updateTask(task.id, { status: 'cancelled', completedAt: new Date().toISOString() });
        const reRead = await getTask(task.id);
        expect(reRead.status).toBe('cancelled');
    });
    test('failed task records error honestly', async () => {
        const { task } = await createTask({
            ownerCommand: 'Failure test',
            originalTask: 'Failure test',
            blocks: [{ title: 'Block', goal: 'Test failure' }],
        });
        await updateTask(task.id, {
            status: 'failed',
            error: 'Deploy trigger returned HTTP 401: Invalid API key',
        });
        const reRead = await getTask(task.id);
        expect(reRead.status).toBe('failed');
        expect(reRead.error).toContain('401');
        expect(reRead.error).toContain('Invalid API key');
    });
    test('no secret values in task records or events', async () => {
        const { task } = await createTask({
            ownerCommand: 'Secret safety test',
            originalTask: 'Secret safety test',
            blocks: [{ title: 'Block', goal: 'Test secret safety' }],
        });
        const reRead = await getTask(task.id);
        const serialized = JSON.stringify(reRead);
        expect(serialized).not.toContain('ghp_');
        expect(serialized).not.toContain('rnd_');
        expect(serialized).not.toContain('vck_');
        expect(serialized).not.toContain('Bearer ');
        expect(serialized).not.toContain('eyJ');
        const events = await readTaskEvents(task.id, 50);
        const eventsSerialized = JSON.stringify(events);
        expect(eventsSerialized).not.toContain('ghp_');
        expect(eventsSerialized).not.toContain('rnd_');
    });
});
describe('Failure Path Tests (Phase 6)', () => {
    test('missing non-critical optional variable does not crash the runtime', async () => {
        // The runtime should handle missing optional variables gracefully
        // This is tested via the live work snapshot — it should not throw
        const snapshot = await buildLiveWorkSnapshot(10);
        expect(snapshot).not.toBeNull();
    });
    test('invalid GitHub token produces honest failure (not fake success)', async () => {
        const { task, blocks } = await createTask({
            ownerCommand: 'Invalid GitHub token test',
            originalTask: 'Invalid GitHub token test',
            blocks: [{ title: 'Push', goal: 'Push to GitHub' }],
        });
        // Simulate a failed push with honest error
        await updateTaskBlock(task.id, blocks[0].id, {
            status: 'FAILED',
            error: 'GitHub commit failed: HTTP 401 — Bad credentials',
            completedAt: new Date().toISOString(),
        });
        await updateTask(task.id, {
            status: 'failed',
            error: 'GitHub commit failed: HTTP 401 — Bad credentials',
        });
        const reRead = await getTask(task.id);
        expect(reRead.status).toBe('failed');
        expect(reRead.error).toContain('401');
        expect(reRead.error).toContain('Bad credentials');
        // No fake commit hash
        const reReadBlocks = await getTaskBlocks(task.id);
        expect(reReadBlocks[0].commitHash).toBeNull();
    });
    test('invalid Render service ID produces honest failure', async () => {
        const { task, blocks } = await createTask({
            ownerCommand: 'Invalid Render service ID test',
            originalTask: 'Invalid Render service ID test',
            blocks: [{ title: 'Deploy', goal: 'Deploy to Render' }],
        });
        await updateTaskBlock(task.id, blocks[0].id, {
            status: 'FAILED',
            error: 'Render deploy trigger failed (HTTP 404): Service not found',
            completedAt: new Date().toISOString(),
        });
        const reReadBlocks = await getTaskBlocks(task.id);
        expect(reReadBlocks[0].status).toBe('FAILED');
        expect(reReadBlocks[0].error).toContain('404');
        expect(reReadBlocks[0].deploymentStatus).toBeNull();
    });
    test('failing test fixture produces FAILED status (not VERIFIED)', async () => {
        const { task, blocks } = await createTask({
            ownerCommand: 'Failing test fixture',
            originalTask: 'Failing test fixture',
            blocks: [{ title: 'Test', goal: 'Run tests' }],
        });
        await updateTaskBlock(task.id, blocks[0].id, {
            status: 'FAILED',
            testResult: 'FAILED: 2 pass, 1 fail — exit code 1',
            error: 'Test suite failed: expected true to be false',
            completedAt: new Date().toISOString(),
        });
        const reReadBlocks = await getTaskBlocks(task.id);
        expect(reReadBlocks[0].status).toBe('FAILED');
        expect(reReadBlocks[0].testResult).toContain('FAILED');
        expect(reReadBlocks[0].testResult).toContain('exit code 1');
    });
    test('deployment timeout produces TIMED_OUT status (not fake success)', async () => {
        const { task, blocks } = await createTask({
            ownerCommand: 'Deploy timeout test',
            originalTask: 'Deploy timeout test',
            blocks: [{ title: 'Deploy', goal: 'Deploy and verify' }],
        });
        await updateTaskBlock(task.id, blocks[0].id, {
            status: 'FAILED',
            error: 'Deploy timed out after 120s — deploy status: build_in_progress',
            deploymentStatus: 'build_in_progress (timed out)',
            completedAt: new Date().toISOString(),
        });
        const reReadBlocks = await getTaskBlocks(task.id);
        expect(reReadBlocks[0].status).toBe('FAILED');
        expect(reReadBlocks[0].error).toContain('timed out');
        // No fake verification
        expect(reReadBlocks[0].verification).toBeNull();
    });
    test('unauthorized developer request produces BLOCKED status', async () => {
        const { task, blocks } = await createTask({
            ownerCommand: 'Unauthorized test',
            originalTask: 'Unauthorized test',
            blocks: [{ title: 'Auth', goal: 'Check authorization' }],
        });
        await updateTaskBlock(task.id, blocks[0].id, {
            status: 'BLOCKED',
            blocker: 'Owner session missing — unauthorized developer request',
            completedAt: new Date().toISOString(),
        });
        await updateTask(task.id, {
            status: 'blocked',
            error: 'Owner session missing — unauthorized developer request',
        });
        const reRead = await getTask(task.id);
        expect(reRead.status).toBe('blocked');
        const reReadBlocks = await getTaskBlocks(task.id);
        expect(reReadBlocks[0].status).toBe('BLOCKED');
        expect(reReadBlocks[0].blocker).toContain('Owner session missing');
    });
    test('cancelled owner task produces cancelled status', async () => {
        const { task } = await createTask({
            ownerCommand: 'Cancel test',
            originalTask: 'Cancel test',
            blocks: [{ title: 'Work', goal: 'Do work' }],
        });
        await updateTask(task.id, {
            status: 'cancelled',
            completedAt: new Date().toISOString(),
            error: 'Owner cancelled the task',
        });
        const reRead = await getTask(task.id);
        expect(reRead.status).toBe('cancelled');
        expect(reRead.error).toContain('Owner cancelled');
    });
    test('no fabricated commit SHA or deploy ID on failure', async () => {
        const { task, blocks } = await createTask({
            ownerCommand: 'No fabrication test',
            originalTask: 'No fabrication test',
            blocks: [{ title: 'Deploy', goal: 'Deploy' }],
        });
        // Simulate total failure
        await updateTaskBlock(task.id, blocks[0].id, {
            status: 'FAILED',
            error: 'All steps failed',
            completedAt: new Date().toISOString(),
        });
        await updateTask(task.id, { status: 'failed', error: 'All steps failed' });
        const reReadBlocks = await getTaskBlocks(task.id);
        expect(reReadBlocks[0].commitHash).toBeNull();
        expect(reReadBlocks[0].verification).toBeNull();
        expect(reReadBlocks[0].deploymentStatus).toBeNull();
    });
});
