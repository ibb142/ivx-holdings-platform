import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View} from "react-native";
import {
  CheckCircle2,
  FlaskConical,
  Lightbulb,
  Rocket,
  Sparkles,
  TrendingUp,
  XCircle} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  getInnovationDashboard,
  runInnovationScan,
  setInnovationIdeaStatus,
  type InnovationDashboard,
  type InnovationIdea} from '@/src/modules/ivx-developer/innovationService';

const POLL_INTERVAL_MS = 6000;

const CATEGORY_LABEL: Record<InnovationIdea['category'], string> = {
  product: 'Product',
  business_model: 'Business model',
  ai_workflow: 'AI workflow',
  platform_capability: 'Platform',
  technology_concept: 'Technology'};

const SIGNAL_LABEL: Record<InnovationIdea['signalSource'], string> = {
  ivx_data: 'IVX data',
  user_behavior: 'User behavior',
  performance: 'Performance',
  market: 'Market',
  competitor: 'Competitor'};

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

function ScoreBar({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <View style={styles.scoreRow}>
      <Text style={styles.scoreLabel}>{label}</Text>
      <View style={styles.scoreTrack}>
        <View style={[styles.scoreFill, { width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: tone }]} />
      </View>
      <Text style={styles.scoreValue}>{value}</Text>
    </View>
  );
}

