-- ============================================================
-- IVX HOLDINGS — ENTERPRISE REGISTRATION SCHEMA
-- Adds: enterprises, enterprise_memberships, enterprise_invitations,
--       registration_consent, kyc_aml_status, registration_audit
-- Safe to re-run: uses IF NOT EXISTS throughout
-- Generated: 2026-07-27T03:00:00Z UTC
-- ============================================================

-- ============================================================
-- 1. ENTERPRISES — Legal company entities
-- ============================================================
CREATE TABLE IF NOT EXISTS public.enterprises (
  enterprise_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  company_type TEXT NOT NULL DEFAULT 'llc',
  industry TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  authorized_representative TEXT NOT NULL,
  representative_job_title TEXT NOT NULL DEFAULT '',
  team_size INTEGER NOT NULL DEFAULT 1,
  business_category TEXT NOT NULL DEFAULT '',
  verification_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (verification_status IN ('not_started','information_required','submitted','under_review','verified','rejected','expired','manual_review')),
  owner_member_id TEXT,
  owner_auth_user_id UUID,
  domain TEXT NOT NULL DEFAULT '',
  company_registration_id TEXT NOT NULL DEFAULT '',
  source_channel TEXT NOT NULL DEFAULT 'landing_page',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enterprises_domain ON public.enterprises(domain) WHERE domain != '';
CREATE INDEX IF NOT EXISTS idx_enterprises_verification_status ON public.enterprises(verification_status);
CREATE INDEX IF NOT EXISTS idx_enterprises_created_at ON public.enterprises(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_enterprises_legal_name_lower ON public.enterprises(lower(legal_name));

-- ============================================================
-- 2. ENTERPRISE MEMBERSHIPS — Team member bindings
-- ============================================================
CREATE TABLE IF NOT EXISTS public.enterprise_memberships (
  membership_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id UUID NOT NULL REFERENCES public.enterprises(enterprise_id) ON DELETE CASCADE,
  member_id TEXT NOT NULL,
  auth_user_id UUID,
  enterprise_role TEXT NOT NULL DEFAULT 'read_only'
    CHECK (enterprise_role IN ('owner','administrator','manager','analyst','contributor','read_only','external_advisor')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','suspended','removed','pending')),
  invited_by TEXT NOT NULL DEFAULT '',
  invitation_id UUID,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  suspended_at TIMESTAMPTZ,
  removed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_enterprise_memberships_enterprise_member
  ON public.enterprise_memberships(enterprise_id, member_id)
  WHERE status != 'removed';
CREATE INDEX IF NOT EXISTS idx_enterprise_memberships_auth_user ON public.enterprise_memberships(auth_user_id) WHERE auth_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_enterprise_memberships_enterprise_role ON public.enterprise_memberships(enterprise_id, enterprise_role);
CREATE INDEX IF NOT EXISTS idx_enterprise_memberships_status ON public.enterprise_memberships(status);

-- ============================================================
-- 3. ENTERPRISE INVITATIONS — Single-use team invitations
-- ============================================================
CREATE TABLE IF NOT EXISTS public.enterprise_invitations (
  invitation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id UUID NOT NULL REFERENCES public.enterprises(enterprise_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  invited_email TEXT NOT NULL,
  enterprise_role TEXT NOT NULL DEFAULT 'contributor'
    CHECK (enterprise_role IN ('administrator','manager','analyst','contributor','read_only','external_advisor')),
  invited_by TEXT NOT NULL,
  invited_by_auth_user_id UUID,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','expired','revoked')),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  accepted_by_member_id TEXT,
  accepted_by_auth_user_id UUID,
  revoked_at TIMESTAMPTZ,
  revoked_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enterprise_invitations_enterprise ON public.enterprise_invitations(enterprise_id);
CREATE INDEX IF NOT EXISTS idx_enterprise_invitations_status ON public.enterprise_invitations(status);
CREATE INDEX IF NOT EXISTS idx_enterprise_invitations_expires_at ON public.enterprise_invitations(expires_at);
CREATE INDEX IF NOT EXISTS idx_enterprise_invitations_invited_email ON public.enterprise_invitations(lower(invited_email));

-- ============================================================
-- 4. REGISTRATION CONSENT — Terms/privacy acceptance ledger
-- ============================================================
CREATE TABLE IF NOT EXISTS public.registration_consent (
  consent_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID,
  member_id TEXT,
  terms_version TEXT NOT NULL DEFAULT '1.0',
  privacy_version TEXT NOT NULL DEFAULT '1.0',
  terms_accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  privacy_accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  source_channel TEXT NOT NULL DEFAULT 'landing_page',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_registration_consent_auth_user ON public.registration_consent(auth_user_id) WHERE auth_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_registration_consent_member ON public.registration_consent(member_id) WHERE member_id IS NOT NULL;

-- ============================================================
-- 5. KYC / AML STATUS — Separated from registration
-- ============================================================
CREATE TABLE IF NOT EXISTS public.kyc_aml_status (
  kyc_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID,
  member_id TEXT,
  enterprise_id UUID REFERENCES public.enterprises(enterprise_id) ON DELETE SET NULL,
  kyc_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (kyc_status IN ('not_started','information_required','submitted','under_review','verified','rejected','expired','manual_review')),
  aml_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (aml_status IN ('not_started','information_required','submitted','under_review','verified','rejected','expired','manual_review')),
  owner_review_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (owner_review_status IN ('not_started','pending','approved','rejected','manual_review')),
  accreditation_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (accreditation_status IN ('not_started','pending','verified','rejected')),
  proof_of_funds_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (proof_of_funds_status IN ('not_started','pending','verified','rejected')),
  submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT NOT NULL DEFAULT '',
  reviewer_notes TEXT NOT NULL DEFAULT '',
  risk_score INTEGER NOT NULL DEFAULT 0,
  flags TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kyc_aml_auth_user ON public.kyc_aml_status(auth_user_id) WHERE auth_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kyc_aml_member ON public.kyc_aml_status(member_id) WHERE member_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kyc_aml_enterprise ON public.kyc_aml_status(enterprise_id) WHERE enterprise_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kyc_aml_kyc_status ON public.kyc_aml_status(kyc_status);
CREATE INDEX IF NOT EXISTS idx_kyc_aml_aml_status ON public.kyc_aml_status(aml_status);
CREATE INDEX IF NOT EXISTS idx_kyc_aml_owner_review ON public.kyc_aml_status(owner_review_status);

-- ============================================================
-- 6. REGISTRATION AUDIT — Append-only audit trail
-- ============================================================
CREATE TABLE IF NOT EXISTS public.registration_audit (
  audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id TEXT NOT NULL,
  registration_request_id TEXT NOT NULL,
  auth_user_id UUID,
  member_id TEXT,
  enterprise_id UUID,
  stage TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  source_channel TEXT NOT NULL DEFAULT 'landing_page',
  success BOOLEAN NOT NULL DEFAULT true,
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_registration_audit_trace_id ON public.registration_audit(trace_id);
CREATE INDEX IF NOT EXISTS idx_registration_audit_request_id ON public.registration_audit(registration_request_id);
CREATE INDEX IF NOT EXISTS idx_registration_audit_auth_user ON public.registration_audit(auth_user_id) WHERE auth_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_registration_audit_enterprise ON public.registration_audit(enterprise_id) WHERE enterprise_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_registration_audit_stage ON public.registration_audit(stage);
CREATE INDEX IF NOT EXISTS idx_registration_audit_created_at ON public.registration_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_registration_audit_event_type ON public.registration_audit(event_type);

-- ============================================================
-- 7. LENDERS — Role-specific table (was missing)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.lenders (
  auth_user_id UUID PRIMARY KEY,
  member_id TEXT NOT NULL DEFAULT '',
  lending_category TEXT NOT NULL DEFAULT '',
  minimum_amount NUMERIC NOT NULL DEFAULT 0,
  maximum_amount NUMERIC NOT NULL DEFAULT 0,
  states_served TEXT NOT NULL DEFAULT '',
  licensing_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (licensing_status IN ('not_started','pending','verified','rejected')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','inactive','suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lenders_member ON public.lenders(member_id) WHERE member_id != '';
CREATE INDEX IF NOT EXISTS idx_lenders_status ON public.lenders(status);

-- ============================================================
-- 8. VENDOR_CONTRACTORS — Role-specific table (was missing)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.vendor_contractors (
  auth_user_id UUID PRIMARY KEY,
  member_id TEXT NOT NULL DEFAULT '',
  service_category TEXT NOT NULL DEFAULT '',
  service_description TEXT NOT NULL DEFAULT '',
  states_served TEXT NOT NULL DEFAULT '',
  licensing_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (licensing_status IN ('not_started','pending','verified','rejected')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','inactive','suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_contractors_member ON public.vendor_contractors(member_id) WHERE member_id != '';
CREATE INDEX IF NOT EXISTS idx_vendor_contractors_status ON public.vendor_contractors(status);

-- ============================================================
-- 9. RLS POLICIES
-- ============================================================
-- Enterprises: public can register (insert), but only owner/admin can update/read all
ALTER TABLE public.enterprises ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "enterprises_public_insert" ON public.enterprises;
CREATE POLICY enterprises_public_insert ON public.enterprises
  FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "enterprises_service_role_all" ON public.enterprises;
CREATE POLICY enterprises_service_role_all ON public.enterprises
  FOR ALL USING (auth.role() = 'service_role');

-- Enterprise memberships: only service_role can manage
ALTER TABLE public.enterprise_memberships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "enterprise_memberships_service_role_all" ON public.enterprise_memberships;
CREATE POLICY enterprise_memberships_service_role_all ON public.enterprise_memberships
  FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "enterprise_memberships_self_insert" ON public.enterprise_memberships;
CREATE POLICY enterprise_memberships_self_insert ON public.enterprise_memberships
  FOR INSERT WITH CHECK (true);

-- Enterprise invitations: only service_role can read/manage
ALTER TABLE public.enterprise_invitations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "enterprise_invitations_service_role_all" ON public.enterprise_invitations;
CREATE POLICY enterprise_invitations_service_role_all ON public.enterprise_invitations
  FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "enterprise_invitations_public_insert" ON public.enterprise_invitations;
CREATE POLICY enterprise_invitations_public_insert ON public.enterprise_invitations
  FOR INSERT WITH CHECK (true);

-- Registration consent: users can insert their own, service_role can read all
ALTER TABLE public.registration_consent ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "registration_consent_public_insert" ON public.registration_consent;
CREATE POLICY registration_consent_public_insert ON public.registration_consent
  FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "registration_consent_service_role_all" ON public.registration_consent;
CREATE POLICY registration_consent_service_role_all ON public.registration_consent
  FOR ALL USING (auth.role() = 'service_role');

-- KYC/AML: only service_role can manage (never self-verified)
ALTER TABLE public.kyc_aml_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "kyc_aml_service_role_all" ON public.kyc_aml_status;
CREATE POLICY kyc_aml_service_role_all ON public.kyc_aml_status
  FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "kyc_aml_public_insert" ON public.kyc_aml_status;
CREATE POLICY kyc_aml_public_insert ON public.kyc_aml_status
  FOR INSERT WITH CHECK (true);

-- Registration audit: append-only (insert only, no update/delete via API)
ALTER TABLE public.registration_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "registration_audit_public_insert" ON public.registration_audit;
CREATE POLICY registration_audit_public_insert ON public.registration_audit
  FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "registration_audit_service_role_read" ON public.registration_audit;
CREATE POLICY registration_audit_service_role_read ON public.registration_audit
  FOR SELECT USING (auth.role() = 'service_role');

-- Lenders / vendor_contractors: service_role manages
ALTER TABLE public.lenders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lenders_service_role_all" ON public.lenders;
CREATE POLICY lenders_service_role_all ON public.lenders
  FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "lenders_public_insert" ON public.lenders;
CREATE POLICY lenders_public_insert ON public.lenders
  FOR INSERT WITH CHECK (true);

ALTER TABLE public.vendor_contractors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "vendor_contractors_service_role_all" ON public.vendor_contractors;
CREATE POLICY vendor_contractors_service_role_all ON public.vendor_contractors
  FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "vendor_contractors_public_insert" ON public.vendor_contractors;
CREATE POLICY vendor_contractors_public_insert ON public.vendor_contractors
  FOR INSERT WITH CHECK (true);

-- ============================================================
-- 10. updated_at TRIGGERS
-- ============================================================
CREATE OR REPLACE FUNCTION public.ivx_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enterprises_updated_at ON public.enterprises;
CREATE TRIGGER trg_enterprises_updated_at BEFORE UPDATE ON public.enterprises
  FOR EACH ROW EXECUTE FUNCTION public.ivx_touch_updated_at();

DROP TRIGGER IF EXISTS trg_enterprise_memberships_updated_at ON public.enterprise_memberships;
CREATE TRIGGER trg_enterprise_memberships_updated_at BEFORE UPDATE ON public.enterprise_memberships
  FOR EACH ROW EXECUTE FUNCTION public.ivx_touch_updated_at();

DROP TRIGGER IF EXISTS trg_enterprise_invitations_updated_at ON public.enterprise_invitations;
CREATE TRIGGER trg_enterprise_invitations_updated_at BEFORE UPDATE ON public.enterprise_invitations
  FOR EACH ROW EXECUTE FUNCTION public.ivx_touch_updated_at();

DROP TRIGGER IF EXISTS trg_kyc_aml_status_updated_at ON public.kyc_aml_status;
CREATE TRIGGER trg_kyc_aml_status_updated_at BEFORE UPDATE ON public.kyc_aml_status
  FOR EACH ROW EXECUTE FUNCTION public.ivx_touch_updated_at();

DROP TRIGGER IF EXISTS trg_lenders_updated_at ON public.lenders;
CREATE TRIGGER trg_lenders_updated_at BEFORE UPDATE ON public.lenders
  FOR EACH ROW EXECUTE FUNCTION public.ivx_touch_updated_at();

DROP TRIGGER IF EXISTS trg_vendor_contractors_updated_at ON public.vendor_contractors;
CREATE TRIGGER trg_vendor_contractors_updated_at BEFORE UPDATE ON public.vendor_contractors
  FOR EACH ROW EXECUTE FUNCTION public.ivx_touch_updated_at();