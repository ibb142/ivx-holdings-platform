-- ============================================================
-- IVX COMPLETE SUPABASE SCHEMA — MASTER DEPLOY SCRIPT
-- ============================================================
-- Run this ONCE in Supabase SQL Editor (supabase.com → SQL Editor → New Query)
-- Safe to re-run: uses CREATE IF NOT EXISTS and DO blocks
-- Creates ALL tables, RLS policies, indexes, triggers, RPC functions, and storage buckets
-- ============================================================

-- ============================================================
-- 0. BOOTSTRAP: Auto-deploy helper function
-- ============================================================
DROP FUNCTION IF EXISTS public.ivx_exec_sql(text);
CREATE OR REPLACE FUNCTION ivx_exec_sql(sql_text TEXT) RETURNS VOID AS $fn$ BEGIN EXECUTE sql_text; END; $fn$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 1. CORE USER TABLES
-- ============================================================

-- 1a. profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  country TEXT,
  avatar TEXT,
  kyc_status TEXT DEFAULT 'pending',
  total_invested NUMERIC DEFAULT 0,
  total_returns NUMERIC DEFAULT 0,
  role TEXT DEFAULT 'investor',
  referral_code TEXT,
  vip_tier TEXT DEFAULT 'standard',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='profiles_select_own') THEN
    CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='profiles_insert_own') THEN
    CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid()=id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='profiles_update_own') THEN
    CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 1b. wallets
CREATE TABLE IF NOT EXISTS public.wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  available NUMERIC DEFAULT 0,
  pending NUMERIC DEFAULT 0,
  invested NUMERIC DEFAULT 0,
  total NUMERIC DEFAULT 0,
  currency TEXT DEFAULT 'USD',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='wallets_select_own') THEN
    CREATE POLICY "wallets_select_own" ON public.wallets FOR SELECT TO authenticated USING (auth.uid()=user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='wallets_insert_own') THEN
    CREATE POLICY "wallets_insert_own" ON public.wallets FOR INSERT TO authenticated WITH CHECK (auth.uid()=user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='wallets_update_own') THEN
    CREATE POLICY "wallets_update_own" ON public.wallets FOR UPDATE TO authenticated USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='wallets_admin_all') THEN
    CREATE POLICY "wallets_admin_all" ON public.wallets FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_wallets_user ON public.wallets(user_id);
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.wallets; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 1c. wallet_transactions
CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id TEXT PRIMARY KEY,
  wallet_id UUID,
  user_id UUID NOT NULL,
  type TEXT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  direction TEXT NOT NULL DEFAULT 'credit',
  status TEXT NOT NULL DEFAULT 'pending',
  reference_id TEXT,
  reference_type TEXT,
  description TEXT,
  fee NUMERIC DEFAULT 0,
  net_amount NUMERIC DEFAULT 0,
  payment_method TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT wtx_direction_check CHECK (direction IN ('credit','debit')),
  CONSTRAINT wtx_status_check CHECK (status IN ('pending','completed','failed','cancelled'))
);
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='wtx_select_own') THEN
    CREATE POLICY "wtx_select_own" ON public.wallet_transactions FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='wtx_insert_auth') THEN
    CREATE POLICY "wtx_insert_auth" ON public.wallet_transactions FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_wtx_user ON public.wallet_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_wtx_created ON public.wallet_transactions(created_at DESC);
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.wallet_transactions; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2. PROPERTY & INVESTMENT TABLES
-- ============================================================

-- 2a. properties
CREATE TABLE IF NOT EXISTS public.properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  location TEXT,
  city TEXT,
  country TEXT,
  image TEXT,
  share_price NUMERIC DEFAULT 0,
  total_shares INTEGER DEFAULT 1000,
  available_shares INTEGER DEFAULT 1000,
  annual_yield NUMERIC DEFAULT 0,
  occupancy_rate NUMERIC DEFAULT 0,
  type TEXT DEFAULT 'residential',
  status TEXT DEFAULT 'active',
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='properties_select_all') THEN
    CREATE POLICY "properties_select_all" ON public.properties FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='properties_insert_auth') THEN
    CREATE POLICY "properties_insert_auth" ON public.properties FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='properties_update_auth') THEN
    CREATE POLICY "properties_update_auth" ON public.properties FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_properties_status ON public.properties(status);
CREATE INDEX IF NOT EXISTS idx_properties_created ON public.properties(created_at DESC);
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.properties; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2b. holdings
CREATE TABLE IF NOT EXISTS public.holdings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  property_id UUID,
  shares INTEGER DEFAULT 0,
  avg_cost_basis NUMERIC DEFAULT 0,
  current_value NUMERIC DEFAULT 0,
  total_return NUMERIC DEFAULT 0,
  total_return_percent NUMERIC DEFAULT 0,
  unrealized_pnl NUMERIC DEFAULT 0,
  unrealized_pnl_percent NUMERIC DEFAULT 0,
  purchase_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.holdings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='holdings_select_own') THEN
    CREATE POLICY "holdings_select_own" ON public.holdings FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='holdings_insert_auth') THEN
    CREATE POLICY "holdings_insert_auth" ON public.holdings FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='holdings_update_auth') THEN
    CREATE POLICY "holdings_update_auth" ON public.holdings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='holdings_delete_auth') THEN
    CREATE POLICY "holdings_delete_auth" ON public.holdings FOR DELETE TO authenticated USING (true);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_holdings_user ON public.holdings(user_id);
CREATE INDEX IF NOT EXISTS idx_holdings_property ON public.holdings(property_id);
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.holdings; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2c. transactions
CREATE TABLE IF NOT EXISTS public.transactions (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL,
  type TEXT NOT NULL,
  amount NUMERIC DEFAULT 0,
  currency TEXT DEFAULT 'USD',
  status TEXT DEFAULT 'pending',
  description TEXT,
  property_id UUID,
  property_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='transactions_select_own') THEN
    CREATE POLICY "transactions_select_own" ON public.transactions FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='transactions_insert_auth') THEN
    CREATE POLICY "transactions_insert_auth" ON public.transactions FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_transactions_user ON public.transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created ON public.transactions(created_at DESC);
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2d. orders
CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  property_id UUID,
  type TEXT NOT NULL DEFAULT 'buy',
  shares INTEGER DEFAULT 0,
  price_per_share NUMERIC DEFAULT 0,
  total_amount NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'pending',
  filled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='orders_select_auth') THEN
    CREATE POLICY "orders_select_auth" ON public.orders FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='orders_insert_auth') THEN
    CREATE POLICY "orders_insert_auth" ON public.orders FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='orders_update_auth') THEN
    CREATE POLICY "orders_update_auth" ON public.orders FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_orders_user ON public.orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_created ON public.orders(created_at DESC);

-- 2e. market_data
CREATE TABLE IF NOT EXISTS public.market_data (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  metric TEXT,
  value NUMERIC DEFAULT 0,
  change_percent NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.market_data ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='market_data_select_all') THEN
    CREATE POLICY "market_data_select_all" ON public.market_data FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='market_data_insert_auth') THEN
    CREATE POLICY "market_data_insert_auth" ON public.market_data FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='market_data_update_auth') THEN
    CREATE POLICY "market_data_update_auth" ON public.market_data FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 2f. market_index
