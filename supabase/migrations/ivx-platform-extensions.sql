-- IVX Platform Extensions Schema
-- Covers Points 5-8: Owner system, compliance workflow, payments, global core
-- Uses IF NOT EXISTS to avoid conflicts

-- ============================================================================
-- POINT 8: LANGUAGES
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_languages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  native_name TEXT NOT NULL,
  direction TEXT DEFAULT 'ltr',
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO ivx_re_languages (code, name, native_name, direction, sort_order) VALUES
  ('en', 'English', 'English', 'ltr', 1),
  ('es', 'Spanish', 'Español', 'ltr', 2),
  ('pt', 'Portuguese', 'Português', 'ltr', 3),
  ('fr', 'French', 'Français', 'ltr', 4),
  ('de', 'German', 'Deutsch', 'ltr', 5),
  ('it', 'Italian', 'Italiano', 'ltr', 6),
  ('nl', 'Dutch', 'Nederlands', 'ltr', 7),
  ('ar', 'Arabic', 'العربية', 'rtl', 8),
  ('zh', 'Chinese', '中文', 'ltr', 9),
  ('ja', 'Japanese', '日本語', 'ltr', 10),
  ('ko', 'Korean', '한국어', 'ltr', 11),
  ('ru', 'Russian', 'Русский', 'ltr', 12),
  ('he', 'Hebrew', 'עברית', 'rtl', 13),
  ('hi', 'Hindi', 'हिन्दी', 'ltr', 14)
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- POINT 8: TIMEZONES
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_timezones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tz_id TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  utc_offset TEXT NOT NULL,
  country_iso TEXT REFERENCES ivx_re_countries(iso_code),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO ivx_re_timezones (tz_id, label, utc_offset, country_iso) VALUES
  ('America/New_York', 'Eastern Time', '-05:00', 'US'),
  ('America/Chicago', 'Central Time', '-06:00', 'US'),
  ('America/Denver', 'Mountain Time', '-07:00', 'US'),
  ('America/Los_Angeles', 'Pacific Time', '-08:00', 'US'),
  ('America/Mexico_City', 'Mexico City Time', '-06:00', 'MX'),
  ('America/Bogota', 'Colombia Time', '-05:00', 'CO'),
  ('America/Toronto', 'Eastern Time (CA)', '-05:00', 'CA'),
  ('Europe/London', 'Greenwich Mean Time', '+00:00', 'GB'),
  ('Europe/Madrid', 'Central European Time', '+01:00', 'ES'),
  ('Europe/Lisbon', 'Western European Time', '+00:00', 'PT'),
  ('America/Sao_Paulo', 'Brasilia Time', '-03:00', 'BR'),
  ('America/Panama', 'Panama Time', '-05:00', 'PA'),
  ('America/Santo_Domingo', 'Dominican Republic Time', '-04:00', 'DO'),
  ('America/Costa_Rica', 'Costa Rica Time', '-06:00', 'CR'),
  ('Asia/Dubai', 'Gulf Standard Time', '+04:00', 'AE')
ON CONFLICT (tz_id) DO NOTHING;

-- ============================================================================
-- POINT 8: TAX RULES PER JURISDICTION
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_tax_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction_id UUID REFERENCES ivx_re_jurisdictions(id) ON DELETE CASCADE,
  tax_type TEXT NOT NULL,
  rate NUMERIC(5,2) NOT NULL,
  description TEXT,
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expiry_date DATE,
  threshold_amount NUMERIC(18,2),
  is_progressive BOOLEAN DEFAULT false,
  progressive_brackets JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT true,
  legal_reference TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tax_rules_jurisdiction ON ivx_re_tax_rules (jurisdiction_id);
CREATE INDEX IF NOT EXISTS idx_tax_rules_type ON ivx_re_tax_rules (tax_type);

