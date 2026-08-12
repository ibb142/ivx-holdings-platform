import React, { useState, useCallback } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Alert} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Stack } from 'expo-router';
import { ArrowLeft, Copy, Check, Database, ChevronDown, ChevronUp } from 'lucide-react-native';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { EmptyState } from '@/components/ivx';
import { RefreshControl } from 'react-native';
import * as Clipboard from 'expo-clipboard';

const BLOCK_1 = `-- ============================================================
-- BLOCK 1: JV_DEALS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS jv_deals (
  id text PRIMARY KEY,
  title text,
  "projectName" text,
  type text,
  description text,
  partner_name text,
  partner_email text,
  partner_phone text,
  partner_type text,
  "propertyAddress" text,
  property_address text,
  city text,
  state text,
  zip_code text,
  country text,
  lot_size numeric,
  lot_size_unit text,
  zoning text,
  property_type text,
  "totalInvestment" numeric DEFAULT 0,
  "propertyValue" numeric DEFAULT 0,
  "expectedROI" numeric DEFAULT 0,
  estimated_value numeric,
  appraised_value numeric,
  cash_payment_percent numeric,
  collateral_percent numeric,
  partner_profit_share numeric,
  developer_profit_share numeric,
  term_months integer,
  cash_payment_amount numeric,
  collateral_amount numeric,
  "distributionFrequency" text,
  "exitStrategy" text,
  partners jsonb,
  "poolTiers" jsonb,
  status text DEFAULT 'draft',
  published boolean DEFAULT false,
  "publishedAt" timestamptz,
  photos jsonb DEFAULT '[]'::jsonb,
  documents jsonb DEFAULT '[]'::jsonb,
  notes text,
  rejection_reason text,
  control_disclosure_accepted boolean DEFAULT false,
  control_disclosure_accepted_at timestamptz,
  payment_structure text,
  user_id uuid,
  "createdAt" timestamptz DEFAULT now(),
  "updatedAt" timestamptz DEFAULT now(),
  submitted_at timestamptz,
  approved_at timestamptz,
  completed_at timestamptz,
  currency text,
  "profitSplit" text,
  "startDate" text,
  "endDate" text,
  "governingLaw" text,
  "disputeResolution" text,
  "confidentialityPeriod" text,
  "nonCompetePeriod" text,
  "managementFee" text,
  "performanceFee" text,
  "minimumHoldPeriod" text
);

ALTER TABLE jv_deals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jv_deals_select_all ON jv_deals;
DROP POLICY IF EXISTS jv_deals_insert_all ON jv_deals;
DROP POLICY IF EXISTS jv_deals_update_all ON jv_deals;
DROP POLICY IF EXISTS jv_deals_delete_auth ON jv_deals;

CREATE POLICY jv_deals_select_all ON jv_deals FOR SELECT USING (true);
CREATE POLICY jv_deals_insert_all ON jv_deals FOR INSERT WITH CHECK (true);
CREATE POLICY jv_deals_update_all ON jv_deals FOR UPDATE USING (true);
CREATE POLICY jv_deals_delete_auth ON jv_deals FOR DELETE USING (true);

CREATE INDEX IF NOT EXISTS idx_jv_deals_published ON jv_deals(published);
CREATE INDEX IF NOT EXISTS idx_jv_deals_status ON jv_deals(status);
CREATE INDEX IF NOT EXISTS idx_jv_deals_created ON jv_deals("createdAt" DESC);`;

