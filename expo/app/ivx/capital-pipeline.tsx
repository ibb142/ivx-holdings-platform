import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
  Building2,
  Check,
  ChevronRight,
  GitBranch,
  Target,
  TrendingUp,
  Trash2,
  Wallet,
  X} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  createPipelineEntry,
  deletePipelineEntry,
  listPipelineEntries,
  setPipelineStage,
  updatePipelineEntry,
  PIPELINE_STAGES,
  type PipelineEntry,
  type PipelineInput,
  type PipelineListResult,
  type PipelinePartyType,
  type PipelineSource,
  type PipelineStage} from '@/src/modules/ivx-developer/capitalPipelineService';

const STAGE_LABEL: Record<PipelineStage, string> = {
  lead: 'Lead',
  qualified: 'Qualified',
  contacted: 'Contacted',
  meeting: 'Meeting',
  interested: 'Interested',
  due_diligence: 'Due Diligence',
  soft_commit: 'Soft Commit',
  hard_commit: 'Hard Commit',
  closed: 'Closed'};

const STAGE_TONE: Record<PipelineStage, string> = {
  lead: Colors.textTertiary,
  qualified: Colors.info,
  contacted: Colors.info,
  meeting: Colors.warning,
  interested: Colors.warning,
  due_diligence: Colors.orange,
  soft_commit: Colors.primary,
  hard_commit: Colors.primary,
  closed: Colors.success};

const SOURCE_OPTIONS: { value: PipelineSource; label: string }[] = [
  { value: 'owner_entered', label: 'Owner entered' },
  { value: 'submitted_form', label: 'Submitted form' },
  { value: 'crm_import', label: 'CRM import' },
  { value: 'public_source', label: 'Public source' },
  { value: 'verified_deal', label: 'Verified deal' },
];

const PARTY_OPTIONS: { value: PipelinePartyType; label: string }[] = [
  { value: 'investor', label: 'Investor' },
  { value: 'buyer', label: 'Buyer' },
];

type FormState = {
  name: string;
  company: string;
  partyType: PipelinePartyType;
  dealName: string;
  stage: PipelineStage;
  capitalRequested: string;
  capitalCommitted: string;
  closeProbability: string;
  expectedCloseDate: string;
  notes: string;
  source: PipelineSource;
  sourceDetail: string;
};

function emptyForm(): FormState {
  return {
    name: '', company: '', partyType: 'investor', dealName: '', stage: 'lead',
    capitalRequested: '', capitalCommitted: '', closeProbability: '', expectedCloseDate: '',
    notes: '', source: 'owner_entered', sourceDetail: ''};
}

function formFromEntry(e: PipelineEntry): FormState {
  return {
    name: e.name,
    company: e.company,
    partyType: e.partyType,
    dealName: e.dealName,
    stage: e.stage,
    capitalRequested: e.capitalRequested !== null ? String(e.capitalRequested) : '',
    capitalCommitted: e.capitalCommitted !== null ? String(e.capitalCommitted) : '',
    closeProbability: String(e.closeProbability),
    expectedCloseDate: e.expectedCloseDate ? e.expectedCloseDate.slice(0, 10) : '',
    notes: e.notes,
    source: e.source,
    sourceDetail: e.sourceDetail};
}

function formToInput(form: FormState): PipelineInput {
  return {
    name: form.name.trim(),
    source: form.source,
    sourceDetail: form.sourceDetail.trim(),
    company: form.company.trim(),
    partyType: form.partyType,
    dealName: form.dealName.trim(),
    stage: form.stage,
    capitalRequested: form.capitalRequested.trim() ? Number(form.capitalRequested.replace(/[$,\s]/g, '')) : null,
    capitalCommitted: form.capitalCommitted.trim() ? Number(form.capitalCommitted.replace(/[$,\s]/g, '')) : null,
    closeProbability: form.closeProbability.trim() ? Number(form.closeProbability) : undefined,
    expectedCloseDate: form.expectedCloseDate.trim() || null,
    notes: form.notes.trim()};
}

