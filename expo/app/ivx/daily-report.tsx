import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View} from "react-native";
import {
  Bug,
  Wrench,
  CheckCircle2,
  Sparkles,
  Cpu,
  Building2,
  Handshake,
  Globe,
  Telescope,
  TrendingUp,
  ListChecks,
  FileText,
  RefreshCw,
  Search,
  History,
  ListPlus,
  Send,
  X} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import {
  getDailyReport,
  generateDailyReport,
  getDailyReportHistory,
  REPORT_SECTION_ORDER,
  type DailyExecutiveReport,
  type ReportSection,
  type ReportHistoryEntry} from '@/src/modules/ivx-developer/dailyReportService';
import { convertIdeaToTask } from '@/src/modules/ivx-developer/ideaTaskService';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

const POLL_INTERVAL_MS = 60000;

function haptic(): void {
  if (Platform.OS !== 'web') {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  }
}

const SECTION_ICONS: Record<string, React.ReactNode> = {
  bugsFound: <Bug size={15} color={Colors.error} />,
  fixesProposed: <Wrench size={15} color={Colors.warning} />,
  fixesCompleted: <CheckCircle2 size={15} color={Colors.success} />,
  productImprovements: <Sparkles size={15} color={Colors.primary} />,
  technologyIdeas: <Cpu size={15} color={Colors.info} />,
  investorAcquisitionIdeas: <Building2 size={15} color={Colors.blue} />,
  realtorJvIdeas: <Handshake size={15} color={Colors.blue} />,
  landingRecommendations: <Globe size={15} color={Colors.info} />,
  competitorObservations: <Telescope size={15} color={Colors.warning} />,
  revenueOpportunities: <TrendingUp size={15} color={Colors.success} />,
  nextBestActions: <ListChecks size={15} color={Colors.primary} />};

function SectionCard({
  icon,
  section,
  reportDate,
  onConvert,
  onSend}: {
  icon: React.ReactNode;
  section: ReportSection;
  reportDate: string;
  onConvert: (section: ReportSection, finding: ReportSection['findings'][number]) => void;
  onSend: (section: ReportSection, finding: ReportSection['findings'][number]) => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeaderRow}>
        {icon}
        <Text style={styles.cardTitle}>{section.title}</Text>
        <View style={styles.countPill}>
          <Text style={styles.countPillText}>{section.count}</Text>
        </View>
      </View>
      {section.findings.length > 0 ? (
        section.findings.map((f, i) => (
          <View key={i} style={styles.findingRow}>
            <View style={styles.findingDot} />
            <View style={styles.findingCopy}>
              <Text style={styles.findingTitle}>{f.title}</Text>
              <Text style={styles.findingDetail} numberOfLines={4}>{f.detail}</Text>
              {f.weight ? <Text style={styles.findingWeight}>{f.weight}</Text> : null}
              <View style={styles.findingActions}>
                <Pressable
                  style={({ pressed }) => [styles.findingBtn, pressed && styles.findingBtnPressed]}
                  onPress={() => onConvert(section, f)}
                  testID={`convert-task-${section.key}-${i}`}
                >
                  <ListPlus size={13} color={Colors.primary} />
                  <Text style={styles.findingBtnText}>Convert → Task</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.findingBtnSolid, pressed && styles.findingBtnPressed]}
                  onPress={() => onSend(section, f)}
                  testID={`send-senior-${section.key}-${i}`}
                >
                  <Send size={13} color={Colors.black} />
                  <Text style={styles.findingBtnSolidText}>Send to Senior Dev</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ))
      ) : (
        <Text style={styles.emptyNote}>{section.note}</Text>
      )}
      {section.findings.length > 0 ? <Text style={styles.footnote}>{section.note}</Text> : null}
    </View>
  );
}