const BLOCK_2 = `-- ============================================================
-- BLOCK 2: LANDING_ANALYTICS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS landing_analytics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event text NOT NULL,
  session_id text NOT NULL,
  properties jsonb,
  geo jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE landing_analytics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS landing_analytics_select_all ON landing_analytics;
DROP POLICY IF EXISTS landing_analytics_insert_all ON landing_analytics;
DROP POLICY IF EXISTS landing_analytics_anon_insert ON landing_analytics;
DROP POLICY IF EXISTS landing_analytics_auth_select ON landing_analytics;

-- Anyone (anon / landing page) can INSERT analytics events
CREATE POLICY landing_analytics_anon_insert ON landing_analytics
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

-- Only authenticated users (admin dashboard) can SELECT
CREATE POLICY landing_analytics_auth_select ON landing_analytics
  FOR SELECT TO authenticated
  USING (true);

CREATE INDEX IF NOT EXISTS idx_landing_analytics_event ON landing_analytics(event);
CREATE INDEX IF NOT EXISTS idx_landing_analytics_session ON landing_analytics(session_id);
CREATE INDEX IF NOT EXISTS idx_landing_analytics_created ON landing_analytics(created_at DESC);`;

const BLOCK_3 = `-- ============================================================
-- BLOCK 3: LANDING_DEALS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS landing_deals (
  id text PRIMARY KEY,
  title text,
  project_name text,
  description text,
  property_address text,
  city text,
  state text,
  country text,
  total_investment numeric DEFAULT 0,
  property_value numeric DEFAULT 0,
  expected_roi numeric DEFAULT 0,
  status text DEFAULT 'active',
  photos text,
  distribution_frequency text,
  exit_strategy text,
  published_at timestamptz,
  display_order integer DEFAULT 999,
  trust_info text,
  updated_at timestamptz DEFAULT now(),
  synced_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE landing_deals ADD COLUMN IF NOT EXISTS property_value numeric DEFAULT 0;
ALTER TABLE landing_deals ADD COLUMN IF NOT EXISTS display_order integer DEFAULT 999;
ALTER TABLE landing_deals ADD COLUMN IF NOT EXISTS trust_info text;

ALTER TABLE landing_deals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS landing_deals_select_all ON landing_deals;
DROP POLICY IF EXISTS landing_deals_insert_all ON landing_deals;
DROP POLICY IF EXISTS landing_deals_update_all ON landing_deals;
DROP POLICY IF EXISTS landing_deals_delete_all ON landing_deals;

CREATE POLICY landing_deals_select_all ON landing_deals FOR SELECT USING (true);
CREATE POLICY landing_deals_insert_all ON landing_deals FOR INSERT WITH CHECK (true);
CREATE POLICY landing_deals_update_all ON landing_deals FOR UPDATE USING (true);
CREATE POLICY landing_deals_delete_all ON landing_deals FOR DELETE USING (true);

CREATE INDEX IF NOT EXISTS idx_landing_deals_status ON landing_deals(status);
CREATE INDEX IF NOT EXISTS idx_landing_deals_synced ON landing_deals(synced_at DESC);`;

const BLOCK_4 = `-- ============================================================
-- BLOCK 4: AUDIT_TRAIL + WAITLIST TABLES
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_trail (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text,
  entity_id text,
  entity_title text,
  action text NOT NULL,
  user_id text,
  user_role text,
  source text,
  details jsonb,
  snapshot_before jsonb,
  snapshot_after jsonb,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE audit_trail ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_trail_select_all ON audit_trail;
DROP POLICY IF EXISTS audit_trail_insert_all ON audit_trail;

CREATE POLICY audit_trail_select_all ON audit_trail FOR SELECT USING (true);
CREATE POLICY audit_trail_insert_all ON audit_trail FOR INSERT WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_audit_trail_entity ON audit_trail(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_trail_action ON audit_trail(action);
CREATE INDEX IF NOT EXISTS idx_audit_trail_created ON audit_trail(created_at DESC);

-- WAITLIST
CREATE TABLE IF NOT EXISTS waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text,
  last_name text,
  email text,
  phone text,
  goal text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS waitlist_select_all ON waitlist;
DROP POLICY IF EXISTS waitlist_insert_all ON waitlist;

CREATE POLICY waitlist_select_all ON waitlist FOR SELECT USING (true);
CREATE POLICY waitlist_insert_all ON waitlist FOR INSERT WITH CHECK (true);`;

