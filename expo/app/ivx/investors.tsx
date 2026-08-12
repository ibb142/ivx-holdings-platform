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
  Building2,
  Check,
  ChevronDown,
  Mail,
  MapPin,
  Phone,
  Plus,
  ShieldCheck,
  Trash2,
  TrendingUp,
  UserPlus,
  Users,
  X} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  createInvestor,
  deleteInvestor,
  listInvestors,
  setInvestorStatus,
  updateInvestor,
  type AccreditedStatus,
  type InvestorInput,
  type InvestorListResult,
  type InvestorRecord,
  type InvestorSource,
  type InvestorStatus} from '@/src/modules/ivx-developer/investorCrmService';

const STATUS_ORDER: InvestorStatus[] = ['prospect', 'contacted', 'meeting_scheduled', 'active', 'invested'];
const STATUS_LABEL: Record<InvestorStatus, string> = {
  prospect: 'Prospect',
  contacted: 'Contacted',
  meeting_scheduled: 'Meeting',
  active: 'Active',
  invested: 'Invested'};
const STATUS_TONE: Record<InvestorStatus, string> = {
  prospect: Colors.textTertiary,
  contacted: Colors.info,
  meeting_scheduled: Colors.warning,
  active: Colors.primary,
  invested: Colors.success};

const SOURCE_OPTIONS: { value: InvestorSource; label: string }[] = [
  { value: 'owner_entered', label: 'Owner entered' },
  { value: 'submitted_form', label: 'Submitted form' },
  { value: 'crm_import', label: 'CRM import' },
  { value: 'public_source', label: 'Public source' },
  { value: 'verified_deal', label: 'Verified deal' },
];
const SOURCE_LABEL: Record<InvestorSource, string> = {
  owner_entered: 'Owner entered',
  submitted_form: 'Submitted form',
  crm_import: 'CRM import',
  public_source: 'Public source',
  verified_deal: 'Verified deal'};

const ACCREDITED_OPTIONS: { value: AccreditedStatus; label: string }[] = [
  { value: 'unknown', label: 'Unknown' },
  { value: 'accredited', label: 'Accredited' },
  { value: 'non_accredited', label: 'Non-accredited' },
];

type FormState = {
  name: string;
  company: string;
  email: string;
  phone: string;
  location: string;
  investmentType: string;
  accreditedStatus: AccreditedStatus;
  preferredMarkets: string;
  preferredAssetClasses: string;
  typicalCheckSize: string;
  investmentTimeline: string;
  notes: string;
  lastContactDate: string;
  leadScore: string;
  relationshipScore: string;
  status: InvestorStatus;
  source: InvestorSource;
  sourceDetail: string;
};

function emptyForm(): FormState {
  return {
    name: '', company: '', email: '', phone: '', location: '', investmentType: '',
    accreditedStatus: 'unknown', preferredMarkets: '', preferredAssetClasses: '',
    typicalCheckSize: '', investmentTimeline: '', notes: '', lastContactDate: '',
    leadScore: '', relationshipScore: '', status: 'prospect', source: 'owner_entered', sourceDetail: ''};
}

function formFromRecord(r: InvestorRecord): FormState {
  return {
    name: r.name,
    company: r.company,
    email: r.email,
    phone: r.phone,
    location: r.location,
    investmentType: r.investmentType,
    accreditedStatus: r.accreditedStatus,
    preferredMarkets: r.preferredMarkets.join(', '),
    preferredAssetClasses: r.preferredAssetClasses.join(', '),
    typicalCheckSize: r.typicalCheckSize,
    investmentTimeline: r.investmentTimeline,
    notes: r.notes,
    lastContactDate: r.lastContactDate ? r.lastContactDate.slice(0, 10) : '',
    leadScore: String(r.leadScore),
    relationshipScore: String(r.relationshipScore),
    status: r.status,
    source: r.source,
    sourceDetail: r.sourceDetail};
}

