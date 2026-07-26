/**
 * IVX Senior-Developer READ-ONLY Inspection Runtime
 *
 * FINAL SMALL FIX — ROUTE READ-ONLY INSPECTION REQUESTS THROUGH THE REAL WORKER
 * (owner mandate 2026-07-19):
 *
 *   Read-only technical inspection prompts ("inspect the chat ordering issue
 *   and report the current task status; do not change or deploy anything") were
 *   falling through to the narrative chat model because they did not match an
 *   execution-mode category. The narrative model then mentioned files it
 *   "inspected", which tripped the Fake Execution Gate.
 *
 * This runtime runs the SAME persistent worker-job infrastructure as the
 * developer_executor, but in a strictly READ-ONLY mode:
 *
 *   PERMITTED:  inspect repository files, search code, inspect logs, run safe
 *               read-only commands, run tests when they do not modify source,
 *               identify root cause, return structured evidence.
 *
 *   BLOCKED:    editing files, committing, pushing, deploying, applying
 *               migrations, changing production data.
 *
 * It produces an `IVXReadOnlyInspectionProof` the worker writes to the durable
 * ledger, and a strict owner-mandated response format:
 *
 *   TASK ID / STATUS / MODE: READ_ONLY / FILES INSPECTED / COMMANDS RUN /
 *   FINDINGS / ROOT CAUSE / FILES CHANGED: NONE / COMMIT: NOT REQUESTED /
 *   DEPLOYMENT: NOT REQUESTED
 *
 * No network, no AI gateway, no git, no Render. Pure local read + safe test
 * invocations so the proof is honest and fully unit-testable.
 */
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const IVX_READONLY_INSPECTION_MARKER = 'ivx-senior-developer-readonly-2026-07-19';
/** Dirs the read-only inspector is allowed to walk. */
const INSPECTABLE_ROOTS = ['backend', 'expo', 'render.yaml', 'package.json', 'tsconfig.json'];
/** Dirs never inspected (secrets, build artifacts, vcs, logs). */
const INSPECT_IGNORED_DIRS = new Set([
    '.git', '.rork', 'node_modules', '.expo', 'dist', 'build', 'coverage',
    'logs', 'tmp', '__tests__', '__mocks__', 'mocks',
]);
/** File extensions the inspector reads. */
const INSPECTABLE_EXTENSIONS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '.md', '.yaml', '.yml', '.sql',
]);
/** Max files to read per inspection (bounded so a huge repo cannot stall). */
const MAX_INSPECTED_FILES = 24;
/** Max bytes of each file preview. */
const FILE_PREVIEW_CHARS = 160;
/** Max stdout preview per command. */
const COMMAND_OUTPUT_PREVIEW_CHARS = 600;
function nowIso() {
    return new Date().toISOString();
}
function safeErrorMessage(error) {
    return error instanceof Error ? error.message.slice(0, 500) : 'Unknown read-only inspection error.';
}
function truncate(value, max) {
    if (value.length <= max)
        return value;
    return `${value.slice(0, max - 3)}...`;
}
/**
 * Heuristic: pick the most relevant files for the inspection goal. The goal is
 * a natural-language owner prompt; we surface key files that already exist in
 * the repo plus any whose path hints match the goal's significant words.
 */
function pickInspectionTargets(goal, availableFiles) {
    const alwaysInclude = [
        'backend/api/ivx-owner-ai.ts',
        'backend/services/ivx-senior-developer-worker.ts',
        'backend/services/ivx-senior-developer-runtime.ts',
        'backend/services/ivx-ia-reliability-gate.ts',
        'backend/services/ivx-execution-mode-classifier.ts',
        'backend/services/ivx-chat-intent-router.ts',
        'backend/hono.ts',
        'render.yaml',
    ].filter((file) => availableFiles.includes(file));
    // Pull significant words out of the goal (len >= 4, alpha) and match them
    // against file paths so "chat ordering issue" surfaces chat.tsx etc.
    const words = Array.from(new Set(goal.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((word) => word.length >= 4)
        .filter((word) => !['that', 'this', 'with', 'from', 'have', 'please', 'report', 'change', 'deploy', 'anything', 'current', 'status'].includes(word))));
    const hintMatches = availableFiles
        .filter((file) => words.some((word) => file.toLowerCase().includes(word)))
        .slice(0, 12);
    const merged = [...alwaysInclude, ...hintMatches];
    const deduped = Array.from(new Set(merged));
    return deduped.slice(0, MAX_INSPECTED_FILES);
}
async function walkInspectableFiles(projectRoot) {
    const results = [];
    async function visit(relDir) {
        if (results.length >= 400)
            return;
        const absDir = path.join(projectRoot, relDir);
        let entries;
        try {
            entries = await readdir(absDir);
        }
        catch {
            return;
        }
        for (const entry of entries) {
            const relEntry = relDir ? `${relDir}/${entry}` : entry;
            const absEntry = path.join(absDir, entry);
            let info;
            try {
                info = await stat(absEntry);
            }
            catch {
                continue;
            }
            if (info.isDirectory()) {
                if (INSPECT_IGNORED_DIRS.has(entry))
                    continue;
                // Only descend into inspectable roots.
                if (!relDir && !INSPECTABLE_ROOTS.includes(entry) && !INSPECTABLE_ROOTS.includes(`${entry}.yaml`)) {
                    // allow backend / expo; skip other top-level dirs
                    if (entry !== 'backend' && entry !== 'expo')
                        continue;
                }
                await visit(relEntry);
            }
            else if (info.isFile()) {
                const ext = path.extname(entry);
                if (INSPECTABLE_EXTENSIONS.has(ext)) {
                    results.push(relEntry);
                }
            }
        }
    }
    // Walk the two inspectable roots.
    await visit('backend');
    await visit('expo');
    return results;
}
async function readInspectedFile(projectRoot, relPath) {
    const absPath = path.join(projectRoot, relPath);
    const content = await readFile(absPath, 'utf8');
    const preview = truncate(content.replace(/\r/g, '').trimStart(), FILE_PREVIEW_CHARS);
    return {
        path: relPath,
        bytes: Buffer.byteLength(content, 'utf8'),
        preview,
    };
}
/**
 * Run a read-only validation command under the IVX process watchdog so a
 * nested subprocess tree can never hang the inspection. The whole process
 * group is terminated on timeout or cancellation.
 */