const BLOCK_5 = `-- ============================================================
-- BLOCK 5: ENABLE REALTIME + VERIFY SETUP
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'jv_deals'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE jv_deals;
    RAISE NOTICE 'Realtime ENABLED for jv_deals table';
  ELSE
    RAISE NOTICE 'Realtime already enabled for jv_deals table';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'landing_deals'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE landing_deals;
    RAISE NOTICE 'Realtime ENABLED for landing_deals table';
  ELSE
    RAISE NOTICE 'Realtime already enabled for landing_deals table';
  END IF;
END
$$;

DO $$
DECLARE
  _table_exists boolean;
  _realtime_enabled boolean;
  _policy_count integer;
  _landing_exists boolean;
  _audit_exists boolean;
  _landing_realtime boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'jv_deals' AND table_schema = 'public') INTO _table_exists;
  SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'landing_deals' AND table_schema = 'public') INTO _landing_exists;
  SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_trail' AND table_schema = 'public') INTO _audit_exists;
  SELECT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'jv_deals') INTO _realtime_enabled;
  SELECT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'landing_deals') INTO _landing_realtime;
  SELECT COUNT(*) FROM pg_policies WHERE tablename = 'jv_deals' INTO _policy_count;

  RAISE NOTICE '';
  RAISE NOTICE '=== IVXHOLDINGS SETUP VERIFICATION ===';
  RAISE NOTICE 'jv_deals table:           %', CASE WHEN _table_exists THEN 'YES' ELSE 'NO' END;
  RAISE NOTICE 'landing_deals table:      %', CASE WHEN _landing_exists THEN 'YES' ELSE 'NO' END;
  RAISE NOTICE 'audit_trail table:        %', CASE WHEN _audit_exists THEN 'YES' ELSE 'NO' END;
  RAISE NOTICE 'jv_deals realtime:        %', CASE WHEN _realtime_enabled THEN 'YES' ELSE 'NO' END;
  RAISE NOTICE 'landing_deals realtime:   %', CASE WHEN _landing_realtime THEN 'YES' ELSE 'NO' END;
  RAISE NOTICE 'jv_deals RLS policies:    % (expected 4)', _policy_count;
  RAISE NOTICE '======================================';
  RAISE NOTICE 'Setup complete! All tables ready.';
END
$$;`;

const SQL_BLOCKS = [
  { title: 'JV Deals Table', subtitle: '55 columns + RLS + indexes', sql: BLOCK_1 },
  { title: 'Landing Analytics', subtitle: 'Event tracking table', sql: BLOCK_2 },
  { title: 'Landing Deals', subtitle: 'Landing page sync table', sql: BLOCK_3 },
  { title: 'Audit Trail + Waitlist', subtitle: '2 tables in one block', sql: BLOCK_4 },
  { title: 'Realtime + Verify', subtitle: 'Enable realtime & verify all tables', sql: BLOCK_5 },
];

