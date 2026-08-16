-- IVX Analytics Brain — Member-level behavioral intelligence, retention,
-- conversion pathways, JV deal & tokenized asset scam detection.
-- This is NOT aggregate traffic metrics. This is a per-member brain.

-- ── Member Behavioral Profiles ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS member_behavior_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  anonymous_id text,
  email text,
  -- Behavioral signals
  total_sessions integer DEFAULT 0,
  total_screen_views integer DEFAULT 0,
  total_actions integer DEFAULT 0,
  total_time_spent_seconds integer DEFAULT 0,
  -- Interest scoring (0-100 per category)
  interest_jv_deals integer DEFAULT 0,
  interest_tokenized_assets integer DEFAULT 0,
  interest_portfolio integer DEFAULT 0,
  interest_marketplace integer DEFAULT 0,
  interest_investing integer DEFAULT 0,
  interest_chat_ai integer DEFAULT 0,
  interest_crm integer DEFAULT 0,
  -- Intent scoring
  intent_score integer DEFAULT 0,           -- 0-100: how likely to invest
  intent_signals jsonb DEFAULT '[]'::jsonb, -- Array of {signal, weight, timestamp}
  -- Retention
  first_seen timestamptz DEFAULT now(),
  last_seen timestamptz DEFAULT now(),
  last_active_date date DEFAULT CURRENT_DATE,
  days_active integer DEFAULT 0,
  returning_visitor boolean DEFAULT false,
  sessions_last_7d integer DEFAULT 0,
  sessions_last_30d integer DEFAULT 0,
  -- Conversion funnel stage
  funnel_stage text DEFAULT 'visitor',
  -- visitor → registered → engaged → interested → ready_to_invest → invested → churned
  -- Behavior patterns
  top_screens jsonb DEFAULT '[]'::jsonb,       -- [{screen, views, pct}]
  top_actions jsonb DEFAULT '[]'::jsonb,        -- [{action, count, pct}]
  preferred_categories jsonb DEFAULT '[]'::jsonb, -- [{category, score}]
  -- AI brain analysis
  brain_analysis jsonb DEFAULT '{}'::jsonb,    -- Full AI analysis result
  brain_recommendations jsonb DEFAULT '[]'::jsonb, -- Actionable recommendations
  brain_risk_flags jsonb DEFAULT '[]'::jsonb,   -- Churn risk, scam interest, etc.
  brain_last_analyzed timestamptz,
  -- Metadata
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_mbp_user ON member_behavior_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_mbp_intent ON member_behavior_profiles(intent_score DESC);
CREATE INDEX IF NOT EXISTS idx_mbp_funnel ON member_behavior_profiles(funnel_stage);
CREATE INDEX IF NOT EXISTS idx_mbp_last_seen ON member_behavior_profiles(last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_mbp_anon ON member_behavior_profiles(anonymous_id);

-- ── Behavioral Events (per-member, not aggregate) ──────────────────────────
CREATE TABLE IF NOT EXISTS member_behavior_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  anonymous_id text,
  session_id text NOT NULL,
  event_type text NOT NULL,          -- screen_view, click, action, search, dwell, scroll
  event_category text NOT NULL,     -- navigation, engagement, transaction, search, investment
  screen_name text,
  action_name text,
  target_component text,             -- What UI element was clicked
  target_label text,                -- Label/text of the element
  properties jsonb DEFAULT '{}'::jsonb,
  dwell_time_seconds integer,       -- How long they stayed on this screen
  scroll_depth_pct integer,         -- How far they scrolled (0-100)
  interest_tags text[] DEFAULT '{}',-- Tags: jv_deals, tokenized, portfolio, etc.
  intent_delta integer DEFAULT 0,   -- How much this event moved their intent score
  timestamp timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mbe_user ON member_behavior_events(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_mbe_session ON member_behavior_events(session_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_mbe_type ON member_behavior_events(event_type, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_mbe_category ON member_behavior_events(event_category, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_mbe_tags ON member_behavior_events USING gin(interest_tags);
CREATE INDEX IF NOT EXISTS idx_mbe_anon ON member_behavior_events(anonymous_id, timestamp DESC);

-- ── Retention Cohorts ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS member_retention_cohorts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_date date NOT NULL,         -- When they first appeared
  cohort_size integer DEFAULT 0,
  period_type text NOT NULL,         -- daily, weekly, monthly
  -- Retention: array of {period, retained_count, retention_pct}
  retention_data jsonb DEFAULT '[]'::jsonb,
  -- Revenue data
  total_revenue numeric(12,2) DEFAULT 0,
  converted_count integer DEFAULT 0,
  conversion_rate numeric(5,2) DEFAULT 0,
  -- AI analysis
  brain_insights jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  UNIQUE(cohort_date, period_type)
);

CREATE INDEX IF NOT EXISTS idx_mrc_date ON member_retention_cohorts(cohort_date DESC);

-- ── JV Deal & Tokenized Asset Scam Detection ──────────────────────────────
CREATE TABLE IF NOT EXISTS asset_scam_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id text NOT NULL,            -- The deal/token ID
  asset_type text NOT NULL,          -- jv_deal, tokenized_asset, property, security
  asset_name text,
  asset_data jsonb DEFAULT '{}'::jsonb,
  -- Scam detection signals
  scam_score integer DEFAULT 0,      -- 0-100: higher = more likely scam
  confidence_level text DEFAULT 'low', -- low, medium, high
  -- Red flags detected
  red_flags jsonb DEFAULT '[]'::jsonb,    -- [{flag, severity, description}]
  green_flags jsonb DEFAULT '[]'::jsonb, -- [{flag, description}]
  -- Verification checks
  title_verified boolean DEFAULT false,
  ownership_verified boolean DEFAULT false,
  financials_verified boolean DEFAULT false,
  legal_disclosures_present boolean DEFAULT false,
  sec_registration_verified boolean DEFAULT false,
  third_party_audit boolean DEFAULT false,
  -- AI brain analysis
  brain_verdict text,               -- legitimate, suspicious, likely_scam, unverified
  brain_analysis jsonb DEFAULT '{}'::jsonb,
  brain_recommendations jsonb DEFAULT '[]'::jsonb,
  -- Metadata
  analyzed_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asa_asset ON asset_scam_analysis(asset_id);
CREATE INDEX IF NOT EXISTS idx_asa_scam ON asset_scam_analysis(scam_score DESC);
CREATE INDEX IF NOT EXISTS idx_asa_verdict ON asset_scam_analysis(brain_verdict);
CREATE INDEX IF NOT EXISTS idx_asa_type ON asset_scam_analysis(asset_type);

-- ── Conversion Pathways & Recommendations ──────────────────────────────────
CREATE TABLE IF NOT EXISTS conversion_pathways (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  anonymous_id text,
  -- Current state
  current_stage text NOT NULL,       -- visitor → registered → engaged → interested → ready → invested
  -- Pathway tracking
  stage_history jsonb DEFAULT '[]'::jsonb, -- [{stage, entered_at, exited_at, duration_seconds}]
  -- What actions moved them forward
  conversion_triggers jsonb DEFAULT '[]'::jsonb, -- [{trigger, from_stage, to_stage, timestamp}]
  -- What's blocking conversion
  friction_points jsonb DEFAULT '[]'::jsonb,    -- [{point, severity, suggestion}]
  -- AI recommendations
  next_best_action text,             -- Single highest-impact action
  brain_recommendations jsonb DEFAULT '[]'::jsonb,
  brain_reasoning text,             -- Why these recommendations
  -- Timing
  estimated_time_to_convert text,   -- hours, days, weeks, months
  conversion_probability numeric(5,2) DEFAULT 0,
  -- Metadata
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_cp_user ON conversion_pathways(user_id);
CREATE INDEX IF NOT EXISTS idx_cp_stage ON conversion_pathways(current_stage);
CREATE INDEX IF NOT EXISTS idx_cp_probability ON conversion_pathways(conversion_probability DESC);
CREATE INDEX IF NOT EXISTS idx_cp_anon ON conversion_pathways(anonymous_id);

-- ── Brain Analysis Runs (audit trail) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS brain_analysis_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_type text NOT NULL,       -- member_profile, scam_detection, retention_cohort, conversion
  target_id text NOT NULL,          -- user_id, asset_id, cohort_id
  input_data jsonb DEFAULT '{}'::jsonb,
  output_data jsonb DEFAULT '{}'::jsonb,
  recommendations jsonb DEFAULT '[]'::jsonb,
  risk_flags jsonb DEFAULT '[]'::jsonb,
  confidence numeric(3,2) DEFAULT 0,
  duration_ms integer,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bar_type ON brain_analysis_runs(analysis_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bar_target ON brain_analysis_runs(target_id);

-- Enable RLS
ALTER TABLE member_behavior_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_behavior_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_retention_cohorts ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_scam_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversion_pathways ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_analysis_runs ENABLE ROW LEVEL SECURITY;

-- RLS Policies: members see own data, admins see all
DO $$
BEGIN
  -- member_behavior_profiles
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='mbp_select_own' AND tablename='member_behavior_profiles') THEN
    CREATE POLICY mbp_select_own ON member_behavior_profiles FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='mbp_insert_own' AND tablename='member_behavior_profiles') THEN
    CREATE POLICY mbp_insert_own ON member_behavior_profiles FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='mbp_update_own' AND tablename='member_behavior_profiles') THEN
    CREATE POLICY mbp_update_own ON member_behavior_profiles FOR UPDATE USING (auth.uid() = user_id OR user_id IS NULL);
  END IF;

  -- member_behavior_events
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='mbe_select_own' AND tablename='member_behavior_events') THEN
    CREATE POLICY mbe_select_own ON member_behavior_events FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='mbe_insert_own' AND tablename='member_behavior_events') THEN
    CREATE POLICY mbe_insert_own ON member_behavior_events FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
  END IF;

  -- conversion_pathways
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='cp_select_own' AND tablename='conversion_pathways') THEN
    CREATE POLICY cp_select_own ON conversion_pathways FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='cp_insert_own' AND tablename='conversion_pathways') THEN
    CREATE POLICY cp_insert_own ON conversion_pathways FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='cp_update_own' AND tablename='conversion_pathways') THEN
    CREATE POLICY cp_update_own ON conversion_pathways FOR UPDATE USING (auth.uid() = user_id OR user_id IS NULL);
  END IF;
END $$;

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mbp_updated_at ON member_behavior_profiles;
CREATE TRIGGER trg_mbp_updated_at BEFORE UPDATE ON member_behavior_profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_cp_updated_at ON conversion_pathways;
CREATE TRIGGER trg_cp_updated_at BEFORE UPDATE ON conversion_pathways FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
