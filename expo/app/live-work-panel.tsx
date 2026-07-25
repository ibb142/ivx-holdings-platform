/**
 * IVX Live Work Panel — live execution view showing actual AI work in progress.
 *
 * Reads REAL production data:
 *   GET /api/ivx/live-work/feed      (current task, active agents, recent logs)
 *   GET /api/ivx/engineering-os/tasks (all engineering tasks with evidence)
 *   GET /api/ivx/engineering-os/status (pipeline counts)
 *
 * No fake progress percentages — every entry traces to a live task or agent.
 * Owner-only: requires IVX owner bearer token.
 * Auto-refreshes every 15s (faster than other dashboards for live work) + pull-to-refresh.
 */
import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  Cpu,
  FileCode,
  GitBranch,
  Layers,
  Lock,
  RefreshCw,
  Terminal,
  X,
  Zap,
} from 'lucide-react-native';
import { getIVXAccessToken } from '@/lib/ivx-supabase-client';
import { TEAM_NAMES } from '@/lib/ivx-module-registry';

const API_BASE = (process.env.EXPO_PUBLIC_IVX_API_BASE_URL || 'https://api.ivxholding.com').replace(/\/+$/, '');
const LIVE_WORK_URL = `${API_BASE}/api/ivx/live-work/feed`;
const TASKS_URL = `${API_BASE}/api/ivx/engineering-os/tasks`;
const STATUS_URL = `${API_BASE}/api/ivx/engineering-os/status`;
const POLL_INTERVAL_MS = 15_000;

type LiveTask = {
  taskId: string;
  title: string;
  status: string;
  team?: string;
  module?: string;
  file?: string;
  command?: string;
  elapsedMs?: number;
  checkpoint?: string;
  nextCheckpoint?: string;
  retryCount?: number;
  branch?: string;
  commitSha?: string;
  deployStatus?: string;
};

type LiveAgent = {
  agentId: string;
  name?: string;
  task?: string;
  status?: string;
};

type LiveLog = {
  at: string;
  level: string;
  message: string;
  taskId?: string;
};

type LiveProofOutput = {
  taskId: string;
  output: string;
  status: string;
};

type LiveCompletedTask = {
  taskId: string;
  title: string;
  status: string;
  completedAt?: string;
};

type LiveWorkSnapshot = {
  marker?: string;
  generatedAt?: string;
  currentTask?: LiveTask | null;
  activeAgents?: LiveAgent[];
  recentAgents?: LiveAgent[];
  liveLogs?: LiveLog[];
  proofOutput?: LiveProofOutput[];
  recentCompletedTasks?: LiveCompletedTask[];
  counts?: {
    activeTasks: number;
    activeAgents: number;
    completedTasks: number;
    failedTasks: number;
  };
  summary?: string;
};

type LiveWorkResponse = { ok: boolean; snapshot?: LiveWorkSnapshot };

type TaskEntry = {
  id: string;
  title: string;
  detail?: string;
  team_id: string;
  stage: string;
  status: string;
  owner_approved: boolean;
  owner_approved_by?: string;
  owner_approved_at?: string;
  evidence?: {
    commitSha?: string;
    testResults?: string;
    deployId?: string;
    healthVerified?: boolean;
  };
};

type TasksResponse = { status: string; tasks?: TaskEntry[] };

type EngineeringCounts = {
  total: number;
  queued: number;
  running: number;
  waitingApproval: number;
  retrying: number;
  verified: number;
  failed: number;
  blocked: number;
};

type EngineeringStatus = {
  status: string;
  marker?: string;
  counts?: EngineeringCounts;
};

const STATUS_COLOR = (status: string): string => {
  const s = status.toUpperCase();
  if (s === 'VERIFIED' || s === 'COMPLETED' || s === 'OK') return '#34D399';
  if (s === 'FAILED' || s === 'BLOCKED') return '#F87171';
  if (s === 'RUNNING' || s === 'RETRYING') return '#FBBF24';
  if (s === 'QUEUED' || s === 'WAITING_APPROVAL') return '#94A3B8';
  return '#94A3B8';
};

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return `${d.toISOString().slice(11, 19)}Z`;
  } catch {
    return iso;
  }
}

function formatFull(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}Z`;
  } catch {
    return iso;
  }
}

function formatDuration(ms: number | undefined): string {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m${s}s`;
}

