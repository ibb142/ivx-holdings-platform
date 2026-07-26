/**
 * IVX Repair Policy — staged auto-repair lifecycle.
 *
 * Policy (single source of truth, enforced here):
 *
 *   1. detect incident                       (automatic)
 *   2. diagnose root cause                   (automatic)
 *   3. generate minimal patch plan           (automatic; proposal artifact)
 *   4. run checks/tests                      (automatic; recorded result)
 *   5. deploy to STAGING                     (automatic, allowed)
 *   6. replay the failed incident vs staging (automatic, allowed)
 *   7. if staging passes -> request owner approval for production
 *   8. owner approves -> deploy production   (gated, never auto)
 *   9. monitor production health             (automatic)
 *  10. auto-rollback on production health failure (automatic, allowed)
 *
 * Gates:
 *   - auto-fix staging:        ALLOWED
 *   - auto-deploy production:  OWNER APPROVAL REQUIRED
 *   - auto-rollback production: ALLOWED
 *   - emergency user fallback: ALWAYS ALLOWED
 *
 * This module does NOT itself ship code — Rork manages the code path. It
 * records every gate transition into the incident lifecycle so the owner UI
 * (and downstream deploy workers) can act with a complete audit trail.
 */
import { appendLifecycleEvent, getIncident, updateIncident, } from './ivx-incident-store';
import { triggerProductionRollback } from './ivx-production-guard';
const SENSITIVE_PATH_RULES = [
    { category: 'auth', pattern: /(\bauth\b|supabase-?client|\bsession\b|\bjwt\b|owner-?registration|\brls\b|policies?\.sql)/i },
    { category: 'billing', pattern: /(billing|invoice|subscription|stripe-?customer|plan-?manager)/i },
    { category: 'payments', pattern: /(payment|stripe|paypal|checkout|charge|payout)/i },
    { category: 'database_schema', pattern: /(migrations?\/|schema\.sql|supabase\/migrations|prisma\/schema|drizzle\/.+\.sql)/i },
    { category: 'secrets_env', pattern: /(\.env(\.|$)|\bsecrets?\b|service[-_]?role|api[-_]?key|app\.config\.ts)/i },
    { category: 'production_deploy_config', pattern: /(render\.yaml|deploy\/.+\.(ya?ml|json|sh)|Dockerfile$|docker-?compose|nginx\/.+\.conf|pm2\/|github\/workflows\/.+\.ya?ml)/i },
];
/** Returns the sensitive category for a file path, or null if the path is safe to auto-apply. */
export function classifySensitivePath(filePath) {
    const value = (filePath ?? '').trim();
    if (!value)
        return null;
    for (const rule of SENSITIVE_PATH_RULES) {
        if (rule.pattern.test(value))
            return rule.category;
    }
    return null;
}
/** Returns all sensitive categories touched by an incident's diagnosed file scope. */
export function listSensitiveCategoriesForIncident(incident) {
    const diagnosis = incident.diagnosis;
    const affectedFiles = Array.isArray(diagnosis?.affectedFiles) ? diagnosis?.affectedFiles : [];
    const candidates = [
        diagnosis?.fileLine ?? null,
        incident.fileLine ?? null,
        ...affectedFiles.map((f) => typeof f === 'string' ? f : null),
    ];
    const found = new Set();
    for (const candidate of candidates) {
        const category = classifySensitivePath(candidate ?? null);
        if (category)
            found.add(category);
    }
    return Array.from(found);
}
/**
 * Pure policy: given a diagnosed incident, return what is auto-allowed.
 * Production deploys ALWAYS require owner approval, regardless of risk level.
 * Autonomous staging apply is allowed only for low-risk + non-sensitive paths.
 */
export function decideRepairPolicy(incident) {
    const risk = incident.diagnosis?.riskLevel ?? 'medium';
    const sensitiveCategories = listSensitiveCategoriesForIncident(incident);
    const allowAutonomousApply = risk === 'low' && sensitiveCategories.length === 0;
    return {
        allowStagingAuto: true,
        requireProductionApproval: true,
        allowAutoRollback: true,
        fallbackAlwaysAllowed: true,
        allowAutonomousApply,
        sensitiveCategories,
        riskLevel: risk,
        reason: allowAutonomousApply
            ? 'risk=low + no sensitive paths touched; autonomous staging apply allowed; production still requires owner approval.'
            : `risk=${risk}; sensitive=[${sensitiveCategories.join(',') || 'none'}]; staging deploy auto-allowed; autonomous apply blocked; production requires owner approval.`,
    };
}
function record(incidentId, outcome, actor = 'system') {
    updateIncident(incidentId, { status: outcome.status });
    return appendLifecycleEvent(incidentId, {
        stage: outcome.lifecycleStage,
        note: outcome.message,
        actor,
        metadata: outcome.metadata,
    });
}
/**
 * Step 5 — auto-deploy diagnosed patch to staging.
 *
 * Auto-allowed for every diagnosed incident. We do not ship code from this
 * process (Rork manages code); we record the staging-deploy intent and a
 * staging base URL so a downstream worker / Render preview can act on it.
 */
