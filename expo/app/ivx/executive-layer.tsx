import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  AlertTriangle,
  Banknote,
  Bot,
  Brain,
  Briefcase,
  Building2,
    GraduationCap,
  Gauge,
  Target,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react-native';
import IVXBrandIcon from '@/components/IVXBrandIcon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import {
  getExecutiveLayer,
  type ExecutiveLayer,
  type ExecutiveMetric,
  type ExecutiveScorecard,
  type RiskLevel,
  type StrategicGoal,
} from '@/src/modules/ivx-developer/executiveLayerService';

const POLL_INTERVAL_MS = 20000;

const GRADE_COLORS: Record<string, string> = {
  A: Colors.success,
  B: Colors.success,
  C: Colors.warning,
  D: Colors.warning,
  F: Colors.error,
};

const RISK_COLORS: Record<RiskLevel, string> = {
  low: Colors.success,
  medium: Colors.warning,
  high: Colors.error,
};

function MetricRow({ icon, metric }: { icon: React.ReactNode; metric: ExecutiveMetric }) {
  return (
    <View style={styles.metricRow}>
      <View style={styles.metricIcon}>{icon}</View>
      <View style={styles.metricCopy}>
        <Text style={styles.metricLabel}>{metric.label}</Text>
        <Text style={styles.metricValue}>{metric.value}</Text>
        <Text style={styles.metricNote} numberOfLines={3}>{metric.note}</Text>
      </View>
    </View>
  );
}

function ScorecardTile({ icon, card }: { icon: React.ReactNode; card: ExecutiveScorecard }) {
  const color = GRADE_COLORS[card.grade] ?? Colors.textSecondary;
  return (
    <View style={styles.scoreTile}>
      <View style={styles.scoreHeaderRow}>
        {icon}
        <Text style={styles.scoreTitle}>{card.title}</Text>
        <View style={[styles.gradePill, { backgroundColor: color }]}>
          <Text style={styles.gradePillText}>{card.grade}</Text>
        </View>
      </View>
      <View style={styles.scoreBarTrack}>
        <View style={[styles.scoreBarFill, { width: `${card.score}%`, backgroundColor: color }]} />
      </View>
      <Text style={styles.scoreValue}>{card.score}/100 · {card.level}</Text>
      {card.signals.map((s, i) => (
        <Text key={i} style={styles.scoreSignal} numberOfLines={2}>• {s}</Text>
      ))}
    </View>
  );
}

