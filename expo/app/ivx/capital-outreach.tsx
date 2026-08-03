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
  CalendarClock,
  CheckCircle2,
  FileText,
  Handshake,
  Lightbulb,
  Link2,
  Mail,
  Search,
  Send,
  ShieldCheck,
  Target,
  UserCheck,
  Users,
  XCircle} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  createProspectOutreachDraft,
  getCapitalOutreachPlan,
  getProspectActionPlan,
  getProspectResearch,
  setProspectStatus,
  type CapitalOutreachPlan,
  type InvestorPacketItem,
  type OutreachDraftResult,
  type OutreachStrategy,
  type PacketPriority,
  type ProspectActionPlan,
  type ProspectResearch,
  type ProspectStatus} from '@/src/modules/ivx-developer/capitalNetworkService';

const POLL_INTERVAL_MS = 12000;

const PRIORITY_TONE: Record<string, string> = {
  high: Colors.success,
  medium: Colors.warning,
  low: Colors.textTertiary};

const PACKET_TONE: Record<PacketPriority, string> = {
  required: Colors.error,
  recommended: Colors.warning,
  optional: Colors.textTertiary};

type ActionPanel = 'sequence' | 'why' | 'research' | 'draft' | null;

const STATUS_LABEL: Record<ProspectStatus, string> = {
  new: 'New',
  researching: 'Researching',
  contacted: 'Contacted',
  qualified: 'Qualified',
  matched: 'Matched',
  dismissed: 'Dismissed'};

function ActionButton({
  icon,
  label,
  onPress,
  busy,
  tone,
  testID}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  busy?: boolean;
  tone?: string;
  testID?: string;
}) {
  return (
    <Pressable
      style={[styles.actionBtn, tone ? { borderColor: tone } : null]}
      onPress={onPress}
      disabled={busy}
      testID={testID}
    >
      {busy ? <ShimmerIndicator size="small" color={tone ?? Colors.primary} /> : icon}
      <Text style={[styles.actionBtnText, tone ? { color: tone } : null]}>{label}</Text>
    </Pressable>
  );
}

