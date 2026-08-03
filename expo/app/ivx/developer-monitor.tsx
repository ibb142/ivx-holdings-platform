import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
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
  FileCode2,
  GitCommitHorizontal,
  Loader,
  Play,
  Radio,
  Rocket,
  ShieldAlert,
  TerminalSquare} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  getMonitorTaskBlocks,
  getMonitorTaskEvents,
  listMonitorTasks,
  resumeMonitorTask,
  startDailyImprovement,
  type IVXBlockStatus,
  type IVXMonitorBlock,
  type IVXMonitorEvent,
  type IVXMonitorTask} from '@/src/modules/ivx-developer/developerMonitorService';

const POLL_INTERVAL_MS = 3500;

function statusColor(status: IVXBlockStatus | IVXMonitorTask['status']): string {
  switch (status) {
    case 'VERIFIED':
    case 'completed':
      return Colors.success;
    case 'DEPLOYED':
      // DEPLOYED means deploy was triggered, not confirmed. Show as warning
      // unless the block also has verification proof. The block's deploy-status
      // row will surface whether it was actually confirmed.
      return Colors.warning;
    case 'RUNNING':
    case 'running':
      return Colors.info;
    case 'FAILED':
    case 'failed':
      return Colors.error;
    case 'BLOCKED':
    case 'blocked':
      return Colors.warning;
    default:
      return Colors.textSecondary;
  }
}

function MonitorRow({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone?: string }) {
  return (
    <View style={styles.row} testID={`ivx-monitor-row-${label}`}>
      <View style={styles.rowIcon}>{icon}</View>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, tone ? { color: tone } : null]} numberOfLines={3}>
        {value}
      </Text>
    </View>
  );
}

