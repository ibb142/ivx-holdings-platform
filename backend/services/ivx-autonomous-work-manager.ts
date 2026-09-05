import { stat } from 'node:fs/promises';
import {
  createTask,
  getAllTasks,
  IN_PROGRESS_STATES,
  type Task,
} from './ivx-autonomous-task-engine';
import { scanModuleUniverse } from './ivx-agent-real-engineering-cycle';
import { containPath, resolveRepoRoot } from './ivx-agent-engineering-tools';

export const IVX_AUTONOMOUS_WORK_MANAGER_MARKER = 'ivx-autonomous-work-manager-2026-09-05';
export const IVX_AUTONOMOUS_FLEET_SIZE = 112;
export const IVX_AUTONOMOUS_TARGET_ACTIVE_DEPTH = 2;

/**
 * Primary source of work is always Autonomous Manager discovery over the real
 * codebase. This list is intentionally SECONDARY: it covers critical control
 * plane/configuration surfaces that are outside the normal TS/TSX module scan.
 * Operators may extend it with IVX_AUTONOMOUS_SECONDARY_WORK_LIST using comma
 * or newline separated repo-relative paths. Missing paths are ignored.
 */
export const IVX_AUTONOMOUS_SECONDARY_WORK_LIST: readonly string[] = [
  'server.ts',
  'package.json',
  'tsconfig.json',
  'Dockerfile',
  'bun.lock',
  'backend/server.ts',
  'backend/package.json',
  'expo/package.json',
  'supabase/config.toml',
  '.github/workflows/ivx-ci.yml',
  '.github/workflows/ivx-render-live-cert.yml',
  '.github/workflows/ivx-112-hard-start-recovery.yml',
  '.github/workflows/ivx-112-15min-agent-control.yml',
  '.github/workflows/ivx-autonomous-dashboard-enterprise-live.yml',
  '.github/workflows/ivx-landing-10of10-autonomous-112.yml',
  '.github/workflows/ivx-landing-war-room-deep-qa-live.yml',
] as const;

const ACTIVE_WORK_STATES = new Set<string>(IN_PROGRESS_STATES);

type TaskIndexRecord = Pick<Task, 'taskId' | 'idempotencyKey' | 'assignedAgentNumber' | 'state' | 'title'>;

export type AutonomousWorkLane = {
  agentId: string;
  agentNumber: number;
};

export type AutonomousWorkBlockPlan = {
  ok: boolean;
  marker: string;
  sourceSha: string;
  agentId: string;
  agentNumber: number;
  source: 'existing_queue' | 'autonomous_manager_primary' | 'secondary_list' | 'none';
  taskId: string | null;
  module: string | null;
  created: boolean;
  primaryExhausted: boolean;
  activeDepthBefore: number;
  targetActiveDepth: number;
  error: string | null;
};

export type AutonomousManagerBacklogResult = {
  ok: boolean;
  marker: string;
  sourceSha: string;
  lanes: number;
  targetActiveDepth: number;
  existing: number;
  primaryCreated: number;
  secondaryCreated: number;
  exhausted: number;
  errors: number;
  generatedAt: string;
};

let lastBacklogResult: AutonomousManagerBacklogResult | null = null;
let lastPlanAt: string | null = null;
let managerPlanInFlight: Promise<AutonomousManagerBacklogResult> | null = null;

function moduleAuditPrefix(sourceSha: string, agentId: string, agentNumber: number): string {
  return `module-audit:${sourceSha}:${agentId}:${agentNumber}:`;
}

function secondaryPrefix(sourceSha: string, agentNumber: number): string {
  return `autonomous-secondary:${sourceSha}:${agentNumber}:`;
}

function suffixAfterPrefix(value: string, prefix: string): string | null {
  return value.startsWith(prefix) ? value.slice(prefix.length) : null;
}

/**
 * Pure selection rule used by the manager and regression tests.
 * Each real module belongs to exactly one fleet lane by index modulo fleet size.
 * A lane advances to the next module it has not already materialised for this SHA.
 */
export function selectNextManagedModule(
  modules: readonly string[],
  tasks: readonly TaskIndexRecord[],
  sourceSha: string,
  agentId: string,
  agentNumber: number,
  fleetSize = IVX_AUTONOMOUS_FLEET_SIZE,
): string | null {
  if (agentNumber < 1 || fleetSize < 1) return null;
  const prefix = moduleAuditPrefix(sourceSha, agentId, agentNumber);
  const seen = new Set<string>();
  for (const task of tasks) {
    if (task.state === 'CANCELLED' || task.state === 'EXPIRED') continue;
    const rel = suffixAfterPrefix(task.idempotencyKey, prefix);
    if (rel) seen.add(rel);
  }

  const laneIndex = (agentNumber - 1) % fleetSize;
  for (let index = laneIndex; index < modules.length; index += fleetSize) {
    const rel = modules[index];
    if (!seen.has(rel)) return rel;
  }
  return null;
}

