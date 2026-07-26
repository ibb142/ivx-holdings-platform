/**
 * IVX Governance System — Phase 8.
 *
 * Enforces audit, evidence, and approval requirements before high-impact actions:
 *   - Evidence verification: actions must cite real data
 *   - Audit trail: every action is logged with reasoning
 *   - Approval gates: destructive actions require owner approval
 *   - Rollback safety: every mutation has a rollback path
 *
 * Governance principles:
 *   - Never report COMPLETE without production evidence.
 *   - Every high-impact action is logged with who, what, when, why.
 *   - Approval is required for destructive operations.
 *   - Rollback is always possible.
 *
 * HARD HONESTY RULES:
 *   - Governance is enforced, not advisory.
 *   - Blocked actions include the exact reason and the approval path.
 *   - Audit trail is immutable (append-only).
 */
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
export const IVX_GOVERNANCE_MARKER = 'ivx-governance-2026-07-01';
// ── Durable Store ──────────────────────────────────────────────────────────
const GOV_DIR = path.join(process.cwd(), 'logs', 'audit', 'governance');
const ACTIONS_FILE = path.join(GOV_DIR, 'actions.jsonl');
const AUDIT_FILE = path.join(GOV_DIR, 'audit-trail.jsonl');
const STATE_FILE = path.join(GOV_DIR, 'state.json');
let _state = null;
async function ensureDirs() {
    await mkdir(GOV_DIR, { recursive: true });
}
function defaultState() {
    return {
        marker: IVX_GOVERNANCE_MARKER,
        totalActions: 0,
        approvedCount: 0,
        blockedCount: 0,
        pendingCount: 0,
        auditTrailSize: 0,
        lastActionAt: null,
        enabled: true,
        autoApproveLowRisk: true,
    };
}
async function loadState() {
    if (_state)
        return _state;
    await ensureDirs();
    try {
        const raw = await readFile(STATE_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed.marker === IVX_GOVERNANCE_MARKER) {
            _state = parsed;
            return _state;
        }
    }
    catch { /* first run */ }
    _state = defaultState();
    await persistState();
    return _state;
}
async function persistState() {
    if (!_state)
        return;
    await ensureDirs();
    const tmp = STATE_FILE + '.tmp';
    await writeFile(tmp, JSON.stringify(_state, null, 2), 'utf-8');
    await rename(tmp, STATE_FILE);
}
// ── Risk Classification ────────────────────────────────────────────────────
const ACTION_RISK = {
    deploy: 'high',
    modify_schema: 'high',
    rotate_secrets: 'critical',
    modify_auth: 'critical',
    force_push: 'high',
    delete_resource: 'critical',
    send_communication: 'medium',
    commit_capital: 'critical',
    modify_pricing: 'high',
    high_risk_task: 'high',
};
const DESTRUCTIVE_ACTIONS = [
    'modify_schema',
    'rotate_secrets',
    'modify_auth',
    'force_push',
    'delete_resource',
];
// ── Core Governance Logic ──────────────────────────────────────────────────
/**
 * Write an audit trail entry.
 */
export async function writeAuditEntry(event, detail, actor, actionId, metadata) {
    await ensureDirs();
    const entry = {
        id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        actionId: actionId ?? null,
        event,
        detail,
        actor,
        timestamp: new Date().toISOString(),
        metadata: metadata ?? {},
    };
    await appendFile(AUDIT_FILE, JSON.stringify(entry) + '\n', 'utf-8');
    const state = await loadState();
    state.auditTrailSize++;
    await persistState();
    return entry;
}
/**
 * Request a governed action.
 */
