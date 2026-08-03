import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Animated,
  Platform} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  BarChart3,
  Layers,
  MapPin,
  Share2,
  Fingerprint,
  Brain,
  Radio,
  Activity,
  Sparkles,
  Wifi,
  WifiOff,
  AlertTriangle,
  RefreshCw} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchRawEvents, computeAnalytics, fetchExtraCounts } from '@/lib/analytics-compute';
import type { TrendDelta, AcquisitionChannel, SessionQuality } from '@/lib/analytics-compute';
import { usePresenceTracker } from '@/lib/realtime-presence';
import { useAdminGuard } from '@/hooks/useAdminGuard';
import { ACCENT, GREEN, RED, shared } from '@/components/analytics/analytics-shared';
import { OverviewTab } from '@/components/analytics/OverviewTab';
import { FunnelTab } from '@/components/analytics/FunnelTab';
import { GeoTab } from '@/components/analytics/GeoTab';
import { SourcesTab } from '@/components/analytics/SourcesTab';
import { LeadsTab } from '@/components/analytics/LeadsTab';
import { IntelTab } from '@/components/analytics/IntelTab';
import { LiveTab } from '@/components/analytics/LiveTab';
import { AnalyticsDiagnostics } from '@/components/analytics/analytics-diagnostics';

type PeriodType = '1h' | '24h' | '7d' | '30d' | '90d' | 'all';
type TabType = 'overview' | 'acquisition' | 'funnel' | 'geo' | 'insights' | 'live' | 'leads';

interface AnalyticsData {
  period: string;
  totalLeads: number;
  registeredUsers: number;
  waitlistLeads: number;
  totalEvents: number;
  pageViews: number;
  uniqueSessions: number;
  topScreens: Array<{ screen: string; views: number; uniqueSessions: number; avgTimeSpent: number; totalTimeSpent: number; pct: number; lastViewed: string }>;
  topActions: Array<{ action: string; count: number; uniqueSessions: number; avgTimeSpent: number; pct: number; lastTriggered: string }>;
  timeSpent: { totalTrackedSeconds: number; avgSessionSeconds: number; avgScreenSeconds: number; maxSessionSeconds: number; engagedSessions: number };
  funnel: {
    pageViews: number;
    scroll25: number;
    scroll50: number;
    scroll75: number;
    scroll100: number;
    formFocuses: number;
    formSubmits: number;
  };
  cta: {
    getStarted: number;
    signIn: number;
    jvInquire: number;
    websiteClick: number;
  };
  conversionRate: number;
  scrollEngagement: number;
  byEvent: Array<{ event: string; count: number }>;
  byPlatform: Array<{ platform: string; count: number }>;
  byReferrer: Array<{ referrer: string; count: number }>;
  dailyViews: Array<{ date: string; views: number; sessions: number }>;
  hourlyActivity: Array<{ hour: number; count: number }>;
  geoZones: {
    byCountry: Array<{ country: string; count: number; pct: number }>;
    byCity: Array<{ city: string; count: number; country: string; lat?: number; lng?: number; pct: number }>;
    byRegion: Array<{ region: string; count: number; pct: number }>;
    byTimezone: Array<{ timezone: string; count: number }>;
    totalWithGeo: number;
  };
  smartInsights: {
    avgTimeOnPage: number;
    bounceRate: number;
    engagementScore: number;
    topInterests: Array<{ interest: string; count: number; pct: number }>;
    sectionEngagement: Array<{ section: string; count: number; pct: number }>;
    deviceBreakdown: Array<{ device: string; count: number; pct: number }>;
    peakHour: number;
    contentInteraction: {
      scrolledPast50Pct: number;
      scrolledPast75Pct: number;
      interactedWithForm: number;
      submittedForm: number;
      clickedAnyCta: number;
    };
    visitorIntent: {
      highIntent: number;
      mediumIntent: number;
      lowIntent: number;
      highIntentPct: number;
      mediumIntentPct: number;
      lowIntentPct: number;
    };
  };
  liveData: {
    active: number;
    recent: number;
    sessions: Array<{
      sessionId: string;
      ip: string;
      device: string;
      os: string;
      browser: string;
      geo?: { city?: string; country?: string; region?: string };
      currentStep: number;
      sessionDuration: number;
      activeTime: number;
      lastSeen: string;
      startedAt: string;
      isActive: boolean;
    }>;
    breakdown: {
      byCountry: Array<{ country: string; count: number }>;
      byDevice: Array<{ device: string; count: number }>;
      byStep: Array<{ step: string; count: number }>;
    };
    timestamp: string;
  };
  trends: {
    pageViews: TrendDelta;
    sessions: TrendDelta;
    leads: TrendDelta;
    conversionRate: TrendDelta;
    bounceRate: TrendDelta;
    avgDuration: TrendDelta;
  };
  acquisition: AcquisitionChannel[];
  sessionQuality: SessionQuality;
}

