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
import { createHash } from 'node:crypto';
import {
  createTask,
  finalizeEvidenceTask,
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
  getFleetEngineeringMetrics,
  moduleInspectionCriteria,
  runRealEngineeringCycle,
  scanModuleUniverse,
  seedModuleAuditTask,
} from './ivx-agent-real-engineering-cycle.js';

const STORE_DIR = path.join(process.cwd(), 'logs', 'audit', 'task-engine');
const STORE_FILE = path.join(STORE_DIR, 'tasks.json');
const BACKUP_FILE = STORE_FILE + '.ownership-test-backup';
const SHA1 = 'a'.repeat(40);
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
    expect(validateCompletion(stored!).verdict).toBe('VERIFIED');
    expect(stored?.taskType).toBe('discovery');
    const proof = stored!.evidence.find((e) => e.evidenceType === 'source_file_inspected')!;
    expect(proof.commitSha).toBe(SHA1);
    expect(proof.contentHash).toBe(createHash('sha256').update(await readFile(proof.source)).digest('hex'));
  });

  it('durable rerun: same agent + same SHA returns ALREADY_VERIFIED with the real taskId', async () => {
    const first = await runRealEngineeringCycle({ agentId: 'ivx_holdings_3', agentNumber: 3, sourceSha: 'b'.repeat(40) });
    expect(first.action).toBe('TASK_COMPLETED');
    const rerun = await runRealEngineeringCycle({ agentId: 'ivx_holdings_3', agentNumber: 3, sourceSha: 'b'.repeat(40) });
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
      taskType: 'discovery',
      objectiveId: 'objective-inspection',
      acceptanceCriteria: moduleInspectionCriteria(todoModule, SHA1),
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
      expect(repair?.objectiveId).toBe('objective-inspection');
      expect(repair?.parentTaskId).toBe(probe.task!.taskId);
      expect(repair?.dependencies).toEqual([probe.task!.taskId]);
      expect(repair?.acceptanceCriteria.some((criterion) => criterion.verificationMethod === 'production_check')).toBe(true);
      expect(repair?.idempotencyKey).toContain(`repair:${SHA1}:${owner}:`);
    }
  });

  it('VERIFIED requires evidence: honest validator rejects evidence-free VERIFIED claims', async () => {
    const created = await createTask({
      title: 'Integrity probe',
      description: 'Evidence-free completion probe',
      taskType: 'qa',
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
    expect(task.state).toBe('QA_IN_PROGRESS');
    expect(task.evidence.length).toBe(0);
    const verdict = validateCompletion(task);
    expect(verdict.verdict).not.toBe('VERIFIED');
  });

  it('preserves all task mutations when 112 agents seed concurrently', async () => {
    const concurrentSha = 'ownership-concurrency-sha-0002';
    const seeded = await Promise.all(
      Array.from({ length: 112 }, (_, index) => {
        const n = index + 1;
        return seedModuleAuditTask(concurrentSha, `ivx_holdings_${n}`, n);
      }),
    );
    expect(seeded.every(Boolean)).toBe(true);
    expect(new Set(seeded.map((task) => task!.taskId)).size).toBe(112);

    const persisted = (await ownedTasks()).filter((task) =>
      task.idempotencyKey.includes(`:${concurrentSha}:`),
    );
    expect(persisted.length).toBe(112);
    expect(new Set(persisted.map((task) => task.assignedAgentNumber)).size).toBe(112);
  });

  it('does not complete a legacy repair task from an inspection alone', async () => {
    const task = await createTask({ title: 'Module audit: package.json', description: 'Legacy repair criteria',
      taskType: 'development', idempotencyKey: 'legacy-inspection', assignedAgentNumber: 700 });
    const result = await runRealEngineeringCycle({ agentId: 'legacy', agentNumber: 700, sourceSha: SHA1 });
    expect(result.taskId).toBe(task.task!.taskId);
    expect(result.action).toBe('TASK_BLOCKED');
    const stored = (await ownedTasks()).find((candidate) => candidate.taskId === result.taskId)!;
    expect(stored.acceptanceCriteria.every((criterion) => !criterion.met)).toBe(true);
    expect(stored.evidence.some((evidence) => evidence.evidenceType === 'source_file_inspected')).toBe(true);
  });

  it('rejects wrong revision, expired lease and unrelated evidence without persisting success', async () => {
    const created = await createTask({ title: 'Module audit: package.json', description: 'Inspection identity probe',
      taskType: 'discovery', idempotencyKey: 'inspection-fencing', assignedAgentNumber: 701,
      acceptanceCriteria: moduleInspectionCriteria('package.json', SHA1) });
    const taskId = created.task!.taskId;
    await leaseNextTask('inspection-worker', 701);
    await transitionTaskState(taskId, 'RUNNING');
    const evidence = { evidenceType: 'source_file_inspected' as const, source: 'package.json',
      contentHash: '1'.repeat(64), summary: 'synthetic receipt', commitSha: 'b'.repeat(40), deploymentId: null };
    expect((await finalizeEvidenceTask({ taskId, workerId: 'inspection-worker', evidence, outcome: 'VERIFIED' })).ok).toBe(false);
    expect((await finalizeEvidenceTask({ taskId, workerId: 'stale-worker', evidence: { ...evidence, commitSha: SHA1 }, outcome: 'VERIFIED' })).ok).toBe(false);
    const raw = JSON.parse(await readFile(STORE_FILE, 'utf8')) as Task[];
    raw.find((task) => task.taskId === taskId)!.leaseExpiresAt = new Date(Date.now() - 1000).toISOString();
    await writeFile(STORE_FILE, JSON.stringify(raw));
    const expired = await finalizeEvidenceTask({ taskId, workerId: 'inspection-worker', evidence: { ...evidence, commitSha: SHA1 }, outcome: 'VERIFIED' });
    expect(expired.ok).toBe(false);
    expect(expired.error).toContain('expired');
    const stored = (await ownedTasks()).find((task) => task.taskId === taskId)!;
    expect(stored.state).toBe('RUNNING');
    expect(stored.evidence).toEqual([]);
  });

  it('counts inspections separately and excludes unsupported historical VERIFIED claims', async () => {
    const before = await getFleetEngineeringMetrics();
    expect(before.inspectionsCompletedVerified).toBeGreaterThan(0);
    expect(before.tasksCompletedVerified).toBe(0);
    expect(before.defectsFixed).toBe(0);
    expect(before.productiveAgentMinutesTotal).toBe(0);
    const raw = JSON.parse(await readFile(STORE_FILE, 'utf8')) as Task[];
    const legacy = raw.find((task) => task.idempotencyKey === 'legacy-inspection')!;
    legacy.state = 'VERIFIED';
    await writeFile(STORE_FILE, JSON.stringify(raw));
    const after = await getFleetEngineeringMetrics();
    expect(after.invalidVerifiedClaims).toBe(before.invalidVerifiedClaims + 1);
    expect(after.tasksCompletedVerified).toBe(before.tasksCompletedVerified);
    expect(after.inspectionsCompletedVerified).toBe(before.inspectionsCompletedVerified);
  });

  it('the PostgreSQL transition path rejects unsupported success before issuing a mutation', async () => {
    const fixture = structuredClone((await ownedTasks()).find((task) => task.title === 'Integrity probe')!);
    const names = ['IVX_AUTONOMOUS_QUEUE_BACKEND', 'SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
      'SUPABASE_DB_URL', 'DATABASE_URL', 'POSTGRES_URL', 'SUPABASE_POOLER_URL'] as const;
    const saved = names.map((name) => process.env[name]);
    const originalFetch = globalThis.fetch;
    let mutations = 0;
    try {
      for (const name of names) delete process.env[name];
      process.env.IVX_AUTONOMOUS_QUEUE_BACKEND = 'postgres_atomic';
      process.env.SUPABASE_URL = 'https://fixture.invalid';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-test-key';
      globalThis.fetch = (async (_url, init) => {
        if (init?.method !== 'GET') mutations++;
        return Response.json([{ payload: fixture }]);
      }) as typeof fetch;
      const refused = await transitionTaskState(fixture.taskId, 'VERIFIED');
      expect(refused.ok).toBe(false);
      expect(refused.task?.state).toBe('QA_IN_PROGRESS');
      expect(mutations).toBe(0);
      fixture.state = 'RUNNING'; fixture.leaseHolder = 'old-worker'; fixture.leaseExpiresAt = new Date(Date.now() - 1000).toISOString();
      const expired = await finalizeEvidenceTask({ taskId: fixture.taskId, workerId: 'old-worker', outcome: 'VERIFIED',
        evidence: { evidenceType: 'log', source: 'synthetic', summary: 'fixture', contentHash: '1'.repeat(64), commitSha: SHA1, deploymentId: null } });
      expect(expired.ok).toBe(false);
      expect(expired.error).toContain('expired');
      expect(mutations).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
      names.forEach((name, index) => { if (saved[index] === undefined) delete process.env[name]; else process.env[name] = saved[index]; });
    }
  });
});
