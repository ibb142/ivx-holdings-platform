import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
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
  Building2,
  CheckCircle2,
    FileText,
  Handshake,
  HardHat,
  Link2,
  Mail,
  MapPin,
  Search,
  ShieldCheck,
  Target,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react-native';
import IVXBrandIcon from '@/components/IVXBrandIcon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import {
  getCapitalNetworkDashboard,
  runCapitalNetworkScan,
  setProspectStatus,
  getProspectActionPlan,
  getProspectResearch,
  createProspectOutreachDraft,
  type CapitalNetworkDashboard,
  type ProspectProfile,
  type ProspectRecommendation,
  type ProspectType,
  type ProspectActionPlan,
  type ProspectResearch,
  type OutreachDraftResult,
} from '@/src/modules/ivx-developer/capitalNetworkService';

const POLL_INTERVAL_MS = 9000;

const TYPE_LABEL: Record<ProspectType, string> = {
  buyer: 'Buyer',
  investor: 'Investor',
  developer: 'Developer',
  partner: 'Partner',
};

function typeIcon(type: ProspectType, size: number, color: string) {
  switch (type) {
    case 'buyer':
      return <IVXBrandIcon size={size} />;
    case 'investor':
      return <TrendingUp size={size} color={color} />;
    case 'developer':
      return <HardHat size={size} color={color} />;
    case 'partner':
      return <Handshake size={size} color={color} />;
    default:
      return <Users size={size} color={color} />;
  }
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

function BestPick({ icon, label, rec }: { icon: React.ReactNode; label: string; rec: ProspectRecommendation }) {
  const p = rec.prospect;
  return (
    <View style={styles.bestCard}>
      <View style={styles.bestHeader}>
        {icon}
        <Text style={styles.bestLabel}>{label}</Text>
        {p ? <View style={styles.bestPill}><Text style={styles.bestPillText}>{p.overall}</Text></View> : null}
      </View>
      <Text style={styles.bestTitle} numberOfLines={2}>{p ? p.segment : 'No qualifying segment yet'}</Text>
      <Text style={styles.bestWhy} numberOfLines={3}>{rec.why}</Text>
      <Text style={styles.bestNext} numberOfLines={2}>{`Next: ${rec.nextAction}`}</Text>
    </View>
  );
}

const SOURCE_TYPE_LABEL: Record<string, string> = {
  public_website: 'Public website',
  investor_portal: 'Investor portal / filing',
  referral_network: 'Referral network',
  crm_contact: 'Existing CRM / contact',
  owner_provided: 'Owner-provided contact',
};

type ActionPanel = 'none' | 'plan' | 'research' | 'draft';

function ProspectCard({ p, onStatus, busy }: { p: ProspectProfile; onStatus: (p: ProspectProfile, s: 'qualified' | 'researching' | 'dismissed') => void; busy: boolean }) {
  const [expanded, setExpanded] = useState<boolean>(false);
  const [panel, setPanel] = useState<ActionPanel>('none');
  const [panelLoading, setPanelLoading] = useState<boolean>(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [actionPlan, setActionPlan] = useState<ProspectActionPlan | null>(null);
  const [research, setResearch] = useState<ProspectResearch | null>(null);
  const [draftResult, setDraftResult] = useState<OutreachDraftResult | null>(null);

  const openPanel = useCallback(async (target: ActionPanel) => {
    if (panel === target) { setPanel('none'); return; }
    setPanel(target);
    setPanelError(null);
    if (target === 'plan' && actionPlan) return;
    if (target === 'research' && research) return;
    if (target === 'draft' && draftResult) return;
    setPanelLoading(true);
    try {
      if (target === 'plan') setActionPlan(await getProspectActionPlan(p.id));
      else if (target === 'research') setResearch(await getProspectResearch(p.id));
      else if (target === 'draft') setDraftResult(await createProspectOutreachDraft(p.id));
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : 'Could not load this action.');
    } finally {
      setPanelLoading(false);
    }
  }, [panel, p.id, actionPlan, research, draftResult]);

  return (
    <View style={styles.card} testID={`ivx-prospect-${p.id}`}>
      <View style={styles.cardHeaderRow}>
        <View style={styles.typeBadge}>
          {typeIcon(p.type, 12, Colors.black)}
          <Text style={styles.typeBadgeText}>{TYPE_LABEL[p.type]}</Text>
        </View>
        <View style={styles.overallPill}><Text style={styles.overallPillText}>{p.overall}</Text></View>
      </View>
      <Text style={styles.segment}>{p.segment}</Text>
      <Text style={styles.companyType}>{p.companyType}</Text>

      <View style={styles.metaRow}>
        <MapPin size={12} color={Colors.textTertiary} />
        <Text style={styles.metaText}>{p.market}</Text>
      </View>
      <Text style={styles.focus}>{`Focus: ${p.investmentFocus}`}</Text>
      <Text style={styles.signal}>{p.signal}</Text>

      <View style={styles.scoreBlock}>
        <ScoreBar label="Deal fit" value={p.scores.dealFit} tone={Colors.primary} />
        <ScoreBar label="Relevance" value={p.scores.relevance} tone={Colors.info} />
        <ScoreBar label="Confidence" value={p.scores.confidence} tone={Colors.success} />
      </View>

      <View style={styles.sourceRow}>
        <Link2 size={12} color={Colors.textSecondary} />
        <Text style={styles.sourceText}>{p.publicSource}</Text>
      </View>

      <Pressable style={styles.expandButton} onPress={() => setExpanded((v) => !v)} testID={`ivx-prospect-expand-${p.id}`}>
        <Text style={styles.expandButtonText}>{expanded ? 'Hide recommendation' : 'Why this prospect + next action'}</Text>
      </Pressable>

      {expanded ? (
        <View style={styles.expandBody}>
          <Text style={styles.sectionEyebrow}>Why selected</Text>
          <Text style={styles.bodyText}>{p.rationale}</Text>
          <Text style={styles.sectionEyebrow}>Evidence</Text>
          <Text style={styles.evidence}>{p.evidence}</Text>
          {p.matchedDealNames.length > 0 ? (
            <>
              <Text style={styles.sectionEyebrow}>Matched IVX deals</Text>
              <Text style={styles.bodyText}>{p.matchedDealNames.join(' · ')}</Text>
            </>
          ) : null}
          {p.risks.length > 0 ? (
            <>
              <Text style={styles.sectionEyebrow}>Risks</Text>
              {p.risks.map((r, i) => (
                <Text key={`risk-${i}`} style={styles.riskItem}>{`⚠ ${r}`}</Text>
              ))}
            </>
          ) : null}
          <Text style={styles.sectionEyebrow}>Next action</Text>
          <Text style={styles.bodyText}>{p.nextAction}</Text>
          <Text style={styles.compliance}>{p.complianceNote}</Text>
        </View>
      ) : null}

      <View style={styles.actionFlowRow}>
        <Pressable style={[styles.flowChip, panel === 'plan' ? styles.flowChipActive : null]} onPress={() => { void openPanel('plan'); }} testID={`ivx-prospect-why-${p.id}`}>
          <Target size={12} color={panel === 'plan' ? Colors.black : Colors.primary} />
          <Text style={[styles.flowChipText, panel === 'plan' ? styles.flowChipTextActive : null]}>Why + next action</Text>
        </Pressable>
        <Pressable style={[styles.flowChip, panel === 'research' ? styles.flowChipActive : null]} onPress={() => { void openPanel('research'); }} testID={`ivx-prospect-research-panel-${p.id}`}>
          <Search size={12} color={panel === 'research' ? Colors.black : Colors.primary} />
          <Text style={[styles.flowChipText, panel === 'research' ? styles.flowChipTextActive : null]}>Research</Text>
        </Pressable>
        <Pressable style={[styles.flowChip, panel === 'draft' ? styles.flowChipActive : null]} onPress={() => { void openPanel('draft'); }} testID={`ivx-prospect-draft-${p.id}`}>
          <Mail size={12} color={panel === 'draft' ? Colors.black : Colors.primary} />
          <Text style={[styles.flowChipText, panel === 'draft' ? styles.flowChipTextActive : null]}>Create draft</Text>
        </Pressable>
      </View>

      {panel !== 'none' ? (
        <View style={styles.panel}>
          {panelLoading ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : panelError ? (
            <Text style={styles.errorText}>{panelError}</Text>
          ) : panel === 'plan' && actionPlan ? (
            <>
              <View style={styles.panelHeaderRow}>
                <Text style={styles.sectionEyebrow}>Action plan</Text>
                <View style={styles.confidencePill}><Text style={styles.confidencePillText}>{`Confidence ${actionPlan.confidenceScore}`}</Text></View>
              </View>
              <Text style={styles.panelLabel}>Why this prospect</Text>
              <Text style={styles.bodyText}>{actionPlan.whyThisProspect}</Text>
              <Text style={styles.panelLabel}>Best outreach angle</Text>
              <Text style={styles.bodyText}>{actionPlan.bestOutreachAngle}</Text>
              <Text style={styles.panelLabel}>Likely objections</Text>
              {actionPlan.likelyObjections.map((o, i) => (
                <Text key={`obj-${i}`} style={styles.bullet}>{`• ${o}`}</Text>
              ))}
              <Text style={styles.panelLabel}>Recommended next step</Text>
              <Text style={styles.bodyText}>{actionPlan.recommendedNextStep}</Text>
              <View style={styles.complianceRow}>
                <AlertTriangle size={12} color={Colors.warning} />
                <Text style={styles.complianceWarn}>{actionPlan.complianceWarning}</Text>
              </View>
            </>
          ) : panel === 'research' && research ? (
            <>
              <Text style={styles.sectionEyebrow}>Research channels</Text>
              <View style={[styles.contactStatusPill, research.contactStatus === 'CONTACT_NOT_VERIFIED' ? styles.contactUnverified : styles.contactVerified]}>
                <Text style={styles.contactStatusText}>{research.contactStatus}</Text>
              </View>
              {research.channels.length === 0 ? (
                <Text style={styles.bodyText}>No public sourcing channel recorded.</Text>
              ) : (
                research.channels.map((c, i) => (
                  <View key={`chan-${i}`} style={styles.channelRow}>
                    <Text style={styles.channelType}>{SOURCE_TYPE_LABEL[c.type] ?? c.label}</Text>
                    <Text style={styles.channelDetail}>{c.detail}</Text>
                  </View>
                ))
              )}
              <Text style={styles.compliance}>{research.note}</Text>
            </>
          ) : panel === 'draft' && draftResult ? (
            <>
              <View style={styles.panelHeaderRow}>
                <Text style={styles.sectionEyebrow}>Outreach draft</Text>
                <View style={[styles.sendPill, draftResult.sendStatus === 'PROVIDER_CONFIGURED' ? styles.sendReady : styles.sendBlocked]}>
                  <Text style={styles.sendPillText}>{draftResult.sendStatus === 'PROVIDER_CONFIGURED' ? 'Provider ready' : 'No provider'}</Text>
                </View>
              </View>
              <Text style={styles.panelLabel}>Subject</Text>
              <Text style={styles.bodyText}>{draftResult.draft.subject}</Text>
              <Text style={styles.panelLabel}>Email body</Text>
              <Text style={styles.draftBody}>{draftResult.draft.emailBody}</Text>
              {draftResult.draft.shortMessage ? (
                <>
                  <Text style={styles.panelLabel}>One-line message</Text>
                  <Text style={styles.bodyText}>{draftResult.draft.shortMessage}</Text>
                </>
              ) : null}
              <Text style={styles.panelLabel}>Attachment</Text>
              <Text style={styles.evidence}>{draftResult.draft.attachmentPlaceholder}</Text>
              <Text style={styles.compliance}>{draftResult.draft.complianceDisclaimer}</Text>
              <View style={styles.draftNoteRow}>
                <ShieldCheck size={12} color={draftResult.sendStatus === 'PROVIDER_CONFIGURED' ? Colors.success : Colors.warning} />
                <Text style={styles.draftNote}>{draftResult.note}</Text>
              </View>
              {draftResult.outreachMessage ? (
                <Text style={styles.statusLine}>{`Saved as draft (${draftResult.outreachMessage.status}) — approve in Outreach before sending.`}</Text>
              ) : null}
            </>
          ) : null}
        </View>
      ) : null}

      <View style={styles.actionRow}>
        <Pressable style={[styles.actBtn, busy ? styles.btnDisabled : null]} onPress={() => onStatus(p, 'qualified')} disabled={busy} testID={`ivx-prospect-qualify-${p.id}`}>
          <CheckCircle2 size={13} color={Colors.black} />
          <Text style={styles.actBtnText}>Qualify · add to pipeline</Text>
        </Pressable>
        <Pressable style={[styles.actBtnGhost, busy ? styles.btnDisabled : null]} onPress={() => onStatus(p, 'dismissed')} disabled={busy} testID={`ivx-prospect-dismiss-${p.id}`}>
          <Text style={styles.actBtnGhostText}>Dismiss</Text>
        </Pressable>
      </View>
      {p.status !== 'new' ? <Text style={styles.statusLine}>{`Status: ${p.status}`}</Text> : null}
    </View>
  );
}

function CapitalNetworkContent() {
  const insets = useSafeAreaInsets();
  const [scanning, setScanning] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const dashboardQuery = useQuery<CapitalNetworkDashboard | null>({
    queryKey: ['ivx-capital-network', 'dashboard'],
    queryFn: getCapitalNetworkDashboard,
    refetchInterval: POLL_INTERVAL_MS,
  });

  const dashboard = dashboardQuery.data ?? null;

  const handleScan = useCallback(async () => {
    setScanning(true);
    setActionError(null);
    try {
      await runCapitalNetworkScan();
      await dashboardQuery.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not run the capital-network scan.');
    } finally {
      setScanning(false);
    }
  }, [dashboardQuery]);

  const handleStatus = useCallback(async (p: ProspectProfile, status: 'qualified' | 'researching' | 'dismissed') => {
    setBusyId(p.id);
    setActionError(null);
    try {
      await setProspectStatus(p.id, status);
      await dashboardQuery.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not update the prospect.');
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
      testID="ivx-capital-network-scroll"
    >
      <View style={styles.heroCard}>
        <View style={styles.heroHeaderRow}>
          <Users size={18} color={Colors.primary} />
          <Text style={styles.heroTitle}>Capital Intelligence Network</Text>
        </View>
        <Text style={styles.heroSubtitle}>
          The highest-probability capital sources for IVX's South Florida luxury deals — luxury buyers, investors, developers, and strategic partners. Ranked by deal fit, relevance, and confidence. Profiles only — never fabricated contacts.
        </Text>
        <Pressable
          style={[styles.primaryButton, scanning ? styles.btnDisabled : null]}
          onPress={() => { void handleScan(); }}
          disabled={scanning}
          testID="ivx-capital-network-run-scan"
        >
          {scanning ? <ActivityIndicator size="small" color={Colors.black} /> : <Zap size={15} color={Colors.black} />}
          <Text style={styles.primaryButtonText}>{scanning ? 'Scanning deals…' : 'Find best capital sources'}</Text>
        </Pressable>
        {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}
      </View>

      {dashboard ? (
        <>
          <View style={styles.bestGrid}>
            <BestPick icon={<IVXBrandIcon size={14} />} label="Best buyer today" rec={dashboard.bestBuyerToday} />
            <BestPick icon={<TrendingUp size={14} color={Colors.info} />} label="Best investor today" rec={dashboard.bestInvestorToday} />
          </View>
          <View style={styles.bestGrid}>
            <BestPick icon={<Handshake size={14} color={Colors.success} />} label="Best partner today" rec={dashboard.bestPartnerToday} />
            <BestPick icon={<HardHat size={14} color={Colors.primary} />} label="Best developer today" rec={dashboard.bestDeveloperToday} />
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <MapPin size={15} color={Colors.warning} />
              <Text style={styles.eyebrow}>Best market today</Text>
            </View>
            {dashboard.bestMarketToday ? (
              <>
                <Text style={styles.marketName}>{dashboard.bestMarketToday.market}</Text>
                <Text style={styles.marketMeta}>{`${dashboard.bestMarketToday.prospectCount} prospect profiles · avg fit ${dashboard.bestMarketToday.avgFit}/100`}</Text>
                {dashboard.bestMarketToday.topSegment ? <Text style={styles.marketMeta}>{`Top segment: ${dashboard.bestMarketToday.topSegment}`}</Text> : null}
              </>
            ) : (
              <Text style={styles.emptyBody}>No market data yet — run a scan.</Text>
            )}
          </View>

          <View style={[styles.card, styles.followUpCard]}>
            <View style={styles.cardHeaderRow}>
              <ShieldCheck size={15} color={Colors.primary} />
              <Text style={styles.eyebrow}>Best follow-up today</Text>
            </View>
            <Text style={styles.followUpText}>{dashboard.bestFollowUpToday.nextAction}</Text>
            {dashboard.bestFollowUpToday.prospect ? (
              <Text style={styles.followUpMeta}>{`${dashboard.bestFollowUpToday.prospect.segment} · ${dashboard.bestFollowUpToday.prospect.market}`}</Text>
            ) : null}
          </View>

          {dashboard.matches.length > 0 ? (
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Building2 size={15} color={Colors.text} />
                <Text style={styles.eyebrow}>Opportunity matching</Text>
              </View>
              {dashboard.matches.map((m) => (
                <View key={m.dealName} style={styles.matchRow}>
                  <Text style={styles.matchDeal}>{m.dealName}</Text>
                  {m.prospects.slice(0, 4).map((mp) => (
                    <Text key={mp.id} style={styles.matchProspect}>{`• ${TYPE_LABEL[mp.type]} — ${mp.segment} (fit ${mp.dealFit})`}</Text>
                  ))}
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.cardHeaderRow}>
            <Users size={15} color={Colors.text} />
            <Text style={styles.eyebrow}>{`Top prospects (${dashboard.totals.total} profiles · ${dashboard.totals.buyer}B / ${dashboard.totals.investor}I / ${dashboard.totals.developer}D / ${dashboard.totals.partner}P)`}</Text>
          </View>
          {dashboard.topProspects.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.emptyBody}>No prospect profiles yet. Tap “Find best capital sources” to scan your published deals.</Text>
            </View>
          ) : (
            dashboard.topProspects.map((p) => (
              <ProspectCard key={p.id} p={p} onStatus={handleStatus} busy={busyId === p.id} />
            ))
          )}

          <Text style={styles.footnote}>{dashboard.disclaimer}</Text>
        </>
      ) : (
        <View style={styles.card}>
          {dashboardQuery.isLoading ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : (
            <Text style={styles.emptyBody}>{dashboardQuery.error instanceof Error ? dashboardQuery.error.message : 'No capital-network data yet.'}</Text>
          )}
        </View>
      )}
    </ScrollView>
  );
}

export default function CapitalNetworkScreen() {
  return (
    <ErrorBoundary>
      <Stack.Screen options={{ title: 'Capital Network' }} />
      <CapitalNetworkContent />
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
  bestGrid: { flexDirection: 'row', gap: 10 },
  bestCard: { flex: 1, backgroundColor: Colors.card, borderRadius: 14, padding: 12, gap: 5, borderWidth: 1, borderColor: Colors.border },
  bestHeader: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  bestLabel: { flex: 1, fontSize: 10, fontWeight: '700' as const, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
  bestPill: { backgroundColor: Colors.black, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: Colors.primary },
  bestPillText: { fontSize: 11, fontWeight: '800' as const, color: Colors.primary },
  bestTitle: { fontSize: 12.5, fontWeight: '700' as const, color: Colors.text },
  bestWhy: { fontSize: 11, lineHeight: 15, color: Colors.textSecondary },
  bestNext: { fontSize: 10.5, lineHeight: 14, color: Colors.textTertiary, fontStyle: 'italic' as const },
  card: { backgroundColor: Colors.card, borderRadius: 16, padding: 16, gap: 9, borderWidth: 1, borderColor: Colors.border },
  followUpCard: { borderColor: Colors.primary },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  eyebrow: { flex: 1, fontSize: 12, fontWeight: '700' as const, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6 },
  emptyBody: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  marketName: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  marketMeta: { fontSize: 12, color: Colors.textSecondary },
  followUpText: { fontSize: 13.5, lineHeight: 19, color: Colors.text, fontWeight: '600' as const },
  followUpMeta: { fontSize: 11.5, color: Colors.textTertiary },
  matchRow: { gap: 3, paddingVertical: 6, borderTopWidth: 1, borderTopColor: Colors.border },
  matchDeal: { fontSize: 13, fontWeight: '700' as const, color: Colors.text },
  matchProspect: { fontSize: 11.5, lineHeight: 16, color: Colors.textSecondary },
  typeBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.primary, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  typeBadgeText: { fontSize: 10.5, fontWeight: '700' as const, color: Colors.black },
  overallPill: { backgroundColor: Colors.black, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: Colors.primary },
  overallPillText: { fontSize: 13, fontWeight: '800' as const, color: Colors.primary },
  segment: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  companyType: { fontSize: 12, color: Colors.textSecondary },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  metaText: { fontSize: 12, color: Colors.textTertiary },
  focus: { fontSize: 12, color: Colors.text },
  signal: { fontSize: 11.5, lineHeight: 16, color: Colors.textSecondary, fontStyle: 'italic' as const },
  scoreBlock: { gap: 5, marginTop: 4 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scoreLabel: { fontSize: 11, color: Colors.textSecondary, width: 70 },
  scoreTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: Colors.surfaceLight, overflow: 'hidden' },
  scoreFill: { height: 6, borderRadius: 3 },
  scoreValue: { fontSize: 11, color: Colors.text, width: 24, textAlign: 'right' },
  sourceRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 2 },
  sourceText: { flex: 1, fontSize: 11, lineHeight: 15, color: Colors.textSecondary },
  expandButton: { paddingVertical: 8, alignItems: 'center', borderRadius: 10, borderWidth: 1, borderColor: Colors.border, marginTop: 2 },
  expandButtonText: { fontSize: 12.5, fontWeight: '600' as const, color: Colors.primary },
  expandBody: { gap: 6, marginTop: 4 },
  sectionEyebrow: { fontSize: 11, fontWeight: '700' as const, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 6 },
  bodyText: { fontSize: 12, lineHeight: 17, color: Colors.textSecondary },
  evidence: { fontSize: 11.5, lineHeight: 16, color: Colors.textTertiary, fontStyle: 'italic' as const },
  riskItem: { fontSize: 11.5, lineHeight: 16, color: Colors.warning },
  compliance: { fontSize: 10.5, lineHeight: 15, color: Colors.textTertiary, fontStyle: 'italic' as const, marginTop: 8 },
  actionFlowRow: { flexDirection: 'row', gap: 8, marginTop: 6, flexWrap: 'wrap' as const },
  flowChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 11, borderRadius: 10, borderWidth: 1, borderColor: Colors.primary },
  flowChipActive: { backgroundColor: Colors.primary },
  flowChipText: { fontSize: 11.5, fontWeight: '700' as const, color: Colors.primary },
  flowChipTextActive: { color: Colors.black },
  panel: { backgroundColor: Colors.surfaceLight, borderRadius: 12, padding: 12, gap: 5, marginTop: 8, borderWidth: 1, borderColor: Colors.border },
  panelHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  panelLabel: { fontSize: 11, fontWeight: '700' as const, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 6 },
  bullet: { fontSize: 12, lineHeight: 17, color: Colors.textSecondary },
  confidencePill: { backgroundColor: Colors.black, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 3, borderWidth: 1, borderColor: Colors.primary },
  confidencePillText: { fontSize: 11, fontWeight: '800' as const, color: Colors.primary },
  complianceRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 8, backgroundColor: Colors.background, borderRadius: 8, padding: 8 },
  complianceWarn: { flex: 1, fontSize: 10.5, lineHeight: 15, color: Colors.warning },
  contactStatusPill: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 3, marginTop: 2 },
  contactUnverified: { backgroundColor: 'rgba(255,176,32,0.16)', borderWidth: 1, borderColor: Colors.warning },
  contactVerified: { backgroundColor: 'rgba(52,199,89,0.16)', borderWidth: 1, borderColor: Colors.success },
  contactStatusText: { fontSize: 10.5, fontWeight: '800' as const, color: Colors.warning, letterSpacing: 0.3 },
  channelRow: { gap: 2, paddingVertical: 5, borderTopWidth: 1, borderTopColor: Colors.border },
  channelType: { fontSize: 10.5, fontWeight: '700' as const, color: Colors.primary, textTransform: 'uppercase', letterSpacing: 0.4 },
  channelDetail: { fontSize: 12, lineHeight: 16, color: Colors.text },
  sendPill: { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 3 },
  sendReady: { backgroundColor: 'rgba(52,199,89,0.16)', borderWidth: 1, borderColor: Colors.success },
  sendBlocked: { backgroundColor: 'rgba(255,176,32,0.16)', borderWidth: 1, borderColor: Colors.warning },
  sendPillText: { fontSize: 10, fontWeight: '800' as const, color: Colors.text, letterSpacing: 0.3 },
  draftBody: { fontSize: 12, lineHeight: 17, color: Colors.text, backgroundColor: Colors.background, borderRadius: 8, padding: 9 },
  draftNoteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 8 },
  draftNote: { flex: 1, fontSize: 11, lineHeight: 15, color: Colors.textSecondary },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  actBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.primary, paddingVertical: 9, borderRadius: 10, flex: 1 },
  actBtnText: { fontSize: 12.5, fontWeight: '700' as const, color: Colors.black },
  actBtnGhost: { alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: 10, flex: 1, borderWidth: 1, borderColor: Colors.border },
  actBtnGhostText: { fontSize: 12.5, fontWeight: '600' as const, color: Colors.text },
  statusLine: { fontSize: 11, color: Colors.textTertiary, marginTop: 2 },
  footnote: { fontSize: 11, lineHeight: 16, color: Colors.textTertiary, textAlign: 'center', marginTop: 6 },
});
