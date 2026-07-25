-- IVX Zero Data Loss System — Schema Migration
-- Creates: data_vault table, soft-delete columns on all protected tables,
--          snapshot_metadata table for daily snapshots.
-- Safe to run multiple times (all statements are IF NOT EXISTS / idempotent).
-- Run date: 2026-07-06

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. DATA VAULT TABLE
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.data_vault (
  id          BIGSERIAL PRIMARY KEY,
  vault_id    TEXT        NOT NULL UNIQUE,
  table_name  TEXT        NOT NULL,
  record_id   TEXT,
  action      TEXT        NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE','TRUNCATE')),
  old_data    JSONB,
  new_data    JSONB,
  user_id     TEXT,
  reason      TEXT,
  hash        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_data_vault_table_name ON public.data_vault (table_name);
CREATE INDEX IF NOT EXISTS idx_data_vault_record_id  ON public.data_vault (record_id);
CREATE INDEX IF NOT EXISTS idx_data_vault_created_at ON public.data_vault (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_data_vault_vault_id   ON public.data_vault (vault_id);

-- Allow service role full access (RLS disabled for service role by default)
ALTER TABLE public.data_vault ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='data_vault' AND policyname='data_vault_service_role_all') THEN
    CREATE POLICY "data_vault_service_role_all" ON public.data_vault
      FOR ALL USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. SNAPSHOT METADATA TABLE
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.snapshot_metadata (
  id            BIGSERIAL PRIMARY KEY,
  snapshot_id   TEXT        NOT NULL UNIQUE,
  tables        JSONB       NOT NULL,
  total_rows    BIGINT      NOT NULL DEFAULT 0,
  total_bytes   BIGINT      NOT NULL DEFAULT 0,
  status        TEXT        NOT NULL DEFAULT 'completed',
  triggered_by  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_snapshot_metadata_created_at ON public.snapshot_metadata (created_at DESC);

ALTER TABLE public.snapshot_metadata ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='snapshot_metadata' AND policyname='snapshot_metadata_service_role_all') THEN
    CREATE POLICY "snapshot_metadata_service_role_all" ON public.snapshot_metadata
      FOR ALL USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. SOFT-DELETE COLUMNS
-- Adds deleted_at, deleted_by, delete_reason to every protected table.
-- All statements are IF NOT EXISTS via DO block.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  t TEXT;
  protected_tables TEXT[] := ARRAY[
    'members','waitlist','waitlist_entries','investors','buyers',
    'crm_investors','crm_buyers','landing_analytics','analytics_events',
    'visitor_sessions','landing_submissions','landing_investments',
    'jv_deals','wallets','wallet_transactions','treasury','ledger',
    'withdrawals','wire_transfers','private_lenders','tokenized_investments',
    'profiles','kyc_verifications','kyc_documents','earn_accounts',
    'earn_deposits','earn_payouts','referrals','referral_invites',
    'ipx_holdings','ipx_purchases','transactions','messages','deals'
  ];
BEGIN
  FOREACH t IN ARRAY protected_tables LOOP
    -- Check if the table exists before adding columns
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      -- deleted_at
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = t AND column_name = 'deleted_at'
      ) THEN
        EXECUTE format('ALTER TABLE public.%I ADD COLUMN deleted_at TIMESTAMPTZ', t);
      END IF;

      -- deleted_by
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = t AND column_name = 'deleted_by'
      ) THEN
        EXECUTE format('ALTER TABLE public.%I ADD COLUMN deleted_by TEXT', t);
      END IF;

      -- delete_reason
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = t AND column_name = 'delete_reason'
      ) THEN
        EXECUTE format('ALTER TABLE public.%I ADD COLUMN delete_reason TEXT', t);
      END IF;

      -- Index on deleted_at for fast "active records" filtering
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = t AND indexname = t || '_deleted_at_idx'
      ) THEN
        EXECUTE format('CREATE INDEX %I ON public.%I (deleted_at) WHERE deleted_at IS NOT NULL', t || '_deleted_at_idx', t);
      END IF;
    END IF;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. IMMUTABLE LEDGER SAFETY
-- Ensure the ledger table cannot have rows deleted (best-effort via trigger)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ledger'
  ) THEN
    -- Drop existing trigger if any
    DROP TRIGGER IF EXISTS prevent_ledger_deletion ON public.ledger;

    -- Create a function that blocks DELETE on ledger
    CREATE OR REPLACE FUNCTION public.prevent_ledger_delete()
    RETURNS TRIGGER AS $func$
    BEGIN
      -- Only allow deletes by service_role during maintenance (owner-approved)
      -- For all other roles, block the delete
      IF current_setting('role', true) != 'service_role' THEN
        RAISE EXCEPTION 'LEDGER IS IMMUTABLE: Deletion is not allowed. Use a correction entry instead.';
      END IF;
      RETURN OLD;
    END;
    $func$ LANGUAGE plpgsql;

    CREATE TRIGGER prevent_ledger_deletion
      BEFORE DELETE ON public.ledger
      FOR EACH ROW EXECUTE FUNCTION public.prevent_ledger_delete();
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. DANGER BLOCKER — DISABLE destructive ops for non-service roles
-- ═══════════════════════════════════════════════════════════════════════════

-- This is enforced at the application layer (data-loss-guard.ts) AND
-- via Supabase RLS policies that deny DELETE for non-service roles
-- on protected tables. The service role bypasses RLS so owner-approved
-- operations still work through the backend.

-- Done. All statements are idempotent and safe to re-run.