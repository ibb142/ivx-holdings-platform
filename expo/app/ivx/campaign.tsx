import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { Stack, useRouter } from 'expo-router';
import {
  type DimensionValue,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View} from "react-native";
import {
  Briefcase,
  CalendarDays,
  ChevronRight,
  Flame,
  Handshake,
  Target,
  TrendingUp,
  Trophy,
  Users} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  getCampaignReport,
  type CampaignAudience,
  type CampaignCandidate,
  type CampaignDailyReport,
  type CampaignLeadStatus,
  type CampaignLeadView,
  type CampaignReport} from '@/src/modules/ivx-developer/campaignReportService';

const STATUS_META: Record<CampaignLeadStatus, { label: string; color: string }> = {
  new: { label: 'New', color: Colors.info },
  contacted: { label: 'Contacted', color: '#7DD3FC' },
  qualified: { label: 'Qualified', color: Colors.success },
  follow_up: { label: 'Follow-up', color: Colors.warning },
  closed: { label: 'Closed', color: Colors.primary },
  rejected: { label: 'Rejected', color: Colors.textTertiary }};

const AUDIENCE_META: Record<CampaignAudience, { label: string; color: string }> = {
  investor: { label: 'Investor', color: '#A78BFA' },
  buyer: { label: 'Buyer', color: '#38BDF8' },
  jv: { label: 'JV / Capital', color: '#F59E0B' },
  other: { label: 'Other', color: Colors.textTertiary }};

