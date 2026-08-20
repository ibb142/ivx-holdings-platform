begin;

create table if not exists public.ivx_agent_states (
  agent_id text primary key,
  agent_number int not null unique,
  agent_name text not null,
  company text not null default 'ivx_holdings',
  division text not null default 'A',
  status text not null default 'active',
  health text not null default 'unknown',
  availability text not null default 'available',
  last_heartbeat timestamptz,
  last_successful_run timestamptz,
  last_failed_run timestamptz,
  last_task_id text,
  last_tool_used text,
  last_source_reference text,
  last_evidence_sha text,
  last_error text,
  last_duration_ms bigint not null default 0,
  retry_count int not null default 0,
  total_cost_usd numeric not null default 0,
  total_runs int not null default 0,
  successful_runs int not null default 0,
  failed_runs int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.ivx_agent_executions (
  task_id text primary key,
  run_id text not null,
  agent_id text not null,
  agent_number int not null,
  workflow text not null default 'ivx-autonomous-phase3',
  task_type text not null,
  final_status text not null default 'pending',
  real_tool_used boolean not null default false,
  tools_used jsonb not null default '[]'::jsonb,
  tool_result_id text,
  source_reference text,
  verified_output boolean not null default false,
  evidence jsonb,
  evidence_sha256 text,
  output jsonb,
  cost_usage jsonb not null default '{"usd":0}'::jsonb,
  error text,
  retry_count int not null default 0,
  duration_ms bigint not null default 0,
  dedup_key text,
  simulated boolean not null default false,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_ivx_agent_exec_run on public.ivx_agent_executions(run_id);
create unique index if not exists uq_ivx_agent_exec_dedup on public.ivx_agent_executions(dedup_key) where dedup_key is not null;

create table if not exists public.ivx_agent_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_type text not null,
  agent_id text,
  severity text not null default 'warning',
  detail text,
  created_at timestamptz not null default now()
);

create table if not exists public.ivx_agent_certificates (
  certificate_id text primary key,
  run_id text not null,
  workflow text not null,
  total_agents int not null,
  healthy int not null,
  real_execution_verified int not null,
  evidence_verified int not null,
  persistence_verified boolean not null,
  simulated_runs int not null,
  unique_agents int not null,
  passed boolean not null,
  commit_sha text,
  runtime_version text,
  policy_checks jsonb,
  e2e_tests jsonb,
  summary jsonb,
  certified_at timestamptz not null default now()
);

alter table public.ivx_agent_states enable row level security;
alter table public.ivx_agent_executions enable row level security;
alter table public.ivx_agent_alerts enable row level security;
alter table public.ivx_agent_certificates enable row level security;

revoke all on table public.ivx_agent_states from public, anon, authenticated;
revoke all on table public.ivx_agent_executions from public, anon, authenticated;
revoke all on table public.ivx_agent_alerts from public, anon, authenticated;
revoke all on table public.ivx_agent_certificates from public, anon, authenticated;

grant all on table public.ivx_agent_states to service_role;
grant all on table public.ivx_agent_executions to service_role;
grant all on table public.ivx_agent_alerts to service_role;
grant all on table public.ivx_agent_certificates to service_role;

select pg_notify('pgrst','reload schema');
commit;
