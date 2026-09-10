-- Invalid or non-measuring proofs remain archived but never create hours.
create function public.ivx_work_evidence_measurement(p_evidence jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare
  v_summary text := p_evidence->>'summary'; v_record jsonb;
  v_start timestamptz; v_end timestamptz; v_seconds numeric; v_agent integer;
begin
  if starts_with(v_summary,'LANDING_P0_RESULT ') then
    v_record := substr(v_summary,length('LANDING_P0_RESULT ')+1)::jsonb;
  elsif starts_with(v_summary,'IVX_WORK_RESULT ') then
    v_record := substr(v_summary,length('IVX_WORK_RESULT ')+1)::jsonb;
  else return null; end if;
  v_start := (v_record->>'started_at')::timestamptz;
  v_end := (v_record->>'completed_at')::timestamptz;
  v_seconds := (v_record->>'productive_seconds')::numeric;
  v_agent := (v_record->>'agent_number')::integer;
  if v_start is null or v_end is null or not isfinite(v_start) or not isfinite(v_end)
    or v_end < v_start or v_agent is null or v_agent not between 1 and 112
    or v_seconds is null or v_seconds < 0 or v_seconds::text in ('NaN','Infinity','-Infinity')
    or coalesce(v_record->>'status','') not in ('PASS','FAIL','BLOCKED') then return null; end if;
  return jsonb_build_object('start',v_start,'end',v_end,'seconds',least(v_seconds,extract(epoch from v_end-v_start)),
    'agent',v_agent,'outcome',v_record->>'status','identity',md5(v_record::text),
    'startEpoch',extract(epoch from v_start),'endEpoch',extract(epoch from v_end));
exception when others then return null;
end;
$$;

-- Preserve proof in the same transaction as the fenced task update. Hot task
-- payloads may retain 24 observations; the audit archive must not rotate them.
create table public.ivx_work_evidence_archive (
  task_id text not null,
  evidence_id text not null,
  agent_number integer check (agent_number between 1 and 112),
  worker_instance_id text,
  evidence jsonb not null,
  measurement jsonb generated always as (public.ivx_work_evidence_measurement(evidence)) stored,
  recorded_at timestamptz not null default clock_timestamp(),
  backfilled boolean not null default false,
  primary key (task_id, evidence_id)
);
create index ivx_work_evidence_archive_recorded_idx on public.ivx_work_evidence_archive(recorded_at);
create index ivx_work_evidence_archive_end_idx on public.ivx_work_evidence_archive(((measurement->>'endEpoch')::numeric));
alter table public.ivx_work_evidence_archive enable row level security;
revoke all on public.ivx_work_evidence_archive from public, anon, authenticated;
grant select, insert on public.ivx_work_evidence_archive to service_role;

create table public.ivx_work_evidence_archive_state (
  singleton boolean primary key default true check (singleton),
  started_at timestamptz not null default clock_timestamp()
);
alter table public.ivx_work_evidence_archive_state enable row level security;
revoke all on public.ivx_work_evidence_archive_state from public, anon, authenticated;
grant select on public.ivx_work_evidence_archive_state to service_role;
insert into public.ivx_work_evidence_archive_state(singleton) values (true);

create function public.ivx_archive_task_evidence() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op = 'UPDATE' and new.payload->'evidence' is not distinct from old.payload->'evidence' then return new; end if;
  if jsonb_typeof(new.payload->'evidence') <> 'array' then return new; end if;
  insert into public.ivx_work_evidence_archive(task_id,evidence_id,agent_number,worker_instance_id,evidence)
  select new.task_id, proof->>'evidenceId', new.assigned_agent_number,
    coalesce(new.worker_instance_id,case when tg_op='UPDATE' then old.worker_instance_id end), proof
  from jsonb_array_elements(new.payload->'evidence') proof
  where nullif(proof->>'evidenceId','') is not null
  on conflict (task_id,evidence_id) do nothing;
  return new;
end;
$$;
create trigger ivx_archive_task_evidence after insert or update of payload
on public.ivx_autonomous_tasks for each row execute function public.ivx_archive_task_evidence();

-- Only surviving evidence can be backfilled. Earlier pruned work is unknown.
insert into public.ivx_work_evidence_archive(task_id,evidence_id,agent_number,worker_instance_id,evidence,backfilled)
select task.task_id, proof->>'evidenceId', task.assigned_agent_number, task.worker_instance_id, proof, true
from public.ivx_autonomous_tasks task
cross join lateral jsonb_array_elements(case when jsonb_typeof(task.payload->'evidence')='array' then task.payload->'evidence' else '[]'::jsonb end) proof
where nullif(proof->>'evidenceId','') is not null
on conflict (task_id,evidence_id) do nothing;

create function public.ivx_reject_evidence_mutation() returns trigger
language plpgsql security invoker set search_path='' as $$
begin raise exception 'Work evidence is append-only'; end;
$$;
create trigger ivx_work_evidence_immutable before update or delete
on public.ivx_work_evidence_archive for each row execute function public.ivx_reject_evidence_mutation();

create function public.ivx_work_evidence_hours(p_from timestamptz,p_to timestamptz,p_target_hours numeric default 300)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_result jsonb; v_end timestamptz := least(p_to,statement_timestamp());
begin
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to)
    or v_end <= p_from or p_to-p_from > interval '7 days'
    or p_target_hours is null or p_target_hours < 0 or p_target_hours::text in ('NaN','Infinity','-Infinity') then
    raise exception 'A finite window of up to seven days and a nonnegative target are required';
  end if;
  with measured as materialized (
    select a.*, a.measurement as m
    from public.ivx_work_evidence_archive a
    -- Backfilled rows are admitted by their measured interval, never insertion time.
    where (a.measurement->>'endEpoch')::numeric > extract(epoch from p_from)
  ), valid as (
    select distinct on (m->>'agent',m->>'identity')
      (m->>'agent')::integer as agent, m->>'outcome' as outcome, m->>'identity' as identity,
      greatest((m->>'start')::timestamptz,p_from) as s,
      least((m->>'end')::timestamptz,v_end) as e,
      greatest(0,(m->>'seconds')::numeric
        - greatest(0,extract(epoch from p_from-(m->>'start')::timestamptz))
        - greatest(0,extract(epoch from (m->>'end')::timestamptz-v_end))) as seconds
    from measured
    where m is not null and (m->>'agent')::integer=agent_number
      and (m->>'end')::timestamptz <= recorded_at + interval '5 seconds'
      and (m->>'start')::timestamptz < v_end and (m->>'end')::timestamptz > p_from
    order by m->>'agent',m->>'identity',recorded_at
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
revoke execute on function public.ivx_archive_task_evidence() from public, anon, authenticated;
revoke execute on function public.ivx_reject_evidence_mutation() from public, anon, authenticated;
revoke execute on function public.ivx_work_evidence_measurement(jsonb) from public, anon, authenticated;
revoke execute on function public.ivx_work_evidence_hours(timestamptz,timestamptz,numeric) from public, anon, authenticated;
grant execute on function public.ivx_work_evidence_measurement(jsonb) to service_role;
grant execute on function public.ivx_work_evidence_hours(timestamptz,timestamptz,numeric) to service_role;
notify pgrst, 'reload schema';
