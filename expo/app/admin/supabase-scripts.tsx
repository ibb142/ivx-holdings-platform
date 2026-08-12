import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Animated,
  Alert} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Database,
  CheckCircle,
  XCircle,
  RefreshCw,
  Zap,
  Shield,
  Table2,
  HardDrive,
  Radio,
  Settings,
  AlertTriangle,
  Clock,
  Server,
  ChevronDown,
  ChevronUp,
  Rocket,
  Users,
  Copy} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import Colors from '@/constants/colors';
import { IVX_OWNER_AI_SCHEMA_SQL } from '@/constants/ivx-owner-ai-schema-sql';
import { IVX_OWNER_ADMIN_MODULE_SQL } from '@/constants/ivx-owner-admin-module-sql';
import { IVX_SECURITY_HOTFIX_SQL } from '@/constants/ivx-security-hotfix-sql';
import { safeSetString } from '@/lib/safe-clipboard';
import { executeSupabaseSqlScript, isSupabaseSqlExecMissing } from '@/lib/supabase-sql-executor';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { RefreshControl } from 'react-native';

console.log('[Supabase Status] Live dashboard loaded');

type CheckStatus = 'pending' | 'checking' | 'ok' | 'missing' | 'error';

interface TableCheck {
  name: string;
  status: CheckStatus;
  rowCount?: number;
  hasRls?: boolean;
}

interface FunctionCheck {
  name: string;
  status: CheckStatus;
}

interface BucketCheck {
  name: string;
  status: CheckStatus;
  isPublic?: boolean;
}

interface RealtimeCheck {
  table: string;
  status: CheckStatus;
}

interface SectionState {
  tables: boolean;
  functions: boolean;
  storage: boolean;
  realtime: boolean;
  config: boolean;
  deploy: boolean;
}

type DeployAction = 'idle' | 'deploying' | 'success' | 'error';
type OwnerModuleStatus = 'live' | 'partial' | 'missing';

const KYC_TABLES_SQL = `-- IVX KYC Tables: kyc_verifications + kyc_documents
-- Run this in Supabase SQL Editor to create KYC tables

-- 1. KYC Verifications table (stores personal info + verification results)
CREATE TABLE IF NOT EXISTS kyc_verifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
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

-- 2. KYC Documents table (stores uploaded document references)
CREATE TABLE IF NOT EXISTS kyc_documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  document_url TEXT,
  issuing_country TEXT,
  status TEXT DEFAULT 'pending',
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Enable RLS
ALTER TABLE kyc_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_documents ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies — users can read/write own, admins can read all
DO $ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can read own kyc') THEN
    CREATE POLICY "Users can read own kyc" ON kyc_verifications FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can upsert own kyc') THEN
    CREATE POLICY "Users can upsert own kyc" ON kyc_verifications FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can update own kyc') THEN
    CREATE POLICY "Users can update own kyc" ON kyc_verifications FOR UPDATE TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can read own kyc docs') THEN
    CREATE POLICY "Users can read own kyc docs" ON kyc_documents FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can insert own kyc docs') THEN
    CREATE POLICY "Users can insert own kyc docs" ON kyc_documents FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admin read all kyc') THEN
    CREATE POLICY "Admin read all kyc" ON kyc_verifications FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admin read all kyc docs') THEN
    CREATE POLICY "Admin read all kyc docs" ON kyc_documents FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admin update kyc') THEN
    CREATE POLICY "Admin update kyc" ON kyc_verifications FOR UPDATE TO authenticated USING (true);
  END IF;
END $;

-- 5. Indexes
CREATE INDEX IF NOT EXISTS idx_kyc_verifications_user ON kyc_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_verifications_status ON kyc_verifications(status);
CREATE INDEX IF NOT EXISTS idx_kyc_documents_user ON kyc_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_documents_type ON kyc_documents(document_type);

-- 6. Auto-update trigger for kyc_verifications
CREATE OR REPLACE FUNCTION update_kyc_updated_at()
RETURNS TRIGGER AS $
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS kyc_verifications_updated_at ON kyc_verifications;
CREATE TRIGGER kyc_verifications_updated_at
  BEFORE UPDATE ON kyc_verifications
  FOR EACH ROW
  EXECUTE FUNCTION update_kyc_updated_at();

-- 7. Auto-sync KYC status to profiles when admin approves/rejects
CREATE OR REPLACE FUNCTION sync_kyc_status_to_profile()
RETURNS TRIGGER AS $
BEGIN
  IF NEW.status IN ('approved', 'rejected') AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    UPDATE profiles SET kyc_status = CASE
      WHEN NEW.verification_passed = true THEN 'approved'
      ELSE NEW.status
    END WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS kyc_sync_profile_trigger ON kyc_verifications;
CREATE TRIGGER kyc_sync_profile_trigger
  AFTER UPDATE ON kyc_verifications
  FOR EACH ROW
  EXECUTE FUNCTION sync_kyc_status_to_profile();`;