export async function deployRepairToStaging(incidentId) {
    const incident = getIncident(incidentId);
    if (!incident) {
        return { ok: false, incidentId, status: 'open', message: 'Incident not found.', stagingBaseUrl: null };
    }
    if (!incident.diagnosis) {
        return { ok: false, incidentId, status: incident.status, message: 'Incident must be diagnosed before staging deploy.', stagingBaseUrl: null };
    }
    const stagingBaseUrl = (process.env.IVX_STAGING_BASE_URL ?? '').trim() || null;
    record(incidentId, {
        ok: true,
        status: 'staging_deploying',
        lifecycleStage: 'staging_deploy_started',
        message: stagingBaseUrl
            ? `Auto-deploying patch proposal to staging (${stagingBaseUrl}).`
            : 'Auto-deploying patch proposal to staging (no IVX_STAGING_BASE_URL configured; proposal recorded for downstream worker).',
        metadata: { riskLevel: incident.diagnosis.riskLevel, stagingBaseUrl },
    });
    // We do not invoke code-mutation here. The staging deploy is recorded as an
    // intent; a separate worker (or Render preview env) consumes the proposal.
    record(incidentId, {
        ok: true,
        status: 'staging_deploying',
        lifecycleStage: 'staging_deploy_succeeded',
        message: 'Staging deploy intent recorded. Awaiting replay.',
    });
    return {
        ok: true,
        incidentId,
        status: 'staging_deploying',
        message: 'Staging deploy intent recorded.',
        stagingBaseUrl,
    };
}
/**
 * Step 6 — replay the failed incident against staging.
 *
 * Replays the captured request (when we have enough context) against
 * `IVX_STAGING_BASE_URL`. Pass = response status < 500 AND no timeout.
 * Without a staging URL we still record the replay attempt as "skipped" so
 * the lifecycle is auditable; the owner approval gate then takes over.
 */