async function runReadOnlyTestCommand(projectRoot, kind) {
    const command = kind === 'run_tests'
        ? 'bun test backend/services/ivx-ia-reliability-gate.test.ts'
        : 'bun x tsc --noEmit';
    const startedAt = Date.now();
    try {
        const { runWithWatchdog } = await import('./ivx-process-watchdog.js');
        const result = await runWithWatchdog(command, {
            timeoutMs: 45_000,
            cwd: projectRoot,
        });
        const durationMs = Date.now() - startedAt;
        const preview = truncate((result.stdoutTail + (result.stderrTail ? `\n[stderr]\n${result.stderrTail}` : '')).trim(), COMMAND_OUTPUT_PREVIEW_CHARS);
        if (result.status === 'timed_out' || result.status === 'cancelled' || result.status === 'spawn_error') {
            return {
                command,
                kind,
                ok: false,
                exitCode: null,
                outputPreview: preview,
                error: result.status === 'spawn_error' ? result.error : result.status,
                durationMs,
            };
        }
        const exitCode = result.exitCode ?? 0;
        return {
            command,
            kind,
            ok: exitCode === 0,
            exitCode,
            outputPreview: preview,
            error: exitCode === 0 ? null : `exit ${exitCode}`,
            durationMs,
        };
    }
    catch (error) {
        return {
            command,
            kind,
            ok: false,
            exitCode: null,
            outputPreview: '',
            error: safeErrorMessage(error),
            durationMs: Date.now() - startedAt,
        };
    }
}
/**
 * Identify a root cause from the inspected files + goal. This is a deterministic
 * heuristic, NOT an AI narrative: it reads the actual file previews and looks
 * for the goal's significant words, then reports what it found. Honest: when
 * nothing concrete is found, it says so and recommends a deeper manual look.
 */
function identifyRootCause(goal, files) {
    const goalWords = Array.from(new Set(goal.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((word) => word.length >= 4)));
    const matches = [];
    for (const file of files) {
        const lowerPreview = file.preview.toLowerCase();
        const hits = goalWords.filter((word) => lowerPreview.includes(word));
        if (hits.length >= 2) {
            matches.push(`${file.path} references: ${hits.slice(0, 6).join(', ')}`);
        }
    }
    if (matches.length === 0) {
        return {
            findings: `Inspected ${files.length} file(s) for the requested issue. No file preview contained enough of the goal's significant terms to pinpoint a localized defect.`,
            rootCause: 'Not determinable from read-only inspection alone — the goal may reference runtime behavior, a specific user-visible symptom, or files outside the inspected set. A deeper manual review (or an execution-mode task with patch approval) is required to confirm.',
            nextAction: 'Reply with an execution-mode command (e.g. "fix the chat ordering issue and deploy live") to run the full developer_executor pipeline: patch → test → commit → deploy → verify. No read-only inspection can mutate code.',
        };
    }
    const findings = `Inspected ${files.length} file(s). Goal-term matches:\n${matches.map((m) => ` - ${m}`).join('\n')}`;
    const rootCause = `Read-only inspection surfaced ${matches.length} file(s) whose content references the goal's significant terms. A localized defect is plausible in the matched files; confirming the exact line requires an execution-mode task (with patch approval) or a manual review of the matched paths.`;
    const nextAction = 'If you want this fixed end-to-end, reply with an execution-mode command (e.g. "fix the chat ordering issue and deploy live"). The read-only inspection did NOT change, commit, or deploy anything.';
    return { findings, rootCause, nextAction };
}
/**
 * Run a read-only inspection through the persistent worker pipeline. Returns
 * a structured proof the worker writes to the durable ledger. NEVER edits,
 * commits, pushes, deploys, or applies migrations.
 */
