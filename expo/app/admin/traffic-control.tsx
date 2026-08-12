import React, { useState, useCallback } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Target,
  Users,
  Eye,
  BarChart3,
  Globe,
  Smartphone,
  Monitor,
  Tablet,
  TrendingUp,
  Activity,
  RefreshCw,
  AlertTriangle,
  MapPin,
  Layers} from 'lucide-react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import Colors from '@/constants/colors';
import { fetchRawEvents } from '@/lib/analytics-compute';
import type { RawEvent } from '@/lib/analytics-compute';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

type PeriodType = '1h' | '24h' | '7d' | '30d' | '90d' | 'all';
type TabType = 'sources' | 'geo' | 'devices' | 'events';

const PERIODS: { label: string; value: PeriodType }[] = [
  { label: '1H', value: '1h' },
  { label: '24H', value: '24h' },
  { label: '7D', value: '7d' },
  { label: '30D', value: '30d' },
  { label: '90D', value: '90d' },
  { label: 'All', value: 'all' },
];

const SOURCE_COLORS = ['#4285F4', '#00C48C', '#F57C00', '#E91E63', '#7B61FF', '#0097A7', '#F9A825', '#9B59B6'];

const formatNumber = (n: number) => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
};

function classifySource(referrer: string): string {
  if (!referrer || referrer === 'direct' || referrer === '(direct)') return 'Direct';
  const r = referrer.toLowerCase();
  if (r.includes('google')) return 'Google';
  if (r.includes('facebook') || r.includes('fb.')) return 'Facebook';
  if (r.includes('instagram')) return 'Instagram';
  if (r.includes('twitter') || r.includes('t.co')) return 'Twitter/X';
  if (r.includes('linkedin')) return 'LinkedIn';
  if (r.includes('tiktok')) return 'TikTok';
  if (r.includes('youtube')) return 'YouTube';
  if (r.includes('reddit')) return 'Reddit';
  if (r.includes('bing')) return 'Bing';
  if (r.includes('yahoo')) return 'Yahoo';
  if (r.includes('mail') || r.includes('outlook') || r.includes('gmail')) return 'Email';
  return referrer.length > 30 ? referrer.substring(0, 30) + '...' : referrer;
}

interface TrafficSourceData {
  name: string;
  sessions: number;
  events: number;
  conversionRate: number;
  color: string;
}

interface GeoData {
  country: string;
  count: number;
  pct: number;
  flag: string;
}

interface DeviceData {
  device: string;
  count: number;
  pct: number;
}

interface EventData {
  event: string;
  count: number;
  pct: number;
}

const COUNTRY_FLAGS: Record<string, string> = {
  'United States': '🇺🇸', 'United Kingdom': '🇬🇧', 'Canada': '🇨🇦', 'Germany': '🇩🇪',
  'France': '🇫🇷', 'Australia': '🇦🇺', 'India': '🇮🇳', 'Brazil': '🇧🇷',
  'Japan': '🇯🇵', 'Mexico': '🇲🇽', 'Spain': '🇪🇸', 'Italy': '🇮🇹',
  'UAE': '🇦🇪', 'United Arab Emirates': '🇦🇪', 'Saudi Arabia': '🇸🇦', 'Singapore': '🇸🇬',
  'Colombia': '🇨🇴', 'Argentina': '🇦🇷', 'Netherlands': '🇳🇱', 'Switzerland': '🇨🇭',
  'Nigeria': '🇳🇬', 'South Africa': '🇿🇦', 'Philippines': '🇵🇭', 'Indonesia': '🇮🇩',
  'Turkey': '🇹🇷', 'Poland': '🇵🇱', 'Portugal': '🇵🇹', 'Ireland': '🇮🇪',
  'China': '🇨🇳', 'South Korea': '🇰🇷', 'Thailand': '🇹🇭', 'Sweden': '🇸🇪'};

