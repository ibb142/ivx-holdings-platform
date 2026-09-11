import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  readPostgresTaskKeys,
  autonomousWorkerInstanceId,
  claimPostgresAutonomousTasks,
  heartbeatPostgresAutonomousTasks,
  postgresAtomicQueueConfigured,
  postgresAtomicQueueSelected,
  readPostgresAutonomousTasks,
  readPostgresFleetLeaseRows,
  resetPostgresAutonomousTaskStoreForTests,
  startPostgresAutonomousTasks,
  readPostgresCurrentTasks,
  readPostgresRecoveryTasks,
  readPostgresAutonomousTaskIndex,
  readPostgresLandingTasks,
  readPostgresFleetProcessObservation,
  readPostgresFleetSloTasks,
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
  test('SLO filtering precedes the limit and keeps blocked tasks available to recovery callers', async () => {
    configureAtomicQueue(); const urls: URL[] = [];
    globalThis.fetch = (async input => { urls.push(new URL(String(input))); return Response.json([]); }) as typeof fetch;
    await readPostgresFleetSloTasks();
    await readPostgresCurrentTasks(['BLOCKED']);
    expect(urls[0].searchParams.get('limit')).toBe('1000');
    const filter = urls[0].searchParams.get('or')!;
    expect(filter).toStartWith('(state.neq.BLOCKED,and(lease_holder.not.is.null,lease_expires_at.gt.');
    expect(Number.isFinite(Date.parse(filter.split('lease_expires_at.gt.')[1].slice(0, -2)))).toBe(true);
    expect(urls[1].searchParams.has('or')).toBe(false);
    expect(urls[1].searchParams.get('state')).toBe('in.(BLOCKED)');
    globalThis.fetch = (async () => Response.json(Array.from({ length: 1000 }, () => ({ payload: {} })))) as typeof fetch;
    await expect(readPostgresFleetSloTasks()).rejects.toThrow('telemetry is incomplete');
  });
  test('process observation reads only recent events and preserves a newer draining sample', async () => {
    configureAtomicQueue();
    const event = { instance_role: 'worker', process_role: 'worker', commit_sha: 'a'.repeat(40),
      shared_state: true, shared_worker_queue: true };
    globalThis.fetch = (async input => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/rest/v1/ivx_autonomous_task_events');
      expect(url.searchParams.get('event_type')).toBe('eq.fleet_slo_sample');
      expect(url.searchParams.get('order')).toBe('created_at.desc');
      expect(Date.now() - Date.parse(url.searchParams.get('created_at')!.slice(3))).toBeLessThan(61_000);
      return Response.json([
        { worker_instance_id: 'retiring', created_at: new Date().toISOString(), event: { ...event, draining: true } },
        { worker_instance_id: 'retiring', created_at: new Date(Date.now()-1_000).toISOString(), event },
        { worker_instance_id: 'replacement', created_at: new Date().toISOString(), event },
      ]);
    }) as typeof fetch;
    const result = await readPostgresFleetProcessObservation();
    expect(result.instances).toHaveLength(2);
    expect(result.instances.find(i => i.instanceId === 'retiring')?.draining).toBe(true);
    expect(result.instances.find(i => i.instanceId === 'replacement')?.sharedState).toBe(true);
  });

  test('process observation rejects denied credentials and truncated evidence', async () => {
    configureAtomicQueue();
    process.env.SUPABASE_DB_URL = 'postgresql://unused:unused@127.0.0.1:1/unused';
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return Response.json({}, { status: 403 }); }) as typeof fetch;
    await expect(readPostgresFleetProcessObservation()).rejects.toThrow('HTTP 403');
    expect(calls).toBe(1);
    globalThis.fetch = (async () => Response.json(Array.from({ length: 1000 }, () => ({})))) as typeof fetch;
    await expect(readPostgresFleetProcessObservation()).rejects.toThrow('Incomplete process observation');
  });

  test('retries a transient HTTP status even when the response body has no retry keywords', async () => {
    configureAtomicQueue();
    let calls = 0;
    globalThis.fetch = (async () => ++calls === 1 ? Response.json({ message: 'upstream rejected' }, { status: 503 }) : Response.json([])) as typeof fetch;
    expect(await readPostgresCurrentTasks(['RUNNING'])).toEqual([]);
    expect(calls).toBe(2);
  });

  test('does not retry authorization failures or an ambiguous committed claim', async () => {
    configureAtomicQueue();
    // A configured fallback must not bypass auth or replay a committed mutation.
    process.env.SUPABASE_DB_URL = 'postgresql://unused:unused@127.0.0.1:1/unused';
    let calls = 0;
    globalThis.fetch = (async () => { calls += 1; return Response.json({ message: 'temporarily unavailable' }, { status: 403 }); }) as typeof fetch;
    await expect(readPostgresCurrentTasks(['RUNNING'])).rejects.toThrow('HTTP 403');
    expect(calls).toBe(1);
    calls = 0;
    globalThis.fetch = (async () => { calls += 1; throw new Error('fetch failed after server committed'); }) as typeof fetch;
    await expect(claimPostgresAutonomousTasks([{ workerId: 'agent:ivx_holdings_1', agentNumber: 1 }])).rejects.toThrow('fetch failed');
    expect(calls).toBe(1);
  });

  test('fails closed on truncated current-work truth and respects Retry-After time budget', async () => {
    configureAtomicQueue();
    process.env.SUPABASE_DB_URL = 'postgresql://unused:unused@127.0.0.1:1/unused';
    globalThis.fetch = (async () => Response.json(Array.from({ length: 1000 }, () => ({ payload: {} })))) as typeof fetch;
    await expect(readPostgresCurrentTasks(['RUNNING'])).rejects.toThrow('telemetry is incomplete');
    let calls = 0;
    globalThis.fetch = (async () => { calls += 1; return Response.json({}, { status: 429, headers: { 'Retry-After': '60' } }); }) as typeof fetch;
    await expect(readPostgresCurrentTasks(['RUNNING'])).rejects.toThrow('HTTP 429');
    expect(calls).toBe(1);
  });
  test('selects the backend only when explicitly configured', () => {
    delete process.env.IVX_AUTONOMOUS_QUEUE_BACKEND;
    expect(postgresAtomicQueueSelected()).toBe(false);
    configureAtomicQueue();
    expect(postgresAtomicQueueSelected()).toBe(true);
    expect(postgresAtomicQueueConfigured()).toBe(true);
    expect(autonomousWorkerInstanceId()).toStartWith('render-worker-test-01:');
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
    expect(calls.every((call) => call.body.p_worker_instance_id === autonomousWorkerInstanceId())).toBe(true);
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

  test('paginates beyond the Supabase 1,000-row response cap', async () => {
    configureAtomicQueue();
    const urls: string[] = [];
    globalThis.fetch = (async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('offset=0')) {
        return Response.json(Array.from({ length: 1_000 }, (_, index) => ({ payload: { taskId: `old-${index}` } })));
      }
      if (url.includes('offset=1000')) return Response.json([{ payload: { taskId: 'newest-landing-task' } }]);
      throw new Error(`unexpected page ${url}`);
    }) as typeof fetch;

    const tasks = await readPostgresAutonomousTasks();
    expect(tasks).toHaveLength(1_001);
    expect(tasks.at(-1)?.taskId).toBe('newest-landing-task');
    expect(urls).toHaveLength(2);
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

  test('active mission claims use a bounded prefix index before historical fallback', () => {
    const indexMigration = readFileSync(path.join(import.meta.dir, '../../supabase/migrations/20260911014433_autonomous_claim_mission_index.sql'), 'utf8');
    const claimMigration = readFileSync(path.join(import.meta.dir, '../../supabase/migrations/20260911014546_autonomous_claim_active_scope_first.sql'), 'utf8');
    expect(indexMigration).toContain('CREATE INDEX IF NOT EXISTS ivx_autonomous_tasks_queued_scope_idx');
    expect(indexMigration).not.toContain('CREATE INDEX CONCURRENTLY');
    expect(indexMigration).toContain('production migration executor wraps migrations in a transaction');
    expect(indexMigration).toContain('(idempotency_key text_pattern_ops, assigned_agent_number)');
    expect(indexMigration).toContain("WHERE state = 'QUEUED'");
    expect(claimMigration).toContain('foreach v_active_prefix in array v_active_prefixes');
    expect(claimMigration).toContain("task.idempotency_key like v_active_prefix || '%'");
    expect(claimMigration.indexOf('foreach v_active_prefix')).toBeLessThan(claimMigration.indexOf('if v_row.task_id is null then'));
    expect(claimMigration).toContain('for update skip locked');
    expect(claimMigration).toContain("prerequisite.state not in ('VERIFIED','NO_ACTION_REQUIRED')");
    expect(claimMigration).toContain("raise exception 'Expected queue candidate query was not found");
    expect(claimMigration).toContain("to_regclass('public.ivx_autonomous_tasks_queued_scope_idx')");
    expect(claimMigration).toContain('index_state.indisvalid');
    expect(claimMigration).not.toContain('security definer');
  });
});

