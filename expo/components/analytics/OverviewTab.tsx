import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import {
  Eye, Users, TrendingUp, Clock, Globe, Smartphone,
  Zap, ArrowUpRight, LogIn, Activity, Building2,
  Search, MousePointerClick, UserPlus} from 'lucide-react-native';
import Colors from '@/constants/colors';
import type { TrendDelta } from '@/lib/analytics-compute';
import type { LivePresenceState } from '@/lib/realtime-presence';
import {
  ACCENT, BLUE, GREEN, TEAL, ORANGE, PURPLE, CHART_COLORS,
  AnimatedRing, MiniSparkBar, AnimatedCounter, PulseIndicator,
  renderTrendBadge, shared} from './analytics-shared';

interface AnalyticsData {
  pageViews: number;
  uniqueSessions: number;
  totalLeads: number;
  registeredUsers: number;
  waitlistLeads: number;
  conversionRate: number;
  topScreens: Array<{ screen: string; views: number; uniqueSessions: number; avgTimeSpent: number; totalTimeSpent: number; pct: number; lastViewed: string }>;
  topActions: Array<{ action: string; count: number; uniqueSessions: number; avgTimeSpent: number; pct: number; lastTriggered: string }>;
  timeSpent: { totalTrackedSeconds: number; avgSessionSeconds: number; avgScreenSeconds: number; maxSessionSeconds: number; engagedSessions: number };
  funnel: {
    pageViews: number;
    scroll75: number;
    formSubmits: number;
    scroll25: number;
    scroll50: number;
    scroll100: number;
    formFocuses: number;
  };
  cta: { getStarted: number; signIn: number; jvInquire: number; websiteClick: number };
  dailyViews: Array<{ date: string; views: number; sessions: number }>;
  hourlyActivity: Array<{ hour: number; count: number }>;
  byEvent: Array<{ event: string; count: number }>;
  trends: {
    pageViews: TrendDelta;
    sessions: TrendDelta;
    leads: TrendDelta;
    conversionRate: TrendDelta;
  };
}

interface OverviewTabProps {
  data: AnalyticsData;
  presenceState: LivePresenceState;
  onSwitchToLive: () => void;
}

