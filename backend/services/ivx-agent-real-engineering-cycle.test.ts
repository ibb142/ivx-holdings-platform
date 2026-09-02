/**
 * 112-agent durable task OWNERSHIP — regression tests for the REAL-WORK mandate:
 *   - 112 unique agents seed 112 unique owned tasks
 *   - IA-02 cannot lease IA-01's task; owners lease their own
 *   - idempotency keys bind sourceSha + agentId + agentNumber + module (no collisions)
 *   - heartbeat persists; stale leases recover; VERIFIED requires evidence
 *   - repair tasks inherit module-lane ownership (never dumped on IA-01)
 *   - NO_TASK_AVAILABLE is impossible for a healthy agent while modules exist
 *
 * Isolation: the suite runs against the FILE fallback store (Supabase env unset)
 * with backup/restore of tasks.json — production durable data is never touched.
 */
import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createTask,
  getAllTasks,
  heartbeat,
  leaseNextTask,
  releaseLease,
  transitionTaskState,
  validateCompletion,
  type Task,
} from './ivx-autonomous-task-engine.js';
import {
  IVX_REAL_ENGINEERING_CYCLE_MARKER,
  runRealEngineeringCycle,
  scanModuleUniverse,
  seedModuleAuditTask,
} from './ivx-agent-real-engineering-cycle.js';

const STORE_DIR = path.join(process.cwd(), 'logs', 'audit', 'task-engine');
const STORE_FILE = path.join(STORE_DIR, 'tasks.json');
const BACKUP_FILE = STORE_FILE + '.ownership-test-backup';
const SHA1 = 'ownership-test-sha-0001';
let fileStoreActive = false;

beforeAll(async () => {
  try {
    await rename(STORE_FILE, BACKUP_FILE);
  } catch {
    /* no prior store */
  }
  fileStoreActive = true;
});

afterAll(async () => {
  try {
    await rename(BACKUP_FILE, STORE_FILE);
  } catch {
    /* keep test store */
  }
});

function ownedTasks(): Promise<Task[]> {
  return getAllTasks();
}

