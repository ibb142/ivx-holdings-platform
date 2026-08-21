-- IVX bank-grade privacy and financial-integrity hardening
-- Reproducible version of the production containment applied on 2026-08-20.
-- Clients may read only their own permitted records and submit pending intents.
-- Identity, KYC, balances, ledger entries and settled financial status are backend-write-only.

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
BEGIN
  IF v_role <> 'service_role' THEN
    RAISE EXCEPTION 'service-role settlement required' USING ERRCODE = '42501';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN QUERY SELECT false,0::NUMERIC,0::NUMERIC,0::NUMERIC,'Amount must be greater than zero'::TEXT,''::TEXT;
    RETURN;
  END IF;

  IF p_fee IS NULL OR p_fee < 0 OR p_fee > p_amount THEN
    RETURN QUERY SELECT false,0::NUMERIC,0::NUMERIC,0::NUMERIC,'Invalid fee'::TEXT,''::TEXT;
    RETURN;
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
REVOKE ALL ON FUNCTION public.atomic_wallet_operation(uuid,numeric,text,text,text,text,text,numeric) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.atomic_wallet_operation(uuid,numeric,text,text,text,text,text,numeric) TO service_role;

ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investor_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_financial_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classification_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ivx_durable_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ivx_durable_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landing_investments ENABLE ROW LEVEL SECURITY;

-- Remove permissive historical policies.
DROP POLICY IF EXISTS members_all ON public.members;
DROP POLICY IF EXISTS ivx_durable_documents_all ON public.ivx_durable_documents;
DROP POLICY IF EXISTS ivx_durable_events_all ON public.ivx_durable_events;
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
DROP POLICY IF EXISTS profiles_select_owner_self ON public.profiles;
DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
DROP POLICY IF EXISTS profiles_insert_self ON public.profiles;
DROP POLICY IF EXISTS profiles_update_self ON public.profiles;
DROP POLICY IF EXISTS "...tmp" ON public.wallets;
DROP POLICY IF EXISTS wallets_admin_all ON public.wallets;
DROP POLICY IF EXISTS "owner full access" ON public.wallets;
DROP POLICY IF EXISTS wallets_delete_own ON public.wallets;
DROP POLICY IF EXISTS wallets_insert_own ON public.wallets;
DROP POLICY IF EXISTS wallets_update_own ON public.wallets;
DROP POLICY IF EXISTS wallet_transactions_all ON public.wallet_transactions;
DROP POLICY IF EXISTS wtx_select_own ON public.wallet_transactions;
DROP POLICY IF EXISTS wtx_insert_auth ON public.wallet_transactions;
DROP POLICY IF EXISTS transactions_insert_auth ON public.transactions;
DROP POLICY IF EXISTS transactions_insert_own ON public.transactions;
DROP POLICY IF EXISTS "Authenticated users can insert investments" ON public.landing_investments;
DROP POLICY IF EXISTS "Authenticated users can update own investments" ON public.landing_investments;
DROP POLICY IF EXISTS "Authenticated users can delete own investments" ON public.landing_investments;
DROP POLICY IF EXISTS landing_investments_insert_self ON public.landing_investments;

-- Canonical financial/member stores: no direct client access.
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

-- Public/member profile: read own row only; no client writes to role/KYC/totals/VIP fields.
REVOKE ALL ON TABLE public.profiles FROM anon;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON TABLE public.profiles FROM authenticated;
GRANT SELECT ON TABLE public.profiles TO authenticated;
DROP POLICY IF EXISTS profiles_self_read ON public.profiles;
CREATE POLICY profiles_self_read ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());

-- Wallet and ledger: member clients can read their own rows but cannot mutate money or history.
REVOKE ALL ON TABLE public.wallets FROM anon;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON TABLE public.wallets FROM authenticated;
GRANT SELECT ON TABLE public.wallets TO authenticated;
DROP POLICY IF EXISTS "Users can access their own rows" ON public.wallets;
DROP POLICY IF EXISTS wallets_select_own ON public.wallets;
CREATE POLICY wallets_select_self ON public.wallets
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON TABLE public.wallet_transactions FROM anon;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON TABLE public.wallet_transactions FROM authenticated;
GRANT SELECT ON TABLE public.wallet_transactions TO authenticated;
CREATE POLICY wallet_transactions_select_self ON public.wallet_transactions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON TABLE public.transactions FROM anon;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON TABLE public.transactions FROM authenticated;
GRANT SELECT ON TABLE public.transactions TO authenticated;
DROP POLICY IF EXISTS transactions_select_own ON public.transactions;
CREATE POLICY transactions_select_self ON public.transactions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Landing investment intent may be submitted by the member, but it can only start
-- pending and cannot be confirmed/edited/deleted by the member client.
REVOKE ALL ON TABLE public.landing_investments FROM anon;
REVOKE UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON TABLE public.landing_investments FROM authenticated;
GRANT SELECT,INSERT ON TABLE public.landing_investments TO authenticated;
DROP POLICY IF EXISTS "Authenticated users can read own investments" ON public.landing_investments;
CREATE POLICY landing_investments_select_self ON public.landing_investments
  FOR SELECT TO authenticated
  USING ((investor_id = auth.uid()) OR (investor_email = auth.email()));
CREATE POLICY landing_investments_insert_self ON public.landing_investments
  FOR INSERT TO authenticated
  WITH CHECK (
    ((investor_id = auth.uid()) OR (investor_email = auth.email()))
    AND status = 'pending_payment'
    AND deleted_at IS NULL
  );

COMMIT;
