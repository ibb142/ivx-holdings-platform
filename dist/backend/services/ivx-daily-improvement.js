/**
 * IVX Daily Self-Improvement — the single entry point for "Improve IVX today".
 *
 * Turns the owner's daily-improvement command into a durable, crash-safe task that
 * runs the full autonomous engineering loop ONCE:
 *
 *   find one real safe issue → patch → run tests → commit → deploy → verify → prove
 *
 * It deliberately constrains the work to the NON-DESTRUCTIVE / safe-auto-approval
 * categories (UI, copy, tests, logging, error messages, layout/scroll) so the loop
 * can execute end-to-end without an owner prompt. Anything destructive (delete data,
 * production schema, secrets, billing, security, external access) is still gated by
 * the orchestrator's `classifyOwnerExecutionCommand` approval guard.
 *
 * Progress is fully visible in the Live Developer Monitor because the work runs as a
 * standard orchestrator task (`/api/ivx/tasks/:id/blocks` + `/events`).
 *
 * Runtime-light: this module only synthesizes the command + delegates to the
 * orchestrator, so it stays unit-testable without the AI gateway / network / git.
 */
import { startTask } from './ivx-task-orchestrator';
export const IVX_DAILY_IMPROVEMENT_MARKER = 'ivx-daily-improvement-2026-05-30';
/** The safe categories the daily loop is allowed to auto-fix without approval. */
export const IVX_DAILY_IMPROVEMENT_SAFE_SCOPE = [
    'UI fixes',
    'copy / wording fixes',
    'test fixes',
    'logging fixes',
    'error-message fixes',
    'layout / scroll fixes',
];
/**
 * Build the exact owner command that drives the autonomous loop. Kept as a single
 * block so the orchestrator runs ONE verified end-to-end pass (not a multi-step plan).
 */
export function buildDailyImprovementCommand() {
    return [
        'IVX daily self-improvement. Act as the senior developer for IVX Holdings and run ONE complete, verified improvement pass autonomously:',
        '1. Inspect the IVX codebase and find ONE real, safe, non-destructive improvement or bug fix',
        `   limited to these safe categories: ${IVX_DAILY_IMPROVEMENT_SAFE_SCOPE.join(', ')}.`,
        '2. Patch the code for that single issue.',
        '3. Run the validation checks.',
        '4. Commit the change to GitHub.',
        '5. Deploy via the main push / Render auto-deploy pipeline.',
        '6. Verify production health after deploy.',
        '7. Report the proof: file changed, test result, commit hash, deployment status, production verification.',
        'Stay strictly inside the safe categories above. If the only available work would be risky or irreversible, stop and ask the owner first instead of proceeding.',
    ].join('\n');
}
/**
 * Start one autonomous daily-improvement task. Returns the durable task + its blocks
 * so the caller can surface the task id (for the Live Developer Monitor) immediately
 * while the loop runs in the background.
 */
export async function startDailyImprovementTask(options = {}) {
    const command = buildDailyImprovementCommand();
    const { task, blocks } = await startTask(command, { autoStart: options.autoStart !== false });
    console.log('[IVXDailyImprovement] STARTED', { marker: IVX_DAILY_IMPROVEMENT_MARKER, taskId: task.id, totalBlocks: task.totalBlocks });
    return {
        marker: IVX_DAILY_IMPROVEMENT_MARKER,
        task,
        blocks,
        command,
        safeScope: IVX_DAILY_IMPROVEMENT_SAFE_SCOPE,
    };
}
