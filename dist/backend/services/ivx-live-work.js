/**
 * IVX Live Work aggregator (owner-only).
 *
 * One read-only view of everything IVX is doing right now, so the owner can
 * watch the entire workflow live on the tablet (IVX → Live Work) — never a
 * "please wait" placeholder, only real execution evidence:
 *   - current task + current module + percent complete (from the crash-safe
 *     task orchestrator, BLOCK 10/15)
 *   - the live background-agent queue (opportunity / innovation / QA / capital
 *     matching / learning / supabase checks) from the agent activity store
 *   - live logs (orchestrator events + agent runs, newest first)
 *   - proof output (commits / tests / deploy / verification from the active task)
 *   - recent completed tasks
 *
 * Pure aggregation: reads the durable stores, never mutates. Defensive — a
 * failing reader degrades to an honest empty section rather than throwing.
 */
import { getTask, getTaskBlocks, listTasks, readTaskEvents } from './ivx-task-state-store';
import { listAgentRuns } from './ivx-agent-activity-store';
export const IVX_LIVE_WORK_MARKER = 'ivx-live-work-2026-05-31';
function progressPercent(task) {
    if (task.totalBlocks <= 0)
        return 0;
    return Math.min(100, Math.round((task.completedBlockIds.length / task.totalBlocks) * 100));
}
function pickCurrentBlock(blocks) {
    if (blocks.length === 0)
        return null;
    const running = blocks.find((b) => b.status === 'RUNNING');
    if (running)
        return running;
    const pending = blocks.find((b) => b.status === 'PENDING' || b.status === 'BLOCKED');
    if (pending)
        return pending;
    return blocks[blocks.length - 1];
}
function blockDetail(block) {
    if (!block)
        return 'No active module.';
    if (block.blocker)
        return block.blocker;
    if (block.testResult)
        return block.testResult;
    if (block.deploymentStatus)
        return block.deploymentStatus;
    if (block.commitHash)
        return `commit ${block.commitHash}`;
    if (block.codeChanges)
        return block.codeChanges;
    if (block.filesInvolved.length > 0)
        return block.filesInvolved.join(', ');
    return block.goal || 'Working…';
}
function agentLevel(run) {
    if (run.status === 'running')
        return 'running';
    if (run.status === 'failed')
        return 'error';
    return 'success';
}
/** Build the proof-output rows for the active task (commits / tests / deploy / verify). */
function buildProof(task, blocks) {
    if (!task)
        return [];
    const commits = blocks.map((b) => b.commitHash).filter((c) => Boolean(c));
    const testsPassed = blocks.filter((b) => (b.testResult ?? '').toLowerCase().startsWith('passed')).length;
    const verified = blocks.filter((b) => b.status === 'VERIFIED').length;
    const deployed = blocks.filter((b) => b.status === 'VERIFIED').length;
    return [
        { label: 'Blocks verified', value: `${verified}/${task.totalBlocks}`, ok: verified > 0 },
        { label: 'Tests passed', value: testsPassed > 0 ? `${testsPassed} block(s) green` : 'none yet', ok: testsPassed > 0 },
        { label: 'Commits', value: commits.length > 0 ? commits.join(', ') : 'no commit yet', ok: commits.length > 0 },
        { label: 'Deploy', value: task.deploymentStatus ?? (deployed > 0 ? `${deployed} deployed` : 'not deployed'), ok: deployed > 0 || Boolean(task.deploymentStatus) },
    ];
}
/**
 * Assemble the full live-work snapshot. `logLimit` bounds the merged log feed.
 */
