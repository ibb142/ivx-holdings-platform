-- Consume authenticated provider evidence. Age alone never proves payment or QA.
-- The collector retrieves Gateway receipts with its authorized credential and
-- validates BYOK=false, amount aliases, termination, identity and timestamps.
-- Only reviewed collector revisions may supply documents to this reconciler.
create table public.ivx_ai_receipt_sources (
  source_sha text primary key check (source_sha ~ '^[a-f0-9]{40}$'),
  enabled boolean not null default true,
  approved_at timestamptz not null default clock_timestamp()
);
alter table public.ivx_ai_receipt_sources enable row level security;
revoke all on public.ivx_ai_receipt_sources from public, anon, authenticated, service_role;
grant select on public.ivx_ai_receipt_sources to service_role;
insert into public.ivx_ai_receipt_sources(source_sha)
  values ('ef429b20225fc01c84f6adc9e5f165291a95d389');

create table public.ivx_ai_finance_reconciliation_runs (
  run_id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null,
  finished_at timestamptz not null default clock_timestamp(),
  result jsonb not null
);
alter table public.ivx_ai_finance_reconciliation_runs enable row level security;
revoke all on public.ivx_ai_finance_reconciliation_runs from public, anon, authenticated, service_role;
grant select, insert on public.ivx_ai_finance_reconciliation_runs to service_role;

create function public.ivx_ai_validate_reconciliation_receipt(
  p_receipt jsonb, p_reservation public.ivx_ai_budget_reservations, p_document_key text
) returns bigint language plpgsql security invoker set search_path = '' as $$
declare
  fields text[] := array['reservationId','generationId','model','state','providerCostNano',
    'reservedNano','providerCreatedAt','ledgerCompletedAt','observedAt','promptTokens',
    'completionTokens','firstTokenMs','generationMs','marketCostNano','surchargeCostNano',
    'nativePromptTokens','nativeCompletionTokens','nativeReasoningTokens','nativeCachedTokens',
    'nativeCacheCreationTokens','billableWebSearchCalls','ledgerStatus','finishReason','cancelled'];
  required_fields text[] := array['reservationId','generationId','model','state','providerCostNano',
    'reservedNano','providerCreatedAt','ledgerCompletedAt','observedAt','promptTokens',
    'completionTokens','firstTokenMs','generationMs','ledgerStatus','finishReason',
    'source','sourceSha','providerReceiptSha256'];
  key text;
  canonical text;
  cost bigint;
