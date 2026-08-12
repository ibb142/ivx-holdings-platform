import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Animated,
  Dimensions} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Target,
  Users,
  TrendingUp,
  DollarSign,
  Eye,
  Zap,
  Radio,
  Search,
  Share2,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Clock,
  ArrowUpRight,
  Layers,
  Mail,
  Bell,
  Activity} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { useQuery } from '@tanstack/react-query';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';

type TabType = 'campaigns' | 'audiences' | 'pixels' | 'seo' | 'triggers' | 'utm';

const { width: SCREEN_W } = Dimensions.get('window');

const PLATFORM_COLORS: Record<string, string> = {
  meta: '#1877F2',
  google: '#4285F4',
  tiktok: '#00F2EA',
  linkedin: '#0A66C2',
  twitter: '#1DA1F2',
  email: '#00C48C',
  browser: '#FFD700',
  website: '#FF6B9D'};

const PLATFORM_LABELS: Record<string, string> = {
  meta: 'Meta',
  google: 'Google',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  twitter: 'Twitter/X',
  email: 'Email',
  browser: 'Browser',
  website: 'Website'};

function formatCurrency(val: number): string {
  if (val >= 1000000) return (val / 1000000).toFixed(1) + 'M';
  if (val >= 1000) return (val / 1000).toFixed(1) + 'K';
  return new Intl.NumberFormat('en-US').format(val);
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border},
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: Colors.text, fontSize: 18, fontWeight: '800' as const, letterSpacing: -0.3 },
  headerSub: { color: Colors.textTertiary, fontSize: 11, fontWeight: '600' as const, marginTop: 1 },
  refreshBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },

  tabsScroll: { maxHeight: 48, borderBottomWidth: 1, borderBottomColor: Colors.border },
  tabsRow: { paddingHorizontal: 12, gap: 6, alignItems: 'center', height: 46 },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'transparent'},
  tabActive: { backgroundColor: Colors.primary },
  tabText: { color: Colors.textTertiary, fontSize: 12, fontWeight: '700' as const },
  tabTextActive: { color: '#000' },

  scrollContent: { paddingBottom: 100 },
  tabContent: { paddingHorizontal: 16, paddingTop: 4 },
  emptyText: { color: Colors.textTertiary, fontSize: 13, textAlign: 'center' as const, paddingTop: 40 },

  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  summaryCard: {
    flex: 1,
    minWidth: (SCREEN_W - 52) / 2,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border},
  summaryCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  summaryIconWrap: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  summaryCardLabel: { color: Colors.textTertiary, fontSize: 11, fontWeight: '600' as const },
  summaryCardValue: { color: Colors.text, fontSize: 22, fontWeight: '900' as const, letterSpacing: -0.5 },
  summaryCardSub: { color: Colors.textTertiary, fontSize: 10, fontWeight: '600' as const, marginTop: 3 },

  sectionTitle: { color: Colors.text, fontSize: 15, fontWeight: '800' as const, marginBottom: 12, marginTop: 8, letterSpacing: -0.2 },

  platformGrid: { gap: 10 },
  platformCard: { backgroundColor: Colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.border },
  platformHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  platformDot: { width: 10, height: 10, borderRadius: 5 },
  platformName: { color: Colors.text, fontSize: 14, fontWeight: '700' as const },
  platformStats: { flexDirection: 'row' },
  platformStat: { flex: 1, alignItems: 'center' as const },
  platformStatValue: { color: Colors.text, fontSize: 14, fontWeight: '800' as const },
  platformStatLabel: { color: Colors.textTertiary, fontSize: 9, fontWeight: '600' as const, marginTop: 2 },

  campaignCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: Colors.border, marginBottom: 10 },
  campaignHeader: { marginBottom: 12 },
  campaignTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  campPlatformDot: { width: 8, height: 8, borderRadius: 4 },
  campaignName: { color: Colors.text, fontSize: 13, fontWeight: '700' as const },
  campaignPlatform: { color: Colors.textTertiary, fontSize: 10, fontWeight: '500' as const, marginTop: 2 },
  campaignMetrics: { flexDirection: 'row', marginBottom: 10 },
  campaignMetric: { flex: 1, alignItems: 'center' as const },
  campaignMetricValue: { color: Colors.text, fontSize: 13, fontWeight: '800' as const },
  campaignMetricLabel: { color: Colors.textTertiary, fontSize: 9, fontWeight: '600' as const, marginTop: 2 },
  campaignBudgetBar: { height: 4, backgroundColor: Colors.backgroundTertiary, borderRadius: 2, overflow: 'hidden' as const, marginBottom: 6 },
  campaignBudgetFill: { height: 4, backgroundColor: Colors.primary, borderRadius: 2 },
  campaignBudgetText: { color: Colors.textTertiary, fontSize: 10, fontWeight: '500' as const },

  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  statusActive: { backgroundColor: Colors.positive + '15', borderColor: Colors.positive + '30' },
  statusPaused: { backgroundColor: Colors.textTertiary + '15', borderColor: Colors.textTertiary + '30' },
  statusSyncing: { backgroundColor: Colors.primary + '15', borderColor: Colors.primary + '30' },
  statusText: { fontSize: 8, fontWeight: '800' as const, letterSpacing: 0.8 },

  scoringOverview: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  scoringCard: { flex: 1, backgroundColor: Colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' as const },
  scoringValue: { color: Colors.text, fontSize: 22, fontWeight: '900' as const },
  scoringLabel: { color: Colors.textTertiary, fontSize: 10, fontWeight: '600' as const, marginTop: 3 },

  intentRow: { flexDirection: 'row', gap: 10 },
  intentCard: { flex: 1, backgroundColor: Colors.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' as const },
  intentDot: { width: 8, height: 8, borderRadius: 4, marginBottom: 6 },
  intentCount: { color: Colors.text, fontSize: 16, fontWeight: '800' as const },
  intentLabel: { color: Colors.textTertiary, fontSize: 9, fontWeight: '600' as const, marginTop: 2, textAlign: 'center' as const },

  barChart: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' as const, paddingVertical: 10 },
  barItem: { flex: 1, alignItems: 'center' as const },
  barCount: { color: Colors.textTertiary, fontSize: 9, fontWeight: '700' as const, marginBottom: 4 },
  bar: { width: '100%', borderRadius: 4, minHeight: 4 },
  barLabel: { color: Colors.textTertiary, fontSize: 8, fontWeight: '600' as const, marginTop: 4 },

  segmentCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: Colors.border, marginBottom: 10 },
  segmentHeader: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  segmentName: { color: Colors.text, fontSize: 13, fontWeight: '700' as const },
  segmentDesc: { color: Colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 2 },
  segmentStats: { flexDirection: 'row', marginBottom: 10 },
  segmentStat: { flex: 1, alignItems: 'center' as const },
  segmentStatValue: { color: Colors.text, fontSize: 14, fontWeight: '800' as const },
  segmentStatLabel: { color: Colors.textTertiary, fontSize: 9, fontWeight: '600' as const, marginTop: 2 },
  segmentPlatforms: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  segPlatformBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  segPlatformText: { fontSize: 9, fontWeight: '700' as const },

  serverTrackingCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: Colors.positive + '30' },
  serverTrackingHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  serverTrackingDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.textTertiary },
  serverTrackingDotActive: { backgroundColor: Colors.positive },
  serverTrackingTitle: { color: Colors.text, fontSize: 15, fontWeight: '800' as const },
  serverTrackingDesc: { color: Colors.textTertiary, fontSize: 12, marginBottom: 12 },
  serverTrackingStats: { flexDirection: 'row', gap: 16, marginBottom: 12 },
  serverTrackingStat: {},
  serverTrackingStatValue: { color: Colors.text, fontSize: 18, fontWeight: '900' as const },
  serverTrackingStatLabel: { color: Colors.textTertiary, fontSize: 10, fontWeight: '600' as const, marginTop: 2 },
  endpointsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  endpointBadge: { backgroundColor: Colors.backgroundTertiary, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  endpointText: { color: Colors.textSecondary, fontSize: 10, fontWeight: '600' as const, fontFamily: 'monospace' },

  pixelCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: Colors.border, marginBottom: 10 },
  pixelHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  pixelDot: { width: 10, height: 10, borderRadius: 5 },
  pixelName: { color: Colors.text, fontSize: 13, fontWeight: '700' as const },
  pixelId: { color: Colors.textTertiary, fontSize: 10, fontWeight: '500' as const, fontFamily: 'monospace' },
  pixelStats: { flexDirection: 'row', marginBottom: 10 },
  pixelStat: { flex: 1, alignItems: 'center' as const },
  pixelStatValue: { color: Colors.text, fontSize: 14, fontWeight: '800' as const },
  pixelStatLabel: { color: Colors.textTertiary, fontSize: 9, fontWeight: '600' as const, marginTop: 3 },
  pixelEvents: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  pixelEventBadge: { backgroundColor: Colors.backgroundTertiary, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5 },
  pixelEventText: { color: Colors.textSecondary, fontSize: 9, fontWeight: '600' as const },

  seoOverview: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  seoCard: { flex: 1, minWidth: (SCREEN_W - 56) / 2, backgroundColor: Colors.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' as const },
  seoCardValue: { color: Colors.text, fontSize: 18, fontWeight: '900' as const },
  seoCardLabel: { color: Colors.textTertiary, fontSize: 9, fontWeight: '600' as const, marginTop: 2 },

  keywordRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border },
  keywordRank: { width: 32, height: 28, borderRadius: 8, backgroundColor: Colors.primary + '18', alignItems: 'center', justifyContent: 'center' },
  keywordRankText: { color: Colors.primary, fontSize: 11, fontWeight: '800' as const },
  keywordText: { color: Colors.text, fontSize: 12, fontWeight: '600' as const },
  keywordMeta: { color: Colors.textTertiary, fontSize: 10, marginTop: 2 },

  seoPageRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.border },
  seoPageDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.textTertiary },
  seoPageUrl: { color: Colors.text, fontSize: 12, fontWeight: '600' as const },
  seoPageMeta: { color: Colors.textTertiary, fontSize: 10, marginTop: 2 },

  automationOverview: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  automationCard: { flex: 1, minWidth: (SCREEN_W - 56) / 2, backgroundColor: Colors.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' as const },
  automationValue: { color: Colors.text, fontSize: 18, fontWeight: '900' as const },
  automationLabel: { color: Colors.textTertiary, fontSize: 9, fontWeight: '600' as const, marginTop: 2 },

  triggerCard: { backgroundColor: Colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.border, marginBottom: 10 },
  triggerHeader: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  triggerIconWrap: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.backgroundTertiary, alignItems: 'center', justifyContent: 'center' },
  triggerName: { color: Colors.text, fontSize: 13, fontWeight: '700' as const },
  triggerDesc: { color: Colors.textTertiary, fontSize: 10, lineHeight: 15, marginTop: 2 },
  triggerStats: { flexDirection: 'row', gap: 12 },
  triggerStat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  triggerPlatformDot: { width: 6, height: 6, borderRadius: 3 },
  triggerStatText: { color: Colors.textTertiary, fontSize: 10, fontWeight: '600' as const },

  utmOverview: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  utmOverviewCard: { flex: 1, backgroundColor: Colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' as const },
  utmOverviewValue: { color: Colors.text, fontSize: 18, fontWeight: '900' as const },
  utmOverviewLabel: { color: Colors.textTertiary, fontSize: 9, fontWeight: '600' as const, marginTop: 3 },

  attributionCard: { backgroundColor: Colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.primary + '30', marginBottom: 16 },
  attributionTitle: { color: Colors.primary, fontSize: 11, fontWeight: '800' as const, letterSpacing: 1, marginBottom: 10 },
  attributionRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: Colors.border },
  attributionLabel: { color: Colors.textTertiary, fontSize: 11, fontWeight: '600' as const },
  attributionValue: { color: Colors.text, fontSize: 11, fontWeight: '700' as const },

  utmSourceRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border },
  utmSourceName: { color: Colors.text, fontSize: 12, fontWeight: '700' as const },
  utmSourceCampaign: { color: Colors.textTertiary, fontSize: 10, marginTop: 1 },
  utmSourceStats: { alignItems: 'flex-end' as const },
  utmSourceSessions: { color: Colors.text, fontSize: 12, fontWeight: '700' as const },
  utmSourceConv: { fontSize: 10, fontWeight: '600' as const },
  utmSourceRoas: { fontSize: 10, fontWeight: '800' as const }});

