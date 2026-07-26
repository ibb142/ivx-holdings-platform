/**
 * IVX Prioritization Engine — the "what should I work on next" brain.
 *
 * IVX has many sources of open work (incidents, repair jobs, structured audit
 * items). On their own they are unranked, so the autonomous agent has no way to
 * decide *which blocker to fix first*. This engine pulls all open work into one
 * normalised priority queue, ranks it by severity → status → recency, and
 * collapses everything into four owner-facing tiers:
 *
 *   CRITICAL · HIGH · MEDIUM · LOW
 *
 * Rules (so blockers always beat nice-to-haves):
 *   - Anything already verified / resolved / completed is dropped (not open work).
 *   - Severity dominates ranking; a critical incident always outranks a low audit item.
 *   - Within a tier, actively-failing/blocked work outranks merely-pending work.
 *   - Cosmetic / info-level work sinks to the bottom (LOW) — never blocks real fixes.
 *
 * Read-only: this engine never mutates any underlying store.
 */
import { countByStatus, listAuditItemSets } from './ivx-audit-item-store';
import { listIncidents } from './ivx-incident-store';
import { listRepairJobs } from './ivx-repair-jobs';
export const IVX_PRIORITY_ENGINE_MARKER = 'ivx-priority-engine-2026-05-29';
/** Base score per tier; refined by status + recency within the tier band. */
const TIER_BASE = {
    CRITICAL: 900,
    HIGH: 600,
    MEDIUM: 300,
    LOW: 50,
};
function incidentTier(severity) {
    switch (severity) {
        case 'critical': return 'CRITICAL';
        case 'error': return 'HIGH';
        case 'warning': return 'MEDIUM';
        case 'info': return 'LOW';
        default: return 'MEDIUM';
    }
}
function auditTier(severity) {
    switch (severity) {
        case 'critical': return 'CRITICAL';
        case 'high': return 'HIGH';
        case 'medium': return 'MEDIUM';
        case 'low':
        case 'info': return 'LOW';
        default: return 'MEDIUM';
    }
}
/** Repair jobs carry a low/medium/high classification (null = unknown → medium). */
function repairTier(classification) {
    switch (classification) {
        case 'high': return 'HIGH';
        case 'medium': return 'MEDIUM';
        case 'low': return 'LOW';
        default: return 'MEDIUM';
    }
}
/** Recency nudge: newer open work gets a small bump (max +40) so stale noise sinks. */
function recencyBoost(updatedAt) {
    const ts = Date.parse(updatedAt);
    if (!Number.isFinite(ts))
        return 0;
    const ageHours = (Date.now() - ts) / 3_600_000;
    if (ageHours <= 1)
        return 40;
    if (ageHours <= 6)
        return 30;
    if (ageHours <= 24)
        return 20;
    if (ageHours <= 72)
        return 10;
    return 0;
}
function scoreFor(tier, blocker, updatedAt) {
    return TIER_BASE[tier] + (blocker ? 80 : 0) + recencyBoost(updatedAt);
}
/** Incidents that are still actionable (not resolved / ignored / rolled back). */
function isOpenIncident(incident) {
    return incident.status !== 'resolved' && incident.status !== 'ignored' && incident.status !== 'rolled_back';
}
function incidentIsBlocker(incident) {
    return incident.severity === 'critical' || incident.severity === 'error'
        || incident.status === 'open' || incident.status === 'diagnosing'
        || incident.status === 'staging_failed';
}
/** Repair jobs still in-flight or needing attention. */
function isOpenRepairJob(job) {
    return job.stage !== 'completed' && job.stage !== 'auto_applied';
}
function repairIsBlocker(job) {
    return job.stage === 'failed' || job.stage === 'rollback_required';
}
/** Audit items still requiring engineering work. */
function isOpenAuditItem(item) {
    return item.status !== 'verified' && item.status !== 'fixed';
}
function auditIsBlocker(item) {
    return item.status === 'failed' || item.status === 'blocked'
        || item.severity === 'critical' || item.severity === 'high';
}
/**
 * Build the unified, ranked priority queue across every open-work source.
 * Pure read — never mutates stores. Returns highest priority first.
 */
export async function buildPriorityQueue(limit = 200) {
    const incidents = listIncidents(200).filter(isOpenIncident);
    const repairJobs = listRepairJobs(200).filter(isOpenRepairJob);
    const auditSets = await listAuditItemSets(100);
    const entries = [];
    for (const incident of incidents) {
        const tier = incidentTier(incident.severity);
        const blocker = incidentIsBlocker(incident);
        entries.push({
            id: incident.id,
            source: 'incident',
            tier,
            score: scoreFor(tier, blocker, incident.updatedAt),
            title: incident.message.slice(0, 160),
            status: incident.status,
            reference: incident.fileLine ?? incident.checkpoint ?? null,
            blocker,
            updatedAt: incident.updatedAt,
        });
    }
    for (const job of repairJobs) {
        const tier = repairTier(job.classification);
        const blocker = repairIsBlocker(job);
        entries.push({
            id: job.id,
            source: 'repair-job',
            tier,
            score: scoreFor(tier, blocker, job.updatedAt),
            title: `Repair job for incident ${job.incidentId} (${job.stage})`,
            status: job.stage,
            reference: job.proposalArtifactPath,
            blocker,
            updatedAt: job.updatedAt,
        });
    }
    for (const set of auditSets) {
        for (const item of set.items) {
            if (!isOpenAuditItem(item))
                continue;
            const tier = auditTier(item.severity);
            const blocker = auditIsBlocker(item);
            entries.push({
                id: `${set.auditId}:${item.id}`,
                source: 'audit-item',
                tier,
                score: scoreFor(tier, blocker, item.updatedAt),
                title: `#${item.number} ${item.systemArea}: ${item.issue}`.slice(0, 160),
                status: item.status,
                reference: item.file,
                blocker,
                updatedAt: item.updatedAt,
            });
        }
    }
    // Rank: score desc, then blockers first, then most-recent first (stable).
    entries.sort((a, b) => {
        if (b.score !== a.score)
            return b.score - a.score;
        if (a.blocker !== b.blocker)
            return a.blocker ? -1 : 1;
        return b.updatedAt.localeCompare(a.updatedAt);
    });
    const tierCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const entry of entries) {
        tierCounts[entry.tier] += 1;
    }
    const capped = entries.slice(0, Math.min(Math.max(1, limit), 500));
    return {
        marker: IVX_PRIORITY_ENGINE_MARKER,
        generatedAt: new Date().toISOString(),
        totalOpen: entries.length,
        tierCounts,
        blockersFirst: true,
        queue: capped,
        next: capped[0] ?? null,
    };
}
export async function getPrioritySummary() {
    const queue = await buildPriorityQueue(50);
    return {
        totalOpen: queue.totalOpen,
        tierCounts: queue.tierCounts,
        next: queue.next
            ? { id: queue.next.id, source: queue.next.source, tier: queue.next.tier, title: queue.next.title }
            : null,
    };
}
// touch to satisfy lint when countByStatus import becomes unused in future edits
void countByStatus;
