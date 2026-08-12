import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { Stack, useLocalSearchParams } from 'expo-router';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View} from "react-native";
import {
  CheckCircle2,
  CircleDashed,
  FileCode2,
  Play,
  Radio,
  Rewind,
  Zap} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  getMonitorTaskBlocks,
  getMonitorTaskEvents,
  listMonitorTasks,
  startDailyImprovement,
  type IVXBlockStatus,
  type IVXMonitorBlock,
  type IVXMonitorEvent,
  type IVXMonitorTask} from '@/src/modules/ivx-developer/developerMonitorService';

const POLL_INTERVAL_MS = 2500;
/** Characters revealed per animation tick — the live "typing" speed. */
const CHARS_PER_TICK = 7;
const TYPE_TICK_MS = 16;

function statusColor(status: IVXBlockStatus | IVXMonitorTask['status']): string {
  switch (status) {
    case 'VERIFIED':
    case 'completed':
      return Colors.success;
    case 'DEPLOYED':
      // DEPLOYED means deploy was triggered, not confirmed.
      // Show as warning until the block has verification proof.
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

/** Resolve the real code text for a block: persisted diff first, else the latest CODE_STREAM event. */
function resolveBlockCode(block: IVXMonitorBlock | null, events: IVXMonitorEvent[]): string {
  if (block?.codeDiff && block.codeDiff.trim().length > 0) {
    return block.codeDiff;
  }
  if (block) {
    const streamed = [...events]
      .reverse()
      .find((event) => event.type === 'CODE_STREAM' && event.blockId === block.id);
    if (streamed?.detail) {
      return streamed.detail;
    }
  }
  return '';
}

function lineTone(line: string): string {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('+++') || trimmed.startsWith('---')) return Colors.textTertiary;
  if (trimmed.startsWith('@@')) return Colors.info;
  if (trimmed.startsWith('+')) return Colors.success;
  if (trimmed.startsWith('-')) return Colors.error;
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return Colors.textTertiary;
  return Colors.text;
}

function CodeStream({ code, typing }: { code: string; typing: boolean }) {
  const lines = useMemo<string[]>(() => (code.length > 0 ? code.split('\n') : []), [code]);
  return (
    <View style={styles.codeBody}>
      {lines.map((line, index) => {
        const isLast = index === lines.length - 1;
        return (
          <View key={`line-${index}`} style={styles.codeLineRow}>
            <Text style={styles.gutter}>{String(index + 1).padStart(3, ' ')}</Text>
            <Text style={[styles.codeLine, { color: lineTone(line) }]}>
              {line.length > 0 ? line : ' '}
              {typing && isLast ? <Text style={styles.caret}>▋</Text> : null}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function LiveCodingStreamContent() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ taskId?: string }>();
  const [activeTaskId, setActiveTaskId] = useState<string | null>(
    typeof params.taskId === 'string' && params.taskId.length > 0 ? params.taskId : null,
  );
  const [starting, setStarting] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Index of the block currently being streamed on screen.
  const [streamBlockIndex, setStreamBlockIndex] = useState<number>(0);
  // How many characters of the current block's code are revealed.
  const [revealed, setRevealed] = useState<number>(0);
  const [autoFollow, setAutoFollow] = useState<boolean>(true);

  const scrollRef = useRef<ScrollView | null>(null);
  const fullCodeRef = useRef<string>('');

  const tasksQuery = useQuery({
    queryKey: ['ivx-live-coding', 'tasks'],
    queryFn: listMonitorTasks,
    refetchInterval: POLL_INTERVAL_MS});

  // Realtime: invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);

  const resolvedTaskId = useMemo<string | null>(() => {
    if (activeTaskId) return activeTaskId;
    return tasksQuery.data?.[0]?.id ?? null;
  }, [activeTaskId, tasksQuery.data]);

  const blocksQuery = useQuery({
    queryKey: ['ivx-live-coding', 'blocks', resolvedTaskId],
    queryFn: () => getMonitorTaskBlocks(resolvedTaskId as string),
    enabled: !!resolvedTaskId,
    refetchInterval: POLL_INTERVAL_MS});

  const eventsQuery = useQuery({
    queryKey: ['ivx-live-coding', 'events', resolvedTaskId],
    queryFn: () => getMonitorTaskEvents(resolvedTaskId as string, 120),
    enabled: !!resolvedTaskId,
    refetchInterval: POLL_INTERVAL_MS});

  const task = blocksQuery.data?.task ?? null;
  const blocks: IVXMonitorBlock[] = blocksQuery.data?.blocks ?? [];
  const events: IVXMonitorEvent[] = eventsQuery.data ?? [];

  // Blocks that have real code to stream (in plan order).
  const codedBlocks = useMemo<IVXMonitorBlock[]>(
    () => blocks.filter((block) => resolveBlockCode(block, events).trim().length > 0),
    [blocks, events],
  );

  // When auto-following, jump to the newest block that has code as IVX produces it.
  useEffect(() => {
    if (!autoFollow || codedBlocks.length === 0) return;
    const latestIndex = codedBlocks.length - 1;
    setStreamBlockIndex((prev) => (prev < latestIndex ? latestIndex : prev));
  }, [autoFollow, codedBlocks.length]);

  const currentStreamBlock = codedBlocks[streamBlockIndex] ?? null;
  const currentCode = useMemo<string>(
    () => resolveBlockCode(currentStreamBlock, events),
    [currentStreamBlock, events],
  );

  // Reset the typewriter whenever the streamed block or its code changes.
  useEffect(() => {
    if (fullCodeRef.current !== currentCode) {
      fullCodeRef.current = currentCode;
      setRevealed(0);
    }
  }, [currentCode]);

  // Typewriter: advance the revealed character count over time.
  useEffect(() => {
    if (currentCode.length === 0) return;
    if (revealed >= currentCode.length) return;
    const timer = setInterval(() => {
      setRevealed((prev) => {
        const next = prev + CHARS_PER_TICK;
        if (next >= currentCode.length) {
          clearInterval(timer);
          return currentCode.length;
        }
        return next;
      });
    }, TYPE_TICK_MS);
    return () => clearInterval(timer);
  }, [currentCode, revealed]);

  // Auto-scroll the code view as new characters appear.
  useEffect(() => {
    if (!autoFollow) return;
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [revealed, autoFollow]);

  const typing = revealed < currentCode.length;
  const visibleCode = currentCode.slice(0, revealed);

  const handleStart = useCallback(async () => {
    setStarting(true);
    setActionError(null);
    try {
      const result = await startDailyImprovement();
      if (result.taskId) {
        setActiveTaskId(result.taskId);
        setAutoFollow(true);
        setStreamBlockIndex(0);
      }
      await tasksQuery.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not start the coding loop.');
    } finally {
      setStarting(false);
    }
  }, [tasksQuery]);

  const goPrev = useCallback(() => {
    setAutoFollow(false);
    setStreamBlockIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const goNext = useCallback(() => {
    setStreamBlockIndex((prev) => {
      const next = Math.min(codedBlocks.length - 1, prev + 1);
      if (next === codedBlocks.length - 1) setAutoFollow(true);
      return next;
    });
  }, [codedBlocks.length]);

  const fileLabel = currentStreamBlock
    ? currentStreamBlock.filesInvolved[0] ?? currentStreamBlock.codeChanges ?? 'working…'
    : 'waiting for IVX…';

  return (
    <View style={[styles.screen, { paddingTop: insets.top * 0 }]}>
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Radio size={16} color={Colors.primary} />
          <Text style={styles.headerTitle}>Live Coding Stream</Text>
          {typing ? (
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveBadgeText}>WRITING</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.headerSubtitle}>
          Watch IVX write code character-by-character — from the first block to the last.
        </Text>
      </View>

      {task ? (
        <View style={styles.taskBar}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${task.progressPercent}%` }]} />
          </View>
          <Text style={styles.taskBarText}>
            {task.completedBlocks}/{task.totalBlocks} blocks · {task.progressPercent}% ·{' '}
            <Text style={{ color: statusColor(task.status) }}>{task.status}</Text>
          </Text>
        </View>
      ) : null}

      {!resolvedTaskId || codedBlocks.length === 0 ? (
        <View style={styles.emptyWrap} testID="ivx-stream-empty">
          {tasksQuery.isLoading || blocksQuery.isLoading ? (
            <ShimmerIndicator color={Colors.primary} />
          ) : (
            <CircleDashed size={28} color={Colors.textSecondary} />
          )}
          <Text style={styles.emptyTitle}>
            {resolvedTaskId ? 'Waiting for IVX to start writing…' : 'No coding task running yet'}
          </Text>
          <Text style={styles.emptyBody}>
            Tap “Start a live build” to kick off the autonomous loop. The moment IVX writes code,
            it streams here in real time.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.editorHeader}>
            <FileCode2 size={14} color={Colors.primary} />
            <Text style={styles.editorFile} numberOfLines={1}>
              {fileLabel}
            </Text>
            {currentStreamBlock ? (
              <View style={[styles.statusPill, { borderColor: statusColor(currentStreamBlock.status) }]}>
                <Text style={[styles.statusPillText, { color: statusColor(currentStreamBlock.status) }]}>
                  {currentStreamBlock.status}
                </Text>
              </View>
            ) : null}
          </View>

          <ScrollView
            ref={scrollRef}
            style={styles.editor}
            contentContainerStyle={styles.editorContent}
            onScrollBeginDrag={() => setAutoFollow(false)}
            testID="ivx-stream-editor"
          >
            <CodeStream code={visibleCode} typing={typing} />
          </ScrollView>

          <View style={[styles.controls, { paddingBottom: insets.bottom + 10 }]}>
            <Pressable
              style={[styles.controlButton, streamBlockIndex === 0 ? styles.controlDisabled : null]}
              onPress={goPrev}
              disabled={streamBlockIndex === 0}
              testID="ivx-stream-prev"
            >
              <Rewind size={15} color={Colors.text} />
              <Text style={styles.controlText}>Prev block</Text>
            </Pressable>

            <View style={styles.blockCounter}>
              {currentStreamBlock?.status === 'VERIFIED' ? (
                <CheckCircle2 size={13} color={Colors.success} />
              ) : (
                <Zap size={13} color={Colors.primary} />
              )}
              <Text style={styles.blockCounterText}>
                Block {streamBlockIndex + 1}/{codedBlocks.length}
              </Text>
            </View>

            <Pressable
              style={[
                styles.controlButton,
                streamBlockIndex >= codedBlocks.length - 1 ? styles.controlDisabled : null,
              ]}
              onPress={goNext}
              disabled={streamBlockIndex >= codedBlocks.length - 1}
              testID="ivx-stream-next"
            >
              <Text style={styles.controlText}>Next block</Text>
              <Rewind size={15} color={Colors.text} style={styles.flip} />
            </Pressable>
          </View>
        </>
      )}

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable
          style={[styles.startButton, starting ? styles.controlDisabled : null]}
          onPress={() => { void handleStart(); }}
          disabled={starting}
          testID="ivx-stream-start"
        >
          {starting ? (
            <ShimmerIndicator size="small" color={Colors.black} />
          ) : (
            <Play size={15} color={Colors.black} />
          )}
          <Text style={styles.startButtonText}>{starting ? 'Starting…' : 'Start a live build'}</Text>
        </Pressable>
        {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}
      </View>
    </View>
  );
}

export default function LiveCodingStreamScreen() {
  return (
    <ErrorBoundary>
      <Stack.Screen options={{ title: 'Live Coding Stream' }} />
      <LiveCodingStreamContent />
    </ErrorBoundary>
  );
}

const mono = { fontFamily: 'monospace' as const };

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, gap: 4 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginLeft: 'auto',
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3},
  liveDot: { width: 7, height: 7, borderRadius: 999, backgroundColor: Colors.error },
  liveBadgeText: { fontSize: 10, fontWeight: '800' as const, letterSpacing: 0.6, color: Colors.error },
  headerSubtitle: { fontSize: 12.5, lineHeight: 18, color: Colors.textSecondary },
  taskBar: { paddingHorizontal: 16, paddingVertical: 8, gap: 6 },
  progressTrack: { height: 6, borderRadius: 999, backgroundColor: Colors.border, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 999, backgroundColor: Colors.success },
  taskBarText: { fontSize: 11.5, color: Colors.textSecondary },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32},
  emptyTitle: { fontSize: 15.5, fontWeight: '600' as const, color: Colors.text, textAlign: 'center' },
  emptyBody: { fontSize: 13, lineHeight: 19, color: Colors.textSecondary, textAlign: 'center' },
  editorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: Colors.surfaceElevated,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: Colors.border},
  editorFile: { flex: 1, fontSize: 12.5, color: Colors.text, fontWeight: '600' as const, ...mono },
  statusPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  statusPillText: { fontSize: 10, fontWeight: '700' as const, letterSpacing: 0.4 },
  editor: {
    flex: 1,
    marginHorizontal: 16,
    backgroundColor: '#0B0B0C',
    borderWidth: 1,
    borderColor: Colors.border},
  editorContent: { padding: 12, paddingBottom: 28 },
  codeBody: { gap: 1 },
  codeLineRow: { flexDirection: 'row', alignItems: 'flex-start' },
  gutter: { width: 30, fontSize: 11.5, lineHeight: 18, color: Colors.textTertiary, textAlign: 'right', marginRight: 10, ...mono },
  codeLine: { flex: 1, fontSize: 12, lineHeight: 18, ...mono },
  caret: { color: Colors.primary, fontSize: 12 },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 10},
  controlButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10},
  controlDisabled: { opacity: 0.45 },
  controlText: { fontSize: 12.5, fontWeight: '600' as const, color: Colors.text },
  flip: { transform: [{ scaleX: -1 }] },
  blockCounter: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  blockCounterText: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary },
  footer: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    paddingVertical: 13,
    borderRadius: 12},
  startButtonText: { fontSize: 15, fontWeight: '700' as const, color: Colors.black },
  errorText: { fontSize: 12, color: Colors.error, lineHeight: 18, textAlign: 'center' }});
