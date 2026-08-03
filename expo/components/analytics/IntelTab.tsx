import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import {
  Brain, Timer, Percent, Clock, Flame, Smartphone, Tablet,
  Monitor, Target, TrendingUp, Zap, UserMinus} from 'lucide-react-native';
import Colors from '@/constants/colors';
import {
  ACCENT, BLUE, GREEN, RED, PINK, CHART_COLORS,
  AnimatedRing, formatSeconds, shared} from './analytics-shared';

interface SmartInsights {
  avgTimeOnPage: number;
  bounceRate: number;
  engagementScore: number;
  topInterests: Array<{ interest: string; count: number; pct: number }>;
  deviceBreakdown: Array<{ device: string; count: number; pct: number }>;
  peakHour: number;
  visitorIntent: {
    highIntent: number; mediumIntent: number; lowIntent: number;
    highIntentPct: number; mediumIntentPct: number; lowIntentPct: number;
  };
}

interface IntelTabProps {
  insights: SmartInsights | null;
  uniqueSessions: number;
  funnel: { scroll75: number; formSubmits: number; scroll50: number };
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#FF3B30',
  high: '#FF9500',
  medium: '#FFD700',
  low: '#34C759'};

interface ReEngagementStrategy {
  priority: string;
  segment: string;
  strategy: string;
  expectedImpact: string;
  suggestedAction: string;
  userCount: number;
}

