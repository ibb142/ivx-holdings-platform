-- Private accounting transition. Only the trusted verifier may submit attestations
-- obtained from authenticated GET /v1/generation. SQL cannot authenticate a receipt.
-- Install through the matching Supabase migration; do not run both copies.
create table public.ivx_ai_budget_reconciliation_receipts (
  reservation_id uuid primary key references public.ivx_ai_budget_reservations(reservation_id),
  generation_id text not null unique check (generation_id ~ '^gen_[0-9A-HJKMNP-TV-Z]{26}$'),
  provider_cost_nano bigint not null check (provider_cost_nano between 0 and 1000000000000000),
  receipt_sha256 text not null check (receipt_sha256 ~ '^[a-f0-9]{64}$'),
  provider_created_at timestamptz not null,
  observed_at timestamptz not null,
  reconciled_at timestamptz not null default clock_timestamp(),
  accounting_day date not null,
  verification_source text not null default 'authenticated_gateway_generation_lookup'
    check (verification_source = 'authenticated_gateway_generation_lookup')
);
alter table public.ivx_ai_budget_reconciliation_receipts enable row level security;
revoke all on public.ivx_ai_budget_reconciliation_receipts from public, anon, authenticated, service_role;
grant select, insert on public.ivx_ai_budget_reconciliation_receipts to service_role;

-- Fence reuse in ordinary finish calls as well as reconciliation. Existing
-- duplicate gateway IDs make the migration fail for review, never get deleted.
create unique index ivx_ai_budget_gateway_generation_once
  on public.ivx_ai_budget_reservations(generation_id)
  where generation_id ~ '^gen_[0-9A-HJKMNP-TV-Z]{26}$';

create function public.fn_reconcile_uncertain_budget_batch(p_batch_size integer, p_receipts jsonb)
returns table(reconciled_count integer, total_nano_reconciled bigint)
language plpgsql security invoker set search_path = '' set lock_timeout = '250ms' as $$
declare
  evidence record;
  target record;
  prior public.ivx_ai_budget_reconciliation_receipts%rowtype;
  n integer := 0;
  total bigint := 0;
  breach boolean := false;
  today date;
  observed timestamptz;
  provider_at timestamptz;
  cost bigint;
