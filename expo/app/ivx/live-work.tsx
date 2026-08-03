import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View} from "react-native";
import {
  Activity,
  CheckCircle2,
  CircleDashed,
  Database,
  GitCommitHorizontal,
  Loader,
  Radar,
  Rocket,
  ShieldAlert,
  TerminalSquare,
  XCircle} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  getLiveWorkFeed,
  runSupabaseCheck,
  type AgentRun,
  type LiveWorkLogEntry,
  type LiveWorkSnapshot,
  type SupabaseCheckResult,
  type SupabaseCheckStage} from '@/src/modules/ivx-developer/liveWorkService';

const POLL_INTERVAL_MS = 3000;

function levelColor(level: LiveWorkLogEntry['level']): string {
  switch (level) {
    case 'success': return Colors.success;
    case 'error': return Colors.error;
    case 'running': return Colors.info;
    default: return Colors.textSecondary;
  }
}

/**
 * Canonical IVX task-state machine surfaced on Live Work.
 * Maps any backend status string to a stable color + label so the owner
 * sees real states (QUEUED / RUNNING / WAITING_APPROVAL / RETRYING / FAILED / COMPLETED)
 * instead of a generic running/idle placeholder.
 */
function taskStateColor(status: string): string {
  switch (status.toLowerCase()) {
    case 'queued': return Colors.warning;
    case 'running': return Colors.info;
    case 'waiting_approval': return Colors.gold;
    case 'retrying': return Colors.warning;
    case 'failed': return Colors.error;
    case 'completed': return Colors.success;
    default: return Colors.textSecondary;
  }
}

function taskStateLabel(status: string): string {
  return status.replace(/[-\s]+/g, '_').toUpperCase();
}

function agentStatusColor(status: AgentRun['status']): string {
  switch (status) {
    case 'completed': return Colors.success;
    case 'failed': return Colors.error;
    default: return Colors.info;
  }
}

function stageColor(status: SupabaseCheckStage['status']): string {
  switch (status) {
    case 'ok': return Colors.success;
    case 'failed': return Colors.error;
    default: return Colors.textSecondary;
  }
}

function formatClock(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}

function relativeEta(iso: string): string {
  try {
    const diff = new Date(iso).getTime() - Date.now();
    if (diff <= 0) return 'finishing…';
    const secs = Math.round(diff / 1000);
    if (secs < 60) return `~${secs}s left`;
    return `~${Math.round(secs / 60)}m left`;
  } catch {
    return '';
  }
}

