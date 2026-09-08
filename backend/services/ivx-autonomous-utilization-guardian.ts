import { createTask, getAllTasks, type Task } from './ivx-autonomous-task-engine';

export const IVX_AUTONOMOUS_UTILIZATION_GUARDIAN_MARKER = 'ivx-autonomous-utilization-guardian-v1-2026-09-08';

const EXPECTED_AGENTS = 112;
const WINDOW_MS = 24 * 60 * 60 * 1000;
const MIN_UTILIZATION = 0.80;
const CHECK_INTERVAL_MS = 60_000;

export type FleetUtilizationSnapshot = {
  marker: string;
  generatedAt: string;
  agentsWithEvidence: number;
  productiveSeconds: number;
  capacitySeconds: number;
  utilization: number;
  targetUtilization: number;
  breach: boolean;
};

let timer: NodeJS.Timeout | null = null;
let lastSnapshot: FleetUtilizationSnapshot | null = null;

function evidenceProductiveSeconds(task: Task, sinceMs: number): number {
  let total = 0;
  for (const item of task.evidence) {
    const at = Date.parse(item.createdAt ?? '');
    if (!Number.isFinite(at) || at < sinceMs) continue;
    const match = item.summary.match(/\"productive_seconds\"\s*:\s*([0-9]+(?:\.[0-9]+)?)/);
    if (match) total += Number.parseFloat(match[1]);
  }
  return total;
}

export async function auditFleetUtilization(nowMs = Date.now()): Promise<FleetUtilizationSnapshot> {
  const tasks = await getAllTasks();
  const sinceMs = nowMs - WINDOW_MS;
  const agents = new Set<number>();
  let productiveSeconds = 0;
  for (const task of tasks) {
    const seconds = evidenceProductiveSeconds(task, sinceMs);
    if (seconds <= 0) continue;
    productiveSeconds += seconds;
    if (task.assignedAgentNumber && task.assignedAgentNumber >= 1 && task.assignedAgentNumber <= EXPECTED_AGENTS) agents.add(task.assignedAgentNumber);
  }
  const capacitySeconds = EXPECTED_AGENTS * WINDOW_MS / 1000;
  const utilization = capacitySeconds > 0 ? productiveSeconds / capacitySeconds : 0;
  const snapshot: FleetUtilizationSnapshot = {
    marker: IVX_AUTONOMOUS_UTILIZATION_GUARDIAN_MARKER,
    generatedAt: new Date(nowMs).toISOString(),
    agentsWithEvidence: agents.size,
    productiveSeconds: Math.round(productiveSeconds * 10) / 10,
    capacitySeconds,
    utilization: Math.round(utilization * 100000) / 100000,
    targetUtilization: MIN_UTILIZATION,
    breach: agents.size < EXPECTED_AGENTS || utilization < MIN_UTILIZATION,
  };
  lastSnapshot = snapshot;
  return snapshot;
}

async function ensureCorrectiveWork(snapshot: FleetUtilizationSnapshot): Promise<void> {
  if (!snapshot.breach) return;
  const bucket = snapshot.generatedAt.slice(0, 13);
  await createTask({
    title: 'P0 fleet utilization recovery',
    description: `Autonomous utilization guardian measured ${(snapshot.utilization * 100).toFixed(2)}% productive utilization across the last 24h with ${snapshot.agentsWithEvidence}/112 agents producing evidence. Target is >=${(snapshot.targetUtilization * 100).toFixed(0)}%. Audit refill eligibility, patrol scheduling, dependency waits, PostgreSQL reconciliation and worker capacity; apply bounded repairs and verify with durable productive_seconds evidence. Do not count queued, idle, waiting or blocked time as productive.`,
    taskType: 'development',
    priority: 'critical',
    idempotencyKey: `autonomous-utilization-recovery:${bucket}`,
  });
}

export async function runAutonomousUtilizationGuardian(): Promise<FleetUtilizationSnapshot> {
  const snapshot = await auditFleetUtilization();
  await ensureCorrectiveWork(snapshot);
  if (snapshot.breach) console.error('[IVX Autonomous Utilization Guardian] BREACH', snapshot);
  else console.log('[IVX Autonomous Utilization Guardian] PASS', snapshot);
  return snapshot;
}

export function getAutonomousUtilizationStatus(): FleetUtilizationSnapshot | null {
  return lastSnapshot ? { ...lastSnapshot } : null;
}

export function startAutonomousUtilizationGuardian(): boolean {
  if (timer) return false;
  void runAutonomousUtilizationGuardian().catch((error) => console.error('[IVX Autonomous Utilization Guardian] audit failed', error instanceof Error ? error.message : String(error)));
  timer = setInterval(() => {
    void runAutonomousUtilizationGuardian().catch((error) => console.error('[IVX Autonomous Utilization Guardian] audit failed', error instanceof Error ? error.message : String(error)));
  }, CHECK_INTERVAL_MS);
  timer.unref?.();
  return true;
}

export function stopAutonomousUtilizationGuardian(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