CREATE TABLE IF NOT EXISTS public.market_index (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  index_name TEXT,
  value NUMERIC DEFAULT 0,
  change_percent NUMERIC DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.market_index ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='market_index_select_all') THEN
    CREATE POLICY "market_index_select_all" ON public.market_index FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='market_index_auth_write') THEN
    CREATE POLICY "market_index_auth_write" ON public.market_index FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- 3. JV DEALS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.jv_deals (
  id TEXT PRIMARY KEY,
  title TEXT,
  project_name TEXT,
  type TEXT DEFAULT 'jv',
  description TEXT,
  partner_name TEXT,
  partner_email TEXT,
  partner_phone TEXT,
  partner_type TEXT,
  property_address TEXT,
  city TEXT,
  state TEXT,
  zip_code TEXT,
  country TEXT,
  lot_size NUMERIC,
  lot_size_unit TEXT DEFAULT 'sqft',
  zoning TEXT,
  property_type TEXT,
  total_investment NUMERIC DEFAULT 0,
  expected_roi NUMERIC DEFAULT 0,
  estimated_value NUMERIC DEFAULT 0,
  appraised_value NUMERIC DEFAULT 0,
  sale_price NUMERIC DEFAULT 0,
  cash_payment_percent NUMERIC DEFAULT 0,
  collateral_percent NUMERIC DEFAULT 0,
  partner_profit_share NUMERIC DEFAULT 0,
  developer_profit_share NUMERIC DEFAULT 0,
  term_months INTEGER DEFAULT 12,
  cash_payment_amount NUMERIC DEFAULT 0,
  collateral_amount NUMERIC DEFAULT 0,
  distribution_frequency TEXT DEFAULT 'quarterly',
  exit_strategy TEXT,
  partners JSONB DEFAULT '[]'::jsonb,
  pool_tiers JSONB DEFAULT '{}'::jsonb,
  status TEXT DEFAULT 'draft',
  published BOOLEAN DEFAULT false,
  published_at TIMESTAMPTZ,
  photos JSONB DEFAULT '[]'::jsonb,
  documents TEXT,
  notes TEXT,
  rejection_reason TEXT,
  control_disclosure_accepted BOOLEAN DEFAULT false,
  control_disclosure_accepted_at TIMESTAMPTZ,
  payment_structure TEXT,
  user_id UUID,
  currency TEXT DEFAULT 'USD',
  profit_split TEXT,
  start_date TEXT,
  end_date TEXT,
  trashed_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.jv_deals ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='jv_deals_select_all') THEN
    CREATE POLICY "jv_deals_select_all" ON public.jv_deals FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='jv_deals_insert_auth') THEN
    CREATE POLICY "jv_deals_insert_auth" ON public.jv_deals FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='jv_deals_update_auth') THEN
    CREATE POLICY "jv_deals_update_auth" ON public.jv_deals FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='jv_deals_delete_auth') THEN
    CREATE POLICY "jv_deals_delete_auth" ON public.jv_deals FOR DELETE TO authenticated USING (true);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_jv_deals_status ON public.jv_deals(status);
CREATE INDEX IF NOT EXISTS idx_jv_deals_published ON public.jv_deals(published);
CREATE INDEX IF NOT EXISTS idx_jv_deals_created ON public.jv_deals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jv_deals_user ON public.jv_deals(user_id);
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.jv_deals; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 4. LANDING & WAITLIST TABLES
-- ============================================================

-- 4a. landing_deals
CREATE TABLE IF NOT EXISTS public.landing_deals (
  id TEXT PRIMARY KEY,
  title TEXT,
  project_name TEXT,
  description TEXT,
  property_address TEXT,
  city TEXT,
  state TEXT,
  country TEXT,
  property_type TEXT,
  total_investment NUMERIC DEFAULT 0,
  expected_roi NUMERIC DEFAULT 0,
  sale_price NUMERIC DEFAULT 0,
  estimated_value NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'active',
  photos JSONB DEFAULT '[]'::jsonb,
  partner_name TEXT,
  developer_name TEXT,
  published BOOLEAN DEFAULT true,
  published_at TIMESTAMPTZ,
  source_deal_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.landing_deals ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='landing_deals_select_all') THEN
    CREATE POLICY "landing_deals_select_all" ON public.landing_deals FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='landing_deals_insert_auth') THEN
    CREATE POLICY "landing_deals_insert_auth" ON public.landing_deals FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='landing_deals_update_auth') THEN
    CREATE POLICY "landing_deals_update_auth" ON public.landing_deals FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='landing_deals_delete_auth') THEN
    CREATE POLICY "landing_deals_delete_auth" ON public.landing_deals FOR DELETE TO authenticated USING (true);
  END IF;
END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.landing_deals; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4b. waitlist (simple legacy)
CREATE TABLE IF NOT EXISTS public.waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name TEXT,
  last_name TEXT,
  email TEXT NOT NULL,
  phone TEXT,
  goal TEXT,
  investment_range TEXT,
  return_expectation TEXT,
  preferred_contact_hour TEXT,
  status TEXT DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='waitlist_anon_insert') THEN
    CREATE POLICY "waitlist_anon_insert" ON public.waitlist FOR INSERT TO anon WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='waitlist_auth_insert') THEN
    CREATE POLICY "waitlist_auth_insert" ON public.waitlist FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='waitlist_auth_select') THEN
    CREATE POLICY "waitlist_auth_select" ON public.waitlist FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='waitlist_auth_update') THEN
    CREATE POLICY "waitlist_auth_update" ON public.waitlist FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_waitlist_email ON public.waitlist(email);
CREATE INDEX IF NOT EXISTS idx_waitlist_created ON public.waitlist(created_at DESC);
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.waitlist; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4c. waitlist_entries (rich investor intake)
CREATE TABLE IF NOT EXISTS public.waitlist_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  phone TEXT NOT NULL,
  phone_e164 TEXT NOT NULL,
  phone_verified BOOLEAN NOT NULL DEFAULT false,
  accredited_status TEXT,
  consent_sms BOOLEAN NOT NULL DEFAULT true,
  consent_email BOOLEAN NOT NULL DEFAULT true,
  investor_type TEXT,
  primary_id_type TEXT,
  primary_id_reference TEXT,
  primary_id_upload_url TEXT,
  primary_id_upload_name TEXT,
  primary_id_upload_storage_path TEXT,
  secondary_id_type TEXT,
  secondary_id_reference TEXT,
  secondary_id_upload_url TEXT,
  secondary_id_upload_name TEXT,
  secondary_id_upload_storage_path TEXT,
  document_issuing_country TEXT,
  tax_residency_country TEXT,
  tax_id_reference TEXT,
  tax_document_upload_url TEXT,
  tax_document_upload_name TEXT,
  tax_document_upload_storage_path TEXT,
  company_name TEXT,
  company_role TEXT,
  company_ein TEXT,
  company_tax_id TEXT,
  company_registration_country TEXT,
  beneficial_owner_name TEXT,
  legal_ack_tax_reporting BOOLEAN NOT NULL DEFAULT false,
  legal_ack_identity_review BOOLEAN NOT NULL DEFAULT false,
  legal_ack_entity_authority BOOLEAN NOT NULL DEFAULT false,
  agreement_accepted BOOLEAN,
  agreement_version TEXT,
  signature_name TEXT,
  investment_range TEXT,
  return_expectation TEXT,
  preferred_call_time TEXT,
  best_time_for_call TEXT,
  investment_timeline TEXT,
  membership_interest TEXT DEFAULT 'waitlist',
  proof_of_funds_url TEXT,
  proof_of_funds_name TEXT,
  proof_of_funds_storage_path TEXT,
  source TEXT NOT NULL DEFAULT 'landing_page',
  page_path TEXT,
  referrer TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  ip_hash TEXT,
  user_agent TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT waitlist_entries_email_normalized_key UNIQUE (email_normalized)
);
ALTER TABLE public.waitlist_entries ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='waitlist_entries_anon_insert') THEN
    CREATE POLICY "waitlist_entries_anon_insert" ON public.waitlist_entries FOR INSERT TO anon WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='waitlist_entries_auth_insert') THEN
    CREATE POLICY "waitlist_entries_auth_insert" ON public.waitlist_entries FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='waitlist_entries_auth_select') THEN
    CREATE POLICY "waitlist_entries_auth_select" ON public.waitlist_entries FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='waitlist_entries_auth_update') THEN
    CREATE POLICY "waitlist_entries_auth_update" ON public.waitlist_entries FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_we_created_at ON public.waitlist_entries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_we_email_normalized ON public.waitlist_entries(email_normalized);