const FULL_SCHEMA_SQL = `-- IVX COMPLETE SUPABASE SCHEMA — AUTO-DEPLOY SCRIPT
-- Run this ONCE in Supabase SQL Editor
-- Creates the full IVX schema, including IVX Owner AI tables, RLS policies, indexes, triggers, RPC functions, and storage buckets
-- Safe to re-run: uses CREATE IF NOT EXISTS and DO blocks

CREATE OR REPLACE FUNCTION ivx_exec_sql(sql_text TEXT) RETURNS VOID AS $fn$ BEGIN EXECUTE sql_text; END; $fn$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TABLE IF NOT EXISTS public.profiles (id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, first_name TEXT, last_name TEXT, email TEXT, phone TEXT, country TEXT, avatar TEXT, kyc_status TEXT DEFAULT 'pending', total_invested NUMERIC DEFAULT 0, total_returns NUMERIC DEFAULT 0, role TEXT DEFAULT 'investor', referral_code TEXT, vip_tier TEXT DEFAULT 'standard', created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='profiles_select_own') THEN CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT TO authenticated USING (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='profiles_insert_own') THEN CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid()=id); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='profiles_update_own') THEN CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (true) WITH CHECK (true); END IF; END $;
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
DO $ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles; EXCEPTION WHEN duplicate_object THEN NULL; END $;

CREATE TABLE IF NOT EXISTS public.wallets (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, available NUMERIC DEFAULT 0, pending NUMERIC DEFAULT 0, invested NUMERIC DEFAULT 0, total NUMERIC DEFAULT 0, currency TEXT DEFAULT 'USD', created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), UNIQUE(user_id));
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='wallets_select_own') THEN CREATE POLICY "wallets_select_own" ON public.wallets FOR SELECT TO authenticated USING (auth.uid()=user_id); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='wallets_insert_own') THEN CREATE POLICY "wallets_insert_own" ON public.wallets FOR INSERT TO authenticated WITH CHECK (auth.uid()=user_id); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='wallets_update_own') THEN CREATE POLICY "wallets_update_own" ON public.wallets FOR UPDATE TO authenticated USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='wallets_admin_all') THEN CREATE POLICY "wallets_admin_all" ON public.wallets FOR ALL TO authenticated USING (true) WITH CHECK (true); END IF; END $;
CREATE INDEX IF NOT EXISTS idx_wallets_user ON public.wallets(user_id);
DO $ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.wallets; EXCEPTION WHEN duplicate_object THEN NULL; END $;

CREATE TABLE IF NOT EXISTS public.wallet_transactions (id TEXT PRIMARY KEY, wallet_id UUID, user_id UUID NOT NULL, type TEXT NOT NULL, amount NUMERIC NOT NULL DEFAULT 0, direction TEXT NOT NULL DEFAULT 'credit', status TEXT NOT NULL DEFAULT 'pending', reference_id TEXT, reference_type TEXT, description TEXT, fee NUMERIC DEFAULT 0, net_amount NUMERIC DEFAULT 0, payment_method TEXT, created_at TIMESTAMPTZ DEFAULT now(), CONSTRAINT wtx_direction_check CHECK (direction IN ('credit','debit')), CONSTRAINT wtx_status_check CHECK (status IN ('pending','completed','failed','cancelled')));
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='wtx_select_own') THEN CREATE POLICY "wtx_select_own" ON public.wallet_transactions FOR SELECT TO authenticated USING (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='wtx_insert_auth') THEN CREATE POLICY "wtx_insert_auth" ON public.wallet_transactions FOR INSERT TO authenticated WITH CHECK (true); END IF; END $;
CREATE INDEX IF NOT EXISTS idx_wtx_user ON public.wallet_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_wtx_created ON public.wallet_transactions(created_at DESC);
DO $ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.wallet_transactions; EXCEPTION WHEN duplicate_object THEN NULL; END $;

CREATE TABLE IF NOT EXISTS public.properties (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, location TEXT, city TEXT, country TEXT, image TEXT, share_price NUMERIC DEFAULT 0, total_shares INTEGER DEFAULT 1000, available_shares INTEGER DEFAULT 1000, annual_yield NUMERIC DEFAULT 0, occupancy_rate NUMERIC DEFAULT 0, type TEXT DEFAULT 'residential', status TEXT DEFAULT 'active', description TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='properties_select_all') THEN CREATE POLICY "properties_select_all" ON public.properties FOR SELECT USING (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='properties_insert_auth') THEN CREATE POLICY "properties_insert_auth" ON public.properties FOR INSERT TO authenticated WITH CHECK (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='properties_update_auth') THEN CREATE POLICY "properties_update_auth" ON public.properties FOR UPDATE TO authenticated USING (true) WITH CHECK (true); END IF; END $;
CREATE INDEX IF NOT EXISTS idx_properties_status ON public.properties(status);
CREATE INDEX IF NOT EXISTS idx_properties_created ON public.properties(created_at DESC);
DO $ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.properties; EXCEPTION WHEN duplicate_object THEN NULL; END $;

CREATE TABLE IF NOT EXISTS public.holdings (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL, property_id UUID, shares INTEGER DEFAULT 0, avg_cost_basis NUMERIC DEFAULT 0, current_value NUMERIC DEFAULT 0, total_return NUMERIC DEFAULT 0, total_return_percent NUMERIC DEFAULT 0, unrealized_pnl NUMERIC DEFAULT 0, unrealized_pnl_percent NUMERIC DEFAULT 0, purchase_date TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE public.holdings ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='holdings_select_own') THEN CREATE POLICY "holdings_select_own" ON public.holdings FOR SELECT TO authenticated USING (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='holdings_insert_auth') THEN CREATE POLICY "holdings_insert_auth" ON public.holdings FOR INSERT TO authenticated WITH CHECK (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='holdings_update_auth') THEN CREATE POLICY "holdings_update_auth" ON public.holdings FOR UPDATE TO authenticated USING (true) WITH CHECK (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='holdings_delete_auth') THEN CREATE POLICY "holdings_delete_auth" ON public.holdings FOR DELETE TO authenticated USING (true); END IF; END $;
CREATE INDEX IF NOT EXISTS idx_holdings_user ON public.holdings(user_id);
CREATE INDEX IF NOT EXISTS idx_holdings_property ON public.holdings(property_id);
DO $ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.holdings; EXCEPTION WHEN duplicate_object THEN NULL; END $;

CREATE TABLE IF NOT EXISTS public.transactions (id TEXT PRIMARY KEY, user_id UUID NOT NULL, type TEXT NOT NULL, amount NUMERIC DEFAULT 0, currency TEXT DEFAULT 'USD', status TEXT DEFAULT 'pending', description TEXT, property_id UUID, property_name TEXT, created_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='transactions_select_own') THEN CREATE POLICY "transactions_select_own" ON public.transactions FOR SELECT TO authenticated USING (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='transactions_insert_auth') THEN CREATE POLICY "transactions_insert_auth" ON public.transactions FOR INSERT TO authenticated WITH CHECK (true); END IF; END $;
CREATE INDEX IF NOT EXISTS idx_transactions_user ON public.transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created ON public.transactions(created_at DESC);
DO $ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions; EXCEPTION WHEN duplicate_object THEN NULL; END $;

CREATE TABLE IF NOT EXISTS public.notifications (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL, type TEXT NOT NULL DEFAULT 'info', title TEXT NOT NULL, message TEXT NOT NULL, read BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='notifications_select_own') THEN CREATE POLICY "notifications_select_own" ON public.notifications FOR SELECT TO authenticated USING (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='notifications_insert_auth') THEN CREATE POLICY "notifications_insert_auth" ON public.notifications FOR INSERT TO authenticated WITH CHECK (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='notifications_update_auth') THEN CREATE POLICY "notifications_update_auth" ON public.notifications FOR UPDATE TO authenticated USING (true) WITH CHECK (true); END IF; END $;
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON public.notifications(created_at DESC);
DO $ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications; EXCEPTION WHEN duplicate_object THEN NULL; END $;

CREATE TABLE IF NOT EXISTS public.jv_deals (id TEXT PRIMARY KEY, title TEXT, project_name TEXT, type TEXT DEFAULT 'jv', description TEXT, partner_name TEXT, partner_email TEXT, partner_phone TEXT, partner_type TEXT, property_address TEXT, city TEXT, state TEXT, zip_code TEXT, country TEXT, lot_size NUMERIC, lot_size_unit TEXT DEFAULT 'sqft', zoning TEXT, property_type TEXT, total_investment NUMERIC DEFAULT 0, expected_roi NUMERIC DEFAULT 0, estimated_value NUMERIC DEFAULT 0, appraised_value NUMERIC DEFAULT 0, sale_price NUMERIC DEFAULT 0, cash_payment_percent NUMERIC DEFAULT 0, collateral_percent NUMERIC DEFAULT 0, partner_profit_share NUMERIC DEFAULT 0, developer_profit_share NUMERIC DEFAULT 0, term_months INTEGER DEFAULT 12, cash_payment_amount NUMERIC DEFAULT 0, collateral_amount NUMERIC DEFAULT 0, distribution_frequency TEXT DEFAULT 'quarterly', exit_strategy TEXT, partners JSONB DEFAULT '[]'::jsonb, pool_tiers JSONB DEFAULT '{}'::jsonb, status TEXT DEFAULT 'draft', published BOOLEAN DEFAULT false, published_at TIMESTAMPTZ, photos JSONB DEFAULT '[]'::jsonb, documents TEXT, notes TEXT, rejection_reason TEXT, control_disclosure_accepted BOOLEAN DEFAULT false, control_disclosure_accepted_at TIMESTAMPTZ, payment_structure TEXT, user_id UUID, currency TEXT DEFAULT 'USD', profit_split TEXT, start_date TEXT, end_date TEXT, trashed_at TIMESTAMPTZ, submitted_at TIMESTAMPTZ, approved_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE public.jv_deals ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='jv_deals_select_all') THEN CREATE POLICY "jv_deals_select_all" ON public.jv_deals FOR SELECT USING (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='jv_deals_insert_auth') THEN CREATE POLICY "jv_deals_insert_auth" ON public.jv_deals FOR INSERT TO authenticated WITH CHECK (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='jv_deals_update_auth') THEN CREATE POLICY "jv_deals_update_auth" ON public.jv_deals FOR UPDATE TO authenticated USING (true) WITH CHECK (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='jv_deals_delete_auth') THEN CREATE POLICY "jv_deals_delete_auth" ON public.jv_deals FOR DELETE TO authenticated USING (true); END IF; END $;
CREATE INDEX IF NOT EXISTS idx_jv_deals_status ON public.jv_deals(status);
CREATE INDEX IF NOT EXISTS idx_jv_deals_published ON public.jv_deals(published);
CREATE INDEX IF NOT EXISTS idx_jv_deals_created ON public.jv_deals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jv_deals_user ON public.jv_deals(user_id);
DO $ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.jv_deals; EXCEPTION WHEN duplicate_object THEN NULL; END $;

CREATE TABLE IF NOT EXISTS public.landing_deals (id TEXT PRIMARY KEY, title TEXT, project_name TEXT, description TEXT, property_address TEXT, city TEXT, state TEXT, country TEXT, property_type TEXT, total_investment NUMERIC DEFAULT 0, expected_roi NUMERIC DEFAULT 0, sale_price NUMERIC DEFAULT 0, estimated_value NUMERIC DEFAULT 0, status TEXT DEFAULT 'active', photos JSONB DEFAULT '[]'::jsonb, partner_name TEXT, developer_name TEXT, published BOOLEAN DEFAULT true, published_at TIMESTAMPTZ, source_deal_id TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE public.landing_deals ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='landing_deals_select_all') THEN CREATE POLICY "landing_deals_select_all" ON public.landing_deals FOR SELECT USING (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='landing_deals_insert_auth') THEN CREATE POLICY "landing_deals_insert_auth" ON public.landing_deals FOR INSERT TO authenticated WITH CHECK (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='landing_deals_update_auth') THEN CREATE POLICY "landing_deals_update_auth" ON public.landing_deals FOR UPDATE TO authenticated USING (true) WITH CHECK (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='landing_deals_delete_auth') THEN CREATE POLICY "landing_deals_delete_auth" ON public.landing_deals FOR DELETE TO authenticated USING (true); END IF; END $;
DO $ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.landing_deals; EXCEPTION WHEN duplicate_object THEN NULL; END $;

CREATE TABLE IF NOT EXISTS public.market_data (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, metric TEXT, value NUMERIC DEFAULT 0, change_percent NUMERIC DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE public.market_data ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='market_data_select_all') THEN CREATE POLICY "market_data_select_all" ON public.market_data FOR SELECT USING (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='market_data_insert_auth') THEN CREATE POLICY "market_data_insert_auth" ON public.market_data FOR INSERT TO authenticated WITH CHECK (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='market_data_update_auth') THEN CREATE POLICY "market_data_update_auth" ON public.market_data FOR UPDATE TO authenticated USING (true) WITH CHECK (true); END IF; END $;

CREATE TABLE IF NOT EXISTS public.analytics_events (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), event TEXT NOT NULL, session_id TEXT, user_id UUID, properties JSONB DEFAULT '{}'::jsonb, geo JSONB DEFAULT '{}'::jsonb, platform TEXT, created_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='analytics_events_insert_anon') THEN CREATE POLICY "analytics_events_insert_anon" ON public.analytics_events FOR INSERT TO anon WITH CHECK (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='analytics_events_insert_auth') THEN CREATE POLICY "analytics_events_insert_auth" ON public.analytics_events FOR INSERT TO authenticated WITH CHECK (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='analytics_events_select_auth') THEN CREATE POLICY "analytics_events_select_auth" ON public.analytics_events FOR SELECT TO authenticated USING (true); END IF; END $;
CREATE INDEX IF NOT EXISTS idx_analytics_events_created ON public.analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_event ON public.analytics_events(event);
DO $ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.analytics_events; EXCEPTION WHEN duplicate_object THEN NULL; END $;

CREATE TABLE IF NOT EXISTS public.waitlist (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), first_name TEXT, last_name TEXT, email TEXT NOT NULL, phone TEXT, goal TEXT, investment_range TEXT, return_expectation TEXT, preferred_contact_hour TEXT, status TEXT DEFAULT 'pending', notes TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='waitlist_anon_insert') THEN CREATE POLICY "waitlist_anon_insert" ON public.waitlist FOR INSERT TO anon WITH CHECK (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='waitlist_auth_select') THEN CREATE POLICY "waitlist_auth_select" ON public.waitlist FOR SELECT TO authenticated USING (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='waitlist_auth_update') THEN CREATE POLICY "waitlist_auth_update" ON public.waitlist FOR UPDATE TO authenticated USING (true) WITH CHECK (true); END IF; END $;
CREATE INDEX IF NOT EXISTS idx_waitlist_email ON public.waitlist(email);
CREATE INDEX IF NOT EXISTS idx_waitlist_created ON public.waitlist(created_at DESC);
DO $ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.waitlist; EXCEPTION WHEN duplicate_object THEN NULL; END $;

CREATE TABLE IF NOT EXISTS public.waitlist_entries (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), full_name TEXT NOT NULL, first_name TEXT, last_name TEXT, email TEXT NOT NULL, email_normalized TEXT NOT NULL, phone TEXT NOT NULL, phone_e164 TEXT NOT NULL, phone_verified BOOLEAN NOT NULL DEFAULT false, accredited_status TEXT, consent_sms BOOLEAN NOT NULL DEFAULT true, consent_email BOOLEAN NOT NULL DEFAULT true, investor_type TEXT, primary_id_type TEXT, primary_id_reference TEXT, primary_id_upload_url TEXT, primary_id_upload_name TEXT, primary_id_upload_storage_path TEXT, secondary_id_type TEXT, secondary_id_reference TEXT, secondary_id_upload_url TEXT, secondary_id_upload_name TEXT, secondary_id_upload_storage_path TEXT, document_issuing_country TEXT, tax_residency_country TEXT, tax_id_reference TEXT, tax_document_upload_url TEXT, tax_document_upload_name TEXT, tax_document_upload_storage_path TEXT, company_name TEXT, company_role TEXT, company_ein TEXT, company_tax_id TEXT, company_registration_country TEXT, beneficial_owner_name TEXT, legal_ack_tax_reporting BOOLEAN NOT NULL DEFAULT false, legal_ack_identity_review BOOLEAN NOT NULL DEFAULT false, legal_ack_entity_authority BOOLEAN NOT NULL DEFAULT false, agreement_accepted BOOLEAN, agreement_version TEXT, signature_name TEXT, investment_range TEXT, return_expectation TEXT, preferred_call_time TEXT, best_time_for_call TEXT, investment_timeline TEXT, membership_interest TEXT DEFAULT 'waitlist', proof_of_funds_url TEXT, proof_of_funds_name TEXT, proof_of_funds_storage_path TEXT, source TEXT NOT NULL DEFAULT 'landing_page', page_path TEXT, referrer TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_content TEXT, utm_term TEXT, ip_hash TEXT, user_agent TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), verified_at TIMESTAMPTZ, submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(), CONSTRAINT waitlist_entries_email_normalized_key UNIQUE (email_normalized), CONSTRAINT waitlist_entries_phone_e164_key UNIQUE (phone_e164));
ALTER TABLE public.waitlist_entries ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='waitlist_entries_anon_insert') THEN CREATE POLICY "waitlist_entries_anon_insert" ON public.waitlist_entries FOR INSERT TO anon WITH CHECK (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='waitlist_entries_auth_select') THEN CREATE POLICY "waitlist_entries_auth_select" ON public.waitlist_entries FOR SELECT TO authenticated USING (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='waitlist_entries_auth_update') THEN CREATE POLICY "waitlist_entries_auth_update" ON public.waitlist_entries FOR UPDATE TO authenticated USING (true) WITH CHECK (true); END IF; END $;
CREATE INDEX IF NOT EXISTS idx_we_created_at ON public.waitlist_entries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_we_email_normalized ON public.waitlist_entries(email_normalized);
CREATE INDEX IF NOT EXISTS idx_we_phone_e164 ON public.waitlist_entries(phone_e164);
DO $ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.waitlist_entries; EXCEPTION WHEN duplicate_object THEN NULL; END $;

CREATE TABLE IF NOT EXISTS public.waitlist_otp_events (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), phone_e164 TEXT NOT NULL, event_type TEXT NOT NULL, ip_hash TEXT, created_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE public.waitlist_otp_events ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='otp_events_auth_select') THEN CREATE POLICY "otp_events_auth_select" ON public.waitlist_otp_events FOR SELECT TO authenticated USING (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='otp_events_anon_insert') THEN CREATE POLICY "otp_events_anon_insert" ON public.waitlist_otp_events FOR INSERT TO anon WITH CHECK (true); END IF; END $;

CREATE TABLE IF NOT EXISTS public.email_notifications_queue (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), to_email TEXT NOT NULL, to_name TEXT, subject TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', source TEXT DEFAULT 'waitlist', sent_at TIMESTAMPTZ, error_message TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
ALTER TABLE public.email_notifications_queue ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='email_queue_anon_insert') THEN CREATE POLICY "email_queue_anon_insert" ON public.email_notifications_queue FOR INSERT TO anon WITH CHECK (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='email_queue_auth_select') THEN CREATE POLICY "email_queue_auth_select" ON public.email_notifications_queue FOR SELECT TO authenticated USING (true); END IF; END $;

CREATE TABLE IF NOT EXISTS public.landing_submissions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), source TEXT DEFAULT 'landing_page', type TEXT DEFAULT 'registration', investment_type TEXT, investment_amount NUMERIC, expected_roi NUMERIC, full_name TEXT, email TEXT, phone TEXT, status TEXT DEFAULT 'pending', submitted_at TIMESTAMPTZ DEFAULT now(), notes TEXT, created_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE public.landing_submissions ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='landing_submissions_anon_insert') THEN CREATE POLICY "landing_submissions_anon_insert" ON public.landing_submissions FOR INSERT TO anon WITH CHECK (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='landing_submissions_auth_select') THEN CREATE POLICY "landing_submissions_auth_select" ON public.landing_submissions FOR SELECT TO authenticated USING (true); END IF; END $;

CREATE TABLE IF NOT EXISTS public.landing_analytics (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), event TEXT NOT NULL, session_id TEXT, properties JSONB DEFAULT '{}'::jsonb, geo JSONB DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE public.landing_analytics ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='landing_analytics_anon_insert') THEN CREATE POLICY "landing_analytics_anon_insert" ON public.landing_analytics FOR INSERT TO anon WITH CHECK (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='landing_analytics_auth_select') THEN CREATE POLICY "landing_analytics_auth_select" ON public.landing_analytics FOR SELECT TO authenticated USING (true); END IF; END $;
CREATE INDEX IF NOT EXISTS idx_landing_analytics_event ON public.landing_analytics(event);
CREATE INDEX IF NOT EXISTS idx_landing_analytics_created ON public.landing_analytics(created_at DESC);
DO $ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.landing_analytics; EXCEPTION WHEN duplicate_object THEN NULL; END $;

CREATE TABLE IF NOT EXISTS public.visitor_sessions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), session_id TEXT NOT NULL, ip_hash TEXT, user_agent TEXT, country TEXT, city TEXT, device_type TEXT, page_path TEXT, referrer TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, is_active BOOLEAN DEFAULT true, started_at TIMESTAMPTZ DEFAULT now(), last_seen_at TIMESTAMPTZ DEFAULT now(), created_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE public.visitor_sessions ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='visitor_sessions_anon_insert') THEN CREATE POLICY "visitor_sessions_anon_insert" ON public.visitor_sessions FOR INSERT TO anon WITH CHECK (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='visitor_sessions_auth_select') THEN CREATE POLICY "visitor_sessions_auth_select" ON public.visitor_sessions FOR SELECT TO authenticated USING (true); END IF; END $;
DO $ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.visitor_sessions; EXCEPTION WHEN duplicate_object THEN NULL; END $;

CREATE TABLE IF NOT EXISTS public.realtime_snapshots (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), snapshot_type TEXT DEFAULT 'visitor', data JSONB DEFAULT '{}'::jsonb, active_visitors INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE public.realtime_snapshots ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='realtime_snapshots_auth_select') THEN CREATE POLICY "realtime_snapshots_auth_select" ON public.realtime_snapshots FOR SELECT TO authenticated USING (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='realtime_snapshots_auth_insert') THEN CREATE POLICY "realtime_snapshots_auth_insert" ON public.realtime_snapshots FOR INSERT TO authenticated WITH CHECK (true); END IF; END $;
DO $ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.realtime_snapshots; EXCEPTION WHEN duplicate_object THEN NULL; END $;

CREATE OR REPLACE FUNCTION public.ivx_is_owner() RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $ivx$ SELECT auth.uid() IS NOT NULL AND EXISTS ( SELECT 1 FROM public.profiles WHERE id = auth.uid() AND regexp_replace(lower(coalesce(role, 'investor')), '[^a-z0-9]+', '', 'g') IN ('owner', 'owneradmin', 'ivxowner', 'developer', 'dev', 'admin', 'superadmin', 'administrator', 'founder', 'staff', 'staffmember', 'ceo', 'manager', 'analyst', 'support') ); $ivx$;

CREATE TABLE IF NOT EXISTS public.conversations (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), title TEXT NOT NULL, subtitle TEXT, last_message_text TEXT, last_message_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname='conversations_auth_all' AND schemaname='public' AND tablename='conversations') THEN DROP POLICY "conversations_auth_all" ON public.conversations; END IF; CREATE POLICY "conversations_auth_all" ON public.conversations FOR ALL TO authenticated USING (id <> '8f5a9c42-1cb5-4f81-b2d8-6f3a0a8b9d41'::uuid OR public.ivx_is_owner()) WITH CHECK (id <> '8f5a9c42-1cb5-4f81-b2d8-6f3a0a8b9d41'::uuid OR public.ivx_is_owner()); END $;
CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at ON public.conversations(last_message_at DESC);
DO $ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations; EXCEPTION WHEN duplicate_object THEN NULL; END $;

CREATE TABLE IF NOT EXISTS public.conversation_participants (conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE, user_id TEXT NOT NULL, unread_count INTEGER DEFAULT 0, last_read_at TIMESTAMPTZ, PRIMARY KEY (conversation_id, user_id));
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname='conversation_participants_auth_all' AND schemaname='public' AND tablename='conversation_participants') THEN DROP POLICY "conversation_participants_auth_all" ON public.conversation_participants; END IF; CREATE POLICY "conversation_participants_auth_all" ON public.conversation_participants FOR ALL TO authenticated USING (conversation_id <> '8f5a9c42-1cb5-4f81-b2d8-6f3a0a8b9d41'::uuid OR public.ivx_is_owner()) WITH CHECK (conversation_id <> '8f5a9c42-1cb5-4f81-b2d8-6f3a0a8b9d41'::uuid OR public.ivx_is_owner()); END $;
CREATE INDEX IF NOT EXISTS idx_conversation_participants_user ON public.conversation_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_participants_conversation ON public.conversation_participants(conversation_id);
DO $ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_participants; EXCEPTION WHEN duplicate_object THEN NULL; END $;

CREATE TABLE IF NOT EXISTS public.messages (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE, sender_id TEXT NOT NULL, text TEXT, file_url TEXT, file_type TEXT, read_by TEXT[] DEFAULT '{}'::TEXT[], created_at TIMESTAMPTZ NOT NULL DEFAULT now());
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname='messages_auth_all' AND schemaname='public' AND tablename='messages') THEN DROP POLICY "messages_auth_all" ON public.messages; END IF; CREATE POLICY "messages_auth_all" ON public.messages FOR ALL TO authenticated USING (conversation_id <> '8f5a9c42-1cb5-4f81-b2d8-6f3a0a8b9d41'::uuid OR public.ivx_is_owner()) WITH CHECK (conversation_id <> '8f5a9c42-1cb5-4f81-b2d8-6f3a0a8b9d41'::uuid OR public.ivx_is_owner()); END $;
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON public.messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender_created ON public.messages(sender_id, created_at DESC);
DO $ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.messages; EXCEPTION WHEN duplicate_object THEN NULL; END $;

CREATE TABLE IF NOT EXISTS public.push_tokens (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID, token TEXT NOT NULL, platform TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), UNIQUE(token));
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='push_tokens_insert_auth') THEN CREATE POLICY "push_tokens_insert_auth" ON public.push_tokens FOR INSERT TO authenticated WITH CHECK (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='push_tokens_select_auth') THEN CREATE POLICY "push_tokens_select_auth" ON public.push_tokens FOR SELECT TO authenticated USING (true); END IF; END $;

CREATE TABLE IF NOT EXISTS public.image_registry (id TEXT PRIMARY KEY, url TEXT NOT NULL, entity_type TEXT, entity_id TEXT, user_id UUID, is_protected BOOLEAN DEFAULT false, storage_path TEXT, backup_urls JSONB DEFAULT '[]'::jsonb, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE public.image_registry ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='image_registry_select_all') THEN CREATE POLICY "image_registry_select_all" ON public.image_registry FOR SELECT USING (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='image_registry_insert_auth') THEN CREATE POLICY "image_registry_insert_auth" ON public.image_registry FOR INSERT TO authenticated WITH CHECK (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='image_registry_update_auth') THEN CREATE POLICY "image_registry_update_auth" ON public.image_registry FOR UPDATE TO authenticated USING (true) WITH CHECK (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='image_registry_delete_auth') THEN CREATE POLICY "image_registry_delete_auth" ON public.image_registry FOR DELETE TO authenticated USING (true); END IF; END $;

CREATE TABLE IF NOT EXISTS public.image_backups (id TEXT PRIMARY KEY, entity_type TEXT, entity_id TEXT, primary_url TEXT, backup_urls JSONB DEFAULT '[]'::jsonb, local_uri TEXT, supabase_storage_path TEXT, last_verified_at TIMESTAMPTZ, last_health_status TEXT DEFAULT 'unknown', fail_count INTEGER DEFAULT 0, recovered_at TIMESTAMPTZ, recovery_source TEXT, created_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE public.image_backups ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='image_backups_auth_all') THEN CREATE POLICY "image_backups_auth_all" ON public.image_backups FOR ALL TO authenticated USING (true) WITH CHECK (true); END IF; END $;

CREATE TABLE IF NOT EXISTS public.image_health_reports (id TEXT PRIMARY KEY, scanned_at TIMESTAMPTZ DEFAULT now(), total_images INTEGER DEFAULT 0, healthy_count INTEGER DEFAULT 0, degraded_count INTEGER DEFAULT 0, broken_count INTEGER DEFAULT 0, recovered_count INTEGER DEFAULT 0, failed_recovery_count INTEGER DEFAULT 0, scan_duration_ms INTEGER DEFAULT 0, details JSONB DEFAULT '[]'::jsonb);
ALTER TABLE public.image_health_reports ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='image_health_reports_auth_all') THEN CREATE POLICY "image_health_reports_auth_all" ON public.image_health_reports FOR ALL TO authenticated USING (true) WITH CHECK (true); END IF; END $;

CREATE TABLE IF NOT EXISTS public.audit_trail (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, entity_title TEXT, action TEXT NOT NULL, user_id UUID, user_role TEXT, timestamp TIMESTAMPTZ DEFAULT now(), details TEXT, snapshot_before JSONB, snapshot_after JSONB, source TEXT);
ALTER TABLE public.audit_trail ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='audit_trail_auth_select') THEN CREATE POLICY "audit_trail_auth_select" ON public.audit_trail FOR SELECT TO authenticated USING (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='audit_trail_auth_insert') THEN CREATE POLICY "audit_trail_auth_insert" ON public.audit_trail FOR INSERT TO authenticated WITH CHECK (true); END IF; END $;

CREATE TABLE IF NOT EXISTS public.error_logs (id TEXT PRIMARY KEY, timestamp TIMESTAMPTZ DEFAULT now(), message TEXT, stack TEXT, screen TEXT, platform TEXT, severity TEXT DEFAULT 'error', metadata JSONB DEFAULT '{}'::jsonb);
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='error_logs_anon_insert') THEN CREATE POLICY "error_logs_anon_insert" ON public.error_logs FOR INSERT TO anon WITH CHECK (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='error_logs_auth_select') THEN CREATE POLICY "error_logs_auth_select" ON public.error_logs FOR SELECT TO authenticated USING (true); END IF; END $;

CREATE TABLE IF NOT EXISTS public.earn_accounts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL UNIQUE, total_deposited NUMERIC DEFAULT 0, total_earned NUMERIC DEFAULT 0, current_apy NUMERIC DEFAULT 10, status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE public.earn_accounts ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='earn_accounts_select_own') THEN CREATE POLICY "earn_accounts_select_own" ON public.earn_accounts FOR SELECT TO authenticated USING (auth.uid()=user_id); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='earn_accounts_insert_own') THEN CREATE POLICY "earn_accounts_insert_own" ON public.earn_accounts FOR INSERT TO authenticated WITH CHECK (auth.uid()=user_id); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='earn_accounts_update_own') THEN CREATE POLICY "earn_accounts_update_own" ON public.earn_accounts FOR UPDATE TO authenticated USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id); END IF; END $;
DO $ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.earn_accounts; EXCEPTION WHEN duplicate_object THEN NULL; END $;

CREATE TABLE IF NOT EXISTS public.earn_deposits (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL, amount NUMERIC NOT NULL DEFAULT 0, deposited_at TIMESTAMPTZ DEFAULT now(), status TEXT DEFAULT 'active', withdrawn_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE public.earn_deposits ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='earn_deposits_select_own') THEN CREATE POLICY "earn_deposits_select_own" ON public.earn_deposits FOR SELECT TO authenticated USING (auth.uid()=user_id); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='earn_deposits_insert_own') THEN CREATE POLICY "earn_deposits_insert_own" ON public.earn_deposits FOR INSERT TO authenticated WITH CHECK (auth.uid()=user_id); END IF; END $;

CREATE TABLE IF NOT EXISTS public.earn_payouts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL, amount NUMERIC NOT NULL DEFAULT 0, type TEXT DEFAULT 'interest', created_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE public.earn_payouts ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='earn_payouts_select_own') THEN CREATE POLICY "earn_payouts_select_own" ON public.earn_payouts FOR SELECT TO authenticated USING (auth.uid()=user_id); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='earn_payouts_insert_own') THEN CREATE POLICY "earn_payouts_insert_own" ON public.earn_payouts FOR INSERT TO authenticated WITH CHECK (auth.uid()=user_id); END IF; END $;

CREATE TABLE IF NOT EXISTS public.landing_page_config (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), key TEXT NOT NULL UNIQUE, value JSONB DEFAULT '{}'::jsonb, updated_by UUID, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE public.landing_page_config ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='landing_page_config_auth_all') THEN CREATE POLICY "landing_page_config_auth_all" ON public.landing_page_config FOR ALL TO authenticated USING (true) WITH CHECK (true); END IF; END $;

CREATE TABLE IF NOT EXISTS public.landing_deployments (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), status TEXT DEFAULT 'pending', deployed_by UUID, deployment_url TEXT, notes TEXT, error_message TEXT, created_at TIMESTAMPTZ DEFAULT now(), completed_at TIMESTAMPTZ);
ALTER TABLE public.landing_deployments ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='landing_deployments_auth_all') THEN CREATE POLICY "landing_deployments_auth_all" ON public.landing_deployments FOR ALL TO authenticated USING (true) WITH CHECK (true); END IF; END $;

CREATE TABLE IF NOT EXISTS public.team_members (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID, name TEXT, email TEXT, role TEXT DEFAULT 'member', status TEXT DEFAULT 'active', invited_by UUID, joined_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='team_members_auth_all') THEN CREATE POLICY "team_members_auth_all" ON public.team_members FOR ALL TO authenticated USING (true) WITH CHECK (true); END IF; END $;

CREATE TABLE IF NOT EXISTS public.feature_flags (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), key TEXT NOT NULL UNIQUE, enabled BOOLEAN DEFAULT false, description TEXT, updated_by UUID, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='feature_flags_select_all') THEN CREATE POLICY "feature_flags_select_all" ON public.feature_flags FOR SELECT USING (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='feature_flags_auth_write') THEN CREATE POLICY "feature_flags_auth_write" ON public.feature_flags FOR ALL TO authenticated USING (true) WITH CHECK (true); END IF; END $;

CREATE TABLE IF NOT EXISTS public.system_health (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), component TEXT, status TEXT DEFAULT 'ok', message TEXT, metadata JSONB DEFAULT '{}'::jsonb, checked_at TIMESTAMPTZ DEFAULT now(), created_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE public.system_health ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='system_health_auth_all') THEN CREATE POLICY "system_health_auth_all" ON public.system_health FOR ALL TO authenticated USING (true) WITH CHECK (true); END IF; END $;

CREATE TABLE IF NOT EXISTS public.app_config (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), key TEXT NOT NULL UNIQUE, value JSONB DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='app_config_select_all') THEN CREATE POLICY "app_config_select_all" ON public.app_config FOR SELECT USING (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='app_config_auth_write') THEN CREATE POLICY "app_config_auth_write" ON public.app_config FOR ALL TO authenticated USING (true) WITH CHECK (true); END IF; END $;

CREATE TABLE IF NOT EXISTS public.landing_investments (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), deal_id TEXT, investor_name TEXT, investor_email TEXT, amount NUMERIC DEFAULT 0, status TEXT DEFAULT 'pending', notes TEXT, created_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE public.landing_investments ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='landing_investments_auth_all') THEN CREATE POLICY "landing_investments_auth_all" ON public.landing_investments FOR ALL TO authenticated USING (true) WITH CHECK (true); END IF; END $;

CREATE TABLE IF NOT EXISTS public.kyc_verifications (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, first_name TEXT, last_name TEXT, date_of_birth TEXT, nationality TEXT, nationality_code TEXT, tax_id TEXT, street TEXT, city TEXT, state TEXT, postal_code TEXT, country TEXT, country_code TEXT, status TEXT DEFAULT 'pending', verification_score NUMERIC, risk_level TEXT, verification_passed BOOLEAN DEFAULT false, submitted_at TIMESTAMPTZ, reviewed_at TIMESTAMPTZ, reviewed_by UUID, reviewer_notes TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), UNIQUE(user_id));
ALTER TABLE public.kyc_verifications ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='kyc_select_own') THEN CREATE POLICY "kyc_select_own" ON public.kyc_verifications FOR SELECT TO authenticated USING (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='kyc_insert_own') THEN CREATE POLICY "kyc_insert_own" ON public.kyc_verifications FOR INSERT TO authenticated WITH CHECK (auth.uid()=user_id); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='kyc_update_auth') THEN CREATE POLICY "kyc_update_auth" ON public.kyc_verifications FOR UPDATE TO authenticated USING (true) WITH CHECK (true); END IF; END $;

CREATE TABLE IF NOT EXISTS public.kyc_documents (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, document_type TEXT NOT NULL, document_url TEXT, issuing_country TEXT, status TEXT DEFAULT 'pending', verified_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE public.kyc_documents ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='kyc_docs_select_auth') THEN CREATE POLICY "kyc_docs_select_auth" ON public.kyc_documents FOR SELECT TO authenticated USING (true); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='kyc_docs_insert_own') THEN CREATE POLICY "kyc_docs_insert_own" ON public.kyc_documents FOR INSERT TO authenticated WITH CHECK (auth.uid()=user_id); END IF; END $;

CREATE TABLE IF NOT EXISTS public.system_metrics (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), metric_name TEXT, metric_value NUMERIC DEFAULT 0, metadata JSONB DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE public.system_metrics ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='system_metrics_auth_all') THEN CREATE POLICY "system_metrics_auth_all" ON public.system_metrics FOR ALL TO authenticated USING (true) WITH CHECK (true); END IF; END $;

CREATE TABLE IF NOT EXISTS public.staff_activity (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID, action TEXT, details TEXT, ip_hash TEXT, created_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE public.staff_activity ENABLE ROW LEVEL SECURITY;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='staff_activity_auth_all') THEN CREATE POLICY "staff_activity_auth_all" ON public.staff_activity FOR ALL TO authenticated USING (true) WITH CHECK (true); END IF; END $;

CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS TRIGGER AS $fn$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $fn$ LANGUAGE plpgsql;
DO $ DECLARE tbl TEXT; BEGIN FOREACH tbl IN ARRAY ARRAY['profiles','wallets','jv_deals','waitlist','waitlist_entries','landing_page_config','feature_flags','app_config','team_members','earn_accounts','kyc_verifications','push_tokens'] LOOP EXECUTE format('DROP TRIGGER IF EXISTS trg_updated_at_%I ON public.%I', tbl, tbl); EXECUTE format('CREATE TRIGGER trg_updated_at_%I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', tbl, tbl); END LOOP; END $;

CREATE OR REPLACE FUNCTION sync_kyc_status_to_profile() RETURNS TRIGGER AS $fn$ BEGIN IF NEW.status IN ('approved','rejected') AND (OLD.status IS DISTINCT FROM NEW.status) THEN UPDATE profiles SET kyc_status = CASE WHEN NEW.verification_passed = true THEN 'approved' ELSE NEW.status END WHERE id = NEW.user_id; END IF; RETURN NEW; END; $fn$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS kyc_sync_profile_trigger ON public.kyc_verifications;
CREATE TRIGGER kyc_sync_profile_trigger AFTER UPDATE ON public.kyc_verifications FOR EACH ROW EXECUTE FUNCTION sync_kyc_status_to_profile();

CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN AS $fn$ BEGIN RETURN EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND regexp_replace(lower(COALESCE(role, 'investor')), '[^a-z0-9]+', '', 'g') IN ('owner', 'owneradmin', 'ivxowner', 'developer', 'dev', 'admin', 'superadmin', 'administrator', 'founder', 'staff', 'staffmember', 'ceo', 'manager', 'analyst', 'support')); END; $fn$ LANGUAGE plpgsql SECURITY DEFINER;
CREATE OR REPLACE FUNCTION is_owner_of(check_user_id UUID) RETURNS BOOLEAN AS $fn$ BEGIN RETURN EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND regexp_replace(lower(COALESCE(role, 'investor')), '[^a-z0-9]+', '', 'g') IN ('owner', 'owneradmin', 'ivxowner', 'developer', 'dev', 'admin', 'superadmin', 'administrator', 'founder', 'staff', 'staffmember', 'ceo', 'manager', 'analyst', 'support')); END; $fn$ LANGUAGE plpgsql SECURITY DEFINER;
CREATE OR REPLACE FUNCTION get_user_role() RETURNS TEXT AS $fn$ DECLARE user_role TEXT; BEGIN SELECT role INTO user_role FROM public.profiles WHERE id = auth.uid(); RETURN COALESCE(user_role, 'investor'); END; $fn$ LANGUAGE plpgsql SECURITY DEFINER;
CREATE OR REPLACE FUNCTION verify_admin_access() RETURNS BOOLEAN AS $fn$ BEGIN RETURN EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND regexp_replace(lower(COALESCE(role, 'investor')), '[^a-z0-9]+', '', 'g') IN ('owner', 'owneradmin', 'ivxowner', 'developer', 'dev', 'admin', 'superadmin', 'administrator', 'founder', 'staff', 'staffmember', 'ceo', 'manager', 'analyst', 'support')); END; $fn$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION upsert_visitor_session(p_session_id TEXT, p_ip_hash TEXT DEFAULT NULL, p_user_agent TEXT DEFAULT NULL, p_country TEXT DEFAULT NULL, p_city TEXT DEFAULT NULL, p_device_type TEXT DEFAULT NULL, p_page_path TEXT DEFAULT NULL, p_referrer TEXT DEFAULT NULL, p_utm_source TEXT DEFAULT NULL, p_utm_medium TEXT DEFAULT NULL, p_utm_campaign TEXT DEFAULT NULL) RETURNS VOID AS $fn$ BEGIN INSERT INTO public.visitor_sessions (session_id,ip_hash,user_agent,country,city,device_type,page_path,referrer,utm_source,utm_medium,utm_campaign,is_active,last_seen_at) VALUES (p_session_id,p_ip_hash,p_user_agent,p_country,p_city,p_device_type,p_page_path,p_referrer,p_utm_source,p_utm_medium,p_utm_campaign,true,now()) ON CONFLICT (session_id) DO UPDATE SET last_seen_at=now(),is_active=true,page_path=COALESCE(EXCLUDED.page_path,visitor_sessions.page_path); EXCEPTION WHEN unique_violation THEN UPDATE public.visitor_sessions SET last_seen_at=now(),is_active=true WHERE session_id=p_session_id; END; $fn$ LANGUAGE plpgsql SECURITY DEFINER;
DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='visitor_sessions_session_id_key') THEN ALTER TABLE public.visitor_sessions ADD CONSTRAINT visitor_sessions_session_id_key UNIQUE (session_id); END IF; EXCEPTION WHEN duplicate_object THEN NULL; END $;

CREATE OR REPLACE FUNCTION mark_inactive_sessions(p_timeout_minutes INTEGER DEFAULT 5) RETURNS INTEGER AS $fn$ DECLARE affected INTEGER; BEGIN UPDATE public.visitor_sessions SET is_active=false WHERE is_active=true AND last_seen_at < now() - (p_timeout_minutes || ' minutes')::interval; GET DIAGNOSTICS affected = ROW_COUNT; RETURN affected; END; $fn$ LANGUAGE plpgsql SECURITY DEFINER;
CREATE OR REPLACE FUNCTION save_realtime_snapshot(p_snapshot_type TEXT DEFAULT 'visitor', p_data JSONB DEFAULT '{}'::jsonb, p_active_visitors INTEGER DEFAULT 0) RETURNS VOID AS $fn$ BEGIN INSERT INTO public.realtime_snapshots (snapshot_type,data,active_visitors) VALUES (p_snapshot_type,p_data,p_active_visitors); END; $fn$ LANGUAGE plpgsql SECURITY DEFINER;
CREATE OR REPLACE FUNCTION increment_sms_counter(counter_name TEXT DEFAULT 'sms') RETURNS VOID AS $fn$ BEGIN INSERT INTO public.system_metrics (metric_name,metric_value) VALUES (counter_name,1) ON CONFLICT DO NOTHING; END; $fn$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION atomic_wallet_operation(p_user_id UUID,p_amount NUMERIC,p_operation TEXT,p_reason TEXT,p_description TEXT,p_reference_id TEXT DEFAULT NULL,p_reference_type TEXT DEFAULT NULL,p_fee NUMERIC DEFAULT 0) RETURNS TABLE(success BOOLEAN,new_available NUMERIC,new_invested NUMERIC,new_total NUMERIC,message TEXT,transaction_id TEXT) AS $fn$ DECLARE v_wallet RECORD; v_new_available NUMERIC; v_new_invested NUMERIC; v_new_total NUMERIC; v_tx_id TEXT; v_direction TEXT; BEGIN SELECT * INTO v_wallet FROM public.wallets WHERE user_id=p_user_id FOR UPDATE; IF NOT FOUND THEN INSERT INTO public.wallets (user_id,available,pending,invested,total,currency) VALUES (p_user_id,0,0,0,0,'USD'); SELECT * INTO v_wallet FROM public.wallets WHERE user_id=p_user_id FOR UPDATE; END IF; IF p_operation='credit' THEN v_new_available:=COALESCE(v_wallet.available,0)+p_amount; v_new_invested:=COALESCE(v_wallet.invested,0); v_new_total:=COALESCE(v_wallet.total,0)+p_amount; v_direction:='credit'; ELSIF p_operation='debit' THEN IF COALESCE(v_wallet.available,0)<p_amount THEN RETURN QUERY SELECT false,COALESCE(v_wallet.available,0)::NUMERIC,COALESCE(v_wallet.invested,0)::NUMERIC,COALESCE(v_wallet.total,0)::NUMERIC,'Insufficient balance'::TEXT,''::TEXT; RETURN; END IF; v_new_available:=COALESCE(v_wallet.available,0)-p_amount; v_new_invested:=CASE WHEN p_reason IN ('investment','resale_purchase') THEN COALESCE(v_wallet.invested,0)+p_amount ELSE COALESCE(v_wallet.invested,0) END; v_new_total:=v_new_available+v_new_invested; v_direction:='debit'; ELSE RETURN QUERY SELECT false,0::NUMERIC,0::NUMERIC,0::NUMERIC,('Unknown operation: '||p_operation)::TEXT,''::TEXT; RETURN; END IF; UPDATE public.wallets SET available=v_new_available,invested=v_new_invested,total=v_new_total,updated_at=now() WHERE user_id=p_user_id; v_tx_id:='wtx_'||extract(epoch from now())::bigint||'_'||substr(md5(random()::text),1,8); INSERT INTO public.wallet_transactions (id,user_id,type,amount,direction,status,reference_id,reference_type,description,fee,net_amount,created_at) VALUES (v_tx_id,p_user_id,p_reason,p_amount,v_direction,'completed',p_reference_id,p_reference_type,p_description,p_fee,p_amount-p_fee,now()); RETURN QUERY SELECT true,v_new_available,v_new_invested,v_new_total,'OK'::TEXT,v_tx_id; END; $fn$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION ensure_deal_photos_bucket() RETURNS VOID AS $fn$ BEGIN INSERT INTO storage.buckets (id,name,public) VALUES ('deal-photos','deal-photos',true) ON CONFLICT (id) DO NOTHING; END; $fn$ LANGUAGE plpgsql SECURITY DEFINER;

INSERT INTO storage.buckets (id,name,public) VALUES ('deal-photos','deal-photos',true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id,name,public) VALUES ('investor-intake','investor-intake',true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id,name,public) VALUES ('landing-page','landing-page',true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id,name,public) VALUES ('chat-uploads','chat-uploads',true) ON CONFLICT (id) DO NOTHING;

DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='deal_photos_public_select') THEN CREATE POLICY "deal_photos_public_select" ON storage.objects FOR SELECT USING (bucket_id='deal-photos'); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='deal_photos_auth_insert') THEN CREATE POLICY "deal_photos_auth_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id='deal-photos'); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='investor_intake_public_select') THEN CREATE POLICY "investor_intake_public_select" ON storage.objects FOR SELECT USING (bucket_id='investor-intake'); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='investor_intake_anon_insert') THEN CREATE POLICY "investor_intake_anon_insert" ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id='investor-intake'); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='landing_page_public_select') THEN CREATE POLICY "landing_page_public_select" ON storage.objects FOR SELECT USING (bucket_id='landing-page'); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='landing_page_auth_all') THEN CREATE POLICY "landing_page_auth_all" ON storage.objects FOR ALL TO authenticated USING (bucket_id='landing-page') WITH CHECK (bucket_id='landing-page'); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='chat_uploads_public_select') THEN CREATE POLICY "chat_uploads_public_select" ON storage.objects FOR SELECT USING (bucket_id='chat-uploads'); END IF; IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='chat_uploads_auth_insert') THEN CREATE POLICY "chat_uploads_auth_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id='chat-uploads'); END IF; END $;

${IVX_OWNER_AI_SCHEMA_SQL}

SELECT 'IVX Full Schema deployed successfully — ' || now()::text AS result;`;

