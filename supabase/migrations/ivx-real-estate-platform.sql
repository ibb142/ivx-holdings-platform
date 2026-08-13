-- IVX Real Estate Platform Schema
-- Complete database schema for end-to-end real estate transactions
-- Covers: properties, offers, negotiations, contracts, escrow, KYC, compliance, multi-currency, jurisdictions, brokers
-- Uses IF NOT EXISTS to avoid conflicts with existing tables

-- ============================================================================
-- PROPERTY TYPES CATALOG
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_property_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'residential',
  icon TEXT,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO ivx_re_property_types (code, name, category, sort_order) VALUES
  ('residential', 'Residential', 'residential', 1),
  ('commercial', 'Commercial', 'commercial', 2),
  ('industrial', 'Industrial', 'industrial', 3),
  ('land', 'Land', 'land', 4),
  ('mixed_use', 'Mixed Use', 'mixed_use', 5),
  ('multifamily', 'Multifamily', 'residential', 6),
  ('retail', 'Retail', 'commercial', 7),
  ('office', 'Office', 'commercial', 8),
  ('hospitality', 'Hospitality', 'commercial', 9),
  ('agricultural', 'Agricultural', 'land', 10)
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- COUNTRIES
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_countries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  iso_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  currency_code TEXT NOT NULL DEFAULT 'USD',
  phone_prefix TEXT,
  flag_emoji TEXT,
  is_active BOOLEAN DEFAULT true,
  supports_kyc BOOLEAN DEFAULT false,
  supports_escrow BOOLEAN DEFAULT false,
  legal_review_status TEXT DEFAULT 'pending',
  legal_review_date TIMESTAMPTZ,
  legal_review_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO ivx_re_countries (iso_code, name, currency_code, phone_prefix, flag_emoji, supports_kyc, supports_escrow) VALUES
  ('US', 'United States', 'USD', '+1', '🇺🇸', true, true),
  ('MX', 'Mexico', 'MXN', '+52', '🇲🇽', true, false),
  ('CO', 'Colombia', 'COP', '+57', '🇨🇴', true, false),
  ('CA', 'Canada', 'CAD', '+1', '🇨🇦', true, true),
  ('GB', 'United Kingdom', 'GBP', '+44', '🇬🇧', true, true),
  ('AE', 'United Arab Emirates', 'AED', '+971', '🇦🇪', true, false),
  ('ES', 'Spain', 'EUR', '+34', '🇪🇸', true, true),
  ('PT', 'Portugal', 'EUR', '+351', '🇵🇹', true, true),
  ('BR', 'Brazil', 'BRL', '+55', '🇧🇷', true, false),
  ('PA', 'Panama', 'USD', '+507', '🇵🇦', true, false),
  ('DO', 'Dominican Republic', 'DOP', '+1', '🇩🇴', true, false),
  ('CR', 'Costa Rica', 'CRC', '+506', '🇨🇷', true, false)
ON CONFLICT (iso_code) DO NOTHING;

-- ============================================================================
-- CURRENCIES
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_currencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  decimals INTEGER DEFAULT 2,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO ivx_re_currencies (code, name, symbol, decimals) VALUES
  ('USD', 'US Dollar', '$', 2),
  ('EUR', 'Euro', '€', 2),
  ('GBP', 'British Pound', '£', 2),
  ('MXN', 'Mexican Peso', '$', 2),
  ('COP', 'Colombian Peso', '$', 0),
  ('CAD', 'Canadian Dollar', 'C$', 2),
  ('AED', 'UAE Dirham', 'AED', 2),
  ('BRL', 'Brazilian Real', 'R$', 2),
  ('PAB', 'Panamanian Balboa', 'B/.', 2),
  ('CRC', 'Costa Rican Colón', '₡', 0),
  ('DOP', 'Dominican Peso', 'RD$', 2)
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- EXCHANGE RATES
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_exchange_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_currency TEXT NOT NULL,
  to_currency TEXT NOT NULL,
  rate NUMERIC(18,8) NOT NULL,
  source TEXT DEFAULT 'manual',
  fetched_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (from_currency, to_currency, fetched_at)
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_pair ON ivx_re_exchange_rates (from_currency, to_currency);

