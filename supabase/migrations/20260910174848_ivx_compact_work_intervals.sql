-- Compact, private accounting projection; source evidence remains append-only.
-- Bootstrap uses bounded primary-key batches while the insert trigger captures new evidence.
set local lock_timeout = '1s';
set local statement_timeout = '20s';

create table public.ivx_work_evidence_intervals (
  agent_number smallint not null check (agent_number between 1 and 112),
  identity text not null,
  outcome text not null check (outcome in ('PASS','FAIL','BLOCKED')),
  started_at timestamptz not null check (isfinite(started_at)),
  completed_at timestamptz not null check (isfinite(completed_at)),
  productive_seconds numeric not null check (productive_seconds >= 0 and productive_seconds::text not in ('NaN','Infinity','-Infinity')),
  primary key (agent_number, identity),
  check (completed_at >= started_at and productive_seconds <= extract(epoch from completed_at-started_at))
);
create index ivx_work_evidence_intervals_end_idx
  on public.ivx_work_evidence_intervals(completed_at)
  include (agent_number,identity,outcome,started_at,productive_seconds);
alter table public.ivx_work_evidence_intervals enable row level security;
revoke all on public.ivx_work_evidence_intervals from public,anon,authenticated;
grant select,insert on public.ivx_work_evidence_intervals to service_role;
create trigger ivx_work_evidence_intervals_immutable before update or delete
  on public.ivx_work_evidence_intervals for each row execute function public.ivx_reject_evidence_mutation();

alter table public.ivx_work_evidence_archive_state
  add column projection_cursor_task text,
  add column projection_cursor_evidence text,
  add column projection_backfill_complete boolean not null default false;

create function public.ivx_capture_work_interval() returns trigger
language plpgsql security invoker set search_path='' as $$
declare m jsonb := new.measurement;
begin
  if m is not null and (m->>'agent')::integer = new.agent_number
    and (m->>'end')::timestamptz <= new.recorded_at + interval '5 seconds' then
    insert into public.ivx_work_evidence_intervals(agent_number,identity,outcome,started_at,completed_at,productive_seconds)
    values ((m->>'agent')::integer,m->>'identity',m->>'outcome',(m->>'start')::timestamptz,(m->>'end')::timestamptz,(m->>'seconds')::numeric)
    on conflict (agent_number,identity) do nothing;
  end if;
  return new;
end;
$$;
revoke execute on function public.ivx_capture_work_interval() from public,anon,authenticated;
create trigger ivx_capture_work_interval after insert on public.ivx_work_evidence_archive
  for each row execute function public.ivx_capture_work_interval();

-- Operator-only bootstrap; checkpoint and inserts commit together. Repeating a
-- batch after an ambiguous acknowledgement neither duplicates nor loses work.
create function public.ivx_backfill_work_intervals(p_limit integer default 5000) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  v_state public.ivx_work_evidence_archive_state%rowtype;
  v_read integer; v_inserted integer; v_last jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 5000 then raise exception 'Batch size must be between 1 and 5000'; end if;
  select * into v_state from public.ivx_work_evidence_archive_state where singleton for update;
  if not found then raise exception 'Archive state is missing'; end if;
  if v_state.projection_backfill_complete then return jsonb_build_object('complete',true,'read',0,'inserted',0); end if;
  with batch as materialized (
    select a.task_id,a.evidence_id,a.agent_number,a.recorded_at,a.measurement as m
    from public.ivx_work_evidence_archive a
    where (a.task_id,a.evidence_id) > (coalesce(v_state.projection_cursor_task,''),coalesce(v_state.projection_cursor_evidence,''))
    order by a.task_id,a.evidence_id limit p_limit
  ), inserted as (
    insert into public.ivx_work_evidence_intervals(agent_number,identity,outcome,started_at,completed_at,productive_seconds)
    select (m->>'agent')::integer,m->>'identity',m->>'outcome',(m->>'start')::timestamptz,(m->>'end')::timestamptz,(m->>'seconds')::numeric
    from batch where m is not null and (m->>'agent')::integer=agent_number
      and (m->>'end')::timestamptz <= recorded_at + interval '5 seconds'
    on conflict (agent_number,identity) do nothing returning 1
  )
  select (select count(*) from batch),(select count(*) from inserted),
    (select jsonb_build_object('task',task_id,'evidence',evidence_id) from batch order by task_id desc,evidence_id desc limit 1)
  into v_read,v_inserted,v_last;
  update public.ivx_work_evidence_archive_state set
    projection_cursor_task=coalesce(v_last->>'task',projection_cursor_task),
    projection_cursor_evidence=coalesce(v_last->>'evidence',projection_cursor_evidence),
    projection_backfill_complete=v_read < p_limit where singleton;
  return jsonb_build_object('complete',v_read < p_limit,'read',v_read,'inserted',v_inserted);