CREATE INDEX IF NOT EXISTS idx_we_phone_e164 ON public.waitlist_entries(phone_e164);
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.waitlist_entries; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4d. waitlist_otp_events
CREATE TABLE IF NOT EXISTS public.waitlist_otp_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 TEXT NOT NULL,
  event_type TEXT NOT NULL,
  ip_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.waitlist_otp_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='otp_events_auth_select') THEN
    CREATE POLICY "otp_events_auth_select" ON public.waitlist_otp_events FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='otp_events_anon_insert') THEN
    CREATE POLICY "otp_events_anon_insert" ON public.waitlist_otp_events FOR INSERT TO anon WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='otp_events_auth_insert') THEN
    CREATE POLICY "otp_events_auth_insert" ON public.waitlist_otp_events FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
END $$;

-- 4e. email_notifications_queue
CREATE TABLE IF NOT EXISTS public.email_notifications_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email TEXT NOT NULL,
  to_name TEXT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  source TEXT DEFAULT 'waitlist',
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.email_notifications_queue ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='email_queue_anon_insert') THEN
    CREATE POLICY "email_queue_anon_insert" ON public.email_notifications_queue FOR INSERT TO anon WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='email_queue_auth_insert') THEN
    CREATE POLICY "email_queue_auth_insert" ON public.email_notifications_queue FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='email_queue_auth_select') THEN
    CREATE POLICY "email_queue_auth_select" ON public.email_notifications_queue FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- 4f. landing_submissions
CREATE TABLE IF NOT EXISTS public.landing_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT DEFAULT 'landing_page',
  type TEXT DEFAULT 'registration',
  investment_type TEXT,
  investment_amount NUMERIC,
  expected_roi NUMERIC,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  status TEXT DEFAULT 'pending',
  submitted_at TIMESTAMPTZ DEFAULT now(),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.landing_submissions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='landing_submissions_anon_insert') THEN
    CREATE POLICY "landing_submissions_anon_insert" ON public.landing_submissions FOR INSERT TO anon WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='landing_submissions_auth_insert') THEN
    CREATE POLICY "landing_submissions_auth_insert" ON public.landing_submissions FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='landing_submissions_auth_select') THEN
    CREATE POLICY "landing_submissions_auth_select" ON public.landing_submissions FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- 4g. landing_analytics
CREATE TABLE IF NOT EXISTS public.landing_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event TEXT NOT NULL,
  session_id TEXT,
  properties JSONB DEFAULT '{}'::jsonb,
  geo JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.landing_analytics ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='landing_analytics_anon_insert') THEN
    CREATE POLICY "landing_analytics_anon_insert" ON public.landing_analytics FOR INSERT TO anon WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='landing_analytics_auth_insert') THEN
    CREATE POLICY "landing_analytics_auth_insert" ON public.landing_analytics FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='landing_analytics_auth_select') THEN
    CREATE POLICY "landing_analytics_auth_select" ON public.landing_analytics FOR SELECT TO authenticated USING (true);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_landing_analytics_event ON public.landing_analytics(event);
CREATE INDEX IF NOT EXISTS idx_landing_analytics_created ON public.landing_analytics(created_at DESC);
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.landing_analytics; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4h. landing_investments
CREATE TABLE IF NOT EXISTS public.landing_investments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id TEXT,
  investor_name TEXT,
  investor_email TEXT,
  amount NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.landing_investments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='landing_investments_auth_all') THEN
    CREATE POLICY "landing_investments_auth_all" ON public.landing_investments FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 4i. landing_page_config
CREATE TABLE IF NOT EXISTS public.landing_page_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value JSONB DEFAULT '{}'::jsonb,
  updated_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.landing_page_config ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='landing_page_config_auth_all') THEN
    CREATE POLICY "landing_page_config_auth_all" ON public.landing_page_config FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 4j. landing_deployments
CREATE TABLE IF NOT EXISTS public.landing_deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT DEFAULT 'pending',
  deployed_by UUID,
  deployment_url TEXT,
  notes TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);
ALTER TABLE public.landing_deployments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='landing_deployments_auth_all') THEN
    CREATE POLICY "landing_deployments_auth_all" ON public.landing_deployments FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- 5. NOTIFICATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='notifications_select_own') THEN
    CREATE POLICY "notifications_select_own" ON public.notifications FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='notifications_insert_auth') THEN
    CREATE POLICY "notifications_insert_auth" ON public.notifications FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='notifications_update_auth') THEN
    CREATE POLICY "notifications_update_auth" ON public.notifications FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON public.notifications(created_at DESC);
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 6. ANALYTICS & TRACKING
-- ============================================================

-- 6a. analytics_events
CREATE TABLE IF NOT EXISTS public.analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event TEXT NOT NULL,
  session_id TEXT,
  user_id UUID,
  properties JSONB DEFAULT '{}'::jsonb,
  geo JSONB DEFAULT '{}'::jsonb,
  platform TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='analytics_events_insert_anon') THEN
    CREATE POLICY "analytics_events_insert_anon" ON public.analytics_events FOR INSERT TO anon WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='analytics_events_insert_auth') THEN
    CREATE POLICY "analytics_events_insert_auth" ON public.analytics_events FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='analytics_events_select_auth') THEN
    CREATE POLICY "analytics_events_select_auth" ON public.analytics_events FOR SELECT TO authenticated USING (true);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_analytics_events_created ON public.analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_event ON public.analytics_events(event);
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.analytics_events; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 6b. analytics_dashboard
CREATE TABLE IF NOT EXISTS public.analytics_dashboard (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_name TEXT,
  metric_value NUMERIC DEFAULT 0,
  period TEXT DEFAULT 'daily',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.analytics_dashboard ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='analytics_dashboard_auth_all') THEN
    CREATE POLICY "analytics_dashboard_auth_all" ON public.analytics_dashboard FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 6c. analytics_kpi
