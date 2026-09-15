-- Registration only. These tables do not provision worker processes, private
-- sandboxes, provider capacity or a second database. No production data moves.
create table public.factory_build_requests (
  request_id uuid primary key,
  owner_id text not null check (length(btrim(owner_id)) between 1 and 200),
  app_name text not null check (length(btrim(app_name)) between 1 and 120),
  days_to_complete integer not null check (days_to_complete between 10 and 30),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  target_deadline timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (request_id, app_name)
);

create table public.factory_tasks (
  task_id text primary key,
  request_id uuid not null,
  app_name text not null,
  component_type text not null check (component_type in ('DATABASE','BACKEND','FRONTEND','QA')),
  priority text not null check (priority in ('critical','high','normal')),
  state text not null default 'QUEUED' check (state in ('QUEUED','BUILDING','VERIFIED','FAILED')),
  version bigint not null default 1 check (version > 0),
  assigned_agent text,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload)='object'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (request_id, component_type),
  foreign key (request_id, app_name) references public.factory_build_requests(request_id, app_name)
);

-- Consumers must use this explicit priority expression and deterministic tie
-- breaker. Actual latency requires EXPLAIN/measurements on representative data.
create index idx_factory_tasks_queue_lookup
  on public.factory_tasks ((case priority when 'critical' then 1 when 'high' then 2 else 3 end), created_at, task_id)
  where state='QUEUED';

alter table public.factory_build_requests enable row level security;
alter table public.factory_tasks enable row level security;
revoke all on public.factory_build_requests, public.factory_tasks from public, anon, authenticated, service_role;
grant select, insert on public.factory_build_requests, public.factory_tasks to service_role;

comment on table public.factory_build_requests is 'Owner-scoped idempotent plan registration. A deadline is a target, not a delivery certificate.';
comment on table public.factory_tasks is 'Registered build tracks. Worker claim, leases, dependency enforcement and production certification require the native runtime bridge.';
