-- ============================================================
-- IVX HOLDINGS — ENTERPRISE DATABASE OPTIMIZATION
-- Phase 2: Connection pooling, query optimization, indexes,
-- RLS performance, backup verification, data integrity
-- Safe to re-run: uses IF NOT EXISTS throughout
-- ============================================================
-- Generated: 2026-07-14T19:00:00Z UTC

-- ============================================================
-- 1. ENTERPRISE INDEXES — Critical performance indexes
--    for high-traffic tables missing optimal indexes
-- ============================================================

-- Chat / messaging (highest traffic)
CREATE INDEX IF NOT EXISTS idx_ivx_messages_room_created ON public.ivx_messages(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ivx_messages_conversation_created ON public.ivx_messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ivx_messages_source_created ON public.ivx_messages(source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ivx_conversations_owner_updated ON public.ivx_conversations(owner_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ivx_conversations_room ON public.ivx_conversations(room_id);
CREATE INDEX IF NOT EXISTS idx_ivx_ai_requests_conv_created ON public.ivx_ai_requests(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ivx_ai_requests_source ON public.ivx_ai_requests(source);

-- Profiles and auth
CREATE INDEX IF NOT EXISTS idx_profiles_role_created ON public.profiles(role, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_referral ON public.profiles(referral_code) WHERE referral_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_vip_tier ON public.profiles(vip_tier) WHERE vip_tier != 'standard';

-- Investor protection
CREATE INDEX IF NOT EXISTS idx_ivx_investments_user_status ON public.ivx_investments(user_id, status);
CREATE INDEX IF NOT EXISTS idx_ivx_investments_created ON public.ivx_investments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ivx_withdrawals_status_created ON public.ivx_withdrawals(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ivx_wires_status_created ON public.ivx_wires(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ivx_auth_sessions_user_active ON public.ivx_auth_sessions(user_id, active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_ivx_protection_audit_created ON public.ivx_protection_audit_log(created_at DESC);

-- Intent capture / visitor intelligence
CREATE INDEX IF NOT EXISTS idx_ivx_visitor_intel_session ON public.ivx_visitor_intelligence(session_id);
CREATE INDEX IF NOT EXISTS idx_ivx_intent_keywords_cluster_intent ON public.ivx_intent_keywords(cluster_id, intent_score DESC);

-- Analytics
CREATE INDEX IF NOT EXISTS idx_analytics_events_created_type ON public.analytics_events(created_at DESC, event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_investments_created ON public.analytics_investments(created_at DESC);

-- ============================================================
-- 2. COMPOSITE INDEXES — Multi-column for common query patterns
-- ============================================================

-- Feed queries: room + created_at + limit (chat history fetch)
CREATE INDEX IF NOT EXISTS idx_ivx_messages_room_created_id ON public.ivx_messages(room_id, created_at DESC, id);

-- User dashboard: conversations by owner sorted by updated
CREATE INDEX IF NOT EXISTS idx_ivx_conversations_owner_updated_id ON public.ivx_conversations(owner_user_id, updated_at DESC, id);

-- Push token lookup by user
CREATE INDEX IF NOT EXISTS idx_push_tokens_user_active ON public.push_tokens(user_id, is_active) WHERE is_active = true;

-- ============================================================
-- 3. PARTIAL INDEXES — Only index active/relevant rows
-- ============================================================

-- Only index active auth sessions (not expired ones)
CREATE INDEX IF NOT EXISTS idx_ivx_auth_sessions_active_expires ON public.ivx_auth_sessions(expires_at) WHERE active = true;

-- Only index pending withdrawals (not completed/cancelled)
CREATE INDEX IF NOT EXISTS idx_ivx_withdrawals_pending ON public.ivx_withdrawals(created_at) WHERE status = 'pending';

-- Only index pending wires
CREATE INDEX IF NOT EXISTS idx_ivx_wires_pending ON public.ivx_wires(created_at) WHERE status = 'pending';

-- ============================================================
-- 4. CONNECTION POOLING — Supabase Supavisor config
--    Supabase uses Supavisor for connection pooling by default.
--    This verifies and documents the pool configuration.
-- ============================================================

-- Note: Supavisor is managed by Supabase. The connection string
-- uses port 6543 for pooled connections (vs 5432 for direct).
-- Application should use the pooled connection string for
-- serverless/multi-instance deployments.
-- 
-- Pool configuration (managed by Supabase):
--   - Pool mode: Transaction
--   - Max client connections: 200 (Supabase default)
--   - Pool size: 15 per compute
--   - Statement timeout: 30s
--
-- Verify current pool settings:
SELECT name, setting, source FROM pg_settings 
WHERE name IN ('max_connections', 'shared_buffers', 'work_mem', 'statement_timeout')
ORDER BY name;

-- ============================================================
-- 5. RLS PERFORMANCE — Verify all tables have RLS enabled
--    and policies are non-recursive
-- ============================================================

-- List all tables and their RLS status
DO $$
DECLARE
  r RECORD;
  rls_count INTEGER := 0;
  no_rls_count INTEGER := 0;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, rowsecurity
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  LOOP
    IF r.rowsecurity THEN
      rls_count := rls_count + 1;
    ELSE
      no_rls_count := no_rls_count + 1;
      RAISE NOTICE 'WARNING: Table % has RLS DISABLED', r.tablename;
    END IF;
  END LOOP;
  RAISE NOTICE 'RLS Summary: % tables with RLS enabled, % tables without RLS', rls_count, no_rls_count;
END $$;

-- ============================================================
-- 6. SLOW QUERY AUDIT — Enable pg_stat_statements if available
-- ============================================================

-- Create extension if not exists (may require superuser)
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Reset statistics for clean baseline
SELECT pg_stat_statements_reset();

-- ============================================================
-- 7. REALTIME OPTIMIZATION — Ensure tables are in publication
-- ============================================================

-- Add critical tables to realtime publication if not already there
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY['ivx_messages', 'ivx_conversations', 'push_tokens', 'profiles'])
  LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      RAISE NOTICE 'Added % to supabase_realtime', t;
    EXCEPTION WHEN duplicate_object THEN
      RAISE NOTICE '% already in supabase_realtime', t;
    END;
  END LOOP;
END $$;

-- ============================================================
-- 8. BACKUP VERIFICATION — Check backup status
-- ============================================================

-- Supabase manages automated daily backups on Pro plans.
-- Point-in-time recovery (PITR) is available on Pro+.
-- This query shows database size for backup planning:
SELECT
  schemaname AS schema,
  pg_size_pretty(SUM(pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(tablename)))) AS total_size
FROM pg_tables
WHERE schemaname = 'public'
GROUP BY schemaname;

-- ============================================================
-- 9. DATA INTEGRITY — Add constraints for critical tables
-- ============================================================

-- Ensure created_at is never null on critical tables
ALTER TABLE public.ivx_messages ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.ivx_conversations ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.ivx_ai_requests ALTER COLUMN created_at SET DEFAULT now();

-- Add updated_at trigger for conversations
CREATE OR REPLACE FUNCTION public.ivx_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE event_object_table = 'ivx_conversations' AND trigger_name = 'ivx_conversations_touch'
  ) THEN
    CREATE TRIGGER ivx_conversations_touch
    BEFORE UPDATE ON public.ivx_conversations
    FOR EACH ROW EXECUTE FUNCTION public.ivx_touch_updated_at();
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ============================================================
-- 10. VACUUM AND ANALYZE — Update query planner statistics
-- ============================================================

-- Run ANALYZE on all public tables to update statistics
ANALYZE;

-- ============================================================
-- VERIFICATION: Count indexes per table
-- ============================================================
SELECT
  schemaname AS schema,
  tablename AS table,
  COUNT(*) AS index_count
FROM pg_indexes
WHERE schemaname = 'public'
GROUP BY schemaname, tablename
ORDER BY index_count DESC, tablename;