CREATE TABLE IF NOT EXISTS public.analytics_kpi (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kpi_name TEXT,
  kpi_value NUMERIC DEFAULT 0,
  target_value NUMERIC DEFAULT 0,
  period TEXT DEFAULT 'daily',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.analytics_kpi ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='analytics_kpi_auth_all') THEN
    CREATE POLICY "analytics_kpi_auth_all" ON public.analytics_kpi FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 6d. analytics_retention
CREATE TABLE IF NOT EXISTS public.analytics_retention (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort TEXT,
  period TEXT,
  retention_rate NUMERIC DEFAULT 0,
  total_users INTEGER DEFAULT 0,
  returning_users INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.analytics_retention ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='analytics_retention_auth_all') THEN
    CREATE POLICY "analytics_retention_auth_all" ON public.analytics_retention FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 6e. analytics_investments
CREATE TABLE IF NOT EXISTS public.analytics_investments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period TEXT,
  total_invested NUMERIC DEFAULT 0,
  investor_count INTEGER DEFAULT 0,
  avg_investment NUMERIC DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.analytics_investments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='analytics_investments_auth_all') THEN
    CREATE POLICY "analytics_investments_auth_all" ON public.analytics_investments FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 6f. visitor_sessions
CREATE TABLE IF NOT EXISTS public.visitor_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  ip_hash TEXT,
  user_agent TEXT,
  country TEXT,
  city TEXT,
  device_type TEXT,
  page_path TEXT,
  referrer TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  is_active BOOLEAN DEFAULT true,
  started_at TIMESTAMPTZ DEFAULT now(),
  last_seen_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.visitor_sessions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='visitor_sessions_anon_insert') THEN
    CREATE POLICY "visitor_sessions_anon_insert" ON public.visitor_sessions FOR INSERT TO anon WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='visitor_sessions_auth_select') THEN
    CREATE POLICY "visitor_sessions_auth_select" ON public.visitor_sessions FOR SELECT TO authenticated USING (true);
  END IF;
END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.visitor_sessions; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 6g. realtime_snapshots
CREATE TABLE IF NOT EXISTS public.realtime_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_type TEXT DEFAULT 'visitor',
  data JSONB DEFAULT '{}'::jsonb,
  active_visitors INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.realtime_snapshots ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='realtime_snapshots_auth_select') THEN
    CREATE POLICY "realtime_snapshots_auth_select" ON public.realtime_snapshots FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='realtime_snapshots_auth_insert') THEN
    CREATE POLICY "realtime_snapshots_auth_insert" ON public.realtime_snapshots FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.realtime_snapshots; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.ivx_is_owner()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $ivx$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND regexp_replace(lower(coalesce(role, 'investor')), '[^a-z0-9]+', '', 'g') IN ('owner', 'owneradmin', 'ivxowner', 'developer', 'dev', 'admin', 'superadmin', 'administrator', 'founder', 'staff', 'staffmember', 'ceo', 'manager', 'analyst', 'support')
    );
$ivx$;

-- 6h. conversations
CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  subtitle TEXT,
  last_message_text TEXT,
  last_message_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname='conversations_auth_all' AND schemaname='public' AND tablename='conversations') THEN
    DROP POLICY "conversations_auth_all" ON public.conversations;
  END IF;
  CREATE POLICY "conversations_auth_all" ON public.conversations FOR ALL TO authenticated USING (id <> '8f5a9c42-1cb5-4f81-b2d8-6f3a0a8b9d41'::uuid OR public.ivx_is_owner()) WITH CHECK (id <> '8f5a9c42-1cb5-4f81-b2d8-6f3a0a8b9d41'::uuid OR public.ivx_is_owner());
END $$;
CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at ON public.conversations(last_message_at DESC);
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 6i. conversation_participants
CREATE TABLE IF NOT EXISTS public.conversation_participants (
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  unread_count INTEGER DEFAULT 0,
  last_read_at TIMESTAMPTZ,
  PRIMARY KEY (conversation_id, user_id)
);
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname='conversation_participants_auth_all' AND schemaname='public' AND tablename='conversation_participants') THEN
    DROP POLICY "conversation_participants_auth_all" ON public.conversation_participants;
  END IF;
  CREATE POLICY "conversation_participants_auth_all" ON public.conversation_participants FOR ALL TO authenticated USING (conversation_id <> '8f5a9c42-1cb5-4f81-b2d8-6f3a0a8b9d41'::uuid OR public.ivx_is_owner()) WITH CHECK (conversation_id <> '8f5a9c42-1cb5-4f81-b2d8-6f3a0a8b9d41'::uuid OR public.ivx_is_owner());
END $$;
CREATE INDEX IF NOT EXISTS idx_conversation_participants_user ON public.conversation_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_participants_conversation ON public.conversation_participants(conversation_id);
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_participants; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 6j. messages
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL,
  text TEXT,
  file_url TEXT,
  file_type TEXT,
  read_by TEXT[] DEFAULT '{}'::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname='messages_auth_all' AND schemaname='public' AND tablename='messages') THEN
    DROP POLICY "messages_auth_all" ON public.messages;
  END IF;
  CREATE POLICY "messages_auth_all" ON public.messages FOR ALL TO authenticated USING (conversation_id <> '8f5a9c42-1cb5-4f81-b2d8-6f3a0a8b9d41'::uuid OR public.ivx_is_owner()) WITH CHECK (conversation_id <> '8f5a9c42-1cb5-4f81-b2d8-6f3a0a8b9d41'::uuid OR public.ivx_is_owner());
END $$;
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON public.messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender_created ON public.messages(sender_id, created_at DESC);
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.messages; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 7. KYC
-- ============================================================

-- 7a. kyc_verifications
CREATE TABLE IF NOT EXISTS public.kyc_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name TEXT,
  last_name TEXT,
  date_of_birth TEXT,
  nationality TEXT,
  nationality_code TEXT,
  tax_id TEXT,
  street TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  country TEXT,
  country_code TEXT,
  status TEXT DEFAULT 'pending',
  verification_score NUMERIC,
  risk_level TEXT,
  verification_passed BOOLEAN DEFAULT false,
  submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID,
  reviewer_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);
ALTER TABLE public.kyc_verifications ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='kyc_select_own') THEN
    CREATE POLICY "kyc_select_own" ON public.kyc_verifications FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='kyc_insert_own') THEN
    CREATE POLICY "kyc_insert_own" ON public.kyc_verifications FOR INSERT TO authenticated WITH CHECK (auth.uid()=user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='kyc_update_auth') THEN
    CREATE POLICY "kyc_update_auth" ON public.kyc_verifications FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_kyc_verifications_user ON public.kyc_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_verifications_status ON public.kyc_verifications(status);