const PERIODS: { label: string; value: PeriodType }[] = [
  { label: '1H', value: '1h' },
  { label: '24H', value: '24h' },
  { label: '7D', value: '7d' },
  { label: '30D', value: '30d' },
  { label: '90D', value: '90d' },
  { label: 'All', value: 'all' },
];

const TABS: { label: string; value: TabType; icon: React.ReactNode }[] = [
  { label: 'Overview', value: 'overview', icon: <BarChart3 size={14} color={Colors.textTertiary} /> },
  { label: 'Funnel', value: 'funnel', icon: <Layers size={14} color={Colors.textTertiary} /> },
  { label: 'Geo', value: 'geo', icon: <MapPin size={14} color={Colors.textTertiary} /> },
  { label: 'Sources', value: 'acquisition', icon: <Share2 size={14} color={Colors.textTertiary} /> },
  { label: 'Leads', value: 'leads', icon: <Fingerprint size={14} color={Colors.textTertiary} /> },
  { label: 'Intel', value: 'insights', icon: <Brain size={14} color={Colors.textTertiary} /> },
  { label: 'Live', value: 'live', icon: <Radio size={14} color="#E53935" /> },
];

function getApiBaseUrl(): string {
  return process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_API_BASE_URL || 'https://ivxholding.com';
}

const LIVE_ANALYTICS_REFRESH_INTERVAL_MS = 60_000;
const STANDARD_ANALYTICS_REFRESH_INTERVAL_MS = 180_000;
const ANALYTICS_STALE_TIME_MS = 60_000;

