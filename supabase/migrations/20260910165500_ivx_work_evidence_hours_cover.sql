-- Keep the existing private archive and accounting rules unchanged.
-- A covering index avoids random reads of the much larger raw evidence payload.
set local lock_timeout = '1s';
set local statement_timeout = '5s';
create index ivx_work_evidence_archive_hours_cover_idx
  on public.ivx_work_evidence_archive (((measurement->>'endEpoch')::numeric))
  include (agent_number, recorded_at, measurement)
  where measurement is not null;

create or replace function public.ivx_work_evidence_hours(p_from timestamptz,p_to timestamptz,p_target_hours numeric default 300)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_result jsonb; v_end timestamptz := least(p_to,statement_timestamp());
begin
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to)
    or v_end <= p_from or p_to-p_from > interval '7 days'
    or p_target_hours is null or p_target_hours < 0 or p_target_hours::text in ('NaN','Infinity','-Infinity') then
    raise exception 'A finite window of up to seven days and a nonnegative target are required';
  end if;
  with measured as materialized (
    select a.agent_number, a.recorded_at, a.measurement as m
    from public.ivx_work_evidence_archive a
    -- Backfilled rows are admitted by their measured interval, never insertion time.
    where a.measurement is not null
      and (a.measurement->>'endEpoch')::numeric > extract(epoch from p_from)
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
notify pgrst, 'reload schema';
