import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View} from "react-native";
import {
  Activity,
  AlertTriangle,
  Banknote,
  Bot,
  Bug,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Clock,
  Cpu,
  Database,
  Download,
  FileCode2,
  FileJson,
  FileText,
  Filter,
  GitBranch,
  Globe,
  Handshake,
  Layers,
  Megaphone,
  Moon,
  RefreshCw,
  Rocket,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  Users,
  XCircle,
  Zap} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  getAutonomousOpsDashboard,
  type AgentStatus,
  type ActivityCategory,
  type AutonomousOpsDashboard,
  type CategorySummary,
  type DateRange,
  type LiveFeedEntry,
  type OwnerActionEntry,
  type UnifiedAgent,
  type ActivityItem} from '@/src/modules/ivx-owner-ai/services/ivxAutonomousOpsService';
import {
  exportDashboard,
  EXPORT_REPORT_LABELS,
  type ExportFormat,
  type ExportReportType} from '@/src/modules/ivx-owner-ai/services/ivxDashboardExport';

const POLL_INTERVAL_MS = 15000;

const STATUS_COLORS: Record<AgentStatus, string> = {
  ACTIVE: Colors.success,
  IDLE: Colors.textTertiary,
  RUNNING: Colors.info,
  TESTING: Colors.info,
  DEPLOYING: Colors.info,
  VERIFYING: Colors.info,
  RETRYING: Colors.warning,
  BLOCKED: Colors.warning,
  OWNER_ACTION_REQUIRED: Colors.warning,
  FAILED: Colors.error,
  COMPLETED: Colors.success};

const CATEGORY_ICONS: Record<ActivityCategory, React.ReactNode> = {
  DEVELOPMENT: <FileCode2 size={15} color={Colors.primary} />,
  INVESTORS: <Building2 size={15} color={Colors.primary} />,
  BUYERS: <Handshake size={15} color={Colors.primary} />,
  LEADS_CRM: <Users size={15} color={Colors.primary} />,
  PROPERTIES_DEALS: <Building2 size={15} color={Colors.primary} />,
  MARKETING: <Megaphone size={15} color={Colors.primary} />,
  FINANCIAL: <Banknote size={15} color={Colors.primary} />,
  AUTONOMOUS_SYSTEM: <Bot size={15} color={Colors.primary} />};

const CATEGORY_LABELS: Record<ActivityCategory, string> = {
  DEVELOPMENT: 'Development',
  INVESTORS: 'Investors',
  BUYERS: 'Buyers',
  LEADS_CRM: 'Leads & CRM',
  PROPERTIES_DEALS: 'Properties & Deals',
  MARKETING: 'Marketing',
  FINANCIAL: 'Financial',
  AUTONOMOUS_SYSTEM: 'Autonomous System'};