function GoalList({ goals }: { goals: StrategicGoal[] }) {
  return (
    <View style={styles.goalList}>
      {goals.map((g, i) => (
        <View key={i} style={styles.goalRow}>
          <View style={styles.goalDot} />
          <View style={styles.goalCopy}>
            <Text style={styles.goalTitle}>{g.title}</Text>
            <Text style={styles.goalMetric}>{g.metric}</Text>
            <Text style={styles.goalRationale} numberOfLines={2}>{g.rationale}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function ExecutiveLayerContent() {
  const insets = useSafeAreaInsets();

  const executiveQuery = useQuery<ExecutiveLayer | null>({
    queryKey: ['ivx-executive-layer'],
    queryFn: getExecutiveLayer,
    refetchInterval: POLL_INTERVAL_MS,
  });

  const data = executiveQuery.data ?? null;
  const onRefresh = useCallback(() => { void executiveQuery.refetch(); }, [executiveQuery]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 48 }]}
      refreshControl={<RefreshControl tintColor={Colors.primary} refreshing={executiveQuery.isFetching} onRefresh={onRefresh} />}
      testID="ivx-executive-layer-scroll"
    >
      <View style={styles.heroCard}>
        <View style={styles.heroHeaderRow}>
          <IVXBrandIcon size={18} />
          <Text style={styles.heroTitle}>Owner AI Executive Layer</Text>
        </View>
        <Text style={styles.heroSubtitle}>
          {data?.headline ?? 'Autonomous company operations — daily briefing, strategy, decisions, and the executive scorecard.'}
        </Text>
      </View>

      {data ? (
        <>
          {/* Executive scorecards */}
          <Text style={styles.sectionHeader}>Executive scorecard</Text>
          <View style={styles.scoreGrid}>
            <ScorecardTile icon={<Briefcase size={15} color={Colors.primary} />} card={data.scorecards.company} />
            <ScorecardTile icon={<Brain size={15} color={Colors.info} />} card={data.scorecards.ai} />
            <ScorecardTile icon={<Gauge size={15} color={Colors.blue} />} card={data.scorecards.engineering} />
            <ScorecardTile icon={<Wallet size={15} color={Colors.success} />} card={data.scorecards.capital} />
          </View>

          {/* Daily CEO briefing */}
          <View style={styles.card}>
            <Text style={styles.eyebrow}>Daily CEO briefing</Text>
            <MetricRow icon={<TrendingUp size={16} color={Colors.success} />} metric={data.dailyBriefing.revenue} />
            <MetricRow icon={<Users size={16} color={Colors.info} />} metric={data.dailyBriefing.crmPipeline} />
            <MetricRow icon={<Building2 size={16} color={Colors.blue} />} metric={data.dailyBriefing.investorPipeline} />
            <MetricRow icon={<Banknote size={16} color={Colors.warning} />} metric={data.dailyBriefing.cashRunway} />
            <MetricRow icon={<Gauge size={16} color={Colors.primary} />} metric={data.dailyBriefing.productHealth} />
            <View style={styles.riskBlock}>
              <View style={styles.metricIcon}><AlertTriangle size={16} color={Colors.error} /></View>
              <View style={styles.metricCopy}>
                <Text style={styles.metricLabel}>Open risks ({data.dailyBriefing.openRisks.count})</Text>
                {data.dailyBriefing.openRisks.items.length > 0 ? (
                  data.dailyBriefing.openRisks.items.map((r, i) => (
                    <Text key={i} style={styles.riskItem} numberOfLines={2}>• {r}</Text>
                  ))
                ) : (
                  <Text style={styles.metricNote}>{data.dailyBriefing.openRisks.note}</Text>
                )}
              </View>
            </View>
          </View>

          {/* Top opportunities */}
          <View style={styles.card}>
            <Text style={styles.eyebrow}>Top opportunities</Text>
            {data.opportunityEngine.ranked.length > 0 ? (
              data.opportunityEngine.ranked.slice(0, 3).map((o) => (
                <View key={`top-${o.rank}`} style={styles.rankedRow}>
                  <View style={styles.rankPill}><Text style={styles.rankPillText}>#{o.rank}</Text></View>
                  <View style={styles.rankCopy}>
                    <Text style={styles.rankTitle}>{o.title} <Text style={styles.rankKind}>· {o.kind}{o.score !== null ? ` · ${o.score}/100` : ''}</Text></Text>
                    <Text style={styles.rankDetail} numberOfLines={2}>{o.detail}</Text>
                  </View>
                </View>
              ))
            ) : (
              <Text style={styles.metricNote}>{data.opportunityEngine.note}</Text>
            )}
          </View>

          {/* Top risks */}
          <View style={styles.card}>
            <Text style={styles.eyebrow}>Top risks ({data.dailyBriefing.openRisks.count})</Text>
            {data.dailyBriefing.openRisks.items.length > 0 ? (
              data.dailyBriefing.openRisks.items.map((r, i) => (
                <View key={`risk-${i}`} style={styles.decisionRow}>
                  <AlertTriangle size={15} color={Colors.error} style={styles.riskLeadIcon} />
                  <Text style={styles.riskItem} numberOfLines={3}>{r}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.metricNote}>{data.dailyBriefing.openRisks.note}</Text>
            )}
          </View>

          {/* Investor priorities */}
          <View style={styles.card}>
            <Text style={styles.eyebrow}>Investor priorities</Text>
            <View style={styles.pipelineGrid}>
              <View style={styles.pipelineTile}><Text style={styles.pipelineValue}>{data.investorPriorities.meetingsNeeded}</Text><Text style={styles.pipelineLabel}>Meetings</Text></View>
              <View style={styles.pipelineTile}><Text style={styles.pipelineValue}>{data.investorPriorities.followUpsNeeded}</Text><Text style={styles.pipelineLabel}>Follow-ups</Text></View>
            </View>
            {data.investorPriorities.priorities.length > 0 ? (
              data.investorPriorities.priorities.map((p) => (
                <View key={`inv-${p.rank}`} style={styles.rankedRow}>
                  <View style={styles.rankPill}><Text style={styles.rankPillText}>#{p.rank}</Text></View>
                  <View style={styles.rankCopy}>
                    <Text style={styles.rankTitle}>{p.name}{p.matchScore !== null ? <Text style={styles.rankKind}> · {p.matchScore}/100</Text> : null}</Text>
                    <Text style={styles.rankDetail} numberOfLines={2}>{p.detail}</Text>
                    <Text style={styles.decisionImpact}>Next: {p.nextAction}</Text>
                  </View>
                </View>
              ))
            ) : (
              <Text style={styles.metricNote}>{data.investorPriorities.note}</Text>
            )}
          </View>

          {/* Deal pipeline */}
          <View style={styles.card}>
            <Text style={styles.eyebrow}>Deal pipeline</Text>
            <View style={styles.pipelineGrid}>
              <View style={styles.pipelineTile}><Text style={styles.pipelineValue}>{data.dealPipeline.totalPipeline}</Text><Text style={styles.pipelineLabel}>Total</Text></View>
              <View style={styles.pipelineTile}><Text style={[styles.pipelineValue, { color: Colors.success }]}>{data.dealPipeline.weightedPipeline}</Text><Text style={styles.pipelineLabel}>Weighted</Text></View>
              <View style={styles.pipelineTile}><Text style={styles.pipelineValue}>{data.dealPipeline.raisedThisMonth}</Text><Text style={styles.pipelineLabel}>Raised (mo)</Text></View>
            </View>
            <View style={styles.pipelineGrid}>
              <View style={styles.pipelineTile}><Text style={styles.pipelineValue}>{data.dealPipeline.activeInvestors}</Text><Text style={styles.pipelineLabel}>Investors</Text></View>
              <View style={styles.pipelineTile}><Text style={styles.pipelineValue}>{data.dealPipeline.activeBuyers}</Text><Text style={styles.pipelineLabel}>Buyers</Text></View>
              <View style={styles.pipelineTile}><Text style={styles.pipelineValue}>{data.dealPipeline.dealsInProgress}</Text><Text style={styles.pipelineLabel}>In progress</Text></View>
            </View>
            {data.dealPipeline.dealsAtRisk.map((d, i) => (
              <View key={`atrisk-${i}`} style={styles.execRow}>
                <AlertTriangle size={13} color={Colors.warning} />
                <Text style={styles.execTitle} numberOfLines={1}>{d.name}</Text>
                <Text style={styles.execMeta} numberOfLines={1}>{d.reason}</Text>
              </View>
            ))}
            <Text style={styles.footnote}>{data.dealPipeline.note}</Text>
          </View>

          {/* Autonomous actions taken */}
          <View style={styles.card}>
            <Text style={styles.eyebrow}>Autonomous actions taken</Text>
            <View style={styles.pipelineGrid}>
              <View style={styles.pipelineTile}><Text style={styles.pipelineValue}>{data.autonomousActions.totalRuns}</Text><Text style={styles.pipelineLabel}>Runs</Text></View>
              <View style={styles.pipelineTile}><Text style={styles.pipelineValue}>{data.autonomousActions.loopsRun}</Text><Text style={styles.pipelineLabel}>Loops</Text></View>
              <View style={styles.pipelineTile}><Text style={[styles.pipelineValue, { color: Colors.success }]}>{data.autonomousActions.outcomesRecorded}</Text><Text style={styles.pipelineLabel}>Outcomes</Text></View>
            </View>
            {data.autonomousActions.actions.map((a) => (
              <View key={a.kind} style={styles.rankedRow}>
                <View style={styles.metricIcon}><Bot size={15} color={Colors.info} /></View>
                <View style={styles.rankCopy}>
                  <Text style={styles.rankTitle}>{a.label} <Text style={styles.rankKind}>· {a.status} · {a.runCount} run(s)</Text></Text>
                  <Text style={styles.rankDetail} numberOfLines={2}>{a.summary}</Text>
                </View>
              </View>
            ))}
            <Text style={styles.footnote}>{data.autonomousActions.note}</Text>
          </View>

          {/* Learning summary */}
          <View style={styles.card}>
            <View style={styles.scoreHeaderRow}>
              <GraduationCap size={15} color={Colors.primary} />
              <Text style={styles.eyebrow}>Learning summary</Text>
            </View>
            <Text style={styles.scoreValue}>
              {data.learningSummary.totalLoops} loop(s) · {data.learningSummary.outcomesRecorded} outcome(s)
              {data.learningSummary.overallSuccessRate !== null ? ` · ${Math.round(data.learningSummary.overallSuccessRate * 100)}% success` : ''}
            </Text>
            {data.learningSummary.categories.length > 0 ? (
              data.learningSummary.categories.map((c) => (
                <View key={c.category} style={styles.goalRow}>
                  <View style={styles.goalDot} />
                  <View style={styles.goalCopy}>
                    <Text style={styles.goalTitle}>{c.category} <Text style={styles.rankKind}>· {c.withOutcome} outcome(s){c.successRate !== null ? ` · ${Math.round(c.successRate * 100)}%` : ''}</Text></Text>
                    <Text style={styles.goalRationale} numberOfLines={3}>{c.improvedRecommendation}</Text>
                  </View>
                </View>
              ))
            ) : (
              <Text style={styles.metricNote}>{data.learningSummary.note}</Text>
            )}
          </View>

          {/* Strategic planner */}
          <View style={styles.card}>
            <Text style={styles.eyebrow}>Strategic plan · 30 days</Text>
            <GoalList goals={data.strategicPlan.thirtyDay} />
          </View>
          <View style={styles.card}>
            <Text style={styles.eyebrow}>Strategic plan · 90 days</Text>
            <GoalList goals={data.strategicPlan.ninetyDay} />
          </View>
          <View style={styles.card}>
            <Text style={styles.eyebrow}>Strategic plan · 12 months</Text>
            <GoalList goals={data.strategicPlan.yearly} />
            <Text style={styles.footnote}>{data.strategicPlan.note}</Text>
          </View>

          {/* Opportunity engine */}
          <View style={styles.card}>
            <Text style={styles.eyebrow}>Opportunity engine</Text>
            <View style={styles.pipelineGrid}>
              <View style={styles.pipelineTile}><Text style={styles.pipelineValue}>{data.opportunityEngine.leads}</Text><Text style={styles.pipelineLabel}>Leads</Text></View>
              <View style={styles.pipelineTile}><Text style={styles.pipelineValue}>{data.opportunityEngine.investors}</Text><Text style={styles.pipelineLabel}>Investors</Text></View>
              <View style={styles.pipelineTile}><Text style={styles.pipelineValue}>{data.opportunityEngine.customers}</Text><Text style={styles.pipelineLabel}>Customers</Text></View>
            </View>
            {data.opportunityEngine.ranked.map((o) => (
              <View key={o.rank} style={styles.rankedRow}>
                <View style={styles.rankPill}><Text style={styles.rankPillText}>#{o.rank}</Text></View>
                <View style={styles.rankCopy}>
                  <Text style={styles.rankTitle}>{o.title} <Text style={styles.rankKind}>· {o.kind}{o.score !== null ? ` · ${o.score}/100` : ''}</Text></Text>
                  <Text style={styles.rankDetail} numberOfLines={2}>{o.detail}</Text>
                </View>
              </View>
            ))}
            <Text style={styles.footnote}>{data.opportunityEngine.note}</Text>
          </View>

          {/* Decision engine */}
          <View style={styles.card}>
            <Text style={styles.eyebrow}>Decision engine — recommended actions</Text>
            {data.decisionEngine.decisions.map((d) => (
              <View key={d.rank} style={styles.decisionRow}>
                <View style={[styles.riskPill, { backgroundColor: RISK_COLORS[d.riskLevel] }]}>
                  <Text style={styles.riskPillText}>{d.riskLevel}</Text>
                </View>
                <View style={styles.rankCopy}>
                  <Text style={styles.rankTitle}>{d.title}</Text>
                  <Text style={styles.decisionAction} numberOfLines={2}>{d.action}</Text>
                  <Text style={styles.rankDetail} numberOfLines={2}>{d.rationale}</Text>
                  <Text style={styles.decisionImpact}>Impact: {d.estimatedImpact}</Text>
                </View>
              </View>
            ))}
            <Text style={styles.footnote}>{data.decisionEngine.note}</Text>
          </View>

          {/* Execution tracking */}
          <View style={styles.card}>
            <Text style={styles.eyebrow}>Execution tracking</Text>
            <View style={styles.pipelineGrid}>
              <View style={styles.pipelineTile}><Text style={styles.pipelineValue}>{data.executionTracking.planned}</Text><Text style={styles.pipelineLabel}>Planned</Text></View>
              <View style={styles.pipelineTile}><Text style={[styles.pipelineValue, { color: Colors.success }]}>{data.executionTracking.executed}</Text><Text style={styles.pipelineLabel}>Executed</Text></View>
              <View style={styles.pipelineTile}><Text style={styles.pipelineValue}>{data.executionTracking.remaining}</Text><Text style={styles.pipelineLabel}>Remaining</Text></View>
            </View>
            {data.executionTracking.recent.map((t, i) => (
              <View key={i} style={styles.execRow}>
                <Target size={13} color={Colors.textSecondary} />
                <Text style={styles.execTitle} numberOfLines={1}>{t.title}</Text>
                <Text style={styles.execMeta}>{t.progress} · {t.status}</Text>
              </View>
            ))}
            <Text style={styles.footnote}>{data.executionTracking.note}</Text>
          </View>

          <Text style={styles.disclaimer}>{data.disclaimer}</Text>
        </>
      ) : (
        <View style={styles.card}>
          {executiveQuery.isLoading ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : (
            <Text style={styles.emptyBody}>{executiveQuery.error instanceof Error ? executiveQuery.error.message : 'No executive data yet.'}</Text>
          )}
        </View>
      )}
    </ScrollView>
  );
}

export default function ExecutiveLayerScreen() {
  return (
    <ErrorBoundary>
      <Stack.Screen options={{ title: 'Executive Layer' }} />
      <ExecutiveLayerContent />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, gap: 14 },
  heroCard: { backgroundColor: Colors.card, borderRadius: 18, padding: 18, gap: 10, borderWidth: 1, borderColor: Colors.border },
  heroHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text, flexShrink: 1 },
  heroSubtitle: { fontSize: 13, lineHeight: 19, color: Colors.textSecondary },
  sectionHeader: { fontSize: 13, fontWeight: '700' as const, color: Colors.text, marginTop: 2 },
  card: { backgroundColor: Colors.card, borderRadius: 16, padding: 16, gap: 12, borderWidth: 1, borderColor: Colors.border },
  eyebrow: { fontSize: 12, fontWeight: '700' as const, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6 },
  emptyBody: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  scoreGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  scoreTile: { width: '48%', backgroundColor: Colors.card, borderRadius: 14, padding: 12, gap: 7, borderWidth: 1, borderColor: Colors.border },
  scoreHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  scoreTitle: { fontSize: 13, fontWeight: '700' as const, color: Colors.text, flex: 1 },
  gradePill: { borderRadius: 7, paddingHorizontal: 8, paddingVertical: 2 },
  gradePillText: { fontSize: 12, fontWeight: '800' as const, color: Colors.black },
  scoreBarTrack: { height: 6, borderRadius: 3, backgroundColor: Colors.backgroundSecondary, overflow: 'hidden' },
  scoreBarFill: { height: 6, borderRadius: 3 },
  scoreValue: { fontSize: 11.5, fontWeight: '600' as const, color: Colors.textSecondary, textTransform: 'capitalize' },
  scoreSignal: { fontSize: 10.5, color: Colors.textSecondary, lineHeight: 14 },
  metricRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  metricIcon: { width: 28, height: 28, borderRadius: 8, backgroundColor: Colors.backgroundSecondary, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  metricCopy: { flex: 1, gap: 2 },
  metricLabel: { fontSize: 11, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
  metricValue: { fontSize: 16, fontWeight: '800' as const, color: Colors.text },
  metricNote: { fontSize: 11.5, color: Colors.textSecondary, lineHeight: 16 },
  riskBlock: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  riskItem: { fontSize: 12, color: Colors.text, lineHeight: 17 },
  goalList: { gap: 12 },
  goalRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  goalDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.primary, marginTop: 5 },
  goalCopy: { flex: 1, gap: 2 },
  goalTitle: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  goalMetric: { fontSize: 12.5, fontWeight: '600' as const, color: Colors.primary, lineHeight: 17 },
  goalRationale: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },
  pipelineGrid: { flexDirection: 'row', gap: 10 },
  pipelineTile: { flex: 1, backgroundColor: Colors.backgroundSecondary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.border },
  pipelineValue: { fontSize: 20, fontWeight: '800' as const, color: Colors.text },
  pipelineLabel: { fontSize: 11, color: Colors.textSecondary },
  rankedRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  rankPill: { backgroundColor: Colors.primary, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginTop: 1 },
  rankPillText: { fontSize: 11.5, fontWeight: '800' as const, color: Colors.black },
  rankCopy: { flex: 1, gap: 2 },
  rankTitle: { fontSize: 13.5, fontWeight: '700' as const, color: Colors.text },
  rankKind: { fontSize: 12, fontWeight: '500' as const, color: Colors.textSecondary, textTransform: 'capitalize' },
  rankDetail: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },
  decisionRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  riskPill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginTop: 1 },
  riskPillText: { fontSize: 10.5, fontWeight: '800' as const, color: Colors.black, textTransform: 'uppercase' },
  decisionAction: { fontSize: 12.5, fontWeight: '600' as const, color: Colors.text, lineHeight: 17 },
  decisionImpact: { fontSize: 11.5, color: Colors.success, lineHeight: 16, fontWeight: '600' as const },
  execRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  execTitle: { fontSize: 12.5, color: Colors.text, flex: 1 },
  execMeta: { fontSize: 11, color: Colors.textSecondary },
  footnote: { fontSize: 11.5, color: Colors.textSecondary, lineHeight: 16, fontStyle: 'italic' as const },
  riskLeadIcon: { marginTop: 2 },
  disclaimer: { fontSize: 11, color: Colors.textSecondary, lineHeight: 16, fontStyle: 'italic' as const, paddingHorizontal: 4 },
});
