-- Locale-independent receipt lookup. Production en_US.UTF-8 sorts tilde before
-- receipt hashes; ordinary text ranges can silently exclude every valid receipt.
-- Pattern operators and this index compare bytes, including under non-C locales.
set local lock_timeout = '500ms';
create index if not exists ivx_durable_documents_key_prefix_idx
  on public.ivx_durable_documents (doc_key text_pattern_ops);

create or replace function public.fn_autonomous_finance_depuration()
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
        where doc.doc_key ~>=~ ('finance/provider-receipts/' || r0.day::text || '/' || r0.reservation_id::text || '/')
          and doc.doc_key ~<~ ('finance/provider-receipts/' || r0.day::text || '/' || r0.reservation_id::text || '/~'))
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
          where doc_key ~>=~ ('finance/provider-receipts/' || r.day::text || '/' || r.reservation_id::text || '/')
            and doc_key ~<~ ('finance/provider-receipts/' || r.day::text || '/' || r.reservation_id::text || '/~')
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
