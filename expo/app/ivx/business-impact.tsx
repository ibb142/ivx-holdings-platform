import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  AlertTriangle,
  Briefcase,
  Building2,
  CheckCircle2,
  Clock,
  Compass,
    Handshake,
  Lightbulb,
  Radar,
  Target,
  TrendingUp,
  Users,
  Wrench,
} from 'lucide-react-native';
import IVXBrandIcon from '@/components/IVXBrandIcon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { startDailyImprovement } from '@/src/modules/ivx-developer/developerMonitorService';
import {
  getBusinessImpactDashboard,
  type BriefingPick,
  type BusinessImpactDashboard,
} from '@/src/modules/ivx-developer/businessImpactService';

const POLL_INTERVAL_MS = 15000;

function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value}`;
}

function MetricTile({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone?: string }) {
  return (
    <View style={styles.metricTile}>
      <View style={styles.metricIcon}>{icon}</View>
      <Text style={[styles.metricValue, tone ? { color: tone } : null]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function BriefingRow({ icon, label, pick }: { icon: React.ReactNode; label: string; pick: BriefingPick }) {
  return (
    <View style={styles.briefRow}>
      <View style={styles.briefIcon}>{icon}</View>
      <View style={styles.briefCopy}>
        <Text style={styles.briefLabel}>{label}</Text>
        <Text style={styles.briefTitle} numberOfLines={2}>{pick ? pick.title : '—'}</Text>
        {pick ? <Text style={styles.briefDetail} numberOfLines={2}>{pick.detail}</Text> : null}
      </View>
    </View>
  );
}

function FeedLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.feedLine}>
      <Text style={styles.feedLabel}>{label}</Text>
      <Text style={styles.feedValue}>{value}</Text>
    </View>
  );
}

function BusinessImpactContent() {
  const insets = useSafeAreaInsets();
  const [improving, setImproving] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);

  const dashboardQuery = useQuery<BusinessImpactDashboard | null>({
    queryKey: ['ivx-business-impact', 'dashboard'],
    queryFn: getBusinessImpactDashboard,
    refetchInterval: POLL_INTERVAL_MS,
  });

  const dashboard = dashboardQuery.data ?? null;

  const handleImprove = useCallback(async () => {
    setImproving(true);
    setActionError(null);
    setActionNote(null);
    try {
      const result = await startDailyImprovement();
      setActionNote(result.taskId ? `Started improvement task ${result.taskId}.` : 'Improvement loop started.');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not start the daily improvement.');
    } finally {
      setImproving(false);
    }
  }, []);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 48 }]}
      refreshControl={
        <RefreshControl
          tintColor={Colors.primary}
          refreshing={dashboardQuery.isFetching}
          onRefresh={() => { void dashboardQuery.refetch(); }}
        />
      }
      testID="ivx-business-impact-scroll"
    >
      <View style={styles.heroCard}>
        <View style={styles.heroHeaderRow}>
          <IVXBrandIcon size={18} />
          <Text style={styles.heroTitle}>IVX Holdings Command Center</Text>
        </View>
        <Text style={styles.heroSubtitle}>
          {dashboard?.headline ?? 'How IVX helped IVX Holdings in the last 24 hours — outcomes, not features.'}
        </Text>
        <View style={styles.heroButtonRow}>
          <Pressable
            style={[styles.primaryButton, improving ? styles.buttonDisabled : null]}
            onPress={() => { void handleImprove(); }}
            disabled={improving}
            testID="ivx-business-impact-improve"
          >
            {improving ? <ActivityIndicator size="small" color={Colors.black} /> : <Wrench size={15} color={Colors.black} />}
            <Text style={styles.primaryButtonText}>{improving ? 'Starting…' : 'Improve IVX today'}</Text>
          </Pressable>
          <Pressable
            style={styles.secondaryButton}
            onPress={() => router.push('/ivx/opportunity-engine' as never)}
            testID="ivx-business-impact-open-opportunity"
          >
            <Radar size={14} color={Colors.text} />
            <Text style={styles.secondaryButtonText}>Opportunities</Text>
          </Pressable>
        </View>
        {actionNote ? <Text style={styles.noteText}>{actionNote}</Text> : null}
        {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}
      </View>

      {dashboard ? (
        <>
          {/* Daily CEO Briefing — what the owner sees first */}
          <View style={styles.card}>
            <Text style={styles.eyebrow}>Daily CEO briefing</Text>
            <BriefingRow icon={<Target size={15} color={Colors.primary} />} label="Top opportunity" pick={dashboard.ceoBriefing.topOpportunity} />
            <BriefingRow icon={<TrendingUp size={15} color={Colors.success} />} label="Top revenue opportunity" pick={dashboard.ceoBriefing.topRevenueOpportunity} />
            <BriefingRow icon={<Users size={15} color={Colors.info} />} label="Top investor signal" pick={dashboard.ceoBriefing.topInvestor} />
            <BriefingRow icon={<Building2 size={15} color={Colors.blue} />} label="Top buyer signal" pick={dashboard.ceoBriefing.topBuyer} />
            <BriefingRow icon={<Handshake size={15} color={Colors.warning} />} label="Top partnership" pick={dashboard.ceoBriefing.topPartnership} />
            <BriefingRow icon={<AlertTriangle size={15} color={Colors.error} />} label="Top risk" pick={dashboard.ceoBriefing.topRisk} />
            <BriefingRow icon={<Wrench size={15} color={Colors.success} />} label="Top IVX improvement" pick={dashboard.ceoBriefing.topImprovement} />
          </View>

          {/* Business outcomes */}
          <Text style={styles.sectionHeader}>Business impact</Text>
          <View style={styles.metricGrid}>
            <MetricTile icon={<Radar size={16} color={Colors.primary} />} label="Found today" value={String(dashboard.opportunitiesFound.today)} />
            <MetricTile icon={<Compass size={16} color={Colors.info} />} label="This week" value={String(dashboard.opportunitiesFound.week)} />
            <MetricTile icon={<Briefcase size={16} color={Colors.blue} />} label="This month" value={String(dashboard.opportunitiesFound.month)} />
            <MetricTile icon={<TrendingUp size={16} color={Colors.success} />} label="Potential value" value={formatUsd(dashboard.revenuePotential.estimatedOpportunityValueUsd)} tone={Colors.success} />
            <MetricTile icon={<Target size={16} color={Colors.warning} />} label="Deals in progress" value={String(dashboard.revenuePotential.dealsInProgress)} />
            <MetricTile icon={<Building2 size={16} color={Colors.primary} />} label="Active deals" value={String(dashboard.businessGoals.activeDeals)} />
          </View>

          {/* Capital pipeline */}
          <View style={styles.card}>
            <Text style={styles.eyebrow}>Capital pipeline</Text>
            <View style={styles.pipelineGrid}>
              <View style={styles.pipelineTile}><Text style={styles.pipelineValue}>{dashboard.capitalPipeline.investorsDiscovered}</Text><Text style={styles.pipelineLabel}>Investors</Text></View>
              <View style={styles.pipelineTile}><Text style={styles.pipelineValue}>{dashboard.capitalPipeline.partnersDiscovered}</Text><Text style={styles.pipelineLabel}>Partners</Text></View>
              <View style={styles.pipelineTile}><Text style={styles.pipelineValue}>{dashboard.capitalPipeline.lendersDiscovered}</Text><Text style={styles.pipelineLabel}>Lenders</Text></View>
              <View style={styles.pipelineTile}><Text style={styles.pipelineValue}>{dashboard.capitalPipeline.buyersDiscovered}</Text><Text style={styles.pipelineLabel}>Buyers</Text></View>
            </View>
            <Text style={styles.footnote}>{dashboard.capitalPipeline.note}</Text>
          </View>

          {/* IVX improvements + time saved */}
          <View style={styles.card}>
            <Text style={styles.eyebrow}>IVX improvements & time saved</Text>
            <View style={styles.metricGrid}>
              <MetricTile icon={<CheckCircle2 size={16} color={Colors.success} />} label="Bugs fixed" value={String(dashboard.improvements.bugsFixed)} tone={Colors.success} />
              <MetricTile icon={<Wrench size={16} color={Colors.info} />} label="Deployments" value={String(dashboard.improvements.deploymentsCompleted)} />
              <MetricTile icon={<AlertTriangle size={16} color={Colors.warning} />} label="Issues prevented" value={String(dashboard.improvements.productionIssuesPrevented)} />
              <MetricTile icon={<Clock size={16} color={Colors.primary} />} label="Hours saved" value={`~${dashboard.timeSaved.hoursSaved}h`} />
              <MetricTile icon={<CheckCircle2 size={16} color={Colors.blue} />} label="Tasks automated" value={String(dashboard.timeSaved.tasksAutomated)} />
              <MetricTile icon={<Lightbulb size={16} color={Colors.warning} />} label="Research auto" value={String(dashboard.timeSaved.researchAutomated)} />
            </View>
            <Text style={styles.footnote}>{dashboard.timeSaved.note}</Text>
          </View>

          {/* Priority tasks */}
          <View style={styles.card}>
            <Text style={styles.eyebrow}>Today's priority tasks</Text>
            {dashboard.priorityTasks.map((task) => (
              <View key={`${task.priority}-${task.source}`} style={styles.priorityRow}>
                <View style={styles.priorityPill}><Text style={styles.priorityPillText}>P{task.priority}</Text></View>
                <View style={styles.priorityCopy}>
                  <Text style={styles.priorityTitle}>{task.title}</Text>
                  <Text style={styles.priorityRationale} numberOfLines={2}>{task.rationale}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* Daily scorecard */}
          <View style={styles.card}>
            <Text style={styles.eyebrow}>Daily scorecard</Text>
            <FeedLine label="Discovered" value={dashboard.scorecard.discovered} />
            <FeedLine label="Improved" value={dashboard.scorecard.improved} />
            <FeedLine label="Learned" value={dashboard.scorecard.learned} />
            <FeedLine label="Recommends" value={dashboard.scorecard.recommends} />
            <FeedLine label="Expected impact" value={dashboard.scorecard.expectedImpact} />
          </View>

          {/* Owner tablet feed */}
          <View style={styles.card}>
            <Text style={styles.eyebrow}>Owner feed</Text>
            <FeedLine label="Yesterday" value={dashboard.ownerFeed.yesterday} />
            <FeedLine label="Today" value={dashboard.ownerFeed.today} />
            <FeedLine label="Recommends next" value={dashboard.ownerFeed.recommendsNext} />
            <FeedLine label="Working on" value={dashboard.ownerFeed.workingOn} />
            <FeedLine label="Needs decision" value={dashboard.ownerFeed.needsDecision} />
          </View>

          <Text style={styles.disclaimer}>{dashboard.disclaimer}</Text>
        </>
      ) : (
        <View style={styles.card}>
          {dashboardQuery.isLoading ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : (
            <Text style={styles.emptyBody}>{dashboardQuery.error instanceof Error ? dashboardQuery.error.message : 'No business-impact data yet.'}</Text>
          )}
        </View>
      )}
    </ScrollView>
  );
}

export default function BusinessImpactScreen() {
  return (
    <ErrorBoundary>
      <Stack.Screen options={{ title: 'Command Center' }} />
      <BusinessImpactContent />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, gap: 14 },
  heroCard: { backgroundColor: Colors.card, borderRadius: 18, padding: 18, gap: 12, borderWidth: 1, borderColor: Colors.border },
  heroHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text, flexShrink: 1 },
  heroSubtitle: { fontSize: 13, lineHeight: 19, color: Colors.textSecondary },
  heroButtonRow: { flexDirection: 'row', gap: 10 },
  primaryButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, flex: 1 },
  primaryButtonText: { fontSize: 14.5, fontWeight: '700' as const, color: Colors.black },
  secondaryButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: Colors.border },
  secondaryButtonText: { fontSize: 13.5, fontWeight: '600' as const, color: Colors.text },
  buttonDisabled: { opacity: 0.6 },
  noteText: { fontSize: 12.5, color: Colors.success, lineHeight: 18 },
  errorText: { fontSize: 12.5, color: Colors.error, lineHeight: 18 },
  sectionHeader: { fontSize: 13, fontWeight: '700' as const, color: Colors.text, marginTop: 2 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metricTile: { width: '31%', backgroundColor: Colors.card, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 10, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.border },
  metricIcon: { marginBottom: 2 },
  metricValue: { fontSize: 17, fontWeight: '800' as const, color: Colors.text },
  metricLabel: { fontSize: 10.5, color: Colors.textSecondary, textAlign: 'center' },
  card: { backgroundColor: Colors.card, borderRadius: 16, padding: 16, gap: 12, borderWidth: 1, borderColor: Colors.border },
  eyebrow: { fontSize: 12, fontWeight: '700' as const, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6 },
  emptyBody: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  briefRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  briefIcon: { width: 28, height: 28, borderRadius: 8, backgroundColor: Colors.backgroundSecondary, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  briefCopy: { flex: 1, gap: 2 },
  briefLabel: { fontSize: 11, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
  briefTitle: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  briefDetail: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },
  pipelineGrid: { flexDirection: 'row', gap: 10 },
  pipelineTile: { flex: 1, backgroundColor: Colors.backgroundSecondary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.border },
  pipelineValue: { fontSize: 20, fontWeight: '800' as const, color: Colors.text },
  pipelineLabel: { fontSize: 11, color: Colors.textSecondary },
  footnote: { fontSize: 11.5, color: Colors.textSecondary, lineHeight: 16, fontStyle: 'italic' as const },
  priorityRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  priorityPill: { backgroundColor: Colors.primary, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4, marginTop: 1 },
  priorityPillText: { fontSize: 12, fontWeight: '800' as const, color: Colors.black },
  priorityCopy: { flex: 1, gap: 2 },
  priorityTitle: { fontSize: 13.5, fontWeight: '600' as const, color: Colors.text },
  priorityRationale: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },
  feedLine: { gap: 3 },
  feedLabel: { fontSize: 11, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
  feedValue: { fontSize: 13, color: Colors.text, lineHeight: 19 },
  disclaimer: { fontSize: 11, color: Colors.textSecondary, lineHeight: 16, fontStyle: 'italic' as const, paddingHorizontal: 4 },
});