function computeTrafficData(events: RawEvent[]) {
  const sourceSessionMap = new Map<string, { sessions: Set<string>; events: number; formSubmits: number }>();
  const countryMap = new Map<string, number>();
  const deviceMap = new Map<string, number>();
  const eventMap = new Map<string, number>();
  const sessionMap = new Map<string, RawEvent[]>();
  let totalWithGeo = 0;

  events.forEach(e => {
    const sid = e.session_id || 'unknown';
    if (!sessionMap.has(sid)) sessionMap.set(sid, []);
    sessionMap.get(sid)!.push(e);

    const props = e.properties as Record<string, unknown> | undefined;
    const referrer = typeof props?.referrer === 'string' ? props.referrer : 'direct';
    const source = classifySource(referrer);

    if (!sourceSessionMap.has(source)) {
      sourceSessionMap.set(source, { sessions: new Set(), events: 0, formSubmits: 0 });
    }
    const sd = sourceSessionMap.get(source)!;
    sd.sessions.add(sid);
    sd.events++;
    if (e.event?.includes('form_submit') || e.event?.includes('waitlist')) {
      sd.formSubmits++;
    }

    const geo = e.geo as { country?: string } | undefined;
    if (geo?.country) {
      totalWithGeo++;
      countryMap.set(geo.country, (countryMap.get(geo.country) || 0) + 1);
    }

    const platform = typeof props?.platform === 'string' ? props.platform : 'unknown';
    const pLower = platform.toLowerCase();
    let deviceType = 'Desktop';
    if (pLower.includes('mobile') || pLower.includes('android') || pLower.includes('iphone') || pLower === 'ios') {
      deviceType = 'Mobile';
    } else if (pLower.includes('tablet') || pLower.includes('ipad')) {
      deviceType = 'Tablet';
    }
    deviceMap.set(deviceType, (deviceMap.get(deviceType) || 0) + 1);

    eventMap.set(e.event, (eventMap.get(e.event) || 0) + 1);
  });

  const totalSessions = sessionMap.size;
  const totalEvents = events.length;
  const formSubmits = events.filter(e => e.event?.includes('form_submit') || e.event?.includes('waitlist')).length;

  const sources: TrafficSourceData[] = Array.from(sourceSessionMap.entries())
    .map(([name, d], idx) => ({
      name,
      sessions: d.sessions.size,
      events: d.events,
      conversionRate: d.sessions.size > 0 ? parseFloat(((d.formSubmits / d.sessions.size) * 100).toFixed(1)) : 0,
      color: SOURCE_COLORS[idx % SOURCE_COLORS.length] ?? '#666'}))
    .sort((a, b) => b.sessions - a.sessions);

  const geo: GeoData[] = Array.from(countryMap.entries())
    .map(([country, count]) => ({
      country,
      count,
      pct: totalWithGeo > 0 ? parseFloat(((count / totalWithGeo) * 100).toFixed(1)) : 0,
      flag: COUNTRY_FLAGS[country] || '🌍'}))
    .sort((a, b) => b.count - a.count);

  const devices: DeviceData[] = Array.from(deviceMap.entries())
    .map(([device, count]) => ({
      device,
      count,
      pct: totalEvents > 0 ? parseFloat(((count / totalEvents) * 100).toFixed(1)) : 0}))
    .sort((a, b) => b.count - a.count);

  const eventBreakdown: EventData[] = Array.from(eventMap.entries())
    .map(([event, count]) => ({
      event,
      count,
      pct: totalEvents > 0 ? parseFloat(((count / totalEvents) * 100).toFixed(1)) : 0}))
    .sort((a, b) => b.count - a.count);

  const conversionRate = totalSessions > 0 ? parseFloat(((formSubmits / totalSessions) * 100).toFixed(1)) : 0;

  const hourlyMap = new Map<number, number>();
  for (let h = 0; h < 24; h++) hourlyMap.set(h, 0);
  events.forEach(e => {
    const hour = new Date(e.created_at).getHours();
    hourlyMap.set(hour, (hourlyMap.get(hour) || 0) + 1);
  });
  const peakHour = Array.from(hourlyMap.entries()).reduce((max, [h, c]) => c > max[1] ? [h, c] : max, [0, 0])[0];

  const now = Date.now();
  const fiveMinAgo = now - 5 * 60 * 1000;
  let activeNow = 0;
  sessionMap.forEach((sessEvents) => {
    const lastTime = Math.max(...sessEvents.map(e => new Date(e.created_at).getTime()));
    if (lastTime > fiveMinAgo) activeNow++;
  });

  return {
    totalSessions,
    totalEvents,
    formSubmits,
    conversionRate,
    sources,
    geo,
    devices,
    eventBreakdown,
    peakHour,
    activeNow,
    totalWithGeo};
}

