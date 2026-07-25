/**
 * IVX Module Command Center — live dashboard for the 200-module operating map.
 *
 * Reads REAL production data:
 *   GET /api/ivx/engineering-os/status  (counts, activation, teams, pipeline)
 *   GET /api/ivx/engineering-os/teams   (12-team registry)
 *   GET /api/ivx/engineering-os/tasks   (verified engineering tasks)
 *   GET /api/ivx/engineering-os/report  (latest 2-hour report)
 *
 * Module registry is sourced from @/lib/ivx-module-registry (200 ROOTs).
 * No fake data — every number traces to live API responses or the certified registry.
 * Owner-only: requires IVX owner bearer token.
 * Auto-refreshes every 30s + pull-to-refresh.
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
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Cpu,
  Filter,
  Layers,
  Lock,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
  Zap,
} from 'lucide-react-native';
import { getIVXAccessToken } from '@/lib/ivx-supabase-client';
import {
  IVX_MODULE_REGISTRY,
  MODULE_COUNT,
  getScoreDistribution,
  filterModules,
  CATEGORY_NAMES,
  TEAM_NAMES,
  type IVXModule,
  type ModuleCategory,
} from '@/lib/ivx-module-registry';

const API_BASE = (process.env.EXPO_PUBLIC_IVX_API_BASE_URL || 'https://api.ivxholding.com').replace(/\/+$/, '');
const STATUS_URL = `${API_BASE}/api/ivx/engineering-os/status`;
const TEAMS_URL = `${API_BASE}/api/ivx/engineering-os/teams`;
const TASKS_URL = `${API_BASE}/api/ivx/engineering-os/tasks`;
const REPORT_URL = `${API_BASE}/api/ivx/engineering-os/report`;
const POLL_INTERVAL_MS = 30_000;

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
  activation?: { active: boolean; activeTeams: number; totalTeams: number };
  pipeline?: unknown;
  rules?: string[];
  counts?: EngineeringCounts;
};

type TeamEntry = {
  teamId: string;
  name: string;
  mission: string;
  focus: string[];
  continuous: boolean;
  canMerge: boolean;
  canTag: boolean;
  canDeploy: boolean;
  status: string;
};

type TeamsResponse = {
  status: string;
  marker?: string;
  releaseManagerTeamId?: string;
  registry?: TeamEntry[];
  dbTeams?: TeamEntry[];
  dbSynced?: boolean;
};

type TaskEntry = {
  id: string;
  title: string;
  detail?: string;
  team_id: string;
  stage: string;
  status: string;
  owner_approved: boolean;
  owner_approved_by?: string;
  evidence?: {
    commitSha?: string;
    testResults?: string;
    deployId?: string;
    healthVerified?: boolean;
  };
};

type TasksResponse = {
  status: string;
  tasks?: TaskEntry[];
};

type ReportResponse = {
  status: string;
  report?: {
    id: string;
    body: string;
    generatedAt?: string;
  };
};

const SCORE_COLOR = (score: number): string => {
  if (score === 10) return '#34D399';
  if (score >= 8) return '#60A5FA';
  if (score >= 5) return '#FBBF24';
  if (score >= 1) return '#F97316';
  return '#F87171';
};

const STATUS_DOT = (status: string): string => {
  if (status === 'VERIFIED') return '#34D399';
  if (status === 'PRODUCTION_CAPABLE') return '#60A5FA';
  if (status === 'BLOCKED') return '#F87171';
  if (status === 'FAILED') return '#F87171';
  if (status === 'IN_PROGRESS') return '#FBBF24';
  return '#94A3B8';
};

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}Z`;
  } catch {
    return iso;
  }
}

export default function ModuleCommandCenterScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<EngineeringStatus | null>(null);
  const [teams, setTeams] = useState<TeamEntry[]>([]);
  const [tasks, setTasks] = useState<TaskEntry[]>([]);
  const [report, setReport] = useState<ReportResponse['report'] | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isUnauthorized, setIsUnauthorized] = useState<boolean>(false);
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
  const [selectedModule, setSelectedModule] = useState<IVXModule | null>(null);
  const [activeCategory, setActiveCategory] = useState<ModuleCategory | 'ALL'>('ALL');
  const [activeStatus, setActiveStatus] = useState<string>('ALL');
  const [activeTeam, setActiveTeam] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = useCallback(async (silent: boolean) => {
    if (!silent) setIsLoading(true);
    setErrorMessage(null);
    try {
      const token = await getIVXAccessToken();
      if (!token) {
        setIsUnauthorized(true);
        setErrorMessage('Owner session required. Sign in as the owner to view the Module Command Center.');
        return;
      }
      const headers = { Authorization: `Bearer ${token}` };
      const [statusRes, teamsRes, tasksRes, reportRes] = await Promise.all([
        fetch(STATUS_URL, { headers }),
        fetch(TEAMS_URL, { headers }),
        fetch(TASKS_URL, { headers }),
        fetch(REPORT_URL, { headers }),
      ]);
      if (statusRes.status === 401 || statusRes.status === 403) {
        setIsUnauthorized(true);
        setErrorMessage('Access denied: this dashboard is restricted to the IVX owner.');
        return;
      }
      const statusJson = (await statusRes.json()) as EngineeringStatus;
      setStatus(statusJson);
      if (teamsRes.ok) {
        const teamsJson = (await teamsRes.json()) as TeamsResponse;
        setTeams(teamsJson.registry ?? teamsJson.dbTeams ?? []);
      }
      if (tasksRes.ok) {
        const tasksJson = (await tasksRes.json()) as TasksResponse;
        setTasks(tasksJson.tasks ?? []);
      }
      if (reportRes.ok) {
        const reportJson = (await reportRes.json()) as ReportResponse;
        setReport(reportJson.report ?? null);
      }
      setIsUnauthorized(false);
      setLastFetchedAt(new Date().toISOString());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error loading dashboard.';
      console.log('[ModuleCommandCenter] fetch failed:', message);
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

  const dist = useMemo(() => getScoreDistribution(), []);
  const counts = status?.counts;
  const filteredModules = useMemo(
    () => filterModules(IVX_MODULE_REGISTRY, {
      category: activeCategory,
      status: activeStatus,
      team: activeTeam,
      search: searchQuery,
    }),
    [activeCategory, activeStatus, activeTeam, searchQuery],
  );

  const categoryChips: Array<{ key: ModuleCategory | 'ALL'; label: string }> = [
    { key: 'ALL', label: 'All' },
    ...(Object.entries(CATEGORY_NAMES) as Array<[ModuleCategory, string]>).map(([key, name]) => ({
      key,
      label: `${key}. ${name.split(' ')[0]}`,
    })),
  ];

  const statusChips = [
    { key: 'ALL', label: 'All' },
    { key: 'COMPLETE', label: 'Complete' },
    { key: 'IN_PROGRESS', label: 'In Progress' },
    { key: 'BLOCKED', label: 'Blocked' },
    { key: 'FAILED', label: 'Failed' },
  ];

  const completionPercent = dist.total > 0 ? Math.round(((dist.ten + dist.eightNine) / dist.total) * 100) : 0;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} testID="module-cmd-back">
          <ArrowLeft size={22} color="#E2E8F0" />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>IVX Module Command Center</Text>
          <Text style={styles.headerSubtitle}>
            {MODULE_COUNT} modules · {formatTime(lastFetchedAt)}
          </Text>
        </View>
        <TouchableOpacity onPress={onRefresh} style={styles.refreshButton} testID="module-cmd-refresh">
          <RefreshCw size={18} color="#FBBF24" />
        </TouchableOpacity>
      </View>

      <View style={styles.navRow}>
        <TouchableOpacity style={styles.navChip} onPress={() => router.push('/autonomous-engineering-calendar')}>
          <Calendar size={14} color="#60A5FA" />
          <Text style={styles.navChipText}>Calendar</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navChip} onPress={() => router.push('/live-work-panel')}>
          <Zap size={14} color="#FBBF24" />
          <Text style={styles.navChipText}>Live Work</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator size="large" color="#FBBF24" />
          <Text style={styles.loadingText}>Loading live production data…</Text>
        </View>
      ) : isUnauthorized ? (
        <View style={styles.centerFill}>
          <Lock size={40} color="#F87171" />
          <Text style={styles.errorTitle}>Owner access required</Text>
          <Text style={styles.errorBody}>{errorMessage}</Text>
        </View>
      ) : errorMessage && !status ? (
        <View style={styles.centerFill}>
          <AlertTriangle size={40} color="#F87171" />
          <Text style={styles.errorTitle}>Could not load dashboard</Text>
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
          {/* Production summary */}
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Activity size={16} color="#FBBF24" />
              <Text style={styles.cardHeader}>Production Summary</Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${completionPercent}%` }]} />
            </View>
            <Text style={styles.progressLabel}>
              {completionPercent}% production-capable ({dist.ten + dist.eightNine}/{dist.total} modules)
            </Text>
            <View style={styles.statGrid}>
              <StatPill label="Total" value={dist.total} color="#E2E8F0" />
              <StatPill label="10/10" value={dist.ten} color="#34D399" />
              <StatPill label="8–9/10" value={dist.eightNine} color="#60A5FA" />
              <StatPill label="Blocked" value={dist.blocked} color="#F87171" />
              <StatPill label="Failed" value={dist.failed} color="#F87171" />
              <StatPill label="Teams" value={status?.activation?.activeTeams ?? 0} color="#FBBF24" />
            </View>
            <Text style={styles.footerMeta}>
              Runtime: {status?.marker ?? '—'} · Teams {status?.activation?.activeTeams ?? 0}/{status?.activation?.totalTeams ?? 0} active
            </Text>
          </View>

          {/* Engineering task counts */}
          {counts ? (
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Cpu size={16} color="#60A5FA" />
                <Text style={styles.cardHeader}>Engineering Pipeline</Text>
              </View>
              <View style={styles.statGrid}>
                <StatPill label="Total" value={counts.total} color="#E2E8F0" />
                <StatPill label="Verified" value={counts.verified} color="#34D399" />
                <StatPill label="Running" value={counts.running} color="#FBBF24" />
                <StatPill label="Queued" value={counts.queued} color="#94A3B8" />
                <StatPill label="Blocked" value={counts.blocked} color="#F87171" />
                <StatPill label="Failed" value={counts.failed} color="#F87171" />
              </View>
              {status?.rules ? (
                <View style={styles.rulesBox}>
                  <Text style={styles.rulesHeader}>Enforced rules</Text>
                  {status.rules.map((rule) => (
                    <Text key={rule} style={styles.ruleText}>• {rule}</Text>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}

          {/* 2-hour report preview */}
          {report ? (
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <CheckCircle2 size={16} color="#34D399" />
                <Text style={styles.cardHeader}>Latest 2-Hour Report</Text>
              </View>
              <Text style={styles.reportMeta}>ID: {report.id.slice(0, 8)}… · {formatTime(report.generatedAt)}</Text>
              <Text style={styles.reportBody} numberOfLines={8}>{report.body}</Text>
            </View>
          ) : null}

          {/* AI teams */}
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <ShieldCheck size={16} color="#34D399" />
              <Text style={styles.cardHeader}>AI Workforce ({teams.length})</Text>
            </View>
            {teams.length === 0 ? (
              <Text style={styles.emptyText}>No team data loaded.</Text>
            ) : (
              teams.map((team) => {
                const teamTasks = tasks.filter((t) => t.team_id === team.teamId);
                const verifiedCount = teamTasks.filter((t) => t.status === 'VERIFIED').length;
                return (
                  <View key={team.teamId} style={styles.teamRow}>
                    <View style={styles.teamTopRow}>
                      <Text style={styles.teamId}>{team.teamId}</Text>
                      <Text style={styles.teamName}>{team.name}</Text>
                      {team.canDeploy ? <Text style={styles.deployBadge}>DEPLOY</Text> : null}
                    </View>
                    <Text style={styles.teamMission} numberOfLines={2}>{team.mission}</Text>
                    <Text style={styles.teamMeta}>
                      {team.status} · {teamTasks.length} tasks · {verifiedCount} verified
                    </Text>
                  </View>
                );
              })
            )}
          </View>

          {/* Verified tasks */}
          {tasks.length > 0 ? (
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <CheckCircle2 size={16} color="#34D399" />
                <Text style={styles.cardHeader}>Verified Tasks ({tasks.length})</Text>
              </View>
              {tasks.slice(0, 8).map((task) => (
                <View key={task.id} style={styles.taskRow}>
                  <View style={[styles.statusDot, { backgroundColor: STATUS_DOT(task.status) }]} />
                  <View style={styles.taskTextWrap}>
                    <Text style={styles.taskId}>{task.id.slice(0, 8)} · {task.team_id}</Text>
                    <Text style={styles.taskTitle} numberOfLines={2}>{task.title}</Text>
                    <Text style={styles.taskMeta}>
                      {task.status} · {task.stage}
                      {task.evidence?.commitSha ? ` · ${task.evidence.commitSha.slice(0, 7)}` : ''}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {/* Filters */}
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Filter size={16} color="#FBBF24" />
              <Text style={styles.cardHeader}>Filters</Text>
            </View>
            <View style={styles.searchBox}>
              <Search size={14} color="#64748B" />
              <TextInput
                style={styles.searchInput}
                placeholder="Search modules by name, ID, or API…"
                placeholderTextColor="#64748B"
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <Text style={styles.filterLabel}>Category</Text>
            <View style={styles.chipRow}>
              {categoryChips.map((chip) => (
                <TouchableOpacity
                  key={chip.key}
                  style={[styles.chip, activeCategory === chip.key && styles.chipActive]}
                  onPress={() => setActiveCategory(chip.key)}
                >
                  <Text style={[styles.chipText, activeCategory === chip.key && styles.chipTextActive]}>
                    {chip.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.filterLabel}>Status</Text>
            <View style={styles.chipRow}>
              {statusChips.map((chip) => (
                <TouchableOpacity
                  key={chip.key}
                  style={[styles.chip, activeStatus === chip.key && styles.chipActive]}
                  onPress={() => setActiveStatus(chip.key)}
                >
                  <Text style={[styles.chipText, activeStatus === chip.key && styles.chipTextActive]}>
                    {chip.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Module list */}
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Layers size={16} color="#60A5FA" />
              <Text style={styles.cardHeader}>Modules ({filteredModules.length})</Text>
            </View>
            {filteredModules.length === 0 ? (
              <Text style={styles.emptyText}>No modules match the current filters.</Text>
            ) : (
              filteredModules.map((m) => (
                <TouchableOpacity
                  key={m.id}
                  style={styles.moduleRow}
                  onPress={() => setSelectedModule(m)}
                  testID={`module-${m.id}`}
                >
                  <View style={styles.moduleTopRow}>
                    <Text style={styles.moduleId}>{m.id}</Text>
                    <Text style={[styles.moduleScore, { color: SCORE_COLOR(m.completionScore) }]}>
                      {m.completionScore}/10
                    </Text>
                    <View style={[styles.statusDot, { backgroundColor: STATUS_DOT(m.status) }]} />
                    <Text style={[styles.moduleStatus, { color: STATUS_DOT(m.status) }]}>{m.status}</Text>
                    <Text style={styles.moduleTeam}>{m.ownerTeam}</Text>
                    <ChevronRight size={14} color="#64748B" />
                  </View>
                  <Text style={styles.moduleName}>{m.name}</Text>
                  <Text style={styles.moduleApi} numberOfLines={1}>{m.apiEndpoint}</Text>
                </TouchableOpacity>
              ))
            )}
          </View>

          <Text style={styles.footerNote}>
            Source: {status?.marker ?? '—'} · {MODULE_COUNT} modules certified 2026-07-18T17:15Z · auto-refresh 30s
          </Text>
        </ScrollView>
      )}

      {/* Module detail modal */}
      <Modal
        visible={selectedModule !== null}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setSelectedModule(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {selectedModule ? (
              <>
                <View style={styles.modalHeader}>
                  <View style={styles.modalTitleWrap}>
                    <Text style={styles.modalTitle}>{selectedModule.id} · {selectedModule.name}</Text>
                    <Text style={styles.modalSubtitle}>
                      Category {selectedModule.category}: {selectedModule.categoryName} · {selectedModule.ownerTeam}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => setSelectedModule(null)} style={styles.modalClose}>
                    <X size={20} color="#94A3B8" />
                  </TouchableOpacity>
                </View>
                <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent}>
                  <DetailRow label="Completion Score" value={`${selectedModule.completionScore}/10`} color={SCORE_COLOR(selectedModule.completionScore)} />
                  <DetailRow label="QA Score" value={`${selectedModule.qaScore}/10`} />
                  <DetailRow label="Security Score" value={`${selectedModule.securityScore}/10`} />
                  <DetailRow label="Status" value={selectedModule.status} color={STATUS_DOT(selectedModule.status)} />
                  <DetailRow label="Production" value={selectedModule.productionStatus} />
                  <DetailRow label="App Route" value={selectedModule.appRoute} />
                  <DetailRow label="Web Route" value={selectedModule.webRoute} />
                  <DetailRow label="API Endpoint" value={selectedModule.apiEndpoint} />
                  <DetailRow label="DB Tables" value={selectedModule.dbTables} />
                  <DetailRow label="Storage Bucket" value={selectedModule.storageBucket} />
                  <DetailRow label="Source Files" value={selectedModule.sourceFiles} />
                  <DetailRow label="Owner Team" value={`${selectedModule.ownerTeam} (${TEAM_NAMES[selectedModule.ownerTeam] ?? '—'})`} />
                  <DetailRow label="Last Verified" value={formatTime(selectedModule.lastVerified)} />
                  <DetailRow label="Defect IDs" value={selectedModule.defectIds} />
                  <DetailRow label="Work Remaining" value={selectedModule.workRemaining} />
                  <DetailRow label="Est. Completion" value={selectedModule.estimatedCompletion} />
                  <DetailRow label="Proof Ledger" value={selectedModule.proofLedgerId} />
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
  cardHeader: { color: '#E2E8F0', fontSize: 15, fontWeight: '700' as const },
  progressTrack: { height: 8, backgroundColor: '#1E293B', borderRadius: 4, overflow: 'hidden' as const },
  progressFill: { height: 8, backgroundColor: '#34D399', borderRadius: 4 },
  progressLabel: { color: '#94A3B8', fontSize: 12, marginTop: 6, marginBottom: 10 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 8 },
  statPill: { backgroundColor: '#0B1220', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, minWidth: 84, alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '800' as const },
  statLabel: { color: '#64748B', fontSize: 11, marginTop: 2 },
  footerMeta: { color: '#475569', fontSize: 11, marginTop: 8 },
  rulesBox: { marginTop: 10, gap: 3 },
  rulesHeader: { color: '#E2E8F0', fontSize: 12, fontWeight: '700' as const, marginBottom: 4 },
  ruleText: { color: '#94A3B8', fontSize: 11 },
  reportMeta: { color: '#64748B', fontSize: 11, marginBottom: 6 },
  reportBody: { color: '#CBD5E1', fontSize: 12, lineHeight: 18 },
  teamRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#1E293B', paddingVertical: 8 },
  teamTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  teamId: { color: '#FBBF24', fontSize: 12, fontWeight: '800' as const },
  teamName: { color: '#E2E8F0', fontSize: 13, fontWeight: '600' as const, flex: 1 },
  deployBadge: { color: '#0B1220', backgroundColor: '#34D399', fontSize: 10, fontWeight: '800' as const, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' as const },
  teamMission: { color: '#94A3B8', fontSize: 11, marginTop: 3 },
  teamMeta: { color: '#64748B', fontSize: 11, marginTop: 2 },
  taskRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#1E293B' },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  taskTextWrap: { flex: 1 },
  taskId: { color: '#FBBF24', fontSize: 11, fontWeight: '700' as const },
  taskTitle: { color: '#E2E8F0', fontSize: 13, marginTop: 2 },
  taskMeta: { color: '#64748B', fontSize: 11, marginTop: 2 },
  emptyText: { color: '#64748B', fontSize: 13 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#0B1220', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: '#1E293B', marginBottom: 10 },
  searchInput: { flex: 1, color: '#E2E8F0', fontSize: 13 },
  filterLabel: { color: '#94A3B8', fontSize: 11, fontWeight: '600' as const, marginBottom: 6, marginTop: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 6, marginBottom: 8 },
  chip: { backgroundColor: '#0B1220', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: '#1E293B' },
  chipActive: { backgroundColor: '#FBBF24', borderColor: '#FBBF24' },
  chipText: { color: '#94A3B8', fontSize: 11, fontWeight: '600' as const },
  chipTextActive: { color: '#0B1220' },
  moduleRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#1E293B', paddingVertical: 10 },
  moduleTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  moduleId: { color: '#FBBF24', fontSize: 12, fontWeight: '800' as const },
  moduleScore: { fontSize: 12, fontWeight: '700' as const },
  moduleStatus: { fontSize: 10, fontWeight: '700' as const },
  moduleTeam: { color: '#60A5FA', fontSize: 11, flex: 1, textAlign: 'right' as const },
  moduleName: { color: '#E2E8F0', fontSize: 13, marginTop: 4 },
  moduleApi: { color: '#64748B', fontSize: 11, marginTop: 2 },
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
  detailRow: { flexDirection: 'row', gap: 8, paddingVertical: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#1E293B' },
  detailLabel: { color: '#64748B', fontSize: 12, minWidth: 120 },
  detailValue: { color: '#E2E8F0', fontSize: 12, flex: 1 },
});