-- IVX bank-grade privacy hardening
-- Reproducible version of the production containment applied on 2026-08-20.
-- Fail closed: sensitive auth lookups and backend state are service-role only;
-- authenticated wallet operations are restricted to auth.uid().

BEGIN;

REVOKE ALL ON FUNCTION public.ivx_query_auth_user_by_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ivx_query_auth_user_by_email(text) FROM anon;
REVOKE ALL ON FUNCTION public.ivx_query_auth_user_by_email(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ivx_query_auth_user_by_email(text) TO service_role;
ALTER FUNCTION public.ivx_query_auth_user_by_email(text) SET search_path = public, auth, pg_temp;

REVOKE ALL ON FUNCTION public.ivx_exec_sql(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ivx_exec_sql(text) FROM anon;
REVOKE ALL ON FUNCTION public.ivx_exec_sql(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ivx_exec_sql(text) TO service_role;
ALTER FUNCTION public.ivx_exec_sql(text) SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.atomic_wallet_operation(
  p_user_id uuid,
  p_amount numeric,
  p_operation text,
  p_reason text,
  p_description text,
  p_reference_id text DEFAULT NULL,
  p_reference_type text DEFAULT NULL,
  p_fee numeric DEFAULT 0
)
RETURNS TABLE(success boolean, new_available numeric, new_invested numeric, new_total numeric, message text, transaction_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_wallet RECORD;
  v_new_available NUMERIC;
  v_new_invested NUMERIC;
  v_new_total NUMERIC;
  v_tx_id TEXT;
  v_direction TEXT;
  v_role TEXT := COALESCE(auth.role(), '');
  v_uid UUID := auth.uid();
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN QUERY SELECT false,0::NUMERIC,0::NUMERIC,0::NUMERIC,'Amount must be greater than zero'::TEXT,''::TEXT;
    RETURN;
  END IF;

  IF p_fee IS NULL OR p_fee < 0 OR p_fee > p_amount THEN
    RETURN QUERY SELECT false,0::NUMERIC,0::NUMERIC,0::NUMERIC,'Invalid fee'::TEXT,''::TEXT;
    RETURN;
  END IF;

  IF v_role <> 'service_role' AND (v_uid IS NULL OR v_uid IS DISTINCT FROM p_user_id) THEN
    RAISE EXCEPTION 'forbidden wallet operation' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.wallets (user_id,available,pending,invested,total,currency)
    VALUES (p_user_id,0,0,0,0,'USD');
    SELECT * INTO v_wallet FROM public.wallets WHERE user_id=p_user_id FOR UPDATE;
  END IF;

  IF p_operation='credit' THEN
    v_new_available:=COALESCE(v_wallet.available,0)+p_amount;
    v_new_invested:=COALESCE(v_wallet.invested,0);
    v_new_total:=COALESCE(v_wallet.total,0)+p_amount;
    v_direction:='credit';
  ELSIF p_operation='debit' THEN
    IF COALESCE(v_wallet.available,0)<p_amount THEN
      RETURN QUERY SELECT false,COALESCE(v_wallet.available,0)::NUMERIC,COALESCE(v_wallet.invested,0)::NUMERIC,COALESCE(v_wallet.total,0)::NUMERIC,'Insufficient balance'::TEXT,''::TEXT;
      RETURN;
    END IF;
    v_new_available:=COALESCE(v_wallet.available,0)-p_amount;
    v_new_invested:=CASE WHEN p_reason IN ('investment','resale_purchase') THEN COALESCE(v_wallet.invested,0)+p_amount ELSE COALESCE(v_wallet.invested,0) END;
    v_new_total:=v_new_available+v_new_invested;
    v_direction:='debit';
  ELSE
    RETURN QUERY SELECT false,0::NUMERIC,0::NUMERIC,0::NUMERIC,('Unknown operation: '||p_operation)::TEXT,''::TEXT;
    RETURN;
  END IF;

  UPDATE public.wallets
  SET available=v_new_available,invested=v_new_invested,total=v_new_total,updated_at=now()
  WHERE user_id=p_user_id;

  v_tx_id:='wtx_'||extract(epoch from now())::bigint||'_'||substr(md5(random()::text),1,8);
  INSERT INTO public.wallet_transactions (id,user_id,type,amount,direction,status,reference_id,reference_type,description,fee,net_amount)
  VALUES (v_tx_id,p_user_id,p_reason,p_amount,v_direction,'completed',p_reference_id,p_reference_type,p_description,p_fee,p_amount-p_fee);

  RETURN QUERY SELECT true,v_new_available,v_new_invested,v_new_total,'OK'::TEXT,v_tx_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.atomic_wallet_operation(uuid,numeric,text,text,text,text,text,numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.atomic_wallet_operation(uuid,numeric,text,text,text,text,text,numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.atomic_wallet_operation(uuid,numeric,text,text,text,text,text,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.atomic_wallet_operation(uuid,numeric,text,text,text,text,text,numeric) TO service_role;

ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investor_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_financial_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classification_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ivx_durable_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ivx_durable_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS members_all ON public.members;
DROP POLICY IF EXISTS ivx_durable_documents_all ON public.ivx_durable_documents;
DROP POLICY IF EXISTS ivx_durable_events_all ON public.ivx_durable_events;

REVOKE ALL ON TABLE public.members FROM anon;
REVOKE ALL ON TABLE public.members FROM authenticated;
REVOKE ALL ON TABLE public.investor_profiles FROM anon;
REVOKE ALL ON TABLE public.investor_profiles FROM authenticated;
REVOKE ALL ON TABLE public.member_financial_summary FROM anon;
REVOKE ALL ON TABLE public.member_financial_summary FROM authenticated;
REVOKE ALL ON TABLE public.classification_audit FROM anon;
REVOKE ALL ON TABLE public.classification_audit FROM authenticated;
REVOKE ALL ON TABLE public.ivx_durable_documents FROM anon;
REVOKE ALL ON TABLE public.ivx_durable_documents FROM authenticated;
REVOKE ALL ON TABLE public.ivx_durable_events FROM anon;
REVOKE ALL ON TABLE public.ivx_durable_events FROM authenticated;

GRANT ALL ON TABLE public.members TO service_role;
GRANT ALL ON TABLE public.investor_profiles TO service_role;
GRANT ALL ON TABLE public.member_financial_summary TO service_role;
GRANT ALL ON TABLE public.classification_audit TO service_role;
GRANT ALL ON TABLE public.ivx_durable_documents TO service_role;
GRANT ALL ON TABLE public.ivx_durable_events TO service_role;

COMMIT;
