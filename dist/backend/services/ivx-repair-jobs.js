/**
 * IVX Repair Job Orchestrator — async, single-tracked pipeline that wraps
 * diagnose → classify → patch-plan → checks → staging deploy → replay → owner
 * approval request into ONE job id the chat surface can show as
 * "Repair job started" without blocking the normal chat request path.
 *
 * Storage:
 *  - In-memory ring (200 jobs)
 *  - File-backed JSONL at `logs/audit/repair-jobs.jsonl` (best-effort)
 *
 * Lifecycle stages mirror the repair policy:
 *   queued → diagnosing → classifying → patch_planning → running_checks
 *          → staging_deploying → replaying → awaiting_approval | failed
 *
 * Never ships code itself — produces a `proposalArtifact` path the owner
 * (or downstream deploy worker) can act on.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getIncident } from './ivx-incident-store';
import { decideRepairPolicy, deployRepairToStaging, replayIncidentAgainstStaging, } from './ivx-repair-policy';
import { executeSeniorDevTool } from './ivx-senior-dev-tools';
import { appendLifecycleEvent } from './ivx-incident-store';
const JOBS = new Map();
const ORDER = [];
const MAX = 200;
const LOG_FILE = path.resolve(process.cwd(), 'logs/audit/repair-jobs.jsonl');
const AUDIT_FILE = path.resolve(process.cwd(), 'logs/audit/autonomous-repairs.jsonl');
const INDEX_BY_INCIDENT = new Map();
async function appendAuditEntry(entry) {
    try {
        await fs.mkdir(path.dirname(AUDIT_FILE), { recursive: true });
        await fs.appendFile(AUDIT_FILE, `${JSON.stringify({ ...entry, at: nowIso() })}\n`, 'utf8');
    }
    catch {
        // best-effort audit log; never throws
    }
}
function nowIso() {
    return new Date().toISOString();
}
function mkId() {
    return `rj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
async function persist(job) {
    try {
        await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
        await fs.appendFile(LOG_FILE, `${JSON.stringify({ ...job, snapshotAt: nowIso() })}\n`, 'utf8');
    }
    catch {
        // best-effort
    }
}
function pushStep(job, step) {
    job.steps.push({ ...step, at: nowIso() });
    job.updatedAt = nowIso();
    job.stage = step.stage;
}
/** Public: get a job by id. */
export function getRepairJob(jobId) {
    return JOBS.get(jobId) ?? null;
}
/** Public: list recent jobs (newest first). */
export function listRepairJobs(limit = 50) {
    const cap = Math.min(Math.max(limit, 1), MAX);
    return ORDER.slice(-cap).reverse().map((id) => JOBS.get(id)).filter(Boolean);
}
/** Public: latest job for an incident, if any. */
export function getLatestRepairJobForIncident(incidentId) {
    const id = INDEX_BY_INCIDENT.get(incidentId);
    return id ? JOBS.get(id) ?? null : null;
}
/**
 * Public: enqueue a repair job. Returns immediately with a job id so the
 * chat surface can render "Repair job started" without waiting for the
 * full diagnose → stage → replay pipeline.
 */
