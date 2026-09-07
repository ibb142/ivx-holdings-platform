-- Canonical, fail-closed time integrity for the IVX 112-agent execution ledger.
-- Heartbeats never create work hours. Only closed timestamp spans are measured.

begin;

-- Historical pending/running rows older than the runtime timeout are not work.
-- Preserve every row and its evidence, but close the unknown span at zero time.
update public.ivx_agent_executions
set final_status = 'blocked',
    started_at = coalesce(started_at, created_at, now()),
    finished_at = coalesce(started_at, created_at, now()),
    duration_ms = 0,
    verified_output = false,
    error = concat_ws(' | ', nullif(error, ''), 'TIME_INTEGRITY: stale active execution closed fail-closed; productive time not credited')
where final_status in ('pending', 'running')
  and coalesce(started_at, created_at, now()) < now() - interval '30 minutes';

-- Close impossible terminal-looking active rows without granting time.
update public.ivx_agent_executions
set final_status = 'blocked',
    started_at = least(started_at, finished_at),
    finished_at = least(started_at, finished_at),
    duration_ms = 0,
    verified_output = false,
    error = concat_ws(' | ', nullif(error, ''), 'TIME_INTEGRITY: invalid active timestamps closed fail-closed; productive time not credited')
where final_status in ('pending', 'running')
  and finished_at is not null;

create or replace function public.ivx_agent_execution_time_integrity()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.agent_number < 1 or new.agent_number > 112 then
    raise exception 'agent_number must be between 1 and 112';
  end if;

  if new.final_status = 'pending' then
    new.started_at := null;
    new.finished_at := null;
    new.duration_ms := 0;
  elsif new.final_status = 'running' then
    new.started_at := coalesce(new.started_at, now());
    new.finished_at := null;
    new.duration_ms := 0;
  elsif new.final_status in ('completed', 'failed', 'blocked') then
    new.started_at := coalesce(new.started_at, new.created_at, now());
    new.finished_at := coalesce(new.finished_at, new.started_at);
    if new.finished_at < new.started_at then
      new.final_status := 'blocked';
      new.finished_at := new.started_at;
      new.verified_output := false;
      new.error := concat_ws(' | ', nullif(new.error, ''), 'TIME_INTEGRITY: finished_at preceded started_at');
    end if;
    new.duration_ms := greatest(0, floor(extract(epoch from (new.finished_at - new.started_at)) * 1000)::bigint);
  else
    raise exception 'unsupported final_status: %', new.final_status;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ivx_agent_execution_time_integrity on public.ivx_agent_executions;
create trigger trg_ivx_agent_execution_time_integrity
before insert or update on public.ivx_agent_executions
for each row execute function public.ivx_agent_execution_time_integrity();

create index if not exists idx_ivx_agent_exec_status_started
  on public.ivx_agent_executions (final_status, started_at desc);

-- One logical agent cannot honestly execute two tasks at the same instant.
create unique index if not exists uq_ivx_agent_one_active_execution
  on public.ivx_agent_executions (agent_id)
  where final_status in ('pending', 'running');

revoke execute on function public.ivx_agent_execution_time_integrity() from public, anon, authenticated;
grant execute on function public.ivx_agent_execution_time_integrity() to service_role;

commit;