function InnovationDashboardContent() {
  const insets = useSafeAreaInsets();
  const [scanning, setScanning] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyIdeaId, setBusyIdeaId] = useState<string | null>(null);

  const dashboardQuery = useQuery<InnovationDashboard | null>({
    queryKey: ['ivx-innovation', 'dashboard'],
    queryFn: getInnovationDashboard,
    refetchInterval: POLL_INTERVAL_MS});

  const dashboard = dashboardQuery.data ?? null;

  const handleScan = useCallback(async () => {
    setScanning(true);
    setActionError(null);
    try {
      await runInnovationScan();
      await dashboardQuery.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not run the innovation scan.');
    } finally {
      setScanning(false);
    }
  }, [dashboardQuery]);

  const handleReview = useCallback(async (idea: InnovationIdea, status: 'approved' | 'rejected') => {
    setBusyIdeaId(idea.id);
    setActionError(null);
    try {
      await setInnovationIdeaStatus(idea.id, status);
      await dashboardQuery.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not update the idea.');
    } finally {
      setBusyIdeaId(null);
    }
  }, [dashboardQuery]);

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
      testID="ivx-innovation-dashboard-scroll"
    >
      <View style={styles.heroCard}>
        <View style={styles.heroHeaderRow}>
          <Sparkles size={18} color={Colors.primary} />
          <Text style={styles.heroTitle}>Innovation Dashboard</Text>
        </View>
        <Text style={styles.heroSubtitle}>
          IVX continuously scans its own data, user behavior, performance, market and competitor signals to generate scored ideas — no ideas are hardcoded.
        </Text>
        <View style={styles.heroButtonRow}>
          <Pressable
            style={[styles.primaryButton, scanning ? styles.buttonDisabled : null]}
            onPress={() => { void handleScan(); }}
            disabled={scanning}
            testID="ivx-innovation-run-scan"
          >
            {scanning ? <ShimmerIndicator size="small" color={Colors.black} /> : <Lightbulb size={15} color={Colors.black} />}
            <Text style={styles.primaryButtonText}>{scanning ? 'Scanning…' : 'Generate ideas'}</Text>
          </Pressable>
          <Pressable
            style={styles.secondaryButton}
            onPress={() => router.push('/ivx/research-lab' as never)}
            testID="ivx-innovation-open-research-lab"
          >
            <FlaskConical size={14} color={Colors.text} />
            <Text style={styles.secondaryButtonText}>Research Lab</Text>
          </Pressable>
        </View>
        {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}
      </View>

      {dashboard ? (
        <>
          <View style={styles.metricGrid}>
            <MetricTile icon={<Lightbulb size={16} color={Colors.primary} />} label="Proposed" value={String(dashboard.inventions.proposed)} />
            <MetricTile icon={<CheckCircle2 size={16} color={Colors.success} />} label="Approved" value={String(dashboard.inventions.approved)} tone={Colors.success} />
            <MetricTile icon={<XCircle size={16} color={Colors.error} />} label="Rejected" value={String(dashboard.inventions.rejected)} tone={Colors.error} />
            <MetricTile icon={<Rocket size={16} color={Colors.info} />} label="Shipped" value={String(dashboard.inventions.shipped)} tone={Colors.info} />
            <MetricTile icon={<FlaskConical size={16} color={Colors.warning} />} label="Experiments" value={`${dashboard.experiments.running}/${dashboard.experiments.total}`} />
            <MetricTile icon={<TrendingUp size={16} color={Colors.success} />} label="Est. value" value={formatUsd(dashboard.estimatedBusinessValueUsd)} tone={Colors.success} />
          </View>

          <View style={styles.card}>
            <Text style={styles.eyebrow}>Top scored ideas</Text>
            {dashboard.topIdeas.length === 0 ? (
              <Text style={styles.emptyBody}>No ideas yet. Tap “Generate ideas” to run the Innovation Engine.</Text>
            ) : (
              dashboard.topIdeas.map((idea) => (
                <View key={idea.id} style={styles.ideaCard} testID={`ivx-innovation-idea-${idea.id}`}>
                  <View style={styles.ideaHeaderRow}>
                    <View style={styles.ideaBadges}>
                      <View style={styles.badge}><Text style={styles.badgeText}>{CATEGORY_LABEL[idea.category]}</Text></View>
                      <View style={styles.badgeMuted}><Text style={styles.badgeMutedText}>{SIGNAL_LABEL[idea.signalSource]}</Text></View>
                    </View>
                    <View style={styles.priorityPill}>
                      <Text style={styles.priorityPillText}>{idea.priority}</Text>
                    </View>
                  </View>
                  <Text style={styles.ideaTitle}>{idea.title}</Text>
                  <Text style={styles.ideaSummary}>{idea.summary}</Text>
                  <Text style={styles.ideaEvidence}>{`Signal: ${idea.evidence}`}</Text>
                  <View style={styles.scoreBlock}>
                    <ScoreBar label="Impact" value={idea.scores.impact} tone={Colors.success} />
                    <ScoreBar label="Revenue" value={idea.scores.revenue} tone={Colors.primary} />
                    <ScoreBar label="Feasible" value={idea.scores.feasibility} tone={Colors.info} />
                    <ScoreBar label="Confidence" value={idea.scores.confidence} tone={Colors.blue} />
                    <ScoreBar label="Complexity" value={idea.scores.complexity} tone={Colors.warning} />
                  </View>
                  {idea.status === 'proposed' ? (
                    <View style={styles.reviewRow}>
                      <Pressable
                        style={[styles.approveButton, busyIdeaId === idea.id ? styles.buttonDisabled : null]}
                        onPress={() => { void handleReview(idea, 'approved'); }}
                        disabled={busyIdeaId === idea.id}
                        testID={`ivx-innovation-approve-${idea.id}`}
                      >
                        <CheckCircle2 size={13} color={Colors.black} />
                        <Text style={styles.approveButtonText}>Approve</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.rejectButton, busyIdeaId === idea.id ? styles.buttonDisabled : null]}
                        onPress={() => { void handleReview(idea, 'rejected'); }}
                        disabled={busyIdeaId === idea.id}
                        testID={`ivx-innovation-reject-${idea.id}`}
                      >
                        <XCircle size={13} color={Colors.error} />
                        <Text style={styles.rejectButtonText}>Reject</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <View style={[styles.statusTag, { borderColor: idea.status === 'rejected' ? Colors.error : Colors.success }]}>
                      <Text style={[styles.statusTagText, { color: idea.status === 'rejected' ? Colors.error : Colors.success }]}>
                        {idea.status}
                      </Text>
                    </View>
                  )}
                </View>
              ))
            )}
          </View>
        </>
      ) : (
        <View style={styles.card}>
          {dashboardQuery.isLoading ? (
            <ShimmerIndicator size="small" color={Colors.primary} />
          ) : (
            <Text style={styles.emptyBody}>{dashboardQuery.error instanceof Error ? dashboardQuery.error.message : 'No innovation data yet.'}</Text>
          )}
        </View>
      )}
    </ScrollView>
  );
}