-- ============================================================================
-- JURISDICTIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_jurisdictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_iso TEXT NOT NULL REFERENCES ivx_re_countries(iso_code),
  region_name TEXT NOT NULL,
  region_code TEXT,
  legal_system TEXT,
  property_registration_authority TEXT,
  notary_required BOOLEAN DEFAULT false,
  attorney_required BOOLEAN DEFAULT false,
  escrow_required BOOLEAN DEFAULT false,
  title_insurance_available BOOLEAN DEFAULT false,
  foreign_ownership_allowed BOOLEAN DEFAULT true,
  foreign_ownership_restrictions TEXT,
  capital_gains_tax_rate NUMERIC(5,2),
  transfer_tax_rate NUMERIC(5,2),
  property_tax_rate NUMERIC(5,2),
  legal_review_status TEXT DEFAULT 'pending',
  legal_review_notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jurisdictions_country ON ivx_re_jurisdictions (country_iso);

-- ============================================================================
-- PROPERTY LISTINGS (extends existing properties table)
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_property_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
  listing_type TEXT NOT NULL DEFAULT 'sale',
  listing_status TEXT NOT NULL DEFAULT 'draft',
  asking_price NUMERIC(18,2) NOT NULL,
  currency_code TEXT NOT NULL DEFAULT 'USD' REFERENCES ivx_re_currencies(code),
  country_iso TEXT REFERENCES ivx_re_countries(iso_code),
  jurisdiction_id UUID REFERENCES ivx_re_jurisdictions(id),
  property_type_code TEXT REFERENCES ivx_re_property_types(code),
  title TEXT NOT NULL,
  description TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state_province TEXT,
  postal_code TEXT,
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  lot_size_sqm NUMERIC(12,2),
  building_size_sqm NUMERIC(12,2),
  bedrooms INTEGER,
  bathrooms NUMERIC(3,1),
  year_built INTEGER,
  parking_spaces INTEGER,
  zoning TEXT,
  apn TEXT,
  lot_number TEXT,
  features JSONB DEFAULT '{}',
  images JSONB DEFAULT '[]',
  virtual_tour_url TEXT,
  video_url TEXT,
  floor_plan_url TEXT,
  listing_date TIMESTAMPTZ DEFAULT now(),
  expiry_date TIMESTAMPTZ,
  days_on_market INTEGER GENERATED ALWAYS AS (CASE WHEN expiry_date IS NOT NULL THEN (expiry_date - listing_date)::INTEGER ELSE NULL END) STORED,
  seller_id UUID REFERENCES profiles(id),
  seller_name TEXT,
  seller_email TEXT,
  seller_phone TEXT,
  broker_id UUID,
  title_company_id UUID,
  lender_id UUID,
  valuation_id UUID,
  is_featured BOOLEAN DEFAULT false,
  is_verified BOOLEAN DEFAULT false,
  verification_date TIMESTAMPTZ,
  verification_notes TEXT,
  risk_disclaimer TEXT,
  view_count INTEGER DEFAULT 0,
  inquiry_count INTEGER DEFAULT 0,
  offer_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listings_status ON ivx_re_property_listings (listing_status);
CREATE INDEX IF NOT EXISTS idx_listings_type ON ivx_re_property_listings (listing_type);
CREATE INDEX IF NOT EXISTS idx_listings_city ON ivx_re_property_listings (city);
CREATE INDEX IF NOT EXISTS idx_listings_country ON ivx_re_property_listings (country_iso);
CREATE INDEX IF NOT EXISTS idx_listings_price ON ivx_re_property_listings (asking_price);
CREATE INDEX IF NOT EXISTS idx_listings_property ON ivx_re_property_listings (property_id);
CREATE INDEX IF NOT EXISTS idx_listings_seller ON ivx_re_property_listings (seller_id);
CREATE INDEX IF NOT EXISTS idx_listings_featured ON ivx_re_property_listings (is_featured) WHERE is_featured = true;
CREATE INDEX IF NOT EXISTS idx_listings_verified ON ivx_re_property_listings (is_verified) WHERE is_verified = true;

