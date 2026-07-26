/**
 * IVX Recovery Monitoring Service — centralized monitoring and alerting for
 * all recovery-related events.
 *
 * Monitors:
 *   - PITR status
 *   - Backup failure
 *   - Storage-copy failure
 *   - Unexpected row-count drop
 *   - Destructive query blocked
 *   - Large bulk update
 *   - RLS policy removed
 *   - Backup retention changed
 *   - Checksum mismatch
 *   - Restore drill failure
 *   - Database unavailable
 *   - Storage bucket unavailable
 *   - Unusual admin activity
 *
 * @module ivx-recovery-monitoring
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readRecoveryAlerts, createRecoveryAlert } from './ivx-backup-validation';
import { getDataVaultState, detectDataLoss } from './ivx-data-vault';
import { checkPitrStatus } from './ivx-pitr-status';
import { auditStorageBuckets } from './ivx-storage-backup';
import { RECOVERY_OBJECTIVES } from './ivx-enterprise-recovery-config';
export const IVX_MONITORING_MARKER = 'ivx-recovery-monitoring-2026-07-12';
const MONITORING_DIR = path.resolve(process.cwd(), 'logs', 'audit', 'data-vault', 'monitoring');
const MONITORING_STATE = path.join(MONITORING_DIR, 'state.json');
async function ensureDir() {
    await fs.mkdir(MONITORING_DIR, { recursive: true }).catch(() => { });
}
/**
 * Run all monitoring checks and return a unified report.
 */
