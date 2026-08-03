import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View} from "react-native";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  FileText,
  Flame,
  Mail,
  Plus,
  Rocket,
  ShieldAlert,
  Snowflake,
  Sun,
  UserCheck,
  X} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  captureLead,
  createDealPacket,
  deleteLead,
  getPowerToolsDashboard,
  listDealPackets,
  listLeads,
  prepareOutreachDraft,
  recordLeadBehavior,
  setLeadFollowUp,
  setLeadStage,
  setPacketItem,
  LEAD_PIPELINE_STAGES,
  type CaptureLeadInput,
  type DealPacket,
  type LeadPipelineStage,
  type LeadRecord,
  type LeadRole,
  type LeadTemperature,
  type PowerToolsDashboard,
  type PreparedDraft} from '@/src/modules/ivx-developer/powerToolsService';

const TEMP_TONE: Record<LeadTemperature, string> = {
  cold: Colors.info,
  warm: Colors.warning,
  hot: Colors.error,
  qualified: Colors.success};

const STAGE_LABEL: Record<LeadPipelineStage, string> = {
  new_lead: 'New lead',
  qualified: 'Qualified',
  contacted: 'Contacted',
  replied: 'Replied',
  meeting_requested: 'Meeting',
  data_room_sent: 'Data room',
  loi_requested: 'LOI',
  soft_commitment: 'Soft commit',
  closed: 'Closed',
  lost: 'Lost'};

const ROLES: LeadRole[] = ['buyer', 'investor', 'broker', 'seller', 'lender'];

function TempIcon({ t, size }: { t: LeadTemperature; size: number }) {
  if (t === 'hot' || t === 'qualified') return <Flame size={size} color={TEMP_TONE[t]} />;
  if (t === 'warm') return <Sun size={size} color={TEMP_TONE.warm} />;
  return <Snowflake size={size} color={TEMP_TONE.cold} />;
}