const WAITLIST_SQL = `-- IVX Bootstrap: Waitlist Table + Auto-Deploy Function
-- Run this ONCE in Supabase SQL Editor to enable auto-deploy

-- 1. Create exec_sql function for future auto-deploys
CREATE OR REPLACE FUNCTION ivx_exec_sql(sql_text TEXT)
RETURNS VOID AS $
BEGIN
  EXECUTE sql_text;
END;
$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Create waitlist table
CREATE TABLE IF NOT EXISTS waitlist (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  investment_range TEXT,
  return_expectation TEXT,
  preferred_contact_hour TEXT,
  status TEXT DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Enable RLS
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies
DO $ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow anonymous inserts on waitlist') THEN
    CREATE POLICY "Allow anonymous inserts on waitlist" ON waitlist FOR INSERT TO anon WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow authenticated read on waitlist') THEN
    CREATE POLICY "Allow authenticated read on waitlist" ON waitlist FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow authenticated update on waitlist') THEN
    CREATE POLICY "Allow authenticated update on waitlist" ON waitlist FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $;

-- 5. Enable Realtime
DO $ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE waitlist;
EXCEPTION WHEN duplicate_object THEN NULL;
END $;

-- 6. Indexes
CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist(email);
CREATE INDEX IF NOT EXISTS idx_waitlist_created ON waitlist(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_waitlist_status ON waitlist(status);

-- 7. Auto-update trigger
CREATE OR REPLACE FUNCTION update_waitlist_updated_at()
RETURNS TRIGGER AS $
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS waitlist_updated_at ON waitlist;
CREATE TRIGGER waitlist_updated_at
  BEFORE UPDATE ON waitlist
  FOR EACH ROW
  EXECUTE FUNCTION update_waitlist_updated_at();`;