-- 7b. kyc_documents
CREATE TABLE IF NOT EXISTS public.kyc_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  document_url TEXT,
  issuing_country TEXT,
  status TEXT DEFAULT 'pending',
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.kyc_documents ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='kyc_docs_select_auth') THEN
    CREATE POLICY "kyc_docs_select_auth" ON public.kyc_documents FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='kyc_docs_insert_own') THEN
    CREATE POLICY "kyc_docs_insert_own" ON public.kyc_documents FOR INSERT TO authenticated WITH CHECK (auth.uid()=user_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_kyc_documents_user ON public.kyc_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_documents_type ON public.kyc_documents(document_type);

-- ============================================================
-- 8. EARN (SAVINGS) TABLES
-- ============================================================

-- 8a. earn_accounts
CREATE TABLE IF NOT EXISTS public.earn_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  total_deposited NUMERIC DEFAULT 0,
  total_earned NUMERIC DEFAULT 0,
  current_apy NUMERIC DEFAULT 10,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.earn_accounts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='earn_accounts_select_own') THEN
    CREATE POLICY "earn_accounts_select_own" ON public.earn_accounts FOR SELECT TO authenticated USING (auth.uid()=user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='earn_accounts_insert_own') THEN
    CREATE POLICY "earn_accounts_insert_own" ON public.earn_accounts FOR INSERT TO authenticated WITH CHECK (auth.uid()=user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='earn_accounts_update_own') THEN
    CREATE POLICY "earn_accounts_update_own" ON public.earn_accounts FOR UPDATE TO authenticated USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
  END IF;
END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.earn_accounts; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 8b. earn_deposits
CREATE TABLE IF NOT EXISTS public.earn_deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  deposited_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'active',
  withdrawn_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.earn_deposits ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='earn_deposits_select_own') THEN
    CREATE POLICY "earn_deposits_select_own" ON public.earn_deposits FOR SELECT TO authenticated USING (auth.uid()=user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='earn_deposits_insert_own') THEN
    CREATE POLICY "earn_deposits_insert_own" ON public.earn_deposits FOR INSERT TO authenticated WITH CHECK (auth.uid()=user_id);
  END IF;
END $$;

-- 8c. earn_payouts
CREATE TABLE IF NOT EXISTS public.earn_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  type TEXT DEFAULT 'interest',
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.earn_payouts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='earn_payouts_select_own') THEN
    CREATE POLICY "earn_payouts_select_own" ON public.earn_payouts FOR SELECT TO authenticated USING (auth.uid()=user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='earn_payouts_insert_own') THEN
    CREATE POLICY "earn_payouts_insert_own" ON public.earn_payouts FOR INSERT TO authenticated WITH CHECK (auth.uid()=user_id);
  END IF;
END $$;

-- ============================================================
-- 9. IPX TOKEN TABLES
-- ============================================================

-- 9a. ipx_holdings
CREATE TABLE IF NOT EXISTS public.ipx_holdings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  token_symbol TEXT DEFAULT 'IPX',
  quantity NUMERIC DEFAULT 0,
  avg_price NUMERIC DEFAULT 0,
  current_value NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, token_symbol)
);
ALTER TABLE public.ipx_holdings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='ipx_holdings_select_own') THEN
    CREATE POLICY "ipx_holdings_select_own" ON public.ipx_holdings FOR SELECT TO authenticated USING (auth.uid()=user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='ipx_holdings_insert_own') THEN
    CREATE POLICY "ipx_holdings_insert_own" ON public.ipx_holdings FOR INSERT TO authenticated WITH CHECK (auth.uid()=user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='ipx_holdings_update_own') THEN
    CREATE POLICY "ipx_holdings_update_own" ON public.ipx_holdings FOR UPDATE TO authenticated USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_ipx_holdings_user ON public.ipx_holdings(user_id);

-- 9b. ipx_purchases
CREATE TABLE IF NOT EXISTS public.ipx_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  token_symbol TEXT DEFAULT 'IPX',
  quantity NUMERIC NOT NULL DEFAULT 0,
  price_per_token NUMERIC DEFAULT 0,
  total_cost NUMERIC DEFAULT 0,
  purchased_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.ipx_purchases ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='ipx_purchases_select_own') THEN
    CREATE POLICY "ipx_purchases_select_own" ON public.ipx_purchases FOR SELECT TO authenticated USING (auth.uid()=user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='ipx_purchases_insert_own') THEN
    CREATE POLICY "ipx_purchases_insert_own" ON public.ipx_purchases FOR INSERT TO authenticated WITH CHECK (auth.uid()=user_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_ipx_purchases_user ON public.ipx_purchases(user_id);

-- ============================================================
-- 10. REFERRALS
-- ============================================================

-- 10a. referrals
CREATE TABLE IF NOT EXISTS public.referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL,
  referred_id UUID,
  referral_code TEXT,
  status TEXT DEFAULT 'pending',
  reward_amount NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='referrals_select_auth') THEN
    CREATE POLICY "referrals_select_auth" ON public.referrals FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='referrals_insert_auth') THEN
    CREATE POLICY "referrals_insert_auth" ON public.referrals FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.referrals(referrer_id);

-- 10b. referral_invites
CREATE TABLE IF NOT EXISTS public.referral_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL,
  email TEXT NOT NULL,
  status TEXT DEFAULT 'sent',
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.referral_invites ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='referral_invites_select_auth') THEN
    CREATE POLICY "referral_invites_select_auth" ON public.referral_invites FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='referral_invites_insert_auth') THEN
    CREATE POLICY "referral_invites_insert_auth" ON public.referral_invites FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- 11. SMS REPORTS & MESSAGES
-- ============================================================

-- 11a. sms_reports
CREATE TABLE IF NOT EXISTS public.sms_reports (
  id TEXT PRIMARY KEY DEFAULT 'default',
  status TEXT DEFAULT 'inactive',
  running BOOLEAN DEFAULT false,
  total_sent INTEGER DEFAULT 0,
  total_failed INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.sms_reports ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='sms_reports_auth_all') THEN
    CREATE POLICY "sms_reports_auth_all" ON public.sms_reports FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 11b. sms_messages
CREATE TABLE IF NOT EXISTS public.sms_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT DEFAULT 'manual',
  subject TEXT,
  message TEXT,
  content TEXT,
  details TEXT,
  status TEXT DEFAULT 'pending',
  recipient TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.sms_messages ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='sms_messages_auth_all') THEN
    CREATE POLICY "sms_messages_auth_all" ON public.sms_messages FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_sms_messages_created ON public.sms_messages(created_at DESC);

-- ============================================================
-- 12. LENDER TABLES
-- ============================================================

-- 12a. imported_lenders
CREATE TABLE IF NOT EXISTS public.imported_lenders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  email TEXT,
  phone TEXT,
  company TEXT,
  loan_type TEXT,
  state TEXT,
  source TEXT,
  user_id UUID,
  status TEXT DEFAULT 'active',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.imported_lenders ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='imported_lenders_auth_all') THEN
    CREATE POLICY "imported_lenders_auth_all" ON public.imported_lenders FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 12b. synced_lenders
CREATE TABLE IF NOT EXISTS public.synced_lenders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lender_id UUID,
  sync_source TEXT,
  sync_status TEXT DEFAULT 'synced',
  synced_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.synced_lenders ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='synced_lenders_auth_all') THEN
    CREATE POLICY "synced_lenders_auth_all" ON public.synced_lenders FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 12c. lender_sync_stats
CREATE TABLE IF NOT EXISTS public.lender_sync_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  total_synced INTEGER DEFAULT 0,
  last_sync_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.lender_sync_stats ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='lender_sync_stats_auth_all') THEN
    CREATE POLICY "lender_sync_stats_auth_all" ON public.lender_sync_stats FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 12d. lender_sync_config
