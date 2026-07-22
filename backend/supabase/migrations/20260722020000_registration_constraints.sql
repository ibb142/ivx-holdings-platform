-- ============================================================================
-- IVX Registration Reliability — Phase 2 database constraints migration
-- ============================================================================
-- Owner: run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- This migration adds UNIQUE constraints + foreign keys so the database itself
-- enforces idempotency, not just the application layer.
--
-- All statements are idempotent (IF NOT EXISTS / safe re-run).
-- No data is deleted; existing duplicates are NOT removed — only future inserts
-- are constrained. If duplicates exist, run the dedup queries at the bottom first.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. profiles.auth_user_id UNIQUE
--    (profiles.id is already PK = auth.users.id; this adds an explicit unique
--     index on auth_user_id if the column exists separately from id)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles'
      AND column_name = 'auth_user_id'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'profiles' AND indexname = 'idx_profiles_auth_user_id_unique'
    ) THEN
      CREATE UNIQUE INDEX idx_profiles_auth_user_id_unique ON public.profiles (auth_user_id);
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. members.auth_user_id UNIQUE
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'members'
      AND column_name = 'auth_user_id'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'members' AND indexname = 'idx_members_auth_user_id_unique'
    ) THEN
      CREATE UNIQUE INDEX idx_members_auth_user_id_unique ON public.members (auth_user_id);
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. members.normalized_email UNIQUE (where appropriate)
--    Only if the column exists; if it doesn't, create it from email.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Create normalized_email column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'members'
      AND column_name = 'normalized_email'
  ) THEN
    ALTER TABLE public.members ADD COLUMN normalized_email text;
    -- Backfill from email (lowercase + trim)
    UPDATE public.members SET normalized_email = lower(trim(email)) WHERE email IS NOT NULL;
  END IF;

  -- Add unique index
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'members'
      AND column_name = 'normalized_email'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'members' AND indexname = 'idx_members_normalized_email_unique'
    ) THEN
      CREATE UNIQUE INDEX idx_members_normalized_email_unique ON public.members (normalized_email)
      WHERE normalized_email IS NOT NULL;
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. landing_investments.registration_request_id UNIQUE
--    Only if the column exists; if it doesn't, add it.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'landing_investments'
      AND column_name = 'registration_request_id'
  ) THEN
    ALTER TABLE public.landing_investments ADD COLUMN registration_request_id text;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'landing_investments'
      AND column_name = 'registration_request_id'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'landing_investments' AND indexname = 'idx_landing_investments_reg_req_id_unique'
    ) THEN
      CREATE UNIQUE INDEX idx_landing_investments_reg_req_id_unique ON public.landing_investments (registration_request_id)
      WHERE registration_request_id IS NOT NULL;
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Foreign keys (safe add — IF NOT EXISTS pattern via DO block)
-- ---------------------------------------------------------------------------

-- profiles.auth_user_id → auth.users.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'profiles'
      AND constraint_name = 'fk_profiles_auth_user_id'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT fk_profiles_auth_user_id
      FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'profiles FK not added: %', SQLERRM;
END $$;

-- investment_interest.member_id → members.id (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'investment_interest') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_schema = 'public' AND table_name = 'investment_interest'
        AND constraint_name = 'fk_interest_member_id'
    ) THEN
      ALTER TABLE public.investment_interest
        ADD CONSTRAINT fk_interest_member_id
        FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;
    END IF;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'investment_interest FK not added: %', SQLERRM;
END $$;

-- investment_interest.opportunity_id → deals.id (if both tables exist)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'investment_interest')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'deals') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_schema = 'public' AND table_name = 'investment_interest'
        AND constraint_name = 'fk_interest_opportunity_id'
    ) THEN
      ALTER TABLE public.investment_interest
        ADD CONSTRAINT fk_interest_opportunity_id
        FOREIGN KEY (opportunity_id) REFERENCES public.deals(id) ON DELETE SET NULL;
    END IF;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'investment_interest→deals FK not added: %', SQLERRM;
END $$;

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification queries (run after migration to prove success)
-- ---------------------------------------------------------------------------
-- SELECT indexname, tablename FROM pg_indexes
-- WHERE schemaname = 'public'
--   AND indexname IN (
--     'idx_profiles_auth_user_id_unique',
--     'idx_members_auth_user_id_unique',
--     'idx_members_normalized_email_unique',
--     'idx_landing_investments_reg_req_id_unique'
--   );
--
-- SELECT conname, conrelid::regclass, confrelid::regclass
-- FROM pg_constraint
-- WHERE contype = 'f'
--   AND conname IN ('fk_profiles_auth_user_id', 'fk_interest_member_id', 'fk_interest_opportunity_id');

-- ---------------------------------------------------------------------------
-- Dedup queries (run ONLY if the UNIQUE index creation fails due to duplicates)
-- ---------------------------------------------------------------------------
-- -- Remove duplicate profiles (keep earliest by created_at)
-- DELETE FROM public.profiles p
-- WHERE id NOT IN (
--   SELECT DISTINCT ON (auth_user_id) id
--   FROM public.profiles
--   WHERE auth_user_id IS NOT NULL
--   ORDER BY auth_user_id, created_at ASC
-- ) AND auth_user_id IS NOT NULL;
--
-- -- Remove duplicate members by auth_user_id (keep earliest)
-- DELETE FROM public.members m
-- WHERE id NOT IN (
--   SELECT DISTINCT ON (auth_user_id) id
--   FROM public.members
--   WHERE auth_user_id IS NOT NULL
--   ORDER BY auth_user_id, created_at ASC
-- ) AND auth_user_id IS NOT NULL;
--
-- -- Remove duplicate members by normalized_email (keep earliest)
-- DELETE FROM public.members m
-- WHERE id NOT IN (
--   SELECT DISTINCT ON (normalized_email) id
--   FROM public.members
--   WHERE normalized_email IS NOT NULL
--   ORDER BY normalized_email, created_at ASC
-- ) AND normalized_email IS NOT NULL;