function MetricTile({ label, value, tone, flexBasis }: { label: string; value: string | number; tone?: string; flexBasis: DimensionValue }) {
  return (
    <View style={[styles.metricTile, { flexBasis }]}>
      <Text style={[styles.metricValue, tone ? { color: tone } : null]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function CandidateCard({ icon, title, candidate, tone, onOpen }: { icon: React.ReactNode; title: string; candidate: CampaignCandidate; tone: string; onOpen: (id: string) => void }) {
  return (
    <View style={[styles.candidateCard, { borderColor: tone }]}>
      <View style={styles.candidateHeader}>
        {icon}
        <Text style={styles.candidateTitle}>{title}</Text>
      </View>
      {candidate ? (
        <Pressable style={styles.candidateBody} onPress={() => onOpen(candidate.id)}>
          <Text style={styles.candidateName} numberOfLines={1}>{candidate.name}</Text>
          <Text style={styles.candidateMeta} numberOfLines={1}>{candidate.contact || 'No contact on file'}</Text>
          {candidate.interest ? <Text style={styles.candidateInterest} numberOfLines={1}>{candidate.interest}</Text> : null}
          <View style={[styles.scoreChip, { backgroundColor: tone }]}>
            <Text style={styles.scoreChipText}>{`Score ${candidate.leadScore} · ${candidate.temperature}`}</Text>
          </View>
        </Pressable>
      ) : (
        <Text style={styles.candidateEmpty}>No real lead in this audience yet.</Text>
      )}
    </View>
  );
}

function DailyCard({ day }: { day: CampaignDailyReport }) {
  return (
    <View style={[styles.dayCard, day.isToday ? styles.dayCardToday : null]}>
      <View style={styles.dayHeaderRow}>
        <View style={styles.dayBadge}>
          <Text style={styles.dayBadgeText}>{`Day ${day.dayNumber}`}</Text>
        </View>
        <Text style={styles.dayDate}>{day.date}{day.isToday ? ' · Today' : ''}</Text>
        <View style={styles.dayConvPill}>
          <TrendingUp size={12} color={Colors.success} />
          <Text style={styles.dayConvText}>{`${day.conversionRatePct}%`}</Text>
        </View>
      </View>
      <View style={styles.dayStatsRow}>
        <DayStat label="Leads" value={day.totalLeads} />
        <DayStat label="Buyer" value={day.buyerLeads} tone={AUDIENCE_META.buyer.color} />
        <DayStat label="JV" value={day.jvLeads} tone={AUDIENCE_META.jv.color} />
        <DayStat label="Investor" value={day.investorLeads} tone={AUDIENCE_META.investor.color} />
        <DayStat label="Hot" value={day.hotLeads} tone={Colors.error} />
        <DayStat label="F/up" value={day.followUpRequired} tone={Colors.warning} />
      </View>
      {day.topSource ? <Text style={styles.daySource}>{`Top source: ${day.topSource}`}</Text> : null}
      {day.recommendedNextActions.map((rec, i) => (
        <View key={i} style={styles.recRow}>
          <ChevronRight size={13} color={Colors.textTertiary} />
          <Text style={styles.recText}>{rec}</Text>
        </View>
      ))}
    </View>
  );
}

function DayStat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <View style={styles.dayStat}>
      <Text style={[styles.dayStatValue, tone ? { color: tone } : null]}>{value}</Text>
      <Text style={styles.dayStatLabel}>{label}</Text>
    </View>
  );
}

function LeadRow({ lead, onOpen }: { lead: CampaignLeadView; onOpen: (id: string) => void }) {
  const status = STATUS_META[lead.status];
  const audience = AUDIENCE_META[lead.audience];
  return (
    <Pressable style={styles.leadRow} onPress={() => onOpen(lead.id)}>
      <View style={styles.leadScoreCircle}>
        <Text style={styles.leadScoreText}>{lead.leadScore}</Text>
      </View>
      <View style={styles.leadBody}>
        <Text style={styles.leadName} numberOfLines={1}>{lead.name}</Text>
        <Text style={styles.leadMeta} numberOfLines={1}>{[lead.email, lead.phone].filter(Boolean).join(' · ') || 'No contact'}</Text>
        <Text style={styles.leadNext} numberOfLines={1}>{lead.nextAction}</Text>
      </View>
      <View style={styles.leadTags}>
        <View style={[styles.tagPill, { borderColor: audience.color }]}>
          <Text style={[styles.tagPillText, { color: audience.color }]}>{audience.label}</Text>
        </View>
        <View style={[styles.tagPill, { borderColor: status.color }]}>
          <Text style={[styles.tagPillText, { color: status.color }]}>{status.label}</Text>
        </View>
      </View>
    </Pressable>
  );
}

function CampaignContent() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isTablet = width >= 700;
  const [filter, setFilter] = useState<CampaignAudience | 'all'>('all');

  const query = useQuery<CampaignReport | null>({
    queryKey: ['ivx-campaign-report'],
    queryFn: () => getCampaignReport(10)});

  const report = query.data ?? null;
  const openProfile = useCallback((id: string) => {
    router.push(`/ivx/contact/${encodeURIComponent(id)}` as never);
  }, [router]);

  const leads = useMemo(() => report?.leads ?? [], [report]);
  const filtered = useMemo(
    () => (filter === 'all' ? leads : leads.filter((l) => l.audience === filter)),
    [leads, filter],
  );
  const countFor = useCallback(
    (a: CampaignAudience | 'all') => (a === 'all' ? leads.length : leads.filter((l) => l.audience === a).length),
    [leads],
  );

  const AUDIENCES: (CampaignAudience | 'all')[] = ['all', 'buyer', 'jv', 'investor', 'other'];
  const tileBasis = isTablet ? '23%' : '47%';

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.content, isTablet ? styles.contentTablet : null, { paddingBottom: insets.bottom + 48 }]}
        refreshControl={<RefreshControl tintColor={Colors.primary} refreshing={query.isFetching} onRefresh={() => { void query.refetch(); }} />}
        testID="ivx-campaign-scroll"
      >
        <View style={styles.heroCard}>
          <View style={styles.heroHeaderRow}>
            <Target size={20} color={Colors.primary} />
            <Text style={styles.heroTitle}>{report?.title ?? 'IVX 10-Day Buyer / JV / Investor Campaign'}</Text>
          </View>
          <Text style={styles.heroSubtitle}>
            Live capture, qualification, and reporting from the IVX landing page — buyers, JV / capital partners, and investors. Every number below comes from real captured leads only.
          </Text>
          {report ? (
            <Text style={styles.windowNote}>
              {`Window: ${report.campaignStartDate} → ${report.campaignEndDate} · ${report.windowDays} days`}
            </Text>
          ) : null}
          <View style={styles.backendBanner}>
            <Text style={styles.backendBannerText}>
              {report
                ? 'Visitor / page-view analytics are not instrumented, so traffic counts are intentionally omitted (never fabricated).'
                : 'BACKEND NOT VERIFIED — connecting to the live lead store…'}
            </Text>
          </View>
        </View>

        {query.isError ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{query.error instanceof Error ? query.error.message : 'Could not load the campaign report.'}</Text>
            <Text style={styles.errorHint}>Sign in with the owner account, then pull to refresh.</Text>
          </View>
        ) : null}

        {query.isLoading && !report ? (
          <View style={styles.loadingCard}><ShimmerIndicator size="small" color={Colors.primary} /></View>
        ) : null}

        {report ? (
          <>
            <View style={styles.metricGrid}>
              <MetricTile label="Total leads" value={report.totals.totalLeads} flexBasis={tileBasis} />
              <MetricTile label="Buyers" value={report.totals.buyerLeads} tone={AUDIENCE_META.buyer.color} flexBasis={tileBasis} />
              <MetricTile label="JV / capital" value={report.totals.jvLeads} tone={AUDIENCE_META.jv.color} flexBasis={tileBasis} />
              <MetricTile label="Investors" value={report.totals.investorLeads} tone={AUDIENCE_META.investor.color} flexBasis={tileBasis} />
              <MetricTile label="Qualified" value={report.totals.qualifiedLeads} tone={Colors.success} flexBasis={tileBasis} />
              <MetricTile label="Hot" value={report.totals.hotLeads} tone={Colors.error} flexBasis={tileBasis} />
              <MetricTile label="Follow-ups due" value={report.totals.followUpRequired} tone={Colors.warning} flexBasis={tileBasis} />
              <MetricTile label="Conversion" value={`${report.totals.conversionRatePct}%`} tone={Colors.primary} flexBasis={tileBasis} />
            </View>
            {report.totals.topSource ? (
              <Text style={styles.sourceNote}>{`Top lead source: ${report.totals.topSource}`}</Text>
            ) : null}

            <View style={styles.sectionHeaderRow}>
              <CalendarDays size={16} color={Colors.primary} />
              <Text style={styles.sectionTitle}>24-Hour Report Cycle · 10 Days</Text>
            </View>
            {report.dailyReports.map((day) => <DailyCard key={day.date} day={day} />)}

            <View style={styles.sectionHeaderRow}>
              <Trophy size={16} color={Colors.primary} />
              <Text style={styles.sectionTitle}>10-Day Summary</Text>
            </View>
            <View style={[styles.candidateGrid, isTablet ? styles.candidateGridTablet : null]}>
              <CandidateCard icon={<Users size={15} color={AUDIENCE_META.investor.color} />} title="Best investor" candidate={report.finalSummary.bestInvestor} tone={AUDIENCE_META.investor.color} onOpen={openProfile} />
              <CandidateCard icon={<Briefcase size={15} color={AUDIENCE_META.buyer.color} />} title="Best buyer" candidate={report.finalSummary.bestBuyer} tone={AUDIENCE_META.buyer.color} onOpen={openProfile} />
              <CandidateCard icon={<Handshake size={15} color={AUDIENCE_META.jv.color} />} title="Best JV partner" candidate={report.finalSummary.bestJv} tone={AUDIENCE_META.jv.color} onOpen={openProfile} />
            </View>

            {report.finalSummary.recommendedDeals.length > 0 ? (
              <View style={styles.planCard}>
                <Text style={styles.planTitle}>Recommended deals to pursue</Text>
                {report.finalSummary.recommendedDeals.map((deal, i) => (
                  <View key={i} style={styles.recRow}>
                    <ChevronRight size={13} color={Colors.primary} />
                    <Text style={styles.planText}>{deal}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.planCard}>
              <Text style={styles.planTitle}>Next 30-day action plan</Text>
              {report.finalSummary.next30DayActionPlan.map((step, i) => (
                <View key={i} style={styles.recRow}>
                  <ChevronRight size={13} color={Colors.primary} />
                  <Text style={styles.planText}>{step}</Text>
                </View>
              ))}
            </View>

            <View style={styles.sectionHeaderRow}>
              <Flame size={16} color={Colors.primary} />
              <Text style={styles.sectionTitle}>{`Leads (${leads.length})`}</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {AUDIENCES.map((a) => (
                <Pressable
                  key={a}
                  style={[styles.filterChip, filter === a ? styles.filterChipActive : null]}
                  onPress={() => setFilter(a)}
                >
                  <Text style={[styles.filterChipText, filter === a ? styles.filterChipTextActive : null]}>
                    {`${a === 'all' ? 'All' : AUDIENCE_META[a].label} (${countFor(a)})`}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            {filtered.length === 0 ? (
              <View style={styles.emptyCard}>
                <Users size={24} color={Colors.textTertiary} />
                <Text style={styles.emptyTitle}>{leads.length === 0 ? 'No leads captured yet' : 'None in this audience'}</Text>
                <Text style={styles.emptyBody}>
                  {leads.length === 0
                    ? 'When a visitor submits the landing-page form, the lead appears here instantly — scored and classified.'
                    : 'Switch audiences to see leads in another segment.'}
                </Text>
              </View>
            ) : (
              filtered.map((lead) => <LeadRow key={lead.id} lead={lead} onOpen={openProfile} />)
            )}

            <Text style={styles.footnote}>{`Generated ${report.generatedAt} · marker ${report.marker}`}</Text>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

export default function IVXCampaignScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  return (
    <ErrorBoundary>
      <Stack.Screen options={{ title: 'Campaign Report' }} />
      <CampaignContent />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, gap: 14 },
  contentTablet: { paddingHorizontal: 28, maxWidth: 920, width: '100%', alignSelf: 'center' },
  heroCard: { backgroundColor: Colors.card, borderRadius: 18, padding: 18, gap: 10, borderWidth: 1, borderColor: Colors.border },
  heroHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  heroTitle: { fontSize: 17, fontWeight: '800' as const, color: Colors.text, flex: 1 },
  heroSubtitle: { fontSize: 12.5, lineHeight: 18, color: Colors.textSecondary },
  windowNote: { fontSize: 11.5, color: Colors.textTertiary, fontWeight: '600' as const },
  backendBanner: { backgroundColor: Colors.surface, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: Colors.border },
  backendBannerText: { fontSize: 11, lineHeight: 16, color: Colors.textTertiary },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metricTile: { flexGrow: 1, backgroundColor: Colors.card, borderRadius: 13, paddingVertical: 13, paddingHorizontal: 10, gap: 3, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' },
  metricValue: { fontSize: 21, fontWeight: '800' as const, color: Colors.text },
  metricLabel: { fontSize: 10.5, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3, textAlign: 'center' },
  sourceNote: { fontSize: 12, color: Colors.textSecondary, fontWeight: '600' as const },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  sectionTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  dayCard: { backgroundColor: Colors.card, borderRadius: 14, padding: 14, gap: 8, borderWidth: 1, borderColor: Colors.border },
  dayCardToday: { borderColor: Colors.primary },
  dayHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dayBadge: { backgroundColor: Colors.surface, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  dayBadgeText: { fontSize: 11, fontWeight: '700' as const, color: Colors.text },
  dayDate: { fontSize: 11.5, color: Colors.textTertiary, flex: 1 },
  dayConvPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.surface, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  dayConvText: { fontSize: 11.5, fontWeight: '700' as const, color: Colors.success },
  dayStatsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  dayStat: { alignItems: 'center', minWidth: 44 },
  dayStatValue: { fontSize: 16, fontWeight: '800' as const, color: Colors.text },
  dayStatLabel: { fontSize: 9.5, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3 },
  daySource: { fontSize: 11, color: Colors.textSecondary },
  recRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 5 },
  recText: { fontSize: 11.5, lineHeight: 16, color: Colors.textSecondary, flex: 1 },
  candidateGrid: { gap: 10 },
  candidateGridTablet: { flexDirection: 'row' },
  candidateCard: { flex: 1, backgroundColor: Colors.card, borderRadius: 14, padding: 14, gap: 8, borderWidth: 1.5 },
  candidateHeader: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  candidateTitle: { fontSize: 12.5, fontWeight: '700' as const, color: Colors.text },
  candidateBody: { gap: 4 },
  candidateName: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  candidateMeta: { fontSize: 11.5, color: Colors.textSecondary },
  candidateInterest: { fontSize: 11, color: Colors.textTertiary },
  scoreChip: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4, marginTop: 2 },
  scoreChipText: { fontSize: 10.5, fontWeight: '700' as const, color: Colors.black },
  candidateEmpty: { fontSize: 11.5, color: Colors.textTertiary, lineHeight: 16 },
  planCard: { backgroundColor: Colors.card, borderRadius: 14, padding: 14, gap: 8, borderWidth: 1, borderColor: Colors.border },
  planTitle: { fontSize: 13, fontWeight: '700' as const, color: Colors.text },
  planText: { fontSize: 12, lineHeight: 17, color: Colors.textSecondary, flex: 1 },
  filterRow: { gap: 8, paddingVertical: 2, paddingRight: 8 },
  filterChip: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card },
  filterChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterChipText: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary },
  filterChipTextActive: { color: Colors.black },
  leadRow: { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: Colors.card, borderRadius: 14, padding: 13, borderWidth: 1, borderColor: Colors.border },
  leadScoreCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.surfaceLight, alignItems: 'center', justifyContent: 'center' },
  leadScoreText: { fontSize: 14, fontWeight: '800' as const, color: Colors.text },
  leadBody: { flex: 1, gap: 1 },
  leadName: { fontSize: 14.5, fontWeight: '700' as const, color: Colors.text },
  leadMeta: { fontSize: 11.5, color: Colors.textSecondary },
  leadNext: { fontSize: 11, color: Colors.textTertiary },
  leadTags: { gap: 5, alignItems: 'flex-end' },
  tagPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, borderWidth: 1.2 },
  tagPillText: { fontSize: 10, fontWeight: '700' as const },
  loadingCard: { backgroundColor: Colors.card, borderRadius: 14, padding: 22, alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  errorCard: { backgroundColor: Colors.card, borderRadius: 14, padding: 16, gap: 5, borderWidth: 1, borderColor: Colors.error },
  errorText: { fontSize: 12.5, color: Colors.error, lineHeight: 18 },
  errorHint: { fontSize: 11.5, color: Colors.textTertiary },
  emptyCard: { backgroundColor: Colors.card, borderRadius: 16, padding: 26, gap: 8, alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  emptyTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  emptyBody: { fontSize: 12, lineHeight: 17, color: Colors.textSecondary, textAlign: 'center' },
  footnote: { fontSize: 10.5, color: Colors.textTertiary, marginTop: 6 }});