CREATE TABLE IF NOT EXISTS public.lender_sync_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.lender_sync_config ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='lender_sync_config_auth_all') THEN
    CREATE POLICY "lender_sync_config_auth_all" ON public.lender_sync_config FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 12e. lender_sync_jobs
CREATE TABLE IF NOT EXISTS public.lender_sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT,
  status TEXT DEFAULT 'pending',
  records_processed INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.lender_sync_jobs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='lender_sync_jobs_auth_all') THEN
    CREATE POLICY "lender_sync_jobs_auth_all" ON public.lender_sync_jobs FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- 13. IMAGE MANAGEMENT
-- ============================================================

-- 13a. image_registry
CREATE TABLE IF NOT EXISTS public.image_registry (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  user_id UUID,
  is_protected BOOLEAN DEFAULT false,
  storage_path TEXT,
  backup_urls JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.image_registry ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='image_registry_select_all') THEN
    CREATE POLICY "image_registry_select_all" ON public.image_registry FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='image_registry_insert_auth') THEN
    CREATE POLICY "image_registry_insert_auth" ON public.image_registry FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='image_registry_update_auth') THEN
    CREATE POLICY "image_registry_update_auth" ON public.image_registry FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='image_registry_delete_auth') THEN
    CREATE POLICY "image_registry_delete_auth" ON public.image_registry FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

-- 13b. image_backups
CREATE TABLE IF NOT EXISTS public.image_backups (
  id TEXT PRIMARY KEY,
  entity_type TEXT,
  entity_id TEXT,
  primary_url TEXT,
  backup_urls JSONB DEFAULT '[]'::jsonb,
  local_uri TEXT,
  supabase_storage_path TEXT,
  last_verified_at TIMESTAMPTZ,
  last_health_status TEXT DEFAULT 'unknown',
  fail_count INTEGER DEFAULT 0,
  recovered_at TIMESTAMPTZ,
  recovery_source TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.image_backups ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='image_backups_auth_all') THEN
    CREATE POLICY "image_backups_auth_all" ON public.image_backups FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 13c. image_health_reports
CREATE TABLE IF NOT EXISTS public.image_health_reports (
  id TEXT PRIMARY KEY,
  scanned_at TIMESTAMPTZ DEFAULT now(),
  total_images INTEGER DEFAULT 0,
  healthy_count INTEGER DEFAULT 0,
  degraded_count INTEGER DEFAULT 0,
  broken_count INTEGER DEFAULT 0,
  recovered_count INTEGER DEFAULT 0,
  failed_recovery_count INTEGER DEFAULT 0,
  scan_duration_ms INTEGER DEFAULT 0,
  details JSONB DEFAULT '[]'::jsonb
);
ALTER TABLE public.image_health_reports ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='image_health_reports_auth_all') THEN
    CREATE POLICY "image_health_reports_auth_all" ON public.image_health_reports FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- 14. ADMIN & SYSTEM TABLES
-- ============================================================

-- 14a. audit_trail
CREATE TABLE IF NOT EXISTS public.audit_trail (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  entity_title TEXT,
  action TEXT NOT NULL,
  user_id UUID,
  user_role TEXT,
  timestamp TIMESTAMPTZ DEFAULT now(),
  details TEXT,
  snapshot_before JSONB,
  snapshot_after JSONB,
  source TEXT
);
ALTER TABLE public.audit_trail ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='audit_trail_auth_select') THEN
    CREATE POLICY "audit_trail_auth_select" ON public.audit_trail FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='audit_trail_auth_insert') THEN
    CREATE POLICY "audit_trail_auth_insert" ON public.audit_trail FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
END $$;

-- 14b. error_logs
CREATE TABLE IF NOT EXISTS public.error_logs (
  id TEXT PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT now(),
  message TEXT,
  stack TEXT,
  screen TEXT,
  platform TEXT,
  severity TEXT DEFAULT 'error',
  metadata JSONB DEFAULT '{}'::jsonb
);
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='error_logs_anon_insert') THEN
    CREATE POLICY "error_logs_anon_insert" ON public.error_logs FOR INSERT TO anon WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='error_logs_auth_insert') THEN
    CREATE POLICY "error_logs_auth_insert" ON public.error_logs FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='error_logs_auth_select') THEN
    CREATE POLICY "error_logs_auth_select" ON public.error_logs FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- 14c. system_health
CREATE TABLE IF NOT EXISTS public.system_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component TEXT,
  status TEXT DEFAULT 'ok',
  message TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  checked_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.system_health ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='system_health_auth_all') THEN
    CREATE POLICY "system_health_auth_all" ON public.system_health FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 14d. system_metrics
CREATE TABLE IF NOT EXISTS public.system_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_name TEXT,
  metric_value NUMERIC DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.system_metrics ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='system_metrics_auth_all') THEN
    CREATE POLICY "system_metrics_auth_all" ON public.system_metrics FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 14e. staff_activity
CREATE TABLE IF NOT EXISTS public.staff_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  action TEXT,
  details TEXT,
  ip_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.staff_activity ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='staff_activity_auth_all') THEN
    CREATE POLICY "staff_activity_auth_all" ON public.staff_activity FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 14f. staff_activity_log (alias/extended)
CREATE TABLE IF NOT EXISTS public.staff_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  action TEXT,
  entity_type TEXT,
  entity_id TEXT,
  details JSONB DEFAULT '{}'::jsonb,
  ip_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.staff_activity_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='staff_activity_log_auth_all') THEN
    CREATE POLICY "staff_activity_log_auth_all" ON public.staff_activity_log FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 14g. app_config
CREATE TABLE IF NOT EXISTS public.app_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='app_config_select_all') THEN
    CREATE POLICY "app_config_select_all" ON public.app_config FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='app_config_auth_write') THEN
    CREATE POLICY "app_config_auth_write" ON public.app_config FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 14h. feature_flags
CREATE TABLE IF NOT EXISTS public.feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  enabled BOOLEAN DEFAULT false,
  description TEXT,
  updated_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='feature_flags_select_all') THEN
    CREATE POLICY "feature_flags_select_all" ON public.feature_flags FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='feature_flags_auth_write') THEN
    CREATE POLICY "feature_flags_auth_write" ON public.feature_flags FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 14i. team_members
CREATE TABLE IF NOT EXISTS public.team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  name TEXT,
  email TEXT,
  role TEXT DEFAULT 'member',
  status TEXT DEFAULT 'active',
  invited_by UUID,
  joined_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='team_members_auth_all') THEN
    CREATE POLICY "team_members_auth_all" ON public.team_members FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 14j. push_tokens
CREATE TABLE IF NOT EXISTS public.push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  token TEXT NOT NULL,
  platform TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(token)
);
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='push_tokens_insert_auth') THEN
    CREATE POLICY "push_tokens_insert_auth" ON public.push_tokens FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='push_tokens_select_auth') THEN
    CREATE POLICY "push_tokens_select_auth" ON public.push_tokens FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- ============================================================
-- 15. ADDITIONAL APP TABLES
-- ============================================================

-- 15a. signups
CREATE TABLE IF NOT EXISTS public.signups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT,
  phone TEXT,
  source TEXT DEFAULT 'app',
  status TEXT DEFAULT 'pending',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.signups ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='signups_anon_insert') THEN
    CREATE POLICY "signups_anon_insert" ON public.signups FOR INSERT TO anon WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='signups_auth_all') THEN
    CREATE POLICY "signups_auth_all" ON public.signups FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 15b. applications
