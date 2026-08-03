import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View} from "react-native";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Flame,
  Gauge,
  Snowflake,
  Sun} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  getLeadScoring,
  type LeadCategory,
  type LeadScore,
  type LeadScoringResult} from '@/src/modules/ivx-developer/leadScoringService';

const CATEGORY_TONE: Record<LeadCategory, string> = {
  hot: Colors.error,
  warm: Colors.warning,
  cold: Colors.info};
const CATEGORY_LABEL: Record<LeadCategory, string> = { hot: 'Hot', warm: 'Warm', cold: 'Cold' };

function CategoryIcon({ category, size }: { category: LeadCategory; size: number }) {
  if (category === 'hot') return <Flame size={size} color={CATEGORY_TONE.hot} />;
  if (category === 'warm') return <Sun size={size} color={CATEGORY_TONE.warm} />;
  return <Snowflake size={size} color={CATEGORY_TONE.cold} />;
}

function MetricTile({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <View style={styles.metricTile}>
      <Text style={[styles.metricValue, tone ? { color: tone } : null]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function ScoreBar({ score, tone }: { score: number; tone: string }) {
  return (
    <View style={styles.barTrack}>
      <View style={[styles.barFill, { width: `${Math.max(0, Math.min(100, score))}%`, backgroundColor: tone }]} />
    </View>
  );
}

function LeadCard({ lead, onOpen }: { lead: LeadScore; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState<boolean>(false);
  const tone = CATEGORY_TONE[lead.category];
  return (
    <View style={styles.card} testID={`ivx-lead-${lead.id}`}>
      <Pressable style={styles.cardHeader} onPress={() => onOpen(lead.id)} testID={`ivx-lead-open-${lead.id}`}>
        <View style={styles.scoreCircle}>
          <Text style={[styles.scoreCircleText, { color: tone }]}>{lead.overall}</Text>
        </View>
        <View style={styles.cardTitleBlock}>
          <Text style={styles.cardName} numberOfLines={1}>{lead.name}</Text>
          {lead.company ? <Text style={styles.cardCompany} numberOfLines={1}>{lead.company}</Text> : null}
        </View>
        <View style={[styles.categoryPill, { borderColor: tone }]}>
          <CategoryIcon category={lead.category} size={12} />
          <Text style={[styles.categoryPillText, { color: tone }]}>{CATEGORY_LABEL[lead.category]}</Text>
        </View>
        <ChevronRight size={18} color={Colors.textTertiary} />
      </Pressable>

      <ScoreBar score={lead.overall} tone={tone} />
      <Text style={styles.rationale}>{lead.rationale}</Text>

      <View style={styles.cardFooterRow}>
        <Pressable style={styles.profileBtn} onPress={() => onOpen(lead.id)} testID={`ivx-lead-profile-${lead.id}`}>
          <Text style={styles.profileBtnText}>Open CRM profile</Text>
          <ChevronRight size={14} color={Colors.primary} />
        </Pressable>
        <Pressable style={styles.evidenceToggle} onPress={() => setOpen((v) => !v)} testID={`ivx-lead-evidence-${lead.id}`}>
          <Text style={styles.evidenceToggleText}>{open ? 'Hide evidence' : 'Evidence'}</Text>
          {open ? <ChevronUp size={14} color={Colors.textTertiary} /> : <ChevronDown size={14} color={Colors.textTertiary} />}
        </Pressable>
      </View>

      {open ? (
        <View style={styles.signalList}>
          <Text style={styles.signalHeader}>{`Evidence breakdown · ${lead.evidenceCount} tracked signal(s)`}</Text>
          {lead.signals.map((sig) => (
            <View key={sig.key} style={styles.signalRow}>
              <View style={styles.signalTop}>
                <Text style={[styles.signalLabel, sig.available ? null : styles.signalLabelMuted]}>{sig.label}</Text>
                <Text style={[styles.signalScore, sig.available ? null : styles.signalLabelMuted]}>
                  {sig.available ? `${sig.score}/100` : 'n/a'}
                </Text>
              </View>
              {sig.available ? <ScoreBar score={sig.score} tone={Colors.primary} /> : null}
              <Text style={styles.signalDetail}>{sig.detail}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function LeadScoringContent() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [filter, setFilter] = useState<LeadCategory | 'all'>('all');

  const openProfile = useCallback((id: string) => {
    router.push(`/ivx/contact/${encodeURIComponent(id)}` as never);
  }, [router]);

  const query = useQuery<LeadScoringResult | null>({
    queryKey: ['ivx-lead-scoring'],
    queryFn: getLeadScoring});

  const result = query.data ?? null;
  const leads = useMemo(() => result?.leads ?? [], [result]);
  const summary = result?.summary ?? null;

  const filtered = useMemo(
    () => (filter === 'all' ? leads : leads.filter((l) => l.category === filter)),
    [leads, filter],
  );

  const CATEGORIES: (LeadCategory | 'all')[] = ['all', 'hot', 'warm', 'cold'];
  const countFor = useCallback((c: LeadCategory | 'all') => {
    if (c === 'all') return leads.length;
    return leads.filter((l) => l.category === c).length;
  }, [leads]);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        refreshControl={<RefreshControl tintColor={Colors.primary} refreshing={query.isFetching} onRefresh={() => { void query.refetch(); }} />}
        testID="ivx-lead-scoring-scroll"
      >
        <View style={styles.heroCard}>
          <View style={styles.heroHeaderRow}>
            <Gauge size={18} color={Colors.primary} />
            <Text style={styles.heroTitle}>Lead Scoring</Text>
          </View>
          <Text style={styles.heroSubtitle}>
            Every investor and buyer in the CRM scored 0–100 and bucketed Hot / Warm / Cold from real evidence only — engagement, communication history, capital capacity, deal interest, and geography/asset-class fit against live IVX deals. Untracked signals (e.g. website analytics) are shown as unavailable, never invented.
          </Text>
          <View style={styles.metricGrid}>
            <MetricTile label="Leads" value={summary?.total ?? 0} />
            <MetricTile label="Hot" value={summary?.hot ?? 0} tone={CATEGORY_TONE.hot} />
            <MetricTile label="Warm" value={summary?.warm ?? 0} tone={CATEGORY_TONE.warm} />
            <MetricTile label="Cold" value={summary?.cold ?? 0} tone={CATEGORY_TONE.cold} />
          </View>
          {result ? (
            <Text style={styles.contextNote}>{`Geography context: ${result.context.marketsSource}.`}</Text>
          ) : null}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {CATEGORIES.map((c) => (
            <Pressable
              key={c}
              style={[styles.filterChip, filter === c ? styles.filterChipActive : null]}
              onPress={() => setFilter(c)}
              testID={`ivx-lead-filter-${c}`}
            >
              <Text style={[styles.filterChipText, filter === c ? styles.filterChipTextActive : null]}>
                {`${c === 'all' ? 'All' : CATEGORY_LABEL[c]} (${countFor(c)})`}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {query.isError ? (
          <Text style={styles.errorText}>{query.error instanceof Error ? query.error.message : 'Could not load lead scores.'}</Text>
        ) : null}

        {query.isLoading ? (
          <View style={styles.card}><ShimmerIndicator size="small" color={Colors.primary} /></View>
        ) : filtered.length === 0 ? (
          <View style={styles.emptyCard}>
            <Gauge size={26} color={Colors.textTertiary} />
            <Text style={styles.emptyTitle}>{leads.length === 0 ? 'No leads to score yet' : 'None in this bucket'}</Text>
            <Text style={styles.emptyBody}>
              {leads.length === 0
                ? 'Add investors in the CRM — IVX scores them automatically from real evidence.'
                : 'Switch buckets to see leads in another tier.'}
            </Text>
          </View>
        ) : (
          filtered.map((lead) => <LeadCard key={lead.id} lead={lead} onOpen={openProfile} />)
        )}
      </ScrollView>
    </View>
  );
}

export default function LeadScoringScreen() {
  return (
    <ErrorBoundary>
      <Stack.Screen options={{ title: 'Lead Scoring' }} />
      <LeadScoringContent />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, gap: 14 },
  heroCard: { backgroundColor: Colors.card, borderRadius: 18, padding: 18, gap: 12, borderWidth: 1, borderColor: Colors.border },
  heroHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  heroSubtitle: { fontSize: 12.5, lineHeight: 18, color: Colors.textSecondary },
  metricGrid: { flexDirection: 'row', gap: 8 },
  metricTile: { flex: 1, backgroundColor: Colors.surface, borderRadius: 12, paddingVertical: 12, alignItems: 'center', gap: 2, borderWidth: 1, borderColor: Colors.border },
  metricValue: { fontSize: 18, fontWeight: '800' as const, color: Colors.text },
  metricLabel: { fontSize: 10, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.4 },
  contextNote: { fontSize: 11, color: Colors.textTertiary, lineHeight: 16 },
  filterRow: { gap: 8, paddingVertical: 2, paddingRight: 8 },
  filterChip: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card },
  filterChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterChipText: { fontSize: 12.5, fontWeight: '600' as const, color: Colors.textSecondary },
  filterChipTextActive: { color: Colors.black },
  errorText: { fontSize: 12.5, color: Colors.error, lineHeight: 18 },
  card: { backgroundColor: Colors.card, borderRadius: 16, padding: 15, gap: 10, borderWidth: 1, borderColor: Colors.border },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  scoreCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.surfaceLight, alignItems: 'center', justifyContent: 'center' },
  scoreCircleText: { fontSize: 16, fontWeight: '800' as const },
  cardTitleBlock: { flex: 1, gap: 1 },
  cardName: { fontSize: 15.5, fontWeight: '700' as const, color: Colors.text },
  cardCompany: { fontSize: 12.5, color: Colors.textSecondary },
  categoryPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1.5 },
  categoryPillText: { fontSize: 11, fontWeight: '700' as const },
  barTrack: { height: 7, borderRadius: 4, backgroundColor: Colors.surfaceLight, overflow: 'hidden' },
  barFill: { height: 7, borderRadius: 4 },
  rationale: { fontSize: 12.5, lineHeight: 18, color: Colors.textSecondary },
  cardFooterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  profileBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4 },
  profileBtnText: { fontSize: 13, fontWeight: '700' as const, color: Colors.primary },
  evidenceToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4 },
  evidenceToggleText: { fontSize: 12.5, fontWeight: '600' as const, color: Colors.textTertiary },
  signalList: { gap: 12, marginTop: 4, borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 12 },
  signalHeader: { fontSize: 12, fontWeight: '700' as const, color: Colors.text },
  signalRow: { gap: 5 },
  signalTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  signalLabel: { fontSize: 12.5, fontWeight: '600' as const, color: Colors.text },
  signalLabelMuted: { color: Colors.textTertiary, fontWeight: '500' as const },
  signalScore: { fontSize: 12, fontWeight: '700' as const, color: Colors.text },
  signalDetail: { fontSize: 11.5, lineHeight: 16, color: Colors.textTertiary },
  emptyCard: { backgroundColor: Colors.card, borderRadius: 16, padding: 26, gap: 8, alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  emptyTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  emptyBody: { fontSize: 12.5, lineHeight: 18, color: Colors.textSecondary, textAlign: 'center' }});