function DeveloperMonitorContent() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ taskId?: string }>();
  const [activeTaskId, setActiveTaskId] = useState<string | null>(
    typeof params.taskId === 'string' && params.taskId.length > 0 ? params.taskId : null,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [starting, setStarting] = useState<boolean>(false);

  const tasksQuery = useQuery({
    queryKey: ['ivx-developer-monitor', 'tasks'],
    queryFn: listMonitorTasks,
    refetchInterval: POLL_INTERVAL_MS});

  // Resolve which task to show: explicit selection, else the most recent task.
  const resolvedTaskId = useMemo<string | null>(() => {
    if (activeTaskId) return activeTaskId;
    const latest = tasksQuery.data?.[0];
    return latest?.id ?? null;
  }, [activeTaskId, tasksQuery.data]);

  const blocksQuery = useQuery({
    queryKey: ['ivx-developer-monitor', 'blocks', resolvedTaskId],
    queryFn: () => getMonitorTaskBlocks(resolvedTaskId as string),
    enabled: !!resolvedTaskId,
    refetchInterval: POLL_INTERVAL_MS});

  const eventsQuery = useQuery({
    queryKey: ['ivx-developer-monitor', 'events', resolvedTaskId],
    queryFn: () => getMonitorTaskEvents(resolvedTaskId as string, 40),
    enabled: !!resolvedTaskId,
    refetchInterval: POLL_INTERVAL_MS});

  const task = blocksQuery.data?.task ?? null;
  const blocks: IVXMonitorBlock[] = blocksQuery.data?.blocks ?? [];
  const events: IVXMonitorEvent[] = eventsQuery.data ?? [];

  const currentBlock = useMemo<IVXMonitorBlock | null>(() => {
    if (blocks.length === 0) return null;
    const running = blocks.find((b) => b.status === 'RUNNING');
    if (running) return running;
    const pending = blocks.find((b) => b.status === 'PENDING' || b.status === 'BLOCKED');
    if (pending) return pending;
    return blocks[blocks.length - 1];
  }, [blocks]);

  const handleStart = useCallback(async () => {
    setStarting(true);
    setActionError(null);
    try {
      const result = await startDailyImprovement();
      if (result.taskId) {
        setActiveTaskId(result.taskId);
      }
      await tasksQuery.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not start the daily improvement loop.');
    } finally {
      setStarting(false);
    }
  }, [tasksQuery]);

  const handleResume = useCallback(async () => {
    if (!resolvedTaskId) return;
    setActionError(null);
    try {
      await resumeMonitorTask(resolvedTaskId);
      await blocksQuery.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not resume the task.');
    }
  }, [resolvedTaskId, blocksQuery]);

  const refreshing = tasksQuery.isFetching || blocksQuery.isFetching;
  const blocker = currentBlock?.blocker ?? task?.error ?? null;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 48 }]}
      refreshControl={
        <RefreshControl
          tintColor={Colors.primary}
          refreshing={refreshing}
          onRefresh={() => {
            void tasksQuery.refetch();
            void blocksQuery.refetch();
            void eventsQuery.refetch();
          }}
        />
      }
      testID="ivx-developer-monitor-scroll"
    >
      <View style={styles.heroCard}>
        <View style={styles.heroHeaderRow}>
          <Activity size={18} color={Colors.primary} />
          <Text style={styles.heroTitle}>Live Developer Monitor</Text>
        </View>
        <Text style={styles.heroSubtitle}>
          IVX building IVX — find issue → patch → test → commit → deploy → verify, with durable, resumable progress.
        </Text>
        <Pressable
          style={[styles.primaryButton, starting ? styles.buttonDisabled : null]}
          onPress={() => { void handleStart(); }}
          disabled={starting}
          testID="ivx-monitor-improve-today"
        >
          {starting ? <ShimmerIndicator size="small" color={Colors.black} /> : <Play size={15} color={Colors.black} />}
          <Text style={styles.primaryButtonText}>{starting ? 'Starting…' : 'Improve IVX today'}</Text>
        </Pressable>
        <Pressable
          style={styles.streamButton}
          onPress={() => router.push(resolvedTaskId ? `/ivx/live-coding-stream?taskId=${resolvedTaskId}` as never : '/ivx/live-coding-stream' as never)}
          testID="ivx-monitor-open-stream"
        >
          <Radio size={14} color={Colors.primary} />
          <Text style={styles.streamButtonText}>Watch live coding stream</Text>
        </Pressable>
        {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}
      </View>

      {!resolvedTaskId ? (
        <View style={styles.emptyCard} testID="ivx-monitor-empty">
          <CircleDashed size={26} color={Colors.textSecondary} />
          <Text style={styles.emptyTitle}>No self-development task yet</Text>
          <Text style={styles.emptyBody}>Tap “Improve IVX today” to start the autonomous loop. Live progress will stream here.</Text>
        </View>
      ) : (
        <>
          <View style={styles.card} testID="ivx-monitor-current-task">
            <View style={styles.cardHeaderRow}>
              <Text style={styles.eyebrow}>Current task</Text>
              {task ? (
                <View style={[styles.statusPill, { borderColor: statusColor(task.status) }]}>
                  <Text style={[styles.statusPillText, { color: statusColor(task.status) }]}>{task.status}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.taskId}>{resolvedTaskId}</Text>
            {task ? (
              <>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${task.progressPercent}%` }]} />
                </View>
                <Text style={styles.progressLabel}>
                  {task.completedBlocks}/{task.totalBlocks} blocks · {task.progressPercent}% · {task.failedBlocks} failed · {task.blockedBlocks} blocked
                </Text>
              </>
            ) : null}
          </View>

          {currentBlock ? (
            <View style={styles.card} testID="ivx-monitor-current-block">
              <View style={styles.cardHeaderRow}>
                <Text style={styles.eyebrow}>Current block</Text>
                <View style={[styles.statusPill, { borderColor: statusColor(currentBlock.status) }]}>
                  <Text style={[styles.statusPillText, { color: statusColor(currentBlock.status) }]}>{currentBlock.status}</Text>
                </View>
              </View>
              <Text style={styles.blockTitle}>{`Block ${currentBlock.index + 1}: ${currentBlock.title}`}</Text>
              <MonitorRow
                icon={<FileCode2 size={14} color={Colors.textSecondary} />}
                label="File"
                value={currentBlock.filesInvolved.length > 0 ? currentBlock.filesInvolved.join(', ') : currentBlock.codeChanges ?? 'inspecting…'}
              />
              <MonitorRow
                icon={<TerminalSquare size={14} color={Colors.textSecondary} />}
                label="Tests"
                value={currentBlock.testResult ?? (currentBlock.validationCommand ?? 'pending')}
                tone={currentBlock.testResult?.toLowerCase().startsWith('passed') ? Colors.success : undefined}
              />
              <MonitorRow
                icon={<GitCommitHorizontal size={14} color={Colors.textSecondary} />}
                label="Commit"
                value={currentBlock.commitHash ?? 'not committed yet'}
              />
              <MonitorRow
                icon={<Rocket size={14} color={Colors.textSecondary} />}
                label="Deploy"
                value={currentBlock.deploymentStatus ?? task?.deploymentStatus ?? 'not deployed yet'}
              />
              <MonitorRow
                icon={<CheckCircle2 size={14} color={Colors.textSecondary} />}
                label="Verified"
                value={
                  currentBlock.verification
                    ? `${currentBlock.verification.ok ? 'PASS' : 'FAIL'} ${currentBlock.verification.endpoint} → HTTP ${currentBlock.verification.httpStatus ?? 'n/a'}${currentBlock.verification.changedRouteOk ? ' · route OK' : ''}`
                    : currentBlock.status === 'VERIFIED'
                      ? 'production verified'
                      : 'awaiting verification'
                }
                tone={
                  currentBlock.verification
                    ? currentBlock.verification.ok ? Colors.success : Colors.error
                    : currentBlock.status === 'VERIFIED' ? Colors.success : undefined
                }
              />
              {currentBlock.verification ? (
                <Text style={styles.verifiedStamp} testID="ivx-monitor-verified-stamp">
                  {`Live app checked ${new Date(currentBlock.verification.verifiedAt).toLocaleString()}`}
                </Text>
              ) : null}
            </View>
          ) : null}

          {blocker ? (
            <View style={[styles.card, styles.blockerCard]} testID="ivx-monitor-blocker">
              <View style={styles.cardHeaderRow}>
                <ShieldAlert size={15} color={Colors.warning} />
                <Text style={[styles.eyebrow, { color: Colors.warning }]}>Blocker</Text>
              </View>
              <Text style={styles.blockerText}>{blocker}</Text>
              <Pressable style={styles.secondaryButton} onPress={() => { void handleResume(); }} testID="ivx-monitor-resume">
                <Loader size={14} color={Colors.text} />
                <Text style={styles.secondaryButtonText}>Resume task</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.card} testID="ivx-monitor-events">
            <Text style={styles.eyebrow}>Live event log</Text>
            {events.length === 0 ? (
              <Text style={styles.emptyBody}>No events yet.</Text>
            ) : (
              [...events].reverse().map((event, index) => (
                <View key={`${event.at}-${index}`} style={styles.eventRow}>
                  <Text style={styles.eventType}>{event.type}</Text>
                  <Text style={styles.eventDetail} numberOfLines={2}>{event.detail}</Text>
                </View>
              ))
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

export default function DeveloperMonitorScreen() {
  return (
    <ErrorBoundary>
      <Stack.Screen options={{ title: 'Developer Monitor' }} />
      <DeveloperMonitorContent />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, gap: 14 },
  heroCard: {
    backgroundColor: Colors.card,
    borderRadius: 18,
    padding: 18,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border},
  heroHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  heroSubtitle: { fontSize: 13, lineHeight: 19, color: Colors.textSecondary },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    paddingVertical: 13,
    borderRadius: 12},
  primaryButtonText: { fontSize: 15, fontWeight: '700' as const, color: Colors.black },
  streamButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.primary,
    paddingVertical: 11,
    borderRadius: 12},
  streamButtonText: { fontSize: 13.5, fontWeight: '700' as const, color: Colors.primary },
  buttonDisabled: { opacity: 0.6 },
  errorText: { fontSize: 12.5, color: Colors.error, lineHeight: 18 },
  emptyCard: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 28,
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.border},
  emptyTitle: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  emptyBody: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', lineHeight: 19 },
  card: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.border},
  blockerCard: { borderColor: Colors.warning },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  eyebrow: { fontSize: 11, fontWeight: '700' as const, letterSpacing: 0.6, textTransform: 'uppercase' as const, color: Colors.textSecondary },
  statusPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  statusPillText: { fontSize: 11, fontWeight: '700' as const, letterSpacing: 0.4 },
  taskId: { fontSize: 12.5, color: Colors.text, fontWeight: '600' as const },
  progressTrack: { height: 8, borderRadius: 999, backgroundColor: Colors.border, overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: 999, backgroundColor: Colors.success },
  progressLabel: { fontSize: 12, color: Colors.textSecondary },
  blockTitle: { fontSize: 14.5, fontWeight: '600' as const, color: Colors.text },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rowIcon: { width: 18, alignItems: 'center', paddingTop: 1 },
  rowLabel: { fontSize: 12.5, color: Colors.textSecondary, width: 64 },
  rowValue: { flex: 1, fontSize: 12.5, color: Colors.text },
  verifiedStamp: { fontSize: 11, color: Colors.textSecondary, fontStyle: 'italic' as const, marginTop: -2 },
  blockerText: { fontSize: 13, color: Colors.text, lineHeight: 19 },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 4},
  secondaryButtonText: { fontSize: 13, fontWeight: '600' as const, color: Colors.text },
  eventRow: { gap: 2, paddingVertical: 5, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  eventType: { fontSize: 11, fontWeight: '700' as const, color: Colors.primary, letterSpacing: 0.3 },
  eventDetail: { fontSize: 12, color: Colors.textSecondary }});