function DailyReportContent() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [query, setQuery] = useState<string>('');
  const [historyOpen, setHistoryOpen] = useState<boolean>(false);
  const [convertNote, setConvertNote] = useState<string | null>(null);

  const reportQuery = useQuery<DailyExecutiveReport | null>({
    queryKey: ['ivx-daily-report'],
    queryFn: getDailyReport,
    refetchInterval: POLL_INTERVAL_MS});

  const historyQuery = useQuery<ReportHistoryEntry[]>({
    queryKey: ['ivx-daily-report-history'],
    queryFn: getDailyReportHistory,
    enabled: historyOpen});

  const regenerate = useMutation({
    mutationFn: generateDailyReport,
    onSuccess: (data) => {
      queryClient.setQueryData(['ivx-daily-report'], data);
      void queryClient.invalidateQueries({ queryKey: ['ivx-daily-report-history'] });
    }});

  const data = reportQuery.data ?? null;
  const onRefresh = useCallback(() => { void reportQuery.refetch(); }, [reportQuery]);
  const onRegenerate = useCallback(() => { regenerate.mutate(); }, [regenerate]);

  const onConvert = useCallback(
    (section: ReportSection, finding: ReportSection['findings'][number]) => {
      haptic();
      void convertIdeaToTask({
        sectionKey: section.key,
        sectionTitle: section.title,
        findingTitle: finding.title,
        findingDetail: finding.detail,
        reportDate: data?.reportDate ?? new Date().toISOString().slice(0, 10)}).then(() => {
        setConvertNote(`Saved as task: ${finding.title}`);
      }).catch((err: unknown) => {
        setConvertNote(err instanceof Error ? err.message : 'Could not save task.');
      });
    },
    [data?.reportDate],
  );

  const onSend = useCallback(
    (section: ReportSection, finding: ReportSection['findings'][number]) => {
      haptic();
      const goal = `Act as the IVX senior developer and deliver this improvement from the daily report: ${finding.title}`;
      const plan = [
        `1. Investigate the area related to: ${finding.title}.`,
        `2. Context from the daily report: ${finding.detail}`,
        '3. Make only additive, crash-safe changes.',
        '4. Run focused validation/tests.',
        '5. Commit changed files and verify production health after deploy.',
      ].join('\n');
      router.push({
        pathname: '/admin/ivx-developer-workspace',
        params: { seniorGoal: goal, seniorPlan: plan, seniorSource: section.title }} as never);
    },
    [router],
  );

  const filteredSections = useMemo<(keyof DailyExecutiveReport['sections'])[]>(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return REPORT_SECTION_ORDER;
    return REPORT_SECTION_ORDER.filter((key) => {
      const section = data.sections[key];
      const hay = `${section.title} ${section.note} ${section.findings
        .map((f) => `${f.title} ${f.detail}`)
        .join(' ')}`.toLowerCase();
      return hay.includes(q);
    });
  }, [data, query]);

  const generatedLabel = data
    ? new Date(data.generatedAt).toLocaleString()
    : null;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 48 }]}
      refreshControl={<RefreshControl tintColor={Colors.primary} refreshing={reportQuery.isFetching} onRefresh={onRefresh} />}
      testID="ivx-daily-report-scroll"
    >
      <View style={styles.heroCard}>
        <View style={styles.heroHeaderRow}>
          <FileText size={18} color={Colors.primary} />
          <Text style={styles.heroTitle}>Daily Executive Report</Text>
        </View>
        <Text style={styles.heroSubtitle}>
          {data?.headline ?? 'The 24-hour briefing — bugs, fixes, ideas, growth, and next best actions, composed from every IVX engine.'}
        </Text>
        {generatedLabel ? (
          <Text style={styles.heroMeta}>
            {data?.reportDate} · generated {generatedLabel} · trigger {data?.trigger} · {data?.sourcesScanned.length ?? 0} source(s)
          </Text>
        ) : null}
        <Pressable
          style={({ pressed }) => [styles.regenButton, pressed && styles.regenButtonPressed]}
          onPress={onRegenerate}
          disabled={regenerate.isPending}
        >
          {regenerate.isPending ? (
            <ShimmerIndicator size="small" color={Colors.black} />
          ) : (
            <>
              <RefreshCw size={15} color={Colors.black} />
              <Text style={styles.regenButtonText}>Generate today&apos;s report</Text>
            </>
          )}
        </Pressable>
      </View>

      <Pressable
        style={({ pressed }) => [styles.historyToggle, pressed && styles.findingBtnPressed]}
        onPress={() => setHistoryOpen((open) => !open)}
        testID="ivx-daily-report-history-toggle"
      >
        <History size={15} color={Colors.primary} />
        <Text style={styles.historyToggleText}>{historyOpen ? 'Hide report history' : 'Show report history'}</Text>
      </Pressable>

      {historyOpen ? (
        <View style={styles.card}>
          {historyQuery.isLoading ? (
            <ShimmerIndicator size="small" color={Colors.primary} />
          ) : (historyQuery.data?.length ?? 0) > 0 ? (
            historyQuery.data!.map((entry) => (
              <View key={entry.reportId} style={styles.historyRow}>
                <FileText size={13} color={Colors.textSecondary} />
                <View style={styles.historyCopy}>
                  <Text style={styles.historyHeadline} numberOfLines={2}>{entry.headline}</Text>
                  <Text style={styles.historyMeta}>
                    {entry.reportDate} · {new Date(entry.generatedAt).toLocaleString()} · {entry.trigger}
                  </Text>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.emptyNote}>
              {historyQuery.error instanceof Error ? historyQuery.error.message : 'No previous reports yet.'}
            </Text>
          )}
        </View>
      ) : null}

      {data ? (
        <View style={styles.searchRow}>
          <Search size={15} color={Colors.textSecondary} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search ideas, fixes, sections…"
            placeholderTextColor={Colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            testID="ivx-daily-report-search"
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <X size={15} color={Colors.textSecondary} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {convertNote ? (
        <Pressable onPress={() => setConvertNote(null)} style={styles.toast}>
          <CheckCircle2 size={14} color={Colors.success} />
          <Text style={styles.toastText}>{convertNote}</Text>
        </Pressable>
      ) : null}

      {data ? (
        <>
          {filteredSections.length > 0 ? (
            filteredSections.map((key) => (
              <SectionCard
                key={key}
                icon={SECTION_ICONS[key]}
                section={data.sections[key]}
                reportDate={data.reportDate}
                onConvert={onConvert}
                onSend={onSend}
              />
            ))
          ) : (
            <View style={styles.card}>
              <Text style={styles.emptyNote}>No sections match “{query}”.</Text>
            </View>
          )}
          <Text style={styles.disclaimer}>{data.disclaimer}</Text>
        </>
      ) : (
        <View style={styles.card}>
          {reportQuery.isLoading ? (
            <ShimmerIndicator size="small" color={Colors.primary} />
          ) : (
            <Text style={styles.emptyNote}>
              {reportQuery.error instanceof Error ? reportQuery.error.message : 'No report yet — generate today&apos;s report.'}
            </Text>
          )}
        </View>
      )}
    </ScrollView>
  );
}

export default function DailyReportScreen() {
  return (
    <ErrorBoundary>
      <Stack.Screen options={{ title: 'Daily Report' }} />
      <DailyReportContent />
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
  heroMeta: { fontSize: 11, color: Colors.textSecondary },
  regenButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 12, marginTop: 4 },
  regenButtonPressed: { opacity: 0.85 },
  regenButtonText: { fontSize: 14, fontWeight: '700' as const, color: Colors.black },
  card: { backgroundColor: Colors.card, borderRadius: 16, padding: 16, gap: 12, borderWidth: 1, borderColor: Colors.border },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 14, fontWeight: '700' as const, color: Colors.text, flex: 1 },
  countPill: { backgroundColor: Colors.backgroundSecondary, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 2, borderWidth: 1, borderColor: Colors.border },
  countPillText: { fontSize: 12, fontWeight: '800' as const, color: Colors.text },
  findingRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  findingDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.primary, marginTop: 6 },
  findingCopy: { flex: 1, gap: 2 },
  findingTitle: { fontSize: 13.5, fontWeight: '700' as const, color: Colors.text, lineHeight: 18 },
  findingDetail: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },
  findingWeight: { fontSize: 11, fontWeight: '600' as const, color: Colors.primary, textTransform: 'capitalize' },
  emptyNote: { fontSize: 12.5, color: Colors.textSecondary, lineHeight: 18 },
  footnote: { fontSize: 11.5, color: Colors.textSecondary, lineHeight: 16, fontStyle: 'italic' as const },
  disclaimer: { fontSize: 11, color: Colors.textSecondary, lineHeight: 16, fontStyle: 'italic' as const, paddingHorizontal: 4 },
  findingActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  findingBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.backgroundSecondary, borderRadius: 9, paddingVertical: 7, paddingHorizontal: 10, borderWidth: 1, borderColor: Colors.border },
  findingBtnText: { fontSize: 11.5, fontWeight: '700' as const, color: Colors.primary },
  findingBtnSolid: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.primary, borderRadius: 9, paddingVertical: 7, paddingHorizontal: 10 },
  findingBtnSolidText: { fontSize: 11.5, fontWeight: '700' as const, color: Colors.black },
  findingBtnPressed: { opacity: 0.8 },
  historyToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.card, borderRadius: 12, paddingVertical: 11, borderWidth: 1, borderColor: Colors.border },
  historyToggleText: { fontSize: 13, fontWeight: '700' as const, color: Colors.primary },
  historyRow: { flexDirection: 'row', gap: 9, alignItems: 'flex-start' },
  historyCopy: { flex: 1, gap: 2 },
  historyHeadline: { fontSize: 13, fontWeight: '600' as const, color: Colors.text, lineHeight: 18 },
  historyMeta: { fontSize: 11, color: Colors.textSecondary },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.card, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4, borderWidth: 1, borderColor: Colors.border },
  searchInput: { flex: 1, fontSize: 14, color: Colors.text, paddingVertical: 10 },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.card, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 14, borderWidth: 1, borderColor: Colors.success },
  toastText: { flex: 1, fontSize: 12.5, fontWeight: '600' as const, color: Colors.text }});