CREATE TABLE IF NOT EXISTS public.applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  type TEXT DEFAULT 'general',
  status TEXT DEFAULT 'pending',
  data JSONB DEFAULT '{}'::jsonb,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='applications_auth_all') THEN
    CREATE POLICY "applications_auth_all" ON public.applications FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 15c. support_tickets
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  subject TEXT,
  message TEXT,
  status TEXT DEFAULT 'open',
  priority TEXT DEFAULT 'normal',
  assigned_to UUID,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='support_tickets_auth_all') THEN
    CREATE POLICY "support_tickets_auth_all" ON public.support_tickets FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 15d. influencer_applications
CREATE TABLE IF NOT EXISTS public.influencer_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  email TEXT,
  platform TEXT,
  followers INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.influencer_applications ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='influencer_applications_auth_all') THEN
    CREATE POLICY "influencer_applications_auth_all" ON public.influencer_applications FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 15e. ai_brain_status
CREATE TABLE IF NOT EXISTS public.ai_brain_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT DEFAULT 'idle',
  last_run_at TIMESTAMPTZ,
  tasks_completed INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.ai_brain_status ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='ai_brain_status_auth_all') THEN
    CREATE POLICY "ai_brain_status_auth_all" ON public.ai_brain_status FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 15f. auto_repair_scans
CREATE TABLE IF NOT EXISTS public.auto_repair_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_type TEXT,
  status TEXT DEFAULT 'completed',
  issues_found INTEGER DEFAULT 0,
  issues_fixed INTEGER DEFAULT 0,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.auto_repair_scans ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='auto_repair_scans_auth_all') THEN
    CREATE POLICY "auto_repair_scans_auth_all" ON public.auto_repair_scans FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 15g. repair_logs
CREATE TABLE IF NOT EXISTS public.repair_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id UUID,
  entity_type TEXT,
  entity_id TEXT,
  action TEXT,
  result TEXT,
  details TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.repair_logs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='repair_logs_auth_all') THEN
    CREATE POLICY "repair_logs_auth_all" ON public.repair_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 15h. emails
CREATE TABLE IF NOT EXISTS public.emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email TEXT,
  from_email TEXT,
  subject TEXT,
  body TEXT,
  status TEXT DEFAULT 'queued',
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.emails ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='emails_auth_all') THEN
    CREATE POLICY "emails_auth_all" ON public.emails FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- 16. MARKETING & RETARGETING TABLES
-- ============================================================

-- 16a. retargeting_dashboard
CREATE TABLE IF NOT EXISTS public.retargeting_dashboard (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_name TEXT,
  metric_value NUMERIC DEFAULT 0,
  period TEXT DEFAULT 'daily',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.retargeting_dashboard ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='retargeting_dashboard_auth_all') THEN
    CREATE POLICY "retargeting_dashboard_auth_all" ON public.retargeting_dashboard FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 16b. audience_segments
CREATE TABLE IF NOT EXISTS public.audience_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  description TEXT,
  criteria JSONB DEFAULT '{}'::jsonb,
  user_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.audience_segments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='audience_segments_auth_all') THEN
    CREATE POLICY "audience_segments_auth_all" ON public.audience_segments FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 16c. ad_pixels
CREATE TABLE IF NOT EXISTS public.ad_pixels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT,
  pixel_id TEXT,
  status TEXT DEFAULT 'active',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.ad_pixels ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='ad_pixels_auth_all') THEN
    CREATE POLICY "ad_pixels_auth_all" ON public.ad_pixels FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 16d. utm_analytics
CREATE TABLE IF NOT EXISTS public.utm_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  visits INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.utm_analytics ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='utm_analytics_auth_all') THEN
    CREATE POLICY "utm_analytics_auth_all" ON public.utm_analytics FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 16e. search_discovery
CREATE TABLE IF NOT EXISTS public.search_discovery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query TEXT,
  results_count INTEGER DEFAULT 0,
  user_id UUID,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.search_discovery ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='search_discovery_auth_all') THEN
    CREATE POLICY "search_discovery_auth_all" ON public.search_discovery FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 16f. re_engagement_triggers
CREATE TABLE IF NOT EXISTS public.re_engagement_triggers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_type TEXT,
  user_id UUID,
  channel TEXT,
  status TEXT DEFAULT 'pending',
  sent_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.re_engagement_triggers ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='re_engagement_triggers_auth_all') THEN
    CREATE POLICY "re_engagement_triggers_auth_all" ON public.re_engagement_triggers FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 16g. engagement_scoring
CREATE TABLE IF NOT EXISTS public.engagement_scoring (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  score NUMERIC DEFAULT 0,
  factors JSONB DEFAULT '{}'::jsonb,
  tier TEXT DEFAULT 'standard',
  calculated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.engagement_scoring ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='engagement_scoring_auth_all') THEN
    CREATE POLICY "engagement_scoring_auth_all" ON public.engagement_scoring FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- 17. TRIGGERS (auto-update updated_at)
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS TRIGGER AS $fn$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$fn$ LANGUAGE plpgsql;

DO $$ DECLARE tbl TEXT; BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'profiles','wallets','jv_deals','waitlist','waitlist_entries',
    'landing_page_config','feature_flags','app_config','team_members',
    'earn_accounts','kyc_verifications','push_tokens','imported_lenders',
    'sms_reports','audience_segments','support_tickets','applications',
    'landing_deals','orders'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_updated_at_%I ON public.%I', tbl, tbl);
    EXECUTE format('CREATE TRIGGER trg_updated_at_%I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', tbl, tbl);
  END LOOP;
END $$;

-- ============================================================
-- 18. KYC SYNC TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION sync_kyc_status_to_profile() RETURNS TRIGGER AS $fn$
BEGIN
  IF NEW.status IN ('approved','rejected') AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    UPDATE profiles SET kyc_status = CASE WHEN NEW.verification_passed = true THEN 'approved' ELSE NEW.status END WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS kyc_sync_profile_trigger ON public.kyc_verifications;
CREATE TRIGGER kyc_sync_profile_trigger AFTER UPDATE ON public.kyc_verifications FOR EACH ROW EXECUTE FUNCTION sync_kyc_status_to_profile();

-- ============================================================
-- 19. RPC FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN AS $fn$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND regexp_replace(lower(COALESCE(role, 'investor')), '[^a-z0-9]+', '', 'g') IN ('owner', 'owneradmin', 'ivxowner', 'developer', 'dev', 'admin', 'superadmin', 'administrator', 'founder', 'staff', 'staffmember', 'ceo', 'manager', 'analyst', 'support')
  );
END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_owner_of(check_user_id UUID) RETURNS BOOLEAN AS $fn$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND regexp_replace(lower(COALESCE(role, 'investor')), '[^a-z0-9]+', '', 'g') IN ('owner', 'owneradmin', 'ivxowner', 'developer', 'dev', 'admin', 'superadmin', 'administrator', 'founder', 'staff', 'staffmember', 'ceo', 'manager', 'analyst', 'support')
  );