-- ============================================================================
-- POINT 5: OWNER PROFILES
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_owner_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  legal_name TEXT,
  entity_type TEXT DEFAULT 'individual',
  tax_id_encrypted TEXT,
  phone TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state_province TEXT,
  postal_code TEXT,
  country_iso TEXT REFERENCES ivx_re_countries(iso_code),
  preferred_language TEXT DEFAULT 'en',
  preferred_currency TEXT DEFAULT 'USD',
  preferred_timezone TEXT DEFAULT 'America/New_York',
  kyc_status TEXT DEFAULT 'not_started',
  kyb_status TEXT DEFAULT 'not_started',
  sanctions_status TEXT DEFAULT 'not_checked',
  accreditation_status TEXT DEFAULT 'not_submitted',
  risk_rating TEXT DEFAULT 'pending',
  total_holdings_value NUMERIC(18,2) DEFAULT 0,
  total_equity NUMERIC(18,2) DEFAULT 0,
  total_annual_income NUMERIC(18,2) DEFAULT 0,
  total_annual_expenses NUMERIC(18,2) DEFAULT 0,
  total_properties INTEGER DEFAULT 0,
  is_verified BOOLEAN DEFAULT false,
  verification_date TIMESTAMPTZ,
  verification_notes TEXT,
  compliance_flags JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_owner_profiles_user ON ivx_re_owner_profiles (user_id);
CREATE INDEX IF NOT EXISTS idx_owner_profiles_kyc ON ivx_re_owner_profiles (kyc_status);

-- ============================================================================
-- POINT 5: OWNER HOLDINGS
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_owner_holdings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_profile_id UUID REFERENCES ivx_re_owner_profiles(id) ON DELETE CASCADE,
  listing_id UUID REFERENCES ivx_re_property_listings(id) ON DELETE SET NULL,
  property_title TEXT NOT NULL,
  acquisition_date DATE NOT NULL,
  acquisition_price NUMERIC(18,2) NOT NULL,
  currency_code TEXT NOT NULL DEFAULT 'USD' REFERENCES ivx_re_currencies(code),
  current_value NUMERIC(18,2) NOT NULL DEFAULT 0,
  current_value_updated TIMESTAMPTZ DEFAULT now(),
  outstanding_mortgage NUMERIC(18,2) DEFAULT 0,
  equity NUMERIC(18,2) GENERATED ALWAYS AS (current_value - outstanding_mortgage) STORED,
  ownership_percentage NUMERIC(5,2) DEFAULT 100.00,
  annual_rental_income NUMERIC(18,2) DEFAULT 0,
  annual_expenses NUMERIC(18,2) DEFAULT 0,
  annual_net_cash_flow NUMERIC(18,2) GENERATED ALWAYS AS (annual_rental_income - annual_expenses) STORED,
  cap_rate NUMERIC(5,2),
  cash_on_cash_return NUMERIC(5,2),
  status TEXT DEFAULT 'active',
  is_listed_for_sale BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_owner_holdings_profile ON ivx_re_owner_holdings (owner_profile_id);
CREATE INDEX IF NOT EXISTS idx_owner_holdings_status ON ivx_re_owner_holdings (status);

-- ============================================================================
-- POINT 5: OWNER INCOME / EXPENSES
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_owner_income_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_profile_id UUID REFERENCES ivx_re_owner_profiles(id) ON DELETE CASCADE,
  holding_id UUID REFERENCES ivx_re_owner_holdings(id) ON DELETE CASCADE,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('income', 'expense')),
  category TEXT NOT NULL,
  description TEXT,
  amount NUMERIC(18,2) NOT NULL,
  currency_code TEXT NOT NULL DEFAULT 'USD' REFERENCES ivx_re_currencies(code),
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  recurring BOOLEAN DEFAULT false,
  recurrence_pattern TEXT,
  receipt_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_income_expenses_owner ON ivx_re_owner_income_expenses (owner_profile_id);
CREATE INDEX IF NOT EXISTS idx_income_expenses_holding ON ivx_re_owner_income_expenses (holding_id);
CREATE INDEX IF NOT EXISTS idx_income_expenses_type ON ivx_re_owner_income_expenses (entry_type);
CREATE INDEX IF NOT EXISTS idx_income_expenses_date ON ivx_re_owner_income_expenses (entry_date);