const RANGE_TABS: { key: DateRange; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: '7 Days' },
  { key: '30d', label: '30 Days' },
];

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.round(s / 60)}m ${s % 60}s`;
}

type ViewMode = 'overview' | 'agents' | 'activity' | 'categories' | 'feed' | 'summary' | 'ownerActions' | 'export';

function AgentCard({ agent, onPress }: { agent: UnifiedAgent; onPress: () => void }) {
  const statusColor = STATUS_COLORS[agent.status] ?? Colors.textTertiary;
  return (
    <Pressable style={styles.agentCard} onPress={onPress} testID={`agent-card-${agent.agentId}`}>
      <View style={styles.agentHeader}>
        <View style={styles.agentNumberBadge}>
          <Text style={styles.agentNumberText}>{agent.agentNumber}</Text>
        </View>
        <View style={styles.agentInfo}>
          <Text style={styles.agentName}>{agent.name}</Text>
          <Text style={styles.agentDept}>{agent.department}</Text>
        </View>
        <View style={[styles.statusPill, { borderColor: statusColor }]}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusText, { color: statusColor }]}>{agent.status}</Text>
        </View>
      </View>
      <Text style={styles.agentRole} numberOfLines={2}>{agent.primaryResponsibility}</Text>
      {agent.currentTask ? (
        <View style={styles.agentTaskRow}>
          <Activity size={12} color={Colors.info} />
          <Text style={styles.agentTask} numberOfLines={2}>{agent.currentTask}</Text>
        </View>
      ) : null}
      <View style={styles.agentMetrics}>
        <MetricChip label="Started" value={agent.tasksStartedToday} color={Colors.info} />
        <MetricChip label="Done" value={agent.tasksCompletedToday} color={Colors.success} />
        <MetricChip label="Failed" value={agent.tasksFailedToday} color={agent.tasksFailedToday > 0 ? Colors.error : Colors.textTertiary} />
        <MetricChip label="Blocked" value={agent.tasksBlockedToday} color={agent.tasksBlockedToday > 0 ? Colors.warning : Colors.textTertiary} />
      </View>
      <View style={styles.agentFooter}>
        {agent.successRate !== null ? (
          <Text style={styles.agentFooterText}>Success: {agent.successRate}%</Text>
        ) : (
          <Text style={styles.agentFooterText}>Success: —</Text>
        )}
        <Text style={styles.agentFooterText}>Total: {formatDuration(agent.totalExecutionTimeMs)}</Text>
        <Text style={styles.agentFooterText}>Last: {formatTime(agent.lastActivityTime)}</Text>
      </View>
    </Pressable>
  );
}

function MetricChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.metricChip}>
      <Text style={[styles.metricValue, { color }]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const statusColor = STATUS_COLORS[item.status] ?? Colors.textTertiary;
  return (
    <View style={styles.activityRow} testID={`activity-item-${item.itemNumber}`}>
      <View style={styles.activityNumberCol}>
        <Text style={styles.activityNumber}>{item.itemNumber}</Text>
      </View>
      <View style={styles.activityContent}>
        <View style={styles.activityTopRow}>
          <Text style={styles.activityAgent} numberOfLines={1}>{item.agent}</Text>
          <View style={[styles.statusPillSmall, { borderColor: statusColor }]}>
            <Text style={[styles.statusTextSmall, { color: statusColor }]}>{item.status}</Text>
          </View>
        </View>
        <Text style={styles.activityTask} numberOfLines={2}>{item.task}</Text>
        <Text style={styles.activityResult} numberOfLines={2}>{item.result}</Text>
        <View style={styles.activityMeta}>
          <Text style={styles.activityMetaText}>
            {CATEGORY_LABELS[item.category]} · {formatTime(item.startTime)} → {formatTime(item.endTime)} · {formatDuration(item.durationMs)}
          </Text>
        </View>
        {item.commitSha ? (
          <View style={styles.activityEvidence}>
            <GitBranch size={11} color={Colors.textSecondary} />
            <Text style={styles.activityEvidenceText}>{item.commitSha.slice(0, 8)}</Text>
          </View>
        ) : null}
        {item.error ? (
          <View style={styles.activityError}>
            <AlertTriangle size={11} color={Colors.error} />
            <Text style={styles.activityErrorText} numberOfLines={2}>{item.error}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function CategoryCard({ category, total, completed, failed, blocked, onPress }: {
  category: ActivityCategory;
  total: number;
  completed: number;
  failed: number;
  blocked: number;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.categoryCard} onPress={onPress} testID={`category-card-${category}`}>
      <View style={styles.categoryHeader}>
        {CATEGORY_ICONS[category]}
        <Text style={styles.categoryTitle}>{CATEGORY_LABELS[category]}</Text>
        <View style={styles.categoryCountPill}>
          <Text style={styles.categoryCountText}>{total}</Text>
        </View>
      </View>
      <View style={styles.categoryMetrics}>
        <MetricChip label="Done" value={completed} color={Colors.success} />
        <MetricChip label="Failed" value={failed} color={failed > 0 ? Colors.error : Colors.textTertiary} />
        <MetricChip label="Blocked" value={blocked} color={blocked > 0 ? Colors.warning : Colors.textTertiary} />
      </View>
      <ChevronRight size={14} color={Colors.textTertiary} style={styles.categoryChevron} />
    </Pressable>
  );
}

function AutonomousOpsContent() {
  const insets = useSafeAreaInsets();
  const [range, setRange] = useState<DateRange>('today');
  const [viewMode, setViewMode] = useState<ViewMode>('overview');
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('csv');
  const [exportReport, setExportReport] = useState<ExportReportType>('daily_activities');
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<string | null>(null);

  const dashboardQuery = useQuery<AutonomousOpsDashboard>({
    queryKey: ['ivx-autonomous-ops-dashboard', range, agentFilter, categoryFilter],
    queryFn: () => getAutonomousOpsDashboard({ range, agent: agentFilter, category: categoryFilter }),
    refetchInterval: POLL_INTERVAL_MS});

  const data = dashboardQuery.data ?? null;
  const onRefresh = useCallback(() => { void dashboardQuery.refetch(); }, [dashboardQuery]);

  const agents = data?.agents ?? [];
  const activityItems = data?.activityItems ?? [];
  const categories = data?.categoryBreakdown ?? [];
  const liveFeed = data?.liveActivityFeed ?? [];
  const ownerActions = data?.ownerActionRequests ?? [];
  const summary = data?.dailySummary ?? null;

  const totalAgents = agents.length;
  const idleAgents = agents.filter((a: UnifiedAgent) => a.status === 'IDLE').length;
  const runningAgents = agents.filter((a: UnifiedAgent) => a.status === 'RUNNING').length;
  const completedToday = agents.reduce((sum: number, a: UnifiedAgent) => sum + a.tasksCompletedToday, 0);
  const failedToday = agents.reduce((sum: number, a: UnifiedAgent) => sum + a.tasksFailedToday, 0);

  const VIEW_TABS: { key: ViewMode; label: string; icon: React.ReactNode }[] = [
    { key: 'overview', label: 'Overview', icon: <Layers size={13} color={Colors.primary} /> },
    { key: 'agents', label: `Agents (${totalAgents})`, icon: <Bot size={13} color={Colors.primary} /> },
    { key: 'activity', label: `Activity (${activityItems.length})`, icon: <Activity size={13} color={Colors.primary} /> },
    { key: 'categories', label: 'Categories', icon: <Filter size={13} color={Colors.primary} /> },
    { key: 'feed', label: 'Live Feed', icon: <Zap size={13} color={Colors.primary} /> },
    { key: 'summary', label: 'Daily Summary', icon: <TrendingUp size={13} color={Colors.primary} /> },
    { key: 'ownerActions', label: `Owner Actions (${ownerActions.length})`, icon: <ShieldAlert size={13} color={Colors.primary} /> },
    { key: 'export', label: 'Export', icon: <Download size={13} color={Colors.primary} /> },
  ];

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 48 }]}
      refreshControl={<RefreshControl tintColor={Colors.primary} refreshing={dashboardQuery.isFetching} onRefresh={onRefresh} />}
      testID="ivx-autonomous-ops-scroll"
    >
      {/* Hero */}
      <View style={styles.heroCard}>
        <View style={styles.heroHeaderRow}>
          <Server size={18} color={Colors.primary} />
          <Text style={styles.heroTitle}>Autonomous Operations</Text>
          <View style={styles.livePill}>
            <View style={styles.liveDot} />
            <Text style={styles.livePillText}>LIVE</Text>
          </View>
        </View>
        <Text style={styles.heroSubtitle}>
          {data ? `${data.realAgentCount} real agents active · ${data.placeholderAgentCount} idle · ${activityItems.length} activities logged` : 'Loading autonomous operations dashboard…'}
        </Text>
        {data ? (
          <View style={styles.heroKpiRow}>
            <View style={styles.heroKpi}>
              <Text style={styles.heroKpiValue}>{totalAgents}</Text>
              <Text style={styles.heroKpiLabel}>Total Agents</Text>
            </View>
            <View style={styles.heroKpi}>
              <Text style={[styles.heroKpiValue, { color: Colors.success }]}>{runningAgents}</Text>
              <Text style={styles.heroKpiLabel}>Running</Text>
            </View>
            <View style={styles.heroKpi}>
              <Text style={[styles.heroKpiValue, { color: Colors.textTertiary }]}>{idleAgents}</Text>
              <Text style={styles.heroKpiLabel}>Idle</Text>
            </View>
            <View style={styles.heroKpi}>
              <Text style={[styles.heroKpiValue, { color: Colors.success }]}>{completedToday}</Text>
              <Text style={styles.heroKpiLabel}>Done Today</Text>
            </View>
            <View style={styles.heroKpi}>
              <Text style={[styles.heroKpiValue, { color: failedToday > 0 ? Colors.error : Colors.textTertiary }]}>{failedToday}</Text>
              <Text style={styles.heroKpiLabel}>Failed Today</Text>
            </View>
          </View>
        ) : null}
        {data ? (
          <Text style={styles.heroMeta}>
            {data.dateRange.label} · Generated {formatTime(data.generatedAt)} · {data.realAgentCount} real / {data.placeholderAgentCount} placeholder
          </Text>
        ) : null}
      </View>

      {/* Date Range Tabs */}
      <View style={styles.rangeRow}>
        {RANGE_TABS.map((tab) => (
          <Pressable
            key={tab.key}
            style={[styles.rangeTab, range === tab.key && styles.rangeTabActive]}
            onPress={() => setRange(tab.key)}
            testID={`range-tab-${tab.key}`}
          >
            <Text style={[styles.rangeTabText, range === tab.key && styles.rangeTabTextActive]}>{tab.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* View Mode Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.viewTabsScroll} contentContainerStyle={styles.viewTabsContent}>
        {VIEW_TABS.map((tab) => (
          <Pressable
            key={tab.key}
            style={[styles.viewTab, viewMode === tab.key && styles.viewTabActive]}
            onPress={() => setViewMode(tab.key)}
            testID={`view-tab-${tab.key}`}
          >
            {tab.icon}
            <Text style={[styles.viewTabText, viewMode === tab.key && styles.viewTabTextActive]}>{tab.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Error */}
      {dashboardQuery.error ? (
        <View style={styles.errorCard} testID="ivx-autonomous-ops-error">
          <AlertTriangle size={15} color={Colors.error} />
          <Text style={styles.errorText}>{dashboardQuery.error instanceof Error ? dashboardQuery.error.message : 'Failed to load dashboard.'}</Text>
        </View>
      ) : null}

      {/* Loading */}
      {dashboardQuery.isLoading && !data ? (
        <View style={styles.loadingCard}>
          <ShimmerIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading autonomous operations…</Text>
        </View>
      ) : null}

      {/* ── Overview View ── */}
      {data && viewMode === 'overview' ? (
        <>
          {/* Live Feed Preview */}
          <View style={styles.card} testID="ivx-autonomous-ops-live-feed">
            <View style={styles.cardHeaderRow}>
              <Zap size={15} color={Colors.info} />
              <Text style={styles.cardTitle}>Live Activity Feed</Text>
              <Text style={styles.cardBadge}>{liveFeed.length} running</Text>
            </View>
            {liveFeed.length > 0 ? (
              liveFeed.slice(0, 5).map((entry: LiveFeedEntry, i: number) => (
                <View key={i} style={styles.feedRow}>
                  <View style={[styles.feedDot, { backgroundColor: STATUS_COLORS[entry.status] ?? Colors.info }]} />
                  <View style={styles.feedContent}>
                    <View style={styles.feedTopRow}>
                      <Text style={styles.feedAgent}>{entry.agent}</Text>
                      <Text style={styles.feedTime}>{formatTime(entry.time)}</Text>
                    </View>
                    <Text style={styles.feedAction} numberOfLines={2}>{entry.currentAction}</Text>
                    <Text style={styles.feedMeta}>{entry.department} · {entry.status} · {entry.progressPercent}%</Text>
                  </View>
                </View>
              ))
            ) : (
              <View style={styles.emptyInline}>
                <CircleDashed size={16} color={Colors.textTertiary} />
                <Text style={styles.emptyText}>No agents currently running. All agents are IDLE.</Text>
              </View>
            )}
          </View>

          {/* Agent Grid Preview */}
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Bot size={15} color={Colors.primary} />
              <Text style={styles.cardTitle}>Agent Fleet</Text>
              <Text style={styles.cardBadge}>{totalAgents} agents</Text>
            </View>
            {agents.slice(0, 6).map((agent: UnifiedAgent) => (
              <AgentCard key={agent.agentId} agent={agent} onPress={() => { setAgentFilter(agent.agentId); setViewMode('agents'); }} />
            ))}
            {agents.length > 6 ? (
              <Pressable style={styles.viewAllBtn} onPress={() => setViewMode('agents')}>
                <Text style={styles.viewAllText}>View all {agents.length} agents</Text>
                <ChevronRight size={13} color={Colors.primary} />
              </Pressable>
            ) : null}
          </View>

          {/* Category Summary */}
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Filter size={15} color={Colors.primary} />
              <Text style={styles.cardTitle}>Category Breakdown</Text>
            </View>
            {categories.map((cat: CategorySummary) => (
              <CategoryCard
                key={cat.category}
                category={cat.category}
                total={cat.total}
                completed={cat.completed}
                failed={cat.failed}
                blocked={cat.blocked}
                onPress={() => { setCategoryFilter(cat.category); setViewMode('activity'); }}
              />
            ))}
          </View>

          {/* Daily Summary Preview */}
          {summary ? (
            <View style={styles.card} testID="ivx-autonomous-ops-summary">
              <View style={styles.cardHeaderRow}>
                <TrendingUp size={15} color={Colors.primary} />
                <Text style={styles.cardTitle}>Daily Executive Summary</Text>
                <Text style={styles.cardBadge}>{summary.reportDate}</Text>
              </View>
              <View style={styles.summaryGrid}>
                <SummaryStat label="Tasks Started" value={summary.totalTasksStarted} />
                <SummaryStat label="Completed" value={summary.totalTasksCompleted} color={Colors.success} />
                <SummaryStat label="Failed" value={summary.totalTasksFailed} color={summary.totalTasksFailed > 0 ? Colors.error : Colors.textTertiary} />
                <SummaryStat label="Blocked" value={summary.totalTasksBlocked} color={summary.totalTasksBlocked > 0 ? Colors.warning : Colors.textTertiary} />
                <SummaryStat label="Bugs Fixed" value={summary.totalBugsFixed} />
                <SummaryStat label="Revenue Opps" value={summary.totalRevenueOpportunities} color={Colors.success} />
                <SummaryStat label="Owner Actions" value={summary.totalOwnerActionsRequired} color={summary.totalOwnerActionsRequired > 0 ? Colors.warning : Colors.textTertiary} />
                <SummaryStat label="Deploys" value={summary.totalDeployments} />
              </View>
              {summary.topCompletedWork.length > 0 ? (
                <View style={styles.summarySection}>
                  <Text style={styles.summarySectionTitle}>Top Completed Work</Text>
                  {summary.topCompletedWork.map((w: string, i: number) => (
                    <View key={i} style={styles.summaryItem}>
                      <CheckCircle2 size={12} color={Colors.success} />
                      <Text style={styles.summaryItemText} numberOfLines={2}>{w}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
              {summary.topFailures.length > 0 ? (
                <View style={styles.summarySection}>
                  <Text style={styles.summarySectionTitle}>Top Failures</Text>
                  {summary.topFailures.map((f: string, i: number) => (
                    <View key={i} style={styles.summaryItem}>
                      <XCircle size={12} color={Colors.error} />
                      <Text style={styles.summaryItemText} numberOfLines={2}>{f}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
              {summary.next24HourPlan.length > 0 ? (
                <View style={styles.summarySection}>
                  <Text style={styles.summarySectionTitle}>Next 24-Hour Plan</Text>
                  {summary.next24HourPlan.map((p: string, i: number) => (
                    <View key={i} style={styles.summaryItem}>
                      <Clock size={12} color={Colors.info} />
                      <Text style={styles.summaryItemText} numberOfLines={2}>{p}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Owner Action Requests */}
          {ownerActions.length > 0 ? (
            <View style={styles.card} testID="ivx-autonomous-ops-owner-actions">
              <View style={styles.cardHeaderRow}>
                <ShieldAlert size={15} color={Colors.warning} />
                <Text style={styles.cardTitle}>Owner Action Required</Text>
                <Text style={styles.cardBadge}>{ownerActions.length}</Text>
              </View>
              {ownerActions.map((action: OwnerActionEntry) => (
                <View key={action.traceId} style={styles.actionRow}>
                  <View style={[styles.statusDot, { backgroundColor: action.status === 'verified' ? Colors.success : Colors.warning }]} />
                  <View style={styles.actionContent}>
                    <Text style={styles.actionTitle} numberOfLines={2}>{action.title}</Text>
                    <Text style={styles.actionMeta}>{action.status} · {formatDate(action.createdAt)}</Text>
                    {action.blocker ? <Text style={styles.actionBlocker} numberOfLines={2}>{action.blocker}</Text> : null}
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {/* Disclaimer */}
          <Text style={styles.disclaimer}>{data.disclaimer}</Text>
        </>
      ) : null}

      {/* ── Agents View ── */}
      {data && viewMode === 'agents' ? (
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Bot size={15} color={Colors.primary} />
            <Text style={styles.cardTitle}>All Agents ({totalAgents})</Text>
            <Text style={styles.cardBadge}>{data.realAgentCount} real · {data.placeholderAgentCount} idle</Text>
          </View>
          {agents.map((agent: UnifiedAgent) => (
            <AgentCard key={agent.agentId} agent={agent} onPress={() => { setAgentFilter(agent.agentId); setViewMode('activity'); }} />
          ))}
        </View>
      ) : null}

      {/* ── Activity View ── */}
      {data && viewMode === 'activity' ? (
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Activity size={15} color={Colors.primary} />
            <Text style={styles.cardTitle}>Activity Log ({activityItems.length} items)</Text>
          </View>
          {agentFilter ? (
            <View style={styles.filterRow}>
              <Text style={styles.filterText}>Filtered by: {agentFilter}</Text>
              <Pressable onPress={() => setAgentFilter(null)}>
                <Text style={styles.filterClear}>Clear</Text>
              </Pressable>
            </View>
          ) : null}
          {categoryFilter ? (
            <View style={styles.filterRow}>
              <Text style={styles.filterText}>Category: {categoryFilter}</Text>
              <Pressable onPress={() => setCategoryFilter(null)}>
                <Text style={styles.filterClear}>Clear</Text>
              </Pressable>
            </View>
          ) : null}
          {activityItems.length > 0 ? (
            activityItems.map((item: ActivityItem) => <ActivityRow key={item.itemNumber} item={item} />)
          ) : (
            <View style={styles.emptyInline}>
              <CircleDashed size={16} color={Colors.textTertiary} />
              <Text style={styles.emptyText}>No activity recorded for this range.</Text>
            </View>
          )}
        </View>
      ) : null}

      {/* ── Categories View ── */}
      {data && viewMode === 'categories' ? (
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Filter size={15} color={Colors.primary} />
            <Text style={styles.cardTitle}>Category Breakdown</Text>
          </View>
          {categories.map((cat: CategorySummary) => (
            <View key={cat.category} style={styles.categoryDetail}>
              <View style={styles.categoryHeader}>
                {CATEGORY_ICONS[cat.category]}
                <Text style={styles.categoryTitle}>{CATEGORY_LABELS[cat.category]}</Text>
                <View style={styles.categoryCountPill}>
                  <Text style={styles.categoryCountText}>{cat.total}</Text>
                </View>
              </View>
              <View style={styles.categoryMetrics}>
                <MetricChip label="Done" value={cat.completed} color={Colors.success} />
                <MetricChip label="Failed" value={cat.failed} color={cat.failed > 0 ? Colors.error : Colors.textTertiary} />
                <MetricChip label="Blocked" value={cat.blocked} color={cat.blocked > 0 ? Colors.warning : Colors.textTertiary} />
              </View>
              {cat.items.slice(0, 5).map((item: ActivityItem) => <ActivityRow key={item.itemNumber} item={item} />)}
              {cat.items.length > 5 ? (
                <Pressable style={styles.viewAllBtn} onPress={() => { setCategoryFilter(cat.category); setViewMode('activity'); }}>
                  <Text style={styles.viewAllText}>View all {cat.items.length} items</Text>
                  <ChevronRight size={13} color={Colors.primary} />
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      {/* ── Live Feed View ── */}
      {data && viewMode === 'feed' ? (
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Zap size={15} color={Colors.info} />
            <Text style={styles.cardTitle}>Live Activity Feed</Text>
            <View style={styles.livePill}>
              <View style={styles.liveDot} />
              <Text style={styles.livePillText}>LIVE</Text>
            </View>
          </View>
          {liveFeed.length > 0 ? (
            liveFeed.map((entry: LiveFeedEntry, i: number) => (
              <View key={i} style={styles.feedRow}>
                <View style={[styles.feedDot, { backgroundColor: STATUS_COLORS[entry.status] ?? Colors.info }]} />
                <View style={styles.feedContent}>
                  <View style={styles.feedTopRow}>
                    <Text style={styles.feedAgent}>{entry.agent}</Text>
                    <Text style={styles.feedTime}>{formatTime(entry.time)}</Text>
                  </View>
                  <Text style={styles.feedAction} numberOfLines={2}>{entry.currentAction}</Text>
                  <Text style={styles.feedMeta}>{entry.department} · {entry.status} · {entry.progressPercent}%</Text>
                  {entry.traceId ? <Text style={styles.feedTrace}>Trace: {entry.traceId.slice(0, 20)}</Text> : null}
                </View>
              </View>
            ))
          ) : (
            <View style={styles.emptyInline}>
              <Moon size={20} color={Colors.textTertiary} />
              <Text style={styles.emptyText}>No agents currently running. All {totalAgents} agents are IDLE.</Text>
            </View>
          )}
        </View>
      ) : null}

      {/* ── Daily Summary View ── */}
      {data && viewMode === 'summary' && summary ? (
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <TrendingUp size={15} color={Colors.primary} />
            <Text style={styles.cardTitle}>Daily Executive Summary</Text>
            <Text style={styles.cardBadge}>{summary.reportDate}</Text>
          </View>
          <View style={styles.summaryGrid}>
            <SummaryStat label="Tasks Started" value={summary.totalTasksStarted} />
            <SummaryStat label="Completed" value={summary.totalTasksCompleted} color={Colors.success} />
            <SummaryStat label="Failed" value={summary.totalTasksFailed} color={summary.totalTasksFailed > 0 ? Colors.error : Colors.textTertiary} />
            <SummaryStat label="Blocked" value={summary.totalTasksBlocked} color={summary.totalTasksBlocked > 0 ? Colors.warning : Colors.textTertiary} />
            <SummaryStat label="Retries" value={summary.totalRetries} />
            <SummaryStat label="Deployments" value={summary.totalDeployments} />
            <SummaryStat label="Commits" value={summary.totalCodeCommits} />
            <SummaryStat label="Bugs Fixed" value={summary.totalBugsFixed} />
            <SummaryStat label="Investors" value={summary.totalInvestorsProcessed} />
            <SummaryStat label="Buyers" value={summary.totalBuyersProcessed} />
            <SummaryStat label="Leads" value={summary.totalLeadsGenerated} />
            <SummaryStat label="Properties" value={summary.totalPropertiesUpdated} />
            <SummaryStat label="Messages" value={summary.totalMessagesSent} />
            <SummaryStat label="Revenue Opps" value={summary.totalRevenueOpportunities} color={Colors.success} />
            <SummaryStat label="Owner Actions" value={summary.totalOwnerActionsRequired} color={summary.totalOwnerActionsRequired > 0 ? Colors.warning : Colors.textTertiary} />
          </View>

          {/* Agent Utilization */}
          <View style={styles.summarySection}>
            <Text style={styles.summarySectionTitle}>Agent Utilization</Text>
            {summary.agentUtilization.slice(0, 12).map((a: { agentId: string; name: string; tasksToday: number; utilization: number }) => (
              <View key={a.agentId} style={styles.utilizationRow}>
                <Text style={styles.utilizationName}>{a.name}</Text>
                <View style={styles.utilizationBar}>
                  <View style={[styles.utilizationFill, { width: `${a.utilization}%` }]} />
                </View>
                <Text style={styles.utilizationValue}>{a.tasksToday} · {a.utilization}%</Text>
              </View>
            ))}
          </View>

          {summary.topCompletedWork.length > 0 ? (
            <View style={styles.summarySection}>
              <Text style={styles.summarySectionTitle}>Top Completed Work</Text>
              {summary.topCompletedWork.map((w: string, i: number) => (
                <View key={i} style={styles.summaryItem}>
                  <CheckCircle2 size={12} color={Colors.success} />
                  <Text style={styles.summaryItemText}>{w}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {summary.topFailures.length > 0 ? (
            <View style={styles.summarySection}>
              <Text style={styles.summarySectionTitle}>Top Failures</Text>
              {summary.topFailures.map((f: string, i: number) => (
                <View key={i} style={styles.summaryItem}>
                  <XCircle size={12} color={Colors.error} />
                  <Text style={styles.summaryItemText}>{f}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {summary.businessRisks.length > 0 ? (
            <View style={styles.summarySection}>
              <Text style={styles.summarySectionTitle}>Business Risks</Text>
              {summary.businessRisks.map((r: string, i: number) => (
                <View key={i} style={styles.summaryItem}>
                  <AlertTriangle size={12} color={Colors.warning} />
                  <Text style={styles.summaryItemText}>{r}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {summary.next24HourPlan.length > 0 ? (
            <View style={styles.summarySection}>
              <Text style={styles.summarySectionTitle}>Next 24-Hour Plan</Text>
              {summary.next24HourPlan.map((p: string, i: number) => (
                <View key={i} style={styles.summaryItem}>
                  <Clock size={12} color={Colors.info} />
                  <Text style={styles.summaryItemText}>{p}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {/* ── Export View ── */}
      {data && viewMode === 'export' ? (
        <View style={styles.card} testID="ivx-autonomous-ops-export">
          <View style={styles.cardHeaderRow}>
            <Download size={15} color={Colors.primary} />
            <Text style={styles.cardTitle}>Export Dashboard Data</Text>
          </View>

          <Text style={styles.exportSectionLabel}>Report Type</Text>
          <View style={styles.exportOptionsGrid}>
            {(Object.keys(EXPORT_REPORT_LABELS) as ExportReportType[]).map((key) => (
              <Pressable
                key={key}
                style={[styles.exportOption, exportReport === key && styles.exportOptionActive]}
                onPress={() => setExportReport(key)}
                testID={`export-report-${key}`}
              >
                <Text style={[styles.exportOptionText, exportReport === key && styles.exportOptionTextActive]}>
                  {EXPORT_REPORT_LABELS[key]}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.exportSectionLabel}>Format</Text>
          <View style={styles.exportFormatRow}>
            <Pressable
              style={[styles.exportFormatBtn, exportFormat === 'csv' && styles.exportFormatBtnActive]}
              onPress={() => setExportFormat('csv')}
              testID="export-format-csv"
            >
              <FileText size={15} color={exportFormat === 'csv' ? Colors.primary : Colors.textSecondary} />
              <Text style={[styles.exportFormatText, exportFormat === 'csv' && styles.exportFormatTextActive]}>CSV</Text>
            </Pressable>
            <Pressable
              style={[styles.exportFormatBtn, exportFormat === 'json' && styles.exportFormatBtnActive]}
              onPress={() => setExportFormat('json')}
              testID="export-format-json"
            >
              <FileJson size={15} color={exportFormat === 'json' ? Colors.primary : Colors.textSecondary} />
              <Text style={[styles.exportFormatText, exportFormat === 'json' && styles.exportFormatTextActive]}>JSON</Text>
            </Pressable>
            <Pressable
              style={[styles.exportFormatBtn, exportFormat === 'pdf' && styles.exportFormatBtnActive]}
              onPress={() => setExportFormat('pdf')}
              testID="export-format-pdf"
            >
              <FileText size={15} color={exportFormat === 'pdf' ? Colors.primary : Colors.textSecondary} />
              <Text style={[styles.exportFormatText, exportFormat === 'pdf' && styles.exportFormatTextActive]}>PDF</Text>
            </Pressable>
          </View>

          <Pressable
            style={[styles.exportButton, exporting && styles.exportButtonDisabled]}
            onPress={async () => {
              if (exporting || !data) return;
              setExporting(true);
              setExportResult(null);
              const result = await exportDashboard(data, exportFormat, exportReport);
              setExporting(false);
              setExportResult(result.ok ? `Exported: ${EXPORT_REPORT_LABELS[exportReport]} (${exportFormat.toUpperCase()})` : `Export failed: ${result.error}`);
            }}
            disabled={exporting}
            testID="export-execute-btn"
          >
            {exporting ? (
              <ShimmerIndicator size="small" color={Colors.primary} />
            ) : (
              <Download size={16} color={Colors.primary} />
            )}
            <Text style={styles.exportButtonText}>
              {exporting ? 'Generating…' : `Export ${EXPORT_REPORT_LABELS[exportReport]} as ${exportFormat.toUpperCase()}`}
            </Text>
          </Pressable>

          {exportResult ? (
            <View style={styles.exportResultRow} testID="export-result">
              {exportResult.startsWith('Exported') ? (
                <CheckCircle2 size={13} color={Colors.success} />
              ) : (
                <AlertTriangle size={13} color={Colors.error} />
              )}
              <Text style={[styles.exportResultText, { color: exportResult.startsWith('Exported') ? Colors.success : Colors.error }]}>
                {exportResult}
              </Text>
            </View>
          ) : null}

          <View style={styles.exportInfoBox}>
            <ShieldCheck size={13} color={Colors.textTertiary} />
            <Text style={styles.exportInfoText}>
              Owner-only · No secrets · Investor PII redacted · Timestamps in UTC · Trace IDs included · Generated from real records
            </Text>
          </View>
        </View>
      ) : null}

      {/* ── Owner Actions View ── */}
      {data && viewMode === 'ownerActions' ? (
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <ShieldAlert size={15} color={Colors.warning} />
            <Text style={styles.cardTitle}>Owner Action Requests ({ownerActions.length})</Text>
          </View>
          {ownerActions.length > 0 ? (
            ownerActions.map((action: OwnerActionEntry) => (
              <View key={action.traceId} style={styles.actionRow}>
                <View style={[styles.statusDot, { backgroundColor: action.status === 'verified' ? Colors.success : Colors.warning }]} />
                <View style={styles.actionContent}>
                  <Text style={styles.actionTitle}>{action.title}</Text>
                  <Text style={styles.actionMeta}>{action.status} · {formatDate(action.createdAt)} · Trace: {action.traceId.slice(0, 20)}</Text>
                  {action.blocker ? <Text style={styles.actionBlocker}>{action.blocker}</Text> : null}
                </View>
              </View>
            ))
          ) : (
            <View style={styles.emptyInline}>
              <ShieldCheck size={20} color={Colors.success} />
              <Text style={styles.emptyText}>No owner actions required. All systems operating autonomously.</Text>
            </View>
          )}
        </View>
      ) : null}
    </ScrollView>
  );
}

function SummaryStat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <View style={styles.summaryStat}>
      <Text style={[styles.summaryStatValue, color ? { color } : null]}>{value}</Text>
      <Text style={styles.summaryStatLabel}>{label}</Text>
    </View>
  );
}

export default function AutonomousOpsDashboardScreen() {
  return (
    <ErrorBoundary>
      <Stack.Screen options={{ title: 'Autonomous Operations' }} />
      <AutonomousOpsContent />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, gap: 14 },
  heroCard: { backgroundColor: Colors.card, borderRadius: 18, padding: 18, gap: 10, borderWidth: 1, borderColor: Colors.border },
  heroHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text, flex: 1 },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: Colors.success, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  liveDot: { width: 7, height: 7, borderRadius: 999, backgroundColor: Colors.success },
  livePillText: { fontSize: 10, fontWeight: '800' as const, letterSpacing: 0.6, color: Colors.success },
  heroSubtitle: { fontSize: 13, lineHeight: 19, color: Colors.textSecondary },
  heroKpiRow: { flexDirection: 'row', gap: 6 },
  heroKpi: { flex: 1, backgroundColor: Colors.background, borderRadius: 10, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  heroKpiValue: { fontSize: 20, fontWeight: '800' as const, color: Colors.text },
  heroKpiLabel: { fontSize: 9, color: Colors.textSecondary, marginTop: 2, textAlign: 'center' },
  heroMeta: { fontSize: 11, color: Colors.textSecondary },
  rangeRow: { flexDirection: 'row', gap: 6 },
  rangeTab: { flex: 1, backgroundColor: Colors.card, borderRadius: 10, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  rangeTabActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '15' },
  rangeTabText: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary },
  rangeTabTextActive: { color: Colors.primary },
  viewTabsScroll: { flexGrow: 0 },
  viewTabsContent: { gap: 6, paddingHorizontal: 2 },
  viewTab: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.card, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: Colors.border },
  viewTabActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '15' },
  viewTabText: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary },
  viewTabTextActive: { color: Colors.primary },
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.error },
  errorText: { flex: 1, fontSize: 13, color: Colors.error, lineHeight: 18 },
  loadingCard: { alignItems: 'center', padding: 40, gap: 12 },
  loadingText: { fontSize: 14, color: Colors.textSecondary },
  card: { backgroundColor: Colors.card, borderRadius: 16, padding: 16, gap: 10, borderWidth: 1, borderColor: Colors.border },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 14, fontWeight: '700' as const, color: Colors.text, flex: 1 },
  cardBadge: { fontSize: 11, fontWeight: '700' as const, color: Colors.primary },
  agentCard: { backgroundColor: Colors.background, borderRadius: 12, padding: 14, gap: 8, borderWidth: 1, borderColor: Colors.border },
  agentHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  agentNumberBadge: { width: 24, height: 24, borderRadius: 6, backgroundColor: Colors.primary + '20', alignItems: 'center', justifyContent: 'center' },
  agentNumberText: { fontSize: 11, fontWeight: '800' as const, color: Colors.primary },
  agentInfo: { flex: 1, gap: 1 },
  agentName: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  agentDept: { fontSize: 11, color: Colors.textSecondary },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  statusDot: { width: 6, height: 6, borderRadius: 999 },
  statusText: { fontSize: 9, fontWeight: '700' as const, letterSpacing: 0.3 },
  statusPillSmall: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
  statusTextSmall: { fontSize: 8, fontWeight: '700' as const, letterSpacing: 0.3 },
  agentRole: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },
  agentTaskRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  agentTask: { flex: 1, fontSize: 12, color: Colors.info, lineHeight: 17 },
  agentMetrics: { flexDirection: 'row', gap: 6 },
  metricChip: { flex: 1, backgroundColor: Colors.backgroundSecondary, borderRadius: 8, paddingVertical: 8, alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  metricValue: { fontSize: 16, fontWeight: '800' as const },
  metricLabel: { fontSize: 9, color: Colors.textSecondary, marginTop: 2 },
  agentFooter: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border, paddingTop: 6 },
  agentFooterText: { fontSize: 10, color: Colors.textSecondary },
  activityRow: { flexDirection: 'row', gap: 10, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  activityNumberCol: { width: 30, alignItems: 'flex-end' },
  activityNumber: { fontSize: 14, fontWeight: '800' as const, color: Colors.primary },
  activityContent: { flex: 1, gap: 3 },
  activityTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  activityAgent: { flex: 1, fontSize: 13, fontWeight: '700' as const, color: Colors.text },
  activityTask: { fontSize: 12.5, color: Colors.text, lineHeight: 17 },
  activityResult: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },
  activityMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  activityMetaText: { fontSize: 10, color: Colors.textSecondary },
  activityEvidence: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  activityEvidenceText: { fontSize: 10, color: Colors.textSecondary, fontFamily: 'monospace' as const },
  activityError: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  activityErrorText: { flex: 1, fontSize: 11, color: Colors.error, lineHeight: 16 },
  categoryCard: { backgroundColor: Colors.background, borderRadius: 12, padding: 14, gap: 8, borderWidth: 1, borderColor: Colors.border, flexDirection: 'row', alignItems: 'center' },
  categoryHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  categoryTitle: { fontSize: 13, fontWeight: '700' as const, color: Colors.text, flex: 1 },
  categoryCountPill: { backgroundColor: Colors.primary + '20', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  categoryCountText: { fontSize: 12, fontWeight: '800' as const, color: Colors.primary },
  categoryMetrics: { flexDirection: 'row', gap: 6 },
  categoryChevron: { position: 'absolute' as const, right: 14, bottom: 14 },
  categoryDetail: { gap: 8, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  feedRow: { flexDirection: 'row', gap: 8, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  feedDot: { width: 8, height: 8, borderRadius: 999, marginTop: 4 },
  feedContent: { flex: 1, gap: 2 },
  feedTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  feedAgent: { fontSize: 13, fontWeight: '700' as const, color: Colors.text },
  feedTime: { fontSize: 10, color: Colors.textSecondary },
  feedAction: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },
  feedMeta: { fontSize: 10, color: Colors.textSecondary },
  feedTrace: { fontSize: 9, color: Colors.textTertiary, fontFamily: 'monospace' as const },
  actionRow: { flexDirection: 'row', gap: 8, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  actionContent: { flex: 1, gap: 2 },
  actionTitle: { fontSize: 13, fontWeight: '600' as const, color: Colors.text },
  actionMeta: { fontSize: 10, color: Colors.textSecondary },
  actionBlocker: { fontSize: 11, color: Colors.warning, lineHeight: 16 },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  summaryStat: { width: '23%', minWidth: 70, backgroundColor: Colors.background, borderRadius: 10, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  summaryStatValue: { fontSize: 18, fontWeight: '800' as const, color: Colors.text },
  summaryStatLabel: { fontSize: 9, color: Colors.textSecondary, marginTop: 2, textAlign: 'center' },
  summarySection: { marginTop: 8, gap: 6 },
  summarySectionTitle: { fontSize: 12, fontWeight: '700' as const, color: Colors.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  summaryItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  summaryItemText: { flex: 1, fontSize: 12, color: Colors.text, lineHeight: 17 },
  utilizationRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  utilizationName: { fontSize: 11, color: Colors.text, width: 100 },
  utilizationBar: { flex: 1, height: 6, borderRadius: 999, backgroundColor: Colors.border, overflow: 'hidden' },
  utilizationFill: { height: 6, borderRadius: 999, backgroundColor: Colors.primary },
  utilizationValue: { fontSize: 10, color: Colors.textSecondary, width: 60 },
  filterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.backgroundSecondary, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  filterText: { fontSize: 11, color: Colors.textSecondary },
  filterClear: { fontSize: 11, fontWeight: '700' as const, color: Colors.primary },
  viewAllBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 },
  viewAllText: { fontSize: 12, fontWeight: '700' as const, color: Colors.primary },
  emptyInline: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  emptyText: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19, flex: 1 },
  disclaimer: { fontSize: 11, color: Colors.textSecondary, lineHeight: 16, fontStyle: 'italic' as const, paddingHorizontal: 4 },
  exportSectionLabel: { fontSize: 12, fontWeight: '700' as const, color: Colors.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginTop: 6 },
  exportOptionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  exportOption: { backgroundColor: Colors.background, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: Colors.border },
  exportOptionActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '15' },
  exportOptionText: { fontSize: 11, fontWeight: '600' as const, color: Colors.textSecondary },
  exportOptionTextActive: { color: Colors.primary },
  exportFormatRow: { flexDirection: 'row', gap: 8 },
  exportFormatBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.background, borderRadius: 10, paddingVertical: 12, borderWidth: 1, borderColor: Colors.border },
  exportFormatBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '15' },
  exportFormatText: { fontSize: 13, fontWeight: '700' as const, color: Colors.textSecondary },
  exportFormatTextActive: { color: Colors.primary },
  exportButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary + '15', borderRadius: 12, paddingVertical: 14, borderWidth: 1, borderColor: Colors.primary, marginTop: 4 },
  exportButtonDisabled: { opacity: 0.5 },
  exportButtonText: { fontSize: 14, fontWeight: '700' as const, color: Colors.primary },
  exportResultRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  exportResultText: { flex: 1, fontSize: 12, lineHeight: 17 },
  exportInfoBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: Colors.background, borderRadius: 8, padding: 10, marginTop: 4 },
  exportInfoText: { flex: 1, fontSize: 10, color: Colors.textTertiary, lineHeight: 15 }});
