/**
 * Restore Center — migrated from ios-ivx/Ivx/Views/RestoreCenterView.swift
 *
 * Owner admin page for the IVX zero-data-loss system.
 * Shows: backup status, soft-deleted records, vault entries, snapshots,
 * PITR status, two-person approvals, guard audit, recovery drill,
 * daily report, and emergency backup export.
 *
 * Calls the REAL backend at api.ivxholding.com/api/ivx/restore-center/*
 */
import React, { useState, useMemo, useCallback } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Stack } from 'expo-router';
import {
  ArrowLeft,
  Shield,
  Database,
  ArchiveRestore,
  Clock,
  HardDrive,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Download,
  PlayCircle,
  FileText,
  Lock} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { EmptyState } from '@/components/ivx';
import {
  fetchOverview,
  fetchReport,
  runDrill,
  runEmergencyExport,
  type OverviewResponse,
  type ReportResponse,
  type DrillResponse,
  type ExportResponse} from '@/lib/restore-center';

type TabType = 'overview' | 'report' | 'drill' | 'export';

export default function RestoreCenterScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('overview');

  const overviewQuery = useQuery({
    queryKey: ['restore-center-overview'],
    queryFn: fetchOverview,
    staleTime: 60_000});

  // Realtime: invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);

  const reportQuery = useQuery({
    queryKey: ['restore-center-report'],
    queryFn: fetchReport,
    staleTime: 60_000});

  const drillMutation = useMutation({
    mutationFn: runDrill,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['restore-center-overview'] });
    }});

  const exportMutation = useMutation({
    mutationFn: runEmergencyExport,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['restore-center-overview'] });
    }});

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([overviewQuery.refetch(), reportQuery.refetch()]);
    } finally {
      setRefreshing(false);
    }
  }, [overviewQuery, reportQuery]);

  const handleDrill = useCallback(() => {
    Alert.alert(
      'Run Recovery Drill',
      'This tests all backup and recovery systems. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Run Drill',
          onPress: () => {
            drillMutation.mutate();
          }},
      ],
    );
  }, [drillMutation]);

  const handleExport = useCallback(() => {
    Alert.alert(
      'Emergency Export',
      'Creates an immediate snapshot of all protected tables. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Export Now',
          onPress: () => {
            exportMutation.mutate();
          }},
      ],
    );
  }, [exportMutation]);

  const overview = overviewQuery.data?.overview ?? null;
  const report = reportQuery.data?.report ?? null;
  const drillResult = drillMutation.data?.report ?? null;
  const exportResult = exportMutation.data?.export ?? null;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            testID="restore-center-back"
          >
            <ArrowLeft size={22} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Restore Center</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Tab Bar */}
        <View style={styles.tabBar}>
          {([
            { key: 'overview' as TabType, label: 'Overview', icon: Shield },
            { key: 'report' as TabType, label: 'Report', icon: FileText },
            { key: 'drill' as TabType, label: 'Drill', icon: PlayCircle },
            { key: 'export' as TabType, label: 'Export', icon: Download },
          ]).map((tab) => {
            const Icon = tab.icon;
            return (
              <TouchableOpacity
                key={tab.key}
                style={[styles.tab, activeTab === tab.key && styles.tabActive]}
                onPress={() => setActiveTab(tab.key)}
                testID={`restore-tab-${tab.key}`}
              >
                <Icon
                  size={16}
                  color={activeTab === tab.key ? Colors.primary : Colors.textTertiary}
                />
                <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Colors.primary}
            />
          }
        >
          {activeTab === 'overview' && (
            <OverviewTab
              overview={overview}
              isLoading={overviewQuery.isLoading}
              isError={overviewQuery.isError}
              onRetry={() => overviewQuery.refetch()}
            />
          )}

          {activeTab === 'report' && (
            <ReportTab
              report={report}
              isLoading={reportQuery.isLoading}
              isError={reportQuery.isError}
              onRetry={() => reportQuery.refetch()}
            />
          )}

          {activeTab === 'drill' && (
            <DrillTab
              drillResult={drillResult}
              isRunning={drillMutation.isPending}
              onRun={handleDrill}
              error={drillMutation.error?.message}
            />
          )}

          {activeTab === 'export' && (
            <ExportTab
              exportResult={exportResult}
              isRunning={exportMutation.isPending}
              onExport={handleExport}
              error={exportMutation.error?.message}
            />
          )}

          <View style={{ height: 60 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ============ Overview Tab ============

function OverviewTab({
  overview,
  isLoading,
  isError,
  onRetry}: {
  overview: OverviewResponse['overview'] | null;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  if (isLoading) {
    return (
      <View style={styles.centerState}>
        <ShimmerIndicator size="large" color={Colors.primary} />
        <Text style={styles.centerStateText}>Loading restore center…</Text>
      </View>
    );
  }

  if (isError || !overview) {
    return (
      <View style={styles.centerState}>
        <XCircle size={32} color={Colors.error} />
        <Text style={styles.centerStateText}>Could not load overview</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={onRetry}>
          <Text style={styles.retryBtnText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.tabContent}>
      {/* File Vault Status */}
      <SectionCard
        icon={<HardDrive size={20} color={Colors.primary} />}
        title="File Vault"
      >
        <StatusRow
          label="Enabled"
          value={overview.file_vault?.enabled ? 'Yes' : 'No'}
          positive={overview.file_vault?.enabled}
        />
        <StatusRow
          label="Total Snapshots"
          value={String(overview.file_vault?.total_snapshots ?? 0)}
        />
        <StatusRow
          label="Last Snapshot"
          value={overview.file_vault?.last_snapshot_at
            ? new Date(overview.file_vault.last_snapshot_at).toLocaleString()
            : 'Never'}
        />
        <StatusRow
          label="Next Scheduled"
          value={overview.file_vault?.next_scheduled_run
            ? new Date(overview.file_vault.next_scheduled_run).toLocaleString()
            : 'Not scheduled'}
        />
      </SectionCard>

      {/* PITR Status */}
      <SectionCard
        icon={<Clock size={20} color={Colors.gold} />}
        title="Point-in-Time Recovery"
      >
        <StatusRow
          label="Supabase Reachable"
          value={overview.pitr?.supabase_reachable ? 'Yes' : 'No'}
          positive={overview.pitr?.supabase_reachable === true}
        />
        <StatusRow
          label="PITR Alert"
          value={overview.pitr?.pitr_alert || 'None'}
          negative={!!overview.pitr?.pitr_alert && overview.pitr.pitr_alert !== 'None'}
        />
        <StatusRow
          label="Restore Window"
          value={overview.pitr?.restore_window_note || 'Unknown'}
        />
        <StatusRow
          label="Newest Write"
          value={overview.pitr?.newest_write_at
            ? new Date(overview.pitr.newest_write_at).toLocaleString()
            : 'Unknown'}
        />
        {overview.pitr?.recommendation && (
          <View style={styles.recommendationBox}>
            <AlertTriangle size={14} color={Colors.gold} />
            <Text style={styles.recommendationText}>{overview.pitr.recommendation}</Text>
          </View>
        )}
      </SectionCard>

      {/* Two-Person Approvals */}
      <SectionCard
        icon={<Lock size={20} color={Colors.blue} />}
        title="Two-Person Approvals"
      >
        <StatusRow
          label="Pending Approvals"
          value={String(overview.two_person_approvals?.pending_count ?? 0)}
          negative={(overview.two_person_approvals?.pending_count ?? 0) > 0}
        />
      </SectionCard>

      {/* Guard Audit */}
      <SectionCard
        icon={<Shield size={20} color={Colors.success} />}
        title="Guard Audit"
      >
        <StatusRow
          label="Total Logged Events"
          value={String(overview.guard_audit?.total_logged ?? 0)}
        />
      </SectionCard>

      {/* Protected Tables */}
      <SectionCard
        icon={<Database size={20} color={Colors.primary} />}
        title="Protected Tables"
      >
        <StatusRow
          label="Protected Count"
          value={String(overview.protected_table_count ?? 0)}
          positive={(overview.protected_table_count ?? 0) > 0}
        />
        {overview.protected_tables && overview.protected_tables.length > 0 && (
          <View style={styles.tableList}>
            {overview.protected_tables.map((table) => (
              <View key={table} style={styles.tableChip}>
                <Text style={styles.tableChipText}>{table}</Text>
              </View>
            ))}
          </View>
        )}
      </SectionCard>
    </View>
  );
}

// ============ Report Tab ============

function ReportTab({
  report,
  isLoading,
  isError,
  onRetry}: {
  report: ReportResponse['report'] | null;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  if (isLoading) {
    return (
      <View style={styles.centerState}>
        <ShimmerIndicator size="large" color={Colors.primary} />
        <Text style={styles.centerStateText}>Loading daily report…</Text>
      </View>
    );
  }

  if (isError || !report) {
    return (
      <View style={styles.centerState}>
        <XCircle size={32} color={Colors.error} />
        <Text style={styles.centerStateText}>Could not load report</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={onRetry}>
          <Text style={styles.retryBtnText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.tabContent}>
      <SectionCard
        icon={<FileText size={20} color={Colors.primary} />}
        title={`Daily Report — ${report.date}`}
      >
        <StatusRow label="Generated" value={new Date(report.generated_at).toLocaleString()} />
        <StatusRow
          label="File Vault Enabled"
          value={report.backup_status.file_vault_enabled ? 'Yes' : 'No'}
          positive={report.backup_status.file_vault_enabled}
        />
        <StatusRow
          label="Last Snapshot"
          value={report.backup_status.file_vault_last_snapshot_at
            ? new Date(report.backup_status.file_vault_last_snapshot_at).toLocaleString()
            : 'Never'}
        />
        <StatusRow
          label="Total Snapshots"
          value={String(report.backup_status.file_vault_total_snapshots)}
        />
        <StatusRow
          label="Supabase Reachable"
          value={report.backup_status.supabase_reachable ? 'Yes' : 'No'}
          positive={report.backup_status.supabase_reachable === true}
        />
        <StatusRow label="Vault Size" value={report.vault_size_note} />
        <StatusRow
          label="Recovery Risk"
          value={report.recovery_risk}
          negative={report.recovery_risk.toLowerCase().includes('high') || report.recovery_risk.toLowerCase().includes('critical')}
          positive={report.recovery_risk.toLowerCase().includes('low')}
        />
        <Text style={styles.recommendation}>{report.recommendation}</Text>
      </SectionCard>

      {/* Row Counts */}
      <SectionCard
        icon={<Database size={20} color={Colors.primary} />}
        title="Row Counts"
      >
        {report.row_counts.map((rc) => (
          <StatusRow
            key={rc.table}
            label={rc.table}
            value={rc.exists ? String(rc.count ?? 0) : 'TABLE MISSING'}
            negative={!rc.exists}
          />
        ))}
      </SectionCard>

      {/* Soft-Deleted Counts */}
      {report.soft_deleted_counts && report.soft_deleted_counts.length > 0 && (
        <SectionCard
          icon={<ArchiveRestore size={20} color={Colors.gold} />}
          title="Soft-Deleted Records"
        >
          {report.soft_deleted_counts.map((sc) => (
            <StatusRow
              key={sc.table}
              label={sc.table}
              value={String(sc.count)}
              negative={sc.count > 0}
            />
          ))}
        </SectionCard>
      )}
    </View>
  );
}

// ============ Drill Tab ============

function DrillTab({
  drillResult,
  isRunning,
  onRun,
  error}: {
  drillResult: DrillResponse['report'] | null;
  isRunning: boolean;
  onRun: () => void;
  error?: string;
}) {
  return (
    <View style={styles.tabContent}>
      <SectionCard
        icon={<PlayCircle size={20} color={Colors.primary} />}
        title="Recovery Drill"
      >
        <Text style={styles.tabDescription}>
          Runs a full recovery drill testing all backup and restore systems.
          This verifies snapshots, vault entries, PITR, and table integrity.
        </Text>

        <TouchableOpacity
          style={[styles.actionButton, isRunning && styles.actionButtonDisabled]}
          onPress={onRun}
          disabled={isRunning}
          testID="run-drill-btn"
        >
          {isRunning ? (
            <ShimmerIndicator size="small" color="#000" />
          ) : (
            <Text style={styles.actionButtonText}>Run Recovery Drill</Text>
          )}
        </TouchableOpacity>

        {error && (
          <View style={styles.errorBox}>
            <XCircle size={16} color={Colors.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
      </SectionCard>

      {drillResult && (
        <SectionCard
          icon={
            drillResult.overall_passed
              ? <CheckCircle size={20} color={Colors.success} />
              : <XCircle size={20} color={Colors.error} />
          }
          title={`Drill Result — ${drillResult.overall_passed ? 'PASSED' : 'FAILED'}`}
        >
          <StatusRow label="Duration" value={`${drillResult.duration_ms}ms`} />
          <StatusRow
            label="Passed"
            value={String(drillResult.summary.passed)}
            positive
          />
          <StatusRow
            label="Failed"
            value={String(drillResult.summary.failed)}
            negative={drillResult.summary.failed > 0}
          />
          <StatusRow label="Total" value={String(drillResult.summary.total)} />

          <View style={styles.stepsList}>
            {drillResult.steps.map((step, i) => (
              <View key={i} style={styles.stepRow}>
                {step.passed ? (
                  <CheckCircle size={16} color={Colors.success} />
                ) : (
                  <XCircle size={16} color={Colors.error} />
                )}
                <View style={styles.stepInfo}>
                  <Text style={styles.stepName}>{step.step}</Text>
                  <Text style={styles.stepDetail}>{step.detail}</Text>
                </View>
              </View>
            ))}
          </View>
        </SectionCard>
      )}
    </View>
  );
}

// ============ Export Tab ============

function ExportTab({
  exportResult,
  isRunning,
  onExport,
  error}: {
  exportResult: ExportResponse['export'] | null;
  isRunning: boolean;
  onExport: () => void;
  error?: string;
}) {
  return (
    <View style={styles.tabContent}>
      <SectionCard
        icon={<Download size={20} color={Colors.primary} />}
        title="Emergency Export"
      >
        <Text style={styles.tabDescription}>
          Creates an immediate snapshot of all protected tables.
          Use this before making major changes or if you suspect data loss.
        </Text>

        <TouchableOpacity
          style={[styles.actionButton, isRunning && styles.actionButtonDisabled]}
          onPress={onExport}
          disabled={isRunning}
          testID="run-export-btn"
        >
          {isRunning ? (
            <ShimmerIndicator size="small" color="#000" />
          ) : (
            <Text style={styles.actionButtonText}>Export Snapshot Now</Text>
          )}
        </TouchableOpacity>

        {error && (
          <View style={styles.errorBox}>
            <XCircle size={16} color={Colors.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
      </SectionCard>

      {exportResult && (
        <SectionCard
          icon={<CheckCircle size={20} color={Colors.success} />}
          title="Export Complete"
        >
          <StatusRow label="Snapshot ID" value={exportResult.snapshot_id} />
          <StatusRow label="Timestamp" value={new Date(exportResult.timestamp).toLocaleString()} />
          <StatusRow label="Tables" value={String(exportResult.tables)} />
          <StatusRow label="Total Rows" value={exportResult.total_rows.toLocaleString()} />
          <Text style={styles.recommendation}>{exportResult.message}</Text>
        </SectionCard>
      )}
    </View>
  );
}

// ============ Shared Components ============

function SectionCard({
  icon,
  title,
  children}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        {icon}
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function StatusRow({
  label,
  value,
  positive,
  negative}: {
  label: string;
  value: string;
  positive?: boolean;
  negative?: boolean;
}) {
  const valueColor = positive
    ? Colors.success
    : negative
    ? Colors.error
    : Colors.text;

  return (
    <View style={styles.statusRow}>
      <Text style={styles.statusLabel}>{label}</Text>
      <Text style={[styles.statusValue, { color: valueColor }]}>{value}</Text>
    </View>
  );
}

// ============ Styles ============

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  safeArea: {
    flex: 1},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12},
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    alignItems: 'center',
    justifyContent: 'center'},
  headerTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700' as const},
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8},
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  tabActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '15'},
  tabText: {
    color: Colors.textTertiary,
    fontSize: 12,
    fontWeight: '600' as const},
  tabTextActive: {
    color: Colors.primary,
    fontWeight: '800' as const},
  tabContent: {
    paddingHorizontal: 20,
    paddingTop: 8},
  sectionCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    marginBottom: 16,
    overflow: 'hidden'},
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder},
  sectionTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700' as const},
  sectionBody: {
    padding: 16,
    gap: 10},
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12},
  statusLabel: {
    color: Colors.textTertiary,
    fontSize: 13,
    fontWeight: '600' as const,
    flex: 1},
  statusValue: {
    fontSize: 13,
    fontWeight: '700' as const,
    textAlign: 'right',
    flex: 1},
  recommendation: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4},
  recommendationBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: 'rgba(255,215,0,0.1)',
    borderRadius: 10,
    padding: 12,
    marginTop: 4},
  recommendationText: {
    color: Colors.gold,
    fontSize: 12,
    flex: 1,
    lineHeight: 17},
  tableList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4},
  tableChip: {
    backgroundColor: Colors.background,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  tableChipText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '600' as const},
  tabDescription: {
    color: Colors.textTertiary,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 8},
  actionButton: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center'},
  actionButtonDisabled: {
    opacity: 0.6},
  actionButtonText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '800' as const},
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,59,92,0.1)',
    borderRadius: 10,
    padding: 12,
    marginTop: 8},
  errorText: {
    color: Colors.error,
    fontSize: 13,
    flex: 1},
  stepsList: {
    gap: 10,
    marginTop: 8},
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10},
  stepInfo: {
    flex: 1},
  stepName: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700' as const},
  stepDetail: {
    color: Colors.textTertiary,
    fontSize: 12,
    marginTop: 2},
  centerState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 12},
  centerStateText: {
    color: Colors.textTertiary,
    fontSize: 14,
    textAlign: 'center'},
  retryBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 10},
  retryBtnText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '800' as const}});
