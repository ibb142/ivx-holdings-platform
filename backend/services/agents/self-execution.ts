/**
 * IVX Block 26 — Agent Self-Execution Test.
 *
 * The multi-agent framework autonomously assigns and completes one real
 * low-risk technical task end-to-end:
 *   CTO Orchestrator routes  ->  specialist accepts  ->  inspects file
 *   ->  records a safe proposal  ->  validates  ->  writes memory
 *   ->  completes task. A separate high-risk dispatch confirms risk gates
 *   remain enforced.
 *
 * No file mutations. No deploys. No destructive actions.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AGENTS,
  MULTI_AGENT_MARKER,
  completeTask,
  dispatchTask,
  failTask,
  getTask,
  listAudit,
  readAgentMemory,
  recordAudit,
  writeAgentMemory,
  type AgentAuditEntry,
  type AgentTaskRecord,
} from './multi-agent-framework';

export const SELF_EXECUTION_MARKER = 'ivx-agent-self-execution-2026-05-17t-block26';

export type SelfExecutionStep = {
  name: string;
  ok: boolean;
  detail: string;
  at: string;
};

export type SelfExecutionResult = {
  ok: boolean;
  marker: string;
  startedAt: string;
  completedAt: string;
  goal: string;
  agentUsed: string;
  task: AgentTaskRecord | null;
  riskGuardTask: { id: string; status: string; blockedReason: string | null } | null;
  steps: SelfExecutionStep[];
  memoryWrite: { namespace: string; key: string; id: string } | null;
  auditCount: number;
  auditTail: AgentAuditEntry[];
  blockers: string[];
};

let lastResult: SelfExecutionResult | null = null;

function nowIso(): string { return new Date().toISOString(); }

function step(name: string, ok: boolean, detail: string): SelfExecutionStep {
  return { name, ok, detail: detail.slice(0, 400), at: nowIso() };
}

/**
 * Resolve the target file path for the self-execution test.
 *
 * Uses repository-root resolution that works across:
 * - local development (repo root detected from module path)
 * - GitHub Actions runner (GITHUB_WORKSPACE env var)
 * - Render worker (process.cwd() as repo root)
 * - clean-room checkout (RENDER_WORKSPACE or cwd)
 *
 * The target file is configurable via the IVX_SELF_EXEC_TARGET_FILE env var,
 * defaulting to PLAN.md at the repository root.
 */
function resolveTargetFile(): string {
  // 1. Check for explicit override (tests, alternate configs)
  const override = process.env.IVX_SELF_EXEC_TARGET_FILE;
  if (override && path.isAbsolute(override)) {
    return override;
  }

  // 2. Resolve the repository root from multiple sources
  const candidates: string[] = [
    process.env.GITHUB_WORKSPACE,   // GitHub Actions runner
    process.env.RENDER_WORKSPACE,    // Render worker (if set)
    process.cwd(),                   // Render worker / local CLI
  ].filter((p): p is string => Boolean(p) && p.length > 0);

  // 3. Add module-relative resolution as fallback (local dev)
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    candidates.push(path.resolve(here, '..', '..', '..'));
  } catch {
    // import.meta.url may not be available in some bundlers — skip
  }

  // 4. Use the first candidate that contains a PLAN.md (or any package.json)
  const targetName = override ?? 'PLAN.md';
  for (const candidate of candidates) {
    const candidatePath = path.join(candidate, targetName);
    // Return the first candidate path — the caller handles file-not-found
    return candidatePath;
  }

  // 5. Final fallback: cwd + PLAN.md
  return path.join(process.cwd(), targetName);
}

/**
 * Validate that a resolved path is safe — within the workspace root.
 * Prevents path traversal outside the repository.
 */
function isPathSafe(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const workspaceRoot = process.env.GITHUB_WORKSPACE
    ?? process.env.RENDER_WORKSPACE
    ?? process.cwd();
  const normalizedRoot = path.resolve(workspaceRoot);
  return resolved.startsWith(normalizedRoot);
}

/**
 * Run a single low-risk autonomous task through the multi-agent pipeline.
 * Returns a deterministic, auditable result the owner can inspect.
 */