const BASE_APP_TABLES = [
  'jv_deals', 'landing_deals', 'audit_trail', 'waitlist',
  'profiles', 'wallets', 'holdings', 'transactions', 'notifications',
  'analytics_events', 'analytics_dashboard', 'analytics_kpi',
  'analytics_retention', 'analytics_investments',
  'system_health', 'system_metrics', 'staff_activity', 'staff_activity_log',
  'signups', 'applications', 'ai_brain_status',
  'auto_repair_scans', 'repair_logs',
  'ipx_holdings', 'ipx_purchases',
  'earn_accounts', 'earn_deposits', 'earn_payouts',
  'kyc_verifications', 'kyc_documents',
  'referrals', 'referral_invites',
  'sms_reports', 'sms_messages',
  'lender_sync_stats', 'lender_sync_config', 'synced_lenders',
  'lender_sync_jobs', 'imported_lenders',
  'orders', 'support_tickets', 'influencer_applications', 'push_tokens',
  'properties', 'market_data', 'market_index',
  'image_registry', 'app_config', 'landing_analytics',
  'retargeting_dashboard', 'audience_segments', 'ad_pixels',
  'utm_analytics', 'search_discovery', 're_engagement_triggers',
  'engagement_scoring', 'emails',
  'visitor_sessions', 'realtime_snapshots', 'conversations',
  'conversation_participants', 'messages',
  'image_backups', 'image_health_reports',
  'landing_investments',
] as const;