export function OverviewTab({ data, presenceState, onSwitchToLive }: OverviewTabProps) {
  const convPct = parseFloat(String(data.conversionRate)) || 0;
  const totalViews = data.pageViews;
  const totalUnique = data.uniqueSessions;
  const totalRegistrations = data.funnel.formSubmits;
  const totalLeads = data.totalLeads ?? totalRegistrations;
  const registeredUsers = data.registeredUsers ?? 0;
  const waitlistLeads = data.waitlistLeads ?? 0;

  const hourlyData = useMemo(() => data.hourlyActivity.map(h => h.count), [data]);
  const dailyData = useMemo(() => data.dailyViews.slice(-14).map(d => d.views), [data]);

  return (
    <>
      {presenceState.isConnected && (
        <TouchableOpacity
          style={s.livePresenceBanner}
          onPress={onSwitchToLive}
          activeOpacity={0.7}
        >
          <PulseIndicator active={presenceState.totalOnline > 0} />
          <Text style={s.livePresenceBannerCount}>{presenceState.totalOnline}</Text>
          <Text style={s.livePresenceBannerLabel}>online now</Text>
          <View style={s.livePresenceBannerBreak} />
          <Globe size={11} color={TEAL} />
          <Text style={s.livePresenceBannerSub}>{presenceState.landingOnline}</Text>
          <Smartphone size={11} color={PURPLE} />
          <Text style={s.livePresenceBannerSub}>{presenceState.appOnline}</Text>
          <View style={{ flex: 1 }} />
          <Text style={s.livePresenceBannerTap}>View Live →</Text>
        </TouchableOpacity>
      )}

      <View style={s.leadsHero}>
        <View style={s.leadsHeroIconWrap}>
          <Users size={28} color="#fff" />
        </View>
        <View style={s.leadsHeroContent}>
          <Text style={s.leadsHeroLabel}>TOTAL LEADS</Text>
          <AnimatedCounter value={totalLeads} />
        </View>
        <View style={s.leadsBreakdown}>
          <View style={s.leadsBreakdownItem}>
            <View style={[s.leadsBreakdownDot, { backgroundColor: GREEN }]} />
            <Text style={s.leadsBreakdownText}>{registeredUsers} Registered</Text>
          </View>
          <View style={s.leadsBreakdownItem}>
            <View style={[s.leadsBreakdownDot, { backgroundColor: ORANGE }]} />
            <Text style={s.leadsBreakdownText}>{waitlistLeads} Waitlist</Text>
          </View>
        </View>
        <View style={s.leadsLiveBadge}>
          <View style={s.leadsLiveDot} />
          <Text style={s.leadsLiveText}>Real-time</Text>
        </View>
      </View>

      <View style={s.heroMetrics}>
        <View style={s.heroMetricMain}>
          <View style={s.heroMetricHeader}>
            <Eye size={18} color={BLUE} />
            <Text style={s.heroMetricLabel}>Total Views</Text>
            {renderTrendBadge(data.trends?.pageViews)}
          </View>
          <AnimatedCounter value={totalViews} />
        </View>
        <View style={s.heroMetricDivider} />
        <View style={s.heroMetricMain}>
          <View style={s.heroMetricHeader}>
            <Users size={18} color={PURPLE} />
            <Text style={s.heroMetricLabel}>Visitors</Text>
            {renderTrendBadge(data.trends?.sessions)}
          </View>
          <AnimatedCounter value={totalUnique} />
        </View>
      </View>

      <View style={s.ringRow}>
        <View style={s.ringCard}>
          <AnimatedRing percent={convPct} size={90} strokeWidth={8} color={GREEN}>
            <Text style={s.ringValue}>{convPct}%</Text>
            <Text style={s.ringLabel}>CVR</Text>
          </AnimatedRing>
          <Text style={s.ringCardLabel}>Conversion Rate</Text>
        </View>
        <View style={s.ringCard}>
          <AnimatedRing
            percent={data.funnel.pageViews > 0 ? Math.min(Math.round((data.funnel.scroll75 / data.funnel.pageViews) * 100), 100) : 0}
            size={90} strokeWidth={8} color={PURPLE}
          >
            <Text style={s.ringValue}>
              {data.funnel.pageViews > 0 ? Math.round((data.funnel.scroll75 / data.funnel.pageViews) * 100) : 0}%
            </Text>
            <Text style={s.ringLabel}>Depth</Text>
          </AnimatedRing>
          <Text style={s.ringCardLabel}>Scroll Depth</Text>
        </View>
        <View style={s.ringCard}>
          <AnimatedRing percent={Math.min(totalRegistrations * 5, 100)} size={90} strokeWidth={8} color={ACCENT}>
            <Text style={s.ringValue}>{totalRegistrations}</Text>
            <Text style={s.ringLabel}>Signups</Text>
          </AnimatedRing>
          <Text style={s.ringCardLabel}>Registrations</Text>
        </View>
      </View>

      <View style={shared.card}>
        <View style={shared.cardHeader}>
          <TrendingUp size={16} color={GREEN} />
          <Text style={shared.cardTitle}>Traffic Growth</Text>
          {renderTrendBadge(data.trends?.pageViews)}
        </View>
        <View style={s.growthGrid}>
          <View style={[s.growthItem, { borderLeftColor: GREEN }]}>
            <Text style={s.growthItemValue}>{totalViews.toLocaleString()}</Text>
            <Text style={s.growthItemLabel}>Total Views</Text>
            {renderTrendBadge(data.trends?.pageViews)}
          </View>
          <View style={[s.growthItem, { borderLeftColor: BLUE }]}>
            <Text style={s.growthItemValue}>{totalUnique.toLocaleString()}</Text>
            <Text style={s.growthItemLabel}>Unique Visitors</Text>
            {renderTrendBadge(data.trends?.sessions)}
          </View>
          <View style={[s.growthItem, { borderLeftColor: PURPLE }]}>
            <Text style={s.growthItemValue}>{totalLeads.toLocaleString()}</Text>
            <Text style={s.growthItemLabel}>Investor Signups</Text>
            {renderTrendBadge(data.trends?.leads)}
          </View>
          <View style={[s.growthItem, { borderLeftColor: ORANGE }]}>
            <Text style={s.growthItemValue}>{convPct}%</Text>
            <Text style={s.growthItemLabel}>Conversion Rate</Text>
            {renderTrendBadge(data.trends?.conversionRate)}
          </View>
        </View>
      </View>

      <View style={shared.card}>
        <View style={shared.cardHeader}>
          <Building2 size={16} color={TEAL} />
          <Text style={shared.cardTitle}>Property Engagement</Text>
        </View>
        <View style={s.engagementGrid}>
          <View style={s.engagementItem}>
            <View style={[s.engagementIconWrap, { backgroundColor: BLUE + '15' }]}>
              <Eye size={18} color={BLUE} />
            </View>
            <Text style={s.engagementValue}>{data.funnel.pageViews}</Text>
            <Text style={s.engagementLabel}>Page Views</Text>
          </View>
          <View style={s.engagementItem}>
            <View style={[s.engagementIconWrap, { backgroundColor: GREEN + '15' }]}>
              <MousePointerClick size={18} color={GREEN} />
            </View>
            <Text style={s.engagementValue}>{data.cta.getStarted + data.cta.jvInquire}</Text>
            <Text style={s.engagementLabel}>CTA Clicks</Text>
          </View>
          <View style={s.engagementItem}>
            <View style={[s.engagementIconWrap, { backgroundColor: ORANGE + '15' }]}>
              <Search size={18} color={ORANGE} />
            </View>
            <Text style={s.engagementValue}>{data.funnel.scroll75}</Text>
            <Text style={s.engagementLabel}>Deep Scrolls</Text>
          </View>
          <View style={s.engagementItem}>
            <View style={[s.engagementIconWrap, { backgroundColor: PURPLE + '15' }]}>
              <UserPlus size={18} color={PURPLE} />
            </View>
            <Text style={s.engagementValue}>{data.funnel.formSubmits}</Text>
            <Text style={s.engagementLabel}>Form Submits</Text>
          </View>
        </View>
      </View>

      <View style={shared.card}>
        <View style={shared.cardHeader}>
          <Clock size={16} color={ACCENT} />
          <Text style={shared.cardTitle}>Screen & Click Breakdown</Text>
          <Text style={shared.cardSubtitle}>{data.timeSpent?.totalTrackedSeconds ?? 0}s tracked</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
          <View style={{ flex: 1, backgroundColor: Colors.backgroundSecondary, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: Colors.surfaceBorder }}>
            <Text style={{ fontSize: 11, color: Colors.textSecondary, fontWeight: '700' as const }}>Avg Session</Text>
            <Text style={{ fontSize: 22, color: Colors.text, fontWeight: '900' as const, marginTop: 6 }}>{data.timeSpent?.avgSessionSeconds ?? 0}s</Text>
          </View>
          <View style={{ flex: 1, backgroundColor: Colors.backgroundSecondary, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: Colors.surfaceBorder }}>
            <Text style={{ fontSize: 11, color: Colors.textSecondary, fontWeight: '700' as const }}>Engaged Sessions</Text>
            <Text style={{ fontSize: 22, color: Colors.text, fontWeight: '900' as const, marginTop: 6 }}>{data.timeSpent?.engagedSessions ?? 0}</Text>
          </View>
        </View>
        <View style={{ gap: 10 }}>
          <Text style={{ fontSize: 12, color: Colors.textSecondary, fontWeight: '800' as const, textTransform: 'uppercase' as const }}>Most viewed screens</Text>
          {(data.topScreens ?? []).slice(0, 5).map((screen, index) => (
            <View key={`${screen.screen}-${index}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.backgroundSecondary, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: Colors.surfaceBorder }}>
              <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: BLUE + '18', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: BLUE, fontSize: 11, fontWeight: '800' as const }}>{index + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: Colors.text, fontSize: 13, fontWeight: '700' as const }} numberOfLines={1}>{screen.screen}</Text>
                <Text style={{ color: Colors.textSecondary, fontSize: 11, marginTop: 2 }}>{screen.views} views · {screen.avgTimeSpent}s avg · {screen.uniqueSessions} sessions</Text>
              </View>
              <Text style={{ color: ACCENT, fontSize: 12, fontWeight: '800' as const }}>{screen.pct}%</Text>
            </View>
          ))}
          {(data.topScreens ?? []).length === 0 && <Text style={shared.noDataText}>No screen view breakdown yet.</Text>}
        </View>
        <View style={{ gap: 10, marginTop: 14 }}>
          <Text style={{ fontSize: 12, color: Colors.textSecondary, fontWeight: '800' as const, textTransform: 'uppercase' as const }}>Most clicked functionality</Text>
          {(data.topActions ?? []).slice(0, 5).map((action, index) => (
            <View key={`${action.action}-${index}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.backgroundSecondary, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: Colors.surfaceBorder }}>
              <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: GREEN + '18', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: GREEN, fontSize: 11, fontWeight: '800' as const }}>{index + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: Colors.text, fontSize: 13, fontWeight: '700' as const }} numberOfLines={1}>{action.action}</Text>
                <Text style={{ color: Colors.textSecondary, fontSize: 11, marginTop: 2 }}>{action.count} clicks · {action.uniqueSessions} sessions · {action.avgTimeSpent}s avg</Text>
              </View>
              <Text style={{ color: GREEN, fontSize: 12, fontWeight: '800' as const }}>{action.pct}%</Text>
            </View>
          ))}
          {(data.topActions ?? []).length === 0 && <Text style={shared.noDataText}>No click breakdown yet.</Text>}
        </View>
      </View>

      {dailyData.length > 0 && (
        <View style={shared.card}>
          <View style={shared.cardHeader}>
            <TrendingUp size={16} color={GREEN} />
            <Text style={shared.cardTitle}>Daily Traffic</Text>
            <View style={shared.cardBadge}>
              <Text style={shared.cardBadgeText}>{data.dailyViews.length}d</Text>
            </View>
          </View>
          <MiniSparkBar data={dailyData} color={BLUE} height={56} />
          <View style={shared.sparkLabelRow}>
            <Text style={shared.sparkLabel}>{data.dailyViews.slice(-14)[0]?.date?.slice(5) || ''}</Text>
            <Text style={shared.sparkLabel}>Today</Text>
          </View>
        </View>
      )}

      {hourlyData.length > 0 && (
        <View style={shared.card}>
          <View style={shared.cardHeader}>
            <Clock size={16} color={PURPLE} />
            <Text style={shared.cardTitle}>Hourly Heatmap</Text>
          </View>
          <View style={s.heatmapGrid}>
            {hourlyData.map((count: number, i: number) => {
              const max = Math.max(...hourlyData, 1);
              const intensity = count / max;
              const bgColor = count === 0 ? Colors.backgroundSecondary : `rgba(74, 144, 217, ${0.15 + intensity * 0.85})`;
              return (
                <View key={i} style={[s.heatmapCell, { backgroundColor: bgColor }]}>
                  <Text style={[s.heatmapHour, count > 0 && { color: '#fff' }]}>{i}</Text>
                  {count > 0 && <Text style={s.heatmapCount}>{count}</Text>}
                </View>
              );
            })}
          </View>
        </View>
      )}

      <View style={shared.card}>
        <View style={shared.cardHeader}>
          <Zap size={16} color={ORANGE} />
          <Text style={shared.cardTitle}>CTA Performance</Text>
        </View>
        <View style={s.ctaGrid}>
          {[
            { label: 'Get Started', count: data.cta.getStarted, icon: <ArrowUpRight size={16} color={GREEN} />, color: GREEN },
            { label: 'Sign In', count: data.cta.signIn, icon: <LogIn size={16} color={BLUE} />, color: BLUE },
            { label: 'JV Inquire', count: data.cta.jvInquire, icon: <TrendingUp size={16} color={ORANGE} />, color: ORANGE },
            { label: 'Website', count: data.cta.websiteClick, icon: <Globe size={16} color={PURPLE} />, color: PURPLE },
          ].map((cta, i) => (
            <View key={i} style={s.ctaCard}>
              <View style={[s.ctaIconBg, { backgroundColor: cta.color + '18' }]}>
                {cta.icon}
              </View>
              <Text style={s.ctaValue}>{cta.count}</Text>
              <Text style={s.ctaLabel}>{cta.label}</Text>
              <View style={[s.ctaBar, { backgroundColor: cta.color + '15' }]}>
                <View style={[s.ctaBarFill, {
                  width: `${Math.max(Math.min((cta.count / Math.max(data.cta.getStarted, 1)) * 100, 100), 5)}%` as any,
                  backgroundColor: cta.color}]} />
              </View>
            </View>
          ))}
        </View>
      </View>

      <View style={shared.card}>
        <View style={shared.cardHeader}>
          <Activity size={16} color={BLUE} />
          <Text style={shared.cardTitle}>Event Stream</Text>
          <Text style={shared.cardSubtitle}>{data.byEvent.length} events</Text>
        </View>
        {data.byEvent.slice(0, 10).map((evt, i) => {
          const maxEvt = data.byEvent[0]?.count || 1;
          const barPct = Math.round((evt.count / maxEvt) * 100);
          return (
            <View key={i} style={s.eventRow}>
              <View style={[s.eventRank, { backgroundColor: CHART_COLORS[i % CHART_COLORS.length] + '18' }]}>
                <Text style={[s.eventRankText, { color: CHART_COLORS[i % CHART_COLORS.length] }]}>{i + 1}</Text>
              </View>
              <View style={s.eventInfo}>
                <Text style={s.eventName} numberOfLines={1}>{evt.event.replace(/_/g, ' ')}</Text>
                <View style={s.eventBarBg}>
                  <View style={[s.eventBar, { width: `${Math.max(barPct, 4)}%` as any, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }]} />
                </View>
              </View>
              <Text style={s.eventCount}>{evt.count}</Text>
            </View>
          );
        })}
        {data.byEvent.length === 0 && (
          <Text style={shared.noDataText}>No events tracked yet.</Text>
        )}
      </View>
    </>
  );
}