export async function runIVXReadOnlyInspection(input) {
    const goal = input.goal.trim();
    if (!goal)
        throw new Error('A read-only inspection goal is required.');
    const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const jobId = `ivx-readonly-${createHash('sha1').update(`${goal}:${Date.now()}`).digest('hex').slice(0, 12)}`;
    const onPhase = input.onPhase;
    const commandsRun = [];
    onPhase?.('queued', 'Read-only inspection queued.');
    const availableFiles = await walkInspectableFiles(projectRoot);
    onPhase?.('repo_indexed', `Indexed ${availableFiles.length} inspectable source files.`);
    const targets = pickInspectionTargets(goal, availableFiles);
    const filesInspected = [];
    for (const target of targets) {
        try {
            const inspected = await readInspectedFile(projectRoot, target);
            filesInspected.push(inspected);
            commandsRun.push({
                command: `read ${target}`,
                kind: 'read_file',
                ok: true,
                exitCode: null,
                outputPreview: truncate(inspected.preview, 120),
                error: null,
                durationMs: 0,
            });
        }
        catch (error) {
            commandsRun.push({
                command: `read ${target}`,
                kind: 'read_file',
                ok: false,
                exitCode: null,
                outputPreview: '',
                error: safeErrorMessage(error),
                durationMs: 0,
            });
        }
    }
    onPhase?.('files_inspected', `Read ${filesInspected.length} file(s).`);
    // Run read-only validation commands: a targeted test file + typecheck. Both
    // are read-only (tests do not modify source; typecheck only reads). Failures
    // are recorded honestly — they do not block the inspection.
    const testCommand = await runReadOnlyTestCommand(projectRoot, 'run_tests');
    commandsRun.push(testCommand);
    const typecheckCommand = await runReadOnlyTestCommand(projectRoot, 'typecheck');
    commandsRun.push(typecheckCommand);
    onPhase?.('commands_run', `Ran ${commandsRun.length} read-only command(s).`);
    const { findings, rootCause, nextAction } = identifyRootCause(goal, filesInspected);
    onPhase?.('root_cause_identified', 'Root cause heuristic completed.');
    const proof = {
        marker: IVX_READONLY_INSPECTION_MARKER,
        jobId,
        goal,
        mode: 'read_only',
        finalStatus: 'COMPLETED',
        patchApplied: false,
        commitCreated: false,
        deployed: false,
        changedFiles: [],
        filesInspected,
        commandsRun,
        findings,
        rootCause,
        nextAction,
        error: null,
        generatedAt: nowIso(),
        secretValuesReturned: false,
    };
    onPhase?.('completed', 'Read-only inspection completed. No files changed, no commit, no deploy.');
    return proof;
}
/**
 * Render the owner-mandated strict read-only inspection format. Pure +
 * deterministic — no I/O, no AI — so it is fully unit-testable.
 *
 *   TASK ID
 *   STATUS
 *   MODE: READ_ONLY
 *   FILES INSPECTED
 *   COMMANDS RUN
 *   FINDINGS
 *   ROOT CAUSE
 *   FILES CHANGED: NONE
 *   COMMIT: NOT REQUESTED
 *   DEPLOYMENT: NOT REQUESTED
 */
export function buildReadOnlyInspectionAnswer(proof) {
    const filesList = proof.filesInspected.length > 0
        ? proof.filesInspected.map((f) => `${f.path} (${f.bytes} bytes)`).join('\n')
        : 'NONE — no files could be read during this inspection.';
    const commandsList = proof.commandsRun.length > 0
        ? proof.commandsRun
            .map((cmd) => {
            const status = cmd.ok ? 'OK' : (cmd.error ?? `exit ${cmd.exitCode ?? '?'}`);
            const preview = cmd.outputPreview ? `\n  ${cmd.outputPreview.split('\n').slice(0, 4).join('\n  ')}` : '';
            return `$ ${cmd.command} → ${status}${preview}`;
        })
            .join('\n')
        : 'NONE — no commands were executed.';
    return [
        `TASK ID:\n${proof.jobId}`,
        `STATUS:\n${proof.finalStatus}`,
        'MODE:\nREAD_ONLY',
        `FILES INSPECTED:\n${filesList}`,
        `COMMANDS RUN:\n${commandsList}`,
        `FINDINGS:\n${proof.findings}`,
        `ROOT CAUSE:\n${proof.rootCause}`,
        'FILES CHANGED:\nNONE — read-only inspection mode never edits files.',
        'COMMIT:\nNOT REQUESTED — read-only inspection mode never commits.',
        'DEPLOYMENT:\nNOT REQUESTED — read-only inspection mode never deploys.',
        `NEXT ACTION:\n${proof.nextAction}`,
    ].join('\n\n');
}
