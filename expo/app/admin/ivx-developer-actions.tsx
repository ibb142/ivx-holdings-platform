import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Cpu,
  Database,
  FileCode,
  GitBranch,
  GitPullRequestArrow,
  History,
  Lock,
  Play,
  Rocket,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  XCircle} from 'lucide-react-native';
import Colors from '@/constants/colors';
import {
  BLOCK21_APPROVED_ACTIONS_MARKER,
  type ApprovedAction,
  type ApprovedActionKind,
  type AuditLogEntry,
  approveAction,
  classifySupabaseSql,
  deleteApprovedAction,
  executeApprovedAction,
  listApprovedActions,
  listAuditEntries,
  proposeAction,
  rejectAction} from '@/src/modules/ivx-developer/developerApprovedActionsService';
import { listPatches, type PatchProposal } from '@/src/modules/ivx-developer/developerWorkspaceService';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

const OWNER_LABEL = 'owner' as const;
const SUPABASE_DOUBLE_CONFIRM_PHRASE = 'I CONFIRM DESTRUCTIVE SQL';

type TabId = 'queue' | 'propose' | 'audit';
type ProposeMode = 'github_commit' | 'supabase_sql' | 'render_deploy';

const KIND_LABEL: Record<ApprovedActionKind, string> = {
  file_patch: 'File Patch',
  github_commit: 'GitHub Commit',
  supabase_sql: 'Supabase SQL',
  render_deploy: 'Render Deploy'};

const KIND_ICON: Record<ApprovedActionKind, React.ComponentType<{ size?: number; color?: string }>> = {
  file_patch: FileCode,
  github_commit: GitBranch,
  supabase_sql: Database,
  render_deploy: Rocket};

const STATUS_COLOR: Record<ApprovedAction['status'], string> = {
  proposed: Colors.warning,
  approved: Colors.blue,
  executing: Colors.blue,
  executed: Colors.green,
  failed: Colors.error,
  rejected: Colors.textTertiary};