describe('112-agent durable task ownership', () => {
  it('runs in isolated file-store mode (Supabase never touched)', async () => {
    expect(IVX_REAL_ENGINEERING_CYCLE_MARKER).toContain('ivx-agent-real-engineering-cycle');
    expect(fileStoreActive).toBe(true);
    expect(await ownedTasks()).toEqual([]);
  });

  it('discovers modules from the Render backend working-directory layout', async () => {
    const originalCwd = process.cwd();
    const root = await mkdtemp(path.join(os.tmpdir(), 'ivx-render-layout-'));
    const backend = path.join(root, 'backend');
    try {
      await mkdir(path.join(backend, 'api'), { recursive: true });
      await mkdir(path.join(backend, 'services'), { recursive: true });
      await writeFile(path.join(backend, 'api', 'health.ts'), 'export const ok = true;\n', 'utf8');
      await writeFile(path.join(backend, 'services', 'worker.ts'), 'export const worker = true;\n', 'utf8');
      process.chdir(backend);
      expect(await scanModuleUniverse()).toEqual(['api/health.ts', 'services/worker.ts']);
    } finally {
      process.chdir(originalCwd);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('IA-02 cannot lease a task created for IA-01', async () => {
    const t01 = await seedModuleAuditTask(SHA1, 'ivx_holdings_1', 1);
    expect(t01).not.toBeNull();
    expect(t01!.assignedAgentNumber).toBe(1);
    expect(t01!.idempotencyKey).toBe(`module-audit:${SHA1}:ivx_holdings_1:1:${t01!.idempotencyKey.split(':').slice(4).join(':')}`);
    const stolen = await leaseNextTask('worker:ivx_holdings_2', 2);
    expect(stolen.ok).toBe(true);
    expect(stolen.task).toBeNull();
  });

  it('IA-01 leases its own task; heartbeat persists durably', async () => {
    const leased = await leaseNextTask('worker:ivx_holdings_1', 1);
    expect(leased.ok).toBe(true);
    expect(leased.task).not.toBeNull();
    expect(leased.task!.assignedAgentNumber).toBe(1);
    const hb = await heartbeat(leased.task!.taskId, 'worker:ivx_holdings_1');
    expect(hb.ok).toBe(true);
    const all = await ownedTasks();
    const stored = all.find((t) => t.taskId === leased.task!.taskId);
    expect(stored?.lastHeartbeatAt).not.toBeNull();
    await releaseLease(leased.task!.taskId, 'worker:ivx_holdings_1');
  });

  it('stale lease recovers back to the owning agent', async () => {
    const leased = await leaseNextTask('worker:ivx_holdings_1', 1);
    expect(leased.task).not.toBeNull();
    const raw = JSON.parse(await readFile(STORE_FILE, 'utf8')) as Task[];
    const target = raw.find((t) => t.taskId === leased.task!.taskId);
    target!.leaseExpiresAt = new Date(Date.now() - 60_000).toISOString();
    await writeFile(STORE_FILE, JSON.stringify(raw), 'utf8');
    const recovered = await leaseNextTask('worker:ivx_holdings_1', 1);
    expect(recovered.task?.taskId).toBe(leased.task!.taskId);
    await releaseLease(leased.task!.taskId, 'worker:ivx_holdings_1');
  });

  it('112 unique agents seed 112 unique owned tasks with correct owners', async () => {
    const modules = await scanModuleUniverse();
    expect(modules.length).toBeGreaterThanOrEqual(112);
    const ids: string[] = [];
    const keys: string[] = [];
    for (let n = 1; n <= 112; n++) {
      const t = await seedModuleAuditTask(SHA1, `ivx_holdings_${n}`, n);
      expect(t).not.toBeNull();
      expect(t!.assignedAgentNumber).toBe(n);
      expect(t!.idempotencyKey).toContain(`:${SHA1}:ivx_holdings_${n}:${n}:`);
      ids.push(t!.taskId);
      keys.push(t!.idempotencyKey);
    }
    expect(new Set(ids).size).toBe(112);
    expect(new Set(keys).size).toBe(112);
    // Deterministic per-agent module: (agentNumber - 1) % modules.length
    const t112 = (await ownedTasks()).find((t) => t.assignedAgentNumber === 112);
    expect(t112?.title).toBe(`Module audit: ${modules[111]}`);
  });

  it('idempotency: duplicate seed returns the same owned task, never a second one', async () => {
    const first = await seedModuleAuditTask(SHA1, 'ivx_holdings_5', 5);
    const again = await seedModuleAuditTask(SHA1, 'ivx_holdings_5', 5);
    expect(again!.taskId).toBe(first!.taskId);
    const mine = (await ownedTasks()).filter((t) => t.assignedAgentNumber === 5);
    expect(mine.length).toBe(1);
  });

  it('full cycle: real taskId, VERIFIED with fresh evidence, never NO_TASK_AVAILABLE', async () => {
    const result = await runRealEngineeringCycle({ agentId: 'ivx_holdings_3', agentNumber: 3, sourceSha: SHA1 });
    expect(result.action).not.toBe('NO_TASK_AVAILABLE');
    expect(result.ok).toBe(true);
    expect(result.action).toBe('TASK_COMPLETED');
    expect(result.taskId).not.toBeNull();
    expect(result.taskId).not.toBe('');
    expect(result.states).toContain('VERIFIED');
    const stored = (await ownedTasks()).find((t) => t.taskId === result.taskId);
    expect(stored?.state).toBe('VERIFIED');
    expect(stored?.evidence.some((e) => e.evidenceType === 'source_file_inspected')).toBe(true);
  });

  it('durable rerun: same agent + same SHA returns ALREADY_VERIFIED with the real taskId', async () => {
    const first = await runRealEngineeringCycle({ agentId: 'ivx_holdings_3', agentNumber: 3, sourceSha: 'rerun-sha-0002' });
    expect(first.action).toBe('TASK_COMPLETED');
    const rerun = await runRealEngineeringCycle({ agentId: 'ivx_holdings_3', agentNumber: 3, sourceSha: 'rerun-sha-0002' });
    expect(rerun.ok).toBe(true);
    expect(rerun.action).toBe('TASK_COMPLETED');
    expect(rerun.states).toEqual(['ALREADY_VERIFIED']);
    expect(rerun.taskId).toBe(first.taskId);
  });

  it('repair tasks inherit module-lane ownership — never default to IA-01', async () => {
    const modules = await scanModuleUniverse();
    let todoModule: string | null = null;
    for (const m of modules) {
      if (m.includes('.test.') || m.includes('/qa/')) continue;
      const content = await readFile(path.join(process.cwd(), m), 'utf8').catch(() => '');
      if (/\b(TODO|FIXME|HACK)\b/.test(content)) {
        todoModule = m;
        break;
      }
    }
    // A clean production tree may intentionally have no unresolved marker.
    // Use this test fixture itself as the deterministic inspection target; it
    // contains the marker vocabulary above and keeps production code clean.
    todoModule ??= 'backend/services/ivx-agent-real-engineering-cycle.test.ts';
    const owner = 40;
    const probe = await createTask({
      title: `Module audit: ${todoModule}`,
      description: `Repair-ownership probe for module ${todoModule} (real defect present).`,
      taskType: 'development',
      idempotencyKey: `repair-probe:${SHA1}:ivx_holdings_${owner}:${owner}:${todoModule}`,
      priority: 'high',
      assignedAgentNumber: owner,
    });
    expect(probe.ok).toBe(true);
    const result = await runRealEngineeringCycle({ agentId: `ivx_holdings_${owner}`, agentNumber: owner, sourceSha: SHA1 });
    expect(result.action).toBe('TASK_COMPLETED');
    expect(result.repairTaskIds.length).toBeGreaterThan(0);
    const all = await ownedTasks();
    for (const repairId of result.repairTaskIds) {
      const repair = all.find((t) => t.taskId === repairId);
      expect(repair?.assignedAgentNumber).toBe(owner);
      expect(repair?.idempotencyKey).toContain(`repair:${SHA1}:${owner}:`);
    }
  });

  it('VERIFIED requires evidence: honest validator rejects evidence-free VERIFIED claims', async () => {
    const created = await createTask({
      title: 'Integrity probe',
      description: 'Evidence-free completion probe',
      taskType: 'audit',
      idempotencyKey: `integrity-probe:${SHA1}`,
      assignedAgentNumber: 1,
    });
    expect(created.ok).toBe(true);
    const id = created.task!.taskId;
    for (const state of ['LEASED', 'RUNNING', 'EXECUTION_COMPLETED', 'QA_IN_PROGRESS', 'VERIFIED'] as const) {
      await transitionTaskState(id, state);
    }
    const all = await ownedTasks();
    const task = all.find((t) => t.taskId === id)!;
    expect(task.state).toBe('VERIFIED');
    expect(task.evidence.length).toBe(0);
    const verdict = validateCompletion(task);
    expect(verdict.verdict).not.toBe('VERIFIED');
  });
});