test('coalesces concurrent current-state observers without caching stale results or sharing mutable payloads', async () => {
  configureAtomicQueue();
  let reads = 0;
  globalThis.fetch = (async () => {
    reads += 1;
    await new Promise(resolve => setTimeout(resolve, 5));
    return Response.json([{ payload: { taskId: `observation-${reads}` } }]);
  }) as typeof fetch;
  const results = await Promise.all(Array.from({ length: 112 }, (_, n) =>
    readPostgresCurrentTasks(n % 2 ? ['RUNNING', 'LEASED'] : ['LEASED', 'RUNNING'])));
  expect(reads).toBe(1);
  results[0][0].taskId = 'modified';
  expect(results[1][0].taskId).toBe('observation-1');
  expect((await readPostgresCurrentTasks(['RUNNING', 'LEASED']))[0].taskId).toBe('observation-2');
});

test('112 current-SHA Landing observers share one read without mixing deployments or retaining stale evidence', async () => {
  configureAtomicQueue();
  let reads = 0;
  globalThis.fetch = (async input => {
    const version = ++reads;
    const filter = new URL(String(input)).searchParams.get('or');
    expect(filter).toContain('landing-p0-patrol:');
    await new Promise(resolve => setTimeout(resolve, 5));
    return Response.json([{ payload: { taskId: `landing-${version}` } }]);
  }) as typeof fetch;
  const rows = await Promise.all(Array.from({ length: 112 }, () => readPostgresLandingTasks('a'.repeat(40))));
  expect(reads).toBe(1);
  rows[0][0].taskId = 'changed';
  expect(rows[1][0].taskId).toBe('landing-1');
  await Promise.all([readPostgresLandingTasks('a'.repeat(40)), readPostgresLandingTasks('b'.repeat(40))]);
  expect(reads).toBe(3);
});