export function selectNextSecondaryPath(
  paths: readonly string[],
  tasks: readonly TaskIndexRecord[],
  sourceSha: string,
  agentNumber: number,
  fleetSize = IVX_AUTONOMOUS_FLEET_SIZE,
): string | null {
  if (agentNumber < 1 || fleetSize < 1) return null;
  const prefix = secondaryPrefix(sourceSha, agentNumber);
  const seen = new Set<string>();
  for (const task of tasks) {
    if (task.state === 'CANCELLED' || task.state === 'EXPIRED') continue;
    const rel = suffixAfterPrefix(task.idempotencyKey, prefix);
    if (rel) seen.add(rel);
  }

  const laneIndex = (agentNumber - 1) % fleetSize;
  for (let index = laneIndex; index < paths.length; index += fleetSize) {
    const rel = paths[index];
    if (!seen.has(rel)) return rel;
  }
  return null;
}

function parseConfiguredSecondaryPaths(): string[] {
  const configured = (process.env.IVX_AUTONOMOUS_SECONDARY_WORK_LIST ?? '')
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set([...IVX_AUTONOMOUS_SECONDARY_WORK_LIST, ...configured])];
}

async function existingSecondaryPaths(primaryModules: readonly string[]): Promise<string[]> {
  const primary = new Set(primaryModules);
  const repoRoot = resolveRepoRoot();
  const paths: string[] = [];
  for (const rel of parseConfiguredSecondaryPaths()) {
    if (primary.has(rel)) continue;
    try {
      const abs = await containPath(repoRoot, rel);
      const info = await stat(abs);
      if (info.isFile()) paths.push(rel);
    } catch {
      // Secondary list is best-effort; nonexistent paths are not work.
    }
  }
  return paths;
}

export function findExistingEligibleTasks(tasks: readonly TaskIndexRecord[], agentNumber: number): TaskIndexRecord[] {
  return tasks.filter((task) =>
    task.assignedAgentNumber === agentNumber
    && ACTIVE_WORK_STATES.has(task.state)
    && task.state !== 'WAITING_FOR_APPROVAL'
    && task.state !== 'PAUSED',
  );
}

/**
 * Autonomous Manager owns work discovery and block creation.
 * Priority order:
 *   1) keep a small real-work buffer for this lane (default depth 1 here);
 *   2) next unseen real code module for this SHA (primary patrol);
 *   3) explicit secondary critical-file list;
 *   4) truthful NONE when there is no real work left.
 *
 * The fleet patrol calls this with targetActiveDepth=2 so every IA can finish
 * one real task and immediately lease the next without 112 simultaneous
 * re-planning reads against the durable store.
 */
