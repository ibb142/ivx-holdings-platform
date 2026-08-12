import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { Stack } from 'expo-router';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View} from "react-native";
import {
  CheckCircle2,
  Megaphone,
  MousePointerClick,
  Plus,
  Reply,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  X} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  approveOutreachMessage,
  createOutreachMessage,
  deleteOutreachMessage,
  listOutreachMessages,
  previewOutreachDraft,
  recordOutreachEngagement,
  sendOutreachMessage,
  submitOutreachForApproval,
  OUTREACH_TYPES,
  OUTREACH_TYPE_LABEL,
  type OutreachCreateInput,
  type OutreachListResult,
  type OutreachMessage,
  type OutreachStatus,
  type OutreachType} from '@/src/modules/ivx-developer/outreachService';

const STATUS_LABEL: Record<OutreachStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Pending approval',
  approved: 'Approved',
  sent: 'Sent',
  replied: 'Replied'};
const STATUS_TONE: Record<OutreachStatus, string> = {
  draft: Colors.textTertiary,
  pending_approval: Colors.warning,
  approved: Colors.info,
  sent: Colors.primary,
  replied: Colors.success};

const TYPE_OPTIONS: { value: OutreachType; label: string }[] = OUTREACH_TYPES.map((t) => ({
  value: t,
  label: OUTREACH_TYPE_LABEL[t]}));

const FILTERS: { value: OutreachStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Drafts' },
  { value: 'pending_approval', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'sent', label: 'Sent' },
  { value: 'replied', label: 'Replied' },
];

type FormState = {
  type: OutreachType;
  recipientName: string;
  recipientCompany: string;
  recipientContact: string;
  relatedDeal: string;
  contextNote: string;
  senderName: string;
  subject: string;
  body: string;
};

function emptyForm(): FormState {
  return {
    type: 'investor_intro', recipientName: '', recipientCompany: '', recipientContact: '',
    relatedDeal: '', contextNote: '', senderName: '', subject: '', body: ''};
}

function formToInput(form: FormState): OutreachCreateInput {
  return {
    type: form.type,
    recipientName: form.recipientName.trim(),
    recipientCompany: form.recipientCompany.trim(),
    recipientContact: form.recipientContact.trim(),
    relatedDeal: form.relatedDeal.trim(),
    contextNote: form.contextNote.trim(),
    senderName: form.senderName.trim(),
    subject: form.subject.trim(),
    body: form.body.trim()};
}

function Field({ label, value, onChangeText, placeholder, multiline }: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, multiline ? styles.inputMultiline : null]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.inputPlaceholder}
        multiline={multiline}
      />
    </View>
  );
}