function formatNumber(val: number): string {
  if (val >= 1000000) return (val / 1000000).toFixed(1) + 'M';
  if (val >= 1000) return (val / 1000).toFixed(1) + 'K';
  return new Intl.NumberFormat('en-US').format(val);
}

export default function RetargetingDashboard() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>('campaigns');
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const dashboardQuery = useQuery<any>({
    queryKey: ['engagementIntel.getRetargetingDashboard'],
    queryFn: async () => {
      console.log('[Supabase] Fetching retargeting dashboard');
      const { data, error } = await supabase.from('retargeting_dashboard').select('*').limit(50);
      if (error) { console.log('[Supabase] retargeting_dashboard error:', error.message); return null; }
      return data;
    },
    enabled: isAuthenticated});
  const audiencesQuery = useQuery<any>({
    queryKey: ['engagementIntel.getAudienceSegments'],
    queryFn: async () => {
      const { data, error } = await supabase.from('audience_segments').select('*').limit(50);
      if (error) return null;
      return data;
    },
    enabled: isAuthenticated});
  const pixelsQuery = useQuery<any>({
    queryKey: ['engagementIntel.getAdPixelStatus'],
    queryFn: async () => {
      const { data, error } = await supabase.from('ad_pixels').select('*').limit(50);
      if (error) return null;
      return data;
    },
    enabled: isAuthenticated});
  const seoQuery = useQuery<any>({
    queryKey: ['engagementIntel.getSearchDiscoveryData'],
    queryFn: async () => {
      const { data, error } = await supabase.from('search_discovery').select('*').limit(50);
      if (error) return null;
      return data;
    },
    enabled: isAuthenticated});
  const triggersQuery = useQuery<any>({
    queryKey: ['engagementIntel.getReEngagementTriggers'],
    queryFn: async () => {
      const { data, error } = await supabase.from('re_engagement_triggers').select('*').limit(50);
      if (error) return null;
      return data;
    },
    enabled: isAuthenticated});
  const utmQuery = useQuery<any>({
    queryKey: ['engagementIntel.getUTMAnalytics', { period: '30d' }],
    queryFn: async () => {
      const { data, error } = await supabase.from('utm_analytics').select('*').limit(50);
      if (error) return null;
      return data;
    },
    enabled: isAuthenticated});
  const scoringQuery = useQuery<any>({
    queryKey: ['engagementIntel.getEngagementScoring', { period: '30d' }],
    queryFn: async () => {
      const { data, error } = await supabase.from('engagement_scoring').select('*').limit(50);
      if (error) return null;
      return data;
    },
    enabled: isAuthenticated});

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void Promise.all([
      dashboardQuery.refetch(),
      audiencesQuery.refetch(),
      pixelsQuery.refetch(),
      seoQuery.refetch(),
      triggersQuery.refetch(),
      utmQuery.refetch(),
      scoringQuery.refetch(),
    ]).finally(() => setRefreshing(false));
  }, [dashboardQuery, audiencesQuery, pixelsQuery, seoQuery, triggersQuery, utmQuery, scoringQuery]);

  const switchTab = useCallback((tab: TabType) => {
    Animated.sequence([
      Animated.timing(fadeAnim, { toValue: 0.3, duration: 100, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
    setActiveTab(tab);
  }, [fadeAnim]);

  const tabs: Array<{ id: TabType; label: string; icon: React.ReactNode }> = useMemo(() => [
    { id: 'campaigns', label: 'Campaigns', icon: <Target size={14} color={activeTab === 'campaigns' ? '#000' : Colors.textTertiary} /> },
    { id: 'audiences', label: 'Audiences', icon: <Users size={14} color={activeTab === 'audiences' ? '#000' : Colors.textTertiary} /> },
    { id: 'pixels', label: 'Pixels', icon: <Radio size={14} color={activeTab === 'pixels' ? '#000' : Colors.textTertiary} /> },
    { id: 'seo', label: 'SEO', icon: <Search size={14} color={activeTab === 'seo' ? '#000' : Colors.textTertiary} /> },
    { id: 'triggers', label: 'Triggers', icon: <Zap size={14} color={activeTab === 'triggers' ? '#000' : Colors.textTertiary} /> },
    { id: 'utm', label: 'UTM', icon: <Share2 size={14} color={activeTab === 'utm' ? '#000' : Colors.textTertiary} /> },
  ], [activeTab]);

  const summary = dashboardQuery.data?.summary;

  const renderSummaryCards = () => {
    if (!summary) return null;
    const cards = [
      { label: 'Ad Spend', value: formatCurrency(summary.totalSpend), sub: `of ${formatCurrency(summary.totalBudget)}`, color: '#FF6B9D', icon: <DollarSign size={16} color="#FF6B9D" /> },
      { label: 'Conversions', value: formatNumber(summary.totalConversions), sub: `${summary.overallROAS}x ROAS`, color: Colors.positive, icon: <TrendingUp size={16} color={Colors.positive} /> },
      { label: 'Impressions', value: formatNumber(summary.totalImpressions), sub: `${summary.overallCTR}% CTR`, color: Colors.accent, icon: <Eye size={16} color={Colors.accent} /> },
      { label: 'Audiences', value: formatNumber(summary.totalAudienceSize), sub: `${summary.activeCampaigns} active`, color: Colors.primary, icon: <Users size={16} color={Colors.primary} /> },
    ];
    return (
      <View style={s.summaryRow}>
        {cards.map((c, i) => (
          <View key={i} style={s.summaryCard}>
            <View style={s.summaryCardHeader}>
              <View style={[s.summaryIconWrap, { backgroundColor: c.color + '15' }]}>{c.icon}</View>
              <Text style={s.summaryCardLabel}>{c.label}</Text>
            </View>
            <Text style={[s.summaryCardValue, { color: c.color }]}>{c.value}</Text>
            <Text style={s.summaryCardSub}>{c.sub}</Text>
          </View>
        ))}
      </View>
    );
  };

  const renderCampaigns = () => {
    if (!dashboardQuery.data) return <Text style={s.emptyText}>Loading campaigns...</Text>;
    const { campaigns, platformBreakdown } = dashboardQuery.data;

    return (
      <View style={s.tabContent}>
        <Text style={s.sectionTitle}>Platform Performance</Text>
        <View style={s.platformGrid}>
          {platformBreakdown.map((p: any, i: number) => (
            <View key={i} style={s.platformCard}>
              <View style={s.platformHeader}>
                <View style={[s.platformDot, { backgroundColor: PLATFORM_COLORS[p.platform] || Colors.textTertiary }]} />
                <Text style={s.platformName}>{PLATFORM_LABELS[p.platform] || p.platform}</Text>
              </View>
              <View style={s.platformStats}>
                <View style={s.platformStat}>
                  <Text style={s.platformStatValue}>{formatCurrency(p.spend)}</Text>
                  <Text style={s.platformStatLabel}>Spend</Text>
                </View>
                <View style={s.platformStat}>
                  <Text style={[s.platformStatValue, { color: Colors.positive }]}>{p.conversions}</Text>
                  <Text style={s.platformStatLabel}>Conv.</Text>
                </View>
                <View style={s.platformStat}>
                  <Text style={s.platformStatValue}>{p.ctr}%</Text>
                  <Text style={s.platformStatLabel}>CTR</Text>
                </View>
                <View style={s.platformStat}>
                  <Text style={[s.platformStatValue, { color: Colors.primary }]}>{p.roas}x</Text>
                  <Text style={s.platformStatLabel}>ROAS</Text>
                </View>
              </View>
            </View>
          ))}
        </View>

        <Text style={[s.sectionTitle, { marginTop: 24 }]}>Active Campaigns</Text>
        {campaigns.map((c: any, i: number) => (
          <View key={i} style={s.campaignCard}>
            <View style={s.campaignHeader}>
              <View style={s.campaignTitleRow}>
                <View style={[s.campPlatformDot, { backgroundColor: PLATFORM_COLORS[c.platform] || '#888' }]} />
                <View style={{ flex: 1 }}>
                  <Text style={s.campaignName} numberOfLines={1}>{c.name}</Text>
                  <Text style={s.campaignPlatform}>{PLATFORM_LABELS[c.platform]} · {c.audienceSegment.replace('seg_', '').replace(/_/g, ' ')}</Text>
                </View>
                <View style={[s.statusBadge, c.status === 'active' ? s.statusActive : s.statusPaused]}>
                  <Text style={[s.statusText, { color: c.status === 'active' ? Colors.positive : Colors.textTertiary }]}>
                    {c.status === 'active' ? 'LIVE' : 'PAUSED'}
                  </Text>
                </View>
              </View>
            </View>
            <View style={s.campaignMetrics}>
              <View style={s.campaignMetric}>
                <Text style={s.campaignMetricValue}>{formatCurrency(c.spent)}</Text>
                <Text style={s.campaignMetricLabel}>Spent</Text>
              </View>
              <View style={s.campaignMetric}>
                <Text style={s.campaignMetricValue}>{formatNumber(c.impressions)}</Text>
                <Text style={s.campaignMetricLabel}>Impr.</Text>
              </View>
              <View style={s.campaignMetric}>
                <Text style={[s.campaignMetricValue, { color: Colors.positive }]}>{c.conversions}</Text>
                <Text style={s.campaignMetricLabel}>Conv.</Text>
              </View>
              <View style={s.campaignMetric}>
                <Text style={[s.campaignMetricValue, { color: Colors.primary }]}>{c.roas}x</Text>
                <Text style={s.campaignMetricLabel}>ROAS</Text>
              </View>
            </View>
            <View style={s.campaignBudgetBar}>
              <View style={[s.campaignBudgetFill, { width: `${Math.min((c.spent / c.budget) * 100, 100)}%` as any }]} />
            </View>
            <Text style={s.campaignBudgetText}>{formatCurrency(c.spent)} of {formatCurrency(c.budget)} budget used</Text>
          </View>
        ))}
      </View>
    );
  };

  const renderAudiences = () => {
    if (!audiencesQuery.data || !scoringQuery.data) return <Text style={s.emptyText}>Loading audiences...</Text>;
    const { segments } = audiencesQuery.data;
    const { intentBreakdown, scoreDistribution } = audiencesQuery.data;
    const scoring = scoringQuery.data;

    return (
      <View style={s.tabContent}>
        <Text style={s.sectionTitle}>Engagement Scoring</Text>
        <View style={s.scoringOverview}>
          <View style={s.scoringCard}>
            <Text style={s.scoringValue}>{scoring.averageScore}</Text>
            <Text style={s.scoringLabel}>Avg Score</Text>
          </View>
          <View style={s.scoringCard}>
            <Text style={[s.scoringValue, { color: Colors.positive }]}>{scoring.highIntentRate}%</Text>
            <Text style={s.scoringLabel}>High Intent</Text>
          </View>
          <View style={s.scoringCard}>
            <Text style={[s.scoringValue, { color: Colors.accent }]}>{formatNumber(scoring.totalSessions)}</Text>
            <Text style={s.scoringLabel}>Sessions</Text>
          </View>
        </View>

        <Text style={s.sectionTitle}>Intent Distribution</Text>
        <View style={s.intentRow}>
          {[
            { label: 'High (50+)', count: intentBreakdown.highIntent, color: Colors.positive },
            { label: 'Medium (25-49)', count: intentBreakdown.mediumIntent, color: Colors.primary },
            { label: 'Low (0-24)', count: intentBreakdown.lowIntent, color: Colors.textTertiary },
          ].map((item, i) => (
            <View key={i} style={s.intentCard}>
              <View style={[s.intentDot, { backgroundColor: item.color }]} />
              <Text style={s.intentCount}>{formatNumber(item.count)}</Text>
              <Text style={s.intentLabel}>{item.label}</Text>
            </View>
          ))}
        </View>

        <Text style={[s.sectionTitle, { marginTop: 24 }]}>Score Distribution</Text>
        <View style={s.barChart}>
          {scoreDistribution.map((d: any, i: number) => {
            const maxCount = Math.max(...scoreDistribution.map((x: any) => x.count), 1);
            const height = Math.max((d.count / maxCount) * 80, 4);
            const colors = ['#6A6A6A', '#4A90D9', Colors.primary, Colors.positive, '#FF6B9D'];
            return (
              <View key={i} style={s.barItem}>
                <Text style={s.barCount}>{d.count}</Text>
                <View style={[s.bar, { height, backgroundColor: colors[i] || Colors.primary }]} />
                <Text style={s.barLabel}>{d.range}</Text>
              </View>
            );
          })}
        </View>

        <Text style={[s.sectionTitle, { marginTop: 24 }]}>Audience Segments</Text>
        {segments.map((seg: any, i: number) => (
          <View key={i} style={s.segmentCard}>
            <View style={s.segmentHeader}>
              <View style={{ flex: 1 }}>
                <Text style={s.segmentName}>{seg.name}</Text>
                <Text style={s.segmentDesc} numberOfLines={2}>{seg.description}</Text>
              </View>
              <View style={[s.statusBadge, seg.status === 'active' ? s.statusActive : s.statusSyncing]}>
                <Text style={[s.statusText, { color: seg.status === 'active' ? Colors.positive : Colors.primary }]}>
                  {seg.status.toUpperCase()}
                </Text>
              </View>
            </View>
            <View style={s.segmentStats}>
              <View style={s.segmentStat}>
                <Text style={s.segmentStatValue}>{formatNumber(seg.size)}</Text>
                <Text style={s.segmentStatLabel}>Size</Text>
              </View>
              <View style={s.segmentStat}>
                <Text style={[s.segmentStatValue, { color: Colors.positive }]}>{seg.conversionRate}%</Text>
                <Text style={s.segmentStatLabel}>CVR</Text>
              </View>
              <View style={s.segmentStat}>
                <Text style={s.segmentStatValue}>{formatCurrency(seg.costPerAcquisition)}</Text>
                <Text style={s.segmentStatLabel}>CPA</Text>
              </View>
            </View>
            <View style={s.segmentPlatforms}>
              {seg.platforms.map((p: any, j: number) => (
                <View key={j} style={[s.segPlatformBadge, { backgroundColor: (PLATFORM_COLORS[p] || '#888') + '20', borderColor: (PLATFORM_COLORS[p] || '#888') + '40' }]}>
                  <Text style={[s.segPlatformText, { color: PLATFORM_COLORS[p] || '#888' }]}>{PLATFORM_LABELS[p] || p}</Text>
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>
    );
  };

  const renderPixels = () => {
    if (!pixelsQuery.data) return <Text style={s.emptyText}>Loading pixel status...</Text>;
    const { pixels, serverSideTracking } = pixelsQuery.data;

    return (
      <View style={s.tabContent}>
        <View style={s.serverTrackingCard}>
          <View style={s.serverTrackingHeader}>
            <View style={[s.serverTrackingDot, serverSideTracking.enabled && s.serverTrackingDotActive]} />
            <Text style={s.serverTrackingTitle}>Server-Side Tracking</Text>
          </View>
          <Text style={s.serverTrackingDesc}>{serverSideTracking.provider}</Text>
          <View style={s.serverTrackingStats}>
            <View style={s.serverTrackingStat}>
              <Text style={s.serverTrackingStatValue}>{formatNumber(serverSideTracking.eventsProcessed24h)}</Text>
              <Text style={s.serverTrackingStatLabel}>Events (24h)</Text>
            </View>
            <View style={s.serverTrackingStat}>
              <Text style={[s.serverTrackingStatValue, { color: Colors.positive }]}>{serverSideTracking.deduplicationRate}%</Text>
              <Text style={s.serverTrackingStatLabel}>Dedup Rate</Text>
            </View>
          </View>
          <View style={s.endpointsRow}>
            {serverSideTracking.endpoints.map((ep: any, i: number) => (
              <View key={i} style={s.endpointBadge}>
                <Text style={s.endpointText}>{ep}</Text>
              </View>
            ))}
          </View>
        </View>

        <Text style={[s.sectionTitle, { marginTop: 20 }]}>Ad Platform Pixels</Text>
        {pixels.map((px: any, i: number) => (
          <View key={i} style={s.pixelCard}>
            <View style={s.pixelHeader}>
              <View style={[s.pixelDot, { backgroundColor: PLATFORM_COLORS[px.platform.split(' ')[0].toLowerCase()] || Colors.positive }]} />
              <View style={{ flex: 1 }}>
                <Text style={s.pixelName}>{px.platform}</Text>
                <Text style={s.pixelId}>{px.pixelId}</Text>
              </View>
              <View style={[s.statusBadge, px.status === 'active' ? s.statusActive : s.statusPaused]}>
                <Text style={[s.statusText, { color: px.status === 'active' ? Colors.positive : Colors.negative }]}>
                  {px.status.toUpperCase()}
                </Text>
              </View>
            </View>
            <View style={s.pixelStats}>
              <View style={s.pixelStat}>
                <Text style={s.pixelStatValue}>{formatNumber(px.totalEvents24h)}</Text>
                <Text style={s.pixelStatLabel}>Events 24h</Text>
              </View>
              <View style={s.pixelStat}>
                <Text style={[s.pixelStatValue, { color: Colors.positive }]}>{px.matchRate}%</Text>
                <Text style={s.pixelStatLabel}>Match Rate</Text>
              </View>
              <View style={s.pixelStat}>
                <Text style={s.pixelStatValue}>{px.audiencesSynced}</Text>
                <Text style={s.pixelStatLabel}>Audiences</Text>
              </View>
              <View style={s.pixelStat}>
                {px.conversionAPI ? (
                  <CheckCircle size={16} color={Colors.positive} />
                ) : (
                  <AlertCircle size={16} color={Colors.textTertiary} />
                )}
                <Text style={s.pixelStatLabel}>CAPI</Text>
              </View>
            </View>
            <View style={s.pixelEvents}>
              {px.eventsTracked.map((evt: any, j: number) => (
                <View key={j} style={s.pixelEventBadge}>
                  <Text style={s.pixelEventText}>{evt}</Text>
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>
    );
  };

  const renderSEO = () => {
    if (!seoQuery.data) return <Text style={s.emptyText}>Loading SEO data...</Text>;
    const { searchKeywords, seoPages, totalOrganicClicks, totalImpressions, avgPosition, indexedPages } = seoQuery.data;

    return (
      <View style={s.tabContent}>
        <Text style={s.sectionTitle}>Google Search Performance</Text>
        <View style={s.seoOverview}>
          <View style={s.seoCard}>
            <Text style={[s.seoCardValue, { color: Colors.positive }]}>{formatNumber(totalOrganicClicks)}</Text>
            <Text style={s.seoCardLabel}>Organic Clicks</Text>
          </View>
          <View style={s.seoCard}>
            <Text style={[s.seoCardValue, { color: Colors.accent }]}>{formatNumber(totalImpressions)}</Text>
            <Text style={s.seoCardLabel}>Impressions</Text>
          </View>
          <View style={s.seoCard}>
            <Text style={[s.seoCardValue, { color: Colors.primary }]}>#{avgPosition}</Text>
            <Text style={s.seoCardLabel}>Avg Position</Text>
          </View>
          <View style={s.seoCard}>
            <Text style={s.seoCardValue}>{indexedPages}</Text>
            <Text style={s.seoCardLabel}>Indexed</Text>
          </View>
        </View>

        <Text style={[s.sectionTitle, { marginTop: 20 }]}>Top Keywords</Text>
        {searchKeywords.slice(0, 8).map((kw: any, i: number) => (
          <View key={i} style={s.keywordRow}>
            <View style={s.keywordRank}>
              <Text style={s.keywordRankText}>#{kw.position}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.keywordText} numberOfLines={1}>{kw.keyword}</Text>
              <Text style={s.keywordMeta}>{formatNumber(kw.volume)} vol · {kw.ctr}% CTR · {formatNumber(kw.clicks)} clicks</Text>
            </View>
            <ArrowUpRight size={14} color={Colors.positive} />
          </View>
        ))}

        <Text style={[s.sectionTitle, { marginTop: 24 }]}>Indexed Pages</Text>
        {seoPages.map((pg: any, i: number) => (
          <View key={i} style={s.seoPageRow}>
            <View style={[s.seoPageDot, pg.indexStatus === 'indexed' && { backgroundColor: Colors.positive }]} />
            <View style={{ flex: 1 }}>
              <Text style={s.seoPageUrl} numberOfLines={1}>{pg.url}</Text>
              <Text style={s.seoPageMeta}>{formatNumber(pg.impressions)} impr · {formatNumber(pg.clicks)} clicks · Pos {pg.avgPosition}</Text>
            </View>
          </View>
        ))}
      </View>
    );
  };

  const renderTriggers = () => {
    if (!triggersQuery.data) return <Text style={s.emptyText}>Loading triggers...</Text>;
    const { triggers, automationStats } = triggersQuery.data;

    const triggerIcons: Record<string, React.ReactNode> = {
      retargeting_ad: <Target size={16} color={Colors.primary} />,
      push_notification: <Bell size={16} color="#FF6B9D" />,
      email: <Mail size={16} color={Colors.positive} />,
      popup: <Layers size={16} color={Colors.accent} />,
      search_retarget: <Search size={16} color="#4285F4" />};

    return (
      <View style={s.tabContent}>
        <Text style={s.sectionTitle}>Automation Summary</Text>
        <View style={s.automationOverview}>
          <View style={s.automationCard}>
            <Text style={[s.automationValue, { color: Colors.primary }]}>{formatNumber(automationStats.totalTriggersFired24h)}</Text>
            <Text style={s.automationLabel}>Triggers (24h)</Text>
          </View>
          <View style={s.automationCard}>
            <Text style={[s.automationValue, { color: Colors.positive }]}>{automationStats.totalConversions24h}</Text>
            <Text style={s.automationLabel}>Conversions</Text>
          </View>
          <View style={s.automationCard}>
            <Text style={[s.automationValue, { color: '#FF6B9D' }]}>{automationStats.overallConversionRate}%</Text>
            <Text style={s.automationLabel}>CVR</Text>
          </View>
          <View style={s.automationCard}>
            <Text style={[s.automationValue, { color: Colors.accent }]}>{formatCurrency(automationStats.revenue24h)}</Text>
            <Text style={s.automationLabel}>Revenue</Text>
          </View>
        </View>

        <Text style={[s.sectionTitle, { marginTop: 20 }]}>Re-Engagement Triggers</Text>
        {triggers.map((t: any, i: number) => (
          <View key={i} style={s.triggerCard}>
            <View style={s.triggerHeader}>
              <View style={s.triggerIconWrap}>
                {triggerIcons[t.type] || <Zap size={16} color={Colors.primary} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.triggerName}>{t.name}</Text>
                <Text style={s.triggerDesc} numberOfLines={2}>{t.description}</Text>
              </View>
              <View style={[s.statusBadge, t.status === 'active' ? s.statusActive : s.statusPaused]}>
                <Text style={[s.statusText, { color: t.status === 'active' ? Colors.positive : Colors.textTertiary }]}>
                  {t.status.toUpperCase()}
                </Text>
              </View>
            </View>
            <View style={s.triggerStats}>
              <View style={s.triggerStat}>
                <View style={[s.triggerPlatformDot, { backgroundColor: PLATFORM_COLORS[t.platform] || '#888' }]} />
                <Text style={s.triggerStatText}>{PLATFORM_LABELS[t.platform] || t.platform}</Text>
              </View>
              <View style={s.triggerStat}>
                <Clock size={11} color={Colors.textTertiary} />
                <Text style={s.triggerStatText}>{t.delay}</Text>
              </View>
              <View style={s.triggerStat}>
                <Activity size={11} color={Colors.textTertiary} />
                <Text style={s.triggerStatText}>{t.fired24h} fired</Text>
              </View>
              <View style={s.triggerStat}>
                <TrendingUp size={11} color={Colors.positive} />
                <Text style={[s.triggerStatText, { color: Colors.positive }]}>{t.conversionRate}% CVR</Text>
              </View>
            </View>
          </View>
        ))}
      </View>
    );
  };

  const renderUTM = () => {
    if (!utmQuery.data) return <Text style={s.emptyText}>Loading UTM data...</Text>;
    const { sources, totals, attribution } = utmQuery.data;

    return (
      <View style={s.tabContent}>
        <Text style={s.sectionTitle}>Channel Attribution</Text>
        <View style={s.utmOverview}>
          <View style={s.utmOverviewCard}>
            <Text style={[s.utmOverviewValue, { color: Colors.positive }]}>{formatNumber(totals.conversions)}</Text>
            <Text style={s.utmOverviewLabel}>Total Conversions</Text>
          </View>
          <View style={s.utmOverviewCard}>
            <Text style={[s.utmOverviewValue, { color: Colors.primary }]}>{formatCurrency(totals.revenue)}</Text>
            <Text style={s.utmOverviewLabel}>Total Revenue</Text>
          </View>
          <View style={s.utmOverviewCard}>
            <Text style={[s.utmOverviewValue, { color: Colors.accent }]}>{formatCurrency(totals.organicValue)}</Text>
            <Text style={s.utmOverviewLabel}>Organic Value</Text>
          </View>
        </View>

        <View style={s.attributionCard}>
          <Text style={s.attributionTitle}>Multi-Touch Attribution</Text>
          <View style={s.attributionRow}>
            <Text style={s.attributionLabel}>First Touch</Text>
            <Text style={s.attributionValue}>{attribution.firstTouch.topSource} ({attribution.firstTouch.conversions})</Text>
          </View>
          <View style={s.attributionRow}>
            <Text style={s.attributionLabel}>Last Touch</Text>
            <Text style={s.attributionValue}>{attribution.lastTouch.topSource} ({attribution.lastTouch.conversions})</Text>
          </View>
          <View style={s.attributionRow}>
            <Text style={s.attributionLabel}>Top Path</Text>
            <Text style={[s.attributionValue, { color: Colors.primary }]}>{attribution.multiTouch.topPath}</Text>
          </View>
          <View style={s.attributionRow}>
            <Text style={s.attributionLabel}>Avg Touchpoints</Text>
            <Text style={s.attributionValue}>{attribution.multiTouch.avgTouchpoints}</Text>
          </View>
        </View>

        <Text style={[s.sectionTitle, { marginTop: 20 }]}>Traffic Sources</Text>
        {sources.map((src: any, i: number) => (
          <View key={i} style={s.utmSourceRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.utmSourceName}>{src.source}/{src.medium}</Text>
              {src.campaign !== '(not set)' && (
                <Text style={s.utmSourceCampaign}>{src.campaign}</Text>
              )}
            </View>
            <View style={s.utmSourceStats}>
              <Text style={s.utmSourceSessions}>{formatNumber(src.sessions)}</Text>
              <Text style={[s.utmSourceConv, { color: Colors.positive }]}>{src.conversions} conv</Text>
              {src.roas > 0 && (
                <Text style={[s.utmSourceRoas, { color: Colors.primary }]}>{src.roas}x</Text>
              )}
            </View>
          </View>
        ))}
      </View>
    );
  };

  return (
    <View style={s.root}>
      <SafeAreaView edges={['top']} style={s.safe}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn} testID="retarget-back">
            <ArrowLeft size={22} color={Colors.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.headerTitle}>Engagement Intelligence</Text>
            <Text style={s.headerSub}>Ad Retargeting · SEO · Audience Sync</Text>
          </View>
          <TouchableOpacity onPress={onRefresh} style={s.refreshBtn}>
            <RefreshCw size={18} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.tabsRow}
          style={s.tabsScroll}
        >
          {tabs.map((tab) => (
            <TouchableOpacity
              key={tab.id}
              style={[s.tab, activeTab === tab.id && s.tabActive]}
              onPress={() => switchTab(tab.id)}
              activeOpacity={0.75}
            >
              {tab.icon}
              <Text style={[s.tabText, activeTab === tab.id && s.tabTextActive]}>{tab.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        >
          <Animated.View style={{ opacity: fadeAnim }}>
            {renderSummaryCards()}
            {activeTab === 'campaigns' && renderCampaigns()}
            {activeTab === 'audiences' && renderAudiences()}
            {activeTab === 'pixels' && renderPixels()}
            {activeTab === 'seo' && renderSEO()}
            {activeTab === 'triggers' && renderTriggers()}
            {activeTab === 'utm' && renderUTM()}
          </Animated.View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