export async function ensureAutonomousWorkBlockForAgent(input: {
  sourceSha: string;
  agentId: string;
  agentNumber: number;
  targetActiveDepth?: number;
}): Promise<AutonomousWorkBlockPlan> {
  const targetActiveDepth = Math.max(1, Math.min(3, Math.floor(input.targetActiveDepth ?? 1)));
  const base = {
    marker: IVX_AUTONOMOUS_WORK_MANAGER_MARKER,
    sourceSha: input.sourceSha,
    agentId: input.agentId,
    agentNumber: input.agentNumber,
    targetActiveDepth,
  };

  try {
    const tasks = await getAllTasks();
    const existing = findExistingEligibleTasks(tasks, input.agentNumber);
    if (existing.length >= targetActiveDepth) {
      return {
        ...base,
        ok: true,
        source: 'existing_queue',
        taskId: existing[0]?.taskId ?? null,
        module: null,
        created: false,
        primaryExhausted: false,
        activeDepthBefore: existing.length,
        error: null,
      };
    }

    const modules = await scanModuleUniverse();
    const nextModule = selectNextManagedModule(
      modules,
      tasks,
      input.sourceSha,
      input.agentId,
      input.agentNumber,
    );
    if (nextModule) {
      const result = await createTask({
        title: `Module audit: ${nextModule}`,
        description: `AUTONOMOUS_MANAGER work block for ${nextModule} at source SHA ${input.sourceSha}: inspect the real file, secret-scan, validate relative imports, find hygiene defects, queue repair tasks, and attach fresh evidence. Assigned lane: ${input.agentId} (IA-${input.agentNumber}).`,
        taskType: 'development',
        idempotencyKey: `${moduleAuditPrefix(input.sourceSha, input.agentId, input.agentNumber)}${nextModule}`,
        priority: 'medium',
        assignedAgentNumber: input.agentNumber,
      });
      return {
        ...base,
        ok: result.ok,
        source: 'autonomous_manager_primary',
        taskId: result.task?.taskId ?? null,
        module: nextModule,
        created: Boolean(result.task && !result.duplicate),
        primaryExhausted: false,
        activeDepthBefore: existing.length,
        error: result.error,
      };
    }

    const secondaryPaths = await existingSecondaryPaths(modules);
    const secondary = selectNextSecondaryPath(
      secondaryPaths,
      tasks,
      input.sourceSha,
      input.agentNumber,
    );
    if (secondary) {
      const result = await createTask({
        title: `Module audit: ${secondary}`,
        description: `AUTONOMOUS_MANAGER secondary-list work block for critical repo surface ${secondary} at source SHA ${input.sourceSha}. This fallback is used only after the lane's primary code-module patrol is exhausted. Inspect the real file and attach fresh evidence; do not fabricate utilization.`,
        taskType: 'qa',
        idempotencyKey: `${secondaryPrefix(input.sourceSha, input.agentNumber)}${secondary}`,
        priority: 'high',
        assignedAgentNumber: input.agentNumber,
      });
      return {
        ...base,
        ok: result.ok,
        source: 'secondary_list',
        taskId: result.task?.taskId ?? null,
        module: secondary,
        created: Boolean(result.task && !result.duplicate),
        primaryExhausted: true,
        activeDepthBefore: existing.length,
        error: result.error,
      };
    }

    if (existing.length > 0) {
      return {
        ...base,
        ok: true,
        source: 'existing_queue',
        taskId: existing[0]?.taskId ?? null,
        module: null,
        created: false,
        primaryExhausted: true,
        activeDepthBefore: existing.length,
        error: null,
      };
    }

    return {
      ...base,
      ok: true,
      source: 'none',
      taskId: null,
      module: null,
      created: false,
      primaryExhausted: true,
      activeDepthBefore: 0,
      error: null,
    };
  } catch (error) {
    return {
      ...base,
      ok: false,
      source: 'none',
      taskId: null,
      module: null,
      created: false,
      primaryExhausted: false,
      activeDepthBefore: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function planBacklog(input: {
  sourceSha: string;
  agents: readonly AutonomousWorkLane[];
}): Promise<AutonomousManagerBacklogResult> {
  const result: AutonomousManagerBacklogResult = {
    ok: true,
    marker: IVX_AUTONOMOUS_WORK_MANAGER_MARKER,
    sourceSha: input.sourceSha,
    lanes: input.agents.length,
    targetActiveDepth: IVX_AUTONOMOUS_TARGET_ACTIVE_DEPTH,
    existing: 0,
    primaryCreated: 0,
    secondaryCreated: 0,
    exhausted: 0,
    errors: 0,
    generatedAt: new Date().toISOString(),
  };

  for (const lane of input.agents) {
    const plan = await ensureAutonomousWorkBlockForAgent({
      sourceSha: input.sourceSha,
      agentId: lane.agentId,
      agentNumber: lane.agentNumber,
      targetActiveDepth: IVX_AUTONOMOUS_TARGET_ACTIVE_DEPTH,
    });
    if (!plan.ok) result.errors += 1;
    if (plan.source === 'existing_queue') result.existing += 1;
    else if (plan.source === 'autonomous_manager_primary' && plan.created) result.primaryCreated += 1;
    else if (plan.source === 'secondary_list' && plan.created) result.secondaryCreated += 1;
    else if (plan.source === 'none') result.exhausted += 1;
  }
  result.ok = result.errors === 0;
  lastBacklogResult = result;
  lastPlanAt = result.generatedAt;
  return result;
}

/** Serialize manager patrol so 112 agent completions cannot stampede task creation. */
export async function ensureAutonomousManagerBacklog(input: {
  sourceSha: string;
  agents: readonly AutonomousWorkLane[];
}): Promise<AutonomousManagerBacklogResult> {
  if (managerPlanInFlight) return managerPlanInFlight;
  managerPlanInFlight = planBacklog(input).finally(() => {
    managerPlanInFlight = null;
  });
  return managerPlanInFlight;
}

export function getAutonomousWorkManagerStatus() {
  return {
    marker: IVX_AUTONOMOUS_WORK_MANAGER_MARKER,
    role: 'PRIMARY_AUDITOR_PLANNER_DISPATCHER',
    fleetSize: IVX_AUTONOMOUS_FLEET_SIZE,
    targetActiveDepth: IVX_AUTONOMOUS_TARGET_ACTIVE_DEPTH,
    planning: Boolean(managerPlanInFlight),
    lastPlanAt,
    lastBacklogResult,
    secondaryOption: {
      enabled: true,
      source: 'critical_repo_file_list',
      envExtension: 'IVX_AUTONOMOUS_SECONDARY_WORK_LIST',
      defaultEntries: IVX_AUTONOMOUS_SECONDARY_WORK_LIST.length,
    },
    truthPolicy: 'Autonomous Manager keeps a two-deep real-work buffer per IA lane when real modules exist. Existing queue wins, primary module patrol is next, secondary list is fallback only. If all real work is exhausted the lane reports no work; no fake heartbeat or fabricated busy state is created.',
  };
}
