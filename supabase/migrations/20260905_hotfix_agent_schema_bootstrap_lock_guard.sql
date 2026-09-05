-- Prevent repeated runtime schema bootstrap DDL from taking AccessExclusiveLock
-- on the already-provisioned autonomous agent job tables.
--
-- Production incident 2026-09-05: multiple Render processes called ivx_exec_sql
-- with idempotent CREATE/ALTER/INDEX statements on every bootstrap. PostgreSQL
-- still needs heavyweight locks for those statements even when IF NOT EXISTS is
-- used, starving heartbeat/task traffic and causing Supabase REST timeouts.
--
-- The listed statements are safe no-ops because these tables/columns/indexes/
-- constraints are already part of the provisioned IVX schema. All unrelated
-- ivx_exec_sql calls retain their existing behavior.

create or replace function public.ivx_exec_sql(sql_text text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  normalized text := lower(regexp_replace(trim(sql_text), '\s+', ' ', 'g'));
begin
  if normalized like 'create table if not exists public.ivx_agent_jobs (%'
     or normalized like 'create table if not exists public.ivx_agent_job_logs (%'
     or normalized = 'alter table public.ivx_agent_jobs add column if not exists progress integer not null default 0'
     or normalized = 'alter table public.ivx_agent_jobs add column if not exists agent_name text'
     or normalized = 'alter table public.ivx_agent_jobs add column if not exists current_step text'
     or normalized = 'alter table public.ivx_agent_jobs add column if not exists chat_message text'
     or normalized = 'alter table public.ivx_agent_jobs add column if not exists eta_seconds integer'
     or normalized = 'alter table public.ivx_agent_jobs drop constraint if exists ivx_agent_jobs_status_check'
     or normalized like 'alter table public.ivx_agent_jobs add constraint ivx_agent_jobs_status_check check (%'
     or normalized = 'create index if not exists ivx_agent_jobs_status_next_run_idx on public.ivx_agent_jobs (status, next_run_at, created_at)'
     or normalized = 'create index if not exists ivx_agent_jobs_created_at_idx on public.ivx_agent_jobs (created_at desc)'
     or normalized = 'create index if not exists ivx_agent_job_logs_job_created_idx on public.ivx_agent_job_logs (job_id, created_at asc)'
     or normalized = 'alter table public.ivx_agent_jobs enable row level security'
     or normalized = 'alter table public.ivx_agent_job_logs enable row level security'
     or normalized like 'comment on table public.ivx_agent_jobs is %'
     or normalized like 'comment on table public.ivx_agent_job_logs is %'
  then
    return;
  end if;

  execute sql_text;
end;
$function$;
