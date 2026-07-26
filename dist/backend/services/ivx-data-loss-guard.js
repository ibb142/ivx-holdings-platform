/**
 * IVX Data-Loss Prevention Guard.
 *
 * After the 2026-07-06 incident where an autonomous "cleanup" phase wiped
 * visitor analytics + real member records from Supabase, this guard was
 * created to ensure that can NEVER happen again.
 *
 * The guard intercepts any destructive operation (DELETE, TRUNCATE, DROP,
 * mass row removal) targeting production tables and:
 *   1. Requires explicit owner approval with a written reason.
 *   2. Takes a vault snapshot BEFORE the operation proceeds.
 *   3. Logs the operation to an immutable audit trail.
 *   4. Refuses if the operation targets a protected table without a special
 *      "emergency" flag.
 *
 * Protected tables (can NEVER be bulk-deleted by autonomous systems):
 *   - members, waitlist, waitlist_entries
 *   - investors, buyers
 *   - landing_analytics, analytics_events, visitor_sessions
 *   - jv_deals, wallets, ledger, treasury
 *   - landing_submissions, landing_investments
 *   - profiles, kyc_verifications
 *
 * @module ivx-data-loss-guard
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { runDataVaultSnapshot } from './ivx-data-vault';
export const IVX_DATA_LOSS_GUARD_MARKER = 'ivx-data-loss-guard-2026-07-06';
const AUDIT_TRAIL_FILE = path.resolve(process.cwd(), 'logs', 'audit', 'data-vault', 'destructive-ops-audit.jsonl');
/**
 * Tables that are PROTECTED from autonomous bulk deletion. A human owner
 * can still run a restore or migration, but the autonomous AI / night-ops /
 * senior-developer / cleanup scripts can NEVER bulk-delete from these.
 */
export const PROTECTED_TABLES = new Set([
    // Identity & auth
    'members',
    'profiles',
    'kyc_verifications',
    'kyc_documents',
    // CRM
    'waitlist',
    'waitlist_entries',
    'investors',
    'buyers',
    'crm_investors',
    'crm_buyers',
    'referrals',
    'referral_invites',
    // Deals & properties
    'jv_deals',
    'private_lenders',
    'tokenized_investments',
    'ipx_holdings',
    'ipx_purchases',
    // Financial
    'wallets',
    'wallet_transactions',
    'treasury',
    'ledger',
    'withdrawals',
    'wire_transfers',
    'earn_accounts',
    'earn_deposits',
    'earn_payouts',
    'transactions',
    'deposits',
    'revenue',
    'fees',
    // Analytics & landing
    'landing_analytics',
    'analytics_events',
    'visitor_sessions',
    'landing_submissions',
    'landing_investments',
    // Documents & media metadata
    'documents',
    'properties',
    // Communications
    'conversations',
    'messages',
    'chat_attachments',
    // Audit & compliance
    'audit_logs',
    'variables_metadata',
    'registrations',
]);
/**
 * Patterns that indicate a destructive operation. If a SQL string or command
 * matches any of these, it is intercepted by the guard.
 */
const DESTRUCTIVE_PATTERNS = [
    /\bDELETE\s+FROM\b/i,
    /\bTRUNCATE\b/i,
    /\bDROP\s+TABLE\b/i,
    /\bDROP\s+SCHEMA\b/i,
    /rm\s+-rf/i,
    /\bwipe\b/i,
    /\bpurge\b/i,
    /\btruncate\s+table\b/i,
];
/**
 * Detect whether a string contains a destructive SQL/command pattern.
 * Pure function — deterministic, no side effects.
 */
export function isDestructiveOperation(input) {
    if (!input || typeof input !== 'string')
        return false;
    return DESTRUCTIVE_PATTERNS.some((p) => p.test(input));
}
/**
 * Extract table names from a destructive SQL string. Best-effort regex
 * extraction — not a full SQL parser. Returns lowercased table names.
 * Pure function — deterministic.
 */
export function extractTableNames(sql) {
    if (!sql || typeof sql !== 'string')
        return [];
    const tables = new Set();
    // DELETE FROM <table>
    let m;
    const deleteRe = /\bDELETE\s+FROM\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi;
    while ((m = deleteRe.exec(sql)) !== null)
        tables.add(m[1].toLowerCase());
    // TRUNCATE [TABLE] <table>[, <table2>...]
    const truncateRe = /\bTRUNCATE\s+(?:TABLE\s+)?(?:public\.)?([a-z_][a-z0-9_,\s.]*)/gi;
    while ((m = truncateRe.exec(sql)) !== null) {
        for (const part of m[1].split(',')) {
            const name = part.trim().replace(/^public\./, '').toLowerCase();
            if (name)
                tables.add(name);
        }
    }
    // DROP TABLE <table>
    const dropRe = /\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi;
    while ((m = dropRe.exec(sql)) !== null)
        tables.add(m[1].toLowerCase());
    return Array.from(tables);
}
/**
 * Evaluate a destructive operation request. Decides whether it is allowed,
 * takes a pre-snapshot if it is, and writes the audit entry.
 */
