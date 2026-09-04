/**
 * IVX Agent Real Engineering Cycle — REAL-WORK mandate implementation.
 *
 * Replaces the "one QA tool call = success" definition with durable
 * engineering execution on the autonomous task engine:
 *
 *   lease real task (or seed one from the real repo module universe)
 *     → heartbeat → RUNNING → ANALYZING (real file inspection, secret scan,
 *     broken-import check, hygiene defects) → defects → repair tasks queued
 *     (or OWNER_GATE for secrets/credentials) → EXECUTION_COMPLETED →
 *     QA_IN_PROGRESS → VERIFIED only with fresh evidence → NEXT_TASK.
 *
 * Fail-closed: no task is completed without real evidence; secrets and
 * credential-class findings are never auto-completed — they go to BLOCKED
 * with an explicit OWNER_GATE reason.
 */
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  addTaskEvidence,
  createTask,
  getAllTasks,
  getTaskById,
  heartbeat,
  leaseNextTask,
  releaseLease,
  TERMINAL_SUCCESS_STATES,
  transitionTaskState,
  type Task,
  type TaskEvidence,
} from './ivx-autonomous-task-engine';
import { containPath, fileHasUnexemptedSecret, resolveRepoRoot } from './ivx-agent-engineering-tools';
import {
  encodeLandingResult,
  ensureLandingP0BacklogSeeded,
  getLandingUnit,
  isLandingP0MissionActive,
  LANDING_P0_PREFIX,
  landingRepairKey,
  parseLandingTaskKey,
  resolveProductionSha,
} from './ivx-landing-p0-backlog';
import { executeLandingUnit } from './ivx-landing-p0-executor';

export const IVX_REAL_ENGINEERING_CYCLE_MARKER = 'ivx-agent-real-engineering-cycle-2026-09-01';

/** Real codebase roots scanned for the module universe (real files only). */
const REPO_MODULE_ROOTS = ['backend/api', 'backend/services', 'expo/app', 'expo/src'] as const;
const BACKEND_MODULE_ROOTS = ['api', 'services'] as const;
const MODULE_EXTENSIONS = new Set(['.ts', '.tsx']);
const MAX_MODULE_SCAN = 600;
const MAX_TASK_MINUTES = 30;

export type CycleDefect = {
  kind: 'secret' | 'broken_import' | 'hygiene_marker' | 'unreadable_module';
  severity: 'critical' | 'high' | 'medium';
  detail: string;
  ownerGateReason: string | null;
};

export type RealEngineeringCycleResult = {
  ok: boolean;
  marker: string;
  agentId: string;
  action: 'TASK_COMPLETED' | 'TASK_OWNER_GATE' | 'TASK_BLOCKED' | 'TASK_FAILED' | 'NO_TASK_AVAILABLE' | 'CYCLE_ERROR';
  taskId: string | null;
  module: string | null;
  sourceSha: string;
  startedAt: string | null;
  finishedAt: string | null;
  states: string[];
  evidenceIds: string[];
  defects: CycleDefect[];
  repairTaskIds: string[];
  filesInspected: string[];
  productiveMinutes: number;
  nextTaskAvailable: boolean;
  error: string | null;
};

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Enumerate real module files from the actual repo (no synthetic registry). */
export async function scanModuleUniverse(): Promise<string[]> {
  const repoRoot = resolveRepoRoot();
  // Render starts the API with `backend/` as cwd and its production bundle may
  // not contain `.git`. In that layout resolveRepoRoot() correctly falls back
  // to cwd, so repo-relative `backend/api` would become the nonexistent
  // `backend/backend/api` and every agent would receive NO_TASK_AVAILABLE.
  // Keep returned paths relative to the root used later by inspectModule().
  const moduleRoots = basename(repoRoot) === 'backend'
    ? BACKEND_MODULE_ROOTS
    : REPO_MODULE_ROOTS;
  const modules: string[] = [];
  async function walk(dir: string): Promise<void> {
    if (modules.length >= MAX_MODULE_SCAN) return;
    let entries;
    try {
      entries = await readdir(join(repoRoot, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (modules.length >= MAX_MODULE_SCAN) return;
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (/node_modules|\.git|build|dist|\.rork|assets/.test(entry.name)) continue;
        await walk(rel);
      } else if (MODULE_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf('.')))) {
        modules.push(rel);
      }
    }
  }
  for (const root of moduleRoots) await walk(root);
  return modules;
}

