import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import * as Haptics from 'expo-haptics';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  FileWarning,
  Heart,
  Pause,
  Play,
  RefreshCw,
  Shield,
  ShieldCheck,
  Target,
  Wrench,
  Zap} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { EmptyState } from '@/components/ivx';
import {
  type QCAuditCycleResult,
  type QCAuditSummary,
  type QCDashboardSnapshot,
  type QCDiagnosticEvent,
  type QCHealAttempt,
  type QCProbeResult,
  type QCRepairTask,
  FLOW_LABELS,
  MODULE_LABELS,
  getDashboardSnapshotAsync,
  runAuditCycle,
  startMonitorDaemon,
  stopMonitorDaemon,
  getDaemonState,
  executeHealAction,
  dismissRepairTask,
  resolveRepairTask} from '@/lib/qc';

type HealthTone = 'healthy' | 'degraded' | 'critical';

interface ToneStyle {
  color: string;
  bg: string;
  border: string;
}

const TONES: Record<HealthTone, ToneStyle> = {
  healthy: { color: '#00C48C', bg: 'rgba(34,197,94,0.10)', border: 'rgba(34,197,94,0.20)' },
  degraded: { color: '#F59E0B', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.22)' },
  critical: { color: '#FF4D4D', bg: 'rgba(239,68,68,0.10)', border: 'rgba(239,68,68,0.22)' }};

function probeStatusToTone(status: string): HealthTone {
  if (status === 'pass') return 'healthy';
  if (status === 'warn') return 'degraded';
  return 'critical';
}

