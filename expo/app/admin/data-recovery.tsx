/**
 * IVX Data Recovery Center — owner-facing screen for enterprise data
 * protection, backup monitoring, and disaster recovery.
 *
 * Located at: Admin HQ → Data Recovery
 * Route: /admin/data-recovery
 */

import React, { useCallback, useEffect, useState } from 'react';
import {View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  StyleSheet,
  Alert,
  Linking} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  Shield, Database, HardDrive, DollarSign, AlertTriangle,
  CheckCircle, XCircle, Clock, RefreshCw, FileText, Zap,
  ChevronLeft, Activity, Archive, Lock} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  fetchRecoveryOverview,
  triggerSnapshot,
  runRecoveryDrill,
  generateReport,
  type RecoveryOverview} from '@/lib/enterprise-recovery-client';

const GOLD = Colors.gold;
const GREEN = '#00C48C';
const RED = '#FF4D4D';
const BLUE = '#4A90D9';
const ORANGE = '#F59E0B';

export default function DataRecoveryScreen() {
  const [overview, setOverview] = useState<RecoveryOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const data = await fetchRecoveryOverview();
      setOverview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load recovery data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const handleAction = useCallback(async (
    action: 'snapshot' | 'drill' | 'report',
  ) => {
    setActionLoading(action);
    try {
      if (action === 'snapshot') {
        await triggerSnapshot();
        Alert.alert('Snapshot Created', 'A new vault snapshot has been created successfully.');
      } else if (action === 'drill') {
        const result = await runRecoveryDrill();
        Alert.alert(
          'Recovery Drill Complete',
          `${result.summary.passed}/${result.summary.total} steps passed. ${result.summary.failed} failed.`,
        );
      } else if (action === 'report') {
        const result = await generateReport();
        Alert.alert('Report Generated', `Recovery risk: ${result.report.recoveryRisk}`);
      }
      void loadData(true);
    } catch (err) {
      Alert.alert('Action Failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setActionLoading(null);
    }
  }, [loadData]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ShimmerIndicator size="large" color={GOLD} />
        <Text style={styles.loadingText}>Loading Recovery Center…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <AlertTriangle size={48} color={RED} />
        <Text style={styles.errorTitle}>Failed to Load</Text>
        <Text style={styles.errorDetail}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => void loadData()}>
          <RefreshCw size={20} color="#000" />
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const monitoring = overview?.monitoring;
  const objectives = overview?.objectives;
  const validation = overview?.validation;
  const financial = overview?.financial;
  const storage = overview?.storage;
  const pitr = overview?.pitr;
  const guard = overview?.guard;
  const vault = overview?.vault;

  const statusColor = (status: string) =>
    status === 'healthy' ? GREEN : status === 'warning' ? ORANGE : RED;

  const StatusIcon = ({ status, size = 16 }: { status: string; size?: number }) => {
    if (status === 'healthy') return <CheckCircle size={size} color={GREEN} />;
    if (status === 'warning') return <AlertTriangle size={size} color={ORANGE} />;
    return <XCircle size={size} color={RED} />;
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ChevronLeft size={24} color={GOLD} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Data Recovery</Text>
        <TouchableOpacity onPress={() => void loadData(true)} disabled={refreshing}>
          <RefreshCw size={20} color={GOLD} style={{ opacity: refreshing ? 0.5 : 1 }} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadData(true)}
            tintColor={GOLD}
            colors={[GOLD]}
          />
        }
      >
        {/* Overall Status Banner */}
        <View style={[styles.banner, { backgroundColor: `${statusColor(overview?.overallStatus ?? 'warning')}15` }]}>
          <StatusIcon status={overview?.overallStatus ?? 'warning'} size={28} />
          <View style={styles.bannerText}>
            <Text style={[styles.bannerTitle, { color: statusColor(overview?.overallStatus ?? 'warning') }]}>
              {overview?.overallStatus === 'healthy' ? 'All Systems Healthy' : overview?.overallStatus === 'critical' ? 'Critical Issues Detected' : 'Warnings Detected'}
            </Text>
            <Text style={styles.bannerSubtitle}>
              {overview?.activeAlerts ?? 0} active alert{(overview?.activeAlerts ?? 0) !== 1 ? 's' : ''} · {monitoring?.checks.length ?? 0} monitors
            </Text>
          </View>
        </View>

        {/* Quick Actions */}
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => handleAction('snapshot')}
            disabled={actionLoading !== null}
          >
            {actionLoading === 'snapshot' ? (
              <ShimmerIndicator size="small" color={GOLD} />
            ) : (
              <Archive size={22} color={GOLD} />
            )}
            <Text style={styles.actionLabel}>Snapshot</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => handleAction('drill')}
            disabled={actionLoading !== null}
          >
            {actionLoading === 'drill' ? (
              <ShimmerIndicator size="small" color={GOLD} />
            ) : (
              <Zap size={22} color={GOLD} />
            )}
            <Text style={styles.actionLabel}>Drill</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => handleAction('report')}
            disabled={actionLoading !== null}
          >
            {actionLoading === 'report' ? (
              <ShimmerIndicator size="small" color={GOLD} />
            ) : (
              <FileText size={22} color={GOLD} />
            )}
            <Text style={styles.actionLabel}>Report</Text>
          </TouchableOpacity>
        </View>

        {/* Recovery Objectives */}
        {objectives && (
          <Section title="Recovery Objectives" icon={<Shield size={18} color={GOLD} />}>
            <MetricRow label="RPO Target" value={objectives.objectives.rpoTargetMinutes + ' min'} />
            <MetricRow label="RTO Target" value={objectives.objectives.rtoTargetMinutes + ' min'} />
            <MetricRow label="Critical RPO" value={objectives.objectives.criticalRpoMinutes + ' min'} />
            <MetricRow label="Storage RPO" value={objectives.objectives.storageRpoHours + 'h'} />
            <MetricRow label="Daily Retention" value={objectives.objectives.dailyRetentionDays + ' days'} />
            <MetricRow label="Monthly Archive" value={objectives.objectives.monthlyRetentionMonths + ' months'} />
            <MetricRow label="Snapshot Freq" value={objectives.objectives.snapshotFrequencyHours + 'h'} />
            <MetricRow label="Restore Drill" value={objectives.objectives.restoreDrillFrequencyDays + ' days'} />
            {objectives.gaps.length > 0 && (
              <View style={styles.gapsContainer}>
                {objectives.gaps.map((gap, i) => (
                  <View key={i} style={styles.gapItem}>
                    <AlertTriangle size={14} color={ORANGE} />
                    <Text style={styles.gapText}>{gap}</Text>
                  </View>
                ))}
              </View>
            )}
          </Section>
        )}

        {/* Monitoring Checks */}
        {monitoring && (
          <Section title="Monitoring" icon={<Activity size={18} color={GOLD} />}>
            {monitoring.checks.map((check, i) => (
              <View key={i} style={styles.checkRow}>
                <StatusIcon status={check.status} />
                <View style={styles.checkContent}>
                  <Text style={styles.checkService}>{check.service} · {check.entity}</Text>
                  <Text style={styles.checkDetail}>{check.detail}</Text>
                </View>
              </View>
            ))}
            <View style={styles.complianceRow}>
              <View style={styles.complianceItem}>
                <Text style={styles.complianceLabel}>RPO</Text>
                <StatusIcon status={monitoring.rpoCompliant ? 'healthy' : 'warning'} />
              </View>
              <View style={styles.complianceItem}>
                <Text style={styles.complianceLabel}>RTO</Text>
                <StatusIcon status={monitoring.rtoCompliant ? 'healthy' : 'critical'} />
              </View>
            </View>
          </Section>
        )}

        {/* PITR Status */}
        {pitr && (
          <Section title="PITR Status" icon={<Clock size={18} color={GOLD} />}>
            <MetricRow
              label="Supabase Reachable"
              value={pitr.supabaseReachable ? 'YES' : 'NO'}
              valueColor={pitr.supabaseReachable ? GREEN : RED}
            />
            <MetricRow
              label="PITR Confirmed"
              value={pitr.pitrDashboardConfirmed === true ? 'ENABLED' : pitr.pitrDashboardConfirmed === false ? 'NOT ENABLED' : 'UNCONFIRMED'}
              valueColor={pitr.pitrDashboardConfirmed === true ? GREEN : RED}
            />
            {pitr.pitrAlert && (
              <View style={styles.alertBox}>
                <AlertTriangle size={14} color={ORANGE} />
                <Text style={styles.alertText}>{pitr.pitrAlert}</Text>
              </View>
            )}
            {pitr.pitrDashboardConfirmed !== true && (
              <TouchableOpacity
                style={styles.linkButton}
                onPress={() => Linking.openURL('https://supabase.com/dashboard/project/kvclcdjmjghndxsngfzb/database/backups')}
              >
                <Text style={styles.linkText}>Open Supabase Backups Dashboard →</Text>
              </TouchableOpacity>
            )}
            <Text style={styles.noteText}>{pitr.restoreWindowNote}</Text>
          </Section>
        )}

        {/* Backup Validation */}
        {validation && (
          <Section title="Backup Validation" icon={<CheckCircle size={18} color={GOLD} />}>
            <MetricRow
              label="Overall"
              value={validation.overallPassed ? 'PASSED' : 'FAILED'}
              valueColor={validation.overallPassed ? GREEN : RED}
            />
            <MetricRow label="Checks Passed" value={`${validation.passed}/${validation.passed + validation.failed}`} />
            <MetricRow label="Snapshot ID" value={validation.snapshotId ?? 'NONE'} />
            {validation.checks.map((check, i) => (
              <View key={i} style={styles.checkRow}>
                <StatusIcon status={check.passed ? 'healthy' : check.severity === 'critical' ? 'critical' : 'warning'} />
                <View style={styles.checkContent}>
                  <Text style={styles.checkService}>{check.check}</Text>
                  <Text style={styles.checkDetail}>{check.detail}</Text>
                </View>
              </View>
            ))}
          </Section>
        )}

        {/* Vault Snapshots */}
        {vault && (
          <Section title="Data Vault" icon={<Database size={18} color={GOLD} />}>
            <MetricRow label="Total Snapshots" value={String(vault.totalSnapshots)} />
            <MetricRow label="Last Snapshot" value={vault.state.lastSnapshotAt ?? 'NONE'} />
            <MetricRow label="Next Scheduled" value={vault.state.nextScheduledRun ?? '—'} />
            <MetricRow label="Tables Monitored" value={String(vault.state.config.tables.length)} />
            {vault.recentSnapshots.length > 0 && (
              <View style={styles.snapshotsList}>
                {vault.recentSnapshots.slice(0, 5).map((snap, i) => (
                  <View key={i} style={styles.snapshotItem}>
                    <Archive size={14} color={BLUE} />
                    <Text style={styles.snapshotId}>{snap.snapshotId.slice(0, 30)}…</Text>
                    <Text style={styles.snapshotRows}>{snap.totalRows} rows</Text>
                  </View>
                ))}
              </View>
            )}
          </Section>
        )}

        {/* Data-Loss Guard */}
        {guard && (
          <Section title="Data-Loss Guard" icon={<Lock size={18} color={GOLD} />}>
            <MetricRow label="Protected Tables" value={String(guard.protectedTablesCount)} />
            <MetricRow label="Blocked Operations" value={String(guard.blockedCount)} />
            {guard.recentAudit.slice(0, 5).map((audit, i) => (
              <View key={i} style={styles.checkRow}>
                <StatusIcon status={audit.allowed ? 'warning' : 'healthy'} />
                <View style={styles.checkContent}>
                  <Text style={styles.checkService} numberOfLines={1}>{audit.operation.slice(0, 60)}</Text>
                  <Text style={styles.checkDetail}>{audit.blocker ?? 'ALLOWED'}</Text>
                </View>
              </View>
            ))}
          </Section>
        )}

        {/* Financial Protection */}
        {financial && (
          <Section title="Financial Protection" icon={<DollarSign size={18} color={GOLD} />}>
            <MetricRow label="Total Wallets" value={String(financial.totalWallets)} />
            <MetricRow label="Ledger Entries" value={String(financial.totalLedgerEntries)} />
            <MetricRow
              label="Reconciliation"
              value={financial.reconciliationPassed ? 'PASSED' : 'FAILED'}
              valueColor={financial.reconciliationPassed ? GREEN : RED}
            />
            <MetricRow label="Orphan Transactions" value={String(financial.orphanTransactions)} valueColor={financial.orphanTransactions > 0 ? RED : GREEN} />
            <MetricRow label="Duplicate Keys" value={String(financial.duplicateIdempotencyKeys)} valueColor={financial.duplicateIdempotencyKeys > 0 ? RED : GREEN} />
            {financial.mismatches.length > 0 && (
              <View style={styles.gapsContainer}>
                {financial.mismatches.map((m, i) => (
                  <View key={i} style={styles.gapItem}>
                    <AlertTriangle size={14} color={m.severity === 'critical' ? RED : ORANGE} />
                    <Text style={styles.gapText}>{m.detail}</Text>
                  </View>
                ))}
              </View>
            )}
            <Text style={styles.noteText}>{financial.recommendation}</Text>
          </Section>
        )}

        {/* Storage Backup */}
        {storage && (
          <Section title="Storage Backup" icon={<HardDrive size={18} color={GOLD} />}>
            <MetricRow label="Buckets Protected" value={`${storage.bucketsProtected}/${storage.buckets.length}`} />
            <MetricRow label="Total Objects" value={String(storage.totalObjects)} />
            <MetricRow label="Total Size" value={`${(storage.totalBytes / (1024 * 1024)).toFixed(2)} MB`} />
            {storage.buckets.map((b, i) => (
              <View key={i} style={styles.checkRow}>
                <StatusIcon status={b.exists && b.error === null ? 'healthy' : 'warning'} />
                <View style={styles.checkContent}>
                  <Text style={styles.checkService}>{b.bucket}</Text>
                  <Text style={styles.checkDetail}>
                    {b.exists ? `${b.objectCount} objects · ${(b.totalBytes / 1024).toFixed(1)}KB` : b.error ?? 'not found'}
                  </Text>
                </View>
              </View>
            ))}
          </Section>
        )}

        {/* DR Runbook Link */}
        <TouchableOpacity
          style={styles.runbookButton}
          onPress={() => Linking.openURL('https://github.com/ibb142/ivx-holdings-platform/blob/main/docs/DISASTER-RECOVERY-RUNBOOK.md')}
        >
          <FileText size={20} color={GOLD} />
          <Text style={styles.runbookText}>Open Disaster Recovery Runbook</Text>
          <ChevronLeft size={18} color={GOLD} style={{ transform: [{ rotate: '180deg' }] }} />
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        {icon}
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function MetricRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.metricRow}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, valueColor ? { color: valueColor } : null]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000'},
  loadingContainer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16},
  loadingText: {
    color: '#909090',
    fontSize: 14},
  errorContainer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 12},
  errorTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700'},
  errorDetail: {
    color: '#909090',
    fontSize: 13,
    textAlign: 'center'},
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: GOLD,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 12},
  retryButtonText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 15},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A'},
  backButton: {
    padding: 4},
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700'},
  scrollView: {
    flex: 1},
  scrollContent: {
    padding: 16,
    gap: 16},
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 12},
  bannerText: {
    flex: 1},
  bannerTitle: {
    fontSize: 16,
    fontWeight: '700'},
  bannerSubtitle: {
    color: '#909090',
    fontSize: 13,
    marginTop: 2},
  actionsRow: {
    flexDirection: 'row',
    gap: 12},
  actionButton: {
    flex: 1,
    backgroundColor: '#141414',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#2A2A2A'},
  actionLabel: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600'},
  section: {
    backgroundColor: '#141414',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2A2A2A'},
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A'},
  sectionTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700'},
  sectionBody: {
    padding: 14,
    gap: 10},
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'},
  metricLabel: {
    color: '#909090',
    fontSize: 13},
  metricValue: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    maxWidth: '60%'},
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8},
  checkContent: {
    flex: 1},
  checkService: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '500'},
  checkDetail: {
    color: '#909090',
    fontSize: 12,
    marginTop: 2},
  complianceRow: {
    flexDirection: 'row',
    gap: 24,
    marginTop: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#2A2A2A'},
  complianceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  complianceLabel: {
    color: '#909090',
    fontSize: 13},
  gapsContainer: {
    gap: 6,
    marginTop: 4},
  gapItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6},
  gapText: {
    color: ORANGE,
    fontSize: 12,
    flex: 1},
  alertBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: `${ORANGE}15`,
    padding: 10,
    borderRadius: 8},
  alertText: {
    color: ORANGE,
    fontSize: 12,
    flex: 1},
  linkButton: {
    paddingVertical: 8},
  linkText: {
    color: BLUE,
    fontSize: 13,
    fontWeight: '600'},
  noteText: {
    color: '#555',
    fontSize: 11,
    fontStyle: 'italic'},
  snapshotsList: {
    gap: 6,
    marginTop: 4},
  snapshotItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6},
  snapshotId: {
    color: '#fff',
    fontSize: 11,
    flex: 1},
  snapshotRows: {
    color: GREEN,
    fontSize: 11,
    fontWeight: '600'},
  runbookButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#141414',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2A2A2A'},
  runbookText: {
    color: GOLD,
    fontSize: 14,
    fontWeight: '600',
    flex: 1}});
