-- Shared monetary admission. No amount is inferred and enforcement is not
-- activated by this migration. Only backend service_role may call these RPCs.
create table public.ivx_ai_budget_policy (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  daily_limit_nano bigint check (daily_limit_nano > 0 and daily_limit_nano <= 1000000000000000),
  max_concurrent integer check (max_concurrent between 1 and 112),
  authorization_ref text,
  revision bigint not null default 1,
  updated_at timestamptz not null default clock_timestamp(),
  check (not enabled or (daily_limit_nano is not null and max_concurrent is not null and authorization_ref is not null and length(authorization_ref) > 0))
);
insert into public.ivx_ai_budget_policy(singleton) values (true);
create table public.ivx_ai_budget_days (
  day date primary key,
  settled_upper_nano bigint not null default 0 check (settled_upper_nano >= 0)
);
create table public.ivx_ai_budget_reservations (
  reservation_id uuid primary key,
  worker_instance_id text not null,
  model text not null,
  request_sha text not null,
  day date not null,
  policy_revision bigint not null,
  reserved_nano bigint not null check (reserved_nano > 0),
  status text not null default 'reserved' check (status in ('reserved','settled','uncertain','cancelled')),
  settled_upper_nano bigint check (settled_upper_nano >= 0),
  pricing_evidence jsonb not null,
  generation_id text,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz
);
create index ivx_ai_budget_open on public.ivx_ai_budget_reservations(status) where status in ('reserved','uncertain');
create index ivx_ai_budget_reservation_day on public.ivx_ai_budget_reservations(day,created_at);
alter table public.ivx_ai_budget_policy enable row level security;
alter table public.ivx_ai_budget_days enable row level security;
alter table public.ivx_ai_budget_reservations enable row level security;
revoke all on public.ivx_ai_budget_policy, public.ivx_ai_budget_days, public.ivx_ai_budget_reservations from public, anon, authenticated;
grant select,insert,update on public.ivx_ai_budget_policy, public.ivx_ai_budget_days, public.ivx_ai_budget_reservations to service_role;

