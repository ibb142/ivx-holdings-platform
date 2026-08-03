import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
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
  Brain,
  Eye,
  Users,
  Flame,
  Zap,
  Target,
  Globe,
  Activity,
  AlertTriangle,
  TrendingUp,
  Clock,
  Smartphone,
  Monitor,
  MapPin,
  Radio,
  Shield,
  RefreshCw,
  Sparkles,
  Bell} from 'lucide-react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Colors from '@/constants/colors';
import { fetchRawEvents, computeVisitorIntelligence, type RawEvent } from '@/lib/analytics-compute';

type PeriodType = '1h' | '24h' | '7d' | '30d' | '90d' | 'all';
type TabType = 'overview' | 'leads' | 'patterns' | 'alerts';

const { width: SCREEN_W } = Dimensions.get('window');

const PERIODS: { label: string; value: PeriodType }[] = [
  { label: '1H', value: '1h' },
  { label: '24H', value: '24h' },
  { label: '7D', value: '7d' },
  { label: '30D', value: '30d' },
  { label: '90D', value: '90d' },
  { label: 'All', value: 'all' },
];

const TABS: { label: string; value: TabType; icon: React.ReactNode }[] = [
  { label: 'Overview', value: 'overview', icon: <Brain size={14} color="#97A0AF" /> },
  { label: 'Leads', value: 'leads', icon: <Target size={14} color="#97A0AF" /> },
  { label: 'Patterns', value: 'patterns', icon: <Activity size={14} color="#97A0AF" /> },
  { label: 'Alerts', value: 'alerts', icon: <Bell size={14} color="#E53935" /> },
];

const LIVE_VISITOR_INTELLIGENCE_REFRESH_INTERVAL_MS = 120_000;
const STANDARD_VISITOR_INTELLIGENCE_REFRESH_INTERVAL_MS = 300_000;
const VISITOR_INTELLIGENCE_STALE_TIME_MS = 60_000;

const INTENT_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  hot_lead: { bg: '#FF4D4D20', text: '#FF4D4D', label: 'HOT LEAD' },
  warm: { bg: '#FFB80020', text: '#FFB800', label: 'WARM' },
  interested: { bg: '#4A90D920', text: '#4A90D9', label: 'INTERESTED' },
  browsing: { bg: '#6A6A6A20', text: '#9A9A9A', label: 'BROWSING' }};

const SEVERITY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: '#FF4D4D15', text: '#FF4D4D', border: '#FF4D4D40' },
  high: { bg: '#FFB80015', text: '#FFB800', border: '#FFB80040' },
  medium: { bg: '#4A90D915', text: '#4A90D9', border: '#4A90D940' },
  info: { bg: '#00C48C15', text: '#00C48C', border: '#00C48C40' }};

const COUNTRY_FLAGS: Record<string, string> = {
  'United States': '🇺🇸', 'United Kingdom': '🇬🇧', 'Canada': '🇨🇦', 'Germany': '🇩🇪',
  'France': '🇫🇷', 'Australia': '🇦🇺', 'India': '🇮🇳', 'Brazil': '🇧🇷',
  'Japan': '🇯🇵', 'Mexico': '🇲🇽', 'Spain': '🇪🇸', 'Italy': '🇮🇹',
  'UAE': '🇦🇪', 'Saudi Arabia': '🇸🇦', 'Singapore': '🇸🇬', 'Colombia': '🇨🇴'};

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function PulseIndicator({ active, color = '#00C48C' }: { active: boolean; color?: string }) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (active) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.8, duration: 1000, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 1000, useNativeDriver: true }),
        ])
      ).start();
    }
  }, [active, pulse]);

  return (
    <View style={{ width: 12, height: 12, alignItems: 'center', justifyContent: 'center' }}>
      {active && (
        <Animated.View style={{
          position: 'absolute', width: 12, height: 12, borderRadius: 6,
          borderWidth: 1.5, borderColor: color + '40',
          transform: [{ scale: pulse }]}} />
      )}
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: active ? color : '#555' }} />
    </View>
  );
}

type VisitorAlert = {
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'info';
  title: string;
  message: string;
  timestamp: string;
};

function buildVisitorAlerts(rawEvents: RawEvent[]): { alerts: VisitorAlert[]; activeVisitors: number } {
  const alerts: VisitorAlert[] = [];
  const now = Date.now();
  const fiveMinAgo = now - 5 * 60 * 1000;
  const sessionMap = new Map<string, RawEvent[]>();

  rawEvents.forEach((event) => {
    const sessionId = event.session_id || 'unknown';
    const existing = sessionMap.get(sessionId) ?? [];
    existing.push(event);
    sessionMap.set(sessionId, existing);
  });

  let activeVisitors = 0;
  sessionMap.forEach((events, sessionId) => {
    const lastTime = Math.max(...events.map((event) => new Date(event.created_at).getTime()));
    if (lastTime <= fiveMinAgo) {
      return;
    }

    activeVisitors++;
    const hasForm = events.some((event) => event.event?.includes('form_submit') || event.event?.includes('waitlist'));
    const hasCta = events.some((event) => event.event?.includes('cta_'));
    if (hasForm) {
      alerts.push({
        type: 'hot_lead',
        severity: 'critical',
        title: 'Hot Lead Detected',
        message: `Active session ${sessionId.slice(0, 8)} submitted a form`,
        timestamp: new Date(lastTime).toISOString()});
      return;
    }

    if (hasCta) {
      alerts.push({
        type: 'high_engagement',
        severity: 'high',
        title: 'High Engagement',
        message: `Session ${sessionId.slice(0, 8)} clicked CTA`,
        timestamp: new Date(lastTime).toISOString()});
      return;
    }

    alerts.push({
      type: 'live_visitor',
      severity: 'info',
      title: 'Live Visitor',
      message: `Active session from ${events[0]?.geo?.country || 'unknown location'}`,
      timestamp: new Date(lastTime).toISOString()});
  });

  return { alerts, activeVisitors };
}