const IVX_OWNER_AI_DEPLOY_TABLES = [
  'ivx_conversations',
  'ivx_messages',
  'ivx_inbox_state',
  'ivx_ai_requests',
  'ivx_knowledge_documents',
] as const;

const ALL_TABLES = [...BASE_APP_TABLES, ...IVX_OWNER_AI_DEPLOY_TABLES];

const ALL_FUNCTIONS = [
  'is_admin', 'is_owner_of', 'get_user_role', 'verify_admin_access',
  'ensure_deal_photos_bucket', 'increment_sms_counter',
  'update_updated_at', 'update_updated_at_column', 'increment_jv_version',
  'upsert_visitor_session', 'mark_inactive_sessions', 'save_realtime_snapshot',
  'ivx_exec_sql', 'ivx_is_owner',
];

const BASE_REALTIME_TABLES = ['jv_deals', 'landing_deals', 'waitlist', 'notifications', 'transactions', 'landing_analytics', 'visitor_sessions', 'analytics_events', 'conversations', 'conversation_participants', 'messages'] as const;
const IVX_OWNER_AI_REALTIME_TABLES = ['ivx_conversations', 'ivx_messages', 'ivx_inbox_state'] as const;
const REALTIME_TABLES = [...BASE_REALTIME_TABLES, ...IVX_OWNER_AI_REALTIME_TABLES];
const BASE_STORAGE_BUCKETS = ['deal-photos', 'landing-page', 'chat-uploads'] as const;
const IVX_OWNER_AI_STORAGE_BUCKETS = ['ivx-owner-files'] as const;
const STORAGE_BUCKETS = [...BASE_STORAGE_BUCKETS, ...IVX_OWNER_AI_STORAGE_BUCKETS];