export default function LiveWorkPanelScreen() {
  const router = useRouter();
  const [liveWork, setLiveWork] = useState<LiveWorkSnapshot | null>(null);
  const [tasks, setTasks] = useState<TaskEntry[]>([]);
  const [status, setStatus] = useState<EngineeringStatus | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isUnauthorized, setIsUnauthorized] = useState<boolean>(false);
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskEntry | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = useCallback(async (silent: boolean) => {
    if (!silent) setIsLoading(true);
    setErrorMessage(null);
    try {
      const token = await getIVXAccessToken();
      if (!token) {
        setIsUnauthorized(true);
        setErrorMessage('Owner session required. Sign in as the owner to view the Live Work panel.');
        return;
      }
      const headers = { Authorization: `Bearer ${token}` };
      const [liveRes, tasksRes, statusRes] = await Promise.all([
        fetch(LIVE_WORK_URL, { headers }),
        fetch(TASKS_URL, { headers }),
        fetch(STATUS_URL, { headers }),
      ]);
      if (liveRes.status === 401 || liveRes.status === 403) {
        setIsUnauthorized(true);
        setErrorMessage('Access denied: this panel is restricted to the IVX owner.');
        return;
      }
      if (liveRes.ok) {
        const json = (await liveRes.json()) as LiveWorkResponse;
        setLiveWork(json.snapshot ?? null);
      }
      if (tasksRes.ok) {
        const json = (await tasksRes.json()) as TasksResponse;
        setTasks(json.tasks ?? []);
      }
      if (statusRes.ok) {
        const json = (await statusRes.json()) as EngineeringStatus;
        setStatus(json);
      }
      setIsUnauthorized(false);
      setLastFetchedAt(new Date().toISOString());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error loading live work.';
      console.log('[LiveWorkPanel] fetch failed:', message);
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchAll(false);
    pollRef.current = setInterval(() => fetchAll(true), POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchAll]);

  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    fetchAll(true);
  }, [fetchAll]);

  const counts = liveWork?.counts;
  const engCounts = status?.counts;
  const sortedTasks = useMemo(() => {
    const order: Record<string, number> = {
      RUNNING: 0,
      RETRYING: 1,
      WAITING_APPROVAL: 2,
      QUEUED: 3,
      BLOCKED: 4,
      FAILED: 5,
      VERIFIED: 6,
    };
    return [...tasks].sort((a, b) => {
      const sa = order[a.status] ?? 9;
      const sb = order[b.status] ?? 9;
      if (sa !== sb) return sa - sb;
      return a.id.localeCompare(b.id);
    });
  }, [tasks]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} testID="live-work-back">
          <ArrowLeft size={22} color="#E2E8F0" />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>IVX Live Work Panel</Text>
          <Text style={styles.headerSubtitle}>
            {formatTime(lastFetchedAt)} · auto-refresh 15s
          </Text>
        </View>
        <TouchableOpacity onPress={onRefresh} style={styles.refreshButton} testID="live-work-refresh">
          <RefreshCw size={18} color="#FBBF24" />
        </TouchableOpacity>
      </View>

      <View style={styles.navRow}>
        <TouchableOpacity style={styles.navChip} onPress={() => router.push('/module-command-center')}>
          <Layers size={14} color="#60A5FA" />
          <Text style={styles.navChipText}>Modules</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navChip} onPress={() => router.push('/autonomous-engineering-calendar')}>
          <Calendar size={14} color="#60A5FA" />
          <Text style={styles.navChipText}>Calendar</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator size="large" color="#FBBF24" />
          <Text style={styles.loadingText}>Loading live execution…</Text>
        </View>
      ) : isUnauthorized ? (
        <View style={styles.centerFill}>
          <Lock size={40} color="#F87171" />
          <Text style={styles.errorTitle}>Owner access required</Text>
          <Text style={styles.errorBody}>{errorMessage}</Text>
        </View>
      ) : errorMessage && !liveWork ? (
        <View style={styles.centerFill}>
          <AlertTriangle size={40} color="#F87171" />
          <Text style={styles.errorTitle}>Could not load live work</Text>
          <Text style={styles.errorBody}>{errorMessage}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => fetchAll(false)}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor="#FBBF24" />}
        >
          {/* Live execution summary */}
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Zap size={16} color="#FBBF24" />
              <Text style={styles.cardHeader}>Live Execution</Text>
            </View>
            <Text style={styles.liveSummary}>{liveWork?.summary ?? 'No active execution.'}</Text>
            {counts ? (
              <View style={styles.statGrid}>
                <StatPill label="Active tasks" value={counts.activeTasks} color="#FBBF24" />
                <StatPill label="Active agents" value={counts.activeAgents} color="#60A5FA" />
                <StatPill label="Completed" value={counts.completedTasks} color="#34D399" />
                <StatPill label="Failed" value={counts.failedTasks} color="#F87171" />
              </View>
            ) : null}
          </View>

          {/* Current task */}
          {liveWork?.currentTask ? (
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Activity size={16} color="#FBBF24" />
                <Text style={styles.cardHeader}>Current Task</Text>
                <View style={[styles.statusDot, { backgroundColor: STATUS_COLOR(liveWork.currentTask.status) }]} />
              </View>
              <Text style={styles.currentTaskId}>{liveWork.currentTask.taskId.slice(0, 12)}</Text>
              <Text style={styles.currentTaskTitle}>{liveWork.currentTask.title}</Text>
              <Text style={styles.currentTaskStatus}>Status: {liveWork.currentTask.status}</Text>
              {liveWork.currentTask.team ? (
                <Text style={styles.currentTaskMeta}>Team: {liveWork.currentTask.team} ({TEAM_NAMES[liveWork.currentTask.team] ?? '—'})</Text>
              ) : null}
              {liveWork.currentTask.module ? (
                <Text style={styles.currentTaskMeta}>Module: {liveWork.currentTask.module}</Text>
              ) : null}
              {liveWork.currentTask.file ? (
                <View style={styles.metaRow}>
                  <FileCode size={12} color="#64748B" />
                  <Text style={styles.metaText}>{liveWork.currentTask.file}</Text>
                </View>
              ) : null}
              {liveWork.currentTask.command ? (
                <View style={styles.commandBox}>
                  <Terminal size={12} color="#34D399" />
                  <Text style={styles.commandText}>{liveWork.currentTask.command}</Text>
                </View>
              ) : null}
              {liveWork.currentTask.elapsedMs ? (
                <Text style={styles.currentTaskMeta}>Elapsed: {formatDuration(liveWork.currentTask.elapsedMs)}</Text>
              ) : null}
              {liveWork.currentTask.retryCount ? (
                <Text style={styles.currentTaskMeta}>Retries: {liveWork.currentTask.retryCount}</Text>
              ) : null}
              {liveWork.currentTask.branch ? (
                <View style={styles.metaRow}>
                  <GitBranch size={12} color="#60A5FA" />
                  <Text style={styles.metaText}>{liveWork.currentTask.branch}</Text>
                </View>
              ) : null}
              {liveWork.currentTask.commitSha ? (
                <Text style={styles.currentTaskMeta}>Commit: {liveWork.currentTask.commitSha.slice(0, 12)}</Text>
              ) : null}
            </View>
          ) : (
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <CheckCircle2 size={16} color="#34D399" />
                <Text style={styles.cardHeader}>Current Task</Text>
              </View>
              <Text style={styles.emptyText}>No task is actively running right now. All engineering work is verified and complete.</Text>
            </View>
          )}

          {/* Active agents */}
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Cpu size={16} color="#60A5FA" />
              <Text style={styles.cardHeader}>Active Agents ({liveWork?.activeAgents?.length ?? 0})</Text>
            </View>
            {(liveWork?.activeAgents ?? []).length === 0 ? (
              <Text style={styles.emptyText}>No background agents currently scanning.</Text>
            ) : (
              (liveWork?.activeAgents ?? []).map((agent) => (
                <View key={agent.agentId} style={styles.agentRow}>
                  <View style={[styles.statusDot, { backgroundColor: STATUS_COLOR(agent.status ?? 'RUNNING') }]} />
                  <View style={styles.agentTextWrap}>
                    <Text style={styles.agentId}>{agent.agentId}</Text>
                    {agent.name ? <Text style={styles.agentName}>{agent.name}</Text> : null}
                    {agent.task ? <Text style={styles.agentTask}>{agent.task}</Text> : null}
                    <Text style={styles.agentStatus}>{agent.status ?? 'RUNNING'}</Text>
                  </View>
                </View>
              ))
            )}
          </View>

          {/* Engineering pipeline counts */}
          {engCounts ? (
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Activity size={16} color="#FBBF24" />
                <Text style={styles.cardHeader}>Engineering Pipeline</Text>
              </View>
              <View style={styles.statGrid}>
                <StatPill label="Total" value={engCounts.total} color="#E2E8F0" />
                <StatPill label="Verified" value={engCounts.verified} color="#34D399" />
                <StatPill label="Running" value={engCounts.running} color="#FBBF24" />
                <StatPill label="Queued" value={engCounts.queued} color="#94A3B8" />
                <StatPill label="Waiting" value={engCounts.waitingApproval} color="#F97316" />
                <StatPill label="Retrying" value={engCounts.retrying} color="#FBBF24" />
                <StatPill label="Blocked" value={engCounts.blocked} color="#F87171" />
                <StatPill label="Failed" value={engCounts.failed} color="#F87171" />
              </View>
            </View>
          ) : null}

          {/* Live logs */}
          {(liveWork?.liveLogs ?? []).length > 0 ? (
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Terminal size={16} color="#34D399" />
                <Text style={styles.cardHeader}>Live Logs ({liveWork?.liveLogs?.length ?? 0})</Text>
              </View>
              {(liveWork?.liveLogs ?? []).slice(0, 20).map((log, i) => (
                <View key={`${log.at}-${i}`} style={styles.logRow}>
                  <Text style={styles.logTime}>{formatTime(log.at)}</Text>
                  <Text style={[styles.logLevel, { color: log.level === 'ERROR' ? '#F87171' : log.level === 'WARN' ? '#FBBF24' : '#94A3B8' }]}>
                    {log.level}
                  </Text>
                  <Text style={styles.logMessage} numberOfLines={3}>{log.message}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* Recent completed tasks */}
          {(liveWork?.recentCompletedTasks ?? []).length > 0 ? (
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <CheckCircle2 size={16} color="#34D399" />
                <Text style={styles.cardHeader}>Recently Completed</Text>
              </View>
              {(liveWork?.recentCompletedTasks ?? []).map((t) => (
                <View key={t.taskId} style={styles.taskRow}>
                  <View style={[styles.statusDot, { backgroundColor: STATUS_COLOR(t.status) }]} />
                  <View style={styles.taskTextWrap}>
                    <Text style={styles.taskId}>{t.taskId.slice(0, 12)}</Text>
                    <Text style={styles.taskTitle} numberOfLines={2}>{t.title}</Text>
                    <Text style={styles.taskMeta}>{t.status} · {formatFull(t.completedAt)}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {/* All engineering tasks */}
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Layers size={16} color="#60A5FA" />
              <Text style={styles.cardHeader}>All Engineering Tasks ({sortedTasks.length})</Text>
            </View>
            {sortedTasks.length === 0 ? (
              <Text style={styles.emptyText}>No engineering tasks.</Text>
            ) : (
              sortedTasks.map((task) => (
                <TouchableOpacity
                  key={task.id}
                  style={styles.taskRow}
                  onPress={() => setSelectedTask(task)}
                  testID={`live-task-${task.id}`}
                >
                  <View style={[styles.statusDot, { backgroundColor: STATUS_COLOR(task.status) }]} />
                  <View style={styles.taskTextWrap}>
                    <Text style={styles.taskId}>{task.id.slice(0, 8)} · {task.team_id}</Text>
                    <Text style={styles.taskTitle} numberOfLines={2}>{task.title}</Text>
                    <Text style={styles.taskMeta}>
                      {task.status} · {task.stage}
                      {task.evidence?.commitSha ? ` · ${task.evidence.commitSha.slice(0, 7)}` : ''}
                      {task.evidence?.deployId ? ` · ${task.evidence.deployId.slice(0, 12)}` : ''}
                    </Text>
                    <View style={styles.taskBadges}>
                      <View style={[styles.badge, task.owner_approved ? styles.badgeGreen : styles.badgeOrange]}>
                        <Text style={styles.badgeText}>{task.owner_approved ? 'APPROVED' : 'NEEDS APPROVAL'}</Text>
                      </View>
                      {task.evidence?.healthVerified ? (
                        <View style={[styles.badge, styles.badgeGreen]}>
                          <Text style={styles.badgeText}>HEALTH OK</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                </TouchableOpacity>
              ))
            )}
          </View>

          {/* Proof output */}
          {(liveWork?.proofOutput ?? []).length > 0 ? (
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <CheckCircle2 size={16} color="#34D399" />
                <Text style={styles.cardHeader}>Proof Output</Text>
              </View>
              {(liveWork?.proofOutput ?? []).map((p) => (
                <View key={p.taskId} style={styles.proofRow}>
                  <Text style={styles.proofTaskId}>{p.taskId.slice(0, 12)}</Text>
                  <Text style={styles.proofStatus}>{p.status}</Text>
                  <Text style={styles.proofOutput} numberOfLines={5}>{p.output}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <Text style={styles.footerNote}>
            Source: {liveWork?.marker ?? status?.marker ?? '—'} · generated {formatFull(liveWork?.generatedAt)} · auto-refresh 15s
          </Text>
        </ScrollView>
      )}

      {/* Task detail modal */}
      <Modal
        visible={selectedTask !== null}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setSelectedTask(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {selectedTask ? (
              <>
                <View style={styles.modalHeader}>
                  <View style={styles.modalTitleWrap}>
                    <Text style={styles.modalTitle}>{selectedTask.id.slice(0, 12)}</Text>
                    <Text style={styles.modalSubtitle}>{selectedTask.team_id} · {TEAM_NAMES[selectedTask.team_id] ?? '—'}</Text>
                  </View>
                  <TouchableOpacity onPress={() => setSelectedTask(null)} style={styles.modalClose}>
                    <X size={20} color="#94A3B8" />
                  </TouchableOpacity>
                </View>
                <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent}>
                  <Text style={styles.modalTaskTitle}>{selectedTask.title}</Text>
                  {selectedTask.detail ? (
                    <Text style={styles.modalTaskDetail}>{selectedTask.detail}</Text>
                  ) : null}
                  <DetailRow label="Status" value={selectedTask.status} color={STATUS_COLOR(selectedTask.status)} />
                  <DetailRow label="Stage" value={selectedTask.stage} />
                  <DetailRow label="Owner Approved" value={selectedTask.owner_approved ? 'YES' : 'NO'} />
                  {selectedTask.owner_approved_by ? (
                    <DetailRow label="Approved By" value={selectedTask.owner_approved_by} />
                  ) : null}
                  {selectedTask.owner_approved_at ? (
                    <DetailRow label="Approved At" value={formatFull(selectedTask.owner_approved_at)} />
                  ) : null}
                  {selectedTask.evidence?.commitSha ? (
                    <DetailRow label="Commit SHA" value={selectedTask.evidence.commitSha} />
                  ) : null}
                  {selectedTask.evidence?.deployId ? (
                    <DetailRow label="Deploy ID" value={selectedTask.evidence.deployId} />
                  ) : null}
                  {selectedTask.evidence?.healthVerified !== undefined ? (
                    <DetailRow label="Health Verified" value={selectedTask.evidence.healthVerified ? 'YES' : 'NO'} />
                  ) : null}
                  {selectedTask.evidence?.testResults ? (
                    <View style={styles.evidenceBox}>
                      <Text style={styles.evidenceLabel}>Test Results</Text>
                      <Text style={styles.evidenceText}>{selectedTask.evidence.testResults}</Text>
                    </View>
                  ) : null}
                </ScrollView>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.statPill}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function DetailRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0B1220' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1E293B',
  },
  backButton: { padding: 6, marginRight: 6 },
  headerTitleWrap: { flex: 1 },
  headerTitle: { color: '#F1F5F9', fontSize: 18, fontWeight: '700' as const },
  headerSubtitle: { color: '#64748B', fontSize: 11, marginTop: 2 },
  refreshButton: { padding: 8 },
  navRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#1E293B' },
  navChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#111A2C', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: '#1E293B' },
  navChipText: { color: '#E2E8F0', fontSize: 12, fontWeight: '600' as const },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 10 },
  loadingText: { color: '#94A3B8', fontSize: 14 },
  errorTitle: { color: '#F1F5F9', fontSize: 17, fontWeight: '700' as const },
  errorBody: { color: '#94A3B8', fontSize: 13, textAlign: 'center' as const },
  retryButton: { marginTop: 8, backgroundColor: '#FBBF24', borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10 },
  retryText: { color: '#0B1220', fontWeight: '700' as const },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40, gap: 14 },
  card: { backgroundColor: '#111A2C', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#1E293B' },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  cardHeader: { color: '#E2E8F0', fontSize: 15, fontWeight: '700' as const, flex: 1 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  liveSummary: { color: '#CBD5E1', fontSize: 13, marginBottom: 10 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 8 },
  statPill: { backgroundColor: '#0B1220', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, minWidth: 84, alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '800' as const },
  statLabel: { color: '#64748B', fontSize: 11, marginTop: 2 },
  currentTaskId: { color: '#FBBF24', fontSize: 13, fontWeight: '700' as const, marginBottom: 4 },
  currentTaskTitle: { color: '#E2E8F0', fontSize: 15, fontWeight: '600' as const, marginBottom: 6 },
  currentTaskStatus: { color: '#34D399', fontSize: 12, marginBottom: 4 },
  currentTaskMeta: { color: '#94A3B8', fontSize: 12, marginTop: 3 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  metaText: { color: '#94A3B8', fontSize: 12 },
  commandBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#0B1220', borderRadius: 8, padding: 10, marginTop: 8, borderWidth: 1, borderColor: '#1E293B' },
  commandText: { color: '#34D399', fontSize: 11, fontFamily: 'monospace', flex: 1 },
  emptyText: { color: '#64748B', fontSize: 13 },
  agentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#1E293B' },
  agentTextWrap: { flex: 1 },
  agentId: { color: '#FBBF24', fontSize: 12, fontWeight: '700' as const },
  agentName: { color: '#E2E8F0', fontSize: 13, marginTop: 2 },
  agentTask: { color: '#94A3B8', fontSize: 11, marginTop: 2 },
  agentStatus: { color: '#64748B', fontSize: 11, marginTop: 2 },
  logRow: { flexDirection: 'row', gap: 8, paddingVertical: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#1E293B' },
  logTime: { color: '#64748B', fontSize: 10, minWidth: 70 },
  logLevel: { fontSize: 10, fontWeight: '700' as const, minWidth: 45 },
  logMessage: { color: '#CBD5E1', fontSize: 11, flex: 1 },
  taskRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#1E293B' },
  taskTextWrap: { flex: 1 },
  taskId: { color: '#FBBF24', fontSize: 11, fontWeight: '700' as const },
  taskTitle: { color: '#E2E8F0', fontSize: 13, marginTop: 2 },
  taskMeta: { color: '#64748B', fontSize: 11, marginTop: 2 },
  taskBadges: { flexDirection: 'row', gap: 6, marginTop: 6 },
  badge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' as const },
  badgeGreen: { backgroundColor: 'rgba(52,211,153,0.2)' },
  badgeOrange: { backgroundColor: 'rgba(249,115,22,0.2)' },
  badgeText: { fontSize: 9, fontWeight: '800' as const, color: '#E2E8F0' },
  proofRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#1E293B', paddingVertical: 8 },
  proofTaskId: { color: '#FBBF24', fontSize: 11, fontWeight: '700' as const },
  proofStatus: { color: '#34D399', fontSize: 11, marginTop: 2 },
  proofOutput: { color: '#94A3B8', fontSize: 11, marginTop: 4, fontFamily: 'monospace' },
  footerNote: { color: '#475569', fontSize: 11, textAlign: 'center' as const, marginTop: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  modalCard: { backgroundColor: '#111A2C', borderRadius: 14, borderWidth: 1, borderColor: '#1E293B', width: '100%', maxHeight: '85%' },
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', padding: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#1E293B' },
  modalTitleWrap: { flex: 1 },
  modalTitle: { color: '#F1F5F9', fontSize: 16, fontWeight: '700' as const },
  modalSubtitle: { color: '#64748B', fontSize: 11, marginTop: 4 },
  modalClose: { padding: 4 },
  modalScroll: { flex: 1 },
  modalScrollContent: { padding: 14, gap: 8 },
  modalTaskTitle: { color: '#E2E8F0', fontSize: 14, fontWeight: '600' as const, marginBottom: 6 },
  modalTaskDetail: { color: '#94A3B8', fontSize: 12, marginBottom: 8, lineHeight: 18 },
  detailRow: { flexDirection: 'row', gap: 8, paddingVertical: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#1E293B' },
  detailLabel: { color: '#64748B', fontSize: 12, minWidth: 120 },
  detailValue: { color: '#E2E8F0', fontSize: 12, flex: 1 },
  evidenceBox: { marginTop: 8, backgroundColor: '#0B1220', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#1E293B' },
  evidenceLabel: { color: '#34D399', fontSize: 11, fontWeight: '700' as const, marginBottom: 4 },
  evidenceText: { color: '#94A3B8', fontSize: 11, fontFamily: 'monospace' },
});