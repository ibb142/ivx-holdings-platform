-- ═══════════════════════════════════════════════════════════════
-- IVX Holdings — Data Retention & Deletion Policy (item 169)
-- Defines retention periods for leads, KYC, chat, and audit data.
-- Marker: ivx-data-retention-2026-08-13
-- ═══════════════════════════════════════════════════════════════

-- ═══ RETENTION POLICY TABLE ═══

CREATE TABLE IF NOT EXISTS public.data_retention_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  retention_period_days INT NOT NULL,
  description TEXT,
  legal_basis TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══ INSERT RETENTION POLICIES ═══
-- Lead data: retain for 2 years, then delete (CAN-SPAM, GDPR)
INSERT INTO public.data_retention_policies (table_name, retention_period_days, description, legal_basis)
VALUES
  ('lead_capture', 730, 'Lead capture form submissions', 'CAN-SPAM Act, GDPR Art. 5(1)(e)') ON CONFLICT DO NOTHING;

INSERT INTO public.data_retention_policies (table_name, retention_period_days, description, legal_basis)
VALUES
  ('waitlist', 730, 'Waitlist entries', 'CAN-SPAM Act, GDPR Art. 5(1)(e)') ON CONFLICT DO NOTHING;

-- KYC documents: retain for 5 years (AML/BSA regulatory requirement)
INSERT INTO public.data_retention_policies (table_name, retention_period_days, description, legal_basis)
VALUES
  ('kyc_documents', 1825, 'KYC identity verification documents', 'Bank Secrecy Act, AML regulations, 31 CFR 1010.430') ON CONFLICT DO NOTHING;

-- Audit logs: retain for 7 years (financial audit trail requirement)
INSERT INTO public.data_retention_policies (table_name, retention_period_days, description, legal_basis)
VALUES
  ('audit_logs', 2555, 'Financial and authentication audit trail', 'SOX, SEC Rule 17a-4, IRS requirements') ON CONFLICT DO NOTHING;

-- Chat messages: retain for 1 year, then delete
INSERT INTO public.data_retention_policies (table_name, retention_period_days, description, legal_basis)
VALUES
  ('chat_messages', 365, 'Investor chat messages', 'IVX privacy policy') ON CONFLICT DO NOTHING;

-- Transactions: retain for 7 years (financial records)
INSERT INTO public.data_retention_policies (table_name, retention_period_days, description, legal_basis)
VALUES
  ('transactions', 2555, 'Treasury and investment transactions', 'IRS, SEC, financial record retention') ON CONFLICT DO NOTHING;

-- Wire submissions: retain for 7 years (financial records)
INSERT INTO public.data_retention_policies (table_name, retention_period_days, description, legal_basis)
VALUES
  ('wire_submissions', 2555, 'Wire transfer notifications', 'Bank Secrecy Act, AML') ON CONFLICT DO NOTHING;

-- Investments: retain for 7 years after completion (SEC, tax)
INSERT INTO public.data_retention_policies (table_name, retention_period_days, description, legal_basis)
VALUES
  ('investments', 2555, 'Investment records and positions', 'SEC, IRS, financial record retention') ON CONFLICT DO NOTHING;

-- ═══ SOFT DELETE COLUMN (for GDPR right to erasure) ═══
-- Instead of hard-deleting, mark as deleted and schedule purge after retention period.
-- This preserves audit trail integrity while honoring deletion requests.

ALTER TABLE IF EXISTS public.lead_capture
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE IF EXISTS public.waitlist
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE IF EXISTS public.chat_messages
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- ═══ CLEANUP FUNCTION ═══
-- Scheduled function to purge records past their retention period.
-- Run daily via pg_cron or external scheduler.

CREATE OR REPLACE FUNCTION public.cleanup_expired_data()
RETURNS TABLE(table_name TEXT, records_deleted INT)
AS $$
DECLARE
  policy RECORD;
  count_deleted INT;
BEGIN
  FOR policy IN
    SELECT table_name, retention_period_days
    FROM public.data_retention_policies
  LOOP
    EXECUTE format(
      'WITH deleted AS (
        DELETE FROM public.%I
        WHERE created_at < NOW() - INTERVAL '%s days'
        RETURNING 1
      )
      SELECT COUNT(*)::INT FROM deleted',
      policy.table_name,
      policy.retention_period_days
    ) INTO count_deleted;

    -- Log cleanup (without PII)
    INSERT INTO public.audit_logs (action, details, result, created_at)
    VALUES (
      'data_delete',
      jsonb_build_object('table', policy.table_name, 'retention_days', policy.retention_period_days, 'count', count_deleted),
      'success',
      NOW()
    );

    RETURN QUERY SELECT policy.table_name, count_deleted;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ═══ RIGHT TO ERASURE (GDPR Art. 17) ═══
-- When a user requests deletion, soft-delete their records immediately.
-- Hard deletion happens after the retention period expires via cleanup_expired_data().

CREATE OR REPLACE FUNCTION public.request_data_deletion(p_user_id UUID)
RETURNS TABLE(table_name TEXT, records_soft_deleted INT)
AS $$
DECLARE
  count_deleted INT;
BEGIN
  -- Soft delete leads
  UPDATE public.lead_capture SET deleted_at = NOW() WHERE user_id = p_user_id AND deleted_at IS NULL;
  GET DIAGNOSTICS count_deleted = ROW_COUNT;
  RETURN QUERY SELECT 'lead_capture'::TEXT, count_deleted;

  -- Soft delete chat messages
  UPDATE public.chat_messages SET deleted_at = NOW() WHERE user_id = p_user_id AND deleted_at IS NULL;
  GET DIAGNOSTICS count_deleted = ROW_COUNT;
  RETURN QUERY SELECT 'chat_messages'::TEXT, count_deleted;

  -- Note: KYC documents and financial records are NOT soft-deleted
  -- until their legal retention period expires (5-7 years).
  -- User is informed of this in the privacy policy.

  -- Log the deletion request
  INSERT INTO public.audit_logs (action, details, result, created_at)
  VALUES (
    'data_delete',
    jsonb_build_object('user_id', '***', 'type', 'right_to_erasure_request'),
    'success',
    NOW()
  );

  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ═══ VERIFICATION QUERY ═══
-- SELECT * FROM public.data_retention_policies ORDER BY retention_period_days DESC;
-- SELECT * FROM public.cleanup_expired_data();