export function startRepairJob(incidentId) {
    const existing = getLatestRepairJobForIncident(incidentId);
    if (existing && (existing.stage !== 'failed' && existing.stage !== 'completed' && existing.stage !== 'awaiting_approval')) {
        return existing;
    }
    const job = {
        id: mkId(),
        incidentId,
        stage: 'queued',
        classification: null,
        steps: [{ stage: 'queued', ok: true, at: nowIso(), note: 'Repair job queued.' }],
        proposalArtifactPath: null,
        finalReport: null,
        error: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
    };
    JOBS.set(job.id, job);
    ORDER.push(job.id);
    while (ORDER.length > MAX) {
        const drop = ORDER.shift();
        if (drop)
            JOBS.delete(drop);
    }
    INDEX_BY_INCIDENT.set(incidentId, job.id);
    void runRepairJob(job).catch((err) => {
        job.error = err instanceof Error ? err.message : String(err);
        pushStep(job, { stage: 'failed', ok: false, note: `Unhandled job error: ${job.error}` });
        void persist(job);
    });
    return job;
}
function classify(incident) {
    if (incident.diagnosis?.riskLevel)
        return incident.diagnosis.riskLevel;
    const msg = incident.message.toLowerCase();
    if (incident.source === 'silent_failure' || /timeout|timed out/.test(msg))
        return 'medium';
    if (incident.severity === 'critical')
        return 'high';
    if (/auth|payment|deploy|migration/.test(msg))
        return 'high';
    return 'low';
}
function buildFinalReport(job, incident) {
    const d = incident.diagnosis;
    const lines = [];
    lines.push(`# IVX Repair Job ${job.id}`);
    lines.push(`incident: ${incident.id} (${incident.source}, severity=${incident.severity})`);
    lines.push(`stage: ${job.stage}`);
    lines.push(`classification: ${job.classification ?? 'unknown'}`);
    lines.push(`checkpoint: ${incident.checkpoint ?? 'n/a'}`);
    lines.push(`fileLine: ${incident.fileLine ?? 'n/a'}`);
    lines.push('');
    if (d) {
        lines.push('## Diagnosis');
        lines.push(`rootCause: ${d.rootCause}`);
        lines.push(`fileLine: ${d.fileLine ?? 'n/a'}`);
        lines.push(`riskLevel: ${d.riskLevel}`);
        lines.push('');
        lines.push('## Patch plan');
        lines.push(d.patchPlan);
        lines.push('');
        lines.push('## Rollback plan');
        lines.push(d.rollbackPlan);
        lines.push('');
    }
    lines.push('## Steps');
    for (const s of job.steps) {
        lines.push(`- [${s.ok ? 'x' : ' '}] ${s.stage}: ${s.note} (${s.at})`);
    }
    if (job.proposalArtifactPath) {
        lines.push('');
        lines.push(`proposalArtifact: ${job.proposalArtifactPath}`);
    }
    return lines.join('\n');
}
async function runRepairJob(job) {
    // 1. diagnose
    pushStep(job, { stage: 'diagnosing', ok: true, note: 'Running repair brain.' });
    const { diagnoseIncident } = (await import('./ivx-repair-brain'));
    const diag = await diagnoseIncident(job.incidentId);
    if (!diag.ok || !diag.diagnosis) {
        pushStep(job, { stage: 'failed', ok: false, note: `Diagnose failed: ${diag.error ?? 'unknown'}` });
        job.error = diag.error ?? 'diagnose failed';
        await persist(job);
        return;
    }
    job.proposalArtifactPath = diag.proposalArtifactPath;
    const incident = getIncident(job.incidentId);
    if (!incident) {
        pushStep(job, { stage: 'failed', ok: false, note: 'Incident vanished between diagnose and classify.' });
        await persist(job);
        return;
    }
    // 2. classify
    const classification = classify(incident);
    job.classification = classification;
    pushStep(job, { stage: 'classifying', ok: true, note: `Risk classified as ${classification}.`, metadata: { policy: decideRepairPolicy(incident) } });
    // 3. patch plan recorded (already inside diagnosis.patchPlan + artifact)
    pushStep(job, {
        stage: 'patch_planning',
        ok: true,
        note: `Patch plan recorded at ${diag.proposalArtifactPath ?? '(in-memory)'}`,
        metadata: { fileLine: incident.diagnosis?.fileLine, riskLevel: incident.diagnosis?.riskLevel },
    });
    // 4. run checks (typecheck). Result drives the autonomous-apply / rollback
    // gates below: a failed typecheck blocks autonomous staging apply and writes
    // an audit entry so the owner can see why the safe path stopped.
    pushStep(job, { stage: 'running_checks', ok: true, note: 'Running typecheck via senior-dev tool.' });
    let checksPassed = true;
    try {
        const out = await executeSeniorDevTool('test_run', { kind: 'typecheck' });
        checksPassed = out?.ok !== false;
        pushStep(job, { stage: 'running_checks', ok: checksPassed, note: checksPassed ? 'Typecheck passed.' : 'Typecheck reported issues.', metadata: { output: out } });
    }
    catch (err) {
        checksPassed = false;
        pushStep(job, { stage: 'running_checks', ok: false, note: `Typecheck threw: ${err instanceof Error ? err.message : String(err)}` });
    }
    // 4b. Autonomous-apply gate (low-risk + non-sensitive only). If the policy
    // allows, mark the proposal as auto-applied to staging and write an audit
    // log entry. Sensitive paths (auth/billing/payments/database schema/secrets/
    // production deploy config) always fall through to the approval gate.
    const policy = decideRepairPolicy(incident);
    if (policy.allowAutonomousApply && checksPassed) {
        pushStep(job, {
            stage: 'auto_applied',
            ok: true,
            note: `Autonomous apply allowed: ${policy.reason}`,
            metadata: { policy },
        });
        appendLifecycleEvent(job.incidentId, {
            stage: 'staging_deploy_started',
            note: 'Autonomous apply gate opened (low-risk + non-sensitive).',
            actor: 'system',
            metadata: { policy },
        });
        await appendAuditEntry({
            kind: 'autonomous_repair_applied',
            jobId: job.id,
            incidentId: job.incidentId,
            fileLine: incident.diagnosis?.fileLine ?? incident.fileLine ?? null,
            riskLevel: policy.riskLevel,
            sensitiveCategories: policy.sensitiveCategories,
            proposalArtifactPath: job.proposalArtifactPath,
        });
    }
    else if (!checksPassed) {
        pushStep(job, {
            stage: 'rollback_required',
            ok: false,
            note: 'Typecheck failed — autonomous apply blocked; awaiting owner review.',
            metadata: { policy },
        });
        await appendAuditEntry({
            kind: 'autonomous_repair_rolled_back',
            jobId: job.id,
            incidentId: job.incidentId,
            reason: 'pre_apply_typecheck_failed',
            riskLevel: policy.riskLevel,
        });
    }
    else {
        pushStep(job, {
            stage: 'classifying',
            ok: true,
            note: `Autonomous apply blocked: ${policy.reason}`,
            metadata: { policy },
        });
    }
    // 5. auto-deploy intent to staging
    pushStep(job, { stage: 'staging_deploying', ok: true, note: 'Deploying repair intent to staging.' });
    const stage = await deployRepairToStaging(job.incidentId);
    if (!stage.ok) {
        pushStep(job, { stage: 'failed', ok: false, note: `Staging deploy failed: ${stage.message}` });
        job.error = stage.message;
        await persist(job);
        return;
    }
    pushStep(job, { stage: 'staging_deploying', ok: true, note: `Staging deploy intent recorded (${stage.stagingBaseUrl ?? 'no IVX_STAGING_BASE_URL configured'}).` });
    // 6. replay against staging
    pushStep(job, { stage: 'replaying', ok: true, note: 'Replaying incident against staging.' });
    const replay = await replayIncidentAgainstStaging(job.incidentId);
    pushStep(job, {
        stage: 'replaying',
        ok: replay.passed,
        note: replay.message,
        metadata: { replayedAgainst: replay.replayedAgainst, responseStatus: replay.responseStatus },
    });
    // 6b. Autonomous rollback: if replay failed after we already auto-applied,
    // mark the job as rollback_required and write an audit entry. The repair
    // policy still keeps emergency-rollback automatic; this is the staging-side
    // signal the owner UI surfaces.
    if (policy.allowAutonomousApply && checksPassed && !replay.passed) {
        pushStep(job, {
            stage: 'rollback_required',
            ok: false,
            note: 'Staging replay failed after autonomous apply — rollback required.',
            metadata: { replayedAgainst: replay.replayedAgainst, responseStatus: replay.responseStatus },
        });
        await appendAuditEntry({
            kind: 'autonomous_repair_rolled_back',
            jobId: job.id,
            incidentId: job.incidentId,
            reason: 'staging_replay_failed',
            replayedAgainst: replay.replayedAgainst,
            responseStatus: replay.responseStatus,
        });
    }
    else if (policy.allowAutonomousApply && checksPassed && replay.passed) {
        pushStep(job, {
            stage: 'completed',
            ok: true,
            note: 'Autonomous repair validated on staging. Production promotion still requires owner approval.',
        });
        await appendAuditEntry({
            kind: 'autonomous_repair_validated',
            jobId: job.id,
            incidentId: job.incidentId,
            replayedAgainst: replay.replayedAgainst,
            responseStatus: replay.responseStatus,
        });
    }
    // 7. final state: awaiting owner approval (production gated) or completed-low-risk
    const finalIncident = getIncident(job.incidentId);
    if (replay.passed && finalIncident?.status === 'awaiting_production_approval') {
        pushStep(job, { stage: 'awaiting_approval', ok: true, note: 'Staging passed. Awaiting owner approval to promote to production.' });
    }
    else if (classification === 'low' && finalIncident) {
        pushStep(job, { stage: 'awaiting_approval', ok: true, note: 'Low-risk repair proposed; staging replay inconclusive — owner approval requested.' });
    }
    else {
        pushStep(job, { stage: 'awaiting_approval', ok: false, note: 'Staging replay did not pass; production blocked until owner reviews.' });
    }
    if (finalIncident) {
        job.finalReport = buildFinalReport(job, finalIncident);
    }
    await persist(job);
}