export default function AnalyticsReportScreen() {
  const router = useRouter();
  const adminGuard = useAdminGuard({ redirectOnFail: false });
  const [period, setPeriod] = useState<PeriodType>('all');
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [manualRefreshing, setManualRefreshing] = useState<boolean>(false);
  const [fetchCount, setFetchCount] = useState<number>(0);

  const headerAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(headerAnim, { toValue: 1, tension: 40, friction: 10, useNativeDriver: true }).start();
  }, [headerAnim]);

  const pollInterval = activeTab === 'live'
    ? LIVE_ANALYTICS_REFRESH_INTERVAL_MS
    : STANDARD_ANALYTICS_REFRESH_INTERVAL_MS;

  const analyticsQuery = useQuery<AnalyticsData | null>({
    queryKey: ['analytics.report', { period }],
    queryFn: async () => {
      console.log('[Analytics] Dashboard fetch — period:', period);
      const rawEvents = await fetchRawEvents(period);
      console.log('[Analytics] Total events fetched:', rawEvents.length);
      if (rawEvents.length === 0) {
        console.log('[Analytics] No events found');
        return computeAnalytics([], period) as unknown as AnalyticsData;
      }
      const appEvents = rawEvents.filter(e => {
        const props = e.properties as Record<string, unknown> | undefined;
        return props?.source === 'app';
      }).length;
      const landingEvents = rawEvents.length - appEvents;
      console.log('[Analytics] Breakdown — app:', appEvents, ', landing:', landingEvents);
      const computed = computeAnalytics(rawEvents, period);
      const extras = await fetchExtraCounts();
      if (extras.registeredUserCount > 0) {
        computed.registeredUsers = extras.registeredUserCount;
      }
      if (extras.waitlistCount > 0) {
        computed.waitlistLeads = extras.waitlistCount;
      }
      computed.totalLeads = computed.registeredUsers + computed.waitlistLeads;
      console.log('[Analytics] Computed:', computed.pageViews, 'views,', computed.uniqueSessions, 'sessions, leads:', computed.totalLeads);
      return computed as unknown as AnalyticsData;
    },
    enabled: adminGuard.isAdmin,
    staleTime: ANALYTICS_STALE_TIME_MS,
    gcTime: 1000 * 60 * 10,
    refetchInterval: pollInterval,
    refetchIntervalInBackground: false,
    networkMode: 'always',
    retry: 1,
    retryDelay: 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false});

  const data = analyticsQuery.data as AnalyticsData | undefined ?? null;
  const isError = analyticsQuery.isError && !data;
  const errorMsg = analyticsQuery.error?.message || 'Failed to load analytics';
  const isConnected = !!data || analyticsQuery.isSuccess;
  const lastUpdated = analyticsQuery.dataUpdatedAt ? new Date(analyticsQuery.dataUpdatedAt).toLocaleTimeString() : '';

  useEffect(() => {
    if (analyticsQuery.isSuccess && analyticsQuery.data) {
      setFetchCount(prev => prev + 1);
      console.log(`[Analytics] Supabase data loaded: ${analyticsQuery.data.totalLeads} leads, ${analyticsQuery.data.pageViews} views, ${analyticsQuery.data.uniqueSessions} sessions`);
    }
    if (analyticsQuery.isError) {
      console.error('[Analytics] Supabase error:', analyticsQuery.error?.message);
    }
  }, [analyticsQuery.isSuccess, analyticsQuery.data, analyticsQuery.isError, analyticsQuery.error]);

  const queryClient = useQueryClient();
  const onRefresh = useCallback(async () => {
    setManualRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['analytics.report'] });
    setManualRefreshing(false);
  }, [queryClient]);

  const presenceState = usePresenceTracker();

  const hasNoRealData = data && data.pageViews === 0 && data.uniqueSessions === 0 && data.totalLeads === 0;

  const handleSwitchToLive = useCallback(() => {
    setActiveTab('live');
  }, []);

  if (adminGuard.isVerifying) {
    return (
      <View style={s.root}>
        <SafeAreaView edges={['top']} style={s.safe}>
          <View style={s.adminGateWrap}>
            <Sparkles size={40} color={Colors.textTertiary} />
            <Text style={s.adminGateTitle}>Verifying Access...</Text>
            <Text style={s.adminGateSub}>Checking admin authorization from server.</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (!adminGuard.isAdmin) {
    return (
      <View style={s.root}>
        <SafeAreaView edges={['top']} style={s.safe}>
          <Animated.View style={[s.header, { opacity: headerAnim, transform: [{ translateY: headerAnim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }] }]}>
            <TouchableOpacity onPress={() => router.back()} style={s.backBtn} testID="analytics-back-btn">
              <ArrowLeft size={20} color={Colors.text} />
            </TouchableOpacity>
            <View style={s.headerCenter}>
              <Text style={s.headerTitle}>Analytics</Text>
            </View>
          </Animated.View>
          <View style={s.adminGateWrap}>
            <View style={s.adminGateIcon}>
              <AlertTriangle size={32} color={RED} />
            </View>
            <Text style={s.adminGateTitle}>Access Denied</Text>
            <Text style={s.adminGateSub}>
              {adminGuard.error ?? 'You do not have admin privileges to view analytics.'}
            </Text>
            <Text style={s.adminGateRole}>Role: {adminGuard.role ?? 'unknown'}</Text>
            <TouchableOpacity style={s.retryBtn} onPress={() => router.back()}>
              <ArrowLeft size={14} color="#000" />
              <Text style={s.retryBtnText}>Go Back</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <SafeAreaView edges={['top']} style={s.safe}>
        <Animated.View style={[s.header, { opacity: headerAnim, transform: [{ translateY: headerAnim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }] }]}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn} testID="analytics-back-btn">
            <ArrowLeft size={20} color={Colors.text} />
          </TouchableOpacity>
          <View style={s.headerCenter}>
            <Text style={s.headerTitle}>Analytics</Text>
            <View style={[s.connectionBadge, { backgroundColor: isConnected ? GREEN + '18' : RED + '18' }]}>
              {isConnected ? <Wifi size={10} color={GREEN} /> : <WifiOff size={10} color={RED} />}
              <Text style={[s.connectionText, { color: isConnected ? GREEN : RED }]}>
                {isConnected ? 'LIVE' : 'OFFLINE'}
              </Text>
            </View>
          </View>
          <TouchableOpacity onPress={onRefresh} style={s.refreshBtn} testID="analytics-refresh-btn">
            <RefreshCw size={17} color={Colors.textSecondary} />
          </TouchableOpacity>
        </Animated.View>

        {lastUpdated ? (
          <View style={s.statusBar}>
            <Text style={s.statusText}>Updated {lastUpdated} · {fetchCount} syncs</Text>
            {data && (
              <Text style={s.statusLeads}>{data.totalLeads} leads · {data.pageViews} views</Text>
            )}
          </View>
        ) : null}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabBar} contentContainerStyle={s.tabBarContent}>
          {TABS.map((tab) => {
            const isActive = activeTab === tab.value;
            return (
              <TouchableOpacity
                key={tab.value}
                style={[s.tab, isActive && s.tabActive]}
                onPress={() => setActiveTab(tab.value)}
                activeOpacity={0.7}
                testID={`analytics-tab-${tab.value}`}
              >
                {tab.icon}
                <Text style={[s.tabText, isActive && s.tabTextActive]}>{tab.label}</Text>
                {isActive && <View style={s.tabIndicator} />}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={manualRefreshing} onRefresh={onRefresh} tintColor={ACCENT} />}
          contentContainerStyle={s.scrollContent}
        >
          <View style={s.periodRow}>
            {PERIODS.map((p) => (
              <TouchableOpacity
                key={p.value}
                style={[s.periodChip, period === p.value && s.periodChipActive]}
                onPress={() => setPeriod(p.value)}
                activeOpacity={0.7}
                testID={`analytics-period-${p.value}`}
              >
                <Text style={[s.periodText, period === p.value && s.periodTextActive]}>{p.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {activeTab === 'live' ? (
            <LiveTab presenceState={presenceState} onRefresh={onRefresh} />
          ) : data ? (
            <>
              <AnalyticsDiagnostics
                hasNoRealData={!!hasNoRealData}
                period={period}
                isConnected={isConnected}
              />
              {activeTab === 'overview' && (
                <OverviewTab
                  data={data}
                  presenceState={presenceState}
                  onSwitchToLive={handleSwitchToLive}
                />
              )}
              {activeTab === 'acquisition' && (
                <SourcesTab
                  acquisition={data.acquisition ?? []}
                  sessionQuality={data.sessionQuality}
                  byPlatform={data.byPlatform}
                  byReferrer={data.byReferrer}
                />
              )}
              {activeTab === 'funnel' && (
                <FunnelTab funnel={data.funnel} />
              )}
              {activeTab === 'geo' && (
                <GeoTab geo={data.geoZones} />
              )}
              {activeTab === 'leads' && (
                <LeadsTab
                  totalLeads={data.totalLeads ?? 0}
                  registeredUsers={data.registeredUsers ?? 0}
                  waitlistLeads={data.waitlistLeads ?? 0}
                  uniqueSessions={data.uniqueSessions ?? 0}
                  visitorIntent={data.smartInsights?.visitorIntent ?? { highIntent: 0, mediumIntent: 0 }}
                  geoZones={data.geoZones}
                  sessions={data.liveData?.sessions ?? []}
                  acquisition={data.acquisition ?? []}
                />
              )}
              {activeTab === 'insights' && (
                <IntelTab
                  insights={data.smartInsights}
                  uniqueSessions={data.uniqueSessions}
                  funnel={{ scroll75: data.funnel.scroll75, formSubmits: data.funnel.formSubmits, scroll50: data.funnel.scroll50 }}
                />
              )}
            </>
          ) : isError ? (
            <View style={shared.emptyWrap}>
              <View style={s.errorIcon}>
                <Activity size={40} color={RED} />
              </View>
              <Text style={shared.emptyTitle}>Connection Issue</Text>
              <Text style={shared.emptySubtitle}>{errorMsg || 'Could not reach analytics server. Pull down to retry.'}</Text>
              <Text style={s.debugText}>Server: {getApiBaseUrl()}</Text>
              <TouchableOpacity style={s.retryBtn} onPress={onRefresh}>
                <RefreshCw size={14} color="#000" />
                <Text style={s.retryBtnText}>Retry Now</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={shared.emptyWrap}>
              <Sparkles size={40} color={Colors.textTertiary} />
              <Text style={shared.emptyTitle}>Loading Analytics...</Text>
              <Text style={shared.emptySubtitle}>Connecting to {getApiBaseUrl()}</Text>
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
    backgroundColor: Colors.surface},
  backBtn: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.backgroundSecondary },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, marginLeft: 12 },
  headerTitle: { fontSize: 20, fontWeight: '800' as const, color: Colors.text, letterSpacing: -0.3 },
  connectionBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 },
  connectionText: { fontSize: 9, fontWeight: '800' as const, letterSpacing: 1 },
  refreshBtn: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.backgroundSecondary },
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: Colors.backgroundSecondary,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder},
  statusText: { fontSize: 10, fontWeight: '600' as const, color: Colors.textTertiary },
  statusLeads: { fontSize: 10, fontWeight: '700' as const, color: GREEN },
  tabBar: { backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder, maxHeight: 44 },
  tabBarContent: { flexDirection: 'row', paddingHorizontal: 12, paddingTop: 8, paddingBottom: 2 },
  tab: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 10, paddingHorizontal: 12, position: 'relative' as const },
  tabActive: {},
  tabText: { fontSize: 12, fontWeight: '600' as const, color: Colors.textTertiary },
  tabTextActive: { color: ACCENT, fontWeight: '700' as const },
  tabIndicator: { position: 'absolute', bottom: 0, left: '20%' as any, right: '20%' as any, height: 2, backgroundColor: ACCENT, borderRadius: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 12 },
  periodRow: { flexDirection: 'row', gap: 6, marginBottom: 16 },
  periodChip: { flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: Colors.surface, alignItems: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  periodChipActive: { backgroundColor: ACCENT + '18', borderWidth: 1, borderColor: ACCENT + '50' },
  periodText: { fontSize: 12, fontWeight: '700' as const, color: Colors.textTertiary },
  periodTextActive: { color: ACCENT },
  errorIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#E5393518', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  debugText: { fontSize: 10, color: Colors.textTertiary, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: ACCENT, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10, marginTop: 8 },
  retryBtnText: { fontSize: 13, fontWeight: '700' as const, color: '#000' },
  adminGateWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  adminGateIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#E5393512', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  adminGateTitle: { fontSize: 20, fontWeight: '800' as const, color: Colors.text, textAlign: 'center' as const },
  adminGateSub: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center' as const, lineHeight: 20 },
  adminGateRole: { fontSize: 11, fontWeight: '600' as const, color: Colors.textTertiary, marginTop: 4 }});