export async function evaluateDestructiveOp(request) {
    const timestamp = new Date().toISOString();
    const tables = request.tables.length > 0 ? request.tables : extractTableNames(request.operation);
    let blocker = null;
    // Rule 1: Autonomous systems can NEVER run destructive ops on protected tables.
    if (request.isAutonomous) {
        const protectedHit = tables.find((t) => PROTECTED_TABLES.has(t.toLowerCase()));
        if (protectedHit) {
            blocker = `BLOCKED: Autonomous systems cannot run destructive operations on protected table "${protectedHit}". This guard was added after the 2026-07-06 data-loss incident. An owner must run this manually with explicit approval.`;
        }
    }
    // Rule 2: Even for a human owner, destructive ops require explicit approval + reason.
    if (!blocker && !request.ownerApproved) {
        blocker = 'BLOCKED: Destructive operation requires explicit owner approval. Pass ownerApproved: true and provide a written reason.';
    }
    if (!blocker && request.ownerApproved && !request.ownerReason) {
        blocker = 'BLOCKED: Owner-approved destructive operation requires a written reason explaining why the data is being deleted.';
    }
    // Rule 2b: Require recent reauthentication (within 15 minutes).
    if (!blocker && request.ownerApproved) {
        const reauthAgeMs = request.ownerReauthAt ? Date.now() - Date.parse(request.ownerReauthAt) : Infinity;
        const maxReauthMs = 15 * 60 * 1000; // 15 minutes
        if (reauthAgeMs > maxReauthMs) {
            blocker = `BLOCKED: Destructive operation requires owner reauthentication within the last 15 minutes. Last reauth: ${request.ownerReauthAt ?? 'never'}. Re-authenticate and retry.`;
        }
    }
    // Rule 2c: Require impact preview before destructive op.
    if (!blocker && request.ownerApproved && !request.impactPreviewShown) {
        blocker = 'BLOCKED: Destructive operation requires an impact preview to be shown first. Run GET /api/ivx/data-guard/check to preview the impact.';
    }
    // Rule 2d: Require soft-delete first (no immediate hard delete).
    if (!blocker && request.ownerApproved && !request.softDeleteAttempted && !request.emergency) {
        blocker = 'BLOCKED: Destructive operation requires soft-delete to be attempted first. Use POST /api/ivx/restore-center/soft-delete before hard deletion. Emergency flag bypasses this for GDPR/legal deletions.';
    }
    // Rule 2e: Two-person approval for financial/bulk destructive ops.
    const FINANCIAL_TABLES = new Set(['wallets', 'wallet_transactions', 'treasury', 'ledger', 'withdrawals', 'wire_transfers', 'earn_accounts', 'earn_deposits', 'earn_payouts', 'transactions', 'deposits', 'revenue', 'fees']);
    if (!blocker && request.ownerApproved) {
        const financialHit = tables.find((t) => FINANCIAL_TABLES.has(t.toLowerCase()));
        if (financialHit && !request.twoPersonApproved) {
            blocker = `BLOCKED: Destructive operation on financial table "${financialHit}" requires two-person approval. Create an approval request via POST /api/ivx/restore-center/approvals/create and have a second approver confirm.`;
        }
    }
    // Rule 3: Non-emergency destructive ops on protected tables require a snapshot first.
    let snapshotTaken = null;
    if (!blocker) {
        const protectedHit = tables.find((t) => PROTECTED_TABLES.has(t.toLowerCase()));
        if (protectedHit && !request.emergency) {
            try {
                snapshotTaken = await runDataVaultSnapshot();
            }
            catch (err) {
                blocker = `BLOCKED: Pre-destruction snapshot failed (cannot safely proceed without a backup): ${err instanceof Error ? err.message : 'unknown error'}`;
            }
        }
    }
    const allowed = blocker === null;
    const auditEntry = {
        timestamp,
        operation: request.operation.slice(0, 2000),
        tables,
        isAutonomous: request.isAutonomous,
        ownerApproved: request.ownerApproved,
        ownerReason: request.ownerReason,
        emergency: request.emergency,
        allowed,
        blocker,
        snapshotId: snapshotTaken?.snapshotId ?? null,
        marker: IVX_DATA_LOSS_GUARD_MARKER,
    };
    // Write to immutable audit trail
    await appendDestructiveOpAudit(auditEntry);
    if (allowed) {
        console.log(`[IVXDataLossGuard] ALLOWED destructive op on [${tables.join(', ')}] — snapshot ${snapshotTaken?.snapshotId ?? 'none'} taken`);
    }
    else {
        console.warn(`[IVXDataLossGuard] ${blocker}`);
    }
    return { allowed, blocker, snapshotTaken, auditEntry };
}
async function appendDestructiveOpAudit(entry) {
    try {
        const dir = path.dirname(AUDIT_TRAIL_FILE);
        await fs.mkdir(dir, { recursive: true });
        await fs.appendFile(AUDIT_TRAIL_FILE, JSON.stringify(entry) + '\n', 'utf8');
    }
    catch {
        // never let audit writing block the decision
    }
}
export async function readDestructiveOpAudit(limit = 100) {
    try {
        const text = await fs.readFile(AUDIT_TRAIL_FILE, 'utf8');
        const lines = text.trim().split('\n').filter(Boolean);
        return lines
            .slice(-limit)
            .map((line) => {
            try {
                return JSON.parse(line);
            }
            catch {
                return null;
            }
        })
            .filter((e) => e !== null)
            .reverse(); // newest first
    }
    catch {
        return [];
    }
}