-- ============================================================================
-- POINT 5: OWNER DOCUMENTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_owner_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_profile_id UUID REFERENCES ivx_re_owner_profiles(id) ON DELETE CASCADE,
  holding_id UUID REFERENCES ivx_re_owner_holdings(id) ON DELETE SET NULL,
  document_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  file_url TEXT NOT NULL,
  file_size_bytes BIGINT,
  mime_type TEXT,
  uploaded_by UUID,
  is_verified BOOLEAN DEFAULT false,
  verified_by UUID,
  verification_date TIMESTAMPTZ,
  expiry_date DATE,
  tags JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_owner_documents_profile ON ivx_re_owner_documents (owner_profile_id);
CREATE INDEX IF NOT EXISTS idx_owner_documents_type ON ivx_re_owner_documents (document_type);

-- ============================================================================
-- POINT 5: PORTFOLIO SNAPSHOTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_portfolio_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_profile_id UUID REFERENCES ivx_re_owner_profiles(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  total_holdings_value NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_equity NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_annual_income NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_annual_expenses NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_net_cash_flow NUMERIC(18,2) NOT NULL DEFAULT 0,
  blended_cap_rate NUMERIC(5,2),
  cash_on_cash_return NUMERIC(5,2),
  property_count INTEGER NOT NULL DEFAULT 0,
  currency_code TEXT NOT NULL DEFAULT 'USD' REFERENCES ivx_re_currencies(code),
  allocation_by_type JSONB DEFAULT '{}',
  allocation_by_country JSONB DEFAULT '{}',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_owner ON ivx_re_portfolio_snapshots (owner_profile_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_date ON ivx_re_portfolio_snapshots (snapshot_date);

-- ============================================================================
-- POINT 6: COMPLIANCE WORKFLOW STEPS
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_compliance_workflow (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_profile_id UUID REFERENCES ivx_re_owner_profiles(id) ON DELETE CASCADE,
  transaction_id UUID,
  step_name TEXT NOT NULL,
  step_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  assigned_to UUID,
  assigned_role TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  due_date TIMESTAMPTZ,
  review_notes TEXT,
  review_decision TEXT,
  evidence_urls JSONB DEFAULT '[]',
  risk_score INTEGER DEFAULT 0,
  risk_factors JSONB DEFAULT '[]',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compliance_workflow_owner ON ivx_re_compliance_workflow (owner_profile_id);
CREATE INDEX IF NOT EXISTS idx_compliance_workflow_status ON ivx_re_compliance_workflow (status);
CREATE INDEX IF NOT EXISTS idx_compliance_workflow_transaction ON ivx_re_compliance_workflow (transaction_id);

-- ============================================================================
-- POINT 6: COMPLIANCE CONSENTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  consent_type TEXT NOT NULL,
  consent_text TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  is_granted BOOLEAN NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  granted_at TIMESTAMPTZ DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  jurisdiction TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consents_user ON ivx_re_consents (user_id);
CREATE INDEX IF NOT EXISTS idx_consents_type ON ivx_re_consents (consent_type);

-- ============================================================================
-- POINT 6: ROLE PERMISSIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role TEXT NOT NULL,
  permission TEXT NOT NULL,
  description TEXT,
  is_granted BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (role, permission)
);

INSERT INTO ivx_re_role_permissions (role, permission, description) VALUES
  ('owner', 'view_all_properties', 'View all property listings'),
  ('owner', 'create_listing', 'Create new property listings'),
  ('owner', 'manage_own_listings', 'Manage own property listings'),
  ('owner', 'view_own_portfolio', 'View own portfolio dashboard'),
  ('owner', 'manage_own_documents', 'Manage own documents'),
  ('owner', 'view_own_transactions', 'View own transaction history'),
  ('investor', 'view_active_listings', 'View active property listings'),
  ('investor', 'make_offers', 'Make offers on properties'),
  ('investor', 'view_own_offers', 'View own offers'),
  ('investor', 'view_own_contracts', 'View own contracts'),
  ('investor', 'submit_kyc', 'Submit KYC documentation'),
  ('investor', 'submit_proof_of_funds', 'Submit proof of funds'),
  ('broker', 'view_all_listings', 'View all property listings'),
  ('broker', 'manage_assigned_listings', 'Manage assigned property listings'),
  ('broker', 'create_offers_for_clients', 'Create offers on behalf of clients'),
  ('broker', 'view_client_portfolio', 'View client portfolios'),
  ('admin', 'manage_all_listings', 'Manage all property listings'),
  ('admin', 'manage_users', 'Manage user accounts'),
  ('admin', 'manage_compliance', 'Manage compliance workflows'),
  ('admin', 'manage_escrow', 'Manage escrow accounts'),
  ('admin', 'view_all_transactions', 'View all transactions'),
  ('admin', 'manage_brokers', 'Manage broker accounts'),
  ('admin', 'manage_currencies', 'Manage currency settings'),
  ('admin', 'manage_jurisdictions', 'Manage jurisdiction settings'),
  ('compliance_officer', 'review_kyc', 'Review KYC submissions'),
  ('compliance_officer', 'review_kyb', 'Review KYB submissions'),
  ('compliance_officer', 'run_sanctions_check', 'Run sanctions screening'),
  ('compliance_officer', 'approve_transactions', 'Approve transactions for compliance'),
  ('compliance_officer', 'manage_workflow', 'Manage compliance workflow steps')
ON CONFLICT (role, permission) DO NOTHING;

-- ============================================================================
-- POINT 7: PAYMENT PROCESSOR RECORDS
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_payment_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID,
  escrow_id UUID REFERENCES ivx_re_escrow_accounts(id) ON DELETE SET NULL,
  owner_profile_id UUID REFERENCES ivx_re_owner_profiles(id) ON DELETE SET NULL,
  payment_type TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_transaction_id TEXT,
  amount NUMERIC(18,2) NOT NULL,
  currency_code TEXT NOT NULL DEFAULT 'USD' REFERENCES ivx_re_currencies(code),
  fee_amount NUMERIC(18,2) DEFAULT 0,
  fee_currency TEXT,
  net_amount NUMERIC(18,2) GENERATED ALWAYS AS (amount - fee_amount) STORED,
  status TEXT NOT NULL DEFAULT 'pending',
  failure_reason TEXT,
  provider_response JSONB DEFAULT '{}',
  webhook_events JSONB DEFAULT '[]',
  initiated_by UUID,
  completed_at TIMESTAMPTZ,
  refund_amount NUMERIC(18,2) DEFAULT 0,
  refund_reason TEXT,
  refund_processed_at TIMESTAMPTZ,
  reconciliation_status TEXT DEFAULT 'unreconciled',
  reconciliation_id UUID,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_records_escrow ON ivx_re_payment_records (escrow_id);
CREATE INDEX IF NOT EXISTS idx_payment_records_owner ON ivx_re_payment_records (owner_profile_id);
CREATE INDEX IF NOT EXISTS idx_payment_records_status ON ivx_re_payment_records (status);
CREATE INDEX IF NOT EXISTS idx_payment_records_provider ON ivx_re_payment_records (provider);

-- ============================================================================
-- POINT 7: FEE STRUCTURES
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_fee_structures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fee_name TEXT NOT NULL,
  fee_type TEXT NOT NULL,
  calculation_method TEXT NOT NULL,
  rate NUMERIC(5,2),
  flat_amount NUMERIC(18,2),
  currency_code TEXT NOT NULL DEFAULT 'USD' REFERENCES ivx_re_currencies(code),
  min_amount NUMERIC(18,2),
  max_amount NUMERIC(18,2),
  applies_to TEXT NOT NULL,
  jurisdiction_id UUID REFERENCES ivx_re_jurisdictions(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT true,
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expiry_date DATE,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fee_structures_type ON ivx_re_fee_structures (fee_type);
CREATE INDEX IF NOT EXISTS idx_fee_structures_jurisdiction ON ivx_re_fee_structures (jurisdiction_id);

-- ============================================================================
-- POINT 7: RECONCILIATION RECORDS
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_reconciliation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_date DATE NOT NULL DEFAULT CURRENT_DATE,
  provider TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  total_expected NUMERIC(18,2) NOT NULL,
  total_actual NUMERIC(18,2) NOT NULL,
  variance NUMERIC(18,2) GENERATED ALWAYS AS (total_actual - total_expected) STORED,
  variance_percentage NUMERIC(5,2),
  status TEXT DEFAULT 'pending',
  matched_count INTEGER DEFAULT 0,
  unmatched_count INTEGER DEFAULT 0,
  matched_by UUID,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_date ON ivx_re_reconciliation (reconciliation_date);
CREATE INDEX IF NOT EXISTS idx_reconciliation_status ON ivx_re_reconciliation (status);

-- ============================================================================
-- POINT 10: PILOT MARKET CONFIGURATION
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_pilot_markets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_name TEXT NOT NULL,
  country_iso TEXT REFERENCES ivx_re_countries(iso_code),
  region_name TEXT NOT NULL,
  city TEXT NOT NULL,
  status TEXT DEFAULT 'planning',
  launch_date DATE,
  target_properties INTEGER DEFAULT 10,
  target_brokers INTEGER DEFAULT 3,
  active_properties INTEGER DEFAULT 0,
  verified_properties INTEGER DEFAULT 0,
  active_brokers INTEGER DEFAULT 0,
  total_offers INTEGER DEFAULT 0,
  accepted_offers INTEGER DEFAULT 0,
  closed_transactions INTEGER DEFAULT 0,
  total_volume NUMERIC(18,2) DEFAULT 0,
  total_revenue NUMERIC(18,2) DEFAULT 0,
  avg_days_to_close INTEGER,
  fraud_incidents INTEGER DEFAULT 0,
  metrics JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pilot_markets_status ON ivx_re_pilot_markets (status);
CREATE INDEX IF NOT EXISTS idx_pilot_markets_city ON ivx_re_pilot_markets (city);

-- ============================================================================
-- POINT 9: SECURITY AUDIT LOG
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  user_id UUID,
  ip_address TEXT,
  user_agent TEXT,
  endpoint TEXT,
  method TEXT,
  details JSONB DEFAULT '{}',
  blocked BOOLEAN DEFAULT false,
  rule_triggered TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_events_type ON ivx_re_security_events (event_type);
CREATE INDEX IF NOT EXISTS idx_security_events_severity ON ivx_re_security_events (severity);
CREATE INDEX IF NOT EXISTS idx_security_events_user ON ivx_re_security_events (user_id);
CREATE INDEX IF NOT EXISTS idx_security_events_date ON ivx_re_security_events (created_at);

-- ============================================================================
-- TRIGGERS: Auto-update owner profile aggregates
-- ============================================================================
CREATE OR REPLACE FUNCTION ivx_re_update_owner_aggregates() RETURNS TRIGGER AS $$
BEGIN
  -- Update total_holdings_value, total_properties when holdings change
  IF TG_TABLE_NAME = 'ivx_re_owner_holdings' THEN
    UPDATE ivx_re_owner_profiles SET
      total_holdings_value = COALESCE((
        SELECT SUM(current_value) FROM ivx_re_owner_holdings
        WHERE owner_profile_id = NEW.owner_profile_id AND status = 'active'
      ), 0),
      total_equity = COALESCE((
        SELECT SUM(current_value - outstanding_mortgage) FROM ivx_re_owner_holdings
        WHERE owner_profile_id = NEW.owner_profile_id AND status = 'active'
      ), 0),
      total_properties = COALESCE((
        SELECT COUNT(*) FROM ivx_re_owner_holdings
        WHERE owner_profile_id = NEW.owner_profile_id AND status = 'active'
      ), 0),
      updated_at = now()
    WHERE id = NEW.owner_profile_id;
  END IF;
  -- Update income/expense totals
  IF TG_TABLE_NAME = 'ivx_re_owner_income_expenses' THEN
    UPDATE ivx_re_owner_profiles SET
      total_annual_income = COALESCE((
        SELECT SUM(amount) FROM ivx_re_owner_income_expenses
        WHERE owner_profile_id = NEW.owner_profile_id AND entry_type = 'income'
        AND EXTRACT(YEAR FROM entry_date) = EXTRACT(YEAR FROM CURRENT_DATE)
      ), 0),
      total_annual_expenses = COALESCE((
        SELECT SUM(amount) FROM ivx_re_owner_income_expenses
        WHERE owner_profile_id = NEW.owner_profile_id AND entry_type = 'expense'
        AND EXTRACT(YEAR FROM entry_date) = EXTRACT(YEAR FROM CURRENT_DATE)
      ), 0),
      updated_at = now()
    WHERE id = NEW.owner_profile_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_update_owner_on_holdings ON ivx_re_owner_holdings;
CREATE TRIGGER trg_update_owner_on_holdings
  AFTER INSERT OR UPDATE OR DELETE ON ivx_re_owner_holdings
  FOR EACH ROW EXECUTE FUNCTION ivx_re_update_owner_aggregates();

DROP TRIGGER IF EXISTS trg_update_owner_on_income ON ivx_re_owner_income_expenses;
CREATE TRIGGER trg_update_owner_on_income
  AFTER INSERT OR UPDATE OR DELETE ON ivx_re_owner_income_expenses
  FOR EACH ROW EXECUTE FUNCTION ivx_re_update_owner_aggregates();

-- ============================================================================
-- RLS POLICIES
-- ============================================================================
ALTER TABLE ivx_re_owner_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE ivx_re_owner_holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ivx_re_owner_income_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE ivx_re_owner_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE ivx_re_portfolio_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE ivx_re_compliance_workflow ENABLE ROW LEVEL SECURITY;
ALTER TABLE ivx_re_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE ivx_re_payment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE ivx_re_reconciliation ENABLE ROW LEVEL SECURITY;
ALTER TABLE ivx_re_security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ivx_re_pilot_markets ENABLE ROW LEVEL SECURITY;

-- Owner can view their own data
CREATE POLICY IF NOT EXISTS owner_select_own ON ivx_re_owner_profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS owner_insert_own ON ivx_re_owner_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS owner_update_own ON ivx_re_owner_profiles FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS holdings_select_own ON ivx_re_owner_holdings FOR SELECT USING (
  EXISTS (SELECT 1 FROM ivx_re_owner_profiles WHERE id = owner_profile_id AND user_id = auth.uid())
);
CREATE POLICY IF NOT EXISTS holdings_insert_own ON ivx_re_owner_holdings FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM ivx_re_owner_profiles WHERE id = owner_profile_id AND user_id = auth.uid())
);
CREATE POLICY IF NOT EXISTS holdings_update_own ON ivx_re_owner_holdings FOR UPDATE USING (
  EXISTS (SELECT 1 FROM ivx_re_owner_profiles WHERE id = owner_profile_id AND user_id = auth.uid())
);
CREATE POLICY IF NOT EXISTS holdings_delete_own ON ivx_re_owner_holdings FOR DELETE USING (
  EXISTS (SELECT 1 FROM ivx_re_owner_profiles WHERE id = owner_profile_id AND user_id = auth.uid())
);

CREATE POLICY IF NOT EXISTS income_select_own ON ivx_re_owner_income_expenses FOR SELECT USING (
  EXISTS (SELECT 1 FROM ivx_re_owner_profiles WHERE id = owner_profile_id AND user_id = auth.uid())
);
CREATE POLICY IF NOT EXISTS income_insert_own ON ivx_re_owner_income_expenses FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM ivx_re_owner_profiles WHERE id = owner_profile_id AND user_id = auth.uid())
);
CREATE POLICY IF NOT EXISTS income_update_own ON ivx_re_owner_income_expenses FOR UPDATE USING (
  EXISTS (SELECT 1 FROM ivx_re_owner_profiles WHERE id = owner_profile_id AND user_id = auth.uid())
);
CREATE POLICY IF NOT EXISTS income_delete_own ON ivx_re_owner_income_expenses FOR DELETE USING (
  EXISTS (SELECT 1 FROM ivx_re_owner_profiles WHERE id = owner_profile_id AND user_id = auth.uid())
);