begin
  if p_receipt is null or jsonb_typeof(p_receipt) <> 'object'
    or not (p_receipt ?& required_fields)
    or exists(select 1 from unnest(required_fields) f where p_receipt->f = 'null'::jsonb)
    or exists(select 1 from jsonb_object_keys(p_receipt) f
      where not (f = any(fields || array['source','sourceSha','providerReceiptSha256']))) then
    raise exception 'RECEIPT_SHAPE_INVALID' using errcode='22023';
  end if;
  if p_receipt->>'source' is distinct from 'https://ai-gateway.vercel.sh/v1/generation'
    or not exists(select 1 from public.ivx_ai_receipt_sources
      where source_sha=p_receipt->>'sourceSha' and enabled) then
    raise exception 'RECEIPT_SOURCE_UNAPPROVED' using errcode='22023';
  end if;
  if p_receipt->>'reservationId' is distinct from p_reservation.reservation_id::text
    or p_receipt->>'generationId' is distinct from p_reservation.generation_id
    or coalesce(p_reservation.generation_id,'') !~ '^gen_[0-9A-HJKMNP-TV-Z]{26}$'
    or p_receipt->>'model' is distinct from p_reservation.model
    or p_receipt->>'state' is distinct from 'PROVIDER_RECEIPT_OBSERVED'
    or p_receipt->>'ledgerStatus' is distinct from 'uncertain'
    or p_receipt->>'finishReason' not in ('stop','length','content_filter','tool_calls','function_call','error','cancelled')
    or (p_receipt ? 'cancelled' and jsonb_typeof(p_receipt->'cancelled') <> 'boolean')
    or p_receipt->>'providerReceiptSha256' !~ '^[a-f0-9]{64}$'
    or p_document_key is distinct from 'finance/provider-receipts/' || p_reservation.day::text
      || '/' || p_reservation.reservation_id::text || '/' || (p_receipt->>'providerReceiptSha256') || '.json' then
    raise exception 'RECEIPT_IDENTITY_MISMATCH' using errcode='22023';
  end if;
  foreach key in array array['providerCostNano','reservedNano','marketCostNano','surchargeCostNano'] loop
    if p_receipt ? key and (jsonb_typeof(p_receipt->key) <> 'string'
      or p_receipt->>key !~ '^[0-9]{1,16}$'
      or (p_receipt->>key)::numeric > 1000000000000000) then
      raise exception 'RECEIPT_AMOUNT_INVALID' using errcode='22023';
    end if;
  end loop;
  cost := (p_receipt->>'providerCostNano')::bigint;
  if (p_receipt->>'reservedNano')::bigint is distinct from p_reservation.reserved_nano
    or cost > p_reservation.reserved_nano then
    raise exception 'RECEIPT_BOUND_MISMATCH' using errcode='22023';
  end if;
  foreach key in array array['promptTokens','completionTokens','nativePromptTokens',
    'nativeCompletionTokens','nativeReasoningTokens','nativeCachedTokens',
    'nativeCacheCreationTokens','billableWebSearchCalls'] loop
    if p_receipt ? key and (jsonb_typeof(p_receipt->key) <> 'number'
      or p_receipt->>key !~ '^[0-9]{1,16}$' or (p_receipt->>key)::numeric > 9007199254740991) then
      raise exception 'RECEIPT_USAGE_INVALID' using errcode='22023';
    end if;
  end loop;
  foreach key in array array['firstTokenMs','generationMs'] loop
    if jsonb_typeof(p_receipt->key) <> 'number' or (p_receipt->>key)::numeric < 0 then
      raise exception 'RECEIPT_TIMING_INVALID' using errcode='22023';
    end if;
  end loop;
  if p_reservation.completed_at is null or p_reservation.completed_at < p_reservation.created_at
    or (p_receipt->>'ledgerCompletedAt')::timestamptz is distinct from p_reservation.completed_at
    or not ((p_receipt->>'providerCreatedAt')::timestamptz between
      p_reservation.created_at-interval '5 seconds' and p_reservation.completed_at+interval '5 seconds')
    or not ((p_receipt->>'observedAt')::timestamptz between p_reservation.completed_at and clock_timestamp()) then
    raise exception 'RECEIPT_TIME_MISMATCH' using errcode='22023';
  end if;
  -- Reproduce the allowlisted collector's JSON.stringify field order. Numeric
  -- renderings that cannot reproduce its digest remain pending for review.
  select '{' || string_agg(to_jsonb(f)::text || ':' || (p_receipt->f)::text, ',' order by ordinal) || '}'
    into canonical from unnest(fields) with ordinality as field(f,ordinal) where p_receipt ? f;
  if encode(sha256(convert_to(canonical,'UTF8')),'hex') is distinct from p_receipt->>'providerReceiptSha256' then
    raise exception 'RECEIPT_DIGEST_MISMATCH' using errcode='22023';
  end if;
  return cost;
end;
$$;

