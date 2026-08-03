import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View} from "react-native";
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  LayoutDashboard,
  Search,
  ShoppingBag,
  Target,
  TrendingUp,
  UserCheck} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  getCapitalCommandCenter,
  runBestInvestor,
  type AttentionItem,
  type CapitalCommandCenter,
  type BestInvestorWorkflowResult} from '@/src/modules/ivx-developer/capitalCommandService';

function usd(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

function scoreTone(score: number): string {
  if (score >= 70) return Colors.success;
  if (score >= 45) return Colors.warning;
  return Colors.textTertiary;
}

function MetricTile({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <View style={styles.metricTile}>
      <Text style={[styles.metricValue, tone ? { color: tone } : null]} numberOfLines={1}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function BestCard({
  title,
  icon,
  name,
  subtitle,
  score,
  evidence}: {
  title: string;
  icon: React.ReactNode;
  name: string;
  subtitle: string;
  score?: number;
  evidence?: string[];
}) {
  return (
    <View style={styles.bestCard}>
      <View style={styles.bestHeader}>
        {icon}
        <Text style={styles.bestTitle}>{title}</Text>
        {typeof score === 'number' ? <Text style={[styles.bestScore, { color: scoreTone(score) }]}>{score}</Text> : null}
      </View>
      <Text style={styles.bestName} numberOfLines={1}>{name}</Text>
      {subtitle ? <Text style={styles.bestSubtitle} numberOfLines={2}>{subtitle}</Text> : null}
      {evidence && evidence.length > 0 ? (
        <Text style={styles.bestEvidence} numberOfLines={2}>{`• ${evidence[0]}`}</Text>
      ) : null}
    </View>
  );
}

function AttentionSection({
  title,
  icon,
  items,
  tone}: {
  title: string;
  icon: React.ReactNode;
  items: AttentionItem[];
  tone: string;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.sectionHeader}>
        {icon}
        <Text style={styles.sectionTitle}>{title}</Text>
        <View style={[styles.countPill, { borderColor: tone }]}><Text style={[styles.countPillText, { color: tone }]}>{items.length}</Text></View>
      </View>
      {items.length === 0 ? (
        <Text style={styles.emptyRow}>Nothing needs attention here right now.</Text>
      ) : (
        items.slice(0, 6).map((item) => (
          <View key={item.id} style={styles.attentionRow}>
            <View style={styles.attentionCopy}>
              <Text style={styles.attentionName} numberOfLines={1}>
                {item.name}{item.dealName ? ` · ${item.dealName}` : ''}
              </Text>
              <Text style={styles.attentionReason} numberOfLines={2}>{item.reason}</Text>
            </View>
          </View>
        ))
      )}
    </View>
  );
}

function WorkflowResultCard({ result }: { result: BestInvestorWorkflowResult }) {
  const [showRanked, setShowRanked] = useState<boolean>(false);
  const best = result.bestInvestor;
  return (
    <View style={styles.workflowCard} testID="ivx-best-investor-result">
      <View style={styles.sectionHeader}>
        <Target size={16} color={Colors.primary} />
        <Text style={styles.sectionTitle}>Best investor for {result.deal?.dealName ?? result.dealQuery}</Text>
      </View>

      {result.steps.map((step) => (
        <View key={step.key} style={styles.stepRow}>
          <View style={[
            styles.stepDot,
            step.status === 'done' ? styles.stepDotDone : step.status === 'failed' ? styles.stepDotFailed : styles.stepDotSkipped,
          ]} />
          <View style={styles.stepCopy}>
            <Text style={styles.stepLabel}>{step.label}</Text>
            <Text style={styles.stepDetail} numberOfLines={3}>{step.detail}</Text>
          </View>
        </View>
      ))}

      {best ? (
        <View style={styles.bestInvestorBlock}>
          <View style={styles.bestInvestorTop}>
            <Text style={styles.bestInvestorName} numberOfLines={1}>{best.name}</Text>
            <Text style={[styles.bestInvestorScore, { color: scoreTone(best.matchScore) }]}>{best.matchScore}/100</Text>
          </View>
          {best.company ? <Text style={styles.bestInvestorCompany}>{best.company}</Text> : null}
          {best.evidence.slice(0, 3).map((e, i) => (
            <Text key={`ev-${i}`} style={styles.evidenceItem}>{`• ${e}`}</Text>
          ))}
        </View>
      ) : null}

      {result.introEmail ? (
        <View style={styles.draftRow}>
          <Text style={styles.draftLabel}>Intro email drafted</Text>
          <Text style={styles.draftSubject} numberOfLines={2}>{result.introEmail.subject}</Text>
          <Text style={styles.draftStatus}>Status: {result.introEmail.status} · approve in Outreach to send</Text>
        </View>
      ) : null}
      {result.followUpTask ? (
        <View style={styles.draftRow}>
          <Text style={styles.draftLabel}>Follow-up task created</Text>
          <Text style={styles.draftStatus}>Status: {result.followUpTask.status} · approval required</Text>
        </View>
      ) : null}

      {result.ranked.length > 1 ? (
        <Pressable style={styles.toggleBtn} onPress={() => setShowRanked((v) => !v)} testID="ivx-toggle-ranked">
          {showRanked ? <ChevronUp size={14} color={Colors.primary} /> : <ChevronDown size={14} color={Colors.primary} />}
          <Text style={styles.toggleBtnText}>{showRanked ? 'Hide ranked candidates' : `Show all ${result.ranked.length} ranked candidates`}</Text>
        </Pressable>
      ) : null}
      {showRanked
        ? result.ranked.map((c) => (
            <View key={c.contactId} style={styles.rankedRow}>
              <Text style={styles.rankedName} numberOfLines={1}>{c.name}{c.company ? ` · ${c.company}` : ''}</Text>
              <Text style={[styles.rankedScore, { color: scoreTone(c.matchScore) }]}>{c.matchScore}</Text>
            </View>
          ))
        : null}

      <Text style={styles.note}>{result.note}</Text>
    </View>
  );
}

function CommandCenterContent() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [dealQuery, setDealQuery] = useState<string>('');

  const query = useQuery<CapitalCommandCenter | null>({
    queryKey: ['ivx-capital-command-center'],
    queryFn: getCapitalCommandCenter});

  const workflow = useMutation<BestInvestorWorkflowResult | null, Error, string>({
    mutationFn: (q: string) => runBestInvestor(q),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ivx-capital-command-center'] });
    }});

  const dashboard = query.data ?? null;
  const pipeline = dashboard?.capitalPipeline ?? null;

  const onRun = useCallback(() => {
    const q = dealQuery.trim();
    if (!q) return;
    workflow.mutate(q);
  }, [dealQuery, workflow]);

  const result = workflow.data ?? null;

  const pipelineTiles = useMemo(() => ([
    { label: 'Total pipeline', value: usd(pipeline?.totalPipeline ?? 0) },
    { label: 'Raised', value: usd(pipeline?.capitalRaised ?? 0), tone: Colors.success },
    { label: 'Weighted', value: usd(pipeline?.weightedPipeline ?? 0) },
    { label: 'This month', value: usd(dashboard?.capitalRaisedThisMonth ?? 0), tone: Colors.success },
  ]), [pipeline, dashboard]);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        refreshControl={<RefreshControl tintColor={Colors.primary} refreshing={query.isFetching} onRefresh={() => { void query.refetch(); }} />}
        testID="ivx-command-center-scroll"
      >
        <View style={styles.heroCard}>
          <View style={styles.heroHeaderRow}>
            <LayoutDashboard size={18} color={Colors.primary} />
            <Text style={styles.heroTitle}>Capital Command Center</Text>
          </View>
          <Text style={styles.heroSubtitle}>
            {dashboard?.headline ?? 'Your at-a-glance capital command surface — best investor & buyer today, the opportunity to push, the pipeline, and exactly who needs a meeting or follow-up. Every figure is grounded in your live CRM, pipeline, matching and deal-tracking records.'}
          </Text>
        </View>

        {/* Find the best investor for Deal X */}
        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Search size={16} color={Colors.primary} />
            <Text style={styles.sectionTitle}>Find the best investor for a deal</Text>
          </View>
          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              placeholder="Deal name, e.g. Casa Rosario"
              placeholderTextColor={Colors.textTertiary}
              value={dealQuery}
              onChangeText={setDealQuery}
              autoCapitalize="words"
              returnKeyType="search"
              onSubmitEditing={onRun}
              testID="ivx-best-investor-input"
            />
            <Pressable
              style={[styles.runBtn, (!dealQuery.trim() || workflow.isPending) ? styles.runBtnDisabled : null]}
              onPress={onRun}
              disabled={!dealQuery.trim() || workflow.isPending}
              testID="ivx-run-best-investor"
            >
              {workflow.isPending ? <ShimmerIndicator size="small" color={Colors.black} /> : <Text style={styles.runBtnText}>Find</Text>}
            </Pressable>
          </View>
          {workflow.isError ? (
            <Text style={styles.errorText}>{workflow.error instanceof Error ? workflow.error.message : 'Workflow failed.'}</Text>
          ) : null}
        </View>

        {result ? <WorkflowResultCard result={result} /> : null}

        {/* Today's best */}
        <View style={styles.bestGrid}>
          <BestCard
            title="Best investor today"
            icon={<TrendingUp size={14} color={Colors.primary} />}
            name={dashboard?.bestInvestorToday?.name ?? 'None yet'}
            subtitle={dashboard?.bestInvestorToday ? `on ${dashboard.bestInvestorToday.dealName}` : 'Add CRM + deals to surface a match.'}
            score={dashboard?.bestInvestorToday?.matchScore}
            evidence={dashboard?.bestInvestorToday?.evidence}
          />
          <BestCard
            title="Best buyer today"
            icon={<ShoppingBag size={14} color={Colors.primary} />}
            name={dashboard?.bestBuyerToday?.name ?? 'None yet'}
            subtitle={dashboard?.bestBuyerToday ? `on ${dashboard.bestBuyerToday.dealName}` : 'Add buyer contacts to match.'}
            score={dashboard?.bestBuyerToday?.matchScore}
            evidence={dashboard?.bestBuyerToday?.evidence}
          />
          <BestCard
            title="Best opportunity today"
            icon={<Target size={14} color={Colors.primary} />}
            name={dashboard?.bestOpportunityToday?.name ?? 'None yet'}
            subtitle={dashboard?.bestOpportunityToday ? dashboard.bestOpportunityToday.rationale : 'Publish deals to rank opportunities.'}
            score={dashboard?.bestOpportunityToday?.weightedScore}
          />
        </View>

        {/* Capital pipeline */}
        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Banknote size={16} color={Colors.primary} />
            <Text style={styles.sectionTitle}>Capital pipeline</Text>
          </View>
          <View style={styles.metricGrid}>
            {pipelineTiles.map((t) => (
              <MetricTile key={t.label} label={t.label} value={t.value} tone={t.tone} />
            ))}
          </View>
          <View style={styles.metricGrid}>
            <MetricTile label="Investors" value={pipeline?.activeInvestors ?? 0} />
            <MetricTile label="Buyers" value={pipeline?.activeBuyers ?? 0} />
            <MetricTile label="In progress" value={pipeline?.dealsInProgress ?? 0} />
          </View>
        </View>

        {/* Attention sections */}
        <AttentionSection
          title="Meetings needed"
          icon={<CalendarClock size={16} color={Colors.warning} />}
          items={dashboard?.meetingsNeeded ?? []}
          tone={Colors.warning}
        />
        <AttentionSection
          title="Follow-ups needed"
          icon={<UserCheck size={16} color={Colors.primary} />}
          items={dashboard?.followUpsNeeded ?? []}
          tone={Colors.primary}
        />
        <AttentionSection
          title="Deals at risk"
          icon={<AlertTriangle size={16} color={Colors.error} />}
          items={dashboard?.dealsAtRisk ?? []}
          tone={Colors.error}
        />

        {query.isError ? (
          <Text style={styles.errorText}>{query.error instanceof Error ? query.error.message : 'Could not load the command center.'}</Text>
        ) : null}
        {query.isLoading ? (
          <View style={styles.card}><ShimmerIndicator size="small" color={Colors.primary} /></View>
        ) : null}
        {dashboard ? <Text style={styles.note}>{dashboard.note}</Text> : null}
      </ScrollView>
    </View>
  );
}