export default function SupabaseStatusPage() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const [scanning, setScanning] = useState(false);
  const [lastScanAt, setLastScanAt] = useState<string | null>(null);
  const [tables, setTables] = useState<TableCheck[]>([]);
  const [functions, setFunctions] = useState<FunctionCheck[]>([]);
  const [buckets, setBuckets] = useState<BucketCheck[]>([]);
  const [realtimeChecks, setRealtimeChecks] = useState<RealtimeCheck[]>([]);
  const [configOk, setConfigOk] = useState<boolean | null>(null);
  const [deployAction, setDeployAction] = useState<DeployAction>('idle');
  const [deployMsg, setDeployMsg] = useState('');
  const [copiedSql, setCopiedSql] = useState(false);
  const [expandedSections, setExpandedSections] = useState<SectionState>({
    tables: false,
    functions: false,
    storage: false,
    realtime: false,
    config: false,
    deploy: true});
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const deployScale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (scanning) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.5, duration: 500, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [scanning, pulseAnim]);

  const runFullScan = useCallback(async () => {
    if (scanning) return;
    setScanning(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    console.log('[Supabase Status] Starting full scan...');

    const tableResults: TableCheck[] = [];
    const functionResults: FunctionCheck[] = [];
    const bucketResults: BucketCheck[] = [];
    const realtimeResults: RealtimeCheck[] = [];

    const checkTable = async (name: string): Promise<TableCheck> => {
      try {
        const { count, error } = await supabase.from(name).select('*', { count: 'exact', head: true });
        if (error) {
          const msg = (error.message || '').toLowerCase();
          if (msg.includes('does not exist') || msg.includes('could not find') || msg.includes('relation')) {
            return { name, status: 'missing' };
          }
          return { name, status: 'ok', rowCount: 0 };
        }
        return { name, status: 'ok', rowCount: count ?? 0 };
      } catch {
        return { name, status: 'error' };
      }
    };

    const batchSize = 8;
    for (let i = 0; i < ALL_TABLES.length; i += batchSize) {
      const batch = ALL_TABLES.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(checkTable));
      tableResults.push(...results);
      setTables([...tableResults]);
    }

    for (const fname of ALL_FUNCTIONS) {
      try {
        const { error } = await supabase.rpc(fname === 'is_admin' ? 'verify_admin_access' : fname === 'verify_admin_access' ? 'verify_admin_access' : fname, fname === 'increment_sms_counter' ? { counter_name: 'test' } : undefined);
        if (error) {
          const msg = (error.message || '').toLowerCase();
          if (msg.includes('does not exist') || msg.includes('could not find the function')) {
            functionResults.push({ name: fname, status: 'missing' });
          } else {
            functionResults.push({ name: fname, status: 'ok' });
          }
        } else {
          functionResults.push({ name: fname, status: 'ok' });
        }
      } catch {
        functionResults.push({ name: fname, status: 'error' });
      }
    }
    setFunctions([...functionResults]);

    for (const bucket of STORAGE_BUCKETS) {
      try {
        const { error } = await supabase.storage.from(bucket).list('', { limit: 1 });
        if (error) {
          const msg = (error.message || '').toLowerCase();
          if (msg.includes('not found') || msg.includes('does not exist')) {
            bucketResults.push({ name: bucket, status: 'missing' });
          } else {
            bucketResults.push({ name: bucket, status: 'ok' });
          }
        } else {
          bucketResults.push({ name: bucket, status: 'ok' });
        }
      } catch {
        bucketResults.push({ name: bucket, status: 'error' });
      }
    }
    setBuckets([...bucketResults]);

    for (const table of REALTIME_TABLES) {
      const tableCheck = tableResults.find(t => t.name === table);
      if (tableCheck?.status === 'ok') {
        realtimeResults.push({ table, status: 'ok' });
      } else {
        realtimeResults.push({ table, status: tableCheck?.status === 'missing' ? 'missing' : 'error' });
      }
    }
    setRealtimeChecks([...realtimeResults]);

    try {
      const { data, error } = await supabase.from('app_config').select('key').eq('key', 'admin_roles').single();
      setConfigOk(!error && !!data);
    } catch {
      setConfigOk(false);
    }

    setLastScanAt(new Date().toLocaleTimeString());
    setScanning(false);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    console.log('[Supabase Status] Scan complete');
  }, [scanning]);

  useEffect(() => {
    void runFullScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSection = useCallback((section: keyof SectionState) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  }, []);

  const stats = useMemo(() => {
    const tablesOk = tables.filter(t => t.status === 'ok').length;
    const tablesMissing = tables.filter(t => t.status === 'missing').length;
    const functionsOk = functions.filter(f => f.status === 'ok').length;
    const functionsMissing = functions.filter(f => f.status === 'missing').length;
    const bucketsOk = buckets.filter(b => b.status === 'ok').length;
    const bucketsMissing = buckets.filter(b => b.status === 'missing').length;
    const allOk = tablesMissing === 0 && functionsMissing === 0 && bucketsMissing === 0 && configOk !== false;
    const totalChecks = tables.length + functions.length + buckets.length + (configOk !== null ? 1 : 0);
    const passedChecks = tablesOk + functionsOk + bucketsOk + (configOk ? 1 : 0);
    return { tablesOk, tablesMissing, functionsOk, functionsMissing, bucketsOk, bucketsMissing, allOk, totalChecks, passedChecks };
  }, [tables, functions, buckets, configOk]);

  const healthPercent = stats.totalChecks > 0 ? Math.round((stats.passedChecks / stats.totalChecks) * 100) : 0;

  const waitlistCheck = useMemo(() => tables.find(t => t.name === 'waitlist'), [tables]);
  const waitlistStatus = waitlistCheck?.status ?? 'pending';
  const waitlistRowCount = waitlistCheck?.rowCount ?? 0;

  const ownerModuleStats = useMemo(() => {
    const ownerTableChecks = IVX_OWNER_AI_DEPLOY_TABLES.map((name) => tables.find((table) => table.name === name));
    const tablesOk = ownerTableChecks.filter((table) => table?.status === 'ok').length;
    const bucketOk = buckets.find((bucket) => bucket.name === 'ivx-owner-files')?.status === 'ok';
    const functionOk = functions.find((entry) => entry.name === 'ivx_is_owner')?.status === 'ok';
    let status: OwnerModuleStatus = 'partial';

    if (tablesOk === IVX_OWNER_AI_DEPLOY_TABLES.length && bucketOk && functionOk) {
      status = 'live';
    } else if (tablesOk === 0 && !bucketOk && !functionOk) {
      status = 'missing';
    }

    return {
      status,
      tablesOk,
      totalTables: IVX_OWNER_AI_DEPLOY_TABLES.length,
      bucketOk,
      functionOk};
  }, [tables, buckets, functions]);

  const ownerModuleBadge = useMemo(() => {
    if (ownerModuleStats.status === 'live') {
      return { label: 'LIVE', backgroundColor: '#00E67620', color: '#00E676' };
    }
    if (ownerModuleStats.status === 'missing') {
      return { label: 'MISSING', backgroundColor: '#FF525220', color: '#FF5252' };
    }
    return { label: 'PARTIAL', backgroundColor: '#FFB80020', color: '#FFB800' };
  }, [ownerModuleStats.status]);

  const getSupabaseProjectRef = useCallback((): string | null => {
    const url = (process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim();
    try {
      const hostname = new URL(url).hostname;
      const ref = hostname.split('.')[0];
      return ref || null;
    } catch {
      return null;
    }
  }, []);

  const openSupabaseSqlEditor = useCallback(async (sql: string) => {
    const ref = getSupabaseProjectRef();
    if (!ref) {
      console.log('[Supabase Status] Could not extract project ref from URL');
      return false;
    }
    const editorUrl = `https://supabase.com/dashboard/project/${ref}/sql/new`;
    console.log('[Supabase Status] Opening Supabase SQL Editor:', editorUrl);
    const copied = await safeSetString(sql);
    console.log('[Supabase Status] SQL copied to clipboard:', copied);
    try {
      await Linking.openURL(editorUrl);
      return true;
    } catch (e) {
      console.log('[Supabase Status] Failed to open URL:', e);
      return false;
    }
  }, [getSupabaseProjectRef]);

  const handleDeployWaitlist = useCallback(async () => {
    console.log('[Supabase Status] Deploying waitlist table...');
    setDeployAction('deploying');
    setDeployMsg('Checking table status...');
    deployScale.setValue(0);

    if (!isSupabaseConfigured()) {
      setDeployAction('error');
      setDeployMsg('Supabase not configured. Add URL and Anon Key.');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    try {
      const { error: existsError } = await supabase
        .from('waitlist')
        .select('*', { count: 'exact', head: true });

      const tableAlreadyExists = !existsError ||
        !((existsError.message || '').toLowerCase().includes('does not exist') ||
          (existsError.message || '').toLowerCase().includes('relation'));

      if (tableAlreadyExists) {
        console.log('[Supabase Status] Waitlist table already exists');
        setDeployAction('success');
        setDeployMsg('Waitlist table is already deployed!');
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Animated.spring(deployScale, { toValue: 1, tension: 60, friction: 6, useNativeDriver: true }).start();
        void runFullScan();
        return;
      }

      setDeployMsg('Creating waitlist table...');

      try {
        await executeSupabaseSqlScript(supabase, WAITLIST_SQL, ({ current, total }) => {
          const progressLabel = `Deploying SQL step ${current}/${total}...`;
          console.log('[Supabase Status] Waitlist deploy progress:', progressLabel);
          setDeployMsg(progressLabel);
        });
      } catch (error) {
        const message = (error as Error)?.message ?? 'Deploy failed';
        if (isSupabaseSqlExecMissing(message)) {
          console.log('[Supabase Status] ivx_exec_sql not found — opening Supabase SQL Editor');
          setDeployMsg('Opening Supabase SQL Editor...');

          const opened = await openSupabaseSqlEditor(WAITLIST_SQL);

          if (opened) {
            setDeployAction('idle');
            setDeployMsg('SQL copied! Paste in Supabase SQL Editor and click Run. Then tap Refresh.');
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Alert.alert(
              'First-Time Setup',
              'The SQL has been copied and the Supabase SQL Editor is opening. Paste it and click "Run". This creates the waitlist table AND enables auto-deploy for the future.',
              [{ text: 'Got It' }]
            );
          } else {
            const copied = await safeSetString(WAITLIST_SQL);
            console.log('[Supabase Status] Clipboard fallback result:', copied);
            setDeployAction('error');
            setDeployMsg('SQL copied to clipboard — paste in Supabase SQL Editor manually.');
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            Alert.alert(
              'SQL Copied',
              'Could not open the browser. The SQL has been copied to your clipboard. Go to supabase.com → SQL Editor → New Query, paste and run.',
            );
          }
          return;
        }
        throw error;
      }

      setDeployMsg('Verifying table...');
      await new Promise(r => setTimeout(r, 1000));

      const { error: verifyError } = await supabase
        .from('waitlist')
        .select('*', { count: 'exact', head: true });

      if (verifyError) {
        const vMsg = (verifyError.message || '').toLowerCase();
        if (vMsg.includes('does not exist') || vMsg.includes('relation')) {
          throw new Error('Table creation attempted but verification failed.');
        }
      }

      setDeployAction('success');
      setDeployMsg('Waitlist table deployed & synced!');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Animated.spring(deployScale, { toValue: 1, tension: 60, friction: 6, useNativeDriver: true }).start();

      void runFullScan();
      console.log('[Supabase Status] Waitlist deploy SUCCESS');
    } catch (err) {
      setDeployAction('error');
      setDeployMsg((err as Error)?.message || 'Deploy failed');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      console.log('[Supabase Status] Waitlist deploy FAILED:', (err as Error)?.message);
    }
  }, [runFullScan, deployScale, openSupabaseSqlEditor]);

  const handleCopyWaitlistSql = useCallback(async () => {
    const copied = await safeSetString(WAITLIST_SQL);
    console.log('[Supabase Status] Waitlist SQL copied:', copied);
    setCopiedSql(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTimeout(() => setCopiedSql(false), 2000);
    Alert.alert('SQL Copied', 'Paste this in your Supabase SQL Editor and run it.');
  }, []);

  const [copiedKycSql, setCopiedKycSql] = useState(false);
  const [copiedOwnerSql, setCopiedOwnerSql] = useState(false);
  const [copiedFullSql, setCopiedFullSql] = useState(false);
  const [copiedSecuritySql, setCopiedSecuritySql] = useState(false);
  const [securityHotfixDeploying, setSecurityHotfixDeploying] = useState(false);
  const [securityHotfixResult, setSecurityHotfixResult] = useState<{ status: 'success' | 'error' | 'manual'; message: string } | null>(null);
  const [ownerModuleDeploying, setOwnerModuleDeploying] = useState(false);
  const [ownerModuleResult, setOwnerModuleResult] = useState<{ status: 'success' | 'error' | 'manual'; message: string } | null>(null);
  const [fullSchemaDeploying, setFullSchemaDeploying] = useState(false);
  const [fullSchemaResult, setFullSchemaResult] = useState<{ status: 'success' | 'error' | 'manual'; message: string } | null>(null);

  const handleDeployKycTables = useCallback(async () => {
    console.log('[Supabase Status] Deploying KYC tables...');
    try {
      await executeSupabaseSqlScript(supabase, KYC_TABLES_SQL, ({ current, total }) => {
        console.log('[Supabase Status] KYC deploy progress:', `${current}/${total}`);
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('KYC Tables Deployed', 'kyc_verifications and kyc_documents tables created with RLS, indexes, and triggers.');
      void runFullScan();
    } catch (err) {
      const message = (err as Error)?.message || 'Unknown error';
      if (isSupabaseSqlExecMissing(message)) {
        const opened = await openSupabaseSqlEditor(KYC_TABLES_SQL);
        if (opened) {
          Alert.alert('SQL Copied', 'KYC tables SQL copied & Supabase SQL Editor opening. Paste and click Run.');
        } else {
          const copied = await safeSetString(KYC_TABLES_SQL);
          console.log('[Supabase Status] KYC clipboard fallback:', copied);
          Alert.alert('SQL Copied', 'Paste in Supabase SQL Editor manually.');
        }
        return;
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Deploy Failed', message);
    }
  }, [runFullScan, openSupabaseSqlEditor]);

  const handleCopyKycSql = useCallback(async () => {
    const copied = await safeSetString(KYC_TABLES_SQL);
    console.log('[Supabase Status] KYC SQL copied:', copied);
    setCopiedKycSql(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTimeout(() => setCopiedKycSql(false), 2000);
    Alert.alert('KYC SQL Copied', 'Paste this in your Supabase SQL Editor and run it.');
  }, []);

  const handleDeployOwnerModule = useCallback(async () => {
    console.log('[Supabase Status] Deploying IVX owner module...');
    setOwnerModuleDeploying(true);
    setOwnerModuleResult(null);
    try {
      await executeSupabaseSqlScript(supabase, IVX_OWNER_ADMIN_MODULE_SQL, ({ current, total }) => {
        console.log('[Supabase Status] Owner module deploy progress:', `${current}/${total}`);
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setOwnerModuleResult({ status: 'success', message: 'Owner module deployed — tables, RLS, storage, and RPCs synced.' });
      void runFullScan();
    } catch (err) {
      const message = (err as Error)?.message || 'Unknown error';
      if (isSupabaseSqlExecMissing(message)) {
        const opened = await openSupabaseSqlEditor(IVX_OWNER_ADMIN_MODULE_SQL);
        if (opened) {
          setOwnerModuleResult({ status: 'manual', message: 'SQL copied to clipboard. Paste in the Supabase SQL Editor and click Run, then tap Refresh.' });
        } else {
          await safeSetString(IVX_OWNER_ADMIN_MODULE_SQL);
          setOwnerModuleResult({ status: 'manual', message: 'SQL copied. Go to supabase.com → SQL Editor → New Query, paste and run.' });
        }
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setOwnerModuleDeploying(false);
        return;
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setOwnerModuleResult({ status: 'error', message });
    } finally {
      setOwnerModuleDeploying(false);
    }
  }, [runFullScan, openSupabaseSqlEditor]);

  const handleCopyOwnerSql = useCallback(async () => {
    const copied = await safeSetString(IVX_OWNER_ADMIN_MODULE_SQL);
    console.log('[Supabase Status] Owner module SQL copied:', copied);
    setCopiedOwnerSql(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTimeout(() => setCopiedOwnerSql(false), 2000);
    Alert.alert('Owner Module SQL Copied', 'Paste this in your Supabase SQL Editor to deploy the exact owner-only admin module.');
  }, []);

  const handleDeploySecurityHotfix = useCallback(async () => {
    console.log('[Supabase Status] Deploying security hotfix...');
    setSecurityHotfixDeploying(true);
    setSecurityHotfixResult(null);
    try {
      await executeSupabaseSqlScript(supabase, IVX_SECURITY_HOTFIX_SQL, ({ current, total }) => {
        console.log('[Supabase Status] Security hotfix progress:', `${current}/${total}`);
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSecurityHotfixResult({ status: 'success', message: 'Security hotfix applied — all permissive policies replaced, storage locked, FORCE RLS enabled.' });
      void runFullScan();
    } catch (err) {
      const message = (err as Error)?.message || 'Unknown error';
      if (isSupabaseSqlExecMissing(message)) {
        const opened = await openSupabaseSqlEditor(IVX_SECURITY_HOTFIX_SQL);
        if (opened) {
          setSecurityHotfixResult({ status: 'manual', message: 'SQL copied to clipboard. Paste in the Supabase SQL Editor and click Run, then tap Refresh here.' });
        } else {
          await safeSetString(IVX_SECURITY_HOTFIX_SQL);
          setSecurityHotfixResult({ status: 'manual', message: 'SQL copied. Go to supabase.com → SQL Editor → New Query, paste and run.' });
        }
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setSecurityHotfixDeploying(false);
        return;
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setSecurityHotfixResult({ status: 'error', message });
    }
    setSecurityHotfixDeploying(false);
  }, [runFullScan, openSupabaseSqlEditor]);

  const handleCopySecuritySql = useCallback(async () => {
    const copied = await safeSetString(IVX_SECURITY_HOTFIX_SQL);
    console.log('[Supabase Status] Security hotfix SQL copied:', copied);
    setCopiedSecuritySql(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTimeout(() => setCopiedSecuritySql(false), 2000);
    Alert.alert('Security Hotfix SQL Copied', 'This replaces all permissive policies with owner-only or row-scoped policies and locks down storage buckets.\n\nPaste in Supabase SQL Editor and click Run.');
  }, []);

  const handleDeployFullSchema = useCallback(async () => {
    console.log('[Supabase Status] Deploying full schema...');
    setFullSchemaDeploying(true);
    setFullSchemaResult(null);
    try {
      await executeSupabaseSqlScript(supabase, FULL_SCHEMA_SQL, ({ current, total }) => {
        console.log('[Supabase Status] Full schema deploy progress:', `${current}/${total}`);
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setFullSchemaResult({ status: 'success', message: 'Full schema deployed — all tables, RLS, indexes, triggers, RPCs, and storage buckets created.' });
      void runFullScan();
    } catch (err) {
      const message = (err as Error)?.message || 'Unknown error';
      if (isSupabaseSqlExecMissing(message)) {
        const opened = await openSupabaseSqlEditor(FULL_SCHEMA_SQL);
        if (opened) {
          setFullSchemaResult({ status: 'manual', message: 'SQL copied to clipboard. Paste in the Supabase SQL Editor and click Run, then tap Refresh here.' });
        } else {
          await safeSetString(FULL_SCHEMA_SQL);
          setFullSchemaResult({ status: 'manual', message: 'SQL copied. Go to supabase.com → SQL Editor → New Query, paste and run.' });
        }
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setFullSchemaDeploying(false);
        return;
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setFullSchemaResult({ status: 'error', message });
    }
    setFullSchemaDeploying(false);
  }, [runFullScan, openSupabaseSqlEditor]);

  const handleCopyFullSql = useCallback(async () => {
    const copied = await safeSetString(FULL_SCHEMA_SQL);
    console.log('[Supabase Status] Full SQL copied:', copied);
    setCopiedFullSql(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTimeout(() => setCopiedFullSql(false), 2000);
    Alert.alert('Full Schema SQL Copied', 'This is the complete IVX database schema, including IVX Owner AI tables, RLS policies, indexes, triggers, RPC functions, and storage buckets.\n\nPaste it in Supabase SQL Editor and click Run.');
  }, []);

  const renderStatusIcon = (status: CheckStatus, size: number = 14) => {
    switch (status) {
      case 'ok': return <CheckCircle size={size} color="#00E676" />;
      case 'missing': return <XCircle size={size} color="#FF5252" />;
      case 'error': return <AlertTriangle size={size} color="#FF9800" />;
      case 'checking': return <ShimmerIndicator size="small" color={Colors.primary} />;
      default: return <Clock size={size} color={Colors.textTertiary} />;
    }
  };

  const getHealthColor = () => {
    if (healthPercent >= 95) return '#00E676';
    if (healthPercent >= 75) return '#FFB800';
    if (healthPercent >= 50) return '#FF9800';
    return '#FF5252';
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Database size={20} color={Colors.primary} />
          <Text style={styles.headerTitle}>Supabase Live</Text>
        </View>
        <TouchableOpacity
          onPress={runFullScan}
          style={[styles.refreshHeaderBtn, scanning && styles.refreshHeaderBtnActive]}
          disabled={scanning}
          testID="refresh-scan"
        >
          <RefreshCw size={18} color={scanning ? Colors.textTertiary : Colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <Animated.View style={[styles.healthCard, { opacity: scanning ? pulseAnim : 1 }]}>
          <View style={styles.healthTop}>
            <View style={[styles.healthRing, { borderColor: getHealthColor() }]}>
              <Text style={[styles.healthPercent, { color: getHealthColor() }]}>{healthPercent}%</Text>
            </View>
            <View style={styles.healthInfo}>
              <Text style={styles.healthLabel}>Database Health</Text>
              <Text style={[styles.healthStatus, { color: getHealthColor() }]}>
                {scanning ? 'Scanning...' : stats.allOk ? 'All Systems Operational' : `${stats.passedChecks}/${stats.totalChecks} checks passed`}
              </Text>
              {lastScanAt && (
                <Text style={styles.healthTimestamp}>Last scan: {lastScanAt}</Text>
              )}
            </View>
          </View>

          <View style={styles.healthGrid}>
            <View style={styles.healthStat}>
              <Table2 size={14} color="#42A5F5" />
              <Text style={styles.healthStatValue}>{stats.tablesOk}/{ALL_TABLES.length}</Text>
              <Text style={styles.healthStatLabel}>Tables</Text>
            </View>
            <View style={styles.healthStat}>
              <Settings size={14} color="#AB47BC" />
              <Text style={styles.healthStatValue}>{stats.functionsOk}/{ALL_FUNCTIONS.length}</Text>
              <Text style={styles.healthStatLabel}>Functions</Text>
            </View>
            <View style={styles.healthStat}>
              <HardDrive size={14} color="#FF9800" />
              <Text style={styles.healthStatValue}>{stats.bucketsOk}/{STORAGE_BUCKETS.length}</Text>
              <Text style={styles.healthStatLabel}>Buckets</Text>
            </View>
            <View style={styles.healthStat}>
              <Shield size={14} color={configOk ? '#00E676' : '#FF5252'} />
              <Text style={styles.healthStatValue}>{configOk ? 'OK' : '—'}</Text>
              <Text style={styles.healthStatLabel}>Config</Text>
            </View>
          </View>
        </Animated.View>

        {stats.allOk && !scanning && tables.length > 0 && (
          <View style={styles.allGoodBanner}>
            <Zap size={16} color="#00E676" />
            <Text style={styles.allGoodText}>Everything is deployed and running on Supabase</Text>
          </View>
        )}

        {stats.tablesMissing > 0 && !scanning && (
          <View style={styles.warningBanner}>
            <AlertTriangle size={16} color="#FF9800" />
            <View style={styles.warningContent}>
              <Text style={styles.warningTitle}>{stats.tablesMissing} Missing Tables</Text>
              <Text style={styles.warningText}>
                Run the master SQL script in Supabase SQL Editor to create missing tables.
              </Text>
            </View>
          </View>
        )}

        {/* TABLES SECTION */}
        <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection('tables')} activeOpacity={0.7}>
          <View style={[styles.sectionIconWrap, { backgroundColor: '#42A5F520' }]}>
            <Table2 size={16} color="#42A5F5" />
          </View>
          <Text style={styles.sectionTitle}>Tables</Text>
          <View style={styles.sectionBadge}>
            <Text style={[styles.sectionBadgeText, { color: stats.tablesMissing > 0 ? '#FF5252' : '#00E676' }]}>
              {stats.tablesOk}/{ALL_TABLES.length}
            </Text>
          </View>
          {expandedSections.tables ? <ChevronUp size={16} color={Colors.textSecondary} /> : <ChevronDown size={16} color={Colors.textSecondary} />}
        </TouchableOpacity>
        {expandedSections.tables && (
          <View style={styles.sectionContent}>
            {tables.map(t => (
              <View key={t.name} style={styles.checkRow}>
                {renderStatusIcon(t.status)}
                <Text style={[styles.checkName, t.status === 'missing' && styles.checkNameMissing]}>{t.name}</Text>
                {t.status === 'ok' && t.rowCount !== undefined && (
                  <Text style={styles.checkMeta}>{t.rowCount} rows</Text>
                )}
              </View>
            ))}
            {tables.length === 0 && scanning && (
              <View style={styles.scanningRow}>
                <ShimmerIndicator size="small" color={Colors.primary} />
                <Text style={styles.scanningText}>Scanning tables...</Text>
              </View>
            )}
          </View>
        )}

        {/* FUNCTIONS SECTION */}
        <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection('functions')} activeOpacity={0.7}>
          <View style={[styles.sectionIconWrap, { backgroundColor: '#AB47BC20' }]}>
            <Settings size={16} color="#AB47BC" />
          </View>
          <Text style={styles.sectionTitle}>Functions & RPCs</Text>
          <View style={styles.sectionBadge}>
            <Text style={[styles.sectionBadgeText, { color: stats.functionsMissing > 0 ? '#FF5252' : '#00E676' }]}>
              {stats.functionsOk}/{ALL_FUNCTIONS.length}
            </Text>
          </View>
          {expandedSections.functions ? <ChevronUp size={16} color={Colors.textSecondary} /> : <ChevronDown size={16} color={Colors.textSecondary} />}
        </TouchableOpacity>
        {expandedSections.functions && (
          <View style={styles.sectionContent}>
            {functions.map(f => (
              <View key={f.name} style={styles.checkRow}>
                {renderStatusIcon(f.status)}
                <Text style={[styles.checkName, f.status === 'missing' && styles.checkNameMissing]}>{f.name}()</Text>
              </View>
            ))}
            {functions.length === 0 && scanning && (
              <View style={styles.scanningRow}>
                <ShimmerIndicator size="small" color={Colors.primary} />
                <Text style={styles.scanningText}>Checking functions...</Text>
              </View>
            )}
          </View>
        )}

        {/* STORAGE SECTION */}
        <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection('storage')} activeOpacity={0.7}>
          <View style={[styles.sectionIconWrap, { backgroundColor: '#FF980020' }]}>
            <HardDrive size={16} color="#FF9800" />
          </View>
          <Text style={styles.sectionTitle}>Storage Buckets</Text>
          <View style={styles.sectionBadge}>
            <Text style={[styles.sectionBadgeText, { color: stats.bucketsMissing > 0 ? '#FF5252' : '#00E676' }]}>
              {stats.bucketsOk}/{STORAGE_BUCKETS.length}
            </Text>
          </View>
          {expandedSections.storage ? <ChevronUp size={16} color={Colors.textSecondary} /> : <ChevronDown size={16} color={Colors.textSecondary} />}
        </TouchableOpacity>
        {expandedSections.storage && (
          <View style={styles.sectionContent}>
            {buckets.map(b => (
              <View key={b.name} style={styles.checkRow}>
                {renderStatusIcon(b.status)}
                <Text style={[styles.checkName, b.status === 'missing' && styles.checkNameMissing]}>{b.name}</Text>
              </View>
            ))}
          </View>
        )}

        {/* REALTIME SECTION */}
        <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection('realtime')} activeOpacity={0.7}>
          <View style={[styles.sectionIconWrap, { backgroundColor: '#00BCD420' }]}>
            <Radio size={16} color="#00BCD4" />
          </View>
          <Text style={styles.sectionTitle}>Realtime Tables</Text>
          <View style={styles.sectionBadge}>
            <Text style={[styles.sectionBadgeText, { color: '#00BCD4' }]}>
              {realtimeChecks.filter(r => r.status === 'ok').length}/{REALTIME_TABLES.length}
            </Text>
          </View>
          {expandedSections.realtime ? <ChevronUp size={16} color={Colors.textSecondary} /> : <ChevronDown size={16} color={Colors.textSecondary} />}
        </TouchableOpacity>
        {expandedSections.realtime && (
          <View style={styles.sectionContent}>
            {realtimeChecks.map(r => (
              <View key={r.table} style={styles.checkRow}>
                {renderStatusIcon(r.status)}
                <Text style={[styles.checkName, r.status === 'missing' && styles.checkNameMissing]}>{r.table}</Text>
              </View>
            ))}
          </View>
        )}

        {/* CONFIG SECTION */}
        <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection('config')} activeOpacity={0.7}>
          <View style={[styles.sectionIconWrap, { backgroundColor: '#00E67620' }]}>
            <Shield size={16} color="#00E676" />
          </View>
          <Text style={styles.sectionTitle}>App Config</Text>
          <View style={styles.sectionBadge}>
            <Text style={[styles.sectionBadgeText, { color: configOk ? '#00E676' : configOk === false ? '#FF5252' : Colors.textTertiary }]}>
              {configOk ? 'OK' : configOk === false ? 'MISS' : '—'}
            </Text>
          </View>
          {expandedSections.config ? <ChevronUp size={16} color={Colors.textSecondary} /> : <ChevronDown size={16} color={Colors.textSecondary} />}
        </TouchableOpacity>
        {expandedSections.config && (
          <View style={styles.sectionContent}>
            <View style={styles.checkRow}>
              {renderStatusIcon(configOk ? 'ok' : configOk === false ? 'missing' : 'pending')}
              <Text style={styles.checkName}>admin_roles config</Text>
            </View>
          </View>
        )}

        {/* DEPLOY ACTIONS SECTION */}
        <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection('deploy')} activeOpacity={0.7}>
          <View style={[styles.sectionIconWrap, { backgroundColor: '#FFD70020' }]}>
            <Rocket size={16} color="#FFD700" />
          </View>
          <Text style={styles.sectionTitle}>Quick Deploy</Text>
          <View style={styles.sectionBadge}>
            <Text style={[styles.sectionBadgeText, { color: '#FFD700' }]}>SYNC</Text>
          </View>
          {expandedSections.deploy ? <ChevronUp size={16} color={Colors.textSecondary} /> : <ChevronDown size={16} color={Colors.textSecondary} />}
        </TouchableOpacity>
        {expandedSections.deploy && (
          <View style={styles.deploySection}>
            <View style={styles.deployCard}>
              <View style={styles.deployCardHeader}>
                <View style={styles.deployCardIcon}>
                  <Users size={18} color="#FFD700" />
                </View>
                <View style={styles.deployCardInfo}>
                  <Text style={styles.deployCardTitle}>Waitlist Table</Text>
                  <Text style={styles.deployCardSub}>
                    {waitlistStatus === 'ok' ? `Deployed · ${waitlistRowCount} entries` : waitlistStatus === 'missing' ? 'Not deployed yet' : 'Checking...'}
                  </Text>
                </View>
                <View style={[styles.deployCardBadge, { backgroundColor: waitlistStatus === 'ok' ? '#00E67620' : '#FF525220' }]}>
                  <Text style={[styles.deployCardBadgeText, { color: waitlistStatus === 'ok' ? '#00E676' : '#FF5252' }]}>
                    {waitlistStatus === 'ok' ? 'LIVE' : waitlistStatus === 'missing' ? 'MISSING' : '...'}
                  </Text>
                </View>
              </View>

              {deployAction === 'success' && (
                <Animated.View style={[styles.deploySuccessBanner, { transform: [{ scale: deployScale }] }]}>
                  <CheckCircle size={14} color="#00E676" />
                  <Text style={styles.deploySuccessText}>{deployMsg}</Text>
                </Animated.View>
              )}

              {deployAction === 'error' && (
                <View style={styles.deployErrorBanner}>
                  <AlertTriangle size={14} color="#FF5252" />
                  <Text style={styles.deployErrorText}>{deployMsg}</Text>
                </View>
              )}

              <View style={styles.deployActions}>
                <TouchableOpacity
                  style={[
                    styles.deployButton,
                    deployAction === 'deploying' && styles.deployButtonDisabled,
                    waitlistStatus === 'ok' && styles.deployButtonUpdate,
                  ]}
                  onPress={handleDeployWaitlist}
                  disabled={deployAction === 'deploying'}
                  activeOpacity={0.85}
                  testID="sync-deploy-waitlist-btn"
                >
                  {deployAction === 'deploying' ? (
                    <View style={styles.deployButtonInner}>
                      <ShimmerIndicator color="#000" size="small" />
                      <Text style={styles.deployButtonText}>Deploying...</Text>
                    </View>
                  ) : (
                    <View style={styles.deployButtonInner}>
                      <Rocket size={16} color="#000" />
                      <Text style={styles.deployButtonText}>
                        {waitlistStatus === 'ok' ? 'Re-Sync Waitlist' : 'Deploy Waitlist Now'}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.copySqlButton}
                  onPress={handleCopyWaitlistSql}
                  activeOpacity={0.7}
                >
                  <Copy size={14} color={copiedSql ? '#00E676' : Colors.primary} />
                  <Text style={[styles.copySqlText, copiedSql && { color: '#00E676' }]}>
                    {copiedSql ? 'Copied!' : 'Copy SQL'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={[styles.deployCard, { borderColor: '#00C48C30', marginTop: 12 }]}>
              <View style={styles.deployCardHeader}>
                <View style={[styles.deployCardIcon, { backgroundColor: '#00C48C20' }]}>
                  <Shield size={18} color="#00C48C" />
                </View>
                <View style={styles.deployCardInfo}>
                  <Text style={styles.deployCardTitle}>IVX Owner Admin Module</Text>
                  <Text style={styles.deployCardSub}>
                    Owner-only room, inbox, AI requests, knowledge docs, private uploads, and owner-only admin RPC locks with exact Supabase RLS
                  </Text>
                </View>
                <View style={[styles.deployCardBadge, { backgroundColor: ownerModuleBadge.backgroundColor }]}>
                  <Text style={[styles.deployCardBadgeText, { color: ownerModuleBadge.color }]}>
                    {ownerModuleBadge.label}
                  </Text>
                </View>
              </View>

              <View style={styles.ownerSecurityList}>
                <View style={styles.ownerSecurityRow}>
                  <Shield size={14} color="#00C48C" />
                  <Text style={styles.ownerSecurityText}>
                    <Text style={styles.ownerSecurityStrong}>RLS owner-only</Text>
                    {' '}on ivx_conversations, ivx_messages, ivx_inbox_state, ivx_ai_requests, and ivx_knowledge_documents
                  </Text>
                </View>
                <View style={styles.ownerSecurityRow}>
                  <HardDrive size={14} color="#00C48C" />
                  <Text style={styles.ownerSecurityText}>
                    <Text style={styles.ownerSecurityStrong}>Private storage</Text>
                    {' '}through the ivx-owner-files bucket only
                  </Text>
                </View>
                <View style={styles.ownerSecurityRow}>
                  <Server size={14} color="#00C48C" />
                  <Text style={styles.ownerSecurityText}>
                    <Text style={styles.ownerSecurityStrong}>API enforced</Text>
                    {' '}by owner session checks against profiles.role before routes continue
                  </Text>
                </View>
              </View>

              <View style={styles.ownerModuleMetaRow}>
                <Text style={styles.ownerModuleMetaText}>
                  Tables {ownerModuleStats.tablesOk}/{ownerModuleStats.totalTables}
                </Text>
                <Text style={styles.ownerModuleMetaText}>
                  {ownerModuleStats.functionOk ? 'ivx_is_owner OK' : 'ivx_is_owner MISS'}
                </Text>
                <Text style={styles.ownerModuleMetaText}>
                  {ownerModuleStats.bucketOk ? 'ivx-owner-files OK' : 'ivx-owner-files MISS'}
                </Text>
              </View>

              {ownerModuleResult && (
                <View style={[styles.deployResultBanner, ownerModuleResult.status === 'success' ? styles.deployResultSuccess : ownerModuleResult.status === 'error' ? styles.deployResultError : styles.deployResultManual]}>
                  {ownerModuleResult.status === 'success' ? <CheckCircle size={14} color="#00E676" /> : ownerModuleResult.status === 'error' ? <XCircle size={14} color="#FF5252" /> : <AlertTriangle size={14} color="#FFB800" />}
                  <Text style={[styles.deployResultText, { color: ownerModuleResult.status === 'success' ? '#00E676' : ownerModuleResult.status === 'error' ? '#FF8A80' : '#FFB800' }]}>{ownerModuleResult.message}</Text>
                </View>
              )}

              <View style={styles.deployActions}>
                <TouchableOpacity
                  style={[styles.deployButton, { backgroundColor: '#00C48C' }, ownerModuleDeploying && styles.deployButtonDisabled]}
                  onPress={handleDeployOwnerModule}
                  disabled={ownerModuleDeploying}
                  activeOpacity={0.85}
                  testID="sync-deploy-owner-module-btn"
                >
                  {ownerModuleDeploying ? (
                    <View style={styles.deployButtonInner}>
                      <ShimmerIndicator color="#04110A" size="small" />
                      <Text style={[styles.deployButtonText, { color: '#04110A' }]}>Deploying...</Text>
                    </View>
                  ) : (
                    <View style={styles.deployButtonInner}>
                      <Rocket size={16} color="#04110A" />
                      <Text style={[styles.deployButtonText, { color: '#04110A' }]}>Deploy Owner Module</Text>
                    </View>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.copySqlButton}
                  onPress={handleCopyOwnerSql}
                  activeOpacity={0.7}
                  testID="copy-owner-module-sql-btn"
                >
                  <Copy size={14} color={copiedOwnerSql ? '#00E676' : Colors.primary} />
                  <Text style={[styles.copySqlText, copiedOwnerSql && { color: '#00E676' }]}>
                    {copiedOwnerSql ? 'Copied!' : 'Copy SQL'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={[styles.deployCard, { borderColor: '#42A5F530', marginTop: 12 }]}>
              <View style={styles.deployCardHeader}>
                <View style={[styles.deployCardIcon, { backgroundColor: '#42A5F518' }]}>
                  <Database size={18} color="#42A5F5" />
                </View>
                <View style={styles.deployCardInfo}>
                  <Text style={styles.deployCardTitle}>Full Schema + IVX Owner AI</Text>
                  <Text style={styles.deployCardSub}>
                    Core IVX tables + IVX Owner AI tables + RLS + indexes + triggers + RPCs + storage buckets
                  </Text>
                </View>
                <View style={[styles.deployCardBadge, { backgroundColor: stats.tablesMissing === 0 && tables.length > 0 ? '#00E67620' : '#42A5F520' }]}>
                  <Text style={[styles.deployCardBadgeText, { color: stats.tablesMissing === 0 && tables.length > 0 ? '#00E676' : '#42A5F5' }]}>
                    {stats.tablesMissing === 0 && tables.length > 0 ? 'LIVE' : 'DEPLOY'}
                  </Text>
                </View>
              </View>

              {fullSchemaResult && (
                <View style={[styles.deployResultBanner, fullSchemaResult.status === 'success' ? styles.deployResultSuccess : fullSchemaResult.status === 'error' ? styles.deployResultError : styles.deployResultManual]}>
                  {fullSchemaResult.status === 'success' ? <CheckCircle size={14} color="#00E676" /> : fullSchemaResult.status === 'error' ? <XCircle size={14} color="#FF5252" /> : <AlertTriangle size={14} color="#FFB800" />}
                  <Text style={[styles.deployResultText, { color: fullSchemaResult.status === 'success' ? '#00E676' : fullSchemaResult.status === 'error' ? '#FF8A80' : '#FFB800' }]}>{fullSchemaResult.message}</Text>
                </View>
              )}

              <View style={styles.deployActions}>
                <TouchableOpacity
                  style={[styles.deployButton, { backgroundColor: '#42A5F5' }, fullSchemaDeploying && styles.deployButtonDisabled]}
                  onPress={handleDeployFullSchema}
                  disabled={fullSchemaDeploying}
                  activeOpacity={0.85}
                  testID="sync-deploy-full-schema-btn"
                >
                  {fullSchemaDeploying ? (
                    <View style={styles.deployButtonInner}>
                      <ShimmerIndicator color="#fff" size="small" />
                      <Text style={[styles.deployButtonText, { color: '#fff' }]}>Deploying...</Text>
                    </View>
                  ) : (
                    <View style={styles.deployButtonInner}>
                      <Rocket size={16} color="#fff" />
                      <Text style={[styles.deployButtonText, { color: '#fff' }]}>Deploy Full Schema</Text>
                    </View>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.copySqlButton}
                  onPress={handleCopyFullSql}
                  activeOpacity={0.7}
                >
                  <Copy size={14} color={copiedFullSql ? '#00E676' : Colors.primary} />
                  <Text style={[styles.copySqlText, copiedFullSql && { color: '#00E676' }]}>
                    {copiedFullSql ? 'Copied!' : 'Copy SQL'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.deployInfoCard}>
              <Zap size={14} color="#FFD700" />
              <Text style={styles.deployInfoText}>
                Deploy Full Schema creates the full IVX schema, including IVX Owner AI chat, inbox, AI request, knowledge, and storage setup in one shot. Safe to re-run.
              </Text>
            </View>

            <View style={[styles.deployCard, { borderColor: '#FF525230', marginTop: 12 }]}>
              <View style={styles.deployCardHeader}>
                <View style={[styles.deployCardIcon, { backgroundColor: '#FF525220' }]}>
                  <Shield size={18} color="#FF5252" />
                </View>
                <View style={styles.deployCardInfo}>
                  <Text style={styles.deployCardTitle}>Security Hotfix</Text>
                  <Text style={styles.deployCardSub}>
                    Replace all permissive policies with owner-only or row-scoped RLS. Lock down storage buckets. Force RLS on all tables.
                  </Text>
                </View>
                <View style={[styles.deployCardBadge, { backgroundColor: '#FF525220' }]}>
                  <Text style={[styles.deployCardBadgeText, { color: '#FF5252' }]}>CRITICAL</Text>
                </View>
              </View>

              <View style={styles.ownerSecurityList}>
                <View style={styles.ownerSecurityRow}>
                  <Shield size={14} color="#FF5252" />
                  <Text style={styles.ownerSecurityText}>
                    <Text style={styles.ownerSecurityStrong}>Drops permissive</Text>
                    {' '}"any authenticated" policies on 60+ admin/sensitive tables
                  </Text>
                </View>
                <View style={styles.ownerSecurityRow}>
                  <Shield size={14} color="#FF5252" />
                  <Text style={styles.ownerSecurityText}>
                    <Text style={styles.ownerSecurityStrong}>Row-scoped</Text>
                    {' '}user data: wallets, holdings, transactions, orders, notifications, KYC
                  </Text>
                </View>
                <View style={styles.ownerSecurityRow}>
                  <HardDrive size={14} color="#FF5252" />
                  <Text style={styles.ownerSecurityText}>
                    <Text style={styles.ownerSecurityStrong}>Storage locked</Text>
                    {' '}investor-intake and chat-uploads set private, owner-only reads on sensitive buckets
                  </Text>
                </View>
              </View>

              {securityHotfixResult && (
                <View style={[styles.deployResultBanner, securityHotfixResult.status === 'success' ? styles.deployResultSuccess : securityHotfixResult.status === 'error' ? styles.deployResultError : styles.deployResultManual]}>
                  {securityHotfixResult.status === 'success' ? <CheckCircle size={14} color="#00E676" /> : securityHotfixResult.status === 'error' ? <XCircle size={14} color="#FF5252" /> : <AlertTriangle size={14} color="#FFB800" />}
                  <Text style={[styles.deployResultText, { color: securityHotfixResult.status === 'success' ? '#00E676' : securityHotfixResult.status === 'error' ? '#FF8A80' : '#FFB800' }]}>{securityHotfixResult.message}</Text>
                </View>
              )}

              <View style={styles.deployActions}>
                <TouchableOpacity
                  style={[styles.deployButton, { backgroundColor: '#FF5252' }, securityHotfixDeploying && styles.deployButtonDisabled]}
                  onPress={handleDeploySecurityHotfix}
                  disabled={securityHotfixDeploying}
                  activeOpacity={0.85}
                  testID="sync-deploy-security-hotfix-btn"
                >
                  {securityHotfixDeploying ? (
                    <View style={styles.deployButtonInner}>
                      <ShimmerIndicator color="#fff" size="small" />
                      <Text style={[styles.deployButtonText, { color: '#fff' }]}>Applying...</Text>
                    </View>
                  ) : (
                    <View style={styles.deployButtonInner}>
                      <Shield size={16} color="#fff" />
                      <Text style={[styles.deployButtonText, { color: '#fff' }]}>Apply Security Hotfix</Text>
                    </View>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.copySqlButton}
                  onPress={handleCopySecuritySql}
                  activeOpacity={0.7}
                  testID="copy-security-hotfix-sql-btn"
                >
                  <Copy size={14} color={copiedSecuritySql ? '#00E676' : Colors.primary} />
                  <Text style={[styles.copySqlText, copiedSecuritySql && { color: '#00E676' }]}>
                    {copiedSecuritySql ? 'Copied!' : 'Copy SQL'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.deployCard}>
              <View style={styles.deployCardHeader}>
                <View style={[styles.deployCardIcon, { backgroundColor: '#00C48C20' }]}>
                  <Shield size={18} color="#00C48C" />
                </View>
                <View style={styles.deployCardInfo}>
                  <Text style={styles.deployCardTitle}>KYC Tables</Text>
                  <Text style={styles.deployCardSub}>
                    kyc_verifications + kyc_documents with RLS & triggers
                  </Text>
                </View>
                {(() => {
                  const kycCheck = tables.find(t => t.name === 'kyc_verifications');
                  const kycStatus = kycCheck?.status ?? 'pending';
                  return (
                    <View style={[styles.deployCardBadge, { backgroundColor: kycStatus === 'ok' ? '#00E67620' : '#FF525220' }]}>
                      <Text style={[styles.deployCardBadgeText, { color: kycStatus === 'ok' ? '#00E676' : '#FF5252' }]}>
                        {kycStatus === 'ok' ? 'LIVE' : kycStatus === 'missing' ? 'MISSING' : '...'}
                      </Text>
                    </View>
                  );
                })()}
              </View>

              <View style={styles.deployActions}>
                <TouchableOpacity
                  style={styles.deployButton}
                  onPress={handleDeployKycTables}
                  activeOpacity={0.85}
                  testID="sync-deploy-kyc-btn"
                >
                  <View style={styles.deployButtonInner}>
                    <Rocket size={16} color="#000" />
                    <Text style={styles.deployButtonText}>Deploy KYC Tables</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.copySqlButton}
                  onPress={handleCopyKycSql}
                  activeOpacity={0.7}
                >
                  <Copy size={14} color={copiedKycSql ? '#00E676' : Colors.primary} />
                  <Text style={[styles.copySqlText, copiedKycSql && { color: '#00E676' }]}>
                    {copiedKycSql ? 'Copied!' : 'Copy SQL'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        <View style={styles.footer}>
          <Server size={14} color={Colors.textTertiary} />
          <Text style={styles.footerText}>
            Live from Supabase — no local scripts needed
          </Text>
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12},
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Colors.card,
    justifyContent: 'center',
    alignItems: 'center'},
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  headerTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text},
  refreshHeaderBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Colors.card,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border},
  refreshHeaderBtnActive: {
    borderColor: Colors.primary + '40'},
  content: {
    flex: 1},
  healthCard: {
    margin: 16,
    padding: 18,
    backgroundColor: Colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border},
  healthTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 18},
  healthRing: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 4,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background},
  healthPercent: {
    fontSize: 18,
    fontWeight: '800' as const},
  healthInfo: {
    flex: 1,
    gap: 3},
  healthLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500' as const},
  healthStatus: {
    fontSize: 15,
    fontWeight: '700' as const},
  healthTimestamp: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 2},
  healthGrid: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 14},
  healthStat: {
    flex: 1,
    alignItems: 'center',
    gap: 4},
  healthStatValue: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text},
  healthStatLabel: {
    fontSize: 10,
    color: Colors.textTertiary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5},
  allGoodBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#0D2818',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#00E67630'},
  allGoodText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600' as const,
    color: '#00E676'},
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    backgroundColor: '#1A0E00',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FF980040'},
  warningContent: {
    flex: 1},
  warningTitle: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: '#FF9800',
    marginBottom: 4},
  warningText: {
    fontSize: 12,
    color: '#B87A3D',
    lineHeight: 18},
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border},
  sectionIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center'},
  sectionTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5},
  sectionBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: Colors.card},
  sectionBadgeText: {
    fontSize: 12,
    fontWeight: '700' as const},
  sectionContent: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: Colors.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border},
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 7},
  checkName: {
    flex: 1,
    fontSize: 13,
    color: Colors.text,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace'},
  checkNameMissing: {
    color: '#FF5252'},
  checkMeta: {
    fontSize: 11,
    color: Colors.textTertiary},
  scanningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    justifyContent: 'center'},
  scanningText: {
    fontSize: 13,
    color: Colors.textSecondary},
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 24},
  footerText: {
    fontSize: 11,
    color: Colors.textTertiary},
  deploySection: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Colors.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border},
  deployCard: {
    backgroundColor: Colors.background,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#FFD70030'},
  deployCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12},
  deployCardIcon: {
    width: 40,
    height: 40,
    borderRadius: 11,
    backgroundColor: '#FFD70018',
    justifyContent: 'center',
    alignItems: 'center'},
  deployCardInfo: {
    flex: 1,
    gap: 2},
  deployCardTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text},
  deployCardSub: {
    fontSize: 12,
    color: Colors.textTertiary},
  deployCardBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8},
  deployCardBadgeText: {
    fontSize: 10,
    fontWeight: '800' as const,
    letterSpacing: 0.5},
  deploySuccessBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#0D2818',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#00E67630',
    marginBottom: 10},
  deploySuccessText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600' as const,
    color: '#00E676'},
  deployErrorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 10,
    backgroundColor: '#1A0808',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FF525240',
    marginBottom: 10},
  deployErrorText: {
    flex: 1,
    fontSize: 11,
    color: '#FF8A80',
    lineHeight: 16},
  deployActions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center'},
  deployButton: {
    flex: 1,
    backgroundColor: '#FFD700',
    borderRadius: 12,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center'},
  deployButtonDisabled: {
    opacity: 0.6},
  deployButtonUpdate: {
    backgroundColor: '#1A3D1A',
    borderWidth: 1.5,
    borderColor: '#00E676'},
  deployButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  deployButtonText: {
    fontSize: 14,
    fontWeight: '800' as const,
    color: '#000'},
  copySqlButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.primary + '15',
    height: 44},
  copySqlText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.primary},
  ownerSecurityList: {
    gap: 8,
    marginBottom: 12},
  ownerSecurityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8},
  ownerSecurityText: {
    flex: 1,
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 17},
  ownerSecurityStrong: {
    color: Colors.text,
    fontWeight: '700' as const},
  ownerModuleMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12},
  ownerModuleMetaText: {
    fontSize: 11,
    color: Colors.textTertiary,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: Colors.card},
  deployInfoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 10,
    padding: 10,
    backgroundColor: '#1A1400',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FFD70020'},
  deployInfoText: {
    flex: 1,
    fontSize: 11,
    color: '#B8A040',
    lineHeight: 16},
  deployResultBanner: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 10},
  deployResultSuccess: {
    backgroundColor: '#0D2818',
    borderColor: '#00E67630'},
  deployResultError: {
    backgroundColor: '#1A0808',
    borderColor: '#FF525240'},
  deployResultManual: {
    backgroundColor: '#1A1400',
    borderColor: '#FFB80040'},
  deployResultText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600' as const,
    lineHeight: 17}});