test('releases a failed shared observation so the next read can recover', async () => {
  configureAtomicQueue();
  let reads = 0;
  globalThis.fetch = (async () => { reads += 1; return Response.json({}, { status: 403 }); }) as typeof fetch;
  const failed = await Promise.allSettled(Array.from({ length: 12 }, () => readPostgresCurrentTasks(['RUNNING'])));
  expect(failed.every(result => result.status === 'rejected')).toBe(true);
  expect(reads).toBe(1);
  globalThis.fetch = (async () => Response.json([])) as typeof fetch;
  expect(await readPostgresCurrentTasks(['RUNNING'])).toEqual([]);
});

test('recovery queries preserve eligible work without downloading unleased queued payloads', async () => {
  configureAtomicQueue();
  const eligible = [
    { taskId: 'blocked', state: 'BLOCKED', leaseHolder: null },
    { taskId: 'running', state: 'RUNNING', leaseHolder: 'worker:1' },
    { taskId: 'retry', state: 'RETRYING', leaseHolder: null },
    { taskId: 'queued-stale-lease', state: 'QUEUED', leaseHolder: 'worker:2' },
  ];
  let reads = 0;
  globalThis.fetch = (async input => {
    const query = new URL(String(input)).searchParams;
    expect(query.get('or')).toBe('(state.in.(BLOCKED,RUNNING,RETRYING),and(state.eq.QUEUED,lease_holder.not.is.null))');
    expect(query.get('select')).toBe('payload');
    expect(query.get('limit')).toBe('1000');
    reads += 1;
    await new Promise(resolve => setTimeout(resolve, 5));
    return Response.json(eligible.map(payload => ({ payload })));
  }) as typeof fetch;
  const observations = await Promise.all(Array.from({ length: 112 }, () => readPostgresRecoveryTasks()));
  expect(reads).toBe(1);
  expect(observations[0]).toEqual(eligible);
  observations[0][0].taskId = 'modified-by-caller';
  expect(observations[1][0].taskId).toBe('blocked');
});