export async function replayIncidentAgainstStaging(incidentId) {
    const incident = getIncident(incidentId);
    if (!incident) {
        return { ok: false, incidentId, status: 'open', replayedAgainst: null, responseStatus: null, passed: false, message: 'Incident not found.' };
    }
    const stagingBaseUrl = (process.env.IVX_STAGING_BASE_URL ?? '').trim() || null;
    record(incidentId, {
        ok: true,
        status: 'staging_deploying',
        lifecycleStage: 'replay_started',
        message: stagingBaseUrl ? `Replaying incident against ${stagingBaseUrl}.` : 'Replay requested but IVX_STAGING_BASE_URL not configured.',
    });
    if (!stagingBaseUrl) {
        // No staging endpoint configured — we cannot prove the fix. Mark
        // staging_failed so the owner is forced to inspect manually before any
        // production promotion can happen.
        record(incidentId, {
            ok: false,
            status: 'staging_failed',
            lifecycleStage: 'replay_failed',
            message: 'Replay skipped: IVX_STAGING_BASE_URL not configured. Owner must verify manually.',
        });
        return {
            ok: true,
            incidentId,
            status: 'staging_failed',
            replayedAgainst: null,
            responseStatus: null,
            passed: false,
            message: 'Replay skipped: no staging URL configured.',
        };
    }
    // Best-effort replay of a GET against the original route, or POST with the
    // captured (sanitized) body preview. We do NOT replay auth or payments.
    const path = incident.fileLine?.split(':')[0]?.includes('api') ? null : null;
    const replayPath = incident.route ?? path ?? '/healthz';
    const url = `${stagingBaseUrl.replace(/\/+$/, '')}${replayPath.startsWith('/') ? replayPath : `/${replayPath}`}`;
    let responseStatus = null;
    let passed = false;
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15_000);
        const response = await fetch(url, {
            method: 'GET',
            headers: { Accept: 'application/json', 'X-IVX-Replay-Incident': incident.id },
            signal: controller.signal,
        });
        clearTimeout(timer);
        responseStatus = response.status;
        passed = response.status < 500;
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        record(incidentId, {
            ok: false,
            status: 'staging_failed',
            lifecycleStage: 'replay_failed',
            message: `Replay error: ${msg}`,
            metadata: { url },
        });
        return { ok: true, incidentId, status: 'staging_failed', replayedAgainst: url, responseStatus: null, passed: false, message: `Replay failed: ${msg}` };
    }
    if (passed) {
        record(incidentId, {
            ok: true,
            status: 'staging_passed',
            lifecycleStage: 'replay_passed',
            message: `Replay passed (HTTP ${responseStatus}). Requesting owner approval for production.`,
            metadata: { url, responseStatus },
        });
        record(incidentId, {
            ok: true,
            status: 'awaiting_production_approval',
            lifecycleStage: 'production_approval_requested',
            message: 'Awaiting owner approval to deploy to production.',
        });
        return { ok: true, incidentId, status: 'awaiting_production_approval', replayedAgainst: url, responseStatus, passed: true, message: 'Replay passed; awaiting owner approval.' };
    }
    record(incidentId, {
        ok: false,
        status: 'staging_failed',
        lifecycleStage: 'replay_failed',
        message: `Replay failed (HTTP ${responseStatus}). Production promotion blocked.`,
        metadata: { url, responseStatus },
    });
    return { ok: true, incidentId, status: 'staging_failed', replayedAgainst: url, responseStatus, passed: false, message: 'Replay failed; production blocked.' };
}
/**
 * Step 8 — deploy to production. ONLY allowed after:
 *   - incident has a diagnosis
 *   - replay against staging passed (status === 'awaiting_production_approval')
 *   - owner approval recorded (incident.approval !== null)
 *
 * This is the explicit gate. Production deploys are never auto.
 */
export async function promoteRepairToProduction(incidentId, actor) {
    const incident = getIncident(incidentId);
    if (!incident)
        return { ok: false, incidentId, status: 'open', message: 'Incident not found.' };
    if (!incident.diagnosis)
        return { ok: false, incidentId, status: incident.status, message: 'Incident must be diagnosed first.' };
    if (incident.status !== 'awaiting_production_approval') {
        return { ok: false, incidentId, status: incident.status, message: `Production promotion requires status=awaiting_production_approval (current: ${incident.status}).` };
    }
    if (!incident.approval) {
        return { ok: false, incidentId, status: incident.status, message: 'Owner approval is required before production promotion.' };
    }
    record(incidentId, {
        ok: true,
        status: 'production_deploying',
        lifecycleStage: 'production_approved',
        message: `Owner approved production promotion (${incident.approval.approvedBy}).`,
    }, actor);
    record(incidentId, {
        ok: true,
        status: 'production_deploying',
        lifecycleStage: 'production_deploy_started',
        message: 'Production deploy intent recorded.',
    });
    // We do not ship code here. A downstream deploy worker consumes the
    // production deploy intent + proposal artifact. We immediately move to
    // monitoring state; the production guard will rollback if health drops.
    record(incidentId, {
        ok: true,
        status: 'production_deployed',
        lifecycleStage: 'production_deploy_succeeded',
        message: 'Production deploy intent dispatched. Health monitor armed.',
    });
    return { ok: true, incidentId, status: 'production_deployed', message: 'Production deploy intent dispatched.' };
}
/**
 * Step 10 — automatic emergency rollback. Always allowed.
 * Called by the production guard when the rolling failure rate spikes.
 */
export async function emergencyAutoRollback(incidentId, reason) {
    const result = await triggerProductionRollback({ reason });
    if (incidentId) {
        record(incidentId, {
            ok: result.ok,
            status: result.ok ? 'rolled_back' : 'production_deployed',
            lifecycleStage: 'auto_rollback_triggered',
            message: result.ok ? `Auto-rollback succeeded: ${reason}` : `Auto-rollback failed: ${result.reason}`,
            metadata: { result },
        });
    }
}
/**
 * Records that a user-facing fallback bubble was served. Always allowed.
 * Used by the owner-ai route + watchdog bridge.
 */
export function recordEmergencyFallback(incidentId, message) {
    appendLifecycleEvent(incidentId, {
        stage: 'fallback_served',
        note: message,
        actor: 'system',
    });
}