END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_user_role() RETURNS TEXT AS $fn$
DECLARE user_role TEXT;
BEGIN SELECT role INTO user_role FROM public.profiles WHERE id = auth.uid(); RETURN COALESCE(user_role, 'investor'); END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION verify_admin_access() RETURNS BOOLEAN AS $fn$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND regexp_replace(lower(COALESCE(role, 'investor')), '[^a-z0-9]+', '', 'g') IN ('owner', 'owneradmin', 'ivxowner', 'developer', 'dev', 'admin', 'superadmin', 'administrator', 'founder', 'staff', 'staffmember', 'ceo', 'manager', 'analyst', 'support')
  );
END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION upsert_visitor_session(
  p_session_id TEXT, p_ip_hash TEXT DEFAULT NULL, p_user_agent TEXT DEFAULT NULL,
  p_country TEXT DEFAULT NULL, p_city TEXT DEFAULT NULL, p_device_type TEXT DEFAULT NULL,
  p_page_path TEXT DEFAULT NULL, p_referrer TEXT DEFAULT NULL,
  p_utm_source TEXT DEFAULT NULL, p_utm_medium TEXT DEFAULT NULL, p_utm_campaign TEXT DEFAULT NULL
) RETURNS VOID AS $fn$
BEGIN
  INSERT INTO public.visitor_sessions (session_id,ip_hash,user_agent,country,city,device_type,page_path,referrer,utm_source,utm_medium,utm_campaign,is_active,last_seen_at)
  VALUES (p_session_id,p_ip_hash,p_user_agent,p_country,p_city,p_device_type,p_page_path,p_referrer,p_utm_source,p_utm_medium,p_utm_campaign,true,now())
  ON CONFLICT (session_id) DO UPDATE SET last_seen_at=now(),is_active=true,page_path=COALESCE(EXCLUDED.page_path,visitor_sessions.page_path);
EXCEPTION WHEN unique_violation THEN
  UPDATE public.visitor_sessions SET last_seen_at=now(),is_active=true WHERE session_id=p_session_id;
END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='visitor_sessions_session_id_key') THEN
    ALTER TABLE public.visitor_sessions ADD CONSTRAINT visitor_sessions_session_id_key UNIQUE (session_id);
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION mark_inactive_sessions(p_timeout_minutes INTEGER DEFAULT 5) RETURNS INTEGER AS $fn$
DECLARE affected INTEGER;
BEGIN
  UPDATE public.visitor_sessions SET is_active=false WHERE is_active=true AND last_seen_at < now() - (p_timeout_minutes || ' minutes')::interval;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION save_realtime_snapshot(p_snapshot_type TEXT DEFAULT 'visitor', p_data JSONB DEFAULT '{}'::jsonb, p_active_visitors INTEGER DEFAULT 0) RETURNS VOID AS $fn$
BEGIN INSERT INTO public.realtime_snapshots (snapshot_type,data,active_visitors) VALUES (p_snapshot_type,p_data,p_active_visitors); END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION increment_sms_counter(counter_name TEXT DEFAULT 'sms') RETURNS VOID AS $fn$
BEGIN INSERT INTO public.system_metrics (metric_name,metric_value) VALUES (counter_name,1) ON CONFLICT DO NOTHING; END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION atomic_wallet_operation(
  p_user_id UUID, p_amount NUMERIC, p_operation TEXT, p_reason TEXT, p_description TEXT,
  p_reference_id TEXT DEFAULT NULL, p_reference_type TEXT DEFAULT NULL, p_fee NUMERIC DEFAULT 0
) RETURNS TABLE(success BOOLEAN, new_available NUMERIC, new_invested NUMERIC, new_total NUMERIC, message TEXT, transaction_id TEXT) AS $fn$
DECLARE
  v_wallet RECORD; v_new_available NUMERIC; v_new_invested NUMERIC; v_new_total NUMERIC; v_tx_id TEXT; v_direction TEXT;
BEGIN
  SELECT * INTO v_wallet FROM public.wallets WHERE user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.wallets (user_id,available,pending,invested,total,currency) VALUES (p_user_id,0,0,0,0,'USD');
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
  UPDATE public.wallets SET available=v_new_available,invested=v_new_invested,total=v_new_total,updated_at=now() WHERE user_id=p_user_id;
  v_tx_id:='wtx_'||extract(epoch from now())::bigint||'_'||substr(md5(random()::text),1,8);
  INSERT INTO public.wallet_transactions (id,user_id,type,amount,direction,status,reference_id,reference_type,description,fee,net_amount)
  VALUES (v_tx_id,p_user_id,p_reason,p_amount,v_direction,'completed',p_reference_id,p_reference_type,p_description,p_fee,p_amount-p_fee);
  RETURN QUERY SELECT true,v_new_available,v_new_invested,v_new_total,'OK'::TEXT,v_tx_id;
END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION ensure_deal_photos_bucket() RETURNS VOID AS $fn$
BEGIN INSERT INTO storage.buckets (id,name,public) VALUES ('deal-photos','deal-photos',true) ON CONFLICT (id) DO NOTHING; END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 20. STORAGE BUCKETS
-- ============================================================

INSERT INTO storage.buckets (id,name,public) VALUES ('deal-photos','deal-photos',true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id,name,public) VALUES ('investor-intake','investor-intake',true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id,name,public) VALUES ('landing-page','landing-page',true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id,name,public) VALUES ('kyc-documents','kyc-documents',false) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id,name,public) VALUES ('chat-uploads','chat-uploads',true) ON CONFLICT (id) DO NOTHING;

-- Storage policies
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='deal_photos_public_select') THEN
    CREATE POLICY "deal_photos_public_select" ON storage.objects FOR SELECT USING (bucket_id='deal-photos');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='deal_photos_auth_insert') THEN
    CREATE POLICY "deal_photos_auth_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id='deal-photos');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='investor_intake_public_select') THEN
    CREATE POLICY "investor_intake_public_select" ON storage.objects FOR SELECT USING (bucket_id='investor-intake');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='investor_intake_anon_insert') THEN
    CREATE POLICY "investor_intake_anon_insert" ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id='investor-intake');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='investor_intake_auth_insert') THEN
    CREATE POLICY "investor_intake_auth_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id='investor-intake');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='landing_page_public_select') THEN
    CREATE POLICY "landing_page_public_select" ON storage.objects FOR SELECT USING (bucket_id='landing-page');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='landing_page_auth_all') THEN
    CREATE POLICY "landing_page_auth_all" ON storage.objects FOR ALL TO authenticated USING (bucket_id='landing-page') WITH CHECK (bucket_id='landing-page');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='kyc_docs_auth_insert') THEN
    CREATE POLICY "kyc_docs_auth_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id='kyc-documents');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='kyc_docs_auth_select') THEN
    CREATE POLICY "kyc_docs_auth_select" ON storage.objects FOR SELECT TO authenticated USING (bucket_id='kyc-documents');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='chat_uploads_public_select') THEN
    CREATE POLICY "chat_uploads_public_select" ON storage.objects FOR SELECT USING (bucket_id='chat-uploads');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='chat_uploads_auth_insert') THEN
    CREATE POLICY "chat_uploads_auth_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id='chat-uploads');
  END IF;
END $$;

-- ============================================================
-- DONE
-- ============================================================
SELECT 'IVX Full Schema deployed successfully — ' || now()::text AS result;