/**
 * IVX Enterprise Recovery Configuration — formal RPO/RTO targets, retention
 * policies, backup schedules, and restore-test frequencies.
 *
 * These values are the enterprise standard for IVX Holdings. They are enforced
 * by the backup scheduler, validation service, and monitoring alerts.
 *
 * @module ivx-enterprise-recovery-config
 */
export const IVX_RECOVERY_CONFIG_MARKER = 'ivx-enterprise-recovery-config-2026-07-12';
export const RECOVERY_OBJECTIVES = {
    rpoTargetMinutes: 5,
    rtoTargetMinutes: 60,
    criticalRpoMinutes: 1,
    storageRpoHours: 24,
    dailyRetentionDays: 35,
    monthlyRetentionMonths: 12,
    restoreDrillFrequencyDays: 30,
    drDrillFrequencyDays: 90,
    snapshotFrequencyHours: 6,
    offsiteCopyFrequencyHours: 24,
    pitrRetentionDays: 30,
};
/**
 * Return the formal recovery objectives with justification and actual
 * supported values based on current infrastructure.
 */
export function getRecoveryObjectiveReport(pitrEnabled, vaultSnapshotCount, lastSnapshotAt) {
    const justification = [
        'Database RPO of 5 minutes is achievable via Supabase PITR (WAL streaming) when enabled on Pro plan.',
        'Database RTO of 60 minutes is achievable via vault snapshot restore (file-based) or PITR point-in-time restore.',
        'Critical identity/financial RPO of 1 minute requires PITR WAL streaming (near-continuous).',
        'Storage RPO of 24 hours is achievable via daily storage backup job (object manifest + off-site copy).',
        'Daily snapshot retention of 35 days exceeds the 30-day PITR window, ensuring overlap.',
        'Monthly archive retention of 12 months provides long-term compliance and audit trail.',
        'Restore drill frequency of 30 days (monthly) meets enterprise backup best practices.',
        'Full DR drill frequency of 90 days (quarterly) meets enterprise disaster recovery standards.',
    ];
    const supportedValues = {
        RPO_TARGET: `${RECOVERY_OBJECTIVES.rpoTargetMinutes} minutes`,
        RTO_TARGET: `${RECOVERY_OBJECTIVES.rtoTargetMinutes} minutes`,
        CRITICAL_RPO: `${RECOVERY_OBJECTIVES.criticalRpoMinutes} minute (near-continuous via PITR WAL)`,
        STORAGE_RPO: `${RECOVERY_OBJECTIVES.storageRpoHours} hours`,
        BACKUP_RETENTION: `${RECOVERY_OBJECTIVES.dailyRetentionDays} days daily + ${RECOVERY_OBJECTIVES.monthlyRetentionMonths} months monthly archive`,
        PITR_RETENTION: `${RECOVERY_OBJECTIVES.pitrRetentionDays} days (Supabase Pro plan)`,
        SNAPSHOT_FREQUENCY: `${RECOVERY_OBJECTIVES.snapshotFrequencyHours} hours (file vault)`,
        RESTORE_TEST_FREQUENCY: `${RECOVERY_OBJECTIVES.restoreDrillFrequencyDays} days (monthly)`,
        OFFSITE_COPY_FREQUENCY: `${RECOVERY_OBJECTIVES.offsiteCopyFrequencyHours} hours`,
        DR_DRILL_FREQUENCY: `${RECOVERY_OBJECTIVES.drDrillFrequencyDays} days (quarterly)`,
        VAULT_SNAPSHOTS_EXIST: String(vaultSnapshotCount),
        LAST_SNAPSHOT: lastSnapshotAt ?? 'NONE',
    };
    const gaps = [];
    if (pitrEnabled === null) {
        gaps.push('PITR status not confirmed — owner must check Supabase Dashboard → Database → Backups.');
    }
    else if (pitrEnabled === false) {
        gaps.push('PITR is NOT enabled — RPO target of 5 minutes is NOT achievable without PITR. Enable Supabase Pro plan + PITR add-on.');
    }
    if (vaultSnapshotCount === 0) {
        gaps.push('No file vault snapshots exist — RTO target cannot be met. Trigger a snapshot immediately.');
    }
    if (lastSnapshotAt) {
        const ageHours = (Date.now() - Date.parse(lastSnapshotAt)) / (60 * 60 * 1000);
        if (ageHours > RECOVERY_OBJECTIVES.snapshotFrequencyHours * 2) {
            gaps.push(`Last vault snapshot is ${ageHours.toFixed(1)}h old — exceeds ${RECOVERY_OBJECTIVES.snapshotFrequencyHours}h target. Scheduler may not be running.`);
        }
    }
    return {
        marker: IVX_RECOVERY_CONFIG_MARKER,
        generatedAt: new Date().toISOString(),
        objectives: RECOVERY_OBJECTIVES,
        justification,
        supportedValues,
        gaps,
    };
}