function LiveWorkContent() {
  const insets = useSafeAreaInsets();
  const [check, setCheck] = useState<SupabaseCheckResult | null>(null);
  const [checking, setChecking] = useState<boolean>(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  const feedQuery = useQuery({
    queryKey: ['ivx-live-work', 'feed'],
    queryFn: () => getLiveWorkFeed(60),
    refetchInterval: POLL_INTERVAL_MS});

  const snapshot: LiveWorkSnapshot | undefined = feedQuery.data;
  const currentTask = snapshot?.currentTask ?? null;
  const activeAgents = snapshot?.activeAgents ?? [];
  const recentAgents = snapshot?.recentAgents ?? [];
  const liveLogs = snapshot?.liveLogs ?? [];
  const proofOutput = snapshot?.proofOutput ?? [];
  const recentCompleted = snapshot?.recentCompletedTasks ?? [];
  const counts = snapshot?.counts ?? { activeTasks: 0, activeAgents: 0, completedTasks: 0, failedTasks: 0 };

  const handleCheckSupabase = useCallback(async () => {
    setChecking(true);
    setCheckError(null);
    try {
      const result = await runSupabaseCheck();
      setCheck(result);
      await feedQuery.refetch();
    } catch (error) {
      setCheckError(error instanceof Error ? error.message : 'Supabase check failed.');
    } finally {
      setChecking(false);
    }
  }, [feedQuery]);

  const headline = useMemo<string>(() => snapshot?.summary ?? 'Loading live work…', [snapshot]);

  // Allow the chat "Check Supabase" action to deep-link here and auto-stream the
  // staged diagnostic immediately (router.push('/ivx/live-work?run=supabase')).
  const params = useLocalSearchParams<{ run?: string }>();
  const autoRanRef = useRef<boolean>(false);
  useEffect(() => {
    if (!autoRanRef.current && params.run === 'supabase') {
      autoRanRef.current = true;
      void handleCheckSupabase();
    }
  }, [params.run, handleCheckSupabase]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 48 }]}
      refreshControl={
        <RefreshControl tintColor={Colors.primary} refreshing={feedQuery.isFetching} onRefresh={() => { void feedQuery.refetch(); }} />
      }
      testID="ivx-live-work-scroll"
    >
      <View style={styles.heroCard}>
        <View style={styles.heroHeaderRow}>
          <Activity size={18} color={Colors.primary} />
          <Text style={styles.heroTitle}>Live Work</Text>
          <View style={styles.livePill}>
            <View style={styles.liveDot} />
            <Text style={styles.livePillText}>LIVE</Text>
          </View>
        </View>
        <Text style={styles.heroSubtitle}>{headline}</Text>
        <View style={styles.countRow}>
          <CountChip label="Active tasks" value={counts.activeTasks} tone={Colors.info} />
          <CountChip label="Agents live" value={counts.activeAgents} tone={Colors.primary} />
          <CountChip label="Completed" value={counts.completedTasks} tone={Colors.success} />
          <CountChip label="Failed" value={counts.failedTasks} tone={counts.failedTasks > 0 ? Colors.error : Colors.textSecondary} />
        </View>
      </View>

      {feedQuery.error ? (
        <View style={[styles.card, styles.blockerCard]} testID="ivx-live-work-error">
          <Text style={styles.blockerText}>{feedQuery.error instanceof Error ? feedQuery.error.message : 'Could not load live work.'}</Text>
        </View>
      ) : null}

      {/* Current task + module + percent */}
      <View style={styles.card} testID="ivx-live-work-current-task">
        <Text style={styles.eyebrow}>Current task</Text>
        {currentTask ? (
          <>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.taskTitle} numberOfLines={2}>{currentTask.title}</Text>
              <View style={[styles.statusPill, { borderColor: taskStateColor(currentTask.status) }]}>
                <Text style={[styles.statusPillText, { color: taskStateColor(currentTask.status) }]}>{taskStateLabel(currentTask.status)}</Text>
              </View>
            </View>
            <Text style={styles.moduleLabel}>Current module</Text>
            <Text style={styles.moduleValue}>{currentTask.currentModule}</Text>
            <Text style={styles.moduleDetail} numberOfLines={3}>{currentTask.currentModuleDetail}</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${currentTask.progressPercent}%` }]} />
            </View>
            <Text style={styles.progressLabel}>
              {currentTask.completedBlocks}/{currentTask.totalBlocks} blocks · {currentTask.progressPercent}% · {currentTask.failedBlocks} failed · {currentTask.blockedBlocks} blocked
            </Text>
            {currentTask.blocker ? (
              <View style={styles.inlineBlocker}>
                <ShieldAlert size={13} color={Colors.warning} />
                <Text style={styles.inlineBlockerText} numberOfLines={3}>{currentTask.blocker}</Text>
              </View>
            ) : null}
          </>
        ) : (
          <View style={styles.emptyInline}>
            <CircleDashed size={20} color={Colors.textSecondary} />
            <Text style={styles.emptyBody}>No task is actively running right now.</Text>
          </View>
        )}
      </View>

      {/* Background agent live queue */}
      <View style={styles.card} testID="ivx-live-work-agents">
        <View style={styles.cardHeaderRow}>
          <Text style={styles.eyebrow}>Background agents</Text>
          <Text style={styles.countBadge}>{activeAgents.length} live</Text>
        </View>
        {recentAgents.length === 0 ? (
          <Text style={styles.emptyBody}>No background agents have run yet. Run a scan or “Check Supabase”.</Text>
        ) : (
          recentAgents.map((agent) => (
            <View key={agent.id} style={styles.agentRow} testID={`ivx-live-work-agent-${agent.id}`}>
              <View style={styles.agentTopRow}>
                <View style={[styles.agentDot, { backgroundColor: agentStatusColor(agent.status) }]} />
                <Text style={styles.agentLabel}>{agent.label}</Text>
                <Text style={[styles.agentStatus, { color: agentStatusColor(agent.status) }]}>
                  {agent.status === 'running' ? relativeEta(agent.expectedCompletionAt) || 'running' : agent.status}
                </Text>
              </View>
              <Text style={styles.agentWhy} numberOfLines={2}>{agent.why}</Text>
              <Text style={styles.agentDetail} numberOfLines={2}>
                {agent.status === 'running' ? agent.detail : agent.status === 'completed' ? (agent.proof ?? 'Completed.') : (agent.error ?? 'Failed.')}
              </Text>
            </View>
          ))
        )}
      </View>

      {/* Check Supabase — staged diagnostic (acceptance test) */}
      <View style={styles.card} testID="ivx-live-work-supabase">
        <View style={styles.cardHeaderRow}>
          <View style={styles.rowCenter}>
            <Database size={15} color={Colors.primary} />
            <Text style={[styles.eyebrow, { marginLeft: 6 }]}>Check Supabase</Text>
          </View>
          <Pressable
            style={[styles.primaryButton, checking ? styles.buttonDisabled : null]}
            onPress={() => { void handleCheckSupabase(); }}
            disabled={checking}
            testID="ivx-live-work-check-supabase"
          >
            {checking ? <ShimmerIndicator size="small" color={Colors.black} /> : <Radar size={14} color={Colors.black} />}
            <Text style={styles.primaryButtonText}>{checking ? 'Streaming…' : 'Check Supabase'}</Text>
          </Pressable>
        </View>
        {checkError ? <Text style={styles.errorText}>{checkError}</Text> : null}
        {check ? (
          <>
            <Text style={[styles.checkSummary, { color: check.ok ? Colors.success : Colors.error }]}>{check.summary}</Text>
            {check.stages.map((stage) => (
              <View key={stage.name} style={styles.stageRow} testID={`ivx-live-work-stage-${stage.name}`}>
                <View style={styles.stageIcon}>
                  {stage.status === 'ok' ? (
                    <CheckCircle2 size={15} color={Colors.success} />
                  ) : stage.status === 'failed' ? (
                    <XCircle size={15} color={Colors.error} />
                  ) : (
                    <CircleDashed size={15} color={Colors.textSecondary} />
                  )}
                </View>
                <View style={styles.stageCopy}>
                  <View style={styles.stageTopRow}>
                    <Text style={styles.stageTitle}>{stage.title}</Text>
                    <Text style={[styles.stageStatus, { color: stageColor(stage.status) }]}>
                      {stage.status}{stage.httpStatus ? ` · ${stage.httpStatus}` : ''} · {stage.durationMs}ms
                    </Text>
                  </View>
                  <Text style={styles.stageDetail} numberOfLines={3}>{stage.detail}</Text>
                </View>
              </View>
            ))}
          </>
        ) : (
          <Text style={styles.emptyBody}>Tap “Check Supabase” to stream connection → authentication → query → response → verification → completion.</Text>
        )}
      </View>

      {/* Proof output */}
      {proofOutput.length > 0 ? (
        <View style={styles.card} testID="ivx-live-work-proof">
          <Text style={styles.eyebrow}>Proof output</Text>
          {proofOutput.map((item) => (
            <View key={item.label} style={styles.proofRow}>
              <View style={styles.proofIcon}>
                {item.label.toLowerCase().includes('commit') ? (
                  <GitCommitHorizontal size={14} color={item.ok ? Colors.success : Colors.textSecondary} />
                ) : item.label.toLowerCase().includes('deploy') ? (
                  <Rocket size={14} color={item.ok ? Colors.success : Colors.textSecondary} />
                ) : (
                  <CheckCircle2 size={14} color={item.ok ? Colors.success : Colors.textSecondary} />
                )}
              </View>
              <Text style={styles.proofLabel}>{item.label}</Text>
              <Text style={[styles.proofValue, item.ok ? { color: Colors.success } : null]} numberOfLines={2}>{item.value}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* Live logs */}
      <View style={styles.card} testID="ivx-live-work-logs">
        <View style={styles.cardHeaderRow}>
          <View style={styles.rowCenter}>
            <TerminalSquare size={15} color={Colors.textSecondary} />
            <Text style={[styles.eyebrow, { marginLeft: 6 }]}>Live logs</Text>
          </View>
        </View>
        {liveLogs.length === 0 ? (
          <Text style={styles.emptyBody}>No log entries yet.</Text>
        ) : (
          liveLogs.map((log, index) => (
            <View key={`${log.at}-${index}`} style={styles.logRow}>
              <View style={[styles.logDot, { backgroundColor: levelColor(log.level) }]} />
              <View style={styles.logCopy}>
                <View style={styles.logTopRow}>
                  <Text style={styles.logChannel}>{log.channel}</Text>
                  <Text style={styles.logTime}>{formatClock(log.at)}</Text>
                </View>
                <Text style={styles.logMessage} numberOfLines={3}>{log.message}</Text>
              </View>
            </View>
          ))
        )}
      </View>

      {/* Recent completed tasks */}
      <View style={styles.card} testID="ivx-live-work-completed">
        <Text style={styles.eyebrow}>Recent completed tasks</Text>
        {recentCompleted.length === 0 ? (
          <Text style={styles.emptyBody}>No completed tasks yet.</Text>
        ) : (
          recentCompleted.map((task) => (
            <View key={task.id} style={styles.completedRow}>
              {task.status === 'completed' ? (
                <CheckCircle2 size={14} color={Colors.success} />
              ) : task.status === 'failed' ? (
                <XCircle size={14} color={Colors.error} />
              ) : (
                <CircleDashed size={14} color={Colors.textSecondary} />
              )}
              <Text style={styles.completedTitle} numberOfLines={1}>{task.title}</Text>
              <View style={[styles.completedStatePill, { borderColor: taskStateColor(task.status) }]}>
                <Text style={[styles.completedStateText, { color: taskStateColor(task.status) }]}>{taskStateLabel(task.status)}</Text>
              </View>
              <Text style={styles.completedMeta}>{task.completedBlocks}/{task.totalBlocks}</Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

function CountChip({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <View style={styles.countChip}>
      <Text style={[styles.countChipValue, { color: tone }]}>{value}</Text>
      <Text style={styles.countChipLabel}>{label}</Text>
    </View>
  );
}

export default function LiveWorkScreen() {
  return (
    <ErrorBoundary>
      <Stack.Screen options={{ title: 'Live Work' }} />
      <LiveWorkContent />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, gap: 14 },
  heroCard: { backgroundColor: Colors.card, borderRadius: 18, padding: 18, gap: 12, borderWidth: 1, borderColor: Colors.border },
  heroHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text, flex: 1 },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: Colors.success, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  liveDot: { width: 7, height: 7, borderRadius: 999, backgroundColor: Colors.success },
  livePillText: { fontSize: 10, fontWeight: '800' as const, letterSpacing: 0.6, color: Colors.success },
  heroSubtitle: { fontSize: 13, lineHeight: 19, color: Colors.textSecondary },
  countRow: { flexDirection: 'row', gap: 8 },
  countChip: { flex: 1, backgroundColor: Colors.background, borderRadius: 12, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  countChipValue: { fontSize: 18, fontWeight: '800' as const },
  countChipLabel: { fontSize: 10, color: Colors.textSecondary, marginTop: 2, textAlign: 'center' },
  card: { backgroundColor: Colors.card, borderRadius: 16, padding: 16, gap: 10, borderWidth: 1, borderColor: Colors.border },
  blockerCard: { borderColor: Colors.warning },
  blockerText: { fontSize: 13, color: Colors.text, lineHeight: 19 },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  rowCenter: { flexDirection: 'row', alignItems: 'center' },
  eyebrow: { fontSize: 11, fontWeight: '700' as const, letterSpacing: 0.6, textTransform: 'uppercase' as const, color: Colors.textSecondary },
  countBadge: { fontSize: 11, fontWeight: '700' as const, color: Colors.primary },
  taskTitle: { flex: 1, fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  statusPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  statusPillText: { fontSize: 10, fontWeight: '700' as const, letterSpacing: 0.4 },
  moduleLabel: { fontSize: 10.5, fontWeight: '700' as const, letterSpacing: 0.5, textTransform: 'uppercase' as const, color: Colors.textSecondary, marginTop: 2 },
  moduleValue: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  moduleDetail: { fontSize: 12.5, color: Colors.textSecondary, lineHeight: 18 },
  progressTrack: { height: 8, borderRadius: 999, backgroundColor: Colors.border, overflow: 'hidden', marginTop: 4 },
  progressFill: { height: 8, borderRadius: 999, backgroundColor: Colors.success },
  progressLabel: { fontSize: 12, color: Colors.textSecondary },
  inlineBlocker: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 4 },
  inlineBlockerText: { flex: 1, fontSize: 12.5, color: Colors.warning, lineHeight: 18 },
  emptyInline: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  emptyBody: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19, flex: 1 },
  agentRow: { gap: 4, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  agentTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  agentDot: { width: 8, height: 8, borderRadius: 999 },
  agentLabel: { flex: 1, fontSize: 13.5, fontWeight: '600' as const, color: Colors.text },
  agentStatus: { fontSize: 11, fontWeight: '700' as const },
  agentWhy: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },
  agentDetail: { fontSize: 12, color: Colors.text, lineHeight: 17 },
  primaryButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: Colors.primary, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 10 },
  primaryButtonText: { fontSize: 13, fontWeight: '700' as const, color: Colors.black },
  buttonDisabled: { opacity: 0.6 },
  errorText: { fontSize: 12.5, color: Colors.error, lineHeight: 18 },
  checkSummary: { fontSize: 13, fontWeight: '600' as const, lineHeight: 18 },
  stageRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  stageIcon: { width: 18, alignItems: 'center', paddingTop: 1 },
  stageCopy: { flex: 1, gap: 2 },
  stageTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  stageTitle: { fontSize: 13.5, fontWeight: '600' as const, color: Colors.text },
  stageStatus: { fontSize: 10.5, fontWeight: '700' as const },
  stageDetail: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },
  proofRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 4 },
  proofIcon: { width: 18, alignItems: 'center', paddingTop: 1 },
  proofLabel: { fontSize: 12.5, color: Colors.textSecondary, width: 96 },
  proofValue: { flex: 1, fontSize: 12.5, color: Colors.text },
  logRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 5, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  logDot: { width: 7, height: 7, borderRadius: 999, marginTop: 5 },
  logCopy: { flex: 1, gap: 2 },
  logTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  logChannel: { fontSize: 10.5, fontWeight: '700' as const, color: Colors.primary, letterSpacing: 0.3 },
  logTime: { fontSize: 10.5, color: Colors.textSecondary },
  logMessage: { fontSize: 12, color: Colors.text, lineHeight: 17 },
  completedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  completedTitle: { flex: 1, fontSize: 13, color: Colors.text },
  completedStatePill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  completedStateText: { fontSize: 9.5, fontWeight: '700' as const, letterSpacing: 0.3 },
  completedMeta: { fontSize: 12, color: Colors.textSecondary }});
