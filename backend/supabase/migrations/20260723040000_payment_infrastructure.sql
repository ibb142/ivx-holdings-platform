-- IVX Payment Infrastructure Schema Migration
-- Creates: payment_customers, payment_intents, payment_events, investment_requests,
--          ownership_allocations, receipts, jv_applications, buyer_offers, bank_connections
-- All tables have RLS enabled with user + owner policies.

-- ── payment_customers ──
CREATE TABLE IF NOT EXISTS payment_customers (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'stripe',
  provider_customer_id text NOT NULL,
  test_mode boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, provider)
);

ALTER TABLE payment_customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payment_customers_self" ON payment_customers;
CREATE POLICY "payment_customers_self" ON payment_customers FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "payment_customers_owner_all" ON payment_customers;
CREATE POLICY "payment_customers_owner_all" ON payment_customers FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner','admin')));

-- ── payment_intents ──
CREATE TABLE IF NOT EXISTS payment_intents (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  deal_id text NOT NULL,
  pathway text NOT NULL CHECK (pathway IN ('tokenized','jv','buyer_deposit','buyer_application_fee')),
  payment_method text NOT NULL DEFAULT 'card' CHECK (payment_method IN ('card','ach_debit')),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'usd',
  state text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT','PAYMENT_CREATED','REQUIRES_ACTION','PROCESSING','PENDING_SETTLEMENT','SUCCEEDED','FAILED','CANCELLED','REFUND_PENDING','REFUNDED','PARTIALLY_REFUNDED','DISPUTED','ALLOCATED','COMPLETED')),
  provider text NOT NULL DEFAULT 'stripe',
  provider_payment_intent_id text,
  provider_customer_id text,
  client_secret text,
  share_count integer,
  accepted_terms boolean NOT NULL DEFAULT false,
  test_mode boolean NOT NULL DEFAULT true,
  idempotency_key text NOT NULL,
  metadata jsonb DEFAULT '{}',
  error_message text,
  trace_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  completed_at timestamptz,
  UNIQUE(idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_payment_intents_user_id ON payment_intents(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_deal_id ON payment_intents(deal_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_state ON payment_intents(state);
CREATE INDEX IF NOT EXISTS idx_payment_intents_pathway ON payment_intents(pathway);
CREATE INDEX IF NOT EXISTS idx_payment_intents_provider_pi_id ON payment_intents(provider_payment_intent_id);

ALTER TABLE payment_intents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payment_intents_self" ON payment_intents;
CREATE POLICY "payment_intents_self" ON payment_intents FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "payment_intents_owner_all" ON payment_intents;
CREATE POLICY "payment_intents_owner_all" ON payment_intents FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner','admin')));

-- ── payment_events (webhook audit log) ──
CREATE TABLE IF NOT EXISTS payment_events (
  id text PRIMARY KEY,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  provider text NOT NULL DEFAULT 'stripe',
  processed boolean NOT NULL DEFAULT false,
  processed_at timestamptz,
  raw_event jsonb DEFAULT '{}',
  trace_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_events_processed ON payment_events(processed);

ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payment_events_owner_all" ON payment_events;
CREATE POLICY "payment_events_owner_all" ON payment_events FOR SELECT USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner','admin')));

-- ── investment_requests ──
CREATE TABLE IF NOT EXISTS investment_requests (
  id text PRIMARY KEY,
  payment_id text REFERENCES payment_intents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  deal_id text NOT NULL,
  pathway text NOT NULL,
  amount_cents bigint NOT NULL,
  share_count integer,
  state text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','PAYMENT_PROCESSING','CONFIRMED','FAILED','CANCELLED','REFUNDED')),
  confirmed_at timestamptz,
  trace_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_investment_requests_user_id ON investment_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_investment_requests_deal_id ON investment_requests(deal_id);
CREATE INDEX IF NOT EXISTS idx_investment_requests_payment_id ON investment_requests(payment_id);

ALTER TABLE investment_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "investment_requests_self" ON investment_requests;
CREATE POLICY "investment_requests_self" ON investment_requests FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "investment_requests_owner_all" ON investment_requests;
CREATE POLICY "investment_requests_owner_all" ON investment_requests FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner','admin')));

-- ── ownership_allocations ──
CREATE TABLE IF NOT EXISTS ownership_allocations (
  id text PRIMARY KEY,
  investment_id text REFERENCES investment_requests(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  deal_id text NOT NULL,
  pathway text NOT NULL,
  shares_allocated integer,
  ownership_percent numeric(10,6) DEFAULT 0,
  amount_cents bigint NOT NULL,
  state text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','REVOKED','TRANSFERRED')),
  revoked_at timestamptz,
  trace_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ownership_allocations_user_id ON ownership_allocations(user_id);
CREATE INDEX IF NOT EXISTS idx_ownership_allocations_deal_id ON ownership_allocations(deal_id);

ALTER TABLE ownership_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ownership_allocations_self" ON ownership_allocations;
CREATE POLICY "ownership_allocations_self" ON ownership_allocations FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "ownership_allocations_owner_all" ON ownership_allocations;
CREATE POLICY "ownership_allocations_owner_all" ON ownership_allocations FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner','admin')));

-- ── receipts ──
CREATE TABLE IF NOT EXISTS receipts (
  id text PRIMARY KEY,
  payment_id text REFERENCES payment_intents(id) ON DELETE CASCADE,
  investment_id text REFERENCES investment_requests(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  deal_id text NOT NULL,
  pathway text NOT NULL,
  amount_cents bigint NOT NULL,
  share_count integer,
  provider text NOT NULL DEFAULT 'stripe',
  provider_payment_intent_id text,
  trace_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_receipts_user_id ON receipts(user_id);
CREATE INDEX IF NOT EXISTS idx_receipts_deal_id ON receipts(deal_id);

ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "receipts_self" ON receipts;
CREATE POLICY "receipts_self" ON receipts FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "receipts_owner_all" ON receipts;
CREATE POLICY "receipts_owner_all" ON receipts FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner','admin')));

-- ── bank_connections ──
CREATE TABLE IF NOT EXISTS bank_connections (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'stripe',
  provider_account_id text,
  institution_name text,
  account_type text,
  last4 text,
  verification_status text DEFAULT 'PENDING_VERIFICATION' CHECK (verification_status IN ('PENDING_VERIFICATION','VERIFIED','FAILED')),
  connection_status text NOT NULL DEFAULT 'CONNECTED' CHECK (connection_status IN ('CONNECTED','DISCONNECTED','EXPIRED')),
  mandate_accepted boolean NOT NULL DEFAULT false,
  mandate_reference text,
  mandate_accepted_at timestamptz,
  connected_at timestamptz NOT NULL DEFAULT now(),
  disconnected_at timestamptz,
  metadata jsonb DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_bank_connections_user_id ON bank_connections(user_id);

ALTER TABLE bank_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bank_connections_self" ON bank_connections;
CREATE POLICY "bank_connections_self" ON bank_connections FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "bank_connections_owner_all" ON bank_connections;
CREATE POLICY "bank_connections_owner_all" ON bank_connections FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner','admin')));

-- ── jv_applications ──
CREATE TABLE IF NOT EXISTS jv_applications (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  deal_id text NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  contribution_type text DEFAULT 'capital',
  company text,
  experience text,
  proposed_terms text,
  requested_ownership numeric(10,6) DEFAULT 0,
  project_role text,
  proof_of_funds_url text,
  accepted_terms boolean NOT NULL DEFAULT false,
  state text NOT NULL DEFAULT 'APPLICATION' CHECK (state IN ('APPLICATION','QUALIFICATION','DOCUMENT_REVIEW','OWNER_REVIEW','DUE_DILIGENCE','COUNTER_TERMS','AGREEMENT','PAYMENT_ENABLED','PAYMENT','CONFIRMED','REJECTED')),
  review_notes text,
  counter_terms jsonb,
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  trace_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_jv_applications_user_id ON jv_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_jv_applications_deal_id ON jv_applications(deal_id);
CREATE INDEX IF NOT EXISTS idx_jv_applications_state ON jv_applications(state);

ALTER TABLE jv_applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "jv_applications_self" ON jv_applications;
CREATE POLICY "jv_applications_self" ON jv_applications FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "jv_applications_owner_all" ON jv_applications;
CREATE POLICY "jv_applications_owner_all" ON jv_applications FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner','admin')));

-- ── buyer_offers ──
CREATE TABLE IF NOT EXISTS buyer_offers (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  deal_id text NOT NULL,
  offer_amount_cents bigint NOT NULL CHECK (offer_amount_cents > 0),
  offer_type text NOT NULL DEFAULT 'FULL_PRICE_OFFER' CHECK (offer_type IN ('BELOW_ASKING_OFFER','FULL_PRICE_OFFER','ABOVE_ASKING_OFFER','REJECTED')),
  asking_price_cents bigint,
  financing_type text DEFAULT 'cash' CHECK (financing_type IN ('cash','financing')),
  down_payment_cents bigint DEFAULT 0,
  proof_of_funds_url text,
  preapproval_url text,
  earnest_money_cents bigint DEFAULT 0,
  inspection_period_days integer DEFAULT 15,
  closing_date date,
  contingencies text,
  broker_name text,
  offer_expiration_days integer DEFAULT 7,
  message text,
  accepted_terms boolean NOT NULL DEFAULT false,
  state text NOT NULL DEFAULT 'OFFER' CHECK (state IN ('OFFER','OWNER_REVIEW','COUNTERED','ACCEPTED','REJECTED','UNDER_CONTRACT')),
  review_notes text,
  counter_amount_cents bigint,
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  trace_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_buyer_offers_user_id ON buyer_offers(user_id);
CREATE INDEX IF NOT EXISTS idx_buyer_offers_deal_id ON buyer_offers(deal_id);
CREATE INDEX IF NOT EXISTS idx_buyer_offers_state ON buyer_offers(state);

ALTER TABLE buyer_offers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "buyer_offers_self" ON buyer_offers;
CREATE POLICY "buyer_offers_self" ON buyer_offers FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "buyer_offers_owner_all" ON buyer_offers;
CREATE POLICY "buyer_offers_owner_all" ON buyer_offers FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner','admin')));