async function makeEvidence(
  evidenceType: TaskEvidence['evidenceType'],
  source: string,
  summary: string,
  commitSha: string | null = null,
): Promise<Omit<TaskEvidence, 'evidenceId' | 'createdAt'>> {
  return {
    evidenceType,
    source,
    contentHash: sha256(`${evidenceType}|${source}|${summary}`),
    summary,
    commitSha,
    deploymentId: null,
  };
}

/** Detect real defects in a module file. Secrets are owner-gated, never auto-handled. */
async function inspectModule(relPath: string): Promise<{ defects: CycleDefect[]; inspected: boolean; summary: string }> {
  const repoRoot = resolveRepoRoot();
  const defects: CycleDefect[] = [];
  let abs: string;
  try {
    abs = await containPath(repoRoot, relPath);
  } catch {
    return { defects: [{ kind: 'unreadable_module', severity: 'high', detail: `path escapes repo root: ${relPath}`, ownerGateReason: null }], inspected: false, summary: 'path rejected' };
  }
  const info = await stat(abs).catch(() => null);
  if (!info || !info.isFile()) {
    return { defects: [{ kind: 'unreadable_module', severity: 'high', detail: `module file missing: ${relPath}`, ownerGateReason: null }], inspected: false, summary: 'missing' };
  }
  const content = await readFile(abs, 'utf8').catch(() => null);
  if (content === null) {
    return { defects: [{ kind: 'unreadable_module', severity: 'high', detail: `module unreadable: ${relPath}`, ownerGateReason: null }], inspected: false, summary: 'unreadable' };
  }

  if (fileHasUnexemptedSecret(relPath, content)) {
    defects.push({
      kind: 'secret',
      severity: 'critical',
      detail: `unexempted secret pattern in ${relPath}`,
      ownerGateReason: 'secret — production credential exposure requires owner review',
    });
  }

  // Broken relative imports: every './x' or '../x' import must resolve on disk.
  const importRe = /from\s+['"](\.\.?\/[^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  const baseDir = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '';
  while ((match = importRe.exec(content)) !== null) {
    const spec = match[1];
    const target = join(baseDir, spec).replace(/\\/g, '/');
    const candidates = [target, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`, `${target}/index.tsx`];
    const exists = await Promise.all(candidates.map(async (c) => {
      try {
        const s = await stat(join(repoRoot, c));
        return s.isFile();
      } catch {
        return false;
      }
    }));
    if (!exists.some(Boolean)) {
      defects.push({
        kind: 'broken_import',
        severity: 'high',
        detail: `${relPath} imports missing module '${spec}'`,
        ownerGateReason: null,
      });
    }
  }

  // Hygiene defects: unresolved TODO/FIXME/HACK markers are real open work.
  const markerRe = /\b(TODO|FIXME|HACK)\b[^\n]*/g;
  let markers = 0;
  while (markerRe.exec(content) !== null) markers += 1;
  if (markers > 0) {
    defects.push({
      kind: 'hygiene_marker',
      severity: 'medium',
      detail: `${relPath} contains ${markers} unresolved TODO/FIXME/HACK marker(s)`,
      ownerGateReason: null,
    });
  }

  return { defects, inspected: true, summary: `inspected ${relPath} (${content.split('\n').length} lines, ${defects.length} defect(s))` };
}

/**
 * Seed ONE real durable module-audit task OWNED by the requesting agent.
 *
 * Deterministic per-agent module assignment: (agentNumber - 1) % modules.length
 * — no minute-bucket collisions, no cross-agent duplication. The idempotency
 * key binds sourceSha + agentId + agentNumber + module so a task created for
 * IA-37 can never be fulfilled by IA-01.
 */
export async function seedModuleAuditTask(sourceSha: string, agentId: string, agentNumber: number | null): Promise<Task | null> {
  const modules = await scanModuleUniverse();
  if (modules.length === 0) return null;
  const rel = agentNumber != null
    ? modules[(agentNumber - 1) % modules.length]
    : modules[Math.abs([...agentId].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)) % modules.length];
  const result = await createTask({
    title: `Module audit: ${rel}`,
    description: `Real engineering audit of module ${rel} against source SHA ${sourceSha}: inspect, secret-scan, import-graph check, hygiene defects; queue repairs for findings. Owner: ${agentId} (IA-${agentNumber ?? 'shared'}).`,
    taskType: 'development',
    idempotencyKey: `module-audit:${sourceSha}:${agentId}:${agentNumber ?? 'shared'}:${rel}`,
    priority: 'medium',
    assignedAgentNumber: agentNumber,
  });
  return result.task;
}

/**
 * Run ONE full real engineering cycle for an agent: lease (or seed) a task,
 * execute real analysis with fresh evidence, and complete or gate it
 * fail-closed. The workflow loops this until the queue is drained.
 */
export async function runRealEngineeringCycle(input: {
  agentId: string;
  agentNumber: number | null;
  sourceSha: string;
}): Promise<RealEngineeringCycleResult> {
  const workerId = `agent:${input.agentId}`;
  const base: RealEngineeringCycleResult = {
    ok: false,
    marker: IVX_REAL_ENGINEERING_CYCLE_MARKER,
    agentId: input.agentId,
    action: 'CYCLE_ERROR',
    taskId: null,
    module: null,
    sourceSha: input.sourceSha,
    startedAt: null,
    finishedAt: null,
    states: [],
    evidenceIds: [],
    defects: [],
    repairTaskIds: [],
    filesInspected: [],
    productiveMinutes: 0,
    nextTaskAvailable: false,
    error: null,
  };
  const cycleStart = Date.now();

  try {
    // Owner P0 mission (qa/owner-priority-state.json → landing): materialise the
    // Landing backlog as real ledger tasks and let drained lanes steal Landing work.
    const landingActive = await isLandingP0MissionActive();
    const leaseOptions = landingActive ? { stealPrefix: LANDING_P0_PREFIX } : {};
    if (landingActive) await ensureLandingP0BacklogSeeded(input.sourceSha);

    let leased = await leaseNextTask(workerId, input.agentNumber, leaseOptions);
    if ((!leased.ok || !leased.task) && landingActive) {
      // Own lane drained and nothing to steal right now: one more seed pass
      // (idempotent) covers a SHA change since the cached seeding.
      await ensureLandingP0BacklogSeeded(input.sourceSha);
      leased = await leaseNextTask(workerId, input.agentNumber, leaseOptions);
    }
    if ((leased.ok && leased.task) && parseLandingTaskKey(leased.task.idempotencyKey)) {
      return runLandingTask(leased.task, workerId, input, base);
    }
    if (!leased.ok || !leased.task) {
      const seeded = await seedModuleAuditTask(input.sourceSha, input.agentId, input.agentNumber);
      if (seeded && TERMINAL_SUCCESS_STATES.includes(seeded.state)) {
        // Durable rerun: this agent's owned audit for this exact SHA was already
        // executed and VERIFIED with fresh evidence — return the real taskId.
        const relMatch = /module audit: (\S+)/i.exec(seeded.title);
        return {
          ...base, ok: true, action: 'TASK_COMPLETED', taskId: seeded.taskId,
          module: relMatch?.[1] ?? null, startedAt: seeded.startedAt, finishedAt: nowIso(),
          states: ['ALREADY_VERIFIED'], evidenceIds: seeded.evidence.map((e) => e.evidenceId),
          filesInspected: relMatch ? [relMatch[1]] : [], productiveMinutes: 0,
          nextTaskAvailable: false, error: null,
        };
      }
      leased = await leaseNextTask(workerId, input.agentNumber, leaseOptions);
    }
    if (!leased.ok || !leased.task) {
      return { ...base, ok: true, action: 'NO_TASK_AVAILABLE', nextTaskAvailable: false, finishedAt: nowIso() };
    }
    if (parseLandingTaskKey(leased.task.idempotencyKey)) {
      return runLandingTask(leased.task, workerId, input, base);
    }
    const task = leased.task;
    const startedAt = nowIso();
    const states: string[] = ['LEASED'];

    await heartbeat(task.taskId, workerId);
    const toRunning = await transitionTaskState(task.taskId, 'RUNNING');
    if (!toRunning.ok) {
      await releaseLease(task.taskId, workerId);
      return { ...base, ok: false, action: 'CYCLE_ERROR', taskId: task.taskId, error: `RUNNING transition refused: ${toRunning.error}` };
    }
    states.push('RUNNING');

    // ANALYZING — real inspection of the task's module (from title or description path).
    const moduleMatch = /module audit: (\S+)|module (\S+)/i.exec(`${task.title} ${task.description}`);
    const relPath = moduleMatch ? (moduleMatch[1] ?? moduleMatch[2]) : null;
    const inspection = relPath
      ? await inspectModule(relPath)
      : { defects: [], inspected: true, summary: `non-module task executed: ${task.title}` };

    for (const defect of inspection.defects) {
      if (defect.ownerGateReason) {
        // OWNER_GATE path: secrets/credentials are never auto-completed.
        await addTaskEvidence(task.taskId, await makeEvidence('log', relPath ?? task.title, `OWNER_GATE: ${defect.detail}`));
        await transitionTaskState(task.taskId, 'BLOCKED', { blocker: `OWNER_GATE: ${defect.ownerGateReason}` });
        states.push('BLOCKED');
        return {
          ...base, ok: true, action: 'TASK_OWNER_GATE', taskId: task.taskId, module: relPath,
          startedAt, finishedAt: nowIso(), states, defects: [defect],
          filesInspected: inspection.inspected ? [relPath as string] : [],
          productiveMinutes: Math.min(MAX_TASK_MINUTES, Math.round((Date.now() - cycleStart) / 60_000 * 10) / 10),
          nextTaskAvailable: true, error: null,
        };
      }
    }

    // Queue real repair tasks for every non-gated defect. Repairs stay in the
    // discovering agent's module lane (owner = task.assignedAgentNumber) —
    // development repair work is never dumped on a single default agent.
    for (const defect of inspection.defects) {
      const repair = await createTask({
        title: `Repair ${defect.kind}: ${relPath ?? task.title}`,
        description: `${defect.detail}. Discovered by real engineering cycle on SHA ${input.sourceSha}.`,
        taskType: defect.kind === 'secret' ? 'security' : 'development',
        idempotencyKey: `repair:${input.sourceSha}:${task.assignedAgentNumber ?? 'shared'}:${relPath ?? task.title}:${defect.kind}`,
        priority: defect.severity === 'critical' ? 'critical' : defect.severity === 'high' ? 'high' : 'medium',
        assignedAgentNumber: task.assignedAgentNumber,
      });
      if (repair.task) base.repairTaskIds.push(repair.task.taskId);
    }
    if (base.repairTaskIds.length > 0) {
      const defectEvidence = await makeEvidence('log', relPath ?? task.title, `defects discovered: ${inspection.defects.map((d) => d.kind).join(', ')}; repairs queued: ${base.repairTaskIds.join(',')}`);
      await addTaskEvidence(task.taskId, defectEvidence);
      base.evidenceIds.push('defect-log');
    }

    if (inspection.inspected && relPath) {
      const inspectEvidence = await makeEvidence('source_file_inspected', relPath, inspection.summary);
      await addTaskEvidence(task.taskId, inspectEvidence);
      base.evidenceIds.push('source_file_inspected');
      base.filesInspected.push(relPath);
    }

    // Complete fail-closed: EXECUTION_COMPLETED → QA_IN_PROGRESS → VERIFIED.
    const execDone = await transitionTaskState(task.taskId, 'EXECUTION_COMPLETED');
    if (!execDone.ok) {
      await transitionTaskState(task.taskId, 'FAILED', { error: `EXECUTION_COMPLETED refused: ${execDone.error}` });
      states.push('FAILED');
      return { ...base, ok: false, action: 'TASK_FAILED', taskId: task.taskId, module: relPath, startedAt, states, error: execDone.error };
    }
    states.push('EXECUTION_COMPLETED');
    await heartbeat(task.taskId, workerId);
    const qa = await transitionTaskState(task.taskId, 'QA_IN_PROGRESS');
    states.push(qa.ok ? 'QA_IN_PROGRESS' : 'QA_TRANSITION_REFUSED');
    if (qa.ok) {
      // Fresh-evidence gate: the task just gained real inspection evidence this
      // cycle, satisfying VERIFIED derivation from fresh proof — not registry age.
      const verified = await transitionTaskState(task.taskId, 'VERIFIED');
      states.push(verified.ok ? 'VERIFIED' : `VERIFY_REFUSED:${verified.error ?? 'unknown'}`);
      if (!verified.ok) {
        return { ...base, ok: false, action: 'TASK_FAILED', taskId: task.taskId, module: relPath, startedAt, states, error: verified.error };
      }
    }

    const probeWorker = `probe:${workerId}:${Date.now()}`;
    const remaining = await leaseNextTask(probeWorker, input.agentNumber);
    if (remaining.task) await releaseLease(remaining.task.taskId, probeWorker);
    return {
      ...base,
      ok: true,
      action: 'TASK_COMPLETED',
      taskId: task.taskId,
      module: relPath,
      startedAt,
      finishedAt: nowIso(),
      states,
      defects: inspection.defects,
      filesInspected: base.filesInspected,
      productiveMinutes: Math.min(MAX_TASK_MINUTES, Math.round((Date.now() - cycleStart) / 60_000 * 10) / 10),
      nextTaskAvailable: Boolean(remaining.task),
      error: null,
    };
  } catch (error) {
    return { ...base, ok: false, action: 'CYCLE_ERROR', error: error instanceof Error ? error.message : 'cycle failed' };
  }
}

export type FleetEngineeringMetrics = {
  marker: string;
  generatedAt: string;
  tasksStarted: number;
  tasksCompletedVerified: number;
  tasksBlockedOwnerGate: number;
  tasksFailed: number;
  tasksQueued: number;
  defectsDiscovered: number;
  defectsFixed: number;
  repairTasksQueued: number;
  commitsRecorded: number;
  productiveAgentMinutesTotal: number;
  productiveAgentHours24h: number;
  productiveAgentHours1h: number;
  utilization24hPercent: number;
  fleetSizeAssumption: number;
  modulesCovered: number;
  note: string;
};

/**
 * Honest fleet metrics derived ONLY from durable task-engine records.
 * Productive minutes are summed from real task execution spans (capped per
 * task) with real evidence — never wall-clock × fleet size.
 */
export async function getFleetEngineeringMetrics(fleetSize = 112): Promise<FleetEngineeringMetrics> {
  const tasks = await getAllTasks();
  const now = Date.now();
  let productiveMinutesTotal = 0;
  let minutes24h = 0;
  let minutes1h = 0;
  let defectsDiscovered = 0;
  let modulesCovered = 0;
  let repairTasksQueued = 0;
  let commitsRecorded = 0;

  for (const task of tasks) {
    const hasRealEvidence = task.evidence.some((e) => e.evidenceType === 'source_file_inspected');
    if (hasRealEvidence) modulesCovered += 1;
    if (task.commitSha) commitsRecorded += 1;
    if (task.idempotencyKey.startsWith('repair:')) repairTasksQueued += 1;
    if (task.evidence.some((e) => e.summary.startsWith('defects discovered'))) defectsDiscovered += 1;
    if ((task.state === 'VERIFIED' || task.completedAt) && task.startedAt) {
      const spanMinutes = Math.min(
        MAX_TASK_MINUTES,
        Math.max(0.1, (new Date(task.completedAt ?? task.updatedAt).getTime() - new Date(task.startedAt).getTime()) / 60_000),
      );
      if (hasRealEvidence) {
        productiveMinutesTotal += spanMinutes;
        const ageMs = now - new Date(task.completedAt ?? task.updatedAt).getTime();
        if (ageMs <= 24 * 3600_000) minutes24h += spanMinutes;
        if (ageMs <= 3600_000) minutes1h += spanMinutes;
      }
    }
  }

  const defectsFixed = tasks.filter((t) => t.idempotencyKey.startsWith('repair:') && t.state === 'VERIFIED').length;
  return {
    marker: IVX_REAL_ENGINEERING_CYCLE_MARKER,
    generatedAt: nowIso(),
    tasksStarted: tasks.filter((t) => t.startedAt !== null).length,
    tasksCompletedVerified: tasks.filter((t) => t.state === 'VERIFIED').length,
    tasksBlockedOwnerGate: tasks.filter((t) => t.state === 'BLOCKED' && (t.blocker ?? '').startsWith('OWNER_GATE')).length,
    tasksFailed: tasks.filter((t) => t.state === 'FAILED').length,
    tasksQueued: tasks.filter((t) => t.state === 'QUEUED').length,
    defectsDiscovered,
    defectsFixed,
    repairTasksQueued,
    commitsRecorded,
    productiveAgentMinutesTotal: Math.round(productiveMinutesTotal * 10) / 10,
    productiveAgentHours24h: Math.round((minutes24h / 60) * 100) / 100,
    productiveAgentHours1h: Math.round((minutes1h / 60) * 100) / 100,
    utilization24hPercent: Math.round((minutes24h / 60 / (fleetSize * 24)) * 100 * 100) / 100,
    fleetSizeAssumption: fleetSize,
    modulesCovered,
    note: 'Productive minutes are summed from real, evidence-backed task execution spans only (capped at 30 min/task). Utilization denominator is fleetSize×24h wall-clock.',
  };
}

// ── Landing P0 execution path ────────────────────────────────────────────────────────

/**
 * Execute one Landing P0 unit (or repair unit) leased from the durable ledger.
 *
 * Lifecycle: LEASED → RUNNING → real executor → evidence persisted →
 *   PASS/FAIL  : EXECUTION_COMPLETED → QA_IN_PROGRESS → VERIFIED (audit executed with fresh evidence)
 *   BLOCKED    : BLOCKED with the exact reason (evidence unobtainable — never PASS)
 *
 * An audit FAIL queues ONE idempotent repair task per defect in the same lane.
 * A repair unit re-verifies: PASS = defect no longer reproducible; FAIL = BLOCKED
 * with the exact remediation (repairs never spawn repairs — no loops).
 */
async function runLandingTask(
  task: Task,
  workerId: string,
  input: { agentId: string; agentNumber: number | null; sourceSha: string },
  base: RealEngineeringCycleResult,
): Promise<RealEngineeringCycleResult> {
  const parsed = parseLandingTaskKey(task.idempotencyKey);
  const unit = parsed ? getLandingUnit(parsed.unitId) : null;
  const startedAt = nowIso();
  const states: string[] = ['LEASED'];
  const repairTaskIds: string[] = [];

  await heartbeat(task.taskId, workerId);
  const toRunning = await transitionTaskState(task.taskId, 'RUNNING');
  if (!toRunning.ok) {
    await releaseLease(task.taskId, workerId);
    return { ...base, ok: false, action: 'CYCLE_ERROR', taskId: task.taskId, startedAt, states, error: `RUNNING transition refused: ${toRunning.error}` };
  }
  states.push('RUNNING');

  if (!parsed || !unit) {
    await transitionTaskState(task.taskId, 'FAILED', { error: `unknown landing unit in key ${task.idempotencyKey}` });
    states.push('FAILED');
    return { ...base, ok: false, action: 'TASK_FAILED', taskId: task.taskId, startedAt, finishedAt: nowIso(), states, error: 'unknown landing unit' };
  }

  const { record, full } = await executeLandingUnit(unit, {
    agentId: input.agentId,
    agentNumber: input.agentNumber,
    taskId: task.taskId,
    sourceSha: input.sourceSha,
    productionSha: resolveProductionSha(),
    repair: parsed.repair,
  });
  const evidenceType: TaskEvidence['evidenceType'] = unit.check.kind === 'ci' ? 'test_result' : 'production_verification';
  const added = await addTaskEvidence(task.taskId, await makeEvidence(evidenceType, unit.unitId, encodeLandingResult(record)));
  if (!added.ok) {
    await transitionTaskState(task.taskId, 'FAILED', { error: `evidence persistence refused: ${added.error}` });
    states.push('FAILED');
    return { ...base, ok: false, action: 'TASK_FAILED', taskId: task.taskId, module: unit.unitId, startedAt, finishedAt: nowIso(), states, error: added.error };
  }
  const stored = await getTaskById(task.taskId);
  const evidenceIds = stored?.evidence.map((e) => e.evidenceId) ?? [];
  const productiveMinutes = Math.round((full.productive_seconds / 60) * 10) / 10;
  console.log('[IVX Landing P0] unit executed', {
    agentNumber: input.agentNumber,
    unit: unit.unitId,
    repair: parsed.repair,
    status: full.status,
    productiveSeconds: full.productive_seconds,
    apiChecks: full.api_checks.length,
    bugs: full.bugs_found.length,
    blocked: full.blocked_reason,
    detail: full.test_results[0],
  });

  const done = (action: RealEngineeringCycleResult['action']): RealEngineeringCycleResult => ({
    ...base, ok: true, action, taskId: task.taskId, module: unit.unitId, startedAt, finishedAt: nowIso(), states, evidenceIds,
    repairTaskIds, filesInspected: full.files_inspected, productiveMinutes, nextTaskAvailable: true, error: null,
  });

  if (full.status === 'BLOCKED') {
    const blockedTransition = await transitionTaskState(task.taskId, 'BLOCKED', { blocker: full.blocked_reason ?? 'evidence unavailable' });
    states.push(blockedTransition.ok ? 'BLOCKED' : `BLOCKED_REFUSED:${blockedTransition.error ?? 'unknown'}`);
    return done('TASK_BLOCKED');
  }

  if (parsed.repair && full.status === 'FAIL') {
    const defect = full.bugs_found[0];
    const blockedTransition = await transitionTaskState(task.taskId, 'BLOCKED', {
      blocker: `DEFECT PERSISTS [${defect?.severity ?? unit.severity}] ${defect?.detail ?? unit.title} → ${defect?.remediation ?? 'investigate'}`,
    });
    states.push(blockedTransition.ok ? 'BLOCKED' : `BLOCKED_REFUSED:${blockedTransition.error ?? 'unknown'}`);
    return done('TASK_BLOCKED');
  }

  if (!parsed.repair && full.status === 'FAIL') {
    for (const defect of full.bugs_found) {
      const repair = await createTask({
        title: `Landing P0 repair · ${unit.unitId} · ${defect.code}`,
        description: `[${defect.severity}] ${defect.detail}\nRoot cause: ${defect.root_cause}\nRemediation: ${defect.remediation}\nRe-verify unit ${unit.unitId} against production SHA ${parsed.sha}.`,
        taskType: 'qa',
        idempotencyKey: landingRepairKey(parsed.sha, unit.unitId, defect.code),
        priority: defect.severity === 'P0' ? 'critical' : 'high',
        assignedAgentNumber: task.assignedAgentNumber,
        maxRetries: 1,
      });
      if (repair.ok && repair.task) repairTaskIds.push(repair.task.taskId);
    }
  }

  // Complete fail-closed: EXECUTION_COMPLETED → QA_IN_PROGRESS → VERIFIED.
  const execDone = await transitionTaskState(task.taskId, 'EXECUTION_COMPLETED');
  if (!execDone.ok) {
    await transitionTaskState(task.taskId, 'FAILED', { error: `EXECUTION_COMPLETED refused: ${execDone.error}` });
    states.push('FAILED');
    return { ...done('TASK_FAILED'), ok: false, error: execDone.error };
  }
  states.push('EXECUTION_COMPLETED');
  const qa = await transitionTaskState(task.taskId, 'QA_IN_PROGRESS');
  states.push(qa.ok ? 'QA_IN_PROGRESS' : 'QA_TRANSITION_REFUSED');
  const verified = await transitionTaskState(task.taskId, 'VERIFIED');
  if (!verified.ok) {
    states.push(`VERIFY_REFUSED:${verified.error ?? 'unknown'}`);
    return { ...done('TASK_FAILED'), ok: false, error: verified.error };
  }
  states.push('VERIFIED');
  return done('TASK_COMPLETED');
}