function severityToTone(severity: string): HealthTone {
  if (severity === 'info' || severity === 'warning') return 'degraded';
  if (severity === 'critical' || severity === 'fatal') return 'critical';
  return 'healthy';
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'medium' });
  } catch {
    return iso;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const HealthRing = memo(function HealthRing({ summary, pulseAnim }: { summary: QCAuditSummary; pulseAnim: Animated.Value }) {
  const tone = TONES[summary.overallHealth];
  const total = summary.totalProbes - summary.skipped;
  const passRate = total > 0 ? Math.round((summary.passed / total) * 100) : 0;

  return (
    <View style={styles.ringContainer}>
      <Animated.View style={[styles.ringOuter, { borderColor: tone.border, transform: [{ scale: pulseAnim }] }]}>
        <View style={[styles.ringInner, { backgroundColor: tone.bg, borderColor: tone.border }]}>
          <Text style={[styles.ringPercent, { color: tone.color }]}>{passRate}%</Text>
          <Text style={styles.ringLabel}>healthy</Text>
        </View>
      </Animated.View>
      <View style={styles.ringStats}>
        <View style={styles.ringStat}>
          <View style={[styles.ringDot, { backgroundColor: TONES.healthy.color }]} />
          <Text style={styles.ringStatText}>{summary.passed} pass</Text>
        </View>
        <View style={styles.ringStat}>
          <View style={[styles.ringDot, { backgroundColor: TONES.degraded.color }]} />
          <Text style={styles.ringStatText}>{summary.warned} warn</Text>
        </View>
        <View style={styles.ringStat}>
          <View style={[styles.ringDot, { backgroundColor: TONES.critical.color }]} />
          <Text style={styles.ringStatText}>{summary.failed} fail</Text>
        </View>
        <View style={styles.ringStat}>
          <View style={[styles.ringDot, { backgroundColor: '#555' }]} />
          <Text style={styles.ringStatText}>{summary.skipped} skip</Text>
        </View>
      </View>
    </View>
  );
});

const ProbeRow = memo(function ProbeRow({ probe }: { probe: QCProbeResult }) {
  const tone = TONES[probeStatusToTone(probe.status)];
  const flowLabel = FLOW_LABELS[probe.flow] ?? probe.flow;

  return (
    <View style={[styles.probeRow, { borderLeftColor: tone.color }]} testID={`probe-${probe.probeId}`}>
      <View style={styles.probeTop}>
        <View style={[styles.probeDot, { backgroundColor: tone.color }]} />
        <Text style={styles.probeFlow} numberOfLines={1}>{flowLabel}</Text>
        <Text style={[styles.probeStatus, { color: tone.color }]}>{probe.status.toUpperCase()}</Text>
        <Text style={styles.probeLatency}>{probe.latencyMs}ms</Text>
      </View>
      <Text style={styles.probeMessage} numberOfLines={2}>{probe.message}</Text>
      {probe.details ? <Text style={styles.probeDetails} numberOfLines={1}>{probe.details}</Text> : null}
    </View>
  );
});

const HealRow = memo(function HealRow({ heal }: { heal: QCHealAttempt }) {
  const tone = TONES[heal.success ? 'healthy' : 'critical'];

  return (
    <View style={[styles.healRow, { borderLeftColor: tone.color }]} testID={`heal-${heal.id}`}>
      <View style={styles.healTop}>
        {heal.success ? <CheckCircle size={14} color={tone.color} /> : <AlertTriangle size={14} color={tone.color} />}
        <Text style={styles.healAction}>{heal.action.replace(/-/g, ' ')}</Text>
        <Text style={styles.healDuration}>{formatDuration(heal.durationMs)}</Text>
      </View>
      <Text style={styles.healMessage} numberOfLines={2}>{heal.message}</Text>
    </View>
  );
});

function RepairTaskCard({
  task,
  onDismiss,
  onResolve}: {
  task: QCRepairTask;
  onDismiss: (id: string) => void;
  onResolve: (id: string) => void;
}) {
  const tone = TONES[severityToTone(task.severity)];
  const [expanded, setExpanded] = useState<boolean>(false);

  return (
    <View style={[styles.taskCard, { borderColor: tone.border }]} testID={`task-${task.id}`}>
      <TouchableOpacity style={styles.taskTop} onPress={() => setExpanded(!expanded)} activeOpacity={0.8}>
        <View style={[styles.taskBadge, { backgroundColor: tone.bg, borderColor: tone.border }]}>
          <FileWarning size={16} color={tone.color} />
        </View>
        <View style={styles.taskCopy}>
          <Text style={styles.taskTitle} numberOfLines={2}>{task.title}</Text>
          <Text style={styles.taskMeta}>{task.failureCount} failures · {task.status}</Text>
        </View>
        {expanded ? <ChevronDown size={16} color={Colors.textSecondary} /> : <ChevronRight size={16} color={Colors.textSecondary} />}
      </TouchableOpacity>

      {expanded ? (
        <View style={styles.taskExpanded}>
          <Text style={styles.taskDesc}>{task.description}</Text>

          <View style={styles.taskSection}>
            <Text style={styles.taskSectionLabel}>Suggested fix</Text>
            <Text style={styles.taskSectionValue}>{task.suggestedFix}</Text>
          </View>

          {task.likelyFiles.length > 0 ? (
            <View style={styles.taskSection}>
              <Text style={styles.taskSectionLabel}>Likely files</Text>
              {task.likelyFiles.map((f) => (
                <Text key={f} style={styles.taskFileItem}>• {f}</Text>
              ))}
            </View>
          ) : null}

          <View style={styles.taskActions}>
            <TouchableOpacity style={styles.taskResolveBtn} onPress={() => onResolve(task.id)} activeOpacity={0.8}>
              <CheckCircle size={14} color="#000" />
              <Text style={styles.taskResolveBtnText}>Resolve</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.taskDismissBtn} onPress={() => onDismiss(task.id)} activeOpacity={0.8}>
              <Text style={styles.taskDismissBtnText}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const DiagnosticRow = memo(function DiagnosticRow({ event }: { event: QCDiagnosticEvent }) {
  const tone = TONES[severityToTone(event.severity)];

  return (
    <View style={[styles.diagRow, { borderLeftColor: tone.color }]}>
      <View style={styles.diagTop}>
        <Text style={[styles.diagSeverity, { color: tone.color }]}>{event.severity.toUpperCase()}</Text>
        <Text style={styles.diagFlow}>{FLOW_LABELS[event.flow] ?? event.flow}</Text>
      </View>
      <Text style={styles.diagTitle} numberOfLines={1}>{event.title}</Text>
      <Text style={styles.diagSummary} numberOfLines={2}>{event.summary}</Text>
      <Text style={styles.diagTime}>{formatTime(event.timestamp)}</Text>
    </View>
  );
});

export default function QualityControlScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const queryClient = useQueryClient();
  const pulseAnim = useRef(new Animated.Value(0.92)).current;
  const [isMonitoring, setIsMonitoring] = useState<boolean>(() => getDaemonState() === 'running');

  const snapshotQuery = useQuery<QCDashboardSnapshot>({
    queryKey: ['qc', 'dashboard'],
    queryFn: () => getDashboardSnapshotAsync(),
    staleTime: 30_000,
    refetchInterval: isMonitoring ? 60_000 : false,
    refetchOnWindowFocus: false});

  const runCycleMutation = useMutation<QCAuditCycleResult, Error>({
    mutationFn: async () => runAuditCycle(),
    onSuccess: async () => {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await snapshotQuery.refetch();
    },
    onError: (err) => {
      Alert.alert('Cycle failed', err.message);
    }});

  const toggleMonitoring = useCallback(() => {
    if (isMonitoring) {
      stopMonitorDaemon();
      setIsMonitoring(false);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } else {
      startMonitorDaemon();
      setIsMonitoring(true);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [isMonitoring]);

  const handleDismissTask = useCallback(async (id: string) => {
    await dismissRepairTask(id);
    await snapshotQuery.refetch();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [snapshotQuery]);

  const handleResolveTask = useCallback(async (id: string) => {
    await resolveRepairTask(id);
    await snapshotQuery.refetch();
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [snapshotQuery]);

  const handleRefresh = useCallback(async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    runCycleMutation.mutate();
  }, [runCycleMutation]);

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 1600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.92, duration: 1600, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [pulseAnim]);

  const snapshot = snapshotQuery.data;
  const lastCycle = snapshot?.lastCycleResult ?? null;
  const summary = lastCycle?.summary ?? null;
  const overallTone = TONES[summary?.overallHealth ?? 'degraded'];

  const failedProbes = useMemo(() => {
    return (lastCycle?.probeResults ?? []).filter((p) => p.status === 'fail' || p.status === 'warn');
  }, [lastCycle?.probeResults]);

  const passedProbes = useMemo(() => {
    return (lastCycle?.probeResults ?? []).filter((p) => p.status === 'pass');
  }, [lastCycle?.probeResults]);

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.8} testID="qc-back">
            <ArrowLeft size={20} color={Colors.text} />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text style={styles.headerTitle}>Quality Control</Text>
            <Text style={styles.headerSub}>Always-on monitoring & auto-repair</Text>
          </View>
          <TouchableOpacity onPress={toggleMonitoring} style={[styles.monitorBtn, isMonitoring && styles.monitorBtnActive]} activeOpacity={0.8} testID="qc-toggle-monitor">
            {isMonitoring ? <Pause size={16} color="#000" /> : <Play size={16} color={Colors.primary} />}
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={runCycleMutation.isPending} onRefresh={handleRefresh} tintColor={Colors.primary} />
          }
        >
          <View style={[styles.heroCard, { borderColor: overallTone.border }]}>
            <View style={styles.heroRow}>
              <Animated.View style={[styles.heroOrb, { backgroundColor: overallTone.bg, borderColor: overallTone.border, transform: [{ scale: pulseAnim }] }]}>
                <ShieldCheck size={28} color={overallTone.color} />
              </Animated.View>
              <View style={styles.heroCopy}>
                <View style={[styles.heroBadge, { backgroundColor: overallTone.bg, borderColor: overallTone.border }]}>
                  <View style={[styles.heroDot, { backgroundColor: overallTone.color }]} />
                  <Text style={[styles.heroBadgeText, { color: overallTone.color }]}>
                    {isMonitoring ? 'MONITORING' : summary?.overallHealth?.toUpperCase() ?? 'IDLE'}
                  </Text>
                </View>
                <Text style={styles.heroTitle}>
                  {summary ? `${summary.passed}/${summary.totalProbes - summary.skipped} flows healthy` : 'Run a cycle to start'}
                </Text>
                <Text style={styles.heroBody}>
                  {isMonitoring
                    ? `Continuous audits every ${Math.round((snapshot?.cycleIntervalMs ?? 120000) / 1000)}s`
                    : 'Start monitoring or run a manual audit cycle'}
                </Text>
              </View>
            </View>

            <View style={styles.safetyBanner}>
              <Shield size={14} color={Colors.primary} />
              <Text style={styles.safetyText}>
                Auto-heals safe runtime issues only. Code changes, deployments, and destructive fixes require human approval.
              </Text>
            </View>

            <View style={styles.heroActions}>
              <TouchableOpacity
                style={[styles.primaryBtn, runCycleMutation.isPending && styles.disabledBtn]}
                onPress={handleRefresh}
                activeOpacity={0.85}
                disabled={runCycleMutation.isPending}
                testID="qc-run-cycle"
              >
                {runCycleMutation.isPending ? <ShimmerIndicator size="small" color="#000" /> : <Zap size={16} color="#000" />}
                <Text style={styles.primaryBtnText}>Run audit cycle</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={toggleMonitoring}
                activeOpacity={0.85}
                testID="qc-toggle-monitor-2"
              >
                {isMonitoring ? <Pause size={16} color={Colors.text} /> : <Activity size={16} color={Colors.text} />}
                <Text style={styles.secondaryBtnText}>{isMonitoring ? 'Pause' : 'Start'} monitor</Text>
              </TouchableOpacity>
            </View>
          </View>

          {snapshotQuery.isLoading && !snapshot ? (
            <View style={styles.loadingCard}>
              <ShimmerIndicator size="large" color={Colors.primary} />
              <Text style={styles.loadingText}>Loading QC dashboard...</Text>
            </View>
          ) : null}

          {summary ? (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Target size={16} color={Colors.primary} />
                <Text style={styles.sectionTitle}>Health overview</Text>
                {lastCycle ? <Text style={styles.sectionMeta}>{formatDuration(lastCycle.durationMs)}</Text> : null}
              </View>
              <HealthRing summary={summary} pulseAnim={pulseAnim} />

              {summary.healsAttempted > 0 ? (
                <View style={styles.healSummaryRow}>
                  <Heart size={14} color={TONES.healthy.color} />
                  <Text style={styles.healSummaryText}>
                    {summary.healsSucceeded}/{summary.healsAttempted} auto-heals succeeded
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {failedProbes.length > 0 ? (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <AlertTriangle size={16} color={TONES.critical.color} />
                <Text style={styles.sectionTitle}>Issues detected</Text>
                <Text style={[styles.sectionMeta, { color: TONES.critical.color }]}>{failedProbes.length}</Text>
              </View>
              {failedProbes.map((p) => <ProbeRow key={p.probeId} probe={p} />)}
            </View>
          ) : null}

          {passedProbes.length > 0 ? (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <CheckCircle size={16} color={TONES.healthy.color} />
                <Text style={styles.sectionTitle}>Healthy flows</Text>
                <Text style={[styles.sectionMeta, { color: TONES.healthy.color }]}>{passedProbes.length}</Text>
              </View>
              {passedProbes.map((p) => <ProbeRow key={p.probeId} probe={p} />)}
            </View>
          ) : null}

          {(snapshot?.openRepairTasks ?? []).length > 0 ? (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Wrench size={16} color={Colors.primary} />
                <Text style={styles.sectionTitle}>Repair tasks</Text>
                <Text style={styles.sectionMeta}>{snapshot?.openRepairTasks.length}</Text>
              </View>
              {(snapshot?.openRepairTasks ?? []).map((task) => (
                <RepairTaskCard key={task.id} task={task} onDismiss={handleDismissTask} onResolve={handleResolveTask} />
              ))}
            </View>
          ) : null}

          {(lastCycle?.healAttempts ?? []).length > 0 ? (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Heart size={16} color={Colors.primary} />
                <Text style={styles.sectionTitle}>Recent auto-heals</Text>
              </View>
              {(lastCycle?.healAttempts ?? []).map((h) => <HealRow key={h.id} heal={h} />)}
            </View>
          ) : null}

          {(snapshot?.recentDiagnosticEvents ?? []).length > 0 ? (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Clock size={16} color={Colors.primary} />
                <Text style={styles.sectionTitle}>Diagnostic log</Text>
                <Text style={styles.sectionMeta}>{snapshot?.recentDiagnosticEvents.length}</Text>
              </View>
              {(snapshot?.recentDiagnosticEvents ?? []).slice(0, 10).map((evt) => (
                <DiagnosticRow key={evt.id} event={evt} />
              ))}
            </View>
          ) : null}

          {lastCycle ? (
            <View style={styles.footer}>
              <Text style={styles.footerText}>Last cycle: {formatTime(lastCycle.completedAt)}</Text>
              {snapshot?.nextCycleAt ? <Text style={styles.footerText}>Next: {formatTime(snapshot.nextCycleAt)}</Text> : null}
            </View>
          ) : null}

          <View style={styles.spacer} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#040607' },
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  backBtn: { width: 42, height: 42, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  headerCopy: { flex: 1 },
  headerTitle: { color: Colors.text, fontSize: 18, fontWeight: '800' as const, letterSpacing: -0.3 },
  headerSub: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },
  monitorBtn: { width: 42, height: 42, borderRadius: 14, backgroundColor: 'rgba(255,215,0,0.10)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,215,0,0.20)' },
  monitorBtnActive: { backgroundColor: Colors.primary },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 44 },
  heroCard: { backgroundColor: '#0A0E10', borderRadius: 24, padding: 20, marginBottom: 20, borderWidth: 1, overflow: 'hidden' },
  heroRow: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  heroOrb: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  heroCopy: { flex: 1, gap: 8 },
  heroBadge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1 },
  heroDot: { width: 6, height: 6, borderRadius: 3 },
  heroBadgeText: { fontSize: 10, fontWeight: '800' as const, textTransform: 'uppercase' as const, letterSpacing: 0.8 },
  heroTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' as const, letterSpacing: -0.4 },
  heroBody: { color: Colors.textSecondary, fontSize: 13, lineHeight: 19 },
  safetyBanner: { marginTop: 16, flexDirection: 'row', gap: 10, alignItems: 'flex-start', borderRadius: 16, padding: 12, backgroundColor: 'rgba(255,215,0,0.06)', borderWidth: 1, borderColor: 'rgba(255,215,0,0.14)' },
  safetyText: { flex: 1, color: Colors.textSecondary, fontSize: 12, lineHeight: 18 },
  heroActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  primaryBtn: { flex: 1, minHeight: 46, borderRadius: 14, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  primaryBtnText: { color: '#000', fontSize: 14, fontWeight: '800' as const },
  secondaryBtn: { flex: 1, minHeight: 46, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  secondaryBtnText: { color: Colors.text, fontSize: 14, fontWeight: '700' as const },
  disabledBtn: { opacity: 0.6 },
  loadingCard: { backgroundColor: '#0A0E10', borderRadius: 20, padding: 24, alignItems: 'center', gap: 10, marginBottom: 20 },
  loadingText: { color: Colors.textSecondary, fontSize: 14, fontWeight: '600' as const },
  section: { marginBottom: 22 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sectionTitle: { flex: 1, color: Colors.text, fontSize: 15, fontWeight: '800' as const, letterSpacing: -0.2 },
  sectionMeta: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700' as const },
  ringContainer: { backgroundColor: '#0A0E10', borderRadius: 20, padding: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', alignItems: 'center', gap: 16 },
  ringOuter: { width: 120, height: 120, borderRadius: 60, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  ringInner: { width: 100, height: 100, borderRadius: 50, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  ringPercent: { fontSize: 28, fontWeight: '900' as const, letterSpacing: -1 },
  ringLabel: { color: Colors.textTertiary, fontSize: 11, fontWeight: '600' as const, marginTop: -2 },
  ringStats: { flexDirection: 'row', gap: 16, flexWrap: 'wrap', justifyContent: 'center' },
  ringStat: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ringDot: { width: 8, height: 8, borderRadius: 4 },
  ringStatText: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' as const },
  healSummaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingHorizontal: 4 },
  healSummaryText: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' as const },
  probeRow: { backgroundColor: '#0A0E10', borderRadius: 14, padding: 12, marginBottom: 8, borderLeftWidth: 3 },
  probeTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  probeDot: { width: 6, height: 6, borderRadius: 3 },
  probeFlow: { flex: 1, color: Colors.text, fontSize: 13, fontWeight: '700' as const },
  probeStatus: { fontSize: 10, fontWeight: '800' as const, letterSpacing: 0.5 },
  probeLatency: { color: Colors.textTertiary, fontSize: 11 },
  probeMessage: { color: Colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 6 },
  probeDetails: { color: Colors.textTertiary, fontSize: 11, marginTop: 4 },
  healRow: { backgroundColor: '#0A0E10', borderRadius: 14, padding: 12, marginBottom: 8, borderLeftWidth: 3 },
  healTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  healAction: { flex: 1, color: Colors.text, fontSize: 13, fontWeight: '700' as const, textTransform: 'capitalize' as const },
  healDuration: { color: Colors.textTertiary, fontSize: 11 },
  healMessage: { color: Colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 6 },
  taskCard: { backgroundColor: '#0A0E10', borderRadius: 18, borderWidth: 1, marginBottom: 10, overflow: 'hidden' },
  taskTop: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  taskBadge: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  taskCopy: { flex: 1 },
  taskTitle: { color: Colors.text, fontSize: 14, fontWeight: '700' as const },
  taskMeta: { color: Colors.textTertiary, fontSize: 11, marginTop: 2 },
  taskExpanded: { paddingHorizontal: 14, paddingBottom: 14, gap: 12 },
  taskDesc: { color: Colors.textSecondary, fontSize: 13, lineHeight: 19 },
  taskSection: { gap: 4 },
  taskSectionLabel: { color: Colors.textTertiary, fontSize: 11, fontWeight: '700' as const, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  taskSectionValue: { color: Colors.textSecondary, fontSize: 13, lineHeight: 19 },
  taskFileItem: { color: Colors.textSecondary, fontSize: 12, fontFamily: 'monospace' },
  taskActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  taskResolveBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  taskResolveBtnText: { color: '#000', fontSize: 13, fontWeight: '800' as const },
  taskDismissBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  taskDismissBtnText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '700' as const },
  diagRow: { backgroundColor: '#0A0E10', borderRadius: 12, padding: 10, marginBottom: 6, borderLeftWidth: 3 },
  diagTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  diagSeverity: { fontSize: 9, fontWeight: '800' as const, letterSpacing: 0.6 },
  diagFlow: { flex: 1, color: Colors.textTertiary, fontSize: 11 },
  diagTitle: { color: Colors.text, fontSize: 12, fontWeight: '700' as const, marginTop: 4 },
  diagSummary: { color: Colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 2 },
  diagTime: { color: Colors.textTertiary, fontSize: 10, marginTop: 4 },
  footer: { alignItems: 'center', gap: 4, paddingVertical: 16 },
  footerText: { color: Colors.textTertiary, fontSize: 11 },
  spacer: { height: 24 }});
