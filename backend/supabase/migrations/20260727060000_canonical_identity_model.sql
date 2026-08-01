-- ============================================================================
-- IVX Canonical Identity Model — Enterprise Registration Completion
-- ============================================================================
-- Adds the 19 missing enterprise-registration identity fields to public.members,
-- backfills existing rows safely, and enforces unique constraints.
--
-- Idempotent: safe to re-run. No existing data is deleted or overwritten.
-- Existing members are backfilled with sensible defaults.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Add missing identity columns (all nullable — existing rows survive)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- enterprise_id: links member to their enterprise
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='enterprise_id') THEN
    ALTER TABLE public.members ADD COLUMN enterprise_id uuid;
  END IF;

  -- normalized_phone: E.164 digits only
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='normalized_phone') THEN
    ALTER TABLE public.members ADD COLUMN normalized_phone text;
  END IF;

  -- country_code: ISO 3166-1 alpha-2
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='country_code') THEN
    ALTER TABLE public.members ADD COLUMN country_code text;
  END IF;

  -- primary_role: the member's primary registration role
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='primary_role') THEN
    ALTER TABLE public.members ADD COLUMN primary_role text;
  END IF;

  -- secondary_roles: additional approved roles (JSON array)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='secondary_roles') THEN
    ALTER TABLE public.members ADD COLUMN secondary_roles jsonb DEFAULT '[]'::jsonb;
  END IF;

  -- registration_type: 'individual' | 'enterprise'
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='registration_type') THEN
    ALTER TABLE public.members ADD COLUMN registration_type text DEFAULT 'individual';
  END IF;

  -- registration_status: 'pending' | 'completed' | 'failed'
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='registration_status') THEN
    ALTER TABLE public.members ADD COLUMN registration_status text DEFAULT 'completed';
  END IF;

  -- email_verified_at: timestamp when email was verified
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='email_verified_at') THEN
    ALTER TABLE public.members ADD COLUMN email_verified_at timestamptz;
  END IF;

  -- phone_verified_at: timestamp when phone was verified
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='phone_verified_at') THEN
    ALTER TABLE public.members ADD COLUMN phone_verified_at timestamptz;
  END IF;

  -- identity_status: 'active' | 'suspended' | 'pending_verification'
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='identity_status') THEN
    ALTER TABLE public.members ADD COLUMN identity_status text DEFAULT 'active';
  END IF;

  -- kyc_status: 'not_started' | 'pending' | 'in_review' | 'approved' | 'rejected'
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='kyc_status') THEN
    ALTER TABLE public.members ADD COLUMN kyc_status text DEFAULT 'not_started';
  END IF;

  -- aml_status: 'not_started' | 'pending' | 'in_review' | 'approved' | 'rejected'
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='aml_status') THEN
    ALTER TABLE public.members ADD COLUMN aml_status text DEFAULT 'not_started';
  END IF;

  -- owner_review_status: 'not_started' | 'pending' | 'approved' | 'rejected'
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='owner_review_status') THEN
    ALTER TABLE public.members ADD COLUMN owner_review_status text DEFAULT 'not_started';
  END IF;

  -- source_channel: where the registration originated
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='source_channel') THEN
    ALTER TABLE public.members ADD COLUMN source_channel text;
  END IF;

  -- data_origin: 'auth_users' | 'profiles' | 'waitlist' | 'lead_capture' | 'enterprise_registration'
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='data_origin') THEN
    ALTER TABLE public.members ADD COLUMN data_origin text;
  END IF;

  -- terms_version: version of ToS accepted
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='terms_version') THEN
    ALTER TABLE public.members ADD COLUMN terms_version text;
  END IF;

  -- privacy_version: version of privacy policy accepted
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='privacy_version') THEN
    ALTER TABLE public.members ADD COLUMN privacy_version text;
  END IF;

  -- terms_accepted_at: timestamp when terms were accepted
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='terms_accepted_at') THEN
    ALTER TABLE public.members ADD COLUMN terms_accepted_at timestamptz;
  END IF;

  -- audit_trace_id: links to the registration_audit trail
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='audit_trace_id') THEN
    ALTER TABLE public.members ADD COLUMN audit_trace_id text;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Backfill existing rows safely (no data loss)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Backfill normalized_email from email where missing
  UPDATE public.members
    SET normalized_email = lower(trim(email))
    WHERE normalized_email IS NULL AND email IS NOT NULL AND email != '';

  -- Backfill normalized_phone from phone (digits only) where missing
  UPDATE public.members
    SET normalized_phone = regexp_replace(phone, '[^0-9]', '', 'g')
    WHERE normalized_phone IS NULL AND phone IS NOT NULL AND phone != '';

  -- Backfill primary_role from member_type where missing
  UPDATE public.members
    SET primary_role = member_type
    WHERE primary_role IS NULL AND member_type IS NOT NULL AND member_type != '';

  -- Backfill source_channel from source where missing
  UPDATE public.members
    SET source_channel = source
    WHERE source_channel IS NULL AND source IS NOT NULL AND source != '';

  -- Backfill data_origin from source_detail where missing
  UPDATE public.members
    SET data_origin = CASE
      WHEN source_detail LIKE '%auth.users%' THEN 'auth_users'
      WHEN source_detail LIKE '%profiles%' THEN 'profiles'
      WHEN source_detail LIKE '%waitlist%' THEN 'waitlist'
      WHEN source_detail LIKE '%lead_capture%' THEN 'lead_capture'
      WHEN source_detail LIKE '%enterprise%' THEN 'enterprise_registration'
      ELSE 'landing_page'
    END
    WHERE data_origin IS NULL;

  -- Backfill email_verified_at from email_verified flag
  UPDATE public.members
    SET email_verified_at = created_at
    WHERE email_verified_at IS NULL AND email_verified = true;

  -- Backfill phone_verified_at from sms_verified flag
  UPDATE public.members
    SET phone_verified_at = created_at
    WHERE phone_verified_at IS NULL AND sms_verified = true;

  -- Backfill registration_type — existing members are individual
  UPDATE public.members
    SET registration_type = 'individual'
    WHERE registration_type IS NULL;

  -- Backfill registration_status — existing members with auth_user_id are completed
  UPDATE public.members
    SET registration_status = 'completed'
    WHERE registration_status IS NULL AND auth_user_id IS NOT NULL;

  UPDATE public.members
    SET registration_status = 'pending'
    WHERE registration_status IS NULL AND auth_user_id IS NULL;

  -- Backfill identity_status — deleted members are suspended, else active
  UPDATE public.members
    SET identity_status = 'suspended'
    WHERE identity_status IS NULL AND deleted_at IS NOT NULL;

  UPDATE public.members
    SET identity_status = 'active'
    WHERE identity_status IS NULL AND deleted_at IS NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Unique constraints (enforce one auth identity → one canonical member)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- auth_user_id UNIQUE (if not already exists from prior migration)
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='members' AND indexname='idx_members_auth_user_id_unique'
  ) THEN
    CREATE UNIQUE INDEX idx_members_auth_user_id_unique
      ON public.members (auth_user_id)
      WHERE auth_user_id IS NOT NULL;
  END IF;

  -- normalized_email UNIQUE (if not already exists from prior migration)
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='members' AND indexname='idx_members_normalized_email_unique'
  ) THEN
    CREATE UNIQUE INDEX idx_members_normalized_email_unique
      ON public.members (normalized_email)
      WHERE normalized_email IS NOT NULL;
  END IF;

  -- audit_trace_id index (for audit trail lookups)
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='members' AND indexname='idx_members_audit_trace_id'
  ) THEN
    CREATE INDEX idx_members_audit_trace_id ON public.members (audit_trace_id);
  END IF;

  -- enterprise_id index (for enterprise membership lookups)
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='members' AND indexname='idx_members_enterprise_id'
  ) THEN
    CREATE INDEX idx_members_enterprise_id ON public.members (enterprise_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Check constraints for data integrity
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- registration_type check
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema='public' AND table_name='members' AND constraint_name='members_registration_type_check'
  ) THEN
    ALTER TABLE public.members ADD CONSTRAINT members_registration_type_check
      CHECK (registration_type IN ('individual', 'enterprise'));
  END IF;

  -- registration_status check
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema='public' AND table_name='members' AND constraint_name='members_registration_status_check'
  ) THEN
    ALTER TABLE public.members ADD CONSTRAINT members_registration_status_check
      CHECK (registration_status IN ('pending', 'completed', 'failed'));
  END IF;

  -- identity_status check
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema='public' AND table_name='members' AND constraint_name='members_identity_status_check'
  ) THEN
    ALTER TABLE public.members ADD CONSTRAINT members_identity_status_check
      CHECK (identity_status IN ('active', 'suspended', 'pending_verification'));
  END IF;

  -- kyc_status check
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema='public' AND table_name='members' AND constraint_name='members_kyc_status_check'
  ) THEN
    ALTER TABLE public.members ADD CONSTRAINT members_kyc_status_check
      CHECK (kyc_status IN ('not_started', 'pending', 'in_review', 'approved', 'rejected'));
  END IF;

  -- aml_status check
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema='public' AND table_name='members' AND constraint_name='members_aml_status_check'
  ) THEN
    ALTER TABLE public.members ADD CONSTRAINT members_aml_status_check
      CHECK (aml_status IN ('not_started', 'pending', 'in_review', 'approved', 'rejected'));
  END IF;

  -- owner_review_status check
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema='public' AND table_name='members' AND constraint_name='members_owner_review_status_check'
  ) THEN
    ALTER TABLE public.members ADD CONSTRAINT members_owner_review_status_check
      CHECK (owner_review_status IN ('not_started', 'pending', 'approved', 'rejected'));
  END IF;
END $$;

COMMIT;
