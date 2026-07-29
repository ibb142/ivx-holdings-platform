-- ============================================================================
-- IVX Member Classification System — 3-tier classification + financial summary
-- ============================================================================
-- Adds member_tier, investor_status, and classification metadata to the
-- canonical members table, creates investor_profiles and member_financial_summary
-- tables, and adds classification-relevant columns to the existing
-- payment_intents / investment_requests tables.
--
-- Idempotent: safe to re-run. No existing data is deleted or overwritten.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. members: add classification columns
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- member_tier: 'PENDING' | 'REGULAR' | 'INVESTOR' | 'VIP'
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='member_tier') THEN
    ALTER TABLE public.members ADD COLUMN member_tier text DEFAULT 'PENDING';
  END IF;

  -- investor_status: 'NOT_VERIFIED' | 'ACTIVE' | 'RESTRICTED_OR_PENDING' | 'SUSPENDED'
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='investor_status') THEN
    ALTER TABLE public.members ADD COLUMN investor_status text DEFAULT 'NOT_VERIFIED';
  END IF;

  -- onboarding_phase: tracks where the member is in the onboarding funnel
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='onboarding_phase') THEN
    ALTER TABLE public.members ADD COLUMN onboarding_phase text DEFAULT 'registration';
  END IF;

  -- classification_updated_at: when classifyMember last ran for this member
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='classification_updated_at') THEN
    ALTER TABLE public.members ADD COLUMN classification_updated_at timestamptz;
  END IF;

  -- classification_reason: human-readable explanation of current tier
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='classification_reason') THEN
    ALTER TABLE public.members ADD COLUMN classification_reason text;
  END IF;

  -- classification_version: schema version of the classification engine
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='classification_version') THEN
    ALTER TABLE public.members ADD COLUMN classification_version text;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. investor_profiles table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.investor_profiles (
  id text PRIMARY KEY DEFAULT ('invp_' || gen_random_uuid()::text),
  member_id text NOT NULL,
  kyc_status text NOT NULL DEFAULT 'not_started',
  tax_status text NOT NULL DEFAULT 'not_started',
  compliance_status text NOT NULL DEFAULT 'not_started',
  investor_agreement_at timestamptz,
  approved_at timestamptz,
  restricted_at timestamptz,
  restricted_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index for member lookups
CREATE INDEX IF NOT EXISTS idx_investor_profiles_member_id
  ON public.investor_profiles (member_id);

-- Unique constraint: one investor profile per member
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='investor_profiles' AND indexname='idx_investor_profiles_member_id_unique'
  ) THEN
    CREATE UNIQUE INDEX idx_investor_profiles_member_id_unique
      ON public.investor_profiles (member_id);
  END IF;
END $$;

