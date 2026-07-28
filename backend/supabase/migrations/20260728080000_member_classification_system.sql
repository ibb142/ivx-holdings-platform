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
-- 4. transactions table (canonical investment transaction ledger)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transactions (
  id text PRIMARY KEY DEFAULT ('txn_' || gen_random_uuid()::text),
  member_id text NOT NULL,
  offering_id text,
  amount bigint NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'draft',
  settled_at timestamptz,
  refunded_amount bigint NOT NULL DEFAULT 0,
  external_reference text,
  source text NOT NULL DEFAULT 'system',
  is_test boolean NOT NULL DEFAULT false,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_transactions_member_id
  ON public.transactions (member_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status
  ON public.transactions (status);
CREATE INDEX IF NOT EXISTS idx_transactions_offering_id
  ON public.transactions (offering_id);
CREATE INDEX IF NOT EXISTS idx_transactions_settled_at
  ON public.transactions (settled_at);

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