function HeatmapBar({ data, maxVal }: { data: Array<{ hour: number; count: number }>; maxVal: number }) {
  const barW = Math.max(Math.floor((SCREEN_W - 64) / 24) - 2, 6);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 60, gap: 2 }}>
      {data.map((d) => {
        const h = maxVal > 0 ? Math.max((d.count / maxVal) * 56, 2) : 2;
        const intensity = maxVal > 0 ? d.count / maxVal : 0;
        const color = intensity > 0.7 ? '#FF4D4D' : intensity > 0.4 ? '#FFB800' : intensity > 0.1 ? '#4A90D9' : '#2A2A2A';
        return (
          <View key={d.hour} style={{ alignItems: 'center', gap: 2 }}>
            <View style={{ width: barW, height: h, borderRadius: 2, backgroundColor: color }} />
            {d.hour % 6 === 0 && (
              <Text style={{ fontSize: 8, color: Colors.textTertiary }}>{d.hour}</Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

export default function VisitorIntelligenceScreen() {
  const router = useRouter();
  const [period, setPeriod] = useState<PeriodType>('all');
  const [activeTab, setActiveTab] = useState<TabType>('overview');

  const headerAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(headerAnim, { toValue: 1, tension: 40, friction: 10, useNativeDriver: true }).start();
  }, [headerAnim]);

  const pollInterval = activeTab === 'alerts'
    ? LIVE_VISITOR_INTELLIGENCE_REFRESH_INTERVAL_MS
    : STANDARD_VISITOR_INTELLIGENCE_REFRESH_INTERVAL_MS;

  const intelQuery = useQuery<any>({
    queryKey: ['analytics.getAIVisitorIntelligence', { period }],
    queryFn: async () => {
      try {
        console.log('[VisitorIntel] Fetching raw events for period:', period);
        const rawEvents = await fetchRawEvents(period);
        console.log('[VisitorIntel] Raw events fetched:', rawEvents.length);
        const computed = computeVisitorIntelligence(rawEvents, period);
        const alertsData = buildVisitorAlerts(rawEvents);
        console.log('[VisitorIntel] Computed:', {
          sessions: computed.summary?.totalSessions,
          hotLeads: computed.summary?.hotLeads,
          events: computed.summary?.totalEvents,
          alerts: alertsData.alerts.length,
          activeVisitors: alertsData.activeVisitors});
        return { ...computed, alertsData };
      } catch (err) {
        console.error('[VisitorIntel] Query error:', (err as Error)?.message);
        return {
          ...computeVisitorIntelligence([], period),
          alertsData: { alerts: [] as VisitorAlert[], activeVisitors: 0 }};
      }
    },
    staleTime: VISITOR_INTELLIGENCE_STALE_TIME_MS,
    refetchInterval: pollInterval,
    refetchIntervalInBackground: false,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * Math.pow(2, attempt), 10000),
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    throwOnError: false});

  const data = intelQuery.data;
  const alertsData = data?.alertsData;

  useEffect(() => {
    if (data) {
      console.log(`[VisitorIntel] Data loaded for ${period}:`, {
        sessions: data.summary.totalSessions,
        hotLeads: data.summary.hotLeads,
        warmLeads: data.summary.warmLeads,
        engagement: data.summary.avgEngagement,
        highIntent: data.highIntentVisitors.length,
        recent: data.recentVisitors.length});
    }
    if (intelQuery.isError) {
      console.error('[VisitorIntel] Query error:', intelQuery.error?.message);
    }
  }, [data, period, intelQuery.isError, intelQuery.error]);

  const [manualRefreshing, setManualRefreshing] = useState<boolean>(false);
  const queryClient = useQueryClient();
  const onRefresh = useCallback(async () => {
    setManualRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['analytics.getAIVisitorIntelligence'] });
    setManualRefreshing(false);
  }, [queryClient]);

  const criticalAlerts = useMemo(() => {
    if (!alertsData?.alerts) return 0;
    return alertsData.alerts.filter((a: any) => a.severity === 'critical' || a.severity === 'high').length;
  }, [alertsData]);

  const hasNoData = data && data.summary.totalSessions === 0 && data.summary.hotLeads === 0;

  const renderDiagnosticPanel = () => {
    if (!hasNoData) return null;
    return (
      <View style={s.diagnosticCard}>
        <View style={s.diagnosticHeader}>
          <AlertTriangle size={18} color="#FFB800" />
          <Text style={s.diagnosticTitle}>No Data Yet</Text>
        </View>
        <Text style={s.diagnosticDesc}>
          Analytics computes from real landing page events stored in Supabase. No fake/demo data is shown.
        </Text>
        <View style={s.diagnosticGrid}>
          <View style={s.diagnosticRow}>
            <Text style={s.diagnosticLabel}>Database</Text>
            <View style={[s.diagnosticBadge, { backgroundColor: '#00C48C20' }]}>
              <Text style={[s.diagnosticBadgeText, { color: '#00C48C' }]}>Supabase Connected</Text>
            </View>
          </View>
          <View style={s.diagnosticRow}>
            <Text style={s.diagnosticLabel}>Events Found</Text>
            <Text style={s.diagnosticValue}>0</Text>
          </View>
          <View style={s.diagnosticRow}>
            <Text style={s.diagnosticLabel}>Period</Text>
            <Text style={s.diagnosticValue}>{period}</Text>
          </View>
        </View>
        <View style={s.diagnosticInfo}>
          <Text style={s.diagnosticInfoText}>
            Visit the landing page to generate tracking events. Data will appear here in real-time as visitors interact with your page.
          </Text>
        </View>
      </View>
    );
  };

  const renderOverview = () => {
    if (!data) return null;
    const { summary, liveNow, aiInsights, topSources, topCountries } = data;

    return (
      <View style={s.tabContent}>
        {renderDiagnosticPanel()}
        <View style={s.liveBar}>
          <PulseIndicator active={liveNow.activeVisitors > 0} />
          <Text style={s.liveText}>
            {liveNow.activeVisitors > 0
              ? `${liveNow.activeVisitors} visitor${liveNow.activeVisitors > 1 ? 's' : ''} on site now`
              : 'No active visitors right now'}
          </Text>
          {liveNow.activeVisitors > 0 && (
            <View style={s.liveBadge}>
              <Text style={s.liveBadgeText}>LIVE</Text>
            </View>
          )}
        </View>

        <View style={s.kpiGrid}>
          <View style={[s.kpiCard, { borderLeftColor: '#4A90D9', borderLeftWidth: 3 }]}>
            <View style={s.kpiIconWrap}>
              <Eye size={16} color="#4A90D9" />
            </View>
            <Text style={s.kpiValue}>{new Intl.NumberFormat('en-US').format(summary.totalSessions)}</Text>
            <Text style={s.kpiLabel}>Sessions</Text>
          </View>
          <View style={[s.kpiCard, { borderLeftColor: '#FF4D4D', borderLeftWidth: 3 }]}>
            <View style={s.kpiIconWrap}>
              <Flame size={16} color="#FF4D4D" />
            </View>
            <Text style={s.kpiValue}>{summary.hotLeads}</Text>
            <Text style={s.kpiLabel}>Hot Leads</Text>
          </View>
          <View style={[s.kpiCard, { borderLeftColor: '#FFB800', borderLeftWidth: 3 }]}>
            <View style={s.kpiIconWrap}>
              <Target size={16} color="#FFB800" />
            </View>
            <Text style={s.kpiValue}>{summary.warmLeads}</Text>
            <Text style={s.kpiLabel}>Warm Leads</Text>
          </View>
          <View style={[s.kpiCard, { borderLeftColor: '#00C48C', borderLeftWidth: 3 }]}>
            <View style={s.kpiIconWrap}>
              <TrendingUp size={16} color="#00C48C" />
            </View>
            <Text style={s.kpiValue}>{summary.conversionRate}%</Text>
            <Text style={s.kpiLabel}>Conversion</Text>
          </View>
        </View>

        <View style={s.engagementCard}>
          <View style={s.engagementHeader}>
            <Brain size={18} color={Colors.primary} />
            <Text style={s.engagementTitle}>Engagement Score</Text>
          </View>
          <View style={s.engagementBarWrap}>
            <View style={s.engagementBarBg}>
              <Animated.View style={[
                s.engagementBarFill,
                {
                  width: `${Math.min(summary.avgEngagement, 100)}%` as any,
                  backgroundColor: summary.avgEngagement >= 60 ? '#00C48C' : summary.avgEngagement >= 30 ? '#FFB800' : '#FF4D4D'},
              ]} />
            </View>
            <Text style={s.engagementScore}>{summary.avgEngagement}/100</Text>
          </View>
          <View style={s.engagementBreakdown}>
            <View style={s.engagementItem}>
              <View style={[s.engagementDot, { backgroundColor: '#00C48C' }]} />
              <Text style={s.engagementItemText}>Engaged: {summary.engagedVisitors}</Text>
            </View>
            <View style={s.engagementItem}>
              <View style={[s.engagementDot, { backgroundColor: '#FF4D4D' }]} />
              <Text style={s.engagementItemText}>Bounced: {summary.bouncedVisitors}</Text>
            </View>
            <View style={s.engagementItem}>
              <View style={[s.engagementDot, { backgroundColor: '#4A90D9' }]} />
              <Text style={s.engagementItemText}>Events: {new Intl.NumberFormat('en-US').format(summary.totalEvents)}</Text>
            </View>
          </View>
        </View>

        {aiInsights.length > 0 && (
          <View style={s.insightsCard}>
            <View style={s.insightsHeader}>
              <Sparkles size={16} color={Colors.primary} />
              <Text style={s.insightsTitle}>AI Insights</Text>
            </View>
            {aiInsights.map((insight: any, i: number) => (
              <View key={i} style={s.insightRow}>
                <View style={s.insightBullet}>
                  <Zap size={10} color={Colors.primary} />
                </View>
                <Text style={s.insightText}>{insight}</Text>
              </View>
            ))}
          </View>
        )}

        {topSources.length > 0 && (
          <View style={s.sectionCard}>
            <Text style={s.sectionTitle}>Top Traffic Sources</Text>
            {topSources.slice(0, 5).map((src: any, i: number) => (
              <View key={i} style={s.sourceRow}>
                <View style={s.sourceRank}>
                  <Text style={s.sourceRankText}>{i + 1}</Text>
                </View>
                <View style={s.sourceInfo}>
                  <Text style={s.sourceName} numberOfLines={1}>{src.source}</Text>
                  <Text style={s.sourceVisits}>{src.visits} visits</Text>
                </View>
                {src.conversionRate > 0 && (
                  <View style={s.sourceConvBadge}>
                    <Text style={s.sourceConvText}>{src.conversionRate}%</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        )}

        {topCountries.length > 0 && (
          <View style={s.sectionCard}>
            <Text style={s.sectionTitle}>Top Markets</Text>
            {topCountries.slice(0, 6).map((c: any, i: number) => (
              <View key={i} style={s.countryRow}>
                <Text style={s.countryFlag}>{COUNTRY_FLAGS[c.country] || '🌍'}</Text>
                <View style={s.countryInfo}>
                  <Text style={s.countryName}>{c.country}</Text>
                  <View style={s.countryStats}>
                    <Text style={s.countryStatText}>{c.visits} visits</Text>
                    {c.conversions > 0 && (
                      <Text style={s.countryConvText}>• {c.conversions} converted</Text>
                    )}
                  </View>
                </View>
                <View style={s.countryEngBadge}>
                  <Text style={[s.countryEngText, {
                    color: c.avgEngagement >= 60 ? '#00C48C' : c.avgEngagement >= 30 ? '#FFB800' : '#9A9A9A'}]}>{c.avgEngagement}</Text>
                  <Text style={s.countryEngLabel}>score</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  };

  const renderLeads = () => {
    if (!data) return null;
    const { highIntentVisitors, recentVisitors } = data;

    return (
      <View style={s.tabContent}>
        <Text style={s.sectionHeader}>High Intent Visitors</Text>
        {highIntentVisitors.length === 0 ? (
          <View style={s.emptyCard}>
            <Target size={32} color={Colors.textTertiary} />
            <Text style={s.emptyText}>No high-intent visitors yet</Text>
            <Text style={s.emptySubText}>Visitors who engage deeply with your page will appear here</Text>
          </View>
        ) : (
          highIntentVisitors.map((v: any, i: number) => {
            const intentStyle = INTENT_COLORS[v.intent] || INTENT_COLORS.browsing;
            return (
              <View key={i} style={s.leadCard}>
                <View style={s.leadHeader}>
                  <View style={[s.intentBadge, { backgroundColor: intentStyle.bg }]}>
                    <Text style={[s.intentText, { color: intentStyle.text }]}>{intentStyle.label}</Text>
                  </View>
                  <Text style={s.leadScore}>{v.engagementScore}/100</Text>
                </View>
                <View style={s.leadDetails}>
                  <View style={s.leadDetail}>
                    <MapPin size={12} color={Colors.textTertiary} />
                    <Text style={s.leadDetailText}>
                      {v.geo?.city || 'Unknown'}{v.geo?.country ? `, ${v.geo.country}` : ''}
                    </Text>
                  </View>
                  <View style={s.leadDetail}>
                    {v.device === 'Mobile' ? <Smartphone size={12} color={Colors.textTertiary} /> : <Monitor size={12} color={Colors.textTertiary} />}
                    <Text style={s.leadDetailText}>{v.device}</Text>
                  </View>
                  <View style={s.leadDetail}>
                    <Clock size={12} color={Colors.textTertiary} />
                    <Text style={s.leadDetailText}>{formatDuration(v.duration)}</Text>
                  </View>
                  <View style={s.leadDetail}>
                    <Activity size={12} color={Colors.textTertiary} />
                    <Text style={s.leadDetailText}>{v.eventCount} events</Text>
                  </View>
                </View>
                <View style={s.leadActions}>
                  {v.hasFormSubmit && (
                    <View style={[s.leadActionBadge, { backgroundColor: '#FF4D4D15' }]}>
                      <Text style={[s.leadActionText, { color: '#FF4D4D' }]}>Form Submitted</Text>
                    </View>
                  )}
                  {v.hasCta && (
                    <View style={[s.leadActionBadge, { backgroundColor: '#FFB80015' }]}>
                      <Text style={[s.leadActionText, { color: '#FFB800' }]}>CTA Clicked</Text>
                    </View>
                  )}
                  {v.hasScroll75 && (
                    <View style={[s.leadActionBadge, { backgroundColor: '#4A90D915' }]}>
                      <Text style={[s.leadActionText, { color: '#4A90D9' }]}>Deep Scroll</Text>
                    </View>
                  )}
                </View>
              </View>
            );
          })
        )}

        <Text style={[s.sectionHeader, { marginTop: 20 }]}>Recent Visitors</Text>
        {recentVisitors.length === 0 ? (
          <View style={s.emptyCard}>
            <Users size={32} color={Colors.textTertiary} />
            <Text style={s.emptyText}>No recent visitors</Text>
          </View>
        ) : (
          recentVisitors.slice(0, 15).map((v: any, i: number) => {
            const intentStyle = INTENT_COLORS[v.intent] || INTENT_COLORS.browsing;
            return (
              <View key={i} style={s.recentRow}>
                <View style={[s.recentDot, { backgroundColor: intentStyle.text }]} />
                <View style={s.recentInfo}>
                  <Text style={s.recentLocation} numberOfLines={1}>
                    {v.geo?.city || 'Unknown'}{v.geo?.country ? `, ${v.geo.country}` : ''}
                  </Text>
                  <Text style={s.recentMeta}>
                    {v.device} • {v.eventCount} events • {formatDuration(v.duration)}
                  </Text>
                </View>
                <View style={s.recentRight}>
                  <View style={[s.intentBadgeSmall, { backgroundColor: intentStyle.bg }]}>
                    <Text style={[s.intentTextSmall, { color: intentStyle.text }]}>{intentStyle.label}</Text>
                  </View>
                  <Text style={s.recentScore}>{v.engagementScore}</Text>
                </View>
              </View>
            );
          })
        )}
      </View>
    );
  };

  const renderPatterns = () => {
    if (!data) return null;
    const { patterns, topSources, summary } = data;
    const maxHourly = Math.max(...patterns.hourlyHeatmap.map((h: any) => h.count), 1);

    return (
      <View style={s.tabContent}>
        <View style={s.sectionCard}>
          <Text style={s.sectionTitle}>Hourly Traffic Heatmap</Text>
          <Text style={s.sectionSubtitle}>Peak hour: {patterns.peakHour}:00 on {patterns.peakDay}s</Text>
          <View style={{ marginTop: 12 }}>
            <HeatmapBar data={patterns.hourlyHeatmap} maxVal={maxHourly} />
          </View>
          <View style={s.heatmapLegend}>
            <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: '#2A2A2A' }]} /><Text style={s.legendText}>Low</Text></View>
            <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: '#4A90D9' }]} /><Text style={s.legendText}>Medium</Text></View>
            <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: '#FFB800' }]} /><Text style={s.legendText}>High</Text></View>
            <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: '#FF4D4D' }]} /><Text style={s.legendText}>Peak</Text></View>
          </View>
        </View>

        <View style={s.sectionCard}>
          <Text style={s.sectionTitle}>Day of Week</Text>
          {patterns.dayOfWeek.map((d: any, i: number) => {
            const maxDay = Math.max(...patterns.dayOfWeek.map((dd: any) => dd.count), 1);
            const pct = (d.count / maxDay) * 100;
            return (
              <View key={i} style={s.dayRow}>
                <Text style={s.dayLabel}>{d.day.slice(0, 3)}</Text>
                <View style={s.dayBarWrap}>
                  <View style={[s.dayBar, { width: `${pct}%` as any, backgroundColor: d.day === patterns.peakDay ? Colors.primary : '#4A90D9' }]} />
                </View>
                <Text style={s.dayCount}>{d.count}</Text>
              </View>
            );
          })}
        </View>

        <View style={s.sectionCard}>
          <Text style={s.sectionTitle}>Source Conversion Rates</Text>
          {topSources.map((src: any, i: number) => (
            <View key={i} style={s.sourceConvRow}>
              <View style={s.sourceConvInfo}>
                <Text style={s.sourceConvName} numberOfLines={1}>{src.source}</Text>
                <Text style={s.sourceConvVisits}>{src.visits} visits → {src.conversions} converted</Text>
              </View>
              <View style={s.sourceConvBarWrap}>
                <View style={[s.sourceConvBarFill, {
                  width: `${Math.min(src.conversionRate * 5, 100)}%` as any,
                  backgroundColor: src.conversionRate > 5 ? '#00C48C' : src.conversionRate > 2 ? '#FFB800' : '#4A90D9'}]} />
              </View>
              <Text style={s.sourceConvRate}>{src.conversionRate}%</Text>
            </View>
          ))}
        </View>

        <View style={s.kpiGrid}>
          <View style={s.patternKpi}>
            <Clock size={18} color="#4A90D9" />
            <Text style={s.patternKpiValue}>{patterns.peakHour}:00</Text>
            <Text style={s.patternKpiLabel}>Peak Hour</Text>
          </View>
          <View style={s.patternKpi}>
            <Globe size={18} color="#00C48C" />
            <Text style={s.patternKpiValue}>{patterns.peakDay?.slice(0, 3)}</Text>
            <Text style={s.patternKpiLabel}>Peak Day</Text>
          </View>
          <View style={s.patternKpi}>
            <Users size={18} color="#FFB800" />
            <Text style={s.patternKpiValue}>{summary.engagedVisitors}</Text>
            <Text style={s.patternKpiLabel}>Engaged</Text>
          </View>
          <View style={s.patternKpi}>
            <Flame size={18} color="#FF4D4D" />
            <Text style={s.patternKpiValue}>{summary.hotLeads + summary.warmLeads}</Text>
            <Text style={s.patternKpiLabel}>Total Leads</Text>
          </View>
        </View>
      </View>
    );
  };

  const renderAlerts = () => {
    if (!alertsData) return null;
    const { alerts, activeVisitors } = alertsData;

    return (
      <View style={s.tabContent}>
        <View style={s.alertSummary}>
          <View style={s.alertSummaryLeft}>
            <PulseIndicator active={activeVisitors > 0} color={activeVisitors > 0 ? '#00C48C' : '#555'} />
            <Text style={s.alertSummaryText}>
              {activeVisitors > 0 ? `${activeVisitors} active now` : 'No active visitors'}
            </Text>
          </View>
          <View style={s.alertCount}>
            <Text style={s.alertCountText}>{alerts.length} alert{alerts.length !== 1 ? 's' : ''}</Text>
          </View>
        </View>

        {alerts.length === 0 ? (
          <View style={s.emptyCard}>
            <Shield size={32} color={Colors.textTertiary} />
            <Text style={s.emptyText}>All clear</Text>
            <Text style={s.emptySubText}>No alerts right now. AI is monitoring your traffic 24/7.</Text>
          </View>
        ) : (
          alerts.map((alert: any, i: number) => {
            const sevStyle = SEVERITY_COLORS[alert.severity] || SEVERITY_COLORS.info;
            return (
              <View key={i} style={[s.alertCard, { backgroundColor: sevStyle.bg, borderColor: sevStyle.border }]}>
                <View style={s.alertHeader}>
                  <View style={s.alertHeaderLeft}>
                    {alert.type === 'hot_lead' && <Flame size={16} color={sevStyle.text} />}
                    {alert.type === 'traffic_spike' && <TrendingUp size={16} color={sevStyle.text} />}
                    {alert.type === 'live_visitor' && <Radio size={16} color={sevStyle.text} />}
                    {alert.type === 'high_engagement' && <Zap size={16} color={sevStyle.text} />}
                    {alert.type === 'new_country' && <Globe size={16} color={sevStyle.text} />}
                    <Text style={[s.alertTitle, { color: sevStyle.text }]}>{alert.title}</Text>
                  </View>
                  <View style={[s.severityBadge, { backgroundColor: sevStyle.text + '20' }]}>
                    <Text style={[s.severityText, { color: sevStyle.text }]}>
                      {alert.severity.toUpperCase()}
                    </Text>
                  </View>
                </View>
                <Text style={s.alertMessage}>{alert.message}</Text>
                <Text style={s.alertTime}>
                  {new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
            );
          })
        )}
      </View>
    );
  };

  const isLoading = intelQuery.isLoading && !data;
  const isError = intelQuery.isError && !data;

  return (
    <View style={s.container}>
      <SafeAreaView edges={['top']} style={s.safeTop}>
        <Animated.View style={[s.header, { opacity: headerAnim, transform: [{ translateY: headerAnim.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) }] }]}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn} testID="back-btn">
            <ArrowLeft size={22} color={Colors.text} />
          </TouchableOpacity>
          <View style={s.headerCenter}>
            <Text style={s.headerTitle}>AI Visitor Intelligence</Text>
            <View style={s.headerLive}>
              <PulseIndicator active={!isLoading} color={Colors.primary} />
              <Text style={s.headerLiveText}>AI MONITORING</Text>
            </View>
          </View>
          <TouchableOpacity onPress={onRefresh} style={s.refreshBtn} testID="refresh-btn">
            <RefreshCw size={18} color={Colors.text} />
          </TouchableOpacity>
        </Animated.View>
      </SafeAreaView>

      <View style={s.tabBar}>
        {TABS.map(tab => {
          const isActive = activeTab === tab.value;
          const showBadge = tab.value === 'alerts' && criticalAlerts > 0;
          return (
            <TouchableOpacity
              key={tab.value}
              style={[s.tab, isActive && s.tabActive]}
              onPress={() => setActiveTab(tab.value)}
            >
              {tab.icon}
              <Text style={[s.tabLabel, isActive && s.tabLabelActive]}>{tab.label}</Text>
              {showBadge && (
                <View style={s.alertBadge}>
                  <Text style={s.alertBadgeText}>{criticalAlerts}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={s.periodBar}>
        {PERIODS.map(p => (
          <TouchableOpacity
            key={p.value}
            style={[s.periodBtn, period === p.value && s.periodBtnActive]}
            onPress={() => setPeriod(p.value)}
          >
            <Text style={[s.periodText, period === p.value && s.periodTextActive]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={manualRefreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
      >
        {isLoading ? (
          <View style={s.loadingWrap}>
            <Brain size={40} color={Colors.primary} />
            <Text style={s.loadingText}>AI is analyzing visitor data...</Text>
          </View>
        ) : isError ? (
          <View style={s.loadingWrap}>
            <AlertTriangle size={40} color={Colors.error} />
            <Text style={s.loadingText}>Failed to load intelligence</Text>
            <Text style={s.loadingSubText}>{intelQuery.error?.message || 'Pull down to retry.'}</Text>
          </View>
        ) : (
          <>
            {activeTab === 'overview' && renderOverview()}
            {activeTab === 'leads' && renderLeads()}
            {activeTab === 'patterns' && renderPatterns()}
            {activeTab === 'alerts' && renderAlerts()}
          </>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  safeTop: { backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border},
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, marginLeft: 12 },
  headerTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  headerLive: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  headerLiveText: { fontSize: 10, fontWeight: '700' as const, color: Colors.primary, letterSpacing: 1 },
  refreshBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },

  tabBar: {
    flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8,
    gap: 4, borderBottomWidth: 1, borderBottomColor: Colors.border},
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 8, borderRadius: 8, gap: 4},
  tabActive: { backgroundColor: Colors.surface },
  tabLabel: { fontSize: 12, fontWeight: '600' as const, color: Colors.textTertiary },
  tabLabelActive: { color: Colors.text },
  alertBadge: {
    backgroundColor: '#FF4D4D', borderRadius: 8, minWidth: 16, height: 16,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4},
  alertBadgeText: { fontSize: 9, fontWeight: '700' as const, color: '#fff' },

  periodBar: {
    flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8, gap: 6},
  periodBtn: {
    flex: 1, paddingVertical: 6, borderRadius: 16, alignItems: 'center',
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border},
  periodBtnActive: { backgroundColor: Colors.primary + '20', borderColor: Colors.primary },
  periodText: { fontSize: 12, fontWeight: '600' as const, color: Colors.textTertiary },
  periodTextActive: { color: Colors.primary },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 12 },
  tabContent: { gap: 12 },

  loadingWrap: { alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 12 },
  loadingText: { fontSize: 16, fontWeight: '600' as const, color: Colors.text },
  loadingSubText: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center' as const },

  liveBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.surface, borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: Colors.border},
  liveText: { flex: 1, fontSize: 13, fontWeight: '600' as const, color: Colors.text },
  liveBadge: {
    backgroundColor: '#00C48C20', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 2},
  liveBadgeText: { fontSize: 10, fontWeight: '800' as const, color: '#00C48C', letterSpacing: 1 },

  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kpiCard: {
    flex: 1, minWidth: (SCREEN_W - 48) / 2, backgroundColor: Colors.surface,
    borderRadius: 10, padding: 14, borderWidth: 1, borderColor: Colors.border},
  kpiIconWrap: { marginBottom: 8 },
  kpiValue: { fontSize: 22, fontWeight: '800' as const, color: Colors.text },
  kpiLabel: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },

  engagementCard: {
    backgroundColor: Colors.surface, borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: Colors.border},
  engagementHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  engagementTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  engagementBarWrap: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  engagementBarBg: { flex: 1, height: 8, borderRadius: 4, backgroundColor: '#1E1E22' },
  engagementBarFill: { height: 8, borderRadius: 4 },
  engagementScore: { fontSize: 14, fontWeight: '700' as const, color: Colors.text, minWidth: 45 },
  engagementBreakdown: { flexDirection: 'row', gap: 16, marginTop: 12 },
  engagementItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  engagementDot: { width: 6, height: 6, borderRadius: 3 },
  engagementItemText: { fontSize: 11, color: Colors.textSecondary },

  insightsCard: {
    backgroundColor: '#FFD70008', borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: Colors.primary + '30'},
  insightsHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  insightsTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.primary },
  insightRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  insightBullet: { marginTop: 3 },
  insightText: { flex: 1, fontSize: 13, color: Colors.text, lineHeight: 19 },

  sectionCard: {
    backgroundColor: Colors.surface, borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: Colors.border},
  sectionTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.text, marginBottom: 12 },
  sectionSubtitle: { fontSize: 12, color: Colors.textSecondary, marginTop: -8, marginBottom: 4 },
  sectionHeader: { fontSize: 16, fontWeight: '700' as const, color: Colors.text, marginBottom: 8 },

  sourceRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: Colors.border + '40'},
  sourceRank: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.backgroundTertiary,
    alignItems: 'center', justifyContent: 'center'},
  sourceRankText: { fontSize: 11, fontWeight: '700' as const, color: Colors.textSecondary },
  sourceInfo: { flex: 1 },
  sourceName: { fontSize: 13, fontWeight: '600' as const, color: Colors.text },
  sourceVisits: { fontSize: 11, color: Colors.textSecondary },
  sourceConvBadge: { backgroundColor: '#00C48C15', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  sourceConvText: { fontSize: 11, fontWeight: '700' as const, color: '#00C48C' },

  countryRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: Colors.border + '40'},
  countryFlag: { fontSize: 20 },
  countryInfo: { flex: 1 },
  countryName: { fontSize: 13, fontWeight: '600' as const, color: Colors.text },
  countryStats: { flexDirection: 'row', gap: 6 },
  countryStatText: { fontSize: 11, color: Colors.textSecondary },
  countryConvText: { fontSize: 11, color: '#00C48C' },
  countryEngBadge: { alignItems: 'center' },
  countryEngText: { fontSize: 16, fontWeight: '800' as const },
  countryEngLabel: { fontSize: 9, color: Colors.textTertiary },

  emptyCard: {
    backgroundColor: Colors.surface, borderRadius: 12, padding: 32,
    alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1, borderColor: Colors.border},
  emptyText: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  emptySubText: { fontSize: 12, color: Colors.textSecondary, textAlign: 'center' as const },

  diagnosticCard: {
    backgroundColor: '#FFB80008', borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: '#FFB80030', marginBottom: 4},
  diagnosticHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginBottom: 8 },
  diagnosticTitle: { fontSize: 15, fontWeight: '700' as const, color: '#FFB800' },
  diagnosticDesc: { fontSize: 12, color: Colors.textSecondary, marginBottom: 12, lineHeight: 18 },
  diagnosticGrid: { gap: 8 },
  diagnosticRow: {
    flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const,
    paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: Colors.border + '30'},
  diagnosticLabel: { fontSize: 12, color: Colors.textSecondary, fontWeight: '500' as const },
  diagnosticValue: { fontSize: 13, color: Colors.text, fontWeight: '700' as const },
  diagnosticBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  diagnosticBadgeText: { fontSize: 11, fontWeight: '700' as const },
  diagnosticWarning: {
    backgroundColor: '#FF4D4D10', borderRadius: 8, padding: 10, marginTop: 12,
    borderWidth: 1, borderColor: '#FF4D4D20'},
  diagnosticWarningText: { fontSize: 11, color: '#FF6B6B', lineHeight: 16 },
  diagnosticInfo: {
    backgroundColor: '#4A90D910', borderRadius: 8, padding: 10, marginTop: 12,
    borderWidth: 1, borderColor: '#4A90D920'},
  diagnosticInfoText: { fontSize: 11, color: '#6AADEE', lineHeight: 16 },

  leadCard: {
    backgroundColor: Colors.surface, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 8},
  leadHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  intentBadge: { borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 },
  intentText: { fontSize: 10, fontWeight: '800' as const, letterSpacing: 0.5 },
  leadScore: { fontSize: 16, fontWeight: '800' as const, color: Colors.text },
  leadDetails: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 10 },
  leadDetail: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  leadDetailText: { fontSize: 12, color: Colors.textSecondary },
  leadActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  leadActionBadge: { borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 },
  leadActionText: { fontSize: 10, fontWeight: '700' as const },

  recentRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.border + '40'},
  recentDot: { width: 8, height: 8, borderRadius: 4 },
  recentInfo: { flex: 1 },
  recentLocation: { fontSize: 13, fontWeight: '600' as const, color: Colors.text },
  recentMeta: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  recentRight: { alignItems: 'flex-end', gap: 4 },
  intentBadgeSmall: { borderRadius: 3, paddingHorizontal: 6, paddingVertical: 2 },
  intentTextSmall: { fontSize: 8, fontWeight: '800' as const, letterSpacing: 0.5 },
  recentScore: { fontSize: 13, fontWeight: '700' as const, color: Colors.textSecondary },

  heatmapLegend: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 2 },
  legendText: { fontSize: 10, color: Colors.textTertiary },

  dayRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  dayLabel: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary, width: 30 },
  dayBarWrap: { flex: 1, height: 14, borderRadius: 4, backgroundColor: '#1E1E22' },
  dayBar: { height: 14, borderRadius: 4 },
  dayCount: { fontSize: 11, fontWeight: '600' as const, color: Colors.text, width: 35, textAlign: 'right' as const },

  sourceConvRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sourceConvInfo: { flex: 1 },
  sourceConvName: { fontSize: 12, fontWeight: '600' as const, color: Colors.text },
  sourceConvVisits: { fontSize: 10, color: Colors.textTertiary },
  sourceConvBarWrap: { width: 60, height: 6, borderRadius: 3, backgroundColor: '#1E1E22' },
  sourceConvBarFill: { height: 6, borderRadius: 3 },
  sourceConvRate: { fontSize: 12, fontWeight: '700' as const, color: Colors.text, width: 40, textAlign: 'right' as const },

  patternKpi: {
    flex: 1, minWidth: (SCREEN_W - 48) / 2, backgroundColor: Colors.surface,
    borderRadius: 10, padding: 14, alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: Colors.border},
  patternKpiValue: { fontSize: 18, fontWeight: '800' as const, color: Colors.text },
  patternKpiLabel: { fontSize: 11, color: Colors.textSecondary },

  alertSummary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.surface, borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 4},
  alertSummaryLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  alertSummaryText: { fontSize: 13, fontWeight: '600' as const, color: Colors.text },
  alertCount: { backgroundColor: Colors.backgroundTertiary, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  alertCountText: { fontSize: 11, fontWeight: '600' as const, color: Colors.textSecondary },

  alertCard: {
    borderRadius: 10, padding: 14, marginBottom: 8, borderWidth: 1},
  alertHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  alertHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  alertTitle: { fontSize: 14, fontWeight: '700' as const },
  severityBadge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  severityText: { fontSize: 9, fontWeight: '800' as const, letterSpacing: 0.5 },
  alertMessage: { fontSize: 13, color: Colors.text, lineHeight: 18, marginBottom: 6 },
  alertTime: { fontSize: 11, color: Colors.textTertiary }});