export function IntelTab({ insights, uniqueSessions, funnel }: IntelTabProps) {
  const engagementScore = insights?.engagementScore ?? 0;
  const bounceRate = insights?.bounceRate ?? 0;
  const engColor = engagementScore >= 60 ? GREEN : engagementScore >= 30 ? ACCENT : RED;

  const reEngagementStrategies = useMemo(() => {
    if (!insights) {
      return [] as ReEngagementStrategy[];
    }

    const strategies: ReEngagementStrategy[] = [];
    const totalUsers = uniqueSessions;
    const atRiskUsers = Math.round(totalUsers * (bounceRate / 100));
    const activeUsers = Math.max(totalUsers - atRiskUsers, 0);
    const dormantUsers = Math.max(totalUsers - activeUsers - atRiskUsers, 0);

    if (atRiskUsers > 0) {
      strategies.push({
        priority: 'high',
        segment: 'Bounced Visitors',
        strategy: 'Send targeted follow-up to visitors who left early. Consider improving landing page above-the-fold content.',
        expectedImpact: `Could recover ${Math.round(atRiskUsers * 0.15)} visitors`,
        suggestedAction: 'Launch re-engagement email campaign with exclusive content',
        userCount: atRiskUsers});
    }
    if (funnel.scroll75 > 0 && funnel.formSubmits === 0) {
      strategies.push({
        priority: 'critical',
        segment: 'Deep Scrollers Without Conversion',
        strategy: 'Visitors scrolled 75%+ but didn\'t convert. Consider adding a CTA or form at the 75% scroll point.',
        expectedImpact: `${funnel.scroll75} potential leads`,
        suggestedAction: 'Add exit-intent popup or mid-page CTA',
        userCount: funnel.scroll75});
    }
    if (dormantUsers > 0) {
      strategies.push({
        priority: 'medium',
        segment: 'Dormant Users',
        strategy: 'Users who visited but haven\'t returned. Send personalized re-engagement content.',
        expectedImpact: `Could re-engage ${Math.round(dormantUsers * 0.1)} users`,
        suggestedAction: 'Create a "We miss you" campaign with new property highlights',
        userCount: dormantUsers});
    }
    return strategies;
  }, [bounceRate, funnel.formSubmits, funnel.scroll75, insights, uniqueSessions]);

  if (!insights) {
    return (
      <View style={shared.emptyWrap}>
        <Brain size={48} color={Colors.textTertiary} />
        <Text style={shared.emptyTitle}>Loading Insights</Text>
        <Text style={shared.emptySubtitle}>Analysis will appear as more data is collected.</Text>
      </View>
    );
  }

  const atRiskUsers = Math.round(uniqueSessions * (bounceRate / 100));
  const dormantUsers = Math.max(uniqueSessions - (uniqueSessions - atRiskUsers) - atRiskUsers, 0);

  return (
    <>
      <View style={s.scoreHero}>
        <AnimatedRing percent={insights.engagementScore} size={130} strokeWidth={10} color={engColor}>
          <Text style={[s.scoreBig, { color: engColor }]}>{insights.engagementScore}</Text>
          <Text style={s.scoreUnit}>/100</Text>
        </AnimatedRing>
        <Text style={s.scoreTitle}>Engagement Score</Text>
        <Text style={s.scoreDesc}>Based on scroll depth, CTA clicks, and form submissions</Text>
      </View>

      <View style={s.insightKpiRow}>
        {[
          { icon: <Timer size={16} color={BLUE} />, value: formatSeconds(insights.avgTimeOnPage), label: 'Avg Time', color: BLUE },
          { icon: <Percent size={16} color={RED} />, value: `${insights.bounceRate}%`, label: 'Bounce', color: RED },
          { icon: <Clock size={16} color={ACCENT} />, value: `${insights.peakHour}:00`, label: 'Peak', color: ACCENT },
        ].map((kpi, i) => (
          <View key={i} style={[s.insightKpi, { borderTopColor: kpi.color }]}>
            {kpi.icon}
            <Text style={s.insightKpiValue}>{kpi.value}</Text>
            <Text style={s.insightKpiLabel}>{kpi.label}</Text>
          </View>
        ))}
      </View>

      <View style={shared.card}>
        <View style={shared.cardHeader}>
          <Flame size={16} color={RED} />
          <Text style={shared.cardTitle}>Visitor Intent</Text>
        </View>
        {[
          { label: 'High Intent', desc: 'Submitted form', count: insights.visitorIntent.highIntent, pct: insights.visitorIntent.highIntentPct, color: GREEN },
          { label: 'Medium', desc: 'Clicked CTA', count: insights.visitorIntent.mediumIntent, pct: insights.visitorIntent.mediumIntentPct, color: ACCENT },
          { label: 'Low', desc: 'Browsed only', count: insights.visitorIntent.lowIntent, pct: insights.visitorIntent.lowIntentPct, color: RED },
        ].map((intent, i) => (
          <View key={i} style={s.intentRow}>
            <View style={[s.intentDot, { backgroundColor: intent.color }]} />
            <View style={s.intentInfo}>
              <View style={s.intentTopRow}>
                <Text style={s.intentLabel}>{intent.label}</Text>
                <Text style={s.intentPctText}>{intent.pct}%</Text>
              </View>
              <View style={s.intentBarBg}>
                <View style={[s.intentBarFill, { width: `${Math.max(intent.pct, 3)}%` as any, backgroundColor: intent.color }]} />
              </View>
            </View>
            <Text style={s.intentCount}>{intent.count}</Text>
          </View>
        ))}
      </View>

      {insights.deviceBreakdown?.length > 0 && (
        <View style={shared.card}>
          <View style={shared.cardHeader}>
            <Smartphone size={16} color={PINK} />
            <Text style={shared.cardTitle}>Devices</Text>
          </View>
          <View style={s.deviceGrid}>
            {insights.deviceBreakdown.map((d, i) => (
              <View key={i} style={[s.deviceCard, { borderTopColor: CHART_COLORS[i % CHART_COLORS.length] }]}>
                {d.device === 'Mobile' ? <Smartphone size={22} color={CHART_COLORS[i % CHART_COLORS.length]} /> :
                  d.device === 'Tablet' ? <Tablet size={22} color={CHART_COLORS[i % CHART_COLORS.length]} /> :
                  <Monitor size={22} color={CHART_COLORS[i % CHART_COLORS.length]} />}
                <Text style={s.deviceCount}>{d.count}</Text>
                <Text style={s.deviceLabel}>{d.device}</Text>
                <Text style={[s.devicePct, { color: CHART_COLORS[i % CHART_COLORS.length] }]}>{d.pct}%</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {insights.topInterests?.length > 0 && (
        <View style={shared.card}>
          <View style={shared.cardHeader}>
            <Target size={16} color={GREEN} />
            <Text style={shared.cardTitle}>Investment Interest</Text>
          </View>
          {insights.topInterests.map((interest, i) => (
            <View key={i} style={shared.miniListRow}>
              <View style={[shared.miniRank, { backgroundColor: CHART_COLORS[i % CHART_COLORS.length] + '18' }]}>
                <Text style={[shared.miniRankText, { color: CHART_COLORS[i % CHART_COLORS.length] }]}>{i + 1}</Text>
              </View>
              <Text style={shared.miniLabel} numberOfLines={1}>{interest.interest.replace(/_/g, ' ')}</Text>
              <Text style={[shared.miniPct, { color: CHART_COLORS[i % CHART_COLORS.length] }]}>{interest.pct}%</Text>
              <Text style={shared.miniValue}>{interest.count}</Text>
            </View>
          ))}
        </View>
      )}

      {reEngagementStrategies.length > 0 && (
        <>
          <View style={s.reengageBanner}>
            <View style={s.reengageIconWrap}>
              <Brain size={20} color="#FFF" />
            </View>
            <View style={s.reengageContent}>
              <Text style={s.reengageTitle}>Re-Engagement Strategies</Text>
              <Text style={s.reengageSubtitle}>
                {reEngagementStrategies.length} actionable strategies identified
              </Text>
            </View>
          </View>

          {reEngagementStrategies.map((strat, i) => (
            <View key={i} style={s.strategyCard}>
              <View style={s.strategyHeader}>
                <View style={[s.priorityBadge, { backgroundColor: (PRIORITY_COLORS[strat.priority] || Colors.textSecondary) + '20' }]}>
                  <View style={[s.priorityDot, { backgroundColor: PRIORITY_COLORS[strat.priority] || Colors.textSecondary }]} />
                  <Text style={[s.priorityText, { color: PRIORITY_COLORS[strat.priority] || Colors.textSecondary }]}>
                    {strat.priority.toUpperCase()}
                  </Text>
                </View>
                <Text style={s.strategyUserCount}>{strat.userCount} users</Text>
              </View>
              <Text style={s.strategySegment}>{strat.segment}</Text>
              <Text style={s.strategyDescription}>{strat.strategy}</Text>
              <View style={s.strategyImpact}>
                <TrendingUp size={12} color={Colors.positive} />
                <Text style={s.impactText}>{strat.expectedImpact}</Text>
              </View>
              <View style={s.strategyAction}>
                <Zap size={12} color={Colors.primary} />
                <Text style={s.actionText}>{strat.suggestedAction}</Text>
              </View>
            </View>
          ))}

          <View style={shared.card}>
            <View style={shared.cardHeader}>
              <UserMinus size={16} color={Colors.negative} />
              <Text style={shared.cardTitle}>User Health Breakdown</Text>
            </View>
            <View style={s.breakdownGrid}>
              <View style={s.breakdownItem}>
                <Text style={s.breakdownValue}>{uniqueSessions}</Text>
                <Text style={s.breakdownLabel}>Total Visitors</Text>
              </View>
              <View style={s.breakdownItem}>
                <Text style={[s.breakdownValue, { color: Colors.negative }]}>{atRiskUsers}</Text>
                <Text style={s.breakdownLabel}>At Risk</Text>
              </View>
              <View style={s.breakdownItem}>
                <Text style={[s.breakdownValue, { color: Colors.warning }]}>{dormantUsers}</Text>
                <Text style={s.breakdownLabel}>Dormant</Text>
              </View>
              <View style={s.breakdownItem}>
                <Text style={[s.breakdownValue, { color: GREEN }]}>{Math.max(uniqueSessions - atRiskUsers - dormantUsers, 0)}</Text>
                <Text style={s.breakdownLabel}>Active</Text>
              </View>
            </View>
          </View>
        </>
      )}
    </>
  );
}

const s = StyleSheet.create({
  scoreHero: { backgroundColor: Colors.surface, borderRadius: 20, padding: 28, borderWidth: 1, borderColor: Colors.surfaceBorder, marginBottom: 16, alignItems: 'center', gap: 10 },
  scoreBig: { fontSize: 36, fontWeight: '900' as const, lineHeight: 40 },
  scoreUnit: { fontSize: 12, fontWeight: '600' as const, color: Colors.textTertiary },
  scoreTitle: { fontSize: 18, fontWeight: '800' as const, color: Colors.text, marginTop: 4 },
  scoreDesc: { fontSize: 12, fontWeight: '500' as const, color: Colors.textSecondary, textAlign: 'center' as const },
  insightKpiRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  insightKpi: { flex: 1, backgroundColor: Colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.surfaceBorder, borderTopWidth: 3, alignItems: 'center', gap: 6 },
  insightKpiValue: { fontSize: 18, fontWeight: '900' as const, color: Colors.text },
  insightKpiLabel: { fontSize: 10, fontWeight: '600' as const, color: Colors.textSecondary },
  intentRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  intentDot: { width: 10, height: 10, borderRadius: 5 },
  intentInfo: { flex: 1, gap: 4 },
  intentTopRow: { flexDirection: 'row', justifyContent: 'space-between' },
  intentLabel: { fontSize: 13, fontWeight: '700' as const, color: Colors.text },
  intentPctText: { fontSize: 12, fontWeight: '700' as const, color: Colors.textSecondary },
  intentBarBg: { height: 6, backgroundColor: Colors.backgroundSecondary, borderRadius: 3, overflow: 'hidden' },
  intentBarFill: { height: 6, borderRadius: 3 },
  intentCount: { width: 36, fontSize: 14, fontWeight: '800' as const, color: Colors.text, textAlign: 'right' as const },
  deviceGrid: { flexDirection: 'row', gap: 10 },
  deviceCard: { flex: 1, backgroundColor: Colors.backgroundSecondary, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.surfaceBorder, borderTopWidth: 3, alignItems: 'center', gap: 6 },
  deviceCount: { fontSize: 22, fontWeight: '900' as const, color: Colors.text },
  deviceLabel: { fontSize: 11, fontWeight: '600' as const, color: Colors.textSecondary },
  devicePct: { fontSize: 13, fontWeight: '800' as const },
  reengageBanner: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#1A0A2E',
    borderRadius: 14, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: '#2D1B4E', gap: 12},
  reengageIconWrap: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#8E44AD', justifyContent: 'center', alignItems: 'center' },
  reengageContent: { flex: 1 },
  reengageTitle: { fontSize: 15, fontWeight: '700' as const, color: '#E0B0FF' },
  reengageSubtitle: { fontSize: 12, color: '#9B72B0', marginTop: 2 },
  strategyCard: { backgroundColor: Colors.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: Colors.border },
  strategyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  priorityBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, gap: 5 },
  priorityDot: { width: 6, height: 6, borderRadius: 3 },
  priorityText: { fontSize: 10, fontWeight: '800' as const, letterSpacing: 0.5 },
  strategyUserCount: { fontSize: 12, color: Colors.textTertiary, fontWeight: '600' as const },
  strategySegment: { fontSize: 15, fontWeight: '700' as const, color: Colors.text, marginBottom: 4 },
  strategyDescription: { fontSize: 12, color: Colors.textSecondary, marginBottom: 10 },
  strategyImpact: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.positive + '10', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, marginBottom: 8 },
  impactText: { fontSize: 12, color: Colors.positive, fontWeight: '600' as const, flex: 1 },
  strategyAction: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: Colors.primary + '08', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8 },
  actionText: { fontSize: 11, color: Colors.textSecondary, flex: 1, lineHeight: 16 },
  breakdownGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  breakdownItem: { width: '47%' as any, backgroundColor: Colors.backgroundTertiary, borderRadius: 10, padding: 12, alignItems: 'center' },
  breakdownValue: { fontSize: 22, fontWeight: '700' as const, color: Colors.text, marginBottom: 2 },
  breakdownLabel: { fontSize: 11, color: Colors.textTertiary, fontWeight: '500' as const }});