export default function IVXDeveloperActionsScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>('queue');
  const [actions, setActions] = useState<ApprovedAction[]>([]);
  const [audit, setAudit] = useState<AuditLogEntry[]>([]);
  const [patches, setPatches] = useState<PatchProposal[]>([]);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [executingId, setExecutingId] = useState<string | null>(null);

  // Propose form state
  const [proposeMode, setProposeMode] = useState<ProposeMode>('github_commit');
  const [reason, setReason] = useState<string>('');
  const [commitMessage, setCommitMessage] = useState<string>('');
  const [commitFiles, setCommitFiles] = useState<string>('');
  const [sqlInput, setSqlInput] = useState<string>('');
  const [deployClearCache, setDeployClearCache] = useState<boolean>(true);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [a, l, p] = await Promise.all([
        listApprovedActions(),
        listAuditEntries(),
        listPatches(),
      ]);
      setActions(a);
      setAudit(l);
      setPatches(p);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sqlClassification = useMemo(() => {
    if (!sqlInput.trim()) return null;
    return classifySupabaseSql(sqlInput);
  }, [sqlInput]);

  const onPropose = useCallback(async () => {
    if (!reason.trim()) {
      Alert.alert('Reason required', 'Add a short reason so the audit log captures intent.');
      return;
    }
    try {
      if (proposeMode === 'github_commit') {
        const files = commitFiles
          .split(/[\n,]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (!commitMessage.trim() || files.length === 0) {
          Alert.alert('Commit details required', 'Add a commit message and at least one file path.');
          return;
        }
        const approvedPatches = patches.filter((p) => p.status === 'approved');
        await proposeAction({
          kind: 'github_commit',
          commitMessage: commitMessage.trim(),
          files,
          patchIds: approvedPatches.map((p) => p.id),
          reason: reason.trim()});
      } else if (proposeMode === 'supabase_sql') {
        if (!sqlInput.trim()) {
          Alert.alert('SQL required', 'Paste the SQL to be reviewed before approval.');
          return;
        }
        await proposeAction({
          kind: 'supabase_sql',
          sql: sqlInput,
          returnRows: false,
          reason: reason.trim()});
      } else {
        await proposeAction({
          kind: 'render_deploy',
          clearCache: deployClearCache,
          reason: reason.trim()});
      }
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      }
      setReason('');
      setCommitMessage('');
      setCommitFiles('');
      setSqlInput('');
      await refresh();
      setTab('queue');
    } catch (err) {
      Alert.alert('Proposal blocked', (err as Error)?.message ?? 'Could not propose action.');
    }
  }, [proposeMode, reason, commitMessage, commitFiles, sqlInput, deployClearCache, patches, refresh]);

  const onApprove = useCallback(
    async (action: ApprovedAction) => {
      if (action.doubleConfirmRequired) {
        await new Promise<void>((resolve) => {
          Alert.prompt(
            'Destructive action — double confirm',
            `Type exactly:\n${SUPABASE_DOUBLE_CONFIRM_PHRASE}\n\nThis is required for DROP / DELETE / TRUNCATE.`,
            [
              { text: 'Cancel', style: 'cancel', onPress: () => resolve() },
              {
                text: 'Confirm',
                style: 'destructive',
                onPress: async (typed?: string) => {
                  if (typed?.trim() === SUPABASE_DOUBLE_CONFIRM_PHRASE) {
                    await approveAction(action.id, { approver: OWNER_LABEL, doubleConfirmed: true });
                    await refresh();
                  } else {
                    Alert.alert('Phrase mismatch', 'Approval not granted. Audit logged.');
                    await approveAction(action.id, { approver: OWNER_LABEL, doubleConfirmed: false });
                  }
                  resolve();
                }},
            ],
            'plain-text',
          );
        });
        return;
      }
      const ok = await new Promise<boolean>((resolve) => {
        Alert.alert(
          'Approve action?',
          `${KIND_LABEL[action.kind]}\n${action.title}\n\nApproval is logged and required before execute.`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Approve', onPress: () => resolve(true) },
          ],
        );
      });
      if (!ok) return;
      await approveAction(action.id, { approver: OWNER_LABEL });
      await refresh();
    },
    [refresh],
  );

  const onReject = useCallback(
    async (action: ApprovedAction) => {
      await rejectAction(action.id, OWNER_LABEL);
      await refresh();
    },
    [refresh],
  );

  const onExecute = useCallback(
    async (action: ApprovedAction) => {
      const ok = await new Promise<boolean>((resolve) => {
        Alert.alert(
          'Execute approved action?',
          `${KIND_LABEL[action.kind]}\n${action.title}\n\nThis runs the owner-authenticated backend call now.`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Execute', style: 'destructive', onPress: () => resolve(true) },
          ],
        );
      });
      if (!ok) return;
      setExecutingId(action.id);
      try {
        const result = await executeApprovedAction(action.id);
        await refresh();
        if (result?.result?.ok) {
          Alert.alert('Executed', result.result.summary);
        } else {
          Alert.alert(
            'Execution failed',
            result?.result?.summary ?? result?.result?.detail ?? 'Action failed. See audit log.',
          );
        }
      } catch (err) {
        Alert.alert('Execution error', (err as Error)?.message ?? 'Could not execute action.');
      } finally {
        setExecutingId(null);
      }
    },
    [refresh],
  );

  const onDelete = useCallback(
    async (action: ApprovedAction) => {
      Alert.alert('Delete action?', `${KIND_LABEL[action.kind]}\n${action.title}`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteApprovedAction(action.id);
            await refresh();
          }},
      ]);
    },
    [refresh],
  );

  const renderAction = (action: ApprovedAction) => {
    const Icon = KIND_ICON[action.kind];
    const isExec = executingId === action.id;
    return (
      <View key={action.id} style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={[styles.statusDot, { backgroundColor: STATUS_COLOR[action.status] }]} />
          <Text style={styles.statusLabel}>{action.status.toUpperCase()}</Text>
          <View style={styles.kindPill}>
            <Icon size={11} color={Colors.green} />
            <Text style={styles.kindPillText}>{KIND_LABEL[action.kind]}</Text>
          </View>
          {action.destructive ? (
            <View style={styles.destructivePill}>
              <AlertTriangle size={10} color={Colors.error} />
              <Text style={styles.destructivePillText}>destructive</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.cardTitle}>{action.title}</Text>
        <Text style={styles.cardReason}>{action.reason}</Text>
        {action.affected.length > 0 ? (
          <View style={styles.tagRow}>
            {action.affected.slice(0, 6).map((f) => (
              <View key={f} style={styles.tagPill}>
                <Text style={styles.tagText}>{f}</Text>
              </View>
            ))}
          </View>
        ) : null}
        <View style={styles.previewBox}>
          <Text style={styles.previewText} numberOfLines={10} selectable>
            {action.preview}
          </Text>
        </View>
        {action.approver ? (
          <Text style={styles.metaText}>
            approver: {action.approver}
            {action.approvedAt ? ` · ${new Date(action.approvedAt).toLocaleString()}` : ''}
            {action.doubleConfirmed ? ' · double-confirmed' : ''}
          </Text>
        ) : null}
        {action.result ? (
          <View
            style={[
              styles.resultBox,
              { borderColor: action.result.ok ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)' },
            ]}
          >
            <Text style={styles.resultTitle}>
              {action.result.ok ? 'EXECUTED' : 'FAILED'} · HTTP {action.result.httpStatus}
            </Text>
            <Text style={styles.resultBody}>{action.result.summary}</Text>
            {action.result.detail ? <Text style={styles.resultDetail}>{action.result.detail}</Text> : null}
            {action.result.postCheck ? (
              <Text style={styles.resultDetail}>
                health={action.result.postCheck.healthHttp ?? '—'} · chat=
                {action.result.postCheck.publicChatHttp ?? '—'} · source=
                {action.result.postCheck.publicChatSource ?? '—'}
              </Text>
            ) : null}
          </View>
        ) : null}
        <View style={styles.actionRow}>
          {action.status === 'proposed' ? (
            <>
              <Pressable
                onPress={() => onApprove(action)}
                style={[styles.actionBtn, styles.actionBtnPrimary]}
                testID={`block21-approve-${action.id}`}
              >
                <CheckCircle2 size={12} color={Colors.background} />
                <Text style={styles.actionBtnTextDark}>Approve</Text>
              </Pressable>
              <Pressable onPress={() => onReject(action)} style={styles.actionBtn}>
                <Text style={styles.actionBtnText}>Reject</Text>
              </Pressable>
            </>
          ) : null}
          {action.status === 'approved' ? (
            <Pressable
              onPress={() => onExecute(action)}
              style={[styles.actionBtn, styles.actionBtnPrimary]}
              disabled={isExec}
              testID={`block21-execute-${action.id}`}
            >
              {isExec ? (
                <ShimmerIndicator size="small" color={Colors.background} />
              ) : (
                <Play size={12} color={Colors.background} />
              )}
              <Text style={styles.actionBtnTextDark}>{isExec ? 'Executing…' : 'Execute'}</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={() => onDelete(action)} style={styles.actionBtn}>
            <Trash2 size={11} color={Colors.error} />
            <Text style={[styles.actionBtnText, { color: Colors.error }]}>Delete</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <ArrowLeft size={20} color={Colors.text} />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <View style={styles.headerTitleRow}>
            <ShieldCheck size={16} color={Colors.green} />
            <Text style={styles.headerTitle}>Approved Developer Actions</Text>
          </View>
          <Text style={styles.headerSub}>owner-gated · audited · non-autonomous</Text>
        </View>
        <View style={styles.headerBadge}>
          <Cpu size={12} color={Colors.green} />
          <Text style={styles.headerBadgeText}>BLOCK 21</Text>
        </View>
      </View>

      <View style={styles.tabBar}>
        {(
          [
            { id: 'queue' as const, label: 'Queue', icon: ClipboardList },
            { id: 'propose' as const, label: 'Propose', icon: GitPullRequestArrow },
            { id: 'audit' as const, label: 'Audit', icon: History },
          ]
        ).map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <Pressable
              key={t.id}
              onPress={() => setTab(t.id)}
              style={[styles.tabItem, active && styles.tabItemActive]}
              testID={`block21-tab-${t.id}`}
            >
              <Icon size={13} color={active ? Colors.green : Colors.textTertiary} />
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {tab === 'queue' && (
            <View style={styles.gap}>
              <View style={styles.heroCard}>
                <View style={styles.heroLine}>
                  <Lock size={14} color={Colors.green} />
                  <Text style={styles.heroPrompt}>nothing runs without approval</Text>
                </View>
                <Text style={styles.heroText}>
                  IVX IA proposes — owner approves — backend executes. Diffs, SQL, commits, and
                  deploys are previewed. DROP/DELETE/TRUNCATE require a typed double-confirm.
                </Text>
              </View>

              <View style={styles.rowBetween}>
                <Text style={styles.sectionLabel}>Pending & recent ({actions.length})</Text>
                <Pressable onPress={refresh} style={styles.smallBtn} testID="block21-refresh">
                  <Text style={styles.smallBtnText}>{refreshing ? 'Refreshing…' : 'Refresh'}</Text>
                </Pressable>
              </View>

              {actions.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyText}>
                    No pending actions yet. Use the Propose tab to add a GitHub commit, Supabase
                    SQL, or Render deploy for owner approval.
                  </Text>
                </View>
              ) : (
                actions.map(renderAction)
              )}
            </View>
          )}

          {tab === 'propose' && (
            <View style={styles.gap}>
              <Text style={styles.sectionLabel}>Action kind</Text>
              <View style={styles.kindRow}>
                {(
                  [
                    { id: 'github_commit' as const, label: 'GitHub Commit', icon: GitBranch },
                    { id: 'supabase_sql' as const, label: 'Supabase SQL', icon: Database },
                    { id: 'render_deploy' as const, label: 'Render Deploy', icon: Rocket },
                  ]
                ).map((m) => {
                  const Icon = m.icon;
                  const active = m.id === proposeMode;
                  return (
                    <Pressable
                      key={m.id}
                      onPress={() => setProposeMode(m.id)}
                      style={[styles.kindCard, active && styles.kindCardActive]}
                      testID={`block21-mode-${m.id}`}
                    >
                      <Icon size={14} color={active ? Colors.green : Colors.textTertiary} />
                      <Text style={[styles.kindCardLabel, active && styles.kindCardLabelActive]}>
                        {m.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.sectionLabel}>Reason (audit)</Text>
              <TextInput
                value={reason}
                onChangeText={setReason}
                placeholder="Why is this change needed?"
                placeholderTextColor={Colors.textTertiary}
                style={styles.input}
                testID="block21-reason"
                autoCorrect={false}
              />

              {proposeMode === 'github_commit' && (
                <>
                  <Text style={styles.sectionLabel}>Commit message</Text>
                  <TextInput
                    value={commitMessage}
                    onChangeText={setCommitMessage}
                    placeholder="feat: brief summary"
                    placeholderTextColor={Colors.textTertiary}
                    style={styles.input}
                    testID="block21-commit-message"
                  />
                  <Text style={styles.sectionLabel}>Files (comma or newline separated)</Text>
                  <TextInput
                    value={commitFiles}
                    onChangeText={setCommitFiles}
                    placeholder="expo/app/foo.tsx, backend/api/bar.ts"
                    placeholderTextColor={Colors.textTertiary}
                    style={[styles.input, styles.inputMultiline]}
                    multiline
                    autoCapitalize="none"
                    autoCorrect={false}
                    testID="block21-commit-files"
                  />
                  <Text style={styles.metaText}>
                    Approved patches in the queue will be linked automatically:{' '}
                    {patches.filter((p) => p.status === 'approved').length}
                  </Text>
                </>
              )}

              {proposeMode === 'supabase_sql' && (
                <>
                  <Text style={styles.sectionLabel}>SQL preview</Text>
                  <TextInput
                    value={sqlInput}
                    onChangeText={setSqlInput}
                    placeholder="-- paste safe migration SQL here"
                    placeholderTextColor={Colors.textTertiary}
                    style={[styles.input, styles.inputSql]}
                    multiline
                    autoCapitalize="none"
                    autoCorrect={false}
                    testID="block21-sql"
                  />
                  {sqlClassification ? (
                    <View
                      style={[
                        styles.safetyBanner,
                        sqlClassification.destructive && styles.safetyBannerDanger,
                      ]}
                    >
                      <ShieldAlert
                        size={12}
                        color={sqlClassification.destructive ? Colors.error : Colors.warning}
                      />
                      <Text style={styles.safetyText} numberOfLines={3}>
                        {sqlClassification.destructive
                          ? 'Destructive SQL detected (DROP / DELETE / TRUNCATE). Double-confirm required at approve time.'
                          : 'No destructive pattern detected.'}
                        {sqlClassification.findings.length > 0
                          ? ` · findings: ${sqlClassification.findings.map((f) => `${f.kind}:${f.name}`).join(', ')}`
                          : ''}
                      </Text>
                    </View>
                  ) : null}
                </>
              )}

              {proposeMode === 'render_deploy' && (
                <>
                  <Text style={styles.sectionLabel}>Render service</Text>
                  <View style={styles.staticBox}>
                    <Text style={styles.staticBoxText}>ivx-holdings-platform</Text>
                  </View>
                  <Pressable
                    onPress={() => setDeployClearCache((v) => !v)}
                    style={[styles.toggleRow, deployClearCache && styles.toggleRowActive]}
                    testID="block21-clear-cache"
                  >
                    <View
                      style={[styles.toggleDot, deployClearCache && styles.toggleDotActive]}
                    />
                    <Text style={styles.toggleText}>
                      {deployClearCache ? 'Clear build cache (recommended)' : 'Reuse build cache'}
                    </Text>
                  </Pressable>
                  <Text style={styles.metaText}>
                    Post-deploy verification will probe /health and /api/public/chat for
                    source=&quot;chatgpt&quot;.
                  </Text>
                </>
              )}

              <Pressable
                onPress={onPropose}
                style={styles.proposeBtn}
                testID="block21-propose-submit"
              >
                <GitPullRequestArrow size={14} color={Colors.background} />
                <Text style={styles.proposeBtnText}>Propose for owner approval</Text>
              </Pressable>
            </View>
          )}

          {tab === 'audit' && (
            <View style={styles.gap}>
              <View style={styles.heroCard}>
                <View style={styles.heroLine}>
                  <History size={14} color={Colors.green} />
                  <Text style={styles.heroPrompt}>append-only audit log</Text>
                </View>
                <Text style={styles.heroText}>
                  Every proposal, approval, rejection, execution, and safety block is recorded with
                  approver, action type, files/routes affected, timestamp, and result.
                </Text>
              </View>
              {audit.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyText}>No audit entries yet.</Text>
                </View>
              ) : (
                audit.slice(0, 60).map((entry) => (
                  <View key={entry.id} style={styles.auditRow}>
                    <View
                      style={[
                        styles.auditDot,
                        {
                          backgroundColor:
                            entry.result === 'success'
                              ? Colors.green
                              : entry.result === 'failed' || entry.result === 'blocked'
                              ? Colors.error
                              : Colors.warning},
                      ]}
                    />
                    <View style={styles.auditMain}>
                      <View style={styles.auditHead}>
                        <Text style={styles.auditEvent}>{entry.event}</Text>
                        <Text style={styles.auditKind}>{KIND_LABEL[entry.kind]}</Text>
                        <Text style={styles.auditTime}>
                          {new Date(entry.at).toLocaleString()}
                        </Text>
                      </View>
                      <Text style={styles.auditDetail} numberOfLines={3}>
                        {entry.detail}
                      </Text>
                      <Text style={styles.auditMeta} numberOfLines={1}>
                        {entry.approver ? `approver: ${entry.approver} · ` : ''}
                        {entry.affected.length > 0 ? entry.affected.join(', ') : 'no files'}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </View>
          )}

          <Text style={styles.footerNote}>block: {BLOCK21_APPROVED_ACTIONS_MARKER}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  gap: { gap: 12 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: '#0A0F0A'},
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border},
  headerTitleWrap: { flex: 1 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, letterSpacing: 0.2 },
  headerSub: {
    color: Colors.textSecondary,
    fontSize: 11,
    marginTop: 2,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })},
  headerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.35)',
    backgroundColor: 'rgba(34,197,94,0.08)'},
  headerBadgeText: { color: Colors.green, fontSize: 10, fontWeight: '700' as const, letterSpacing: 0.6 },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: '#080C08'},
  tabItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border},
  tabItemActive: { backgroundColor: 'rgba(34,197,94,0.06)', borderColor: 'rgba(34,197,94,0.4)' },
  tabLabel: { color: Colors.textTertiary, fontSize: 11, fontWeight: '600' as const },
  tabLabelActive: { color: Colors.green },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 64, gap: 12 },
  heroCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(34,197,94,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.25)',
    gap: 6},
  heroLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroPrompt: {
    color: Colors.green,
    fontSize: 12,
    fontWeight: '700' as const,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })},
  heroText: { color: Colors.textSecondary, fontSize: 12, lineHeight: 17 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionLabel: {
    color: Colors.textSecondary,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: 4},
  smallBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border},
  smallBtnText: { color: Colors.green, fontSize: 11, fontWeight: '600' as const },
  emptyCard: {
    padding: 18,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderStyle: 'dashed' as const,
    borderColor: Colors.border},
  emptyText: { color: Colors.textTertiary, fontSize: 12, lineHeight: 17 },
  card: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8},
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { color: Colors.text, fontSize: 10, fontWeight: '700' as const, letterSpacing: 0.8 },
  kindPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: 'rgba(34,197,94,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.25)'},
  kindPillText: { color: Colors.green, fontSize: 10, fontWeight: '600' as const },
  destructivePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.35)'},
  destructivePillText: { color: Colors.error, fontSize: 10, fontWeight: '700' as const },
  cardTitle: { color: Colors.text, fontSize: 13, fontWeight: '600' as const },
  cardReason: { color: Colors.textSecondary, fontSize: 12, lineHeight: 17 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 4 },
  tagPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: Colors.border},
  tagText: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })},
  previewBox: {
    padding: 8,
    borderRadius: 6,
    backgroundColor: '#06090A',
    borderWidth: 1,
    borderColor: Colors.border},
  previewText: {
    color: Colors.text,
    fontSize: 11,
    lineHeight: 15,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })},
  metaText: { color: Colors.textTertiary, fontSize: 10 },
  resultBox: {
    padding: 8,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderWidth: 1,
    gap: 4},
  resultTitle: { color: Colors.text, fontSize: 11, fontWeight: '700' as const, letterSpacing: 0.6 },
  resultBody: { color: Colors.textSecondary, fontSize: 11 },
  resultDetail: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })},
  actionRow: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 6 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border},
  actionBtnPrimary: {
    backgroundColor: Colors.green,
    borderColor: Colors.green},
  actionBtnText: { color: Colors.green, fontSize: 11, fontWeight: '600' as const },
  actionBtnTextDark: { color: Colors.background, fontSize: 11, fontWeight: '700' as const },
  kindRow: { flexDirection: 'row', gap: 6 },
  kindCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 10,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border},
  kindCardActive: { borderColor: 'rgba(34,197,94,0.5)', backgroundColor: 'rgba(34,197,94,0.06)' },
  kindCardLabel: { color: Colors.textTertiary, fontSize: 11, fontWeight: '600' as const },
  kindCardLabelActive: { color: Colors.green },
  input: {
    color: Colors.text,
    fontSize: 13,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10},
  inputMultiline: { minHeight: 70, textAlignVertical: 'top' as const },
  inputSql: {
    minHeight: 160,
    textAlignVertical: 'top' as const,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 12},
  safetyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 8,
    borderRadius: 6,
    backgroundColor: 'rgba(245,158,11,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.3)'},
  safetyBannerDanger: {
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderColor: 'rgba(239,68,68,0.4)'},
  safetyText: { color: Colors.textSecondary, fontSize: 11, flex: 1, lineHeight: 15 },
  staticBox: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border},
  staticBoxText: {
    color: Colors.text,
    fontSize: 13,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })},
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border},
  toggleRowActive: { borderColor: 'rgba(34,197,94,0.4)', backgroundColor: 'rgba(34,197,94,0.06)' },
  toggleDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: Colors.textTertiary},
  toggleDotActive: { borderColor: Colors.green, backgroundColor: Colors.green },
  toggleText: { color: Colors.text, fontSize: 12 },
  proposeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: Colors.green},
  proposeBtnText: { color: Colors.background, fontSize: 13, fontWeight: '700' as const },
  auditRow: {
    flexDirection: 'row',
    gap: 8,
    padding: 10,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border},
  auditDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  auditMain: { flex: 1, gap: 3 },
  auditHead: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 6, alignItems: 'center' },
  auditEvent: { color: Colors.green, fontSize: 11, fontWeight: '700' as const, letterSpacing: 0.5 },
  auditKind: { color: Colors.text, fontSize: 11, fontWeight: '600' as const },
  auditTime: { color: Colors.textTertiary, fontSize: 10 },
  auditDetail: { color: Colors.textSecondary, fontSize: 11, lineHeight: 15 },
  auditMeta: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })},
  footerNote: {
    color: Colors.textTertiary,
    fontSize: 10,
    textAlign: 'center' as const,
    marginTop: 12,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })}});
