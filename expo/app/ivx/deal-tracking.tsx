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
  Check,
  ClipboardList,
  FileText,
  Handshake,
  Plus,
  Trash2,
  TrendingUp,
  Users,
  X} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  createDeal,
  deleteDeal,
  incrementMilestone,
  listDeals,
  setDealStatus,
  type DealInput,
  type DealMilestoneField,
  type DealSource,
  type DealStatus,
  type DealTrackingListResult,
  type DealTrackingRecord} from '@/src/modules/ivx-developer/dealTrackingService';

const STATUS_ORDER: DealStatus[] = ['open', 'in_progress', 'closed_won', 'closed_lost'];
const STATUS_LABEL: Record<DealStatus, string> = {
  open: 'Open', in_progress: 'In progress', closed_won: 'Closed won', closed_lost: 'Closed lost'};
const STATUS_TONE: Record<DealStatus, string> = {
  open: Colors.info, in_progress: Colors.warning, closed_won: Colors.success, closed_lost: Colors.error};

const SOURCE_OPTIONS: { value: DealSource; label: string }[] = [
  { value: 'owner_entered', label: 'Owner entered' },
  { value: 'submitted_form', label: 'Submitted form' },
  { value: 'crm_import', label: 'CRM import' },
  { value: 'public_source', label: 'Public source' },
  { value: 'verified_deal', label: 'Verified deal' },
];

const MILESTONES: { field: DealMilestoneField; label: string }[] = [
  { field: 'investorsContacted', label: 'Investors contacted' },
  { field: 'investorsResponded', label: 'Investors responded' },
  { field: 'buyersContacted', label: 'Buyers contacted' },
  { field: 'meetingsScheduled', label: 'Meetings' },
  { field: 'documentsShared', label: 'Docs shared' },
  { field: 'offersReceived', label: 'Offers' },
];