create function public.ivx_ai_budget_reserve(p_reservation_id uuid, p_worker_instance_id text,
  p_model text, p_request_sha text, p_reserved_nano bigint, p_pricing_evidence jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  policy public.ivx_ai_budget_policy%rowtype;
  used bigint; liability numeric; active_count bigint;
  today date;
begin
  -- One short lock serializes admission and settlement across all replicas.
  select * into strict policy from public.ivx_ai_budget_policy where singleton for update;
  today := (clock_timestamp() at time zone 'UTC')::date;
  if not policy.enabled then return jsonb_build_object('allowed',false,'reason','budget_not_activated'); end if;
  if p_reservation_id is null or coalesce(length(p_worker_instance_id),0)=0 or length(p_worker_instance_id)>300
    or coalesce(length(p_model),0)=0 or length(p_model)>200
    or p_request_sha !~ '^[a-f0-9]{64}$' or p_request_sha is null
    or p_reserved_nano is null or p_reserved_nano<=0 or p_reserved_nano>1000000000000000
    or p_pricing_evidence is null or jsonb_typeof(p_pricing_evidence)<>'object'
    or not (p_pricing_evidence ? 'validUntil')
    or p_pricing_evidence->>'validUntil' is null
    or (p_pricing_evidence->>'validUntil')::timestamptz <= clock_timestamp()
    or (p_pricing_evidence->>'validUntil')::timestamptz > clock_timestamp()+interval '6 minutes'
    then raise exception 'Invalid budget reservation'; end if;
  if exists(select 1 from public.ivx_ai_budget_reservations where reservation_id=p_reservation_id) then
    return jsonb_build_object('allowed',false,'reason','reservation_already_exists');
  end if;
  select coalesce(sum(reserved_nano),0),count(*) filter(where status='reserved')
    into liability,active_count from public.ivx_ai_budget_reservations where status in ('reserved','uncertain');
  if active_count>=policy.max_concurrent then return jsonb_build_object('allowed',false,'reason','global_capacity_exceeded'); end if;
  select coalesce((select settled_upper_nano from public.ivx_ai_budget_days where day=today),0) into used;
  -- Unsettled liabilities carry across midnight; a restart or new day cannot
  -- silently refund work whose billing is still unknown.
  if used+liability+p_reserved_nano>policy.daily_limit_nano then
    return jsonb_build_object('allowed',false,'reason','global_daily_budget_exceeded');
  end if;
  insert into public.ivx_ai_budget_reservations(reservation_id,worker_instance_id,model,request_sha,day,policy_revision,reserved_nano,pricing_evidence)
    values(p_reservation_id,p_worker_instance_id,p_model,p_request_sha,today,policy.revision,p_reserved_nano,p_pricing_evidence);
  return jsonb_build_object('allowed',true,'reservationId',p_reservation_id,'reservedNano',p_reserved_nano::text,'policyRevision',policy.revision);
end;
$$;

create function public.ivx_ai_budget_finish(p_reservation_id uuid, p_worker_instance_id text,
  p_status text, p_settled_upper_nano bigint, p_generation_id text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.ivx_ai_budget_reservations%rowtype; breach boolean := false;
begin
  perform 1 from public.ivx_ai_budget_policy where singleton for update;
  select * into strict r from public.ivx_ai_budget_reservations where reservation_id=p_reservation_id for update;
  if r.worker_instance_id is distinct from p_worker_instance_id then raise exception 'Budget reservation owner mismatch'; end if;
  if p_status not in ('settled','uncertain','cancelled') or p_status is null
    or (p_status='settled' and (p_settled_upper_nano is null or p_settled_upper_nano<0))
    or (p_status='cancelled' and p_settled_upper_nano is distinct from 0::bigint)
    or (p_status='uncertain' and p_settled_upper_nano is not null)
    then raise exception 'Invalid budget settlement'; end if;
  if r.status<>'reserved' then
    if r.status=p_status and r.settled_upper_nano is not distinct from p_settled_upper_nano then
      return jsonb_build_object('ok',true,'duplicate',true,'status',r.status);
    end if;
    raise exception 'Budget settlement conflict';
  end if;
  if p_status='settled' then
    insert into public.ivx_ai_budget_days(day,settled_upper_nano) values((clock_timestamp() at time zone 'UTC')::date,p_settled_upper_nano)
      on conflict(day) do update set settled_upper_nano=public.ivx_ai_budget_days.settled_upper_nano+excluded.settled_upper_nano;
    breach := p_settled_upper_nano>r.reserved_nano;
    if breach then update public.ivx_ai_budget_policy set enabled=false,revision=revision+1,updated_at=clock_timestamp() where singleton; end if;
  end if;
  update public.ivx_ai_budget_reservations set status=p_status,settled_upper_nano=p_settled_upper_nano,
    generation_id=left(p_generation_id,200),completed_at=clock_timestamp() where reservation_id=p_reservation_id;
  return jsonb_build_object('ok',true,'status',p_status,'pricingBoundBreached',breach);
end;
$$;

create function public.ivx_ai_budget_status()
returns jsonb language sql security invoker set search_path = '' as $$
  select jsonb_build_object('scope','all_instrumented_backend_provider_requests','enabled',p.enabled,
    'day',(clock_timestamp() at time zone 'UTC')::date,'dailyLimitNano',p.daily_limit_nano::text,
    'maxConcurrent',p.max_concurrent,'policyRevision',p.revision,'authorizationRef',p.authorization_ref,
    'settledUpperNano',coalesce((select settled_upper_nano from public.ivx_ai_budget_days where day=(clock_timestamp() at time zone 'UTC')::date),0)::text,
    'unsettledLiabilityNano',coalesce((select sum(reserved_nano) from public.ivx_ai_budget_reservations where status in ('reserved','uncertain')),0)::text,
    'requestsActive',(select count(*) from public.ivx_ai_budget_reservations where status='reserved'),
    'unknownCharges',(select count(*) from public.ivx_ai_budget_reservations where status='uncertain'),
    'measuredAt',clock_timestamp(),'billingSemantics','conservative_upper_bounds_not_provider_invoice')
  from public.ivx_ai_budget_policy p where singleton;
$$;
revoke all on function public.ivx_ai_budget_reserve(uuid,text,text,text,bigint,jsonb),
  public.ivx_ai_budget_finish(uuid,text,text,bigint,text),public.ivx_ai_budget_status() from public,anon,authenticated;
grant execute on function public.ivx_ai_budget_reserve(uuid,text,text,text,bigint,jsonb),
  public.ivx_ai_budget_finish(uuid,text,text,bigint,text),public.ivx_ai_budget_status() to service_role;
