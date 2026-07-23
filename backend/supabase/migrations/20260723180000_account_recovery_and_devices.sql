-- ============================================================================
-- IVX Account Recovery + Biometric/Device Security — schema migration
-- ============================================================================
-- Owner: run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Idempotent (IF NOT EXISTS / safe re-run). Adds durable storage to replace the
-- in-memory recovery-code Map in backend/api/ivx-owner-recovery-sms.ts, plus new
-- tables for trusted-device/biometric tracking and account security state.
--
-- STATUS: DESIGNED + CODED. NOT YET EXECUTED IN PRODUCTION.
-- Execution requires the same owner-approved Management API path used for the
-- 2026-07-22 registration-constraints migration (supabase_execute_sql_management,
-- owner confirm phrase) — this file is the durable, reviewable artifact for that step.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. account_recovery_codes — durable replacement for the in-memory Map
--    Applies to ALL roles (owner, member, investor, buyer, developer, etc.),
--    not just the owner-only SMS path.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('sms', 'email', 'backup_code')),
  code_hash text NOT NULL,               -- SHA-256 of the code; raw code never stored
  phone_hash text,                        -- SHA-256 of the destination phone, if channel='sms'
  purpose text NOT NULL DEFAULT 'login_recovery' CHECK (purpose IN ('login_recovery', 'password_reset', 'biometric_reset', 'account_unlock')),
  expires_at timestamptz NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recovery_codes_email ON public.account_recovery_codes (email);
CREATE INDEX IF NOT EXISTS idx_recovery_codes_user_id ON public.account_recovery_codes (user_id);
CREATE INDEX IF NOT EXISTS idx_recovery_codes_expires_at ON public.account_recovery_codes (expires_at);

ALTER TABLE public.account_recovery_codes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'account_recovery_codes' AND policyname = 'service_role_all_recovery_codes'
  ) THEN
    CREATE POLICY service_role_all_recovery_codes ON public.account_recovery_codes
      FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. account_recovery_tokens — durable replacement for the in-memory token Map
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_recovery_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  token_hash text NOT NULL,               -- SHA-256 of the raw token; raw token never stored
  expires_at timestamptz NOT NULL,
  used boolean NOT NULL DEFAULT false,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_recovery_tokens_hash_unique ON public.account_recovery_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_recovery_tokens_user_id ON public.account_recovery_tokens (user_id);

ALTER TABLE public.account_recovery_tokens ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'account_recovery_tokens' AND policyname = 'service_role_all_recovery_tokens'
  ) THEN
    CREATE POLICY service_role_all_recovery_tokens ON public.account_recovery_tokens
      FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. user_devices — trusted device + biometric enrollment registry (all roles)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id text NOT NULL,                -- stable client-generated device identifier
  platform text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  device_name text,                       -- e.g. "iPhone 15 Pro", user-editable label
  biometric_enrolled boolean NOT NULL DEFAULT false,
  biometric_type text CHECK (biometric_type IN ('face_id', 'touch_id', 'fingerprint', 'face_unlock', 'none')),
  public_key text,                        -- device-bound public key for biometric-gated session refresh
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  trusted boolean NOT NULL DEFAULT false,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_devices_user_device_unique ON public.user_devices (user_id, device_id);
CREATE INDEX IF NOT EXISTS idx_user_devices_user_id ON public.user_devices (user_id);

ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_devices' AND policyname = 'user_manage_own_devices'
  ) THEN
    CREATE POLICY user_manage_own_devices ON public.user_devices
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_devices' AND policyname = 'service_role_all_devices'
  ) THEN
    CREATE POLICY service_role_all_devices ON public.user_devices
      FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. account_security_state — lock/recovery state machine (all roles)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_security_state (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'manual_review', 'security_locked', 'recovery_in_progress')),
  reason text,
  locked_at timestamptz,
  locked_by text,                         -- 'system' | 'owner' | user_id string
  failed_login_count int NOT NULL DEFAULT 0,
  last_failed_login_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.account_security_state ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'account_security_state' AND policyname = 'service_role_all_security_state'
  ) THEN
    CREATE POLICY service_role_all_security_state ON public.account_security_state
      FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification queries (run after migration to prove success)
-- ---------------------------------------------------------------------------
-- SELECT table_name FROM information_schema.tables WHERE table_schema='public'
--   AND table_name IN ('account_recovery_codes','account_recovery_tokens','user_devices','account_security_state');
-- SELECT tablename, policyname FROM pg_policies WHERE schemaname='public'
--   AND tablename IN ('account_recovery_codes','account_recovery_tokens','user_devices','account_security_state');