end;
$$;
revoke execute on function public.ivx_backfill_work_intervals(integer) from public,anon,authenticated,service_role;

create or replace function public.ivx_work_evidence_hours(p_from timestamptz,p_to timestamptz,p_target_hours numeric default 300)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_result jsonb; v_end timestamptz := least(p_to,statement_timestamp());
begin
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to)
    or v_end <= p_from or p_to-p_from > interval '7 days'
    or p_target_hours is null or p_target_hours < 0 or p_target_hours::text in ('NaN','Infinity','-Infinity') then
    raise exception 'A finite window of up to seven days and a nonnegative target are required';
  end if;
  if not coalesce((select projection_backfill_complete from public.ivx_work_evidence_archive_state where singleton),false) then
    raise exception 'Work evidence projection bootstrap is incomplete';
  end if;
  with valid as (
    select agent_number as agent,outcome,identity,
      greatest(started_at,p_from) as s,least(completed_at,v_end) as e,
      greatest(0,productive_seconds
        - greatest(0,extract(epoch from p_from-started_at))
        - greatest(0,extract(epoch from completed_at-v_end))) as seconds
    from public.ivx_work_evidence_intervals
    where completed_at > p_from and started_at < v_end
  ), ordered as (
    select *, max(e) over (partition by agent order by s,e,identity rows between unbounded preceding and 1 preceding) as previous_end
    from valid
  ), credited as (
    select *, greatest(0,least(seconds,extract(epoch from e-s)) - case when previous_end is null then 0
      else greatest(0,extract(epoch from least(e,previous_end)-s)) end) as credited_seconds
    from ordered
  ), agents as (
    select n as agent_number, count(c.agent) as observations,
      coalesce(sum(c.credited_seconds),0) as attempted_seconds,
      coalesce(sum(c.credited_seconds) filter(where c.outcome='PASS'),0) as passing_seconds,
      coalesce(sum(c.credited_seconds) filter(where c.outcome<>'PASS'),0) as nonpassing_seconds
    from generate_series(1,112) n left join credited c on c.agent=n group by n
  )
  select jsonb_build_object(
    'from',p_from,'to',v_end,'targetHours',p_target_hours,
    'scope','Persisted QA observations and technical audits; excludes coding jobs and other tool executions.',
    'archiveStartedAt',(select started_at from public.ivx_work_evidence_archive_state),
    'historicalEvidenceIncomplete',p_from < (select started_at from public.ivx_work_evidence_archive_state),
    'maximumFleetHours',extract(epoch from v_end-p_from)*112/3600,
    'attemptedHours',sum(attempted_seconds)/3600,
    'passingHours',sum(passing_seconds)/3600,
    'nonpassingHours',sum(nonpassing_seconds)/3600,
    'uncreditedHoursToTarget',greatest(0,p_target_hours-sum(passing_seconds)/3600),
    'targetEvidenced',sum(passing_seconds)/3600 >= p_target_hours,
    'agents',jsonb_agg(to_jsonb(agents) order by agent_number),
    'policy','Measured lower bound; idle, queued, future and duplicate time excluded. Overlaps and time outside the requested window are conservatively removed. Nonpassing work does not count as passing work.'
  ) into v_result from agents;
  return v_result;
end;
$$;
notify pgrst, 'reload schema';