export default function InnovationDashboardScreen() {
  return (
    <ErrorBoundary>
      <Stack.Screen options={{ title: 'Innovation Dashboard' }} />
      <InnovationDashboardContent />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, gap: 14 },
  heroCard: { backgroundColor: Colors.card, borderRadius: 18, padding: 18, gap: 12, borderWidth: 1, borderColor: Colors.border },
  heroHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  heroSubtitle: { fontSize: 13, lineHeight: 19, color: Colors.textSecondary },
  heroButtonRow: { flexDirection: 'row', gap: 10 },
  primaryButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, flex: 1 },
  primaryButtonText: { fontSize: 14.5, fontWeight: '700' as const, color: Colors.black },
  secondaryButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: Colors.border },
  secondaryButtonText: { fontSize: 13.5, fontWeight: '600' as const, color: Colors.text },
  buttonDisabled: { opacity: 0.6 },
  errorText: { fontSize: 12.5, color: Colors.error, lineHeight: 18 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metricTile: { width: '31%', backgroundColor: Colors.card, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 10, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.border },
  metricIcon: { marginBottom: 2 },
  metricValue: { fontSize: 18, fontWeight: '800' as const, color: Colors.text },
  metricLabel: { fontSize: 11, color: Colors.textSecondary, textAlign: 'center' },
  card: { backgroundColor: Colors.card, borderRadius: 16, padding: 16, gap: 12, borderWidth: 1, borderColor: Colors.border },
  eyebrow: { fontSize: 12, fontWeight: '700' as const, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6 },
  emptyBody: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  ideaCard: { backgroundColor: Colors.backgroundSecondary, borderRadius: 14, padding: 14, gap: 8, borderWidth: 1, borderColor: Colors.border },
  ideaHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ideaBadges: { flexDirection: 'row', gap: 6, flexShrink: 1 },
  badge: { backgroundColor: Colors.primary, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 10.5, fontWeight: '700' as const, color: Colors.black },
  badgeMuted: { backgroundColor: Colors.surfaceLight, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  badgeMutedText: { fontSize: 10.5, fontWeight: '600' as const, color: Colors.textSecondary },
  priorityPill: { backgroundColor: Colors.black, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 4, borderWidth: 1, borderColor: Colors.primary },
  priorityPillText: { fontSize: 13, fontWeight: '800' as const, color: Colors.primary },
  ideaTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  ideaSummary: { fontSize: 12.5, lineHeight: 18, color: Colors.textSecondary },
  ideaEvidence: { fontSize: 11.5, lineHeight: 16, color: Colors.textTertiary, fontStyle: 'italic' as const },
  scoreBlock: { gap: 5, marginTop: 2 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scoreLabel: { fontSize: 11, color: Colors.textSecondary, width: 72 },
  scoreTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: Colors.surfaceLight, overflow: 'hidden' },
  scoreFill: { height: 6, borderRadius: 3 },
  scoreValue: { fontSize: 11, color: Colors.text, width: 24, textAlign: 'right' },
  reviewRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  approveButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.success, paddingVertical: 9, borderRadius: 10, flex: 1 },
  approveButtonText: { fontSize: 13, fontWeight: '700' as const, color: Colors.black },
  rejectButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 10, flex: 1, borderWidth: 1, borderColor: Colors.error },
  rejectButtonText: { fontSize: 13, fontWeight: '700' as const, color: Colors.error },
  statusTag: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, marginTop: 2 },
  statusTagText: { fontSize: 11, fontWeight: '700' as const, textTransform: 'uppercase' as const, letterSpacing: 0.5 }});