function formatMoney(value: number | null): string {
  if (value === null) return '—';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}k`;
  return `$${value.toLocaleString()}`;
}

function Field({ label, value, onChangeText, placeholder, keyboardType, multiline }: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric';
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
        keyboardType={keyboardType ?? 'default'}
        multiline={multiline}
      />
    </View>
  );
}

function OptionRow<T extends string>({ label, options, value, onChange }: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.optionWrap}>
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <Pressable
              key={opt.value}
              style={[styles.optionChip, active ? styles.optionChipActive : null]}
              onPress={() => onChange(opt.value)}
            >
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
      <Text style={[styles.metricValue, tone ? { color: tone } : null]} numberOfLines={1}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function nextStage(stage: PipelineStage): PipelineStage {
  const idx = PIPELINE_STAGES.indexOf(stage);
  return PIPELINE_STAGES[(idx + 1) % PIPELINE_STAGES.length]!;
}

function EntryCard({ entry, onEdit, onAdvance, onDelete, busy }: {
  entry: PipelineEntry;
  onEdit: (e: PipelineEntry) => void;
  onAdvance: (e: PipelineEntry) => void;
  onDelete: (e: PipelineEntry) => void;
  busy: boolean;
}) {
  return (
    <View style={styles.card} testID={`ivx-pipeline-${entry.id}`}>
      <View style={styles.cardTopRow}>
        <View style={styles.cardTitleBlock}>
          <Text style={styles.cardName} numberOfLines={1}>{entry.name}</Text>
          <Text style={styles.cardSub} numberOfLines={1}>
            {`${entry.partyType === 'investor' ? 'Investor' : 'Buyer'}${entry.company ? ` · ${entry.company}` : ''}`}
          </Text>
        </View>
        <Pressable
          style={[styles.stagePill, { borderColor: STAGE_TONE[entry.stage] }]}
          onPress={() => onAdvance(entry)}
          disabled={busy}
          testID={`ivx-pipeline-stage-${entry.id}`}
        >
          <Text style={[styles.stagePillText, { color: STAGE_TONE[entry.stage] }]} numberOfLines={1}>{STAGE_LABEL[entry.stage]}</Text>
          <ChevronRight size={12} color={STAGE_TONE[entry.stage]} />
        </Pressable>
      </View>

      {entry.dealName ? (
        <View style={styles.metaRow}><Target size={12} color={Colors.textTertiary} /><Text style={styles.metaText}>{entry.dealName}</Text></View>
      ) : null}

      <View style={styles.moneyRow}>
        <View style={styles.moneyCell}>
          <Text style={styles.moneyLabel}>Requested</Text>
          <Text style={styles.moneyValue}>{formatMoney(entry.capitalRequested)}</Text>
        </View>
        <View style={styles.moneyCell}>
          <Text style={styles.moneyLabel}>Committed</Text>
          <Text style={[styles.moneyValue, { color: Colors.success }]}>{formatMoney(entry.capitalCommitted)}</Text>
        </View>
        <View style={styles.moneyCell}>
          <Text style={styles.moneyLabel}>Gap</Text>
          <Text style={[styles.moneyValue, { color: Colors.warning }]}>{formatMoney(entry.remainingGap)}</Text>
        </View>
        <View style={styles.moneyCell}>
          <Text style={styles.moneyLabel}>Close %</Text>
          <Text style={styles.moneyValue}>{`${entry.closeProbability}%`}</Text>
        </View>
      </View>

      <View style={styles.probTrack}>
        <View style={[styles.probFill, { width: `${entry.closeProbability}%`, backgroundColor: STAGE_TONE[entry.stage] }]} />
      </View>

      <View style={styles.footRow}>
        <Text style={styles.footMeta} numberOfLines={1}>
          {entry.expectedCloseDate ? `Close ~ ${entry.expectedCloseDate.slice(0, 10)}` : 'No close date'}
        </Text>
        <View style={styles.cardActions}>
          <Pressable style={styles.editBtn} onPress={() => onEdit(entry)} disabled={busy} testID={`ivx-pipeline-edit-${entry.id}`}>
            <Text style={styles.editBtnText}>Edit</Text>
          </Pressable>
          <Pressable style={styles.deleteBtn} onPress={() => onDelete(entry)} disabled={busy} testID={`ivx-pipeline-delete-${entry.id}`}>
            <Trash2 size={14} color={Colors.error} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function CapitalPipelineContent() {
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<PipelineStage | 'all'>('all');
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState<boolean>(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery<PipelineListResult>({
    queryKey: ['ivx-capital-pipeline', 'list'],
    queryFn: listPipelineEntries});

  const entries = useMemo(() => query.data?.entries ?? [], [query.data]);
  const summary = query.data?.summary ?? null;

  const filtered = useMemo(
    () => (filter === 'all' ? entries : entries.filter((e) => e.stage === filter)),
    [entries, filter],
  );

  const set = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const openCreate = useCallback(() => {
    setEditingId(null);
    setForm(emptyForm());
    setError(null);
    setModalOpen(true);
  }, []);

  const openEdit = useCallback((entry: PipelineEntry) => {
    setEditingId(entry.id);
    setForm(formFromEntry(entry));
    setError(null);
    setModalOpen(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!form.name.trim()) {
      setError('Name is required — IVX never fabricates a capital record.');
      return;
    }
    if ((form.source === 'public_source' || form.source === 'crm_import') && !form.sourceDetail.trim()) {
      setError('Source attribution is required for public source and CRM import records.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const input = formToInput(form);
      if (editingId) {
        await updatePipelineEntry(editingId, input);
      } else {
        await createPipelineEntry(input);
      }
      setModalOpen(false);
      await query.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the entry.');
    } finally {
      setSaving(false);
    }
  }, [form, editingId, query]);

  const handleAdvance = useCallback(async (entry: PipelineEntry) => {
    setBusyId(entry.id);
    try {
      await setPipelineStage(entry.id, nextStage(entry.stage));
      await query.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not advance stage.');
    } finally {
      setBusyId(null);
    }
  }, [query]);

  const handleDelete = useCallback(async (entry: PipelineEntry) => {
    setBusyId(entry.id);
    try {
      await deletePipelineEntry(entry.id);
      await query.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the entry.');
    } finally {
      setBusyId(null);
    }
  }, [query]);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 96 }]}
        refreshControl={<RefreshControl tintColor={Colors.primary} refreshing={query.isFetching} onRefresh={() => { void query.refetch(); }} />}
        testID="ivx-capital-pipeline-scroll"
      >
        <View style={styles.heroCard}>
          <View style={styles.heroHeaderRow}>
            <GitBranch size={18} color={Colors.primary} />
            <Text style={styles.heroTitle}>Capital Pipeline</Text>
          </View>
          <Text style={styles.heroSubtitle}>
            Track every capital relationship from Lead to Closed. Remaining gap is computed from requested minus committed — IVX never invents capital figures.
          </Text>
          <View style={styles.metricGrid}>
            <MetricTile label="Total pipeline" value={formatMoney(summary?.totalPipeline ?? 0)} />
            <MetricTile label="Raised" value={formatMoney(summary?.capitalRaised ?? 0)} tone={Colors.success} />
            <MetricTile label="Weighted" value={formatMoney(summary?.weightedPipeline ?? 0)} tone={Colors.primary} />
          </View>
          <View style={styles.metricGrid}>
            <MetricTile label="Investors" value={summary?.activeInvestors ?? 0} tone={Colors.info} />
            <MetricTile label="Buyers" value={summary?.activeBuyers ?? 0} tone={Colors.warning} />
            <MetricTile label="In progress" value={summary?.dealsInProgress ?? 0} />
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          <Pressable
            style={[styles.filterChip, filter === 'all' ? styles.filterChipActive : null]}
            onPress={() => setFilter('all')}
            testID="ivx-pipeline-filter-all"
          >
            <Text style={[styles.filterChipText, filter === 'all' ? styles.filterChipTextActive : null]}>{`All (${entries.length})`}</Text>
          </Pressable>
          {PIPELINE_STAGES.map((s) => (
            <Pressable
              key={s}
              style={[styles.filterChip, filter === s ? styles.filterChipActive : null]}
              onPress={() => setFilter(s)}
              testID={`ivx-pipeline-filter-${s}`}
            >
              <Text style={[styles.filterChipText, filter === s ? styles.filterChipTextActive : null]}>
                {`${STAGE_LABEL[s]} (${summary?.byStage[s] ?? entries.filter((e) => e.stage === s).length})`}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {error && !modalOpen ? <Text style={styles.errorText}>{error}</Text> : null}

        {query.isLoading ? (
          <View style={styles.card}><ShimmerIndicator size="small" color={Colors.primary} /></View>
        ) : filtered.length === 0 ? (
          <View style={styles.emptyCard}>
            <Wallet size={26} color={Colors.textTertiary} />
            <Text style={styles.emptyTitle}>{entries.length === 0 ? 'No pipeline entries yet' : 'None in this stage'}</Text>
            <Text style={styles.emptyBody}>
              {entries.length === 0
                ? 'Add an investor or buyer from a real source and move them through the nine stages toward a close.'
                : 'Advance entries by tapping the stage pill on each card.'}
            </Text>
          </View>
        ) : (
          filtered.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              onEdit={openEdit}
              onAdvance={handleAdvance}
              onDelete={handleDelete}
              busy={busyId === entry.id}
            />
          ))
        )}
      </ScrollView>

      <Pressable style={[styles.fab, { bottom: insets.bottom + 20 }]} onPress={openCreate} testID="ivx-pipeline-add">
        <TrendingUp size={22} color={Colors.black} />
      </Pressable>

      <Modal visible={modalOpen} animationType="slide" transparent onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingId ? 'Edit entry' : 'New pipeline entry'}</Text>
              <Pressable style={styles.modalClose} onPress={() => setModalOpen(false)} testID="ivx-pipeline-modal-close">
                <X size={20} color={Colors.text} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
              <Field label="Name *" value={form.name} onChangeText={(t) => set('name', t)} placeholder="Investor / buyer name" />
              <Field label="Company" value={form.company} onChangeText={(t) => set('company', t)} placeholder="Firm / family office" />
              <OptionRow label="Type" options={PARTY_OPTIONS} value={form.partyType} onChange={(v) => set('partyType', v)} />
              <Field label="Linked deal" value={form.dealName} onChangeText={(t) => set('dealName', t)} placeholder="Casa Rosario" />
              <View style={styles.dualRow}>
                <View style={styles.dualItem}><Field label="Capital requested ($)" value={form.capitalRequested} onChangeText={(t) => set('capitalRequested', t)} placeholder="1000000" keyboardType="numeric" /></View>
                <View style={styles.dualItem}><Field label="Capital committed ($)" value={form.capitalCommitted} onChangeText={(t) => set('capitalCommitted', t)} placeholder="250000" keyboardType="numeric" /></View>
              </View>
              <View style={styles.dualRow}>
                <View style={styles.dualItem}><Field label="Close probability (0–100)" value={form.closeProbability} onChangeText={(t) => set('closeProbability', t)} placeholder="0" keyboardType="numeric" /></View>
                <View style={styles.dualItem}><Field label="Expected close date" value={form.expectedCloseDate} onChangeText={(t) => set('expectedCloseDate', t)} placeholder="YYYY-MM-DD" /></View>
              </View>
              <OptionRow label="Stage" options={PIPELINE_STAGES.map((s) => ({ value: s, label: STAGE_LABEL[s] }))} value={form.stage} onChange={(v) => set('stage', v)} />
              <OptionRow label="Source *" options={SOURCE_OPTIONS} value={form.source} onChange={(v) => set('source', v)} />
              <Field
                label={form.source === 'public_source' || form.source === 'crm_import' ? 'Source attribution * (required)' : 'Source attribution'}
                value={form.sourceDetail}
                onChangeText={(t) => set('sourceDetail', t)}
                placeholder="Who entered / which form / which import / public URL"
              />
              <Field label="Notes" value={form.notes} onChangeText={(t) => set('notes', t)} placeholder="Context, terms, history" multiline />
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
            </ScrollView>
            <Pressable style={[styles.saveBtn, saving ? styles.btnDisabled : null]} onPress={() => { void handleSave(); }} disabled={saving} testID="ivx-pipeline-save">
              {saving ? <ShimmerIndicator size="small" color={Colors.black} /> : <Check size={16} color={Colors.black} />}
              <Text style={styles.saveBtnText}>{editingId ? 'Save changes' : 'Add to pipeline'}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

export default function CapitalPipelineScreen() {
  return (
    <ErrorBoundary>
      <Stack.Screen options={{ title: 'Capital Pipeline' }} />
      <CapitalPipelineContent />
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
  metricTile: { flex: 1, backgroundColor: Colors.surface, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 6, alignItems: 'center', gap: 2, borderWidth: 1, borderColor: Colors.border },
  metricValue: { fontSize: 16, fontWeight: '800' as const, color: Colors.text },
  metricLabel: { fontSize: 9.5, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.4 },
  filterRow: { gap: 8, paddingVertical: 2, paddingRight: 8 },
  filterChip: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card },
  filterChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterChipText: { fontSize: 12.5, fontWeight: '600' as const, color: Colors.textSecondary },
  filterChipTextActive: { color: Colors.black },
  errorText: { fontSize: 12.5, color: Colors.error, lineHeight: 18 },
  card: { backgroundColor: Colors.card, borderRadius: 16, padding: 15, gap: 10, borderWidth: 1, borderColor: Colors.border },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  cardTitleBlock: { flex: 1, gap: 1 },
  cardName: { fontSize: 15.5, fontWeight: '700' as const, color: Colors.text },
  cardSub: { fontSize: 12.5, color: Colors.textSecondary },
  stagePill: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1.5, maxWidth: 140 },
  stagePillText: { fontSize: 11, fontWeight: '700' as const },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  metaText: { flex: 1, fontSize: 12.5, color: Colors.textSecondary },
  moneyRow: { flexDirection: 'row', gap: 8 },
  moneyCell: { flex: 1, backgroundColor: Colors.surface, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 6, gap: 2, borderWidth: 1, borderColor: Colors.border },
  moneyLabel: { fontSize: 9.5, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3 },
  moneyValue: { fontSize: 14, fontWeight: '800' as const, color: Colors.text },
  probTrack: { height: 6, borderRadius: 3, backgroundColor: Colors.surfaceLight, overflow: 'hidden' },
  probFill: { height: 6, borderRadius: 3 },
  footRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  footMeta: { flex: 1, fontSize: 11.5, color: Colors.textTertiary },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  editBtn: { alignItems: 'center', justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, borderColor: Colors.border },
  editBtnText: { fontSize: 12.5, fontWeight: '600' as const, color: Colors.text },
  deleteBtn: { width: 40, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: Colors.border },
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
  dualRow: { flexDirection: 'row', gap: 10 },
  dualItem: { flex: 1 },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, marginHorizontal: 18, marginTop: 8, paddingVertical: 14, borderRadius: 12 },
  saveBtnText: { fontSize: 15, fontWeight: '700' as const, color: Colors.black },
  btnDisabled: { opacity: 0.6 }});