begin
  if p_batch_size is null or p_batch_size not between 1 and 112
    or p_receipts is null or jsonb_typeof(p_receipts) <> 'array'
    then raise exception 'Invalid reconciliation batch'; end if;
  if jsonb_array_length(p_receipts) not between 1 and p_batch_size
    then raise exception 'Invalid reconciliation batch'; end if;

  -- Validate the entire envelope before acquiring shared accounting locks.
  for evidence in select value as doc from jsonb_array_elements(p_receipts) loop
    if jsonb_typeof(evidence.doc) <> 'object'
      or coalesce(evidence.doc->>'reservation_id','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      or coalesce(evidence.doc->>'generation_id','') !~ '^gen_[0-9A-HJKMNP-TV-Z]{26}$'
      or coalesce(evidence.doc->>'request_sha','') !~ '^[a-f0-9]{64}$'
      or coalesce(evidence.doc->>'receipt_sha256','') !~ '^[a-f0-9]{64}$'
      or coalesce(length(evidence.doc->>'worker_instance_id'),0) not between 1 and 300
      or coalesce(length(evidence.doc->>'model'),0) not between 1 and 200
      or jsonb_typeof(evidence.doc->'provider_cost_nano') is distinct from 'string'
      or coalesce(evidence.doc->>'provider_cost_nano','') !~ '^(0|[1-9][0-9]{0,15})$'
      or (evidence.doc->>'provider_cost_nano')::numeric > 1000000000000000
      or coalesce(evidence.doc->>'provider_created_at','') = ''
      or coalesce(evidence.doc->>'observed_at','') = ''
      then raise exception 'Invalid receipt attestation'; end if;
    provider_at := (evidence.doc->>'provider_created_at')::timestamptz;
    observed := (evidence.doc->>'observed_at')::timestamptz;
    if not isfinite(provider_at) or not isfinite(observed) then
      raise exception 'Invalid receipt timestamp';
    end if;
  end loop;
  if (select count(distinct value->>'reservation_id') from jsonb_array_elements(p_receipts)) <> jsonb_array_length(p_receipts)
    or (select count(distinct value->>'generation_id') from jsonb_array_elements(p_receipts)) <> jsonb_array_length(p_receipts)
    then raise exception 'Duplicate receipt identity in batch'; end if;

  -- Same lock order as reserve/finish. Contention yields no changes, not 55P03.
  perform 1 from public.ivx_ai_budget_policy where singleton for update skip locked;
  if not found then return query select 0, 0::bigint; return; end if;
  today := (clock_timestamp() at time zone 'UTC')::date;
  if (select count(*) from public.ivx_ai_budget_reservations r
      join jsonb_array_elements(p_receipts) e on r.reservation_id = (e.value->>'reservation_id')::uuid)
      <> jsonb_array_length(p_receipts) then raise exception 'Reservation not found'; end if;

  for target in
    select r.*, e.value as doc
    from public.ivx_ai_budget_reservations r
    join jsonb_array_elements(p_receipts) e on r.reservation_id = (e.value->>'reservation_id')::uuid
    order by r.reservation_id
    for update of r skip locked
  loop
    if target.generation_id is null or btrim(target.generation_id) = '' then
      raise exception 'Missing provider identity; external linkage recovery required';
    end if;
    if target.generation_id is distinct from target.doc->>'generation_id'
      or target.model is distinct from target.doc->>'model'
      or target.worker_instance_id is distinct from target.doc->>'worker_instance_id'
      or target.request_sha is distinct from target.doc->>'request_sha'
      then raise exception 'Receipt reservation identity mismatch'; end if;
    cost := (target.doc->>'provider_cost_nano')::bigint;
    provider_at := (target.doc->>'provider_created_at')::timestamptz;
    observed := (target.doc->>'observed_at')::timestamptz;

    select * into prior from public.ivx_ai_budget_reconciliation_receipts
      where reservation_id = target.reservation_id;
    if found then
      if target.status <> 'settled' or target.settled_upper_nano is distinct from cost
        or prior.generation_id <> target.generation_id or prior.provider_cost_nano <> cost
        or prior.receipt_sha256 <> target.doc->>'receipt_sha256'
        or prior.provider_created_at <> provider_at
        then raise exception 'Reconciliation retry conflict'; end if;
      continue; -- Lost acknowledgement: one receipt, one accounting entry.
    end if;
    if target.status <> 'uncertain' or target.settled_upper_nano is not null then
      raise exception 'Reservation is not an uncertain charge';
    end if;
    if target.completed_at is null or target.completed_at < target.created_at
      or target.completed_at > observed
      or provider_at < target.created_at - interval '5 seconds'
      or provider_at > target.completed_at + interval '5 seconds'
      or provider_at > observed
      or observed < clock_timestamp() - interval '5 minutes'
      or observed > clock_timestamp() + interval '5 seconds'
      then raise exception 'Receipt request window mismatch'; end if;

    insert into public.ivx_ai_budget_reconciliation_receipts(
      reservation_id,generation_id,provider_cost_nano,receipt_sha256,provider_created_at,observed_at,accounting_day)
    values(target.reservation_id,target.generation_id,cost,target.doc->>'receipt_sha256',provider_at,observed,today);
    update public.ivx_ai_budget_reservations
      set status = 'settled', settled_upper_nano = cost
      where reservation_id = target.reservation_id;
    -- Preserve completed_at as the original provider request window.
    n := n + 1;
    total := total + cost;
    breach := breach or cost > target.reserved_nano;
  end loop;

  if n > 0 then
    -- Uncertain liabilities carry over midnight; book the actual charge on
    -- the reconciliation UTC day, consistently with ivx_ai_budget_finish.
    insert into public.ivx_ai_budget_days(day,settled_upper_nano) values(today,total)
      on conflict(day) do update
      set settled_upper_nano = public.ivx_ai_budget_days.settled_upper_nano + excluded.settled_upper_nano;
  end if;
  if breach then
    update public.ivx_ai_budget_policy set enabled = false, revision = revision + 1,
      updated_at = clock_timestamp() where singleton;
  end if;
  return query select n, total;
end;
$$;
revoke all on function public.fn_reconcile_uncertain_budget_batch(integer,jsonb) from public, anon, authenticated;
grant execute on function public.fn_reconcile_uncertain_budget_batch(integer,jsonb) to service_role;
comment on function public.fn_reconcile_uncertain_budget_batch(integer,jsonb) is
  'Private verified-receipt transition; never accepts a shared receipt for a cohort. Set statement_timeout before the outer RPC statement. Zero rows can mean lock contention; confirm receipt rows before declaring success.';