create function public.fn_autonomous_finance_depuration()
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  started timestamptz := clock_timestamp();
  ids uuid[];
  reservation_id_to_settle uuid;
  r public.ivx_ai_budget_reservations%rowtype;
  d record;
  docs jsonb;
  cost bigint;
  agreed_cost bigint;
  settled integer := 0;
  rejected integer := 0;
  scanned integer := 0;
  receipt_count integer;
  total_cost bigint := 0;
  total_released bigint := 0;
  audit_key text;
  reason text;
  errors jsonb := '[]'::jsonb;
  result jsonb;
  accounting_day date;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('ivx-verified-finance-reconciliation',0)) then
    return jsonb_build_object('state','BUSY','settled',0);
  end if;
  -- Select candidates before taking the admission lock; never call the network.
  -- Only rows with documents are candidates; missing evidence cannot monopolize
  -- the front of the queue. At most 25 reservations and 10 receipts each.
  select array_agg(c.reservation_id order by c.created_at,c.reservation_id) into ids from (
    select r0.reservation_id,r0.created_at from public.ivx_ai_budget_reservations r0
    where r0.status='uncertain' and r0.settled_upper_nano is null
      and r0.created_at < started-interval '15 minutes'
      and exists(select 1 from public.ivx_durable_documents doc
        where doc.doc_key >= 'finance/provider-receipts/' || r0.day::text || '/' || r0.reservation_id::text || '/'
          and doc.doc_key < 'finance/provider-receipts/' || r0.day::text || '/' || r0.reservation_id::text || '/~')
    order by r0.created_at,r0.reservation_id limit 25
  ) c;
  if ids is not null then
    -- Same lock/order as reserve and finish: do not race monetary admission.
    perform 1 from public.ivx_ai_budget_policy where singleton for update nowait;
    if not found then raise exception 'BUDGET_POLICY_MISSING'; end if;
    accounting_day := (clock_timestamp() at time zone 'UTC')::date;
    foreach reservation_id_to_settle in array ids loop
      select * into strict r from public.ivx_ai_budget_reservations
        where reservation_id=reservation_id_to_settle for update nowait;
      if r.status <> 'uncertain' or r.settled_upper_nano is not null then continue; end if;
      scanned := scanned+1;
      begin
        agreed_cost := null;
        receipt_count := 0;
        docs := '[]'::jsonb;
        for d in select doc_key,value from public.ivx_durable_documents
          where doc_key >= 'finance/provider-receipts/' || r.day::text || '/' || r.reservation_id::text || '/'
            and doc_key < 'finance/provider-receipts/' || r.day::text || '/' || r.reservation_id::text || '/~'
          order by doc_key limit 11 for share nowait loop
          receipt_count := receipt_count+1;
          if receipt_count > 10 then raise exception 'RECEIPT_REVIEW_LIMIT' using errcode='22023'; end if;
          cost := public.ivx_ai_validate_reconciliation_receipt(d.value,r,d.doc_key);
          if agreed_cost is not null and cost <> agreed_cost then
            raise exception 'RECEIPT_COST_CONFLICT' using errcode='22023';
          end if;
          agreed_cost := cost;
          docs := docs || jsonb_build_array(jsonb_build_object('documentKey',d.doc_key,
            'receiptSha256',d.value->>'providerReceiptSha256','sourceSha',d.value->>'sourceSha'));
        end loop;
        if agreed_cost is null then raise exception 'RECEIPT_MISSING' using errcode='22023'; end if;
        audit_key := 'finance/settlements/provider-receipts/' || r.reservation_id::text || '.json';
        if exists(select 1 from public.ivx_durable_documents where doc_key=audit_key) then
          raise exception 'SETTLEMENT_AUDIT_CONFLICT' using errcode='22023';
        end if;
        update public.ivx_ai_budget_reservations set status='settled',settled_upper_nano=agreed_cost,
          pricing_evidence=pricing_evidence || jsonb_build_object('receiptReconciliation',jsonb_build_object(
            'auditKey',audit_key,'accountingDay',accounting_day,'settledAt',clock_timestamp(),'receipts',docs))
          where reservation_id=r.reservation_id;
        -- Match the existing finish RPC: charge the current UTC admission day.
        -- Charging a historical reservation day would undercount today's budget.
        insert into public.ivx_ai_budget_days(day,settled_upper_nano) values(accounting_day,agreed_cost)
          on conflict(day) do update set settled_upper_nano=public.ivx_ai_budget_days.settled_upper_nano+excluded.settled_upper_nano;
        insert into public.ivx_durable_documents(doc_key,value,updated_at) values(audit_key,jsonb_build_object(
          'action','verified_provider_receipt_reconciliation','reservationId',r.reservation_id,
          'reservationDay',r.day,'accountingDay',accounting_day,'providerCostNano',agreed_cost::text,
          'previousLiabilityNano',r.reserved_nano::text,'receipts',docs,'settledAt',clock_timestamp()),clock_timestamp());
        settled := settled+1;
        total_cost := total_cost+agreed_cost;
        total_released := total_released+r.reserved_nano-agreed_cost;
      exception when sqlstate '22023' or invalid_text_representation or datetime_field_overflow
          or invalid_datetime_format or numeric_value_out_of_range then
        get stacked diagnostics reason = message_text;
        rejected := rejected+1;
        errors := errors || jsonb_build_array(jsonb_build_object('reservationId',r.reservation_id,
          'reason',case when reason ~ '^[A-Z_]{1,80}$' then reason else 'RECEIPT_FIELD_INVALID' end));
      end;
    end loop;
  end if;
  result := jsonb_build_object('state',case when rejected>0 then 'RECEIPTS_REJECTED'
      when settled>0 then 'VERIFIED_RECEIPTS_SETTLED' else 'NO_ELIGIBLE_RECEIPTS' end,
    'scanned',scanned,'settled',settled,'rejected',rejected,'providerCostNano',total_cost::text,
    'releasedLiabilityNano',total_released::text,'errors',errors,'agentCertificationsChanged',0,
    'providerLookupsPerformed',0,'fullReconciliationCertified',false);
  insert into public.ivx_ai_finance_reconciliation_runs(started_at,result) values(started,result);
  return result;
end;
$$;
revoke all on function public.ivx_ai_validate_reconciliation_receipt(jsonb,public.ivx_ai_budget_reservations,text),
  public.fn_autonomous_finance_depuration() from public,anon,authenticated;
grant execute on function public.ivx_ai_validate_reconciliation_receipt(jsonb,public.ivx_ai_budget_reservations,text),
  public.fn_autonomous_finance_depuration() to service_role;

-- SCHEDULING: tested separately from function behavior in local PostgreSQL.
create extension if not exists pg_cron with schema pg_catalog;
do $$
begin
  if exists(select 1 from cron.job where jobname='ivx-verified-finance-reconciliation') then
    raise exception 'Reconciliation cron already exists; inspect before changing it';
  end if;
  perform cron.schedule('ivx-verified-finance-reconciliation','*/5 * * * *',
    $job$begin; set local statement_timeout='10s'; set local lock_timeout='500ms'; set local jit=off;
    select public.fn_autonomous_finance_depuration(); commit;$job$);
end;
$$;