CREATE POLICY IF NOT EXISTS docs_select_own ON ivx_re_owner_documents FOR SELECT USING (
  EXISTS (SELECT 1 FROM ivx_re_owner_profiles WHERE id = owner_profile_id AND user_id = auth.uid())
);
CREATE POLICY IF NOT EXISTS docs_insert_own ON ivx_re_owner_documents FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM ivx_re_owner_profiles WHERE id = owner_profile_id AND user_id = auth.uid())
);
CREATE POLICY IF NOT EXISTS docs_update_own ON ivx_re_owner_documents FOR UPDATE USING (
  EXISTS (SELECT 1 FROM ivx_re_owner_profiles WHERE id = owner_profile_id AND user_id = auth.uid())
);
CREATE POLICY IF NOT EXISTS docs_delete_own ON ivx_re_owner_documents FOR DELETE USING (
  EXISTS (SELECT 1 FROM ivx_re_owner_profiles WHERE id = owner_profile_id AND user_id = auth.uid())
);

CREATE POLICY IF NOT EXISTS snapshots_select_own ON ivx_re_portfolio_snapshots FOR SELECT USING (
  EXISTS (SELECT 1 FROM ivx_re_owner_profiles WHERE id = owner_profile_id AND user_id = auth.uid())
);

-- Public catalogs (languages, timezones, tax rules, fee structures, permissions) are readable by all
ALTER TABLE ivx_re_languages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ivx_re_timezones ENABLE ROW LEVEL SECURITY;
ALTER TABLE ivx_re_tax_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE ivx_re_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ivx_re_fee_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE ivx_re_pilot_markets ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS languages_read_all ON ivx_re_languages FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS timezones_read_all ON ivx_re_timezones FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS tax_rules_read_all ON ivx_re_tax_rules FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS permissions_read_all ON ivx_re_role_permissions FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS fee_structures_read_all ON ivx_re_fee_structures FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS pilot_markets_read_all ON ivx_re_pilot_markets FOR SELECT USING (true);

