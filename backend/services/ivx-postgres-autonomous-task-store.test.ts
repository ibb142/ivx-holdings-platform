import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  autonomousWorkerInstanceId,
  claimPostgresAutonomousTasks,
  heartbeatPostgresAutonomousTasks,
  postgresAtomicQueueConfigured,
  postgresAtomicQueueSelected,
  readPostgresAutonomousTasks,
  readPostgresFleetLeaseRows,
  resetPostgresAutonomousTaskStoreForTests,
  startPostgresAutonomousTasks,
} from './ivx-postgres-autonomous-task-store';

const savedEnv = { ...process.env };
const savedFetch = globalThis.fetch;

afterEach(() => {
  process.env = { ...savedEnv };
  globalThis.fetch = savedFetch;
  resetPostgresAutonomousTaskStoreForTests();
});

function configureAtomicQueue(): void {
  process.env.IVX_AUTONOMOUS_QUEUE_BACKEND = 'postgres_atomic';
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://atomic-queue.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-only';
  process.env.IVX_AUTONOMOUS_WORKER_INSTANCE_ID = 'render-worker-test-01';
}

describe('PostgreSQL autonomous task store', () => {
  test('selects the backend only when explicitly configured', () => {
    delete process.env.IVX_AUTONOMOUS_QUEUE_BACKEND;
    expect(postgresAtomicQueueSelected()).toBe(false);
    configureAtomicQueue();
    expect(postgresAtomicQueueSelected()).toBe(true);
    expect(postgresAtomicQueueConfigured()).toBe(true);
    expect(autonomousWorkerInstanceId()).toBe('render-worker-test-01');
  });

  test('sends fleet claims, starts and heartbeats as one RPC per batch', async () => {
    configureAtomicQueue();
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = (async (input, init = {}) => {
      const url = String(input);
      const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
      calls.push({ url, body });
      if (url.endsWith('/rpc/ivx_autonomous_tasks_claim_batch')) {
        return Response.json(Array.from({ length: 112 }, (_, index) => ({
          workerId: `agent:ivx_holdings_${index + 1}`,
          agentNumber: index + 1,
          ok: true,
          task: { taskId: `task-${index + 1}` },
          error: null,
          stolen: false,
        })));
      }
      if (url.endsWith('/rpc/ivx_autonomous_tasks_start_batch')) {
        return Response.json(Array.from({ length: 112 }, (_, index) => ({
          taskId: `task-${index + 1}`,
          workerId: `agent:ivx_holdings_${index + 1}`,
          ok: true,
          task: { taskId: `task-${index + 1}` },
          error: null,
        })));
      }
      if (url.endsWith('/rpc/ivx_autonomous_tasks_heartbeat_batch')) {
        return Response.json({ ok: true, refreshed: 112, rejected: [] });
      }
      throw new Error(`unexpected request ${url}`);
    }) as typeof fetch;

    const requests = Array.from({ length: 112 }, (_, index) => ({
      workerId: `agent:ivx_holdings_${index + 1}`,
      agentNumber: index + 1,
    }));
    const claimed = await claimPostgresAutonomousTasks(requests);
    const leases = claimed.map((result) => ({ taskId: result.task!.taskId, workerId: result.workerId }));
    const started = await startPostgresAutonomousTasks(leases);
    const heartbeat = await heartbeatPostgresAutonomousTasks(leases);

    expect(claimed).toHaveLength(112);
    expect(started).toHaveLength(112);
    expect(heartbeat).toEqual({ ok: true, refreshed: 112, rejected: [] });
    expect(calls).toHaveLength(3);
    expect(calls.every((call) => call.body.p_worker_instance_id === 'render-worker-test-01')).toBe(true);
    expect((calls[0].body.p_requests as unknown[])).toHaveLength(112);
    expect((calls[1].body.p_leases as unknown[])).toHaveLength(112);
    expect((calls[2].body.p_leases as unknown[])).toHaveLength(112);
  });

  test('reads only lease-bearing task rows as live fleet evidence', async () => {
    configureAtomicQueue();
    globalThis.fetch = (async (input) => {
      const url = String(input);
      expect(url).toContain('state=in.(LEASED,RUNNING,EXECUTION_COMPLETED');
      expect(url).toContain('lease_holder=not.is.null');
      return Response.json([{
        task_id: 'task-1',
        state: 'RUNNING',
        assigned_agent_number: 1,
        lease_holder: 'agent:ivx_holdings_1',
        worker_instance_id: 'render-worker-test-01',
        last_heartbeat_at: '2026-09-07T15:00:00.000Z',
        lease_expires_at: '2026-09-07T15:05:00.000Z',
      }]);
    }) as typeof fetch;
    expect(await readPostgresFleetLeaseRows()).toEqual([{
      taskId: 'task-1',
      state: 'RUNNING',
      assignedAgentNumber: 1,
      leaseHolder: 'agent:ivx_holdings_1',
      workerInstanceId: 'render-worker-test-01',
      lastHeartbeatAt: '2026-09-07T15:00:00.000Z',
      leaseExpiresAt: '2026-09-07T15:05:00.000Z',
    }]);
  });

  test('coalesces a cold burst of 112 full-queue reads into one REST request', async () => {
    configureAtomicQueue();
    let reads = 0;
    globalThis.fetch = (async (input) => {
      expect(String(input)).toContain('ivx_autonomous_tasks?select=payload');
      reads += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return Response.json([{ payload: { taskId: 'task-cache-1' } }]);
    }) as typeof fetch;

    const snapshots = await Promise.all(
      Array.from({ length: 112 }, () => readPostgresAutonomousTasks()),
    );
    expect(reads).toBe(1);
    expect(snapshots).toHaveLength(112);
    expect(snapshots.every((tasks) => tasks[0]?.taskId === 'task-cache-1')).toBe(true);
    snapshots[0][0].taskId = 'caller-mutated-copy';
    expect(snapshots[1][0].taskId).toBe('task-cache-1');
  });

  test('migration makes claims row-atomic and keeps RPCs private', () => {
    const migration = readFileSync(path.join(import.meta.dir, '../../supabase/migrations/20260907151751_ivx_autonomous_atomic_task_queue.sql'), 'utf8');
    const uniqueLeaseMigration = readFileSync(path.join(import.meta.dir, '../../supabase/migrations/20260907153209_ivx_autonomous_unique_worker_lease.sql'), 'utf8');
    expect(migration).toContain('for update skip locked');
    expect(migration).toContain('alter table public.ivx_autonomous_tasks enable row level security');
    expect(migration).toContain('security invoker');
    expect(migration).not.toContain('security definer');
    expect(migration).toContain('revoke execute on function public.ivx_autonomous_tasks_claim_batch(jsonb,text,integer) from public, anon, authenticated');
    expect(migration).toContain('grant execute on function public.ivx_autonomous_tasks_claim_batch(jsonb,text,integer) to service_role');
    expect(uniqueLeaseMigration).toContain('create unique index if not exists ivx_autonomous_tasks_active_holder_idx');
    expect(uniqueLeaseMigration).toContain('pg_catalog.pg_advisory_xact_lock');
    expect(uniqueLeaseMigration).toContain("'alreadyActiveTaskId'");
    expect(uniqueLeaseMigration).toContain("task.lease_expires_at < v_now");
  });
});