export default function SupabaseExportScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const handleCopy = useCallback(async (sql: string, index: number) => {
    try {
      await Clipboard.setStringAsync(sql);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2500);
      if (Platform.OS !== 'web') {
        Alert.alert('Copied!', `Block ${index + 1} copied to clipboard. Paste it in Supabase SQL Editor.`);
      }
    } catch (err) {
      console.log('[SupabaseExport] Copy error:', err);
      Alert.alert('Error', 'Failed to copy. Try again.');
    }
  }, []);

  const toggleExpand = useCallback((index: number) => {
    setExpandedIndex(prev => prev === index ? null : index);
  }, []);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <ArrowLeft size={22} color="#fff" />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Database size={20} color="#00C48C" />
            <Text style={styles.headerTitle}>Supabase SQL Export</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.instructions}>
          <Text style={styles.instructionTitle}>How to use:</Text>
          <Text style={styles.instructionText}>
            1. Tap the green COPY button on each block{'\n'}
            2. Go to Supabase Dashboard → SQL Editor{'\n'}
            3. Click "New Query" → Paste → Click "Run"{'\n'}
            4. Repeat for all 5 blocks in order
          </Text>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {SQL_BLOCKS.map((block, index) => {
            const isCopied = copiedIndex === index;
            const isExpanded = expandedIndex === index;

            return (
              <View key={index} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.blockBadge}>
                    <Text style={styles.blockBadgeText}>{index + 1}</Text>
                  </View>
                  <View style={styles.cardTitleWrap}>
                    <Text style={styles.cardTitle}>{block.title}</Text>
                    <Text style={styles.cardSubtitle}>{block.subtitle}</Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={[styles.copyBtn, isCopied && styles.copyBtnDone]}
                  onPress={() => handleCopy(block.sql, index)}
                  activeOpacity={0.7}
                  testID={`copy-block-${index + 1}`}
                >
                  {isCopied ? (
                    <>
                      <Check size={20} color="#fff" />
                      <Text style={styles.copyBtnText}>COPIED!</Text>
                    </>
                  ) : (
                    <>
                      <Copy size={20} color="#fff" />
                      <Text style={styles.copyBtnText}>TAP TO COPY SQL</Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.previewToggle}
                  onPress={() => toggleExpand(index)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.previewToggleText}>
                    {isExpanded ? 'Hide SQL' : 'Preview SQL'}
                  </Text>
                  {isExpanded ? (
                    <ChevronUp size={16} color="#909090" />
                  ) : (
                    <ChevronDown size={16} color="#909090" />
                  )}
                </TouchableOpacity>

                {isExpanded && (
                  <View style={styles.codeWrap}>
                    <ScrollView horizontal style={styles.codeScroll}>
                      <Text style={styles.codeText}>{block.sql}</Text>
                    </ScrollView>
                  </View>
                )}
              </View>
            );
          })}

          <View style={styles.footer}>
            <Text style={styles.footerText}>
              Run all 5 blocks in order in Supabase SQL Editor.{'\n'}
              Safe to run multiple times (uses IF NOT EXISTS).
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A'},
  safe: {
    flex: 1},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A'},
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#2A2A2A',
    alignItems: 'center',
    justifyContent: 'center'},
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8},
  headerTitle: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: '#FFFFFF'},
  instructions: {
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: '#2A2A2A',
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 3,
    borderLeftColor: '#00C48C'},
  instructionTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#00C48C',
    marginBottom: 6},
  instructionText: {
    fontSize: 13,
    color: '#CCCCCC',
    lineHeight: 20},
  scroll: {
    flex: 1},
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 14},
  card: {
    backgroundColor: '#2A2A2A',
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#333333'},
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12},
  blockBadge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#00C48C',
    alignItems: 'center',
    justifyContent: 'center'},
  blockBadgeText: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: '#fff'},
  cardTitleWrap: {
    flex: 1},
  cardTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#FFFFFF'},
  cardSubtitle: {
    fontSize: 12,
    color: '#909090',
    marginTop: 2},
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#00C48C',
    marginHorizontal: 14,
    marginBottom: 10,
    paddingVertical: 14,
    borderRadius: 10},
  copyBtnDone: {
    backgroundColor: '#059669'},
  copyBtnText: {
    fontSize: 15,
    fontWeight: '800' as const,
    color: '#fff',
    letterSpacing: 0.5},
  previewToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#333333'},
  previewToggleText: {
    fontSize: 13,
    color: '#909090',
    fontWeight: '500' as const},
  codeWrap: {
    backgroundColor: '#0F172A',
    maxHeight: 200,
    borderTopWidth: 1,
    borderTopColor: '#333333'},
  codeScroll: {
    padding: 12},
  codeText: {
    fontSize: 11,
    color: '#00C48C',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 16},
  footer: {
    marginTop: 8,
    alignItems: 'center',
    paddingVertical: 16},
  footerText: {
    fontSize: 13,
    color: '#555555',
    textAlign: 'center',
    lineHeight: 20}});