-- ============================================================================
-- PROPERTY IMAGES
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_property_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES ivx_re_property_listings(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  thumbnail_url TEXT,
  caption TEXT,
  sort_order INTEGER DEFAULT 0,
  is_primary BOOLEAN DEFAULT false,
  width INTEGER,
  height INTEGER,
  file_size_bytes BIGINT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_images_listing ON ivx_re_property_images (listing_id);

-- ============================================================================
-- PROPERTY DOCUMENTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_property_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES ivx_re_property_listings(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  title TEXT,
  url TEXT,
  file_size_bytes BIGINT,
  mime_type TEXT,
  uploaded_by UUID REFERENCES profiles(id),
  is_verified BOOLEAN DEFAULT false,
  verification_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_docs_listing ON ivx_re_property_documents (listing_id);
CREATE INDEX IF NOT EXISTS idx_docs_type ON ivx_re_property_documents (document_type);

-- ============================================================================
-- PROPERTY VALUATIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_property_valuations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES ivx_re_property_listings(id) ON DELETE CASCADE,
  valuation_type TEXT NOT NULL DEFAULT 'appraisal',
  valuation_amount NUMERIC(18,2) NOT NULL,
  currency_code TEXT DEFAULT 'USD',
  valuation_date DATE,
  appraiser_name TEXT,
  appraiser_license TEXT,
  appraisal_company TEXT,
  valuation_method TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_valuations_listing ON ivx_re_property_valuations (listing_id);

-- ============================================================================
-- PROPERTY AMENITIES
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_property_amenities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES ivx_re_property_listings(id) ON DELETE CASCADE,
  amenity TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  is_present BOOLEAN DEFAULT true,
  notes TEXT,
  UNIQUE (listing_id, amenity)
);

CREATE INDEX IF NOT EXISTS idx_amenities_listing ON ivx_re_property_amenities (listing_id);

-- ============================================================================
-- OFFERS
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES ivx_re_property_listings(id) ON DELETE CASCADE,
  buyer_id UUID REFERENCES profiles(id),
  buyer_name TEXT NOT NULL,
  buyer_email TEXT NOT NULL,
  buyer_phone TEXT,
  offer_amount NUMERIC(18,2) NOT NULL,
  currency_code TEXT DEFAULT 'USD',
  offer_type TEXT NOT NULL DEFAULT 'purchase',
  financing_type TEXT DEFAULT 'cash',
  financing_contingency BOOLEAN DEFAULT false,
  inspection_contingency BOOLEAN DEFAULT true,
  appraisal_contingency BOOLEAN DEFAULT true,
  earnest_money NUMERIC(18,2),
  earnest_money_due_date DATE,
  proposed_close_date DATE,
  leaseback_requested BOOLEAN DEFAULT false,
  leaseback_duration_days INTEGER,
  terms TEXT,
  conditions TEXT,
  offer_status TEXT NOT NULL DEFAULT 'pending',
  offer_expires_at TIMESTAMPTZ,
  proof_of_funds_url TEXT,
  pre_approval_url TEXT,
  is_verified BOOLEAN DEFAULT false,
  verification_notes TEXT,
  counter_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_offers_listing ON ivx_re_offers (listing_id);
CREATE INDEX IF NOT EXISTS idx_offers_buyer ON ivx_re_offers (buyer_id);
CREATE INDEX IF NOT EXISTS idx_offers_status ON ivx_re_offers (offer_status);

-- ============================================================================
-- OFFER MESSAGES (negotiation)
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_offer_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id UUID NOT NULL REFERENCES ivx_re_offers(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES profiles(id),
  sender_name TEXT,
  sender_role TEXT,
  message_type TEXT NOT NULL DEFAULT 'message',
  content TEXT NOT NULL,
  counter_amount NUMERIC(18,2),
  counter_terms TEXT,
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_offer ON ivx_re_offer_messages (offer_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON ivx_re_offer_messages (created_at DESC);

-- ============================================================================
-- CONTRACTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES ivx_re_property_listings(id) ON DELETE CASCADE,
  offer_id UUID NOT NULL REFERENCES ivx_re_offers(id) ON DELETE CASCADE,
  buyer_id UUID REFERENCES profiles(id),
  seller_id UUID REFERENCES profiles(id),
  contract_type TEXT NOT NULL DEFAULT 'purchase_agreement',
  contract_status TEXT NOT NULL DEFAULT 'draft',
  sale_price NUMERIC(18,2) NOT NULL,
  currency_code TEXT DEFAULT 'USD',
  earnest_money NUMERIC(18,2),
  earnest_money_held_by TEXT DEFAULT 'escrow_agent',
  financing_contingency_date DATE,
  inspection_contingency_date DATE,
  appraisal_contingency_date DATE,
  closing_date DATE,
  possession_date DATE,
  property_address TEXT,
  legal_description TEXT,
  special_provisions TEXT,
  disclosures TEXT,
  contract_document_url TEXT,
  contract_generated_at TIMESTAMPTZ,
  sent_to_buyer_at TIMESTAMPTZ,
  sent_to_seller_at TIMESTAMPTZ,
  buyer_signed_at TIMESTAMPTZ,
  seller_signed_at TIMESTAMPTZ,
  fully_executed_at TIMESTAMPTZ,
  notary_id UUID,
  title_company_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contracts_listing ON ivx_re_contracts (listing_id);
CREATE INDEX IF NOT EXISTS idx_contracts_offer ON ivx_re_contracts (offer_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON ivx_re_contracts (contract_status);

-- ============================================================================
-- CONTRACT SIGNATURES
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_contract_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES ivx_re_contracts(id) ON DELETE CASCADE,
  signer_id UUID REFERENCES profiles(id),
  signer_name TEXT NOT NULL,
  signer_email TEXT,
  signer_role TEXT NOT NULL,
  signature_data TEXT,
  signature_method TEXT DEFAULT 'typed',
  ip_address INET,
  user_agent TEXT,
  signed_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signatures_contract ON ivx_re_contract_signatures (contract_id);

-- ============================================================================
-- ESCROW ACCOUNTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_escrow_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES ivx_re_contracts(id) ON DELETE CASCADE,
  listing_id UUID REFERENCES ivx_re_property_listings(id),
  buyer_id UUID REFERENCES profiles(id),
  seller_id UUID REFERENCES profiles(id),
  escrow_status TEXT NOT NULL DEFAULT 'pending_creation',
  escrow_agent_name TEXT,
  escrow_agent_email TEXT,
  escrow_agent_phone TEXT,
  escrow_company TEXT,
  escrow_account_number TEXT,
  total_amount NUMERIC(18,2) NOT NULL,
  currency_code TEXT DEFAULT 'USD',
  earnest_money_amount NUMERIC(18,2),
  earnest_money_received BOOLEAN DEFAULT false,
  earnest_money_received_at TIMESTAMPTZ,
  down_payment_amount NUMERIC(18,2),
  down_payment_received BOOLEAN DEFAULT false,
  down_payment_received_at TIMESTAMPTZ,
  balance_amount NUMERIC(18,2) DEFAULT 0,
  funds_disbursed BOOLEAN DEFAULT false,
  funds_disbursed_at TIMESTAMPTZ,
  disbursement_instructions TEXT,
  conditions TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_escrow_contract ON ivx_re_escrow_accounts (contract_id);
CREATE INDEX IF NOT EXISTS idx_escrow_status ON ivx_re_escrow_accounts (escrow_status);

-- ============================================================================
-- ESCROW TRANSACTIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_escrow_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_id UUID NOT NULL REFERENCES ivx_re_escrow_accounts(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  currency_code TEXT DEFAULT 'USD',
  direction TEXT NOT NULL,
  payment_method TEXT,
  reference_number TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  initiated_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_escrow_tx_escrow ON ivx_re_escrow_transactions (escrow_id);
CREATE INDEX IF NOT EXISTS idx_escrow_tx_status ON ivx_re_escrow_transactions (status);

-- ============================================================================
-- BROKERS
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_brokers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES profiles(id),
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  license_number TEXT,
  license_state TEXT,
  license_expiry DATE,
  brokerage_name TEXT,
  brokerage_address TEXT,
  brokerage_phone TEXT,
  bio TEXT,
  photo_url TEXT,
  languages TEXT[],
  specialties TEXT[],
  service_areas JSONB DEFAULT '[]',
  rating NUMERIC(3,2) DEFAULT 0,
  total_transactions INTEGER DEFAULT 0,
  total_volume NUMERIC(18,2) DEFAULT 0,
  is_verified BOOLEAN DEFAULT false,
  verification_date TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brokers_verified ON ivx_re_brokers (is_verified) WHERE is_verified = true;
CREATE INDEX IF NOT EXISTS idx_brokers_active ON ivx_re_brokers (is_active) WHERE is_active = true;

-- ============================================================================
-- BROKER ASSIGNMENTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_broker_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES ivx_re_property_listings(id) ON DELETE CASCADE,
  broker_id UUID NOT NULL REFERENCES ivx_re_brokers(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'listing_agent',
  commission_percent NUMERIC(5,2),
  commission_amount NUMERIC(18,2),
  is_primary BOOLEAN DEFAULT false,
  assigned_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (listing_id, broker_id, role)
);

CREATE INDEX IF NOT EXISTS idx_assignments_listing ON ivx_re_broker_assignments (listing_id);
CREATE INDEX IF NOT EXISTS idx_assignments_broker ON ivx_re_broker_assignments (broker_id);

-- ============================================================================
-- CLOSING DOCUMENTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_closing_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES ivx_re_contracts(id) ON DELETE CASCADE,
  escrow_id UUID REFERENCES ivx_re_escrow_accounts(id),
  document_type TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  mime_type TEXT,
  file_size_bytes BIGINT,
  status TEXT NOT NULL DEFAULT 'pending',
  prepared_by TEXT,
  prepared_at TIMESTAMPTZ,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  delivered_to_buyer BOOLEAN DEFAULT false,
  delivered_to_buyer_at TIMESTAMPTZ,
  delivered_to_seller BOOLEAN DEFAULT false,
  delivered_to_seller_at TIMESTAMPTZ,
  buyer_acknowledged BOOLEAN DEFAULT false,
  seller_acknowledged BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_closing_docs_contract ON ivx_re_closing_documents (contract_id);
CREATE INDEX IF NOT EXISTS idx_closing_docs_type ON ivx_re_closing_documents (document_type);

-- ============================================================================
-- KYC RECORDS
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_kyc_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kyc_type TEXT NOT NULL DEFAULT 'individual',
  status TEXT NOT NULL DEFAULT 'pending',
  first_name TEXT,
  last_name TEXT,
  date_of_birth DATE,
  nationality TEXT,
  id_type TEXT,
  id_number TEXT,
  id_country TEXT,
  id_expiry DATE,
  id_front_url TEXT,
  id_back_url TEXT,
  selfie_url TEXT,
  proof_of_address_url TEXT,
  address_line1 TEXT,
  address_city TEXT,
  address_state TEXT,
  address_postal_code TEXT,
  address_country TEXT,
  phone_number TEXT,
  email TEXT,
  occupation TEXT,
  source_of_funds TEXT,
  risk_score INTEGER DEFAULT 0,
  risk_level TEXT DEFAULT 'low',
  provider_name TEXT,
  provider_reference TEXT,
  verified_by TEXT,
  verified_at TIMESTAMPTZ,
  verification_notes TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kyc_user ON ivx_re_kyc_records (user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_status ON ivx_re_kyc_records (status);

-- ============================================================================
-- KYB RECORDS (Know Your Business)
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_kyb_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  company_name TEXT,
  company_type TEXT,
  registration_number TEXT,
  registration_country TEXT,
  registration_date DATE,
  registered_address TEXT,
  industry TEXT,
  website TEXT,
  tax_id TEXT,
  articles_of_incorporation_url TEXT,
  operating_agreement_url TEXT,
  business_license_url TEXT,
  beneficial_owners JSONB DEFAULT '[]',
  authorized_signatories JSONB DEFAULT '[]',
  risk_score INTEGER DEFAULT 0,
  risk_level TEXT DEFAULT 'low',
  provider_name TEXT,
  provider_reference TEXT,
  verified_by TEXT,
  verified_at TIMESTAMPTZ,
  verification_notes TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kyb_user ON ivx_re_kyb_records (user_id);
CREATE INDEX IF NOT EXISTS idx_kyb_status ON ivx_re_kyb_records (status);

-- ============================================================================
-- SANCTIONS CHECKS
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_sanctions_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id),
  kyc_id UUID REFERENCES ivx_re_kyc_records(id),
  kyb_id UUID REFERENCES ivx_re_kyb_records(id),
  entity_name TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT 'individual',
  date_of_birth DATE,
  nationality TEXT,
  id_number TEXT,
  check_status TEXT NOT NULL DEFAULT 'pending',
  is_clear BOOLEAN,
  match_count INTEGER DEFAULT 0,
  matches JSONB DEFAULT '[]',
  screened_lists TEXT[] DEFAULT ARRAY['OFAC_SDN','OFAC_Consolidated','EU_Sanctions','UN_Sanctions','UK_Sanctions'],
  provider_name TEXT,
  provider_reference TEXT,
  risk_level TEXT DEFAULT 'low',
  checked_at TIMESTAMPTZ,
  next_check_due TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sanctions_user ON ivx_re_sanctions_checks (user_id);
CREATE INDEX IF NOT EXISTS idx_sanctions_status ON ivx_re_sanctions_checks (check_status);

-- ============================================================================
-- PROOF OF FUNDS
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_proof_of_funds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  listing_id UUID REFERENCES ivx_re_property_listings(id),
  offer_id UUID REFERENCES ivx_re_offers(id),
  amount NUMERIC(18,2) NOT NULL,
  currency_code TEXT DEFAULT 'USD',
  fund_source TEXT,
  bank_name TEXT,
  account_last4 TEXT,
  statement_url TEXT,
  verification_letter_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  verified_by TEXT,
  verified_at TIMESTAMPTZ,
  verification_notes TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pof_user ON ivx_re_proof_of_funds (user_id);
CREATE INDEX IF NOT EXISTS idx_pof_status ON ivx_re_proof_of_funds (status);

-- ============================================================================
-- AUDIT TRAIL
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_audit_trail (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  entity_name TEXT,
  details JSONB DEFAULT '{}',
  ip_address INET,
  user_agent TEXT,
  before_state JSONB,
  after_state JSONB,
  severity TEXT DEFAULT 'info',
  category TEXT DEFAULT 'general',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON ivx_re_audit_trail (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON ivx_re_audit_trail (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON ivx_re_audit_trail (action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON ivx_re_audit_trail (created_at DESC);

-- ============================================================================
-- TRANSACTIONS (extends existing transactions table with RE-specific fields)
-- ============================================================================
CREATE TABLE IF NOT EXISTS ivx_re_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID REFERENCES ivx_re_property_listings(id),
  contract_id UUID REFERENCES ivx_re_contracts(id),
  escrow_id UUID REFERENCES ivx_re_escrow_accounts(id),
  buyer_id UUID REFERENCES profiles(id),
  seller_id UUID REFERENCES profiles(id),
  transaction_type TEXT NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  currency_code TEXT DEFAULT 'USD',
  payment_method TEXT,
  payment_reference TEXT,
  fee_amount NUMERIC(18,2) DEFAULT 0,
  fee_type TEXT,
  net_amount NUMERIC(18,2),
  status TEXT NOT NULL DEFAULT 'pending',
  reconciliation_status TEXT DEFAULT 'unreconciled',
  reconciled_at TIMESTAMPTZ,
  reconciliation_reference TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_re_tx_listing ON ivx_re_transactions (listing_id);
CREATE INDEX IF NOT EXISTS idx_re_tx_contract ON ivx_re_transactions (contract_id);
CREATE INDEX IF NOT EXISTS idx_re_tx_escrow ON ivx_re_transactions (escrow_id);
CREATE INDEX IF NOT EXISTS idx_re_tx_status ON ivx_re_transactions (status);

-- ============================================================================
-- TRIGGERS for updated_at
-- ============================================================================
CREATE OR REPLACE FUNCTION ivx_re_update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER IF NOT EXISTS trg_listings_updated BEFORE UPDATE ON ivx_re_property_listings
  FOR EACH ROW EXECUTE FUNCTION ivx_re_update_updated_at();

CREATE TRIGGER IF NOT EXISTS trg_offers_updated BEFORE UPDATE ON ivx_re_offers
  FOR EACH ROW EXECUTE FUNCTION ivx_re_update_updated_at();

CREATE TRIGGER IF NOT EXISTS trg_contracts_updated BEFORE UPDATE ON ivx_re_contracts
  FOR EACH ROW EXECUTE FUNCTION ivx_re_update_updated_at();

CREATE TRIGGER IF NOT EXISTS trg_escrow_updated BEFORE UPDATE ON ivx_re_escrow_accounts
  FOR EACH ROW EXECUTE FUNCTION ivx_re_update_updated_at();

CREATE TRIGGER IF NOT EXISTS trg_kyc_updated BEFORE UPDATE ON ivx_re_kyc_records
  FOR EACH ROW EXECUTE FUNCTION ivx_re_update_updated_at();

CREATE TRIGGER IF NOT EXISTS trg_kyb_updated BEFORE UPDATE ON ivx_re_kyb_records
  FOR EACH ROW EXECUTE FUNCTION ivx_re_update_updated_at();

CREATE TRIGGER IF NOT EXISTS trg_brokers_updated BEFORE UPDATE ON ivx_re_brokers
  FOR EACH ROW EXECUTE FUNCTION ivx_re_update_updated_at();

CREATE TRIGGER IF NOT EXISTS trg_countries_updated BEFORE UPDATE ON ivx_re_countries
  FOR EACH ROW EXECUTE FUNCTION ivx_re_update_updated_at();

CREATE TRIGGER IF NOT EXISTS trg_jurisdictions_updated BEFORE UPDATE ON ivx_re_jurisdictions
  FOR EACH ROW EXECUTE FUNCTION ivx_re_update_updated_at();

CREATE TRIGGER IF NOT EXISTS trx_re_tx_updated BEFORE UPDATE ON ivx_re_transactions
  FOR EACH ROW EXECUTE FUNCTION ivx_re_update_updated_at();

CREATE TRIGGER IF NOT EXISTS trg_closing_docs_updated BEFORE UPDATE ON ivx_re_closing_documents
  FOR EACH ROW EXECUTE FUNCTION ivx_re_update_updated_at();

CREATE TRIGGER IF NOT EXISTS trg_pof_updated BEFORE UPDATE ON ivx_re_proof_of_funds
  FOR EACH ROW EXECUTE FUNCTION ivx_re_update_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE ivx_re_property_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ivx_re_property_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE ivx_re_property_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE ivx_re_property_valuations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ivx_re_property_amenities ENABLE ROW LEVEL SECURITY;
ALTER TABLE ivx_re_property_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE ivx_re_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ivx_re_offer_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ivx_re_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ivx_re_contract_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE ivx_re_escrow_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ivx_re_escrow_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ivx_re_kyc_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE ivx_re_kyb_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE ivx_re_sanctions_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ivx_re_proof_of_funds ENABLE ROW LEVEL SECURITY;
ALTER TABLE ivx_re_brokers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ivx_re_broker_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ivx_re_closing_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE ivx_re_audit_trail ENABLE ROW LEVEL SECURITY;
ALTER TABLE ivx_re_transactions ENABLE ROW LEVEL SECURITY;

-- Public read for active verified listings
CREATE POLICY "public_read_active_listings" ON ivx_re_property_listings
  FOR SELECT USING (listing_status IN ('active', 'under_contract', 'sold') AND is_verified = true);

-- Public read for images of active listings
CREATE POLICY "public_read_listing_images" ON ivx_re_property_images
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM ivx_re_property_listings pl
      WHERE pl.id = listing_id AND pl.listing_status IN ('active', 'under_contract', 'sold')
    )
  );

-- Public read for property types, currencies, countries
CREATE POLICY "public_read_property_types" ON ivx_re_property_types FOR SELECT USING (is_active = true);
CREATE POLICY "public_read_currencies" ON ivx_re_currencies FOR SELECT USING (is_active = true);
CREATE POLICY "public_read_countries" ON ivx_re_countries FOR SELECT USING (is_active = true);
CREATE POLICY "public_read_brokers" ON ivx_re_brokers FOR SELECT USING (is_active = true);
CREATE POLICY "public_read_exchange_rates" ON ivx_re_exchange_rates FOR SELECT USING (true);
CREATE POLICY "public_read_jurisdictions" ON ivx_re_jurisdictions FOR SELECT USING (is_active = true);

-- Authenticated users can manage their own offers
CREATE POLICY "user_manage_own_offers" ON ivx_re_offers
  FOR ALL USING (buyer_id = auth.uid() OR seller_id = auth.uid());

-- Authenticated users can read their own offer messages
CREATE POLICY "user_read_own_messages" ON ivx_re_offer_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM ivx_re_offers o
      WHERE o.id = offer_id AND (o.buyer_id = auth.uid())
    ) OR sender_id = auth.uid()
  );

-- Authenticated users can manage their own KYC
CREATE POLICY "user_manage_own_kyc" ON ivx_re_kyc_records
  FOR ALL USING (user_id = auth.uid());

-- Authenticated users can manage their own KYB
CREATE POLICY "user_manage_own_kyb" ON ivx_re_kyb_records
  FOR ALL USING (user_id = auth.uid());

-- Authenticated users can manage their own proof of funds
CREATE POLICY "user_manage_own_pof" ON ivx_re_proof_of_funds
  FOR ALL USING (user_id = auth.uid());

-- Owners/admins can manage contracts
CREATE POLICY "owner_manage_contracts" ON ivx_re_contracts
  FOR ALL USING (
    buyer_id = auth.uid() OR seller_id = auth.uid() OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner', 'admin'))
  );

-- Owners/admins can manage escrow
CREATE POLICY "owner_manage_escrow" ON ivx_re_escrow_accounts
  FOR ALL USING (
    buyer_id = auth.uid() OR seller_id = auth.uid() OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner', 'admin'))
  );

-- Owners/admins can manage closing documents
CREATE POLICY "owner_manage_closing_docs" ON ivx_re_closing_documents
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner', 'admin'))
  );

-- Owners/admins can read audit trail
CREATE POLICY "owner_read_audit" ON ivx_re_audit_trail
  FOR SELECT USING (
    user_id = auth.uid() OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner', 'admin'))
  );

-- Owners/admins can manage all listings
CREATE POLICY "owner_manage_listings" ON ivx_re_property_listings
  FOR ALL USING (
    seller_id = auth.uid() OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner', 'admin'))
  );

-- Owners/admins can manage transactions
CREATE POLICY "owner_manage_transactions" ON ivx_re_transactions
  FOR ALL USING (
    buyer_id = auth.uid() OR seller_id = auth.uid() OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner', 'admin'))
  );

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON TABLE ivx_re_property_listings IS 'Extended property listing data for real estate transactions';
COMMENT ON TABLE ivx_re_offers IS 'Buyer offers on property listings with negotiation support';
COMMENT ON TABLE ivx_re_contracts IS 'Real estate purchase contracts with digital signatures';
COMMENT ON TABLE ivx_re_escrow_accounts IS 'Escrow/custody accounts for real estate transactions';
COMMENT ON TABLE ivx_re_kyc_records IS 'KYC verification records for individual investors';
COMMENT ON TABLE ivx_re_kyb_records IS 'KYB verification records for business entities';
COMMENT ON TABLE ivx_re_sanctions_checks IS 'OFAC/EU/UN sanctions screening results';
COMMENT ON TABLE ivx_re_audit_trail IS 'Comprehensive audit trail for compliance and security';