const s = StyleSheet.create({
  livePresenceBanner: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    backgroundColor: '#00C48C10', borderWidth: 1, borderColor: '#00C48C25',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 12, gap: 6},
  livePresenceBannerCount: { fontSize: 18, fontWeight: '900' as const, color: '#00C48C', marginRight: 2 },
  livePresenceBannerLabel: { fontSize: 12, fontWeight: '600' as const, color: '#00C48C', marginRight: 4 },
  livePresenceBannerBreak: { width: 1, height: 14, backgroundColor: '#00C48C30', marginHorizontal: 4 },
  livePresenceBannerSub: { fontSize: 11, fontWeight: '700' as const, color: Colors.textSecondary, marginRight: 2 },
  livePresenceBannerTap: { fontSize: 10, fontWeight: '700' as const, color: '#00C48C', letterSpacing: 0.3 },
  leadsHero: { backgroundColor: '#0A1628', borderRadius: 22, padding: 22, marginBottom: 16, borderWidth: 1, borderColor: '#1B365D', gap: 12 },
  leadsHeroIconWrap: { position: 'absolute', top: 18, right: 18, width: 52, height: 52, borderRadius: 16, backgroundColor: '#1B365D', alignItems: 'center', justifyContent: 'center' },
  leadsHeroContent: { gap: 2 },
  leadsHeroLabel: { fontSize: 11, fontWeight: '800' as const, color: '#4A90D9', letterSpacing: 1.5 },
  leadsBreakdown: { flexDirection: 'row', gap: 16, marginTop: 2 },
  leadsBreakdownItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  leadsBreakdownDot: { width: 8, height: 8, borderRadius: 4 },
  leadsBreakdownText: { fontSize: 12, fontWeight: '600' as const, color: '#8BA4C4' },
  leadsLiveBadge: { position: 'absolute', bottom: 18, right: 18, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#00C48C18', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  leadsLiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#00C48C' },
  leadsLiveText: { fontSize: 10, fontWeight: '700' as const, color: '#00C48C', letterSpacing: 0.3 },
  heroMetrics: { flexDirection: 'row', backgroundColor: Colors.surface, borderRadius: 20, borderWidth: 1, borderColor: Colors.surfaceBorder, marginBottom: 16, overflow: 'hidden' },
  heroMetricMain: { flex: 1, padding: 20, alignItems: 'center', gap: 6 },
  heroMetricDivider: { width: 1, backgroundColor: Colors.surfaceBorder, marginVertical: 12 },
  heroMetricHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroMetricLabel: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary },
  ringRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  ringCard: { flex: 1, backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1, borderColor: Colors.surfaceBorder, padding: 14, alignItems: 'center', gap: 8 },
  ringValue: { fontSize: 18, fontWeight: '900' as const, color: Colors.text },
  ringLabel: { fontSize: 9, fontWeight: '600' as const, color: Colors.textTertiary, letterSpacing: 0.5 },
  ringCardLabel: { fontSize: 11, fontWeight: '600' as const, color: Colors.textSecondary },
  growthGrid: { gap: 10, marginBottom: 4 },
  growthItem: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.backgroundSecondary, borderRadius: 12, padding: 14, borderLeftWidth: 4, borderWidth: 1, borderColor: Colors.surfaceBorder },
  growthItemValue: { fontSize: 20, fontWeight: '900' as const, color: Colors.text, minWidth: 70 },
  growthItemLabel: { flex: 1, fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary },
  engagementGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  engagementItem: { flex: 1, minWidth: '43%' as any, backgroundColor: Colors.backgroundSecondary, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.surfaceBorder, alignItems: 'center', gap: 8 },
  engagementIconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  engagementValue: { fontSize: 22, fontWeight: '900' as const, color: Colors.text },
  engagementLabel: { fontSize: 10, fontWeight: '600' as const, color: Colors.textSecondary, textAlign: 'center' as const },
  heatmapGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  heatmapCell: { width: (Dimensions.get('window').width - 80) / 12 - 4, aspectRatio: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  heatmapHour: { fontSize: 8, fontWeight: '700' as const, color: Colors.textTertiary },
  heatmapCount: { fontSize: 7, fontWeight: '800' as const, color: '#FFFFFF' },
  ctaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  ctaCard: { flex: 1, minWidth: '43%' as any, backgroundColor: Colors.backgroundSecondary, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.surfaceBorder, gap: 8 },
  ctaIconBg: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  ctaValue: { fontSize: 24, fontWeight: '900' as const, color: Colors.text },
  ctaLabel: { fontSize: 11, fontWeight: '600' as const, color: Colors.textSecondary },
  ctaBar: { height: 4, borderRadius: 2, overflow: 'hidden' },
  ctaBarFill: { height: 4, borderRadius: 2 },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  eventRank: { width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  eventRankText: { fontSize: 10, fontWeight: '800' as const },
  eventInfo: { flex: 1, gap: 4 },
  eventName: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary, textTransform: 'capitalize' as const },
  eventBarBg: { height: 4, backgroundColor: Colors.backgroundSecondary, borderRadius: 2, overflow: 'hidden' },
  eventBar: { height: 4, borderRadius: 2 },
  eventCount: { width: 40, fontSize: 13, fontWeight: '800' as const, color: Colors.text, textAlign: 'right' as const }});