function money(value: number | null): string {
  if (value === null) return '—';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${value.toLocaleString('en-US')}`;
}

type FormState = {
  dealName: string;
  counterparty: string;
  capitalTarget: string;
  capitalCommitted: string;
  status: DealStatus;
  source: DealSource;
  sourceDetail: string;
  notes: string;
};

function emptyForm(): FormState {
  return { dealName: '', counterparty: '', capitalTarget: '', capitalCommitted: '', status: 'open', source: 'owner_entered', sourceDetail: '', notes: '' };
}

function Field({ label, value, onChangeText, placeholder, keyboardType, multiline }: {
  label: string; value: string; onChangeText: (t: string) => void; placeholder?: string;
  keyboardType?: 'default' | 'numeric'; multiline?: boolean;
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
        keyboardType={keyboardType ?? 'default'}
        multiline={multiline}
      />
    </View>
  );
}

function OptionRow<T extends string>({ label, options, value, onChange }: {
  label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.optionWrap}>
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <Pressable key={opt.value} style={[styles.optionChip, active ? styles.optionChipActive : null]} onPress={() => onChange(opt.value)}>
              <Text style={[styles.optionChipText, active ? styles.optionChipTextActive : null]}>{opt.label}</Text>
            </Pressable>
          );
        })}
      </View>
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

function DealCard({ deal, onCycleStatus, onMilestone, onDelete, busy }: {
  deal: DealTrackingRecord;
  onCycleStatus: (d: DealTrackingRecord) => void;
  onMilestone: (d: DealTrackingRecord, field: DealMilestoneField) => void;
  onDelete: (d: DealTrackingRecord) => void;
  busy: boolean;
}) {
  const responseRate = deal.investorsContacted > 0
    ? Math.round((deal.investorsResponded / deal.investorsContacted) * 100)
    : null;
  return (
    <View style={styles.card} testID={`ivx-deal-track-${deal.id}`}>
      <View style={styles.cardTopRow}>
        <View style={styles.cardTitleBlock}>
          <Text style={styles.cardName} numberOfLines={1}>{deal.dealName}</Text>
          {deal.counterparty ? <Text style={styles.cardCompany} numberOfLines={1}>{deal.counterparty}</Text> : null}
        </View>
        <Pressable
          style={[styles.statusPill, { borderColor: STATUS_TONE[deal.status] }]}
          onPress={() => onCycleStatus(deal)}
          disabled={busy}
          testID={`ivx-deal-track-status-${deal.id}`}
        >
          <Text style={[styles.statusPillText, { color: STATUS_TONE[deal.status] }]}>{STATUS_LABEL[deal.status]}</Text>
        </Pressable>
      </View>

      <View style={styles.moneyRow}>
        <View style={styles.moneyCell}><Text style={styles.moneyValue}>{money(deal.capitalTarget)}</Text><Text style={styles.moneyLabel}>Target</Text></View>
        <View style={styles.moneyCell}><Text style={[styles.moneyValue, { color: Colors.success }]}>{money(deal.capitalCommitted)}</Text><Text style={styles.moneyLabel}>Committed</Text></View>
        <View style={styles.moneyCell}><Text style={styles.moneyValue}>{responseRate === null ? '—' : `${responseRate}%`}</Text><Text style={styles.moneyLabel}>Response</Text></View>
      </View>

      <View style={styles.milestoneGrid}>
        {MILESTONES.map((m) => (
          <Pressable
            key={m.field}
            style={styles.milestoneChip}
            onPress={() => onMilestone(deal, m.field)}
            disabled={busy}
            testID={`ivx-deal-track-${deal.id}-${m.field}`}
          >
            <Text style={styles.milestoneCount}>{deal[m.field]}</Text>
            <Text style={styles.milestoneLabel}>{m.label}</Text>
            <View style={styles.milestonePlus}><Plus size={10} color={Colors.primary} /></View>
          </Pressable>
        ))}
      </View>

      <View style={styles.cardActions}>
        <Pressable style={styles.deleteBtn} onPress={() => onDelete(deal)} disabled={busy} testID={`ivx-deal-track-delete-${deal.id}`}>
          <Trash2 size={14} color={Colors.error} />
        </Pressable>
      </View>
    </View>
  );
}

function DealTrackingContent() {
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<DealStatus | 'all'>('all');
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState<boolean>(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery<DealTrackingListResult>({
    queryKey: ['ivx-deal-tracking', 'list'],
    queryFn: listDeals});

  const deals = useMemo(() => query.data?.deals ?? [], [query.data]);
  const metrics = query.data?.metrics ?? null;

  const filtered = useMemo(
    () => (filter === 'all' ? deals : deals.filter((d) => d.status === filter)),
    [deals, filter],
  );

  const set = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const openCreate = useCallback(() => {
    setForm(emptyForm());
    setError(null);
    setModalOpen(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!form.dealName.trim()) {
      setError('Deal name is required — IVX never fabricates a deal record.');
      return;
    }
    if ((form.source === 'public_source' || form.source === 'crm_import') && !form.sourceDetail.trim()) {
      setError('Source attribution is required for public source and CRM import records.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const input: DealInput = {
        dealName: form.dealName.trim(),
        source: form.source,
        sourceDetail: form.sourceDetail.trim(),
        counterparty: form.counterparty.trim(),
        status: form.status,
        capitalTarget: form.capitalTarget.trim() ? Number(form.capitalTarget.replace(/[$,\s]/g, '')) : null,
        capitalCommitted: form.capitalCommitted.trim() ? Number(form.capitalCommitted.replace(/[$,\s]/g, '')) : null,
        notes: form.notes.trim()};
      await createDeal(input);
      setModalOpen(false);
      await query.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the deal.');
    } finally {
      setSaving(false);
    }
  }, [form, query]);

  const handleCycleStatus = useCallback(async (deal: DealTrackingRecord) => {
    const idx = STATUS_ORDER.indexOf(deal.status);
    const next = STATUS_ORDER[(idx + 1) % STATUS_ORDER.length]!;
    setBusyId(deal.id);
    try {
      await setDealStatus(deal.id, next);
      await query.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update status.');
    } finally {
      setBusyId(null);
    }
  }, [query]);

  const handleMilestone = useCallback(async (deal: DealTrackingRecord, field: DealMilestoneField) => {
    setBusyId(deal.id);
    try {
      await incrementMilestone(deal.id, field, 1);
      await query.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record milestone.');
    } finally {
      setBusyId(null);
    }
  }, [query]);

  const handleDelete = useCallback(async (deal: DealTrackingRecord) => {
    setBusyId(deal.id);
    try {
      await deleteDeal(deal.id);
      await query.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the deal.');
    } finally {
      setBusyId(null);
    }
  }, [query]);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 96 }]}
        refreshControl={<RefreshControl tintColor={Colors.primary} refreshing={query.isFetching} onRefresh={() => { void query.refetch(); }} />}
        testID="ivx-deal-tracking-scroll"
      >
        <View style={styles.heroCard}>
          <View style={styles.heroHeaderRow}>
            <ClipboardList size={18} color={Colors.primary} />
            <Text style={styles.heroTitle}>Deal Tracking</Text>
          </View>
          <Text style={styles.heroSubtitle}>
            Track every real deal end-to-end — created, investor/buyer contacted, meetings, docs shared, offers received, capital committed, closed — and watch the outcome metrics update live. Every number is recorded from real activity; metrics are computed, never invented.
          </Text>
          <View style={styles.metricGrid}>
            <MetricTile label="Deals" value={metrics?.total ?? deals.length} />
            <MetricTile label="Won" value={metrics?.byStatus.closed_won ?? 0} tone={Colors.success} />
            <MetricTile label="Convert" value={metrics ? `${metrics.conversionRate}%` : '—'} tone={Colors.primary} />
            <MetricTile label="Raised" value={money(metrics?.capitalRaised ?? 0)} tone={Colors.success} />
          </View>
          <View style={styles.metricGrid}>
            <MetricTile label="Avg size" value={money(metrics?.averageDealSize ?? 0)} />
            <MetricTile label="Resp. rate" value={metrics?.investorResponseRate === null || metrics?.investorResponseRate === undefined ? '—' : `${metrics.investorResponseRate}%`} />
            <MetricTile label="To close" value={metrics?.avgTimeToCloseDays === null || metrics?.avgTimeToCloseDays === undefined ? '—' : `${metrics.avgTimeToCloseDays}d`} />
            <MetricTile label="Offers" value={metrics?.totalOffers ?? 0} />
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          <Pressable style={[styles.filterChip, filter === 'all' ? styles.filterChipActive : null]} onPress={() => setFilter('all')} testID="ivx-deal-track-filter-all">
            <Text style={[styles.filterChipText, filter === 'all' ? styles.filterChipTextActive : null]}>{`All (${deals.length})`}</Text>
          </Pressable>
          {STATUS_ORDER.map((s) => (
            <Pressable key={s} style={[styles.filterChip, filter === s ? styles.filterChipActive : null]} onPress={() => setFilter(s)} testID={`ivx-deal-track-filter-${s}`}>
              <Text style={[styles.filterChipText, filter === s ? styles.filterChipTextActive : null]}>
                {`${STATUS_LABEL[s]} (${metrics?.byStatus[s] ?? deals.filter((d) => d.status === s).length})`}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {error && !modalOpen ? <Text style={styles.errorText}>{error}</Text> : null}

        {query.isLoading ? (
          <View style={styles.card}><ShimmerIndicator size="small" color={Colors.primary} /></View>
        ) : filtered.length === 0 ? (
          <View style={styles.emptyCard}>
            <ClipboardList size={26} color={Colors.textTertiary} />
            <Text style={styles.emptyTitle}>{deals.length === 0 ? 'No deals tracked yet' : 'None in this stage'}</Text>
            <Text style={styles.emptyBody}>
              {deals.length === 0
                ? 'Add a real deal — then tap milestones as you contact investors, hold meetings, share docs, and close.'
                : 'Switch status to see deals in another stage.'}
            </Text>
          </View>
        ) : (
          filtered.map((deal) => (
            <DealCard
              key={deal.id}
              deal={deal}
              onCycleStatus={handleCycleStatus}
              onMilestone={handleMilestone}
              onDelete={handleDelete}
              busy={busyId === deal.id}
            />
          ))
        )}
      </ScrollView>

      <Pressable style={[styles.fab, { bottom: insets.bottom + 20 }]} onPress={openCreate} testID="ivx-deal-track-add">
        <Plus size={22} color={Colors.black} />
      </Pressable>

      <Modal visible={modalOpen} animationType="slide" transparent onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New deal</Text>
              <Pressable style={styles.modalClose} onPress={() => setModalOpen(false)} testID="ivx-deal-track-modal-close">
                <X size={20} color={Colors.text} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
              <Field label="Deal name *" value={form.dealName} onChangeText={(t) => set('dealName', t)} placeholder="Casa Rosario" />
              <Field label="Counterparty" value={form.counterparty} onChangeText={(t) => set('counterparty', t)} placeholder="Developer / seller" />
              <View style={styles.dualRow}>
                <View style={styles.dualItem}><Field label="Capital target" value={form.capitalTarget} onChangeText={(t) => set('capitalTarget', t)} placeholder="$1,000,000" keyboardType="numeric" /></View>
                <View style={styles.dualItem}><Field label="Committed" value={form.capitalCommitted} onChangeText={(t) => set('capitalCommitted', t)} placeholder="$0" keyboardType="numeric" /></View>
              </View>
              <OptionRow label="Status" options={STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} value={form.status} onChange={(v) => set('status', v)} />
              <OptionRow label="Source *" options={SOURCE_OPTIONS} value={form.source} onChange={(v) => set('source', v)} />
              <Field
                label={form.source === 'public_source' || form.source === 'crm_import' ? 'Source attribution * (required)' : 'Source attribution'}
                value={form.sourceDetail}
                onChangeText={(t) => set('sourceDetail', t)}
                placeholder="Who entered / which import / public URL"
              />
              <Field label="Notes" value={form.notes} onChangeText={(t) => set('notes', t)} placeholder="Context, history" multiline />
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
            </ScrollView>
            <Pressable style={[styles.saveBtn, saving ? styles.btnDisabled : null]} onPress={() => { void handleSave(); }} disabled={saving} testID="ivx-deal-track-save">
              {saving ? <ShimmerIndicator size="small" color={Colors.black} /> : <Check size={16} color={Colors.black} />}
              <Text style={styles.saveBtnText}>Add deal</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

export default function DealTrackingScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  return (
    <ErrorBoundary>
      <Stack.Screen options={{ title: 'Deal Tracking' }} />
      <DealTrackingContent />
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
  metricValue: { fontSize: 16, fontWeight: '800' as const, color: Colors.text },
  metricLabel: { fontSize: 9.5, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3 },
  filterRow: { gap: 8, paddingVertical: 2, paddingRight: 8 },
  filterChip: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card },
  filterChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterChipText: { fontSize: 12.5, fontWeight: '600' as const, color: Colors.textSecondary },
  filterChipTextActive: { color: Colors.black },
  errorText: { fontSize: 12.5, color: Colors.error, lineHeight: 18 },
  card: { backgroundColor: Colors.card, borderRadius: 16, padding: 15, gap: 12, borderWidth: 1, borderColor: Colors.border },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  cardTitleBlock: { flex: 1, gap: 1 },
  cardName: { fontSize: 15.5, fontWeight: '700' as const, color: Colors.text },
  cardCompany: { fontSize: 12.5, color: Colors.textSecondary },
  statusPill: { paddingHorizontal: 11, paddingVertical: 5, borderRadius: 20, borderWidth: 1.5 },
  statusPillText: { fontSize: 11, fontWeight: '700' as const },
  moneyRow: { flexDirection: 'row', gap: 8 },
  moneyCell: { flex: 1, backgroundColor: Colors.surface, borderRadius: 10, paddingVertical: 10, alignItems: 'center', gap: 2, borderWidth: 1, borderColor: Colors.border },
  moneyValue: { fontSize: 15, fontWeight: '800' as const, color: Colors.text },
  moneyLabel: { fontSize: 10, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3 },
  milestoneGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  milestoneChip: { width: '31.5%', backgroundColor: Colors.surface, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 8, gap: 1, borderWidth: 1, borderColor: Colors.border },
  milestoneCount: { fontSize: 17, fontWeight: '800' as const, color: Colors.text },
  milestoneLabel: { fontSize: 9.5, color: Colors.textTertiary },
  milestonePlus: { position: 'absolute', top: 7, right: 7, width: 16, height: 16, borderRadius: 8, backgroundColor: Colors.surfaceLight, alignItems: 'center', justifyContent: 'center' },
  cardActions: { flexDirection: 'row', justifyContent: 'flex-end' },
  deleteBtn: { width: 42, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: Colors.border },
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
  inputMultiline: { minHeight: 70, textAlignVertical: 'top' },
  optionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  optionChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card },
  optionChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  optionChipText: { fontSize: 12.5, fontWeight: '600' as const, color: Colors.textSecondary },
  optionChipTextActive: { color: Colors.black },
  dualRow: { flexDirection: 'row', gap: 10 },
  dualItem: { flex: 1 },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, marginHorizontal: 18, marginTop: 8, paddingVertical: 14, borderRadius: 12 },
  saveBtnText: { fontSize: 15, fontWeight: '700' as const, color: Colors.black },
  btnDisabled: { opacity: 0.6 }});