function MetricTile({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <View style={styles.metricTile}>
      <Text style={[styles.metricValue, tone ? { color: tone } : null]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function MessageCard({ message, onSubmit, onApprove, onSend, onEngage, onDelete, busy }: {
  message: OutreachMessage;
  onSubmit: (m: OutreachMessage) => void;
  onApprove: (m: OutreachMessage) => void;
  onSend: (m: OutreachMessage) => void;
  onEngage: (m: OutreachMessage, patch: { opened?: boolean; clicked?: boolean; replied?: boolean; meetingBooked?: boolean }) => void;
  onDelete: (m: OutreachMessage) => void;
  busy: boolean;
}) {
  const [expanded, setExpanded] = useState<boolean>(false);
  const recipient = message.recipientName || message.recipientCompany || 'Unspecified recipient';
  return (
    <View style={styles.card} testID={`ivx-outreach-${message.id}`}>
      <View style={styles.cardTopRow}>
        <View style={styles.cardTitleBlock}>
          <Text style={styles.cardType}>{OUTREACH_TYPE_LABEL[message.type]}</Text>
          <Text style={styles.cardName} numberOfLines={1}>{recipient}</Text>
        </View>
        <View style={[styles.statusPill, { borderColor: STATUS_TONE[message.status] }]}>
          <Text style={[styles.statusPillText, { color: STATUS_TONE[message.status] }]}>{STATUS_LABEL[message.status]}</Text>
        </View>
      </View>

      <Pressable onPress={() => setExpanded((v) => !v)} testID={`ivx-outreach-expand-${message.id}`}>
        <Text style={styles.cardSubject} numberOfLines={expanded ? undefined : 1}>{message.subject}</Text>
        <Text style={styles.cardBody} numberOfLines={expanded ? undefined : 2}>{message.body}</Text>
      </Pressable>

      <View style={styles.draftBadgeRow}>
        {message.aiDrafted ? (
          <View style={styles.aiBadge}><Sparkles size={11} color={Colors.primary} /><Text style={styles.aiBadgeText}>IVX drafted</Text></View>
        ) : (
          <View style={styles.aiBadge}><Text style={styles.aiBadgeText}>Owner written</Text></View>
        )}
        {message.relatedDeal ? <Text style={styles.dealChip}>{message.relatedDeal}</Text> : null}
      </View>

      {(message.status === 'sent' || message.status === 'replied') ? (
        <View style={styles.engageRow}>
          {([
            { key: 'opened' as const, label: 'Opened', Icon: CheckCircle2, on: message.engagement.opened },
            { key: 'clicked' as const, label: 'Clicked', Icon: MousePointerClick, on: message.engagement.clicked },
            { key: 'replied' as const, label: 'Replied', Icon: Reply, on: message.engagement.replied },
            { key: 'meetingBooked' as const, label: 'Meeting', Icon: ShieldCheck, on: message.engagement.meetingBooked },
          ]).map(({ key, label, Icon, on }) => (
            <Pressable
              key={key}
              style={[styles.engageChip, on ? styles.engageChipOn : null]}
              onPress={() => onEngage(message, { [key]: !on })}
              disabled={busy}
              testID={`ivx-outreach-engage-${key}-${message.id}`}
            >
              <Icon size={12} color={on ? Colors.success : Colors.textTertiary} />
              <Text style={[styles.engageChipText, on ? styles.engageChipTextOn : null]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.cardActions}>
        {message.status === 'draft' ? (
          <Pressable style={styles.actionBtn} onPress={() => onSubmit(message)} disabled={busy} testID={`ivx-outreach-submit-${message.id}`}>
            <Text style={styles.actionBtnText}>Queue for approval</Text>
          </Pressable>
        ) : null}
        {(message.status === 'draft' || message.status === 'pending_approval') ? (
          <Pressable style={[styles.actionBtn, styles.approveBtn]} onPress={() => onApprove(message)} disabled={busy} testID={`ivx-outreach-approve-${message.id}`}>
            <CheckCircle2 size={13} color={Colors.black} />
            <Text style={styles.approveBtnText}>Approve</Text>
          </Pressable>
        ) : null}
        {message.status === 'approved' ? (
          <Pressable style={[styles.actionBtn, styles.sendBtn]} onPress={() => onSend(message)} disabled={busy} testID={`ivx-outreach-send-${message.id}`}>
            <Send size={13} color={Colors.black} />
            <Text style={styles.approveBtnText}>Mark sent</Text>
          </Pressable>
        ) : null}
        <Pressable style={styles.deleteBtn} onPress={() => onDelete(message)} disabled={busy} testID={`ivx-outreach-delete-${message.id}`}>
          <Trash2 size={14} color={Colors.error} />
        </Pressable>
      </View>
    </View>
  );
}

function OutreachContent() {
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<OutreachStatus | 'all'>('all');
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState<boolean>(false);
  const [previewing, setPreviewing] = useState<boolean>(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery<OutreachListResult>({
    queryKey: ['ivx-outreach', 'list'],
    queryFn: listOutreachMessages});

  const messages = useMemo(() => query.data?.messages ?? [], [query.data]);
  const summary = query.data?.summary ?? null;
  const filtered = useMemo(
    () => (filter === 'all' ? messages : messages.filter((m) => m.status === filter)),
    [messages, filter],
  );

  const set = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const openCreate = useCallback(() => {
    setForm(emptyForm());
    setError(null);
    setModalOpen(true);
  }, []);

  const handlePreview = useCallback(async () => {
    setPreviewing(true);
    setError(null);
    try {
      const draft = await previewOutreachDraft(formToInput(form));
      if (draft) {
        setForm((prev) => ({ ...prev, subject: draft.subject, body: draft.body }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate a draft.');
    } finally {
      setPreviewing(false);
    }
  }, [form]);

  const handleSave = useCallback(async () => {
    if (!form.recipientName.trim() && !form.recipientCompany.trim()) {
      setError('A recipient name or company is required — IVX never invents recipients.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createOutreachMessage(formToInput(form));
      setModalOpen(false);
      await query.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the message.');
    } finally {
      setSaving(false);
    }
  }, [form, query]);

  const run = useCallback(async (id: string, fn: () => Promise<unknown>) => {
    setBusyId(id);
    try {
      await fn();
      await query.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusyId(null);
    }
  }, [query]);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 96 }]}
        refreshControl={<RefreshControl tintColor={Colors.primary} refreshing={query.isFetching} onRefresh={() => { void query.refetch(); }} />}
        testID="ivx-outreach-scroll"
      >
        <View style={styles.heroCard}>
          <View style={styles.heroHeaderRow}>
            <Megaphone size={18} color={Colors.primary} />
            <Text style={styles.heroTitle}>Automated Outreach</Text>
          </View>
          <Text style={styles.heroSubtitle}>
            IVX drafts every message automatically — you approve before anything is marked sent. Nothing leaves without your sign-off. Engagement is recorded by you (no email-provider tracking is connected yet).
          </Text>
          <View style={styles.metricGrid}>
            <MetricTile label="Drafts" value={summary?.drafts ?? 0} />
            <MetricTile label="Pending" value={summary?.pendingApproval ?? 0} tone={Colors.warning} />
            <MetricTile label="Sent" value={summary?.sent ?? 0} tone={Colors.primary} />
            <MetricTile label="Replied" value={summary?.replied ?? 0} tone={Colors.success} />
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {FILTERS.map((f) => (
            <Pressable
              key={f.value}
              style={[styles.filterChip, filter === f.value ? styles.filterChipActive : null]}
              onPress={() => setFilter(f.value)}
              testID={`ivx-outreach-filter-${f.value}`}
            >
              <Text style={[styles.filterChipText, filter === f.value ? styles.filterChipTextActive : null]}>{f.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {error && !modalOpen ? <Text style={styles.errorText}>{error}</Text> : null}

        {query.isLoading ? (
          <View style={styles.card}><ShimmerIndicator size="small" color={Colors.primary} /></View>
        ) : filtered.length === 0 ? (
          <View style={styles.emptyCard}>
            <Megaphone size={26} color={Colors.textTertiary} />
            <Text style={styles.emptyTitle}>{messages.length === 0 ? 'No outreach yet' : 'None in this view'}</Text>
            <Text style={styles.emptyBody}>
              {messages.length === 0
                ? 'Create a message — IVX drafts the subject and body for you, then waits for your approval before it can be sent.'
                : 'Switch filters to see drafts, approvals, and sent messages.'}
            </Text>
          </View>
        ) : (
          filtered.map((message) => (
            <MessageCard
              key={message.id}
              message={message}
              busy={busyId === message.id}
              onSubmit={(m) => { void run(m.id, () => submitOutreachForApproval(m.id)); }}
              onApprove={(m) => { void run(m.id, () => approveOutreachMessage(m.id)); }}
              onSend={(m) => { void run(m.id, () => sendOutreachMessage(m.id)); }}
              onEngage={(m, patch) => { void run(m.id, () => recordOutreachEngagement(m.id, patch)); }}
              onDelete={(m) => { void run(m.id, () => deleteOutreachMessage(m.id)); }}
            />
          ))
        )}
      </ScrollView>

      <Pressable style={[styles.fab, { bottom: insets.bottom + 20 }]} onPress={openCreate} testID="ivx-outreach-add">
        <Plus size={22} color={Colors.black} />
      </Pressable>

      <Modal visible={modalOpen} animationType="slide" transparent onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New outreach</Text>
              <Pressable style={styles.modalClose} onPress={() => setModalOpen(false)} testID="ivx-outreach-modal-close">
                <X size={20} color={Colors.text} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Type</Text>
                <View style={styles.optionWrap}>
                  {TYPE_OPTIONS.map((opt) => {
                    const active = opt.value === form.type;
                    return (
                      <Pressable
                        key={opt.value}
                        style={[styles.optionChip, active ? styles.optionChipActive : null]}
                        onPress={() => set('type', opt.value)}
                      >
                        <Text style={[styles.optionChipText, active ? styles.optionChipTextActive : null]}>{opt.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <Field label="Recipient name" value={form.recipientName} onChangeText={(t) => set('recipientName', t)} placeholder="Jane Capital" />
              <Field label="Recipient company" value={form.recipientCompany} onChangeText={(t) => set('recipientCompany', t)} placeholder="Capital Partners" />
              <Field label="Recipient contact" value={form.recipientContact} onChangeText={(t) => set('recipientContact', t)} placeholder="email / phone (optional)" />
              <Field label="Related deal" value={form.relatedDeal} onChangeText={(t) => set('relatedDeal', t)} placeholder="Casa Rosario" />
              <Field label="Context / hook" value={form.contextNote} onChangeText={(t) => set('contextNote', t)} placeholder="What to mention (terms, ask, update)" multiline />
              <Field label="Your sign-off" value={form.senderName} onChangeText={(t) => set('senderName', t)} placeholder="Daniel, IVX Holdings" />

              <Pressable style={[styles.previewBtn, previewing ? styles.btnDisabled : null]} onPress={() => { void handlePreview(); }} disabled={previewing} testID="ivx-outreach-preview">
                {previewing ? <ShimmerIndicator size="small" color={Colors.primary} /> : <Sparkles size={15} color={Colors.primary} />}
                <Text style={styles.previewBtnText}>{previewing ? 'Drafting…' : 'Let IVX draft it'}</Text>
              </Pressable>

              <Field label="Subject" value={form.subject} onChangeText={(t) => set('subject', t)} placeholder="Auto-drafted if left blank" />
              <Field label="Message body" value={form.body} onChangeText={(t) => set('body', t)} placeholder="Auto-drafted if left blank" multiline />
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
            </ScrollView>
            <Pressable style={[styles.saveBtn, saving ? styles.btnDisabled : null]} onPress={() => { void handleSave(); }} disabled={saving} testID="ivx-outreach-save">
              {saving ? <ShimmerIndicator size="small" color={Colors.black} /> : <CheckCircle2 size={16} color={Colors.black} />}
              <Text style={styles.saveBtnText}>Save as draft</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

export default function OutreachScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  return (
    <ErrorBoundary>
      <Stack.Screen options={{ title: 'Outreach' }} />
      <OutreachContent />
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
  filterRow: { gap: 8, paddingVertical: 2, paddingRight: 8 },
  filterChip: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card },
  filterChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterChipText: { fontSize: 12.5, fontWeight: '600' as const, color: Colors.textSecondary },
  filterChipTextActive: { color: Colors.black },
  errorText: { fontSize: 12.5, color: Colors.error, lineHeight: 18 },
  card: { backgroundColor: Colors.card, borderRadius: 16, padding: 15, gap: 10, borderWidth: 1, borderColor: Colors.border },
  cardTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  cardTitleBlock: { flex: 1, gap: 2 },
  cardType: { fontSize: 10.5, fontWeight: '700' as const, color: Colors.primary, textTransform: 'uppercase', letterSpacing: 0.4 },
  cardName: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  statusPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1.5 },
  statusPillText: { fontSize: 10.5, fontWeight: '700' as const },
  cardSubject: { fontSize: 13.5, fontWeight: '600' as const, color: Colors.text, marginBottom: 4 },
  cardBody: { fontSize: 12.5, lineHeight: 18, color: Colors.textSecondary },
  draftBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  aiBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.surfaceLight, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  aiBadgeText: { fontSize: 10.5, fontWeight: '600' as const, color: Colors.textSecondary },
  dealChip: { fontSize: 10.5, color: Colors.text, backgroundColor: Colors.surface, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden' },
  engageRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  engageChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 16, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card },
  engageChipOn: { borderColor: Colors.success, backgroundColor: 'rgba(34,197,94,0.12)' },
  engageChipText: { fontSize: 11, fontWeight: '600' as const, color: Colors.textTertiary },
  engageChipTextOn: { color: Colors.success },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: Colors.border },
  actionBtnText: { fontSize: 12.5, fontWeight: '600' as const, color: Colors.text },
  approveBtn: { backgroundColor: Colors.info, borderColor: Colors.info },
  sendBtn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  approveBtnText: { fontSize: 12.5, fontWeight: '700' as const, color: Colors.black },
  deleteBtn: { width: 40, alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, marginLeft: 'auto' },
  emptyCard: { backgroundColor: Colors.card, borderRadius: 16, padding: 26, gap: 8, alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  emptyTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  emptyBody: { fontSize: 12.5, lineHeight: 18, color: Colors.textSecondary, textAlign: 'center' },
  fab: { position: 'absolute', right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', shadowColor: Colors.black, shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  modalRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: Colors.overlay },
  modalSheet: { backgroundColor: Colors.background, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '92%', borderWidth: 1, borderColor: Colors.border },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: Colors.border },
  modalTitle: { fontSize: 17, fontWeight: '700' as const, color: Colors.text },
  modalClose: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surface },
  modalBody: { padding: 18, gap: 12 },
  field: { gap: 6 },
  fieldLabel: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary },
  input: { backgroundColor: Colors.inputBackground, borderRadius: 10, borderWidth: 1, borderColor: Colors.inputBorder, paddingHorizontal: 13, paddingVertical: 11, fontSize: 14, color: Colors.text },
  inputMultiline: { minHeight: 78, textAlignVertical: 'top' },
  optionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  optionChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card },
  optionChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  optionChipText: { fontSize: 12.5, fontWeight: '600' as const, color: Colors.textSecondary },
  optionChipTextActive: { color: Colors.black },
  previewBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: Colors.primary, backgroundColor: 'rgba(255,215,0,0.08)' },
  previewBtnText: { fontSize: 13.5, fontWeight: '700' as const, color: Colors.primary },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, marginHorizontal: 18, marginTop: 8, paddingVertical: 14, borderRadius: 12 },
  saveBtnText: { fontSize: 15, fontWeight: '700' as const, color: Colors.black },
  btnDisabled: { opacity: 0.6 }});