-- Consents: user can only see their own
CREATE POLICY IF NOT EXISTS consents_select_own ON ivx_re_consents FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS consents_insert_own ON ivx_re_consents FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Payment records: owner can view their own
CREATE POLICY IF NOT EXISTS payments_select_own ON ivx_re_payment_records FOR SELECT USING (
  owner_profile_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM ivx_re_owner_profiles WHERE id = owner_profile_id AND user_id = auth.uid()
  )
);

-- Reconciliation: admin only (no policy = blocked for non-service roles)
-- Security events: admin only (no policy = blocked for non-service roles)

-- ============================================================================
-- UPDATED_AT TRIGGERS
-- ============================================================================
CREATE OR REPLACE FUNCTION ivx_re_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN VALUES
    ('ivx_re_owner_profiles'),
    ('ivx_re_owner_holdings'),
    ('ivx_re_owner_documents'),
    ('ivx_re_compliance_workflow'),
    ('ivx_re_payment_records'),
    ('ivx_re_fee_structures'),
    ('ivx_re_pilot_markets'),
    ('ivx_re_tax_rules')
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_set_updated_%s ON %s; CREATE TRIGGER trg_set_updated_%s BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION ivx_re_set_updated_at();',
      t, t, t, t
    );
  END LOOP;
END $$;
