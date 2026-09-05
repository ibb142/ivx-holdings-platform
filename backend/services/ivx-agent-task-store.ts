/**
 * IVX row-based agent task store.
 *
 * Removes the shared JSON-document write bottleneck for the autonomous fleet.
 * Each task is one PostgreSQL row and leasing is performed atomically with
 * FOR UPDATE SKIP LOCKED. This design scales horizontally from the current
 * fleet to thousands of workers without a process-wide mutex.
 */

const SERVICE_ROLE_NAMES = ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY'] as const;
const SUPABASE_URL_NAMES = ['EXPO_PUBLIC_SUPABASE_URL', 'SUPABASE_URL'] as const;

function env(names: readonly string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return '';
}

function config() {
  const url = env(SUPABASE_URL_NAMES).replace(/\/+$/, '');
  const key = env(SERVICE_ROLE_NAMES);
  if (!url || !key) throw new Error('Agent task store requires Supabase service credentials.');
  return { url, key };
}

async function rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { url, key } = config();
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Agent task store ${name} HTTP ${response.status}: ${text.slice(0, 240)}`);
  return (text ? JSON.parse(text) : null) as T;
}

export const AGENT_TASK_STORE_SCHEMA_SQL = `
create table if not exists public.ivx_agent_tasks (
  task_id text primary key,
  idempotency_key text not null unique,
  assigned_agent_number integer,
  state text not null,
  priority text not null default 'medium',
  payload jsonb not null,
  lease_holder text,
  lease_expires_at timestamptz,
  last_heartbeat_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ivx_agent_tasks_queue_idx
  on public.ivx_agent_tasks (state, assigned_agent_number, created_at);
create index if not exists ivx_agent_tasks_lease_idx
  on public.ivx_agent_tasks (lease_expires_at) where state in ('LEASED','RUNNING');

create or replace function public.ivx_lease_agent_task(
  p_worker_id text,
  p_agent_number integer default null,
  p_lease_seconds integer default 300
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.ivx_agent_tasks;
begin
  select * into v from public.ivx_agent_tasks
  where state = 'QUEUED'
    and (assigned_agent_number is null or p_agent_number is null or assigned_agent_number = p_agent_number)
  order by case priority when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end, created_at
  for update skip locked limit 1;
  if not found then return null; end if;
  update public.ivx_agent_tasks set
    state='LEASED', lease_holder=p_worker_id,
    lease_expires_at=now()+make_interval(secs => greatest(30,p_lease_seconds)),
    last_heartbeat_at=now(), updated_at=now()
  where task_id=v.task_id returning * into v;
  return to_jsonb(v);
end $$;

create or replace function public.ivx_heartbeat_agent_task(p_task_id text,p_worker_id text,p_lease_seconds integer default 300)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update public.ivx_agent_tasks set last_heartbeat_at=now(), lease_expires_at=now()+make_interval(secs=>greatest(30,p_lease_seconds)), updated_at=now()
  where task_id=p_task_id and lease_holder=p_worker_id and state in ('LEASED','RUNNING');
  return found;
end $$;

create or replace function public.ivx_requeue_expired_agent_tasks()
returns integer language plpgsql security definer set search_path=public as $$
declare n integer;
begin
  update public.ivx_agent_tasks set state='QUEUED',lease_holder=null,lease_expires_at=null,updated_at=now()
  where state in ('LEASED','RUNNING') and lease_expires_at < now();
  get diagnostics n = row_count; return n;
end $$;
`;

export async function ensureAgentTaskStoreSchema(): Promise<void> {
  await rpc('ivx_exec_sql', { sql_text: AGENT_TASK_STORE_SCHEMA_SQL });
}

export type AgentTaskRow = {
  task_id: string;
  idempotency_key: string;
  assigned_agent_number: number | null;
  state: string;
  priority: string;
  payload: Record<string, unknown>;
  lease_holder: string | null;
  lease_expires_at: string | null;
};

export async function leaseAgentTask(workerId: string, agentNumber?: number | null, leaseSeconds = 300): Promise<AgentTaskRow | null> {
  return rpc<AgentTaskRow | null>('ivx_lease_agent_task', {
    p_worker_id: workerId,
    p_agent_number: agentNumber ?? null,
    p_lease_seconds: leaseSeconds,
  });
}

export async function heartbeatAgentTask(taskId: string, workerId: string, leaseSeconds = 300): Promise<boolean> {
  return rpc<boolean>('ivx_heartbeat_agent_task', { p_task_id: taskId, p_worker_id: workerId, p_lease_seconds: leaseSeconds });
}

export async function requeueExpiredAgentTasks(): Promise<number> {
  return rpc<number>('ivx_requeue_expired_agent_tasks', {});
}