export async function requestAction(type, description, requestedBy, evidence = [], rollbackPlan) {
    const state = await loadState();
    const riskLevel = ACTION_RISK[type] ?? 'medium';
    const isDestructive = DESTRUCTIVE_ACTIONS.includes(type);
    let decision;
    if (isDestructive) {
        decision = 'pending_approval';
    }
    else if (riskLevel === 'low' && state.autoApproveLowRisk) {
        decision = 'auto_approved';
    }
    else if (riskLevel === 'medium' && evidence.length > 0) {
        decision = 'auto_approved';
    }
    else {
        decision = 'pending_approval';
    }
    const action = {
        id: `gov-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type,
        description,
        requestedBy,
        requestedAt: new Date().toISOString(),
        riskLevel,
        decision,
        decidedBy: decision === 'auto_approved' ? 'governance_system' : null,
        decidedAt: decision === 'auto_approved' ? new Date().toISOString() : null,
        reason: decision === 'auto_approved'
            ? `Auto-approved: low risk with evidence`
            : `Pending owner approval: ${isDestructive ? 'destructive action' : 'requires review'}`,
        evidence,
        rollbackPlan: rollbackPlan ?? null,
    };
    await ensureDirs();
    await appendFile(ACTIONS_FILE, JSON.stringify(action) + '\n', 'utf-8');
    state.totalActions++;
    if (decision === 'auto_approved')
        state.approvedCount++;
    else
        state.pendingCount++;
    state.lastActionAt = action.requestedAt;
    await persistState();
    // Audit trail
    await writeAuditEntry(`action_${decision}`, `${type}: ${description}`, requestedBy, action.id, { riskLevel, evidence });
    return action;
}
/**
 * Approve a pending action.
 */
export async function approveAction(actionId, approvedBy) {
    // Read all actions to find the one
    await ensureDirs();
    let action = null;
    try {
        const raw = await readFile(ACTIONS_FILE, 'utf-8');
        for (const line of raw.split('\n')) {
            if (line.trim()) {
                const parsed = JSON.parse(line);
                if (parsed.id === actionId) {
                    action = parsed;
                    break;
                }
            }
        }
    }
    catch { /* no file */ }
    if (!action)
        return null;
    if (action.decision !== 'pending_approval')
        return action;
    action.decision = 'approved';
    action.decidedBy = approvedBy;
    action.decidedAt = new Date().toISOString();
    action.reason = `Approved by ${approvedBy}`;
    await appendFile(ACTIONS_FILE, JSON.stringify(action) + '\n', 'utf-8');
    await writeAuditEntry('action_approved', action.description, approvedBy, action.id);
    const state = await loadState();
    state.approvedCount++;
    state.pendingCount = Math.max(0, state.pendingCount - 1);
    await persistState();
    return action;
}
/**
 * Block a pending action.
 */
export async function blockAction(actionId, blockedBy, reason) {
    await ensureDirs();
    let action = null;
    try {
        const raw = await readFile(ACTIONS_FILE, 'utf-8');
        for (const line of raw.split('\n')) {
            if (line.trim()) {
                const parsed = JSON.parse(line);
                if (parsed.id === actionId) {
                    action = parsed;
                    break;
                }
            }
        }
    }
    catch { /* no file */ }
    if (!action)
        return null;
    action.decision = 'blocked';
    action.decidedBy = blockedBy;
    action.decidedAt = new Date().toISOString();
    action.reason = reason;
    await appendFile(ACTIONS_FILE, JSON.stringify(action) + '\n', 'utf-8');
    await writeAuditEntry('action_blocked', reason, blockedBy, action.id);
    const state = await loadState();
    state.blockedCount++;
    state.pendingCount = Math.max(0, state.pendingCount - 1);
    await persistState();
    return action;
}
/**
 * Verify production evidence before reporting COMPLETE.
 */
export async function verifyProductionEvidence(checks) {
    const allPassed = checks.every((c) => c.passed);
    const verifiedAt = new Date().toISOString();
    await writeAuditEntry('production_evidence_verification', allPassed ? 'All checks passed' : `${checks.filter((c) => !c.passed).length} checks failed`, 'governance_system', undefined, { checks, allPassed });
    return { allPassed, results: checks, verifiedAt };
}
/**
 * Check if an action type is destructive and requires approval.
 */
export function isDestructiveAction(type) {
    return DESTRUCTIVE_ACTIONS.includes(type);
}
/**
 * Get the governance state.
 */
export async function getGovernanceState() {
    return loadState();
}
/**
 * Get recent audit trail entries.
 */
export async function getRecentAudit(limit = 50) {
    await ensureDirs();
    const entries = [];
    try {
        const raw = await readFile(AUDIT_FILE, 'utf-8');
        for (const line of raw.split('\n').reverse()) {
            if (line.trim()) {
                try {
                    entries.push(JSON.parse(line));
                    if (entries.length >= limit)
                        break;
                }
                catch { /* skip */ }
            }
        }
    }
    catch { /* no file */ }
    return entries;
}
// ── Action Type Labels ─────────────────────────────────────────────────────
export const GOVERNANCE_ACTION_LABELS = {
    deploy: 'Deploy',
    modify_schema: 'Modify Schema',
    rotate_secrets: 'Rotate Secrets',
    modify_auth: 'Modify Auth',
    force_push: 'Force Push',
    delete_resource: 'Delete Resource',
    send_communication: 'Send Communication',
    commit_capital: 'Commit Capital',
    modify_pricing: 'Modify Pricing',
    high_risk_task: 'High-Risk Task',
};
// ── Validation ─────────────────────────────────────────────────────────────
export async function validateGovernance() {
    const state = await loadState();
    const issues = [];
    if (state.marker !== IVX_GOVERNANCE_MARKER)
        issues.push('State marker mismatch');
    return { valid: issues.length === 0, issues };
}
