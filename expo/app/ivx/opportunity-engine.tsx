import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View} from "react-native";
import {
  AlertTriangle,
  Bell,
  Building2,
  Gauge,
  Layers,
  Radar,
  ShieldCheck,
  Target,
  TrendingUp,
  Zap} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  getOpportunityDashboard,
  runOpportunityScan,
  setOpportunityStatus,
  type Opportunity,
  type OpportunityCategory,
  type OpportunityDashboard} from '@/src/modules/ivx-developer/opportunityService';

const POLL_INTERVAL_MS = 8000;

const CATEGORY_LABEL: Record<OpportunityCategory, string> = {
  real_estate: 'Real estate',
  distressed_asset: 'Distressed',
  financing: 'Financing',
  investor: 'Investor',
  arbitrage: 'Arbitrage',
  partnership: 'Partnership',
  technology_business: 'Tech / business'};

function formatUsd(value: number | null): string {
  if (value === null) return 'n/a';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value}`;
}

function upsideText(o: Opportunity): string {
  if (o.upsideLowUsd === null || o.upsideHighUsd === null) return 'Not quantified (no fabricated number)';
  return `${formatUsd(o.upsideLowUsd)} – ${formatUsd(o.upsideHighUsd)} (range, not a guarantee)`;
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

function PickTile({ icon, label, opp }: { icon: React.ReactNode; label: string; opp: Opportunity | null }) {
  return (
    <View style={styles.pickTile}>
      <View style={styles.pickHeader}>
        {icon}
        <Text style={styles.pickLabel}>{label}</Text>
      </View>
      <Text style={styles.pickTitle} numberOfLines={2}>{opp ? opp.title : '—'}</Text>
      {opp ? <Text style={styles.pickMeta}>{`Overall ${opp.overall}/100 · ${CATEGORY_LABEL[opp.category]}`}</Text> : null}
    </View>
  );
}

function OpportunityCard({ opp, onStatus, busy }: { opp: Opportunity; onStatus: (o: Opportunity, s: 'watching' | 'pursuing' | 'dismissed') => void; busy: boolean }) {
  const [expanded, setExpanded] = useState<boolean>(false);
  return (
    <View style={styles.oppCard} testID={`ivx-opp-${opp.id}`}>
      <View style={styles.oppHeaderRow}>
        <View style={styles.badge}><Text style={styles.badgeText}>{CATEGORY_LABEL[opp.category]}</Text></View>
        <View style={styles.overallPill}><Text style={styles.overallPillText}>{opp.overall}</Text></View>
      </View>
      <Text style={styles.oppTitle}>{opp.title}</Text>
      <Text style={styles.oppSummary}>{opp.summary}</Text>

      <View style={styles.factGrid}>
        <View style={styles.fact}><Text style={styles.factLabel}>Capital</Text><Text style={styles.factValue}>{formatUsd(opp.capitalRequiredUsd)}</Text></View>
        <View style={styles.fact}><Text style={styles.factLabel}>Timeline</Text><Text style={styles.factValue}>{opp.timeline}</Text></View>
        <View style={styles.fact}><Text style={styles.factLabel}>Confidence</Text><Text style={styles.factValue}>{opp.confidence}/100</Text></View>
      </View>
      <Text style={styles.upside}>{`Upside: ${upsideText(opp)}`}</Text>

      <View style={styles.scoreBlock}>
        <ScoreBar label="Evidence" value={opp.scores.evidence} tone={Colors.blue} />
        <ScoreBar label="Risk (safe)" value={opp.scores.risk} tone={Colors.success} />
        <ScoreBar label="Speed" value={opp.scores.speed} tone={Colors.info} />
        <ScoreBar label="Capital" value={opp.scores.capital} tone={Colors.primary} />
        <ScoreBar label="Upside" value={opp.scores.upside} tone={Colors.warning} />
      </View>

      <Text style={styles.evidence}>{`Evidence: ${opp.evidence}`}</Text>

      <Pressable style={styles.expandButton} onPress={() => setExpanded((v) => !v)} testID={`ivx-opp-expand-${opp.id}`}>
        <Text style={styles.expandButtonText}>{expanded ? 'Hide profit ladder + plan' : 'Show profit ladder + execution plan'}</Text>
      </Pressable>

      {expanded ? (
        <View style={styles.expandBody}>
          <Text style={styles.sectionEyebrow}>Profit ladder ($1 → $100M+)</Text>
          {opp.profitLadder.map((step) => (
            <View key={step.tier} style={styles.ladderStep}>
              <View style={styles.ladderHeader}>
                <Text style={styles.ladderTier}>{step.tier}</Text>
                <View style={[styles.probPill, step.probability === 'speculative' ? styles.probSpeculative : null]}>
                  <Text style={styles.probPillText}>{step.probability}</Text>
                </View>
              </View>
              <Text style={styles.ladderStrategy}>{step.strategy}</Text>
              <Text style={styles.ladderMeta}>{`Risk: ${step.riskLevel} · ${step.timeline} · ${step.proof}`}</Text>
            </View>
          ))}

          <Text style={styles.sectionEyebrow}>Execution plan</Text>
          <Text style={styles.planLabel}>Next 3 actions</Text>
          {opp.executionPlan.nextThreeActions.map((a, i) => (
            <Text key={`na-${i}`} style={styles.planItem}>{`${i + 1}. ${a}`}</Text>
          ))}
          <Text style={styles.planLabel}>Documents needed</Text>
          {opp.executionPlan.documentsNeeded.map((d, i) => (
            <Text key={`doc-${i}`} style={styles.planItem}>{`• ${d}`}</Text>
          ))}
          <Text style={styles.planLabel}>Funding path</Text>
          <Text style={styles.planItem}>{opp.executionPlan.fundingPath}</Text>
          <Text style={styles.planLabel}>Worst-case risk</Text>
          <Text style={styles.worstCase}>{opp.executionPlan.worstCaseRisk}</Text>

          {opp.riskWarnings.length > 0 ? (
            <>
              <Text style={styles.sectionEyebrow}>Risk warnings</Text>
              {opp.riskWarnings.map((r, i) => (
                <Text key={`risk-${i}`} style={styles.riskItem}>{`⚠ ${r}`}</Text>
              ))}
            </>
          ) : null}

          <Text style={styles.legal}>{opp.legalWarning}</Text>
        </View>
      ) : null}

      <View style={styles.actionRow}>
        <Pressable style={[styles.actBtn, busy ? styles.btnDisabled : null]} onPress={() => onStatus(opp, 'pursuing')} disabled={busy} testID={`ivx-opp-pursue-${opp.id}`}>
          <Target size={13} color={Colors.black} />
          <Text style={styles.actBtnText}>Pursue</Text>
        </Pressable>
        <Pressable style={[styles.actBtnGhost, busy ? styles.btnDisabled : null]} onPress={() => onStatus(opp, 'watching')} disabled={busy} testID={`ivx-opp-watch-${opp.id}`}>
          <Text style={styles.actBtnGhostText}>Watch</Text>
        </Pressable>
        <Pressable style={[styles.actBtnGhost, busy ? styles.btnDisabled : null]} onPress={() => onStatus(opp, 'dismissed')} disabled={busy} testID={`ivx-opp-dismiss-${opp.id}`}>
          <Text style={styles.actBtnGhostText}>Dismiss</Text>
        </Pressable>
      </View>
      {opp.status !== 'new' ? (
        <Text style={styles.statusLine}>{`Status: ${opp.status}`}</Text>
      ) : null}
    </View>
  );
}

function OpportunityEngineContent() {
  const insets = useSafeAreaInsets();
  const [scanning, setScanning] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const dashboardQuery = useQuery<OpportunityDashboard | null>({
    queryKey: ['ivx-opportunity', 'dashboard'],
    queryFn: getOpportunityDashboard,
    refetchInterval: POLL_INTERVAL_MS});

  const dashboard = dashboardQuery.data ?? null;

  const handleScan = useCallback(async () => {
    setScanning(true);
    setActionError(null);
    try {
      await runOpportunityScan();
      await dashboardQuery.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not run the opportunity scan.');
    } finally {
      setScanning(false);
    }
  }, [dashboardQuery]);

  const handleStatus = useCallback(async (opp: Opportunity, status: 'watching' | 'pursuing' | 'dismissed') => {
    setBusyId(opp.id);
    setActionError(null);
    try {
      await setOpportunityStatus(opp.id, status);
      await dashboardQuery.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not update the opportunity.');
    } finally {
      setBusyId(null);
    }
  }, [dashboardQuery]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 48 }]}
      refreshControl={
        <RefreshControl tintColor={Colors.primary} refreshing={dashboardQuery.isFetching} onRefresh={() => { void dashboardQuery.refetch(); }} />
      }
      testID="ivx-opportunity-engine-scroll"
    >
      <View style={styles.heroCard}>
        <View style={styles.heroHeaderRow}>
          <Radar size={18} color={Colors.primary} />
          <Text style={styles.heroTitle}>Opportunity Engine</Text>
        </View>
        <Text style={styles.heroSubtitle}>
          IVX scans your deals, portfolio, and platform signals to surface high-upside opportunities — ranked by evidence, risk, speed, capital, and upside. No guaranteed profit; no fabricated ROI.
        </Text>
        <Pressable
          style={[styles.primaryButton, scanning ? styles.btnDisabled : null]}
          onPress={() => { void handleScan(); }}
          disabled={scanning}
          testID="ivx-opportunity-run-scan"
        >
          {scanning ? <ShimmerIndicator size="small" color={Colors.black} /> : <Zap size={15} color={Colors.black} />}
          <Text style={styles.primaryButtonText}>{scanning ? 'Scanning…' : "Find today's best opportunities"}</Text>
        </Pressable>
        {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}
      </View>

      {dashboard ? (
        <>
          <View style={styles.pickGrid}>
            <PickTile icon={<TrendingUp size={14} color={Colors.warning} />} label="Highest upside" opp={dashboard.highestUpside} />
            <PickTile icon={<Gauge size={14} color={Colors.info} />} label="Fastest" opp={dashboard.fastestExecution} />
            <PickTile icon={<ShieldCheck size={14} color={Colors.success} />} label="Lowest risk" opp={dashboard.lowestRisk} />
          </View>

          {dashboard.alerts.length > 0 ? (
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Bell size={15} color={Colors.warning} />
                <Text style={styles.eyebrow}>{`Alerts (${dashboard.unacknowledgedAlerts} new)`}</Text>
              </View>
              {dashboard.alerts.slice(0, 6).map((a) => (
                <View key={a.id} style={styles.alertRow}>
                  <AlertTriangle size={13} color={a.severity === 'critical' ? Colors.error : Colors.warning} />
                  <Text style={styles.alertText}>{a.message}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Layers size={15} color={Colors.primary} />
              <Text style={styles.eyebrow}>Multi-AI research layer</Text>
            </View>
            {dashboard.research.map((r) => (
              <View key={r.id} style={styles.researchRow}>
                <View style={[styles.dot, { backgroundColor: r.status === 'online' ? Colors.success : Colors.textTertiary }]} />
                <View style={styles.researchCopy}>
                  <Text style={styles.researchLabel}>{r.label}</Text>
                  <Text style={styles.researchDetail}>{r.detail}</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={styles.cardHeaderRow}>
            <Building2 size={15} color={Colors.text} />
            <Text style={styles.eyebrow}>{`Top opportunities (${dashboard.totals.total} tracked)`}</Text>
          </View>
          {dashboard.topToday.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.emptyBody}>No opportunities yet. Tap “Find today’s best opportunities” to run the engine.</Text>
            </View>
          ) : (
            dashboard.topToday.map((opp) => (
              <OpportunityCard key={opp.id} opp={opp} onStatus={handleStatus} busy={busyId === opp.id} />
            ))
          )}
        </>
      ) : (
        <View style={styles.card}>
          {dashboardQuery.isLoading ? (
            <ShimmerIndicator size="small" color={Colors.primary} />
          ) : (
            <Text style={styles.emptyBody}>{dashboardQuery.error instanceof Error ? dashboardQuery.error.message : 'No opportunity data yet.'}</Text>
          )}
        </View>
      )}

      <Text style={styles.footnote}>Owner-only decision support. Not financial, investment, tax, or legal advice. No profit is guaranteed.</Text>
    </ScrollView>
  );
}

export default function OpportunityEngineScreen() {
  return (
    <ErrorBoundary>
      <Stack.Screen options={{ title: 'Opportunity Engine' }} />
      <OpportunityEngineContent />
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
  primaryButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, paddingVertical: 13, paddingHorizontal: 16, borderRadius: 12 },
  primaryButtonText: { fontSize: 14.5, fontWeight: '700' as const, color: Colors.black },
  btnDisabled: { opacity: 0.6 },
  errorText: { fontSize: 12.5, color: Colors.error, lineHeight: 18 },
  pickGrid: { flexDirection: 'row', gap: 10 },
  pickTile: { flex: 1, backgroundColor: Colors.card, borderRadius: 14, padding: 12, gap: 6, borderWidth: 1, borderColor: Colors.border },
  pickHeader: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  pickLabel: { fontSize: 10.5, fontWeight: '700' as const, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
  pickTitle: { fontSize: 12.5, fontWeight: '700' as const, color: Colors.text },
  pickMeta: { fontSize: 10.5, color: Colors.textTertiary },
  card: { backgroundColor: Colors.card, borderRadius: 16, padding: 16, gap: 10, borderWidth: 1, borderColor: Colors.border },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  eyebrow: { fontSize: 12, fontWeight: '700' as const, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6 },
  emptyBody: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  alertRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  alertText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: Colors.text },
  researchRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  dot: { width: 9, height: 9, borderRadius: 5, marginTop: 4 },
  researchCopy: { flex: 1, gap: 2 },
  researchLabel: { fontSize: 12.5, fontWeight: '600' as const, color: Colors.text },
  researchDetail: { fontSize: 11.5, lineHeight: 16, color: Colors.textTertiary },
  oppCard: { backgroundColor: Colors.card, borderRadius: 16, padding: 16, gap: 9, borderWidth: 1, borderColor: Colors.border },
  oppHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: { backgroundColor: Colors.primary, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 10.5, fontWeight: '700' as const, color: Colors.black },
  overallPill: { backgroundColor: Colors.black, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: Colors.primary },
  overallPillText: { fontSize: 13, fontWeight: '800' as const, color: Colors.primary },
  oppTitle: { fontSize: 15.5, fontWeight: '700' as const, color: Colors.text },
  oppSummary: { fontSize: 12.5, lineHeight: 18, color: Colors.textSecondary },
  factGrid: { flexDirection: 'row', gap: 10, marginTop: 2 },
  fact: { flex: 1, backgroundColor: Colors.backgroundSecondary, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10, gap: 2 },
  factLabel: { fontSize: 10, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.4 },
  factValue: { fontSize: 13, fontWeight: '700' as const, color: Colors.text },
  upside: { fontSize: 12, color: Colors.text, fontWeight: '600' as const },
  scoreBlock: { gap: 5, marginTop: 2 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scoreLabel: { fontSize: 11, color: Colors.textSecondary, width: 78 },
  scoreTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: Colors.surfaceLight, overflow: 'hidden' },
  scoreFill: { height: 6, borderRadius: 3 },
  scoreValue: { fontSize: 11, color: Colors.text, width: 24, textAlign: 'right' },
  evidence: { fontSize: 11.5, lineHeight: 16, color: Colors.textTertiary, fontStyle: 'italic' as const },
  expandButton: { paddingVertical: 8, alignItems: 'center', borderRadius: 10, borderWidth: 1, borderColor: Colors.border, marginTop: 2 },
  expandButtonText: { fontSize: 12.5, fontWeight: '600' as const, color: Colors.primary },
  expandBody: { gap: 7, marginTop: 4 },
  sectionEyebrow: { fontSize: 11, fontWeight: '700' as const, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 6 },
  ladderStep: { backgroundColor: Colors.backgroundSecondary, borderRadius: 10, padding: 10, gap: 3, borderWidth: 1, borderColor: Colors.border },
  ladderHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ladderTier: { fontSize: 12.5, fontWeight: '800' as const, color: Colors.text },
  probPill: { backgroundColor: Colors.surfaceLight, borderRadius: 7, paddingHorizontal: 7, paddingVertical: 2 },
  probSpeculative: { backgroundColor: Colors.error },
  probPillText: { fontSize: 9.5, fontWeight: '700' as const, color: Colors.text, textTransform: 'uppercase' as const },
  ladderStrategy: { fontSize: 11.5, lineHeight: 16, color: Colors.textSecondary },
  ladderMeta: { fontSize: 10.5, color: Colors.textTertiary },
  planLabel: { fontSize: 11.5, fontWeight: '700' as const, color: Colors.text, marginTop: 4 },
  planItem: { fontSize: 12, lineHeight: 17, color: Colors.textSecondary },
  worstCase: { fontSize: 12, lineHeight: 17, color: Colors.error },
  riskItem: { fontSize: 11.5, lineHeight: 16, color: Colors.warning },
  legal: { fontSize: 10.5, lineHeight: 15, color: Colors.textTertiary, fontStyle: 'italic' as const, marginTop: 8 },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  actBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.primary, paddingVertical: 9, borderRadius: 10, flex: 1 },
  actBtnText: { fontSize: 12.5, fontWeight: '700' as const, color: Colors.black },
  actBtnGhost: { alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: 10, flex: 1, borderWidth: 1, borderColor: Colors.border },
  actBtnGhostText: { fontSize: 12.5, fontWeight: '600' as const, color: Colors.text },
  statusLine: { fontSize: 11, color: Colors.textTertiary, marginTop: 2 },
  footnote: { fontSize: 11, lineHeight: 16, color: Colors.textTertiary, textAlign: 'center', marginTop: 6 }});