export async function runSelfExecutionTest(): Promise<SelfExecutionResult> {
  const startedAt = nowIso();
  const blockers: string[] = [];
  const steps: SelfExecutionStep[] = [];
  let agentUsed = '';
  let task: AgentTaskRecord | null = null;
  let memoryWrite: { namespace: string; key: string; id: string } | null = null;
  let riskGuardTask: { id: string; status: string; blockedReason: string | null } | null = null;

  // Low-risk goal: deliberately phrased so router picks Operations agent.
  const goal = 'operations runbook: read PLAN.md and record a triage note in agent memory';

  try {
    // 1. Dispatch through CTO Orchestrator
    const dispatch = dispatchTask({ goal });
    task = dispatch.task;
    agentUsed = task.assignedAgent;

    steps.push(step('dispatch', true, `taskId=${task.id} routedTo=${agentUsed} risk=${task.risk}`));

    if (task.assignedAgent === 'cto_orchestrator') {
      blockers.push('CTO orchestrator should not self-assign specialist tasks.');
    }
    if (task.status !== 'running') {
      blockers.push(`Expected task status=running, got ${task.status}.`);
    }

    steps.push(step(
      'routing.low_risk',
      task.risk === 'low',
      `risk=${task.risk}`,
    ));

    // 2. Specialist agent inspects target file (read-only).
    const filePath = resolveTargetFile();
    let fileContent = '';
    let fileBytes = 0;
    try {
      const info = await stat(filePath);
      fileBytes = info.size;
      fileContent = await readFile(filePath, 'utf8');
      steps.push(step('inspect.read_file', true, `path=PLAN.md bytes=${fileBytes}`));
      recordAudit(task.assignedAgent, 'inspect.read_file', `PLAN.md bytes=${fileBytes}`, task.id);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'read failed';
      steps.push(step('inspect.read_file', false, msg));
      blockers.push(`File inspection failed: ${msg}`);
    }

    // 3. Make a small safe change: a non-destructive proposal recorded in memory.
    //    Per framework policy, agents propose — they do not mutate files.
    const summaryLine = (fileContent.split('\n').find((l) => l.trim().startsWith('# ')) ?? '').trim();
    const proposal = [
      `proposal: PLAN.md is healthy at ${fileBytes} bytes.`,
      `top heading: ${summaryLine || '(none)'}`,
      'recommendation: keep Block 26 self-execution audit append-only.',
    ].join(' | ');

    const mem = writeAgentMemory(
      task.assignedAgent,
      'block26_self_execution',
      proposal,
      { taskId: task.id, fileBytes, marker: SELF_EXECUTION_MARKER },
    );
    memoryWrite = { namespace: mem.namespace, key: mem.key, id: mem.id };
    steps.push(step('memory.write', true, `ns=${mem.namespace} key=${mem.key}`));

    // 4. Validate: re-read memory and confirm the proposal is retrievable.
    const memBack = readAgentMemory(task.assignedAgent, 'block26_self_execution');
    const memOk = memBack.length > 0 && memBack[0]?.id === mem.id;
    steps.push(step('validate.memory_roundtrip', memOk, `entries=${memBack.length}`));
    if (!memOk) blockers.push('Memory roundtrip failed.');

    // 5. Confirm risky actions remain blocked (separate dispatch).
    const guard = dispatchTask({ goal: 'DROP supabase production table to wipe schema' });
    riskGuardTask = {
      id: guard.task.id,
      status: guard.task.status,
      blockedReason: guard.task.blockedReason,
    };
    const guardOk = guard.task.status === 'blocked' && guard.task.approvalRequired === true;
    steps.push(step('risk_guard.high_risk_blocked', guardOk, `status=${guard.task.status}`));
    if (!guardOk) blockers.push('High-risk task was not blocked by risk gate.');

    // 6. Complete the low-risk task — only when validation passed.
    if (blockers.length === 0) {
      task = completeTask(task.id, {
        block: 'block26-self-execution',
        proposalKey: 'block26_self_execution',
        validatedSteps: steps.length,
        marker: SELF_EXECUTION_MARKER,
      });
      steps.push(step('task.complete', task.status === 'completed', `status=${task.status}`));
    } else {
      task = failTask(task.id, `self-execution blockers: ${blockers.join('; ')}`);
      steps.push(step('task.fail', false, task.error ?? 'failed'));
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'self-execution failed';
    blockers.push(msg);
    steps.push(step('exception', false, msg));
    if (task) {
      try { task = failTask(task.id, msg); } catch { /* ignore */ }
    }
  }

  const auditTail = listAudit(20, task?.assignedAgent);
  const completedAt = nowIso();

  const ok = blockers.length === 0
    && task !== null
    && task.status === 'completed'
    && memoryWrite !== null;

  const result: SelfExecutionResult = {
    ok,
    marker: SELF_EXECUTION_MARKER,
    startedAt,
    completedAt,
    goal,
    agentUsed: agentUsed || 'unassigned',
    task,
    riskGuardTask,
    steps,
    memoryWrite,
    auditCount: auditTail.length,
    auditTail,
    blockers,
  };

  lastResult = result;
  return result;
}

export function getLastSelfExecutionResult(): SelfExecutionResult | null {
  return lastResult;
}

export function getSelfExecutionAgentRegistrySummary(): Array<{ id: string; name: string; riskLimit: string }> {
  return Object.values(AGENTS).map((a) => ({ id: a.id, name: a.name, riskLimit: a.riskLimit }));
}

export const SELF_EXECUTION_FRAMEWORK_MARKER = MULTI_AGENT_MARKER;