export default function TrafficControlCenter() {
  // Realtime: invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<PeriodType>('all');
  const [activeTab, setActiveTab] = useState<TabType>('sources');

  const trafficQuery = useQuery({
    queryKey: ['admin.traffic-control', { period }],
    queryFn: async () => {
      console.log('[TrafficControl] Fetching real data for period:', period);
      const rawEvents = await fetchRawEvents(period);
      console.log('[TrafficControl] Got', rawEvents.length, 'real events from Supabase');
      const data = computeTrafficData(rawEvents);
      console.log('[TrafficControl] Computed:', data.totalSessions, 'sessions,', data.totalEvents, 'events,', data.sources.length, 'sources');
      return data;
    },
    staleTime: 30000,
    refetchInterval: 120000,
    retry: 2,
    refetchOnMount: true,
    throwOnError: false});

  const data = trafficQuery.data;
  const isLoading = trafficQuery.isLoading && !data;

  const [manualRefreshing, setManualRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setManualRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['admin.traffic-control'] });
    setManualRefreshing(false);
  }, [queryClient]);

  const TABS: { key: TabType; label: string; icon: typeof BarChart3 }[] = [
    { key: 'sources', label: 'Sources', icon: BarChart3 },
    { key: 'geo', label: 'Geo', icon: Globe },
    { key: 'devices', label: 'Devices', icon: Smartphone },
    { key: 'events', label: 'Events', icon: Activity },
  ];

  const renderEmpty = () => (
    <View style={styles.emptyCard}>
      <AlertTriangle size={32} color={Colors.textTertiary} />
      <Text style={styles.emptyText}>No Traffic Data Yet</Text>
      <Text style={styles.emptySubText}>
        All data shown here comes from real Supabase events. Visit the landing page to generate tracking events.
      </Text>
    </View>
  );

  const renderSources = () => {
    if (!data) return null;
    if (data.sources.length === 0) return renderEmpty();

    const maxSessions = Math.max(...data.sources.map(s => s.sessions), 1);

    return (
      <View style={styles.tabContent}>
        {data.sources.map((source) => (
          <View key={source.name} style={styles.sourceCard}>
            <View style={styles.sourceHeader}>
              <View style={[styles.sourceIcon, { backgroundColor: source.color + '20' }]}>
                <Text style={[styles.sourceIconText, { color: source.color }]}>
                  {source.name.charAt(0)}
                </Text>
              </View>
              <View style={styles.sourceInfo}>
                <Text style={styles.sourceName}>{source.name}</Text>
                <View style={styles.sourceMetrics}>
                  <View style={styles.sourceMetric}>
                    <Users size={11} color={Colors.textTertiary} />
                    <Text style={styles.sourceMetricText}>{formatNumber(source.sessions)} sessions</Text>
                  </View>
                  <View style={styles.sourceMetric}>
                    <Activity size={11} color={Colors.textTertiary} />
                    <Text style={styles.sourceMetricText}>{formatNumber(source.events)} events</Text>
                  </View>
                  {source.conversionRate > 0 && (
                    <View style={styles.sourceMetric}>
                      <Target size={11} color={Colors.positive} />
                      <Text style={[styles.sourceMetricText, { color: Colors.positive }]}>{source.conversionRate}%</Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
            <View style={styles.sourceBarWrap}>
              <View style={[styles.sourceBarFill, {
                width: `${Math.max((source.sessions / maxSessions) * 100, 3)}%` as any,
                backgroundColor: source.color}]} />
            </View>
          </View>
        ))}
      </View>
    );
  };

  const renderGeo = () => {
    if (!data) return null;
    if (data.geo.length === 0) return renderEmpty();

    return (
      <View style={styles.tabContent}>
        <View style={styles.geoHeader}>
          <MapPin size={16} color={Colors.primary} />
          <Text style={styles.geoHeaderText}>{data.totalWithGeo} events with geo data</Text>
        </View>
        {data.geo.slice(0, 20).map((g, i) => (
          <View key={g.country} style={styles.geoRow}>
            <Text style={styles.geoRank}>{i + 1}</Text>
            <Text style={styles.geoFlag}>{g.flag}</Text>
            <View style={styles.geoInfo}>
              <Text style={styles.geoCountry}>{g.country}</Text>
              <View style={styles.geoBarWrap}>
                <View style={[styles.geoBarFill, {
                  width: `${Math.max(g.pct, 2)}%` as any,
                  backgroundColor: i === 0 ? Colors.primary : '#4A90D9'}]} />
              </View>
            </View>
            <View style={styles.geoStats}>
              <Text style={styles.geoCount}>{formatNumber(g.count)}</Text>
              <Text style={styles.geoPct}>{g.pct}%</Text>
            </View>
          </View>
        ))}
      </View>
    );
  };

  const renderDevices = () => {
    if (!data) return null;
    if (data.devices.length === 0) return renderEmpty();

    const deviceIcons: Record<string, React.ReactNode> = {
      'Desktop': <Monitor size={20} color="#4A90D9" />,
      'Mobile': <Smartphone size={20} color="#00C48C" />,
      'Tablet': <Tablet size={20} color="#F57C00" />,
      'Unknown': <Globe size={20} color={Colors.textTertiary} />};

    const deviceColors: Record<string, string> = {
      'Desktop': '#4A90D9',
      'Mobile': '#00C48C',
      'Tablet': '#F57C00',
      'Unknown': '#666'};

    return (
      <View style={styles.tabContent}>
        <View style={styles.deviceGrid}>
          {data.devices.map((d) => (
            <View key={d.device} style={styles.deviceCard}>
              <View style={[styles.deviceIconWrap, { backgroundColor: (deviceColors[d.device] || '#666') + '15' }]}>
                {deviceIcons[d.device] || <Globe size={20} color={Colors.textTertiary} />}
              </View>
              <Text style={styles.deviceValue}>{formatNumber(d.count)}</Text>
              <Text style={styles.deviceLabel}>{d.device}</Text>
              <Text style={[styles.devicePct, { color: deviceColors[d.device] || '#666' }]}>{d.pct}%</Text>
            </View>
          ))}
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Device Distribution</Text>
          {data.devices.map((d) => {
            const color = deviceColors[d.device] || '#666';
            return (
              <View key={d.device} style={styles.distRow}>
                <Text style={styles.distLabel}>{d.device}</Text>
                <View style={styles.distBarWrap}>
                  <View style={[styles.distBarFill, {
                    width: `${Math.max(d.pct, 2)}%` as any,
                    backgroundColor: color}]} />
                </View>
                <Text style={styles.distValue}>{d.pct}%</Text>
              </View>
            );
          })}
        </View>
      </View>
    );
  };

  const renderEvents = () => {
    if (!data) return null;
    if (data.eventBreakdown.length === 0) return renderEmpty();

    const maxCount = Math.max(...data.eventBreakdown.map(e => e.count), 1);

    return (
      <View style={styles.tabContent}>
        <View style={styles.eventHeader}>
          <Layers size={16} color={Colors.primary} />
          <Text style={styles.eventHeaderText}>{formatNumber(data.totalEvents)} total events</Text>
        </View>
        {data.eventBreakdown.slice(0, 25).map((ev, evIdx) => (
          <View key={ev.event} style={styles.eventRow}>
            <View style={styles.eventInfo}>
              <Text style={styles.eventName} numberOfLines={1}>{ev.event}</Text>
              <View style={styles.eventBarWrap}>
                <View style={[styles.eventBarFill, {
                  width: `${Math.max((ev.count / maxCount) * 100, 2)}%` as any,
                  backgroundColor: SOURCE_COLORS[evIdx % SOURCE_COLORS.length] ?? '#666'}]} />
              </View>
            </View>
            <View style={styles.eventStats}>
              <Text style={styles.eventCount}>{formatNumber(ev.count)}</Text>
              <Text style={styles.eventPct}>{ev.pct}%</Text>
            </View>
          </View>
        ))}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} testID="back-btn">
          <ArrowLeft size={20} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Traffic Control</Text>
          <Text style={styles.headerSubtitle}>Real-time Supabase data</Text>
        </View>
        <TouchableOpacity style={styles.refreshBtn} onPress={onRefresh} testID="refresh-btn">
          <RefreshCw size={18} color={Colors.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.periodBar}>
        {PERIODS.map(p => (
          <TouchableOpacity
            key={p.value}
            style={[styles.periodBtn, period === p.value && styles.periodBtnActive]}
            onPress={() => setPeriod(p.value)}
          >
            <Text style={[styles.periodText, period === p.value && styles.periodTextActive]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {data && (
        <View style={styles.heroMetrics}>
          <View style={[styles.heroCard, { borderLeftColor: '#4A90D9', borderLeftWidth: 3 }]}>
            <Eye size={16} color="#4A90D9" />
            <Text style={styles.heroValue}>{formatNumber(data.totalSessions)}</Text>
            <Text style={styles.heroLabel}>Sessions</Text>
          </View>
          <View style={[styles.heroCard, { borderLeftColor: Colors.positive, borderLeftWidth: 3 }]}>
            <Target size={16} color={Colors.positive} />
            <Text style={styles.heroValue}>{formatNumber(data.formSubmits)}</Text>
            <Text style={styles.heroLabel}>Conversions</Text>
          </View>
          <View style={[styles.heroCard, { borderLeftColor: Colors.primary, borderLeftWidth: 3 }]}>
            <TrendingUp size={16} color={Colors.primary} />
            <Text style={styles.heroValue}>{data.conversionRate}%</Text>
            <Text style={styles.heroLabel}>CVR</Text>
          </View>
          <View style={[styles.heroCard, { borderLeftColor: '#7B61FF', borderLeftWidth: 3 }]}>
            <Activity size={16} color="#7B61FF" />
            <Text style={styles.heroValue}>{formatNumber(data.totalEvents)}</Text>
            <Text style={styles.heroLabel}>Events</Text>
          </View>
        </View>
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabBar}
        contentContainerStyle={styles.tabBarContent}
      >
        {TABS.map(tab => {
          const IconComp = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tab, isActive && styles.tabActive]}
              onPress={() => setActiveTab(tab.key)}
            >
              <IconComp size={15} color={isActive ? Colors.black : Colors.textSecondary} />
              <Text style={[styles.tabText, isActive && styles.tabTextActive]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.contentPadding}
        refreshControl={
          <RefreshControl refreshing={manualRefreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
      >
        {isLoading ? (
          <View style={styles.loadingWrap}>
            <ShimmerIndicator size="large" color={Colors.primary} />
            <Text style={styles.loadingText}>Loading real traffic data...</Text>
          </View>
        ) : trafficQuery.isError && !data ? (
          <View style={styles.loadingWrap}>
            <AlertTriangle size={40} color={Colors.error} />
            <Text style={styles.loadingText}>Failed to load traffic data</Text>
            <Text style={styles.loadingSubText}>{trafficQuery.error?.message || 'Pull down to retry'}</Text>
          </View>
        ) : (
          <>
            {activeTab === 'sources' && renderSources()}
            {activeTab === 'geo' && renderGeo()}
            {activeTab === 'devices' && renderDevices()}
            {activeTab === 'events' && renderEvents()}
          </>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12},
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center'},
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  headerSubtitle: { fontSize: 11, color: Colors.positive, fontWeight: '600' as const, marginTop: 1 },
  refreshBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center'},

  periodBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 6},
  periodBtn: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 16,
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border},
  periodBtnActive: { backgroundColor: Colors.primary + '20', borderColor: Colors.primary },
  periodText: { fontSize: 12, fontWeight: '600' as const, color: Colors.textTertiary },
  periodTextActive: { color: Colors.primary },

  heroMetrics: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8},
  heroCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 4},
  heroValue: { fontSize: 16, fontWeight: '800' as const, color: Colors.text },
  heroLabel: { fontSize: 10, color: Colors.textSecondary },

  tabBar: { maxHeight: 52, borderBottomWidth: 1, borderBottomColor: Colors.border },
  tabBarContent: { paddingHorizontal: 12, paddingVertical: 8, gap: 6 },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.surface},
  tabActive: { backgroundColor: Colors.primary },
  tabText: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary },
  tabTextActive: { color: Colors.black },

  content: { flex: 1 },
  contentPadding: { padding: 16 },
  tabContent: { gap: 10 },

  loadingWrap: { alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 12 },
  loadingText: { fontSize: 16, fontWeight: '600' as const, color: Colors.text },
  loadingSubText: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center' as const },

  emptyCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.border},
  emptyText: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  emptySubText: { fontSize: 12, color: Colors.textSecondary, textAlign: 'center' as const, lineHeight: 18 },

  sourceCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10},
  sourceHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sourceIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center'},
  sourceIconText: { fontSize: 16, fontWeight: '800' as const },
  sourceInfo: { flex: 1 },
  sourceName: { fontSize: 14, fontWeight: '600' as const, color: Colors.text, marginBottom: 4 },
  sourceMetrics: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  sourceMetric: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  sourceMetricText: { fontSize: 11, color: Colors.textTertiary },
  sourceBarWrap: { height: 6, backgroundColor: Colors.surfaceBorder, borderRadius: 3, overflow: 'hidden' },
  sourceBarFill: { height: 6, borderRadius: 3 },

  geoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border},
  geoHeaderText: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary },

  geoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border + '40'},
  geoRank: { fontSize: 12, fontWeight: '700' as const, color: Colors.textTertiary, width: 20, textAlign: 'center' as const },
  geoFlag: { fontSize: 20 },
  geoInfo: { flex: 1 },
  geoCountry: { fontSize: 13, fontWeight: '600' as const, color: Colors.text, marginBottom: 4 },
  geoBarWrap: { height: 4, backgroundColor: Colors.surfaceBorder, borderRadius: 2, overflow: 'hidden' },
  geoBarFill: { height: 4, borderRadius: 2 },
  geoStats: { alignItems: 'flex-end' },
  geoCount: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  geoPct: { fontSize: 10, color: Colors.textTertiary },

  deviceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  deviceCard: {
    flex: 1,
    minWidth: 100,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 6},
  deviceIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center'},
  deviceValue: { fontSize: 20, fontWeight: '800' as const, color: Colors.text },
  deviceLabel: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary },
  devicePct: { fontSize: 11, fontWeight: '700' as const },

  sectionCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginTop: 4},
  sectionTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.text, marginBottom: 14 },

  distRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  distLabel: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary, width: 60 },
  distBarWrap: { flex: 1, height: 10, backgroundColor: Colors.surfaceBorder, borderRadius: 5, overflow: 'hidden' },
  distBarFill: { height: 10, borderRadius: 5 },
  distValue: { fontSize: 12, fontWeight: '700' as const, color: Colors.text, width: 40, textAlign: 'right' as const },

  eventHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border},
  eventHeaderText: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary },

  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border + '40'},
  eventInfo: { flex: 1 },
  eventName: { fontSize: 12, fontWeight: '600' as const, color: Colors.text, marginBottom: 4 },
  eventBarWrap: { height: 4, backgroundColor: Colors.surfaceBorder, borderRadius: 2, overflow: 'hidden' },
  eventBarFill: { height: 4, borderRadius: 2 },
  eventStats: { alignItems: 'flex-end' },
  eventCount: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  eventPct: { fontSize: 10, color: Colors.textTertiary }});