function MetricTile({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <View style={styles.metricTile}>
      <Text style={[styles.metricValue, tone ? { color: tone } : null]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function nextStage(stage: LeadPipelineStage): LeadPipelineStage {
  const idx = LEAD_PIPELINE_STAGES.indexOf(stage);
  if (idx < 0 || idx >= LEAD_PIPELINE_STAGES.length - 1) return LEAD_PIPELINE_STAGES[0]!;
  return LEAD_PIPELINE_STAGES[idx + 1]!;
}

function LeadCard({
  lead,
  onAdvance,
  onVerify,
  onFollowUp,
  onDelete}: {
  lead: LeadRecord;
  onAdvance: (l: LeadRecord) => void;
  onVerify: (l: LeadRecord) => void;
  onFollowUp: (l: LeadRecord) => void;
  onDelete: (l: LeadRecord) => void;
}) {
  const [open, setOpen] = useState<boolean>(false);
  const tone = TEMP_TONE[lead.temperature];
  const contact = lead.email || lead.phone || 'no contact';
  return (
    <View style={styles.card} testID={`ivx-lead-${lead.id}`}>
      <Pressable style={styles.cardHeader} onPress={() => setOpen((v) => !v)}>
        <View style={styles.scoreCircle}>
          <Text style={[styles.scoreCircleText, { color: tone }]}>{lead.leadScore}</Text>
        </View>
        <View style={styles.cardTitleBlock}>
          <Text style={styles.cardName} numberOfLines={1}>{lead.name}</Text>
          <Text style={styles.cardCompany} numberOfLines={1}>{`${lead.role} · ${contact}`}</Text>
        </View>
        <View style={[styles.tempPill, { borderColor: tone }]}>
          <TempIcon t={lead.temperature} size={11} />
          <Text style={[styles.tempPillText, { color: tone }]}>{lead.temperature}</Text>
        </View>
        {open ? <ChevronUp size={18} color={Colors.textTertiary} /> : <ChevronDown size={18} color={Colors.textTertiary} />}
      </Pressable>

      <View style={styles.stageRow}>
        <Pressable style={styles.stagePill} onPress={() => onAdvance(lead)} testID={`ivx-lead-stage-${lead.id}`}>
          <Text style={styles.stagePillText}>{STAGE_LABEL[lead.stage]}</Text>
          <ChevronDown size={12} color={Colors.primary} />
        </Pressable>
        {lead.followUpDueAt ? (
          <Text style={styles.followUpText}>{`Follow-up ${new Date(lead.followUpDueAt).toLocaleDateString()}`}</Text>
        ) : null}
      </View>

      {open ? (
        <View style={styles.detailBlock}>
          {lead.budgetRange ? <Text style={styles.detailRow}>{`Budget: ${lead.budgetRange}`}</Text> : null}
          {lead.preferredMarket ? <Text style={styles.detailRow}>{`Market: ${lead.preferredMarket}`}</Text> : null}
          {lead.relatedDeal ? <Text style={styles.detailRow}>{`Deal: ${lead.relatedDeal}`}</Text> : null}
          <Text style={styles.detailRow}>{`Source: ${lead.source}${lead.consent ? ' · consented' : ''}`}</Text>
          <Text style={styles.detailRow}>{`Contact verified: ${lead.signals.contactVerified ? 'yes' : 'no'}`}</Text>
          <View style={styles.actionRow}>
            {!lead.signals.contactVerified ? (
              <Pressable style={styles.actionBtn} onPress={() => onVerify(lead)} testID={`ivx-lead-verify-${lead.id}`}>
                <UserCheck size={13} color={Colors.success} />
                <Text style={styles.actionBtnText}>Verify contact</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.actionBtn} onPress={() => onFollowUp(lead)}>
              <Mail size={13} color={Colors.primary} />
              <Text style={styles.actionBtnText}>Follow-up +3d</Text>
            </Pressable>
            <Pressable style={styles.actionBtn} onPress={() => onDelete(lead)}>
              <X size={13} color={Colors.error} />
              <Text style={[styles.actionBtnText, { color: Colors.error }]}>Delete</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function PacketCard({ packet, onToggle }: { packet: DealPacket; onToggle: (p: DealPacket, key: string, ready: boolean) => void }) {
  const [open, setOpen] = useState<boolean>(false);
  return (
    <View style={styles.card}>
      <Pressable style={styles.cardHeader} onPress={() => setOpen((v) => !v)}>
        <FileText size={18} color={packet.complete ? Colors.success : Colors.primary} />
        <View style={styles.cardTitleBlock}>
          <Text style={styles.cardName} numberOfLines={1}>{packet.dealName}</Text>
          <Text style={styles.cardCompany}>{`${packet.readiness}% ready${packet.complete ? ' · complete' : ''}`}</Text>
        </View>
        {open ? <ChevronUp size={18} color={Colors.textTertiary} /> : <ChevronDown size={18} color={Colors.textTertiary} />}
      </Pressable>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${packet.readiness}%`, backgroundColor: packet.complete ? Colors.success : Colors.primary }]} />
      </View>
      {open ? (
        <View style={styles.detailBlock}>
          {packet.items.map((item) => {
            const ready = item.status === 'ready';
            return (
              <Pressable key={item.key} style={styles.packetItemRow} onPress={() => onToggle(packet, item.key, !ready)}>
                {ready ? <CheckCircle2 size={16} color={Colors.success} /> : <Circle size={16} color={Colors.textTertiary} />}
                <Text style={[styles.packetItemText, ready ? styles.packetItemDone : null]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function PowerToolsContent() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'leads' | 'packets'>('leads');
  const [captureOpen, setCaptureOpen] = useState<boolean>(false);
  const [draft, setDraft] = useState<PreparedDraft | null>(null);

  const dashQuery = useQuery<PowerToolsDashboard | null>({ queryKey: ['ivx-power-tools-dash'], queryFn: getPowerToolsDashboard });
  const leadsQuery = useQuery({ queryKey: ['ivx-power-tools-leads'], queryFn: listLeads });
  const packetsQuery = useQuery({ queryKey: ['ivx-power-tools-packets'], queryFn: listDealPackets });

  const dash = dashQuery.data ?? null;
  const leads = useMemo(() => leadsQuery.data?.leads ?? [], [leadsQuery.data]);
  const packets = useMemo(() => packetsQuery.data?.packets ?? [], [packetsQuery.data]);

  const invalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['ivx-power-tools-dash'] });
    void qc.invalidateQueries({ queryKey: ['ivx-power-tools-leads'] });
    void qc.invalidateQueries({ queryKey: ['ivx-power-tools-packets'] });
  }, [qc]);

  const captureMutation = useMutation({
    mutationFn: (input: CaptureLeadInput) => captureLead(input),
    onSuccess: () => { setCaptureOpen(false); invalidate(); }});
  const advanceMutation = useMutation({
    mutationFn: (l: LeadRecord) => setLeadStage(l.id, nextStage(l.stage)),
    onSuccess: invalidate});
  const verifyMutation = useMutation({
    mutationFn: (l: LeadRecord) => recordLeadBehavior(l.id, { contactVerified: true }),
    onSuccess: invalidate});
  const followUpMutation = useMutation({
    mutationFn: (l: LeadRecord) => setLeadFollowUp(l.id, 3),
    onSuccess: invalidate});
  const deleteMutation = useMutation({ mutationFn: (l: LeadRecord) => deleteLead(l.id), onSuccess: invalidate });
  const packetCreateMutation = useMutation({
    mutationFn: (name: string) => createDealPacket(name),
    onSuccess: invalidate});
  const packetItemMutation = useMutation({
    mutationFn: (v: { p: DealPacket; key: string; ready: boolean }) =>
      setPacketItem(v.p.id, v.key, v.ready ? 'ready' : 'pending'),
    onSuccess: invalidate});
  const draftMutation = useMutation({
    mutationFn: () => prepareOutreachDraft({ type: 'investor_intro', recipientCompany: 'Prospect', relatedDeal: 'Casa Rosario' }),
    onSuccess: (d) => setDraft(d)});

  const counts = dash?.counts;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 90 }]}
        refreshControl={<RefreshControl tintColor={Colors.primary} refreshing={dashQuery.isFetching} onRefresh={invalidate} />}
        testID="ivx-power-tools-scroll"
      >
        <View style={styles.heroCard}>
          <View style={styles.heroHeaderRow}>
            <Rocket size={18} color={Colors.primary} />
            <Text style={styles.heroTitle}>Power Tools</Text>
          </View>
          <Text style={styles.heroSubtitle}>
            The execution layer: capture inbound leads, score them by real behavior, move them through the deal CRM pipeline, build the investor packet, and draft owner-approved outreach. Nothing is ever sent automatically and no contact is fabricated.
          </Text>
          <View style={styles.metricGrid}>
            <MetricTile label="Leads" value={counts?.leadsCaptured ?? 0} />
            <MetricTile label="Hot" value={counts?.hotLeads ?? 0} tone={TEMP_TONE.hot} />
            <MetricTile label="Qualified" value={counts?.qualifiedLeads ?? 0} tone={TEMP_TONE.qualified} />
            <MetricTile label="Closed" value={counts?.closedDeals ?? 0} tone={Colors.success} />
          </View>
          <View style={styles.metricGrid}>
            <MetricTile label="Drafts" value={counts?.draftsCreated ?? 0} />
            <MetricTile label="Sent" value={counts?.emailsSent ?? 0} />
            <MetricTile label="Follow-ups" value={counts?.followUpsDue ?? 0} tone={Colors.warning} />
            <MetricTile label="LOIs" value={counts?.loisRequested ?? 0} />
          </View>
          {dash ? <Text style={styles.contextNote}>{dash.note}</Text> : null}
        </View>

        <View style={styles.draftCard}>
          <Pressable
            style={styles.draftButton}
            onPress={() => draftMutation.mutate()}
            disabled={draftMutation.isPending}
            testID="ivx-power-tools-draft"
          >
            <Mail size={15} color={Colors.black} />
            <Text style={styles.draftButtonText}>{draftMutation.isPending ? 'Preparing…' : 'Prepare outreach draft (Gmail-first)'}</Text>
          </Pressable>
          {draft ? (
            <View style={styles.draftPreview}>
              <Text style={styles.draftSubject}>{draft.subject}</Text>
              <Text style={styles.draftBody} numberOfLines={5}>{draft.body}</Text>
              <View style={[styles.blockerPill, { borderColor: draft.blocker ? Colors.warning : Colors.success }]}>
                <ShieldAlert size={12} color={draft.blocker ? Colors.warning : Colors.success} />
                <Text style={[styles.blockerText, { color: draft.blocker ? Colors.warning : Colors.success }]}>
                  {draft.blocker ?? 'Ready for owner approval'}
                </Text>
              </View>
              <Text style={styles.complianceNote}>{draft.note}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.tabRow}>
          <Pressable style={[styles.tab, tab === 'leads' ? styles.tabActive : null]} onPress={() => setTab('leads')}>
            <Text style={[styles.tabText, tab === 'leads' ? styles.tabTextActive : null]}>{`Leads (${leads.length})`}</Text>
          </Pressable>
          <Pressable style={[styles.tab, tab === 'packets' ? styles.tabActive : null]} onPress={() => setTab('packets')}>
            <Text style={[styles.tabText, tab === 'packets' ? styles.tabTextActive : null]}>{`Deal packets (${packets.length})`}</Text>
          </Pressable>
        </View>

        {tab === 'leads' ? (
          <>
            <Pressable style={styles.addRow} onPress={() => setCaptureOpen(true)} testID="ivx-power-tools-add-lead">
              <Plus size={16} color={Colors.primary} />
              <Text style={styles.addRowText}>Capture a lead</Text>
            </Pressable>
            {leadsQuery.isLoading ? (
              <View style={styles.card}><ShimmerIndicator size="small" color={Colors.primary} /></View>
            ) : leads.length === 0 ? (
              <View style={styles.emptyCard}>
                <Rocket size={26} color={Colors.textTertiary} />
                <Text style={styles.emptyTitle}>No leads yet</Text>
                <Text style={styles.emptyBody}>Capture an inbound lead — IVX scores it by behavior and drops it into the pipeline.</Text>
              </View>
            ) : (
              leads.map((lead) => (
                <LeadCard
                  key={lead.id}
                  lead={lead}
                  onAdvance={(l) => advanceMutation.mutate(l)}
                  onVerify={(l) => verifyMutation.mutate(l)}
                  onFollowUp={(l) => followUpMutation.mutate(l)}
                  onDelete={(l) => deleteMutation.mutate(l)}
                />
              ))
            )}
          </>
        ) : (
          <>
            <Pressable
              style={styles.addRow}
              onPress={() => packetCreateMutation.mutate('Casa Rosario')}
              testID="ivx-power-tools-add-packet"
            >
              <Plus size={16} color={Colors.primary} />
              <Text style={styles.addRowText}>Start a deal packet</Text>
            </Pressable>
            {packetsQuery.isLoading ? (
              <View style={styles.card}><ShimmerIndicator size="small" color={Colors.primary} /></View>
            ) : packets.length === 0 ? (
              <View style={styles.emptyCard}>
                <FileText size={26} color={Colors.textTertiary} />
                <Text style={styles.emptyTitle}>No deal packets yet</Text>
                <Text style={styles.emptyBody}>Build the required investor/buyer packet checklist before outreach progresses.</Text>
              </View>
            ) : (
              packets.map((p) => (
                <PacketCard key={p.id} packet={p} onToggle={(pp, key, ready) => packetItemMutation.mutate({ p: pp, key, ready })} />
              ))
            )}
          </>
        )}
      </ScrollView>

      <CaptureModal
        visible={captureOpen}
        onClose={() => setCaptureOpen(false)}
        onSubmit={(input) => captureMutation.mutate(input)}
        submitting={captureMutation.isPending}
        error={captureMutation.error instanceof Error ? captureMutation.error.message : null}
      />
    </View>
  );
}

function CaptureModal({
  visible,
  onClose,
  onSubmit,
  submitting,
  error}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (input: CaptureLeadInput) => void;
  submitting: boolean;
  error: string | null;
}) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [role, setRole] = useState<LeadRole>('buyer');
  const [budget, setBudget] = useState<string>('');
  const [market, setMarket] = useState<string>('');
  const [consent, setConsent] = useState<boolean>(true);

  const submit = () => {
    onSubmit({
      name,
      email,
      phone,
      role,
      budgetRange: budget,
      preferredMarket: market,
      consent,
      source: 'owner_entered',
      sourceDetail: 'power-tools owner capture'});
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Capture a lead</Text>
            <Pressable onPress={onClose}><X size={22} color={Colors.textSecondary} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody}>
            <TextInput style={styles.input} placeholder="Name *" placeholderTextColor={Colors.textTertiary} value={name} onChangeText={setName} />
            <TextInput style={styles.input} placeholder="Email" placeholderTextColor={Colors.textTertiary} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
            <TextInput style={styles.input} placeholder="Phone (optional)" placeholderTextColor={Colors.textTertiary} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
            <View style={styles.roleRow}>
              {ROLES.map((r) => (
                <Pressable key={r} style={[styles.roleChip, role === r ? styles.roleChipActive : null]} onPress={() => setRole(r)}>
                  <Text style={[styles.roleChipText, role === r ? styles.roleChipTextActive : null]}>{r}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput style={styles.input} placeholder="Budget / capital range" placeholderTextColor={Colors.textTertiary} value={budget} onChangeText={setBudget} />
            <TextInput style={styles.input} placeholder="Preferred market" placeholderTextColor={Colors.textTertiary} value={market} onChangeText={setMarket} />
            <View style={styles.consentRow}>
              <Text style={styles.consentText}>Consent to be contacted</Text>
              <Switch value={consent} onValueChange={setConsent} />
            </View>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <Pressable style={[styles.submitBtn, (!name.trim() || submitting) ? styles.submitBtnDisabled : null]} onPress={submit} disabled={!name.trim() || submitting} testID="ivx-power-tools-submit-lead">
              <Text style={styles.submitBtnText}>{submitting ? 'Saving…' : 'Save lead'}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export default function PowerToolsScreen() {
  return (
    <ErrorBoundary>
      <Stack.Screen options={{ title: 'Power Tools' }} />
      <PowerToolsContent />
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
  draftCard: { backgroundColor: Colors.card, borderRadius: 16, padding: 15, gap: 12, borderWidth: 1, borderColor: Colors.border },
  draftButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 12 },
  draftButtonText: { fontSize: 13.5, fontWeight: '700' as const, color: Colors.black },
  draftPreview: { gap: 8, borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 12 },
  draftSubject: { fontSize: 13.5, fontWeight: '700' as const, color: Colors.text },
  draftBody: { fontSize: 12, lineHeight: 17, color: Colors.textSecondary },
  blockerPill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16, borderWidth: 1.5 },
  blockerText: { fontSize: 11, fontWeight: '700' as const },
  complianceNote: { fontSize: 11, lineHeight: 16, color: Colors.textTertiary },
  tabRow: { flexDirection: 'row', gap: 8 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card, alignItems: 'center' },
  tabActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabText: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary },
  tabTextActive: { color: Colors.black },
  addRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, borderStyle: 'dashed', backgroundColor: Colors.card },
  addRowText: { fontSize: 13.5, fontWeight: '600' as const, color: Colors.primary },
  card: { backgroundColor: Colors.card, borderRadius: 16, padding: 15, gap: 10, borderWidth: 1, borderColor: Colors.border },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  scoreCircle: { width: 42, height: 42, borderRadius: 21, backgroundColor: Colors.surfaceLight, alignItems: 'center', justifyContent: 'center' },
  scoreCircleText: { fontSize: 15, fontWeight: '800' as const },
  cardTitleBlock: { flex: 1, gap: 1 },
  cardName: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  cardCompany: { fontSize: 12, color: Colors.textSecondary },
  tempPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 16, borderWidth: 1.5 },
  tempPillText: { fontSize: 10.5, fontWeight: '700' as const, textTransform: 'uppercase' },
  stageRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stagePill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 16, backgroundColor: Colors.surfaceLight },
  stagePillText: { fontSize: 12, fontWeight: '700' as const, color: Colors.primary },
  followUpText: { fontSize: 11.5, color: Colors.warning, fontWeight: '600' as const },
  detailBlock: { gap: 6, borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 10 },
  detailRow: { fontSize: 12, color: Colors.textSecondary },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  actionBtnText: { fontSize: 12, fontWeight: '600' as const, color: Colors.text },
  barTrack: { height: 7, borderRadius: 4, backgroundColor: Colors.surfaceLight, overflow: 'hidden' },
  barFill: { height: 7, borderRadius: 4 },
  packetItemRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 5 },
  packetItemText: { fontSize: 12.5, color: Colors.text, flex: 1 },
  packetItemDone: { color: Colors.textTertiary, textDecorationLine: 'line-through' },
  emptyCard: { backgroundColor: Colors.card, borderRadius: 16, padding: 26, gap: 8, alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  emptyTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  emptyBody: { fontSize: 12.5, lineHeight: 18, color: Colors.textSecondary, textAlign: 'center' },
  errorText: { fontSize: 12.5, color: Colors.error, lineHeight: 18 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: Colors.background, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 18, paddingTop: 16, maxHeight: '88%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  modalTitle: { fontSize: 17, fontWeight: '700' as const, color: Colors.text },
  modalBody: { gap: 12, paddingBottom: 8 },
  input: { backgroundColor: Colors.card, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: Colors.text, borderWidth: 1, borderColor: Colors.border },
  roleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  roleChip: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 18, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card },
  roleChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  roleChipText: { fontSize: 12.5, fontWeight: '600' as const, color: Colors.textSecondary, textTransform: 'capitalize' },
  roleChipTextActive: { color: Colors.black },
  consentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  consentText: { fontSize: 13.5, color: Colors.text, fontWeight: '600' as const },
  submitBtn: { backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { fontSize: 14.5, fontWeight: '700' as const, color: Colors.black }});
