import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { Stack } from 'expo-router';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View} from "react-native";
import {
  Banknote,
  Building,
  ChevronDown,
  ChevronUp,
  Crosshair,
  Handshake,
  MapPin,
  ShoppingBag,
  TrendingUp} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  getDealMatching,
  MATCH_ROLES,
  type DealMatch,
  type DealMatchSet,
  type DealMatchingResult,
  type MatchRole} from '@/src/modules/ivx-developer/dealMatchingService';

const ROLE_LABEL: Record<MatchRole, string> = {
  investor: 'Investor', buyer: 'Buyer', lender: 'Lender', partner: 'Partner'};

function RoleIcon({ role, size, color }: { role: MatchRole; size: number; color: string }) {
  if (role === 'investor') return <TrendingUp size={size} color={color} />;
  if (role === 'buyer') return <ShoppingBag size={size} color={color} />;
  if (role === 'lender') return <Banknote size={size} color={color} />;
  return <Handshake size={size} color={color} />;
}

function scoreTone(score: number): string {
  if (score >= 70) return Colors.success;
  if (score >= 45) return Colors.warning;
  return Colors.textTertiary;
}

function MetricTile({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <View style={styles.metricTile}>
      <Text style={[styles.metricValue, tone ? { color: tone } : null]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function MatchRow({ match }: { match: DealMatch }) {
  const [open, setOpen] = useState<boolean>(false);
  const tone = scoreTone(match.matchScore);
  return (
    <View style={styles.matchRow}>
      <Pressable style={styles.matchHeader} onPress={() => setOpen((v) => !v)} testID={`ivx-match-${match.contactId}`}>
        <View style={[styles.roleBadge, { borderColor: tone }]}>
          <RoleIcon role={match.role} size={12} color={tone} />
          <Text style={[styles.roleBadgeText, { color: tone }]}>{ROLE_LABEL[match.role]}</Text>
        </View>
        <View style={styles.matchTitleBlock}>
          <Text style={styles.matchName} numberOfLines={1}>{match.name}</Text>
          {match.company ? <Text style={styles.matchCompany} numberOfLines={1}>{match.company}</Text> : null}
        </View>
        <Text style={[styles.matchScore, { color: tone }]}>{match.matchScore}</Text>
        {open ? <ChevronUp size={16} color={Colors.textTertiary} /> : <ChevronDown size={16} color={Colors.textTertiary} />}
      </Pressable>

      <View style={styles.fitGrid}>
        {[
          { label: 'Geography', dim: match.geographyFit },
          { label: 'Capital', dim: match.capitalFit },
          { label: 'Timeline', dim: match.timelineFit },
        ].map((f) => (
          <View key={f.label} style={styles.fitCell}>
            <Text style={styles.fitLabel}>{f.label}</Text>
            <Text style={[styles.fitValue, f.dim.available ? { color: scoreTone(f.dim.score) } : styles.fitValueMuted]}>
              {f.dim.available ? `${f.dim.score}` : 'n/a'}
            </Text>
          </View>
        ))}
      </View>

      {open ? (
        <View style={styles.detailBlock}>
          {match.evidence.length > 0 ? (
            <View style={styles.detailGroup}>
              <Text style={styles.detailHeader}>Evidence</Text>
              {match.evidence.map((e, i) => (
                <Text key={`e-${i}`} style={styles.detailItem}>{`• ${e}`}</Text>
              ))}
            </View>
          ) : null}
          {match.riskNotes.length > 0 ? (
            <View style={styles.detailGroup}>
              <Text style={[styles.detailHeader, { color: Colors.warning }]}>Risk notes</Text>
              {match.riskNotes.map((r, i) => (
                <Text key={`r-${i}`} style={styles.detailItemMuted}>{`• ${r}`}</Text>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function DealCard({ set }: { set: DealMatchSet }) {
  const [showAll, setShowAll] = useState<boolean>(false);
  const bestMatches = useMemo(
    () => MATCH_ROLES.map((role) => set.best[role]).filter((m): m is DealMatch => m !== null),
    [set.best],
  );
  const shown = showAll ? set.matches : bestMatches;

  return (
    <View style={styles.card} testID={`ivx-deal-${set.dealId}`}>
      <View style={styles.dealHeader}>
        <Building size={16} color={Colors.primary} />
        <Text style={styles.dealName} numberOfLines={1}>{set.dealName}</Text>
      </View>
      {set.dealLocation ? (
        <View style={styles.metaRow}><MapPin size={12} color={Colors.textTertiary} /><Text style={styles.metaText}>{set.dealLocation}</Text></View>
      ) : null}
      <Text style={styles.dealSummary}>{set.dealSummary}</Text>

      {shown.length === 0 ? (
        <Text style={styles.noMatch}>No CRM contacts to match yet — add investors/buyers to score against this deal.</Text>
      ) : (
        shown.map((m) => <MatchRow key={`${set.dealId}-${m.contactId}`} match={m} />)
      )}

      {set.matches.length > bestMatches.length ? (
        <Pressable style={styles.toggleBtn} onPress={() => setShowAll((v) => !v)} testID={`ivx-deal-toggle-${set.dealId}`}>
          <Text style={styles.toggleBtnText}>
            {showAll ? 'Show best per role' : `Show all ${set.matches.length} contacts`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function DealMatchingContent() {
  const insets = useSafeAreaInsets();
  const query = useQuery<DealMatchingResult | null>({
    queryKey: ['ivx-deal-matching'],
    queryFn: getDealMatching});

  const result = query.data ?? null;
  const deals = useMemo(() => result?.deals ?? [], [result]);
  const summary = result?.summary ?? null;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        refreshControl={<RefreshControl tintColor={Colors.primary} refreshing={query.isFetching} onRefresh={() => { void query.refetch(); }} />}
        testID="ivx-deal-matching-scroll"
      >
        <View style={styles.heroCard}>
          <View style={styles.heroHeaderRow}>
            <Crosshair size={18} color={Colors.primary} />
            <Text style={styles.heroTitle}>Deal Matching</Text>
          </View>
          <Text style={styles.heroSubtitle}>
            For every active IVX deal, the best-fit CRM contacts per role — investor, buyer, lender, partner — scored on geography, capital, and timeline fit with the exact evidence and risk notes. Relationships are never invented; matches are scored only from data that exists on the deal and the contact.
          </Text>
          <View style={styles.metricGrid}>
            <MetricTile label="Deals" value={summary?.deals ?? 0} />
            <MetricTile label="Contacts" value={summary?.contacts ?? 0} />
            <MetricTile label="Strong" value={summary?.strongMatches ?? 0} tone={Colors.success} />
          </View>
          {result ? <Text style={styles.note}>{result.note}</Text> : null}
        </View>

        {query.isError ? (
          <Text style={styles.errorText}>{query.error instanceof Error ? query.error.message : 'Could not load matches.'}</Text>
        ) : null}

        {query.isLoading ? (
          <View style={styles.card}><ShimmerIndicator size="small" color={Colors.primary} /></View>
        ) : deals.length === 0 ? (
          <View style={styles.emptyCard}>
            <Crosshair size={26} color={Colors.textTertiary} />
            <Text style={styles.emptyTitle}>No active deals to match</Text>
            <Text style={styles.emptyBody}>Publish deals in jv_deals and add CRM contacts — IVX matches them automatically.</Text>
          </View>
        ) : (
          deals.map((set) => <DealCard key={set.dealId} set={set} />)
        )}
      </ScrollView>
    </View>
  );
}

export default function DealMatchingScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  return (
    <ErrorBoundary>
      <Stack.Screen options={{ title: 'Deal Matching' }} />
      <DealMatchingContent />
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
  note: { fontSize: 11.5, color: Colors.textTertiary, lineHeight: 16 },
  errorText: { fontSize: 12.5, color: Colors.error, lineHeight: 18 },
  card: { backgroundColor: Colors.card, borderRadius: 16, padding: 15, gap: 11, borderWidth: 1, borderColor: Colors.border },
  dealHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dealName: { flex: 1, fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 12, color: Colors.textSecondary },
  dealSummary: { fontSize: 11.5, color: Colors.textTertiary, lineHeight: 16 },
  noMatch: { fontSize: 12.5, color: Colors.textTertiary, lineHeight: 18, fontStyle: 'italic' },
  matchRow: { backgroundColor: Colors.surface, borderRadius: 12, padding: 12, gap: 9, borderWidth: 1, borderColor: Colors.border },
  matchHeader: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  roleBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 14, borderWidth: 1.5 },
  roleBadgeText: { fontSize: 10.5, fontWeight: '700' as const },
  matchTitleBlock: { flex: 1, gap: 1 },
  matchName: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  matchCompany: { fontSize: 11.5, color: Colors.textSecondary },
  matchScore: { fontSize: 18, fontWeight: '800' as const },
  fitGrid: { flexDirection: 'row', gap: 8 },
  fitCell: { flex: 1, backgroundColor: Colors.card, borderRadius: 9, paddingVertical: 8, alignItems: 'center', gap: 2, borderWidth: 1, borderColor: Colors.border },
  fitLabel: { fontSize: 10, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3 },
  fitValue: { fontSize: 15, fontWeight: '800' as const, color: Colors.text },
  fitValueMuted: { color: Colors.textTertiary, fontSize: 13 },
  detailBlock: { gap: 10, borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 9 },
  detailGroup: { gap: 3 },
  detailHeader: { fontSize: 11.5, fontWeight: '700' as const, color: Colors.text, textTransform: 'uppercase', letterSpacing: 0.3 },
  detailItem: { fontSize: 12, lineHeight: 17, color: Colors.textSecondary },
  detailItemMuted: { fontSize: 12, lineHeight: 17, color: Colors.textTertiary },
  toggleBtn: { alignItems: 'center', paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: Colors.border },
  toggleBtnText: { fontSize: 12.5, fontWeight: '600' as const, color: Colors.primary },
  emptyCard: { backgroundColor: Colors.card, borderRadius: 16, padding: 26, gap: 8, alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  emptyTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  emptyBody: { fontSize: 12.5, lineHeight: 18, color: Colors.textSecondary, textAlign: 'center' }});