-- Check constraints
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema='public' AND table_name='investor_profiles' AND constraint_name='investor_profiles_kyc_status_check'
  ) THEN
    ALTER TABLE public.investor_profiles ADD CONSTRAINT investor_profiles_kyc_status_check
      CHECK (kyc_status IN ('not_started', 'pending', 'in_review', 'approved', 'rejected', 'expired'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema='public' AND table_name='investor_profiles' AND constraint_name='investor_profiles_tax_status_check'
  ) THEN
    ALTER TABLE public.investor_profiles ADD CONSTRAINT investor_profiles_tax_status_check
      CHECK (tax_status IN ('not_started', 'pending', 'completed', 'rejected'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema='public' AND table_name='investor_profiles' AND constraint_name='investor_profiles_compliance_status_check'
  ) THEN
    ALTER TABLE public.investor_profiles ADD CONSTRAINT investor_profiles_compliance_status_check
      CHECK (compliance_status IN ('not_started', 'pending', 'approved', 'rejected', 'restricted'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. member_financial_summary table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.member_financial_summary (
  member_id text PRIMARY KEY,
  completed_transactions integer NOT NULL DEFAULT 0,
  lifetime_settled_investment bigint NOT NULL DEFAULT 0,
  current_active_principal bigint NOT NULL DEFAULT 0,
  committed_capital bigint NOT NULL DEFAULT 0,
  pending_capital bigint NOT NULL DEFAULT 0,
  refunded_principal bigint NOT NULL DEFAULT 0,
  cancelled_capital bigint NOT NULL DEFAULT 0,
  distributed_amount bigint NOT NULL DEFAULT 0,
  qualifying_invested_capital bigint NOT NULL DEFAULT 0,
  largest_completed_transaction bigint NOT NULL DEFAULT 0,
  last_completed_transaction_at timestamptz,
  calculated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 4. transactions table — ALTER existing table (production already has transactions with user_id)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- The transactions table already exists in production with user_id.
  -- Add classification columns via ALTER TABLE.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transactions' AND column_name='member_id') THEN
    ALTER TABLE public.transactions ADD COLUMN member_id text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transactions' AND column_name='offering_id') THEN
    ALTER TABLE public.transactions ADD COLUMN offering_id text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transactions' AND column_name='currency') THEN
    ALTER TABLE public.transactions ADD COLUMN currency text NOT NULL DEFAULT 'USD';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transactions' AND column_name='settled_at') THEN
    ALTER TABLE public.transactions ADD COLUMN settled_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transactions' AND column_name='refunded_amount') THEN
    ALTER TABLE public.transactions ADD COLUMN refunded_amount bigint NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transactions' AND column_name='external_reference') THEN
    ALTER TABLE public.transactions ADD COLUMN external_reference text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transactions' AND column_name='source') THEN
    ALTER TABLE public.transactions ADD COLUMN source text NOT NULL DEFAULT 'system';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transactions' AND column_name='is_test') THEN
    ALTER TABLE public.transactions ADD COLUMN is_test boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transactions' AND column_name='idempotency_key') THEN
    ALTER TABLE public.transactions ADD COLUMN idempotency_key text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transactions' AND column_name='updated_at') THEN
    ALTER TABLE public.transactions ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
  END IF;
END $$;

-- Backfill member_id from user_id via members.auth_user_id
UPDATE public.transactions t
  SET member_id = m.member_id
  FROM public.members m
  WHERE t.user_id = m.auth_user_id
    AND t.member_id IS NULL;

-- Indexes (member_id may be NULL for legacy rows — partial index)
CREATE INDEX IF NOT EXISTS idx_transactions_member_id
  ON public.transactions (member_id)
  WHERE member_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_status
  ON public.transactions (status);

-- Unique idempotency key (prevents duplicate webhooks)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='transactions' AND indexname='idx_transactions_idempotency_key_unique'
  ) THEN
    CREATE UNIQUE INDEX idx_transactions_idempotency_key_unique
      ON public.transactions (idempotency_key)
      WHERE idempotency_key IS NOT NULL;
  END IF;
END $$;

-- Check constraint: status must be one of the allowed values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema='public' AND table_name='transactions' AND constraint_name='transactions_status_check'
  ) THEN
    ALTER TABLE public.transactions ADD CONSTRAINT transactions_status_check
      CHECK (status IN (
        'draft', 'interested', 'reserved', 'pending', 'processing',
        'settled', 'completed', 'funded_and_confirmed',
        'failed', 'rejected', 'cancelled', 'refunded', 'test'
      ));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. classification_audit table (append-only audit trail)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.classification_audit (
  id bigserial PRIMARY KEY,
  member_id text NOT NULL,
  previous_tier text,
  new_tier text NOT NULL,
  previous_investor_status text,
  new_investor_status text,
  reason text NOT NULL,
  qualifying_total_before bigint,
  qualifying_total_after bigint,
  actor text NOT NULL DEFAULT 'automatic',
  trace_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_classification_audit_member_id
  ON public.classification_audit (member_id);
CREATE INDEX IF NOT EXISTS idx_classification_audit_created_at
  ON public.classification_audit (created_at DESC);

-- ---------------------------------------------------------------------------
-- 6. Backfill existing members
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Members with completed registration and email verification → REGULAR
  UPDATE public.members
    SET member_tier = 'REGULAR',
        investor_status = 'NOT_VERIFIED',
        classification_reason = 'Backfill: basic registration, zero completed transactions',
        classification_updated_at = now(),
        classification_version = '1.0.0'
    WHERE member_tier IS NULL OR member_tier = 'PENDING'
      AND email_verified = true
      AND registration_status = 'completed';

  -- Members without email verification → PENDING
  UPDATE public.members
    SET member_tier = 'PENDING',
        investor_status = 'NOT_VERIFIED',
        classification_reason = 'Backfill: basic verification incomplete',
        classification_updated_at = now(),
        classification_version = '1.0.0'
    WHERE member_tier IS NULL OR member_tier = 'PENDING'
      AND (email_verified = false OR email_verified IS NULL);

  -- Members with member_type = 'investor' but no transactions → still REGULAR
  -- (investor interest ≠ verified investor — must have completed transactions)
  UPDATE public.members
    SET member_tier = 'REGULAR',
        investor_status = 'NOT_VERIFIED',
        classification_reason = 'Backfill: investor interest registered but zero completed transactions',
        classification_updated_at = now(),
        classification_version = '1.0.0'
    WHERE member_tier = 'PENDING'
      AND member_type = 'investor'
      AND email_verified = true;
END $$;

-- ---------------------------------------------------------------------------
-- 7. Check constraints on members table
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema='public' AND table_name='members' AND constraint_name='members_member_tier_check'
  ) THEN
    ALTER TABLE public.members ADD CONSTRAINT members_member_tier_check
      CHECK (member_tier IN ('PENDING', 'REGULAR', 'INVESTOR', 'VIP'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema='public' AND table_name='members' AND constraint_name='members_investor_status_check'
  ) THEN
    ALTER TABLE public.members ADD CONSTRAINT members_investor_status_check
      CHECK (investor_status IN ('NOT_VERIFIED', 'ACTIVE', 'RESTRICTED_OR_PENDING', 'SUSPENDED'));
  END IF;
END $$;

COMMIT;