function toCsvList(value: string): string[] {
  return value.split(',').map((v) => v.trim()).filter(Boolean);
}

function formToInput(form: FormState): InvestorInput {
  return {
    name: form.name.trim(),
    source: form.source,
    sourceDetail: form.sourceDetail.trim(),
    company: form.company.trim(),
    email: form.email.trim(),
    phone: form.phone.trim(),
    location: form.location.trim(),
    investmentType: form.investmentType.trim(),
    accreditedStatus: form.accreditedStatus,
    preferredMarkets: toCsvList(form.preferredMarkets),
    preferredAssetClasses: toCsvList(form.preferredAssetClasses),
    typicalCheckSize: form.typicalCheckSize.trim(),
    investmentTimeline: form.investmentTimeline.trim(),
    notes: form.notes.trim(),
    lastContactDate: form.lastContactDate.trim() || null,
    leadScore: form.leadScore.trim() ? Number(form.leadScore) : undefined,
    relationshipScore: form.relationshipScore.trim() ? Number(form.relationshipScore) : undefined,
    status: form.status};
}

function Field({ label, value, onChangeText, placeholder, keyboardType, multiline }: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'numeric';
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
        autoCapitalize={keyboardType === 'email-address' ? 'none' : 'sentences'}
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
      <Text style={[styles.metricValue, tone ? { color: tone } : null]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function InvestorCard({ investor, onEdit, onCycleStatus, onDelete, busy }: {
  investor: InvestorRecord;
  onEdit: (i: InvestorRecord) => void;
  onCycleStatus: (i: InvestorRecord) => void;
  onDelete: (i: InvestorRecord) => void;
  busy: boolean;
}) {
  const initials = investor.name.split(/\s+/).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('') || '?';
  return (
    <View style={styles.card} testID={`ivx-investor-${investor.id}`}>
      <View style={styles.cardTopRow}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></View>
        <View style={styles.cardTitleBlock}>
          <Text style={styles.cardName} numberOfLines={1}>{investor.name}</Text>
          {investor.company ? <Text style={styles.cardCompany} numberOfLines={1}>{investor.company}</Text> : null}
        </View>
        <Pressable
          style={[styles.statusPill, { borderColor: STATUS_TONE[investor.status] }]}
          onPress={() => onCycleStatus(investor)}
          disabled={busy}
          testID={`ivx-investor-status-${investor.id}`}
        >
          <Text style={[styles.statusPillText, { color: STATUS_TONE[investor.status] }]}>{STATUS_LABEL[investor.status]}</Text>
        </Pressable>
      </View>

      <View style={styles.metaList}>
        {investor.investmentType ? (
          <View style={styles.metaRow}><TrendingUp size={12} color={Colors.textTertiary} /><Text style={styles.metaText}>{investor.investmentType}</Text></View>
        ) : null}
        {investor.location ? (
          <View style={styles.metaRow}><MapPin size={12} color={Colors.textTertiary} /><Text style={styles.metaText}>{investor.location}</Text></View>
        ) : null}
        {investor.email ? (
          <View style={styles.metaRow}><Mail size={12} color={Colors.textTertiary} /><Text style={styles.metaText} numberOfLines={1}>{investor.email}</Text></View>
        ) : null}
        {investor.phone ? (
          <View style={styles.metaRow}><Phone size={12} color={Colors.textTertiary} /><Text style={styles.metaText}>{investor.phone}</Text></View>
        ) : null}
      </View>

      {(investor.preferredMarkets.length > 0 || investor.preferredAssetClasses.length > 0) ? (
        <View style={styles.tagWrap}>
          {investor.preferredMarkets.map((m) => (
            <View key={`m-${m}`} style={styles.tag}><Text style={styles.tagText}>{m}</Text></View>
          ))}
          {investor.preferredAssetClasses.map((a) => (
            <View key={`a-${a}`} style={[styles.tag, styles.tagAlt]}><Text style={styles.tagText}>{a}</Text></View>
          ))}
        </View>
      ) : null}

      <View style={styles.scoreRow}>
        <Text style={styles.scoreChip}>{`Lead ${investor.leadScore}`}</Text>
        <Text style={styles.scoreChip}>{`Relationship ${investor.relationshipScore}`}</Text>
        {investor.typicalCheckSize ? <Text style={styles.scoreChip}>{investor.typicalCheckSize}</Text> : null}
        {investor.accreditedStatus === 'accredited' ? (
          <View style={styles.accreditedChip}><ShieldCheck size={11} color={Colors.success} /><Text style={styles.accreditedText}>Accredited</Text></View>
        ) : null}
      </View>

      <View style={styles.sourceRow}>
        <Building2 size={11} color={Colors.textTertiary} />
        <Text style={styles.sourceText} numberOfLines={1}>
          {`Source: ${SOURCE_LABEL[investor.source]}${investor.sourceDetail ? ` · ${investor.sourceDetail}` : ''}`}
        </Text>
      </View>

      <View style={styles.cardActions}>
        <Pressable style={styles.editBtn} onPress={() => onEdit(investor)} disabled={busy} testID={`ivx-investor-edit-${investor.id}`}>
          <Text style={styles.editBtnText}>Edit</Text>
        </Pressable>
        <Pressable style={styles.deleteBtn} onPress={() => onDelete(investor)} disabled={busy} testID={`ivx-investor-delete-${investor.id}`}>
          <Trash2 size={14} color={Colors.error} />
        </Pressable>
      </View>
    </View>
  );
}

function InvestorsContent() {
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<InvestorStatus | 'all'>('all');
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState<boolean>(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery<InvestorListResult>({
    queryKey: ['ivx-investor-crm', 'list'],
    queryFn: listInvestors});

  const investors = useMemo(() => query.data?.investors ?? [], [query.data]);
  const summary = query.data?.summary ?? null;

  const filtered = useMemo(
    () => (filter === 'all' ? investors : investors.filter((i) => i.status === filter)),
    [investors, filter],
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

  const openEdit = useCallback((investor: InvestorRecord) => {
    setEditingId(investor.id);
    setForm(formFromRecord(investor));
    setError(null);
    setModalOpen(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!form.name.trim()) {
      setError('Investor name is required — IVX never fabricates a record.');
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
        await updateInvestor(editingId, input);
      } else {
        await createInvestor(input);
      }
      setModalOpen(false);
      await query.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the investor.');
    } finally {
      setSaving(false);
    }
  }, [form, editingId, query]);

  const handleCycleStatus = useCallback(async (investor: InvestorRecord) => {
    const idx = STATUS_ORDER.indexOf(investor.status);
    const next = STATUS_ORDER[(idx + 1) % STATUS_ORDER.length]!;
    setBusyId(investor.id);
    try {
      await setInvestorStatus(investor.id, next);
      await query.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update status.');
    } finally {
      setBusyId(null);
    }
  }, [query]);

  const handleDelete = useCallback(async (investor: InvestorRecord) => {
    setBusyId(investor.id);
    try {
      await deleteInvestor(investor.id);
      await query.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the investor.');
    } finally {
      setBusyId(null);
    }
  }, [query]);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 96 }]}
        refreshControl={<RefreshControl tintColor={Colors.primary} refreshing={query.isFetching} onRefresh={() => { void query.refetch(); }} />}
        testID="ivx-investors-scroll"
      >
        <View style={styles.heroCard}>
          <View style={styles.heroHeaderRow}>
            <Users size={18} color={Colors.primary} />
            <Text style={styles.heroTitle}>Investor CRM</Text>
          </View>
          <Text style={styles.heroSubtitle}>
            Manage capital relationships end-to-end. Every record comes from a real, attributable source — owner-entered, a submitted form, a CRM import, an attributed public source, or a verified deal. IVX never fabricates investors, emails, or phone numbers.
          </Text>
          <View style={styles.metricGrid}>
            <MetricTile label="Total" value={summary?.total ?? investors.length} />
            <MetricTile label="Active" value={summary?.byStatus.active ?? 0} tone={Colors.primary} />
            <MetricTile label="Invested" value={summary?.byStatus.invested ?? 0} tone={Colors.success} />
            <MetricTile label="Accredited" value={summary?.accredited ?? 0} tone={Colors.info} />
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          <Pressable
            style={[styles.filterChip, filter === 'all' ? styles.filterChipActive : null]}
            onPress={() => setFilter('all')}
            testID="ivx-investor-filter-all"
          >
            <Text style={[styles.filterChipText, filter === 'all' ? styles.filterChipTextActive : null]}>{`All (${investors.length})`}</Text>
          </Pressable>
          {STATUS_ORDER.map((s) => (
            <Pressable
              key={s}
              style={[styles.filterChip, filter === s ? styles.filterChipActive : null]}
              onPress={() => setFilter(s)}
              testID={`ivx-investor-filter-${s}`}
            >
              <Text style={[styles.filterChipText, filter === s ? styles.filterChipTextActive : null]}>
                {`${STATUS_LABEL[s]} (${summary?.byStatus[s] ?? investors.filter((i) => i.status === s).length})`}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {error && !modalOpen ? <Text style={styles.errorText}>{error}</Text> : null}

        {query.isLoading ? (
          <View style={styles.card}><ShimmerIndicator size="small" color={Colors.primary} /></View>
        ) : filtered.length === 0 ? (
          <View style={styles.emptyCard}>
            <UserPlus size={26} color={Colors.textTertiary} />
            <Text style={styles.emptyTitle}>{investors.length === 0 ? 'No investors yet' : 'None in this stage'}</Text>
            <Text style={styles.emptyBody}>
              {investors.length === 0
                ? 'Add your first investor from a real source — IVX builds the relationship pipeline from data you provide.'
                : 'Move investors through the pipeline as you engage them.'}
            </Text>
          </View>
        ) : (
          filtered.map((investor) => (
            <InvestorCard
              key={investor.id}
              investor={investor}
              onEdit={openEdit}
              onCycleStatus={handleCycleStatus}
              onDelete={handleDelete}
              busy={busyId === investor.id}
            />
          ))
        )}
      </ScrollView>

      <Pressable style={[styles.fab, { bottom: insets.bottom + 20 }]} onPress={openCreate} testID="ivx-investor-add">
        <Plus size={22} color={Colors.black} />
      </Pressable>

      <Modal visible={modalOpen} animationType="slide" transparent onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingId ? 'Edit investor' : 'New investor'}</Text>
              <Pressable style={styles.modalClose} onPress={() => setModalOpen(false)} testID="ivx-investor-modal-close">
                <X size={20} color={Colors.text} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
              <Field label="Name *" value={form.name} onChangeText={(t) => set('name', t)} placeholder="Full name" />
              <Field label="Company" value={form.company} onChangeText={(t) => set('company', t)} placeholder="Firm / family office" />
              <Field label="Email" value={form.email} onChangeText={(t) => set('email', t)} placeholder="name@firm.com" keyboardType="email-address" />
              <Field label="Phone" value={form.phone} onChangeText={(t) => set('phone', t)} placeholder="+1 …" keyboardType="phone-pad" />
              <Field label="Location" value={form.location} onChangeText={(t) => set('location', t)} placeholder="Miami, FL" />
              <Field label="Investment type" value={form.investmentType} onChangeText={(t) => set('investmentType', t)} placeholder="Family office, syndicator, PE…" />
              <OptionRow label="Accredited status" options={ACCREDITED_OPTIONS} value={form.accreditedStatus} onChange={(v) => set('accreditedStatus', v)} />
              <Field label="Preferred markets" value={form.preferredMarkets} onChangeText={(t) => set('preferredMarkets', t)} placeholder="South Florida, Miami (comma separated)" />
              <Field label="Preferred asset classes" value={form.preferredAssetClasses} onChangeText={(t) => set('preferredAssetClasses', t)} placeholder="Multifamily, Luxury condos (comma separated)" />
              <Field label="Typical check size" value={form.typicalCheckSize} onChangeText={(t) => set('typicalCheckSize', t)} placeholder="$250k–$1M" />
              <Field label="Investment timeline" value={form.investmentTimeline} onChangeText={(t) => set('investmentTimeline', t)} placeholder="0–6 months / opportunistic" />
              <View style={styles.dualRow}>
                <View style={styles.dualItem}><Field label="Lead score (0–100)" value={form.leadScore} onChangeText={(t) => set('leadScore', t)} placeholder="0" keyboardType="numeric" /></View>
                <View style={styles.dualItem}><Field label="Relationship (0–100)" value={form.relationshipScore} onChangeText={(t) => set('relationshipScore', t)} placeholder="0" keyboardType="numeric" /></View>
              </View>
              <Field label="Last contact date" value={form.lastContactDate} onChangeText={(t) => set('lastContactDate', t)} placeholder="YYYY-MM-DD" />
              <OptionRow label="Pipeline status" options={STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} value={form.status} onChange={(v) => set('status', v)} />
              <OptionRow label="Source *" options={SOURCE_OPTIONS} value={form.source} onChange={(v) => set('source', v)} />
              <Field
                label={form.source === 'public_source' || form.source === 'crm_import' ? 'Source attribution * (required)' : 'Source attribution'}
                value={form.sourceDetail}
                onChangeText={(t) => set('sourceDetail', t)}
                placeholder="Who entered / which form / which import / public URL"
              />
              <Field label="Notes" value={form.notes} onChangeText={(t) => set('notes', t)} placeholder="Context, history, preferences" multiline />
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
            </ScrollView>
            <Pressable style={[styles.saveBtn, saving ? styles.btnDisabled : null]} onPress={() => { void handleSave(); }} disabled={saving} testID="ivx-investor-save">
              {saving ? <ShimmerIndicator size="small" color={Colors.black} /> : <Check size={16} color={Colors.black} />}
              <Text style={styles.saveBtnText}>{editingId ? 'Save changes' : 'Add investor'}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

export default function InvestorsScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  return (
    <ErrorBoundary>
      <Stack.Screen options={{ title: 'Investors' }} />
      <InvestorsContent />
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
  cardTopRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.surfaceLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontWeight: '800' as const, color: Colors.primary },
  cardTitleBlock: { flex: 1, gap: 1 },
  cardName: { fontSize: 15.5, fontWeight: '700' as const, color: Colors.text },
  cardCompany: { fontSize: 12.5, color: Colors.textSecondary },
  statusPill: { paddingHorizontal: 11, paddingVertical: 5, borderRadius: 20, borderWidth: 1.5 },
  statusPillText: { fontSize: 11, fontWeight: '700' as const },
  metaList: { gap: 5 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  metaText: { flex: 1, fontSize: 12.5, color: Colors.textSecondary },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { backgroundColor: Colors.surface, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4, borderWidth: 1, borderColor: Colors.border },
  tagAlt: { backgroundColor: Colors.backgroundTertiary },
  tagText: { fontSize: 11, color: Colors.textSecondary },
  scoreRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  scoreChip: { fontSize: 11.5, color: Colors.text, backgroundColor: Colors.surfaceLight, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4, overflow: 'hidden' },
  accreditedChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(34,197,94,0.12)', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  accreditedText: { fontSize: 11, fontWeight: '600' as const, color: Colors.success },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sourceText: { flex: 1, fontSize: 10.5, color: Colors.textTertiary },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 },
  editBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: Colors.border },
  editBtnText: { fontSize: 12.5, fontWeight: '600' as const, color: Colors.text },
  deleteBtn: { width: 42, alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: Colors.border },
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