export async function buildLiveWorkSnapshot(logLimit = 60) {
    const generatedAt = new Date().toISOString();
    let tasks = [];
    try {
        tasks = await listTasks(25);
    }
    catch {
        tasks = [];
    }
    let agents = [];
    try {
        agents = await listAgentRuns(60);
    }
    catch {
        agents = [];
    }
    const activeTask = tasks.find((t) => t.status === 'running' || t.status === 'paused') ?? tasks[0] ?? null;
    // Resolve the active task's blocks + events for the current module + logs + proof.
    let activeBlocks = [];
    let activeEvents = [];
    if (activeTask) {
        try {
            const full = await getTask(activeTask.id);
            activeBlocks = await getTaskBlocks(activeTask.id);
            activeEvents = (await readTaskEvents(activeTask.id, 40)).map((e) => ({ at: e.at, type: e.type, detail: e.detail }));
            if (full) {
                // keep the freshest record
                tasks = tasks.map((t) => (t.id === full.id ? full : t));
            }
        }
        catch {
            activeBlocks = [];
            activeEvents = [];
        }
    }
    const currentBlock = pickCurrentBlock(activeBlocks);
    const refreshedActive = activeTask ? tasks.find((t) => t.id === activeTask.id) ?? activeTask : null;
    const currentTask = refreshedActive
        ? {
            id: refreshedActive.id,
            title: refreshedActive.ownerCommand || refreshedActive.originalTask.slice(0, 80) || refreshedActive.id,
            status: refreshedActive.status,
            progressPercent: progressPercent(refreshedActive),
            totalBlocks: refreshedActive.totalBlocks,
            completedBlocks: refreshedActive.completedBlockIds.length,
            failedBlocks: refreshedActive.failedBlockIds.length,
            blockedBlocks: refreshedActive.blockedBlockIds.length,
            currentModule: currentBlock ? `Block ${currentBlock.index + 1}: ${currentBlock.title}` : 'Awaiting first module',
            currentModuleStatus: currentBlock?.status ?? null,
            currentModuleDetail: blockDetail(currentBlock),
            blocker: currentBlock?.blocker ?? refreshedActive.error ?? null,
            updatedAt: refreshedActive.updatedAt,
        }
        : null;
    const activeAgents = agents.filter((a) => a.status === 'running');
    const recentAgents = agents.slice(0, 20);
    // Merge orchestrator events + agent runs into one chronological log feed.
    const logs = [];
    for (const e of activeEvents) {
        logs.push({
            at: e.at,
            channel: 'task',
            level: e.type.toLowerCase().includes('fail') || e.type.toLowerCase().includes('crash') ? 'error' : e.type.toLowerCase().includes('complete') || e.type.toLowerCase().includes('verified') ? 'success' : 'info',
            message: `${e.type}: ${e.detail}`,
        });
    }
    for (const a of agents) {
        logs.push({
            at: a.finishedAt ?? a.startedAt,
            channel: `agent:${a.kind}`,
            level: agentLevel(a),
            message: a.status === 'running'
                ? `${a.label} running — ${a.detail}`
                : a.status === 'completed'
                    ? `${a.label} completed${a.proof ? ` — ${a.proof}` : ''}`
                    : `${a.label} failed${a.error ? ` — ${a.error}` : ''}`,
        });
    }
    logs.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
    const boundedLogs = logs.slice(0, Math.max(1, Math.min(200, Math.floor(logLimit))));
    const proofOutput = buildProof(refreshedActive, activeBlocks);
    const recentCompletedTasks = tasks
        .filter((t) => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled')
        .slice(0, 8)
        .map((t) => ({
        id: t.id,
        title: t.ownerCommand || t.originalTask.slice(0, 80) || t.id,
        status: t.status,
        completedBlocks: t.completedBlockIds.length,
        totalBlocks: t.totalBlocks,
        completedAt: t.completedAt,
    }));
    const counts = {
        activeTasks: tasks.filter((t) => t.status === 'running' || t.status === 'paused').length,
        activeAgents: activeAgents.length,
        completedTasks: tasks.filter((t) => t.status === 'completed').length,
        failedTasks: tasks.filter((t) => t.status === 'failed').length,
    };
    const summary = buildSummary(currentTask, activeAgents, counts);
    return {
        marker: IVX_LIVE_WORK_MARKER,
        generatedAt,
        currentTask,
        activeAgents,
        recentAgents,
        liveLogs: boundedLogs,
        proofOutput,
        recentCompletedTasks,
        counts,
        summary,
    };
}
function buildSummary(currentTask, activeAgents, counts) {
    const parts = [];
    if (currentTask && (currentTask.status === 'running' || currentTask.status === 'paused')) {
        parts.push(`Working on "${currentTask.title}" — ${currentTask.currentModule} (${currentTask.progressPercent}%).`);
    }
    else {
        parts.push('No task is actively running right now.');
    }
    if (activeAgents.length > 0) {
        parts.push(`${activeAgents.length} background agent(s) live: ${activeAgents.map((a) => a.label).join(', ')}.`);
    }
    else {
        parts.push('No background agents are currently scanning.');
    }
    parts.push(`${counts.completedTasks} task(s) completed, ${counts.failedTasks} failed.`);
    return parts.join(' ');
}
