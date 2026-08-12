import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { Stack, router } from 'expo-router';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View} from "react-native";
import {
  CheckCircle2,
  FileText,
  Link2,
  Mail,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Unplug} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  connectGmail,
  createGmailDraft,
  disconnectGmail,
  getGmailStatus,
  listGmailDrafts,
  refreshGmailToken,
  testGmailDraftAccess,
  OwnerSessionRequiredError,
  type CreateGmailDraftResult,
  type GmailDraftRecord,
  type GmailProviderStatus,
  type GmailTestResult} from '@/src/modules/ivx-developer/gmailProviderService';

function StatusRow({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.statusRow}>
      <Text style={styles.statusLabel}>{label}</Text>
      <Text style={[styles.statusValue, tone ? { color: tone } : null]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function ActionButton({
  label,
  icon,
  onPress,
  disabled,
  tone}: {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
  tone?: string;
}) {
  return (
    <Pressable
      style={[styles.actionBtn, disabled ? styles.actionBtnDisabled : null, tone ? { borderColor: tone } : null]}
      onPress={onPress}
      disabled={disabled}
      testID={`ivx-gmail-action-${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      {icon}
      <Text style={[styles.actionBtnText, tone ? { color: tone } : null]}>{label}</Text>
    </Pressable>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function GmailProviderContent() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [sessionRequired, setSessionRequired] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<GmailTestResult | null>(null);
  const [draftResult, setDraftResult] = useState<CreateGmailDraftResult | null>(null);
  const [contactVerified, setContactVerified] = useState<boolean>(false);
  const [ownerApproved, setOwnerApproved] = useState<boolean>(false);

  const handleSessionError = useCallback((error: unknown): boolean => {
    if (error instanceof OwnerSessionRequiredError) {
      setSessionRequired(error.message);
      return true;
    }
    return false;
  }, []);

  const statusQuery = useQuery<GmailProviderStatus | null>({
    queryKey: ['ivx-gmail-status'],
    queryFn: async () => {
      try {
        const status = await getGmailStatus();
        setSessionRequired(null);
        return status;
      } catch (error) {
        if (handleSessionError(error)) return null;
        throw error;
      }
    }});

  const draftsQuery = useQuery<GmailDraftRecord[]>({
    queryKey: ['ivx-gmail-drafts'],
    queryFn: async () => {
      try {
        return await listGmailDrafts();
      } catch (error) {
        if (handleSessionError(error)) return [];
        throw error;
      }
    }});

  const status = statusQuery.data ?? null;
  const connected = status?.connected === true;

  const invalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['ivx-gmail-status'] });
    void qc.invalidateQueries({ queryKey: ['ivx-gmail-drafts'] });
  }, [qc]);

  const connectMutation = useMutation({
    mutationFn: connectGmail,
    onSuccess: (r) => { setActionNote(r.ok ? r.note : r.detail); invalidate(); },
    onError: (e) => { if (!handleSessionError(e)) setActionNote(e instanceof Error ? e.message : 'Connect failed.'); }});
  const disconnectMutation = useMutation({
    mutationFn: disconnectGmail,
    onSuccess: (r) => { setActionNote(r.ok ? r.note : (r as { detail?: string }).detail ?? 'Disconnected.'); invalidate(); },
    onError: (e) => { if (!handleSessionError(e)) setActionNote(e instanceof Error ? e.message : 'Disconnect failed.'); }});
  const refreshMutation = useMutation({
    mutationFn: refreshGmailToken,
    onSuccess: (r) => { setActionNote(r.ok ? r.note : r.detail); invalidate(); },
    onError: (e) => { if (!handleSessionError(e)) setActionNote(e instanceof Error ? e.message : 'Refresh failed.'); }});
  const testMutation = useMutation({
    mutationFn: testGmailDraftAccess,
    onSuccess: (r) => { setTestResult(r); setActionNote(r.note); invalidate(); },
    onError: (e) => { if (!handleSessionError(e)) setActionNote(e instanceof Error ? e.message : 'Test failed.'); }});
  const draftMutation = useMutation({
    mutationFn: () =>
      createGmailDraft({
        type: 'investor_intro',
        recipientName: 'Prospect',
        recipientCompany: 'Prospect Capital',
        recipientContact: 'prospect@example.com',
        relatedDeal: 'Casa Rosario',
        contactVerified,
        ownerApproved}),
    onSuccess: (r) => { setDraftResult(r); invalidate(); },
    onError: (e) => { if (!handleSessionError(e)) setActionNote(e instanceof Error ? e.message : 'Draft failed.'); }});

  const drafts = useMemo(() => draftsQuery.data ?? [], [draftsQuery.data]);
  const busy = connectMutation.isPending || disconnectMutation.isPending || refreshMutation.isPending || testMutation.isPending;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 90 }]}
        refreshControl={<RefreshControl tintColor={Colors.primary} refreshing={statusQuery.isFetching} onRefresh={invalidate} />}
        testID="ivx-gmail-scroll"
      >
        <View style={styles.heroCard}>
          <View style={styles.heroHeaderRow}>
            <Mail size={18} color={Colors.primary} />
            <Text style={styles.heroTitle}>Gmail OAuth Draft Provider</Text>
          </View>
          <Text style={styles.heroSubtitle}>
            Connect Gmail to create owner-approved DRAFTS only. IVX never auto-sends, never bypasses approval, and never invents a contact. Drafts require a verified contact + owner approval.
          </Text>
        </View>

        {sessionRequired ? (
          <View style={[styles.bannerCard, { borderColor: Colors.warning }]}>
            <View style={styles.bannerHeader}>
              <ShieldAlert size={16} color={Colors.warning} />
              <Text style={[styles.bannerTitle, { color: Colors.warning }]}>OWNER_SESSION_REQUIRED</Text>
            </View>
            <Text style={styles.bannerBody}>{sessionRequired}</Text>
            <Pressable
              style={styles.bannerBtn}
              onPress={() => router.push('/ivx/auth-diagnostics' as never)}
              testID="ivx-gmail-open-auth"
            >
              <Text style={styles.bannerBtnText}>Open Auth Diagnostics</Text>
            </Pressable>
          </View>
        ) : null}

        {statusQuery.isLoading ? (
          <View style={styles.card}><ShimmerIndicator size="small" color={Colors.primary} /></View>
        ) : status ? (
          <View style={styles.card}>
            <View style={styles.statusHeader}>
              {connected ? <ShieldCheck size={18} color={Colors.success} /> : <Unplug size={18} color={Colors.textTertiary} />}
              <Text style={[styles.statusState, { color: connected ? Colors.success : Colors.textSecondary }]}>
                {connected ? 'Connected' : 'Not connected'}
              </Text>
            </View>
            <StatusRow label="Owner email" value={status.ownerEmail ?? '—'} />
            <StatusRow label="Scope granted" value={status.scopeGranted.length ? status.scopeGranted.join(', ') : '—'} />
            <StatusRow label="Last verified" value={formatDate(status.lastVerifiedAt)} />
            <StatusRow label="Token expiry" value={formatDate(status.tokenExpiry)} />
            <StatusRow
              label="OAuth credential"
              value={status.backedByCredentials ? 'present' : `missing: ${status.missingEnv.join(' / ')}`}
              tone={status.backedByCredentials ? Colors.success : Colors.warning}
            />
            <Text style={styles.statusNote}>{status.note}</Text>
          </View>
        ) : null}

        {!sessionRequired ? (
          <View style={styles.actionGrid}>
            {connected ? (
              <ActionButton label="Disconnect Gmail" icon={<Unplug size={14} color={Colors.error} />} tone={Colors.error} onPress={() => disconnectMutation.mutate()} disabled={busy} />
            ) : (
              <ActionButton label="Connect Gmail" icon={<Link2 size={14} color={Colors.primary} />} onPress={() => connectMutation.mutate()} disabled={busy} />
            )}
            <ActionButton label="Refresh Gmail token" icon={<RefreshCw size={14} color={Colors.primary} />} onPress={() => refreshMutation.mutate()} disabled={busy || !connected} />
            <ActionButton label="Test Gmail draft access" icon={<CheckCircle2 size={14} color={Colors.primary} />} onPress={() => testMutation.mutate()} disabled={busy || !connected} />
          </View>
        ) : null}

        {actionNote ? <Text style={styles.actionNote}>{actionNote}</Text> : null}

        {testResult ? (
          <View style={[styles.card, { borderColor: testResult.canDraft ? Colors.success : Colors.warning }]}>
            <Text style={[styles.cardLabel, { color: testResult.canDraft ? Colors.success : Colors.warning }]}>
              {testResult.canDraft ? 'Draft access OK' : testResult.result}
            </Text>
            <Text style={styles.statusNote}>{testResult.note}</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Create a Gmail draft (gate test)</Text>
          <Text style={styles.cardHint}>Gate order: Gmail connected → verified contact → owner approval. Toggle to prove each blocker.</Text>
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Contact verified</Text>
            <Switch value={contactVerified} onValueChange={setContactVerified} />
          </View>
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Owner approval</Text>
            <Switch value={ownerApproved} onValueChange={setOwnerApproved} />
          </View>
          <Pressable
            style={[styles.primaryBtn, (draftMutation.isPending || !!sessionRequired) ? styles.actionBtnDisabled : null]}
            onPress={() => draftMutation.mutate()}
            disabled={draftMutation.isPending || !!sessionRequired}
            testID="ivx-gmail-create-draft"
          >
            <FileText size={15} color={Colors.black} />
            <Text style={styles.primaryBtnText}>{draftMutation.isPending ? 'Creating…' : 'Create Gmail draft'}</Text>
          </Pressable>
          {draftResult ? (
            draftResult.ok ? (
              <View style={[styles.resultBox, { borderColor: Colors.success }]}>
                <Text style={[styles.resultLabel, { color: Colors.success }]}>Gmail draft created · {draftResult.draft.outreachStatus}</Text>
                <Text style={styles.resultLine}>{`Gmail draft id: ${draftResult.draft.gmailDraftId}`}</Text>
                <Text style={styles.resultLine}>{`Subject: ${draftResult.draft.subject}`}</Text>
                <Text style={styles.resultLine}>{`Follow-up due: ${formatDate(draftResult.draft.followUpDueAt)}`}</Text>
                <Text style={styles.resultLine}>{`Auto-sent: ${draftResult.draft.autoSent ? 'yes' : 'no'}`}</Text>
                <Text style={styles.resultNote}>{draftResult.note}</Text>
              </View>
            ) : (
              <View style={[styles.resultBox, { borderColor: Colors.warning }]}>
                <Text style={[styles.resultLabel, { color: Colors.warning }]}>{draftResult.blocker}</Text>
                <Text style={styles.resultNote}>{draftResult.detail}</Text>
              </View>
            )
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>{`Gmail drafts (${drafts.length})`}</Text>
        {draftsQuery.isLoading ? (
          <View style={styles.card}><ShimmerIndicator size="small" color={Colors.primary} /></View>
        ) : drafts.length === 0 ? (
          <View style={styles.emptyCard}>
            <Mail size={24} color={Colors.textTertiary} />
            <Text style={styles.emptyText}>No Gmail drafts yet. Connect Gmail, verify the contact, and approve to create one.</Text>
          </View>
        ) : (
          drafts.map((d) => (
            <View key={d.id} style={styles.draftCard} testID={`ivx-gmail-draft-${d.id}`}>
              <Text style={styles.draftSubject} numberOfLines={1}>{d.subject}</Text>
              <Text style={styles.draftMeta} numberOfLines={1}>{`${d.recipientName || d.recipientCompany} · ${d.outreachStatus}`}</Text>
              <Text style={styles.draftMeta} numberOfLines={1}>{`Follow-up ${formatDate(d.followUpDueAt)}`}</Text>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

export default function GmailProviderScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  return (
    <ErrorBoundary>
      <Stack.Screen options={{ title: 'Gmail Provider' }} />
      <GmailProviderContent />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, gap: 12 },
  heroCard: { backgroundColor: Colors.card, borderRadius: 16, padding: 16, gap: 8, borderWidth: 1, borderColor: Colors.border },
  heroHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  heroSubtitle: { fontSize: 13, lineHeight: 19, color: Colors.textSecondary },
  card: { backgroundColor: Colors.card, borderRadius: 14, padding: 14, gap: 8, borderWidth: 1, borderColor: Colors.border },
  bannerCard: { backgroundColor: Colors.card, borderRadius: 14, padding: 14, gap: 8, borderWidth: 1 },
  bannerHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bannerTitle: { fontSize: 14, fontWeight: '700' as const },
  bannerBody: { fontSize: 13, lineHeight: 19, color: Colors.textSecondary },
  bannerBtn: { alignSelf: 'flex-start', backgroundColor: Colors.warning, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, marginTop: 4 },
  bannerBtnText: { color: Colors.black, fontWeight: '700' as const, fontSize: 13 },
  statusHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  statusState: { fontSize: 16, fontWeight: '700' as const },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  statusLabel: { fontSize: 13, color: Colors.textTertiary },
  statusValue: { fontSize: 13, color: Colors.text, fontWeight: '600' as const, flexShrink: 1, textAlign: 'right' as const },
  statusNote: { fontSize: 12, lineHeight: 17, color: Colors.textSecondary, marginTop: 4 },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: Colors.primary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  actionBtnDisabled: { opacity: 0.45 },
  actionBtnText: { fontSize: 13, fontWeight: '600' as const, color: Colors.primary },
  actionNote: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },
  cardLabel: { fontSize: 14, fontWeight: '700' as const },
  cardTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  cardHint: { fontSize: 12, lineHeight: 17, color: Colors.textTertiary },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  toggleLabel: { fontSize: 14, color: Colors.text },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 12, marginTop: 4 },
  primaryBtnText: { fontSize: 14, fontWeight: '700' as const, color: Colors.black },
  resultBox: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 4, marginTop: 8 },
  resultLabel: { fontSize: 13, fontWeight: '700' as const },
  resultLine: { fontSize: 12, color: Colors.text },
  resultNote: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17, marginTop: 2 },
  sectionTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.text, marginTop: 6 },
  emptyCard: { backgroundColor: Colors.card, borderRadius: 14, padding: 20, alignItems: 'center', gap: 8, borderWidth: 1, borderColor: Colors.border },
  emptyText: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center' as const, lineHeight: 19 },
  draftCard: { backgroundColor: Colors.card, borderRadius: 12, padding: 12, gap: 3, borderWidth: 1, borderColor: Colors.border },
  draftSubject: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  draftMeta: { fontSize: 12, color: Colors.textTertiary }});