test('recovery fails closed on rejected credentials and incomplete responses, then recovers', async () => {
  configureAtomicQueue();
  process.env.SUPABASE_DB_URL = 'postgresql://unused:unused@127.0.0.1:1/unused';
  let reads = 0;
  globalThis.fetch = (async () => { reads += 1; return Response.json({}, { status: 403 }); }) as typeof fetch;
  const rejected = await Promise.allSettled(Array.from({ length: 12 }, () => readPostgresRecoveryTasks()));
  expect(rejected.every(r => r.status === 'rejected')).toBe(true);
  expect(reads).toBe(1);
  globalThis.fetch = (async () => Response.json(Array.from({ length: 1000 }, () => ({ payload: {} })))) as typeof fetch;
  await expect(readPostgresRecoveryTasks()).rejects.toThrow('recovery is incomplete');
  globalThis.fetch = (async () => Response.json({ payload: [] })) as typeof fetch;
  await expect(readPostgresRecoveryTasks()).rejects.toThrow('not an array');
  globalThis.fetch = (async () => Response.json([])) as typeof fetch;
  expect(await readPostgresRecoveryTasks()).toEqual([]);
});

test('REST mission reads filter history before the cap and keep recovery ownership exceptions', async () => {
  configureAtomicQueue();
  const sha = 'a'.repeat(40);
  const queries: URLSearchParams[] = [];
  globalThis.fetch = (async input => {
    const query = new URL(String(input)).searchParams;
    queries.push(query);
    return Response.json([]);
  }) as typeof fetch;
  await readPostgresRecoveryTasks(sha);
  await readPostgresAutonomousTaskIndex(sha);
  const recovery = queries[0].get('and')!;
  expect(recovery).toContain(`idempotency_key.like.module-audit:${sha}:*`);
  expect(recovery).toContain('idempotency_key.not.like.autonomous-secondary:*');
  expect(recovery).toContain('state.eq.RUNNING');
  expect(recovery).toContain('lease_expires_at.is.null');
  expect(recovery).toContain('lease_expires_at.gt.');
  expect(recovery).not.toContain('idempotency_key.not.like.landing-p0:');
  const planning = queries[1].get('or')!;
  expect(planning).toContain(`idempotency_key.like.module-audit:${sha}:*`);
  expect(planning).toContain(`idempotency_key.like.autonomous-secondary:${sha}:*`);
  expect(planning).toContain('state.in.(LEASED,RUNNING,PAUSED,');
  expect(planning).toContain('lease_expires_at.is.null');
  await expect(readPostgresRecoveryTasks('short-sha')).rejects.toThrow('Invalid recovery source SHA');
  expect(queries).toHaveLength(2);
});

 test('exact identity reads bound each request and exclude evidence payloads', async () => {
  configureAtomicQueue();
  let calls = 0;
  const keys = Array.from({ length: 112 }, (_, i) => `learning:today:ia-${i + 1}`);
  globalThis.fetch = (async input => {
    const url = new URL(String(input));
    expect(url.searchParams.get('select')).toBe('idempotency_key');
    const batch = url.searchParams.get('idempotency_key')!.slice(4, -1).split(',');
    expect(batch.length).toBeLessThanOrEqual(28);
    calls++;
    return Response.json(batch.map(idempotency_key => ({ idempotency_key })));
  }) as typeof fetch;
  expect(await readPostgresTaskKeys(keys)).toEqual(keys);
  expect(calls).toBe(4);
  await expect(readPostgresTaskKeys(['unsafe,*'])).rejects.toThrow('Invalid bounded');
  expect(calls).toBe(4);
  globalThis.fetch = (async () => Response.json([{ idempotency_key: 'unrequested' }])) as typeof fetch;
  await expect(readPostgresTaskKeys(keys)).rejects.toThrow('Invalid task identity response');
 });