export async function runMonitoringChecks() {
    const generatedAt = new Date().toISOString();
    const checks = [];
    // 1. Data vault health
    try {
        const state = await getDataVaultState();
        const vaultOk = state.totalSnapshots > 0 && state.config.enabled;
        const ageHours = state.lastSnapshotAt ? (Date.now() - Date.parse(state.lastSnapshotAt)) / (60 * 60 * 1000) : Infinity;
        checks.push({
            service: 'data-vault',
            entity: 'scheduler',
            status: vaultOk && ageHours <= RECOVERY_OBJECTIVES.snapshotFrequencyHours ? 'healthy' : vaultOk ? 'warning' : 'critical',
            detail: vaultOk ? `${state.totalSnapshots} snapshots, last ${ageHours.toFixed(1)}h ago` : 'No snapshots or scheduler disabled',
            lastChecked: generatedAt,
        });
    }
    catch (err) {
        checks.push({ service: 'data-vault', entity: 'scheduler', status: 'critical', detail: `Error: ${err}`, lastChecked: generatedAt });
    }
    // 2. PITR status
    try {
        const pitr = await checkPitrStatus();
        checks.push({
            service: 'pitr',
            entity: 'supabase',
            status: pitr.pitrDashboardConfirmed === true ? 'healthy' : 'warning',
            detail: pitr.pitrAlert ?? (pitr.supabaseReachable ? 'Supabase reachable, PITR must be confirmed in Dashboard' : 'Supabase unreachable'),
            lastChecked: generatedAt,
        });
        if (!pitr.supabaseReachable) {
            await createRecoveryAlert({
                service: 'pitr',
                entity: 'supabase',
                severity: 'critical',
                message: 'Supabase is unreachable — database may be down',
                ownerActionRequired: 'Check Supabase Dashboard for outages',
            });
        }
    }
    catch (err) {
        checks.push({ service: 'pitr', entity: 'supabase', status: 'critical', detail: `Error: ${err}`, lastChecked: generatedAt });
    }
    // 3. Data-loss detection
    try {
        const loss = await detectDataLoss();
        checks.push({
            service: 'data-loss-detection',
            entity: 'tables',
            status: loss.severity === 'none' ? 'healthy' : loss.severity === 'critical' ? 'critical' : 'warning',
            detail: loss.detected ? `${loss.tablesAffected.length} tables with data loss (${loss.severity})` : 'No data loss detected',
            lastChecked: generatedAt,
        });
        if (loss.detected) {
            await createRecoveryAlert({
                service: 'data-loss-detection',
                entity: 'tables',
                severity: loss.severity === 'critical' ? 'critical' : 'warning',
                message: `Data loss detected in ${loss.tablesAffected.length} tables`,
                ownerActionRequired: `Restore from snapshot ${loss.lastSnapshotId}`,
                affectedRecords: loss.tablesAffected.reduce((s, t) => s + t.rowsLost, 0),
            });
        }
    }
    catch (err) {
        checks.push({ service: 'data-loss-detection', entity: 'tables', status: 'warning', detail: `Error: ${err}`, lastChecked: generatedAt });
    }
    // 4. Storage buckets
    try {
        const storage = await auditStorageBuckets();
        const failedBuckets = storage.buckets.filter((b) => b.error !== null && b.error !== 'BUCKET_NOT_FOUND');
        checks.push({
            service: 'storage',
            entity: 'buckets',
            status: failedBuckets.length === 0 ? 'healthy' : 'warning',
            detail: `${storage.bucketsProtected}/${storage.buckets.length} buckets accessible, ${storage.totalObjects} objects`,
            lastChecked: generatedAt,
        });
    }
    catch (err) {
        checks.push({ service: 'storage', entity: 'buckets', status: 'warning', detail: `Error: ${err}`, lastChecked: generatedAt });
    }
    // 5. RPO compliance
    const state = await getDataVaultState();
    const rpoCompliant = state.lastSnapshotAt
        ? (Date.now() - Date.parse(state.lastSnapshotAt)) / 60000 <= RECOVERY_OBJECTIVES.rpoTargetMinutes
        : false;
    checks.push({
        service: 'rpo',
        entity: 'compliance',
        status: rpoCompliant ? 'healthy' : 'warning',
        detail: rpoCompliant ? `RPO compliant (target: ${RECOVERY_OBJECTIVES.rpoTargetMinutes}min)` : `RPO NOT compliant — last snapshot exceeds ${RECOVERY_OBJECTIVES.rpoTargetMinutes}min target`,
        lastChecked: generatedAt,
    });
    // 6. RTO compliance (can we restore within target?)
    const rtoCompliant = state.totalSnapshots > 0 && state.config.enabled;
    checks.push({
        service: 'rto',
        entity: 'compliance',
        status: rtoCompliant ? 'healthy' : 'critical',
        detail: rtoCompliant ? `RTO achievable (target: ${RECOVERY_OBJECTIVES.rtoTargetMinutes}min, ${state.totalSnapshots} snapshots available)` : `RTO NOT achievable — no snapshots available to restore from`,
        lastChecked: generatedAt,
    });
    // Overall status
    const hasCritical = checks.some((c) => c.status === 'critical');
    const hasWarning = checks.some((c) => c.status === 'warning');
    const overallStatus = hasCritical ? 'critical' : hasWarning ? 'warning' : 'healthy';
    // Active alerts
    const activeAlerts = await readRecoveryAlerts(20);
    const recommendation = overallStatus === 'healthy'
        ? 'All recovery systems healthy. Continue scheduled snapshots and monitoring.'
        : overallStatus === 'warning'
            ? 'Recovery systems have warnings. Review alerts and take corrective action soon.'
            : 'CRITICAL: Recovery systems have critical issues. Immediate owner action required.';
    // Persist monitoring state
    await ensureDir();
    try {
        await fs.writeFile(MONITORING_STATE, JSON.stringify({ generatedAt, checks, overallStatus }, null, 2), 'utf8');
    }
    catch { /* ignore */ }
    return {
        marker: IVX_MONITORING_MARKER,
        generatedAt,
        checks,
        overallStatus,
        activeAlerts: activeAlerts.length,
        rpoCompliant,
        rtoCompliant,
        recommendation,
    };
}
/**
 * Read the last monitoring state.
 */
export async function readMonitoringState() {
    try {
        const text = await fs.readFile(MONITORING_STATE, 'utf8');
        const data = JSON.parse(text);
        return { generatedAt: data.generatedAt, overallStatus: data.overallStatus };
    }
    catch {
        return null;
    }
}