export default function CapitalCommandCenterScreen() {
  return (
    <ErrorBoundary>
      <Stack.Screen options={{ title: 'Capital Command Center' }} />
      <CommandCenterContent />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, gap: 14 },
  heroCard: { backgroundColor: Colors.card, borderRadius: 18, padding: 18, gap: 10, borderWidth: 1, borderColor: Colors.border },
  heroHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  heroSubtitle: { fontSize: 12.5, lineHeight: 18, color: Colors.textSecondary },
  card: { backgroundColor: Colors.card, borderRadius: 16, padding: 15, gap: 11, borderWidth: 1, borderColor: Colors.border },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { flex: 1, fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  countPill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 12, borderWidth: 1.5 },
  countPillText: { fontSize: 12, fontWeight: '800' as const },
  searchRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  searchInput: { flex: 1, backgroundColor: Colors.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, color: Colors.text, borderWidth: 1, borderColor: Colors.border },
  runBtn: { backgroundColor: Colors.primary, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', minWidth: 72 },
  runBtnDisabled: { opacity: 0.5 },
  runBtnText: { fontSize: 14, fontWeight: '800' as const, color: Colors.black },
  errorText: { fontSize: 12.5, color: Colors.error, lineHeight: 18 },
  workflowCard: { backgroundColor: Colors.card, borderRadius: 16, padding: 15, gap: 10, borderWidth: 1, borderColor: Colors.primary },
  stepRow: { flexDirection: 'row', gap: 9, alignItems: 'flex-start' },
  stepDot: { width: 9, height: 9, borderRadius: 5, marginTop: 4 },
  stepDotDone: { backgroundColor: Colors.success },
  stepDotFailed: { backgroundColor: Colors.error },
  stepDotSkipped: { backgroundColor: Colors.textTertiary },
  stepCopy: { flex: 1, gap: 1 },
  stepLabel: { fontSize: 13, fontWeight: '700' as const, color: Colors.text },
  stepDetail: { fontSize: 12, lineHeight: 16, color: Colors.textSecondary },
  bestInvestorBlock: { backgroundColor: Colors.surface, borderRadius: 12, padding: 12, gap: 4, borderWidth: 1, borderColor: Colors.border },
  bestInvestorTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bestInvestorName: { flex: 1, fontSize: 15, fontWeight: '800' as const, color: Colors.text },
  bestInvestorScore: { fontSize: 16, fontWeight: '800' as const },
  bestInvestorCompany: { fontSize: 12.5, color: Colors.textSecondary },
  evidenceItem: { fontSize: 12, lineHeight: 17, color: Colors.textSecondary },
  draftRow: { backgroundColor: Colors.surface, borderRadius: 10, padding: 11, gap: 3, borderWidth: 1, borderColor: Colors.border },
  draftLabel: { fontSize: 12, fontWeight: '700' as const, color: Colors.success, textTransform: 'uppercase', letterSpacing: 0.3 },
  draftSubject: { fontSize: 13, color: Colors.text, fontWeight: '600' as const },
  draftStatus: { fontSize: 11.5, color: Colors.textTertiary },
  toggleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: Colors.border },
  toggleBtnText: { fontSize: 12.5, fontWeight: '600' as const, color: Colors.primary },
  rankedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  rankedName: { flex: 1, fontSize: 13, color: Colors.textSecondary },
  rankedScore: { fontSize: 14, fontWeight: '800' as const },
  bestGrid: { gap: 10 },
  bestCard: { backgroundColor: Colors.card, borderRadius: 14, padding: 14, gap: 5, borderWidth: 1, borderColor: Colors.border },
  bestHeader: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  bestTitle: { flex: 1, fontSize: 11.5, fontWeight: '700' as const, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.4 },
  bestScore: { fontSize: 17, fontWeight: '800' as const },
  bestName: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  bestSubtitle: { fontSize: 12, lineHeight: 16, color: Colors.textSecondary },
  bestEvidence: { fontSize: 11.5, lineHeight: 16, color: Colors.textTertiary },
  metricGrid: { flexDirection: 'row', gap: 8 },
  metricTile: { flex: 1, backgroundColor: Colors.surface, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 6, alignItems: 'center', gap: 2, borderWidth: 1, borderColor: Colors.border },
  metricValue: { fontSize: 15, fontWeight: '800' as const, color: Colors.text },
  metricLabel: { fontSize: 9.5, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3, textAlign: 'center' },
  attentionRow: { flexDirection: 'row', gap: 9, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  attentionCopy: { flex: 1, gap: 2 },
  attentionName: { fontSize: 13.5, fontWeight: '600' as const, color: Colors.text },
  attentionReason: { fontSize: 12, lineHeight: 16, color: Colors.textTertiary },
  emptyRow: { fontSize: 12.5, color: Colors.textTertiary, fontStyle: 'italic' },
  note: { fontSize: 11.5, color: Colors.textTertiary, lineHeight: 16 }});