function StrategyCard({ s }: { s: OutreachStrategy }) {
  const [panel, setPanel] = useState<ActionPanel>(null);
  const [status, setStatus] = useState<ProspectStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionPlan, setActionPlan] = useState<ProspectActionPlan | null>(null);
  const [research, setResearch] = useState<ProspectResearch | null>(null);
  const [draft, setDraft] = useState<OutreachDraftResult | null>(null);
  const tone = PRIORITY_TONE[s.priority] ?? Colors.textTertiary;

  const togglePanel = useCallback((next: Exclude<ActionPanel, null>) => {
    setPanel((prev) => (prev === next ? null : next));
  }, []);

  const run = useCallback(
    async (key: string, fn: () => Promise<void>) => {
      setBusy(key);
      setActionError(null);
      try {
        await fn();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'Action failed.');
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const onWhy = useCallback(() => {
    togglePanel('why');
    if (actionPlan) return;
    void run('why', async () => {
      const plan = await getProspectActionPlan(s.prospectId);
      setActionPlan(plan);
    });
  }, [actionPlan, run, s.prospectId, togglePanel]);

  const onResearch = useCallback(() => {
    togglePanel('research');
    if (research) return;
    void run('research', async () => {
      const r = await getProspectResearch(s.prospectId);
      setResearch(r);
      await setProspectStatus(s.prospectId, 'researching');
      setStatus('researching');
    });
  }, [research, run, s.prospectId, togglePanel]);

  const onDraft = useCallback(() => {
    togglePanel('draft');
    if (draft) return;
    void run('draft', async () => {
      const d = await createProspectOutreachDraft(s.prospectId);
      setDraft(d);
    });
  }, [draft, run, s.prospectId, togglePanel]);

  const onStatus = useCallback(
    (next: ProspectStatus, key: string) => {
      void run(key, async () => {
        const updated = await setProspectStatus(s.prospectId, next);
        setStatus(updated?.status ?? next);
      });
    },
    [run, s.prospectId],
  );

  return (
    <View style={styles.card} testID={`ivx-outreach-${s.prospectId}`}>
      <View style={styles.cardHeaderRow}>
        <View style={[styles.priorityPill, { borderColor: tone }]}>
          <Text style={[styles.priorityPillText, { color: tone }]}>{s.priority.toUpperCase()}</Text>
        </View>
        {status ? (
          <View style={styles.statusPill}>
            <Text style={styles.statusPillText}>{STATUS_LABEL[status]}</Text>
          </View>
        ) : null}
        <Text style={styles.overallText}>{`${s.overall}/100`}</Text>
      </View>
      <Text style={styles.segment}>{s.segment}</Text>
      <View style={styles.metaRow}>
        <Link2 size={12} color={Colors.textSecondary} />
        <Text style={styles.metaText}>{s.primaryChannel}</Text>
      </View>
      <Text style={styles.approach}>{s.approach}</Text>

      {/* Action layer */}
      <View style={styles.actionGrid}>
        <ActionButton
          icon={<Lightbulb size={14} color={Colors.primary} />}
          label="Why + next action"
          onPress={onWhy}
          busy={busy === 'why'}
          testID={`ivx-outreach-why-${s.prospectId}`}
        />
        <ActionButton
          icon={<Search size={14} color={Colors.primary} />}
          label="Research contacts"
          onPress={onResearch}
          busy={busy === 'research'}
          testID={`ivx-outreach-research-${s.prospectId}`}
        />
        <ActionButton
          icon={<Mail size={14} color={Colors.primary} />}
          label="Generate draft"
          onPress={onDraft}
          busy={busy === 'draft'}
          testID={`ivx-outreach-draft-${s.prospectId}`}
        />
        <ActionButton
          icon={<UserCheck size={14} color={Colors.success} />}
          label="Qualify"
          tone={Colors.success}
          onPress={() => onStatus('qualified', 'qualify')}
          busy={busy === 'qualify'}
          testID={`ivx-outreach-qualify-${s.prospectId}`}
        />
        <ActionButton
          icon={<Send size={14} color={Colors.info} />}
          label="Mark contacted"
          tone={Colors.info}
          onPress={() => onStatus('contacted', 'contacted')}
          busy={busy === 'contacted'}
          testID={`ivx-outreach-contacted-${s.prospectId}`}
        />
        <ActionButton
          icon={<XCircle size={14} color={Colors.error} />}
          label="Dismiss"
          tone={Colors.error}
          onPress={() => onStatus('dismissed', 'dismiss')}
          busy={busy === 'dismiss'}
          testID={`ivx-outreach-dismiss-${s.prospectId}`}
        />
      </View>

      <Pressable style={styles.expandButton} onPress={() => togglePanel('sequence')} testID={`ivx-outreach-expand-${s.prospectId}`}>
        <Text style={styles.expandButtonText}>{panel === 'sequence' ? 'Hide outreach sequence' : 'View outreach sequence'}</Text>
      </Pressable>

      {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}

      {panel === 'sequence' ? (
        <View style={styles.expandBody}>
          {s.steps.map((step) => (
            <View key={`${s.prospectId}-${step.order}`} style={styles.stepRow}>
              <View style={styles.stepNum}><Text style={styles.stepNumText}>{step.order}</Text></View>
              <View style={styles.stepBody}>
                <Text style={styles.stepAction}>{step.action}</Text>
                <Text style={styles.stepMeta}>{`${step.timing} · ${step.channel}`}</Text>
              </View>
            </View>
          ))}
          <Text style={styles.evidence}>{s.evidence}</Text>
          {s.matchedDealNames.length > 0 ? (
            <Text style={styles.matchedDeals}>{`Matched IVX deals: ${s.matchedDealNames.join(' · ')}`}</Text>
          ) : null}
          <Text style={styles.compliance}>{s.complianceNote}</Text>
        </View>
      ) : null}

      {panel === 'why' && actionPlan ? (
        <View style={styles.panelBody}>
          <Text style={styles.panelTitle}>Why this prospect</Text>
          <Text style={styles.panelText}>{actionPlan.whyThisProspect}</Text>
          <Text style={styles.panelLabel}>Deal angle</Text>
          <Text style={styles.panelText}>{actionPlan.bestOutreachAngle}</Text>
          <Text style={styles.panelLabel}>Likely objections</Text>
          {actionPlan.likelyObjections.map((o, i) => (
            <Text key={`obj-${i}`} style={styles.panelBullet}>{`• ${o}`}</Text>
          ))}
          <Text style={styles.panelLabel}>Recommended next step</Text>
          <Text style={styles.panelText}>{actionPlan.recommendedNextStep}</Text>
          <View style={styles.confidenceRow}>
            <Text style={styles.confidenceText}>{`Confidence ${actionPlan.confidenceScore}/100`}</Text>
          </View>
          <Text style={styles.compliance}>{actionPlan.complianceWarning}</Text>
        </View>
      ) : null}

      {panel === 'research' && research ? (
        <View style={styles.panelBody}>
          <Text style={styles.panelTitle}>Research channels</Text>
          <View style={[styles.contactStatusPill, research.contactStatus === 'CONTACT_VERIFIED' ? styles.contactVerified : styles.contactUnverified]}>
            <AlertTriangle size={11} color={research.contactStatus === 'CONTACT_VERIFIED' ? Colors.success : Colors.warning} />
            <Text style={[styles.contactStatusText, { color: research.contactStatus === 'CONTACT_VERIFIED' ? Colors.success : Colors.warning }]}>
              {research.contactStatus}
            </Text>
          </View>
          {research.channels.map((c, i) => (
            <View key={`ch-${i}`} style={styles.channelRow}>
              <Text style={styles.channelLabel}>{c.label}</Text>
              <Text style={styles.channelDetail}>{c.detail}</Text>
            </View>
          ))}
          <Text style={styles.panelNote}>{research.note}</Text>
        </View>
      ) : null}

      {panel === 'draft' && draft ? (
        <View style={styles.panelBody}>
          <Text style={styles.panelTitle}>Outreach draft</Text>
          <View style={styles.approvalGate}>
            <ShieldCheck size={12} color={Colors.warning} />
            <Text style={styles.approvalGateText}>
              {draft.sendStatus === 'PROVIDER_CONFIGURED'
                ? 'Owner approval required in Outreach before sending.'
                : 'EMAIL_PROVIDER_NOT_CONFIGURED — draft saved only, nothing is sent.'}
            </Text>
          </View>
          <Text style={styles.panelLabel}>Subject</Text>
          <Text style={styles.panelText}>{draft.draft.subject}</Text>
          <Text style={styles.panelLabel}>Email body</Text>
          <Text style={styles.panelText}>{draft.draft.emailBody}</Text>
          {draft.draft.shortMessage ? (
            <>
              <Text style={styles.panelLabel}>Short message (SMS / LinkedIn)</Text>
              <Text style={styles.panelText}>{draft.draft.shortMessage}</Text>
            </>
          ) : null}
          <Text style={styles.panelLabel}>Attachment</Text>
          <Text style={styles.panelText}>{draft.draft.attachmentPlaceholder}</Text>
          <Text style={styles.compliance}>{draft.draft.complianceDisclaimer}</Text>
          {draft.outreachMessage ? (
            <Text style={styles.panelNote}>{`Saved to Outreach as ${draft.outreachMessage.status} (id ${draft.outreachMessage.id}).`}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function PacketRow({ item }: { item: InvestorPacketItem }) {
  const tone = PACKET_TONE[item.priority];
  return (
    <View style={styles.packetRow}>
      <View style={styles.packetHeader}>
        <FileText size={13} color={tone} />
        <Text style={styles.packetItem}>{item.item}</Text>
        <View style={[styles.packetPill, { borderColor: tone }]}>
          <Text style={[styles.packetPillText, { color: tone }]}>{item.priority}</Text>
        </View>
      </View>
      <Text style={styles.packetReason}>{item.reason}</Text>
      {item.forSegments.length > 0 ? (
        <Text style={styles.packetSegments}>{`For: ${item.forSegments.join(' · ')}`}</Text>
      ) : null}
    </View>
  );
}

function CapitalOutreachContent() {
  const insets = useSafeAreaInsets();

  const planQuery = useQuery<CapitalOutreachPlan | null>({
    queryKey: ['ivx-capital-outreach', 'plan'],
    queryFn: getCapitalOutreachPlan,
    refetchInterval: POLL_INTERVAL_MS});

  const plan = planQuery.data ?? null;
  const refetch = useCallback(() => { void planQuery.refetch(); }, [planQuery]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 48 }]}
      refreshControl={<RefreshControl tintColor={Colors.primary} refreshing={planQuery.isFetching} onRefresh={refetch} />}
      testID="ivx-capital-outreach-scroll"
    >
      <View style={styles.heroCard}>
        <View style={styles.heroHeaderRow}>
          <Send size={18} color={Colors.primary} />
          <Text style={styles.heroTitle}>Capital Outreach Intelligence</Text>
        </View>
        <Text style={styles.heroSubtitle}>
          The evidence-based raise plan built on your scored capital sources — outreach strategy, investor packet, broker introductions, partnership targets, and a 30-day capital-raising plan. No fabricated contacts; outreach runs through named public channels with compliance review.
        </Text>
        {plan ? <Text style={styles.headline}>{plan.headline}</Text> : null}
      </View>

      {plan ? (
        <>
          {/* Outreach strategies */}
          <View style={styles.cardHeaderRow}>
            <Target size={15} color={Colors.text} />
            <Text style={styles.eyebrow}>{`Outreach strategy (${plan.outreachStrategies.length})`}</Text>
          </View>
          {plan.outreachStrategies.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.emptyBody}>No scored prospects yet. Run “Find best capital sources” on the Capital Network screen first.</Text>
            </View>
          ) : (
            plan.outreachStrategies.map((s) => <StrategyCard key={s.prospectId} s={s} />)
          )}

          {/* Investor packet */}
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <FileText size={15} color={Colors.info} />
              <Text style={styles.eyebrow}>Investor packet recommendations</Text>
            </View>
            {plan.investorPacket.map((item, i) => (
              <PacketRow key={`packet-${i}`} item={item} />
            ))}
          </View>

          {/* Broker introductions */}
          {plan.brokerIntroductions.length > 0 ? (
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Users size={15} color={Colors.warning} />
                <Text style={styles.eyebrow}>Broker introductions needed</Text>
              </View>
              {plan.brokerIntroductions.map((b) => (
                <View key={b.prospectId} style={styles.introRow}>
                  <Text style={styles.introSegment}>{b.segment}</Text>
                  <Text style={styles.introMeta}>{b.channel}</Text>
                  <Text style={styles.introWhy}>{b.why}</Text>
                  <Text style={styles.introNext}>{`Next: ${b.nextAction}`}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* Partnership targets */}
          {plan.partnershipTargets.length > 0 ? (
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Handshake size={15} color={Colors.success} />
                <Text style={styles.eyebrow}>Partnership targets</Text>
              </View>
              {plan.partnershipTargets.map((t) => (
                <View key={t.prospectId} style={styles.introRow}>
                  <View style={styles.partnerHeader}>
                    <Text style={styles.introSegment}>{t.segment}</Text>
                    <Text style={styles.overallText}>{`${t.overall}/100`}</Text>
                  </View>
                  <Text style={styles.introMeta}>{t.companyType}</Text>
                  <Text style={styles.introWhy}>{t.why}</Text>
                  <Text style={styles.introNext}>{`Next: ${t.nextAction}`}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* 30-day plan */}
          <View style={styles.cardHeaderRow}>
            <CalendarClock size={15} color={Colors.primary} />
            <Text style={styles.eyebrow}>Next 30-day capital-raising plan</Text>
          </View>
          {plan.thirtyDayPlan.map((phase, i) => (
            <View key={`phase-${i}`} style={styles.phaseCard}>
              <Text style={styles.phaseWindow}>{phase.window}</Text>
              <Text style={styles.phaseFocus}>{phase.focus}</Text>
              {phase.actions.map((a, j) => (
                <View key={`phase-${i}-act-${j}`} style={styles.actionLineRow}>
                  <CheckCircle2 size={12} color={Colors.success} />
                  <Text style={styles.actionLineText}>{a}</Text>
                </View>
              ))}
              {phase.targets.length > 0 ? (
                <Text style={styles.phaseTargets}>{`Targets: ${phase.targets.join(' · ')}`}</Text>
              ) : null}
            </View>
          ))}

          <View style={styles.disclaimerRow}>
            <ShieldCheck size={13} color={Colors.textTertiary} />
            <Text style={styles.footnote}>{plan.disclaimer}</Text>
          </View>
        </>
      ) : (
        <View style={styles.card}>
          {planQuery.isLoading ? (
            <ShimmerIndicator size="small" color={Colors.primary} />
          ) : (
            <Text style={styles.emptyBody}>{planQuery.error instanceof Error ? planQuery.error.message : 'No outreach plan yet.'}</Text>
          )}
        </View>
      )}
    </ScrollView>
  );
}

export default function CapitalOutreachScreen() {
  return (
    <ErrorBoundary>
      <Stack.Screen options={{ title: 'Capital Outreach' }} />
      <CapitalOutreachContent />
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
  headline: { fontSize: 13, lineHeight: 19, color: Colors.text, fontWeight: '600' as const },
  card: { backgroundColor: Colors.card, borderRadius: 16, padding: 16, gap: 9, borderWidth: 1, borderColor: Colors.border },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  eyebrow: { flex: 1, fontSize: 12, fontWeight: '700' as const, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6 },
  emptyBody: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  priorityPill: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  priorityPillText: { fontSize: 10, fontWeight: '800' as const, letterSpacing: 0.5 },
  overallText: { fontSize: 12.5, fontWeight: '800' as const, color: Colors.primary },
  segment: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { flex: 1, fontSize: 12, color: Colors.textSecondary },
  approach: { fontSize: 12.5, lineHeight: 18, color: Colors.textSecondary, fontStyle: 'italic' as const },
  expandButton: { paddingVertical: 8, alignItems: 'center', borderRadius: 10, borderWidth: 1, borderColor: Colors.border, marginTop: 2 },
  expandButtonText: { fontSize: 12.5, fontWeight: '600' as const, color: Colors.primary },
  expandBody: { gap: 8, marginTop: 4 },
  stepRow: { flexDirection: 'row', gap: 9, alignItems: 'flex-start' },
  stepNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { fontSize: 11, fontWeight: '800' as const, color: Colors.black },
  stepBody: { flex: 1, gap: 2 },
  stepAction: { fontSize: 12.5, lineHeight: 17, color: Colors.text },
  stepMeta: { fontSize: 10.5, color: Colors.textTertiary },
  evidence: { fontSize: 11.5, lineHeight: 16, color: Colors.textTertiary, fontStyle: 'italic' as const, marginTop: 4 },
  matchedDeals: { fontSize: 11.5, color: Colors.textSecondary },
  compliance: { fontSize: 10.5, lineHeight: 15, color: Colors.textTertiary, fontStyle: 'italic' as const, marginTop: 4 },
  packetRow: { gap: 3, paddingVertical: 7, borderTopWidth: 1, borderTopColor: Colors.border },
  packetHeader: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  packetItem: { flex: 1, fontSize: 13, fontWeight: '600' as const, color: Colors.text },
  packetPill: { borderWidth: 1, borderRadius: 7, paddingHorizontal: 7, paddingVertical: 1 },
  packetPillText: { fontSize: 9.5, fontWeight: '700' as const, textTransform: 'uppercase', letterSpacing: 0.4 },
  packetReason: { fontSize: 11.5, lineHeight: 16, color: Colors.textSecondary },
  packetSegments: { fontSize: 11, color: Colors.textTertiary },
  introRow: { gap: 3, paddingVertical: 7, borderTopWidth: 1, borderTopColor: Colors.border },
  partnerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  introSegment: { fontSize: 13.5, fontWeight: '700' as const, color: Colors.text },
  introMeta: { fontSize: 11.5, color: Colors.textSecondary },
  introWhy: { fontSize: 11.5, lineHeight: 16, color: Colors.textSecondary },
  introNext: { fontSize: 11.5, lineHeight: 16, color: Colors.text, fontStyle: 'italic' as const },
  phaseCard: { backgroundColor: Colors.card, borderRadius: 14, padding: 14, gap: 6, borderWidth: 1, borderColor: Colors.border },
  phaseWindow: { fontSize: 13.5, fontWeight: '800' as const, color: Colors.primary },
  phaseFocus: { fontSize: 12.5, color: Colors.textSecondary, lineHeight: 17 },
  actionLineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  actionLineText: { flex: 1, fontSize: 12, lineHeight: 17, color: Colors.text },
  phaseTargets: { fontSize: 11, color: Colors.textTertiary, marginTop: 2 },
  disclaimerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: 6 },
  footnote: { flex: 1, fontSize: 11, lineHeight: 16, color: Colors.textTertiary },
  statusPill: { borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: Colors.backgroundSecondary },
  statusPillText: { fontSize: 10, fontWeight: '700' as const, color: Colors.textSecondary, letterSpacing: 0.4 },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: Colors.backgroundSecondary },
  actionBtnText: { fontSize: 12, fontWeight: '600' as const, color: Colors.text },
  actionError: { fontSize: 11.5, lineHeight: 16, color: Colors.error, marginTop: 4 },
  panelBody: { gap: 6, marginTop: 6, paddingTop: 10, borderTopWidth: 1, borderTopColor: Colors.border },
  panelTitle: { fontSize: 13, fontWeight: '800' as const, color: Colors.text },
  panelLabel: { fontSize: 11, fontWeight: '700' as const, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 },
  panelText: { fontSize: 12.5, lineHeight: 18, color: Colors.text },
  panelBullet: { fontSize: 12, lineHeight: 17, color: Colors.textSecondary },
  panelNote: { fontSize: 11, lineHeight: 16, color: Colors.textTertiary, fontStyle: 'italic' as const, marginTop: 4 },
  confidenceRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  confidenceText: { fontSize: 11.5, fontWeight: '700' as const, color: Colors.primary },
  contactStatusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  contactStatusText: { fontSize: 10.5, fontWeight: '700' as const, letterSpacing: 0.4 },
  contactVerified: { borderColor: Colors.success, backgroundColor: 'rgba(34,197,94,0.08)' },
  contactUnverified: { borderColor: Colors.warning, backgroundColor: 'rgba(245,158,11,0.08)' },
  channelRow: { gap: 2, paddingVertical: 5, borderTopWidth: 1, borderTopColor: Colors.border },
  channelLabel: { fontSize: 12, fontWeight: '600' as const, color: Colors.text },
  channelDetail: { fontSize: 11.5, lineHeight: 16, color: Colors.textSecondary },
  approvalGate: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, borderWidth: 1, borderColor: Colors.warning, borderRadius: 10, padding: 9, backgroundColor: 'rgba(245,158,11,0.07)' },
  approvalGateText: { flex: 1, fontSize: 11.5, lineHeight: 16, color: Colors.warning }});
