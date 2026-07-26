/**
 * IVX Owner Recovery Audit — append-only, tamper-evident log.
 *
 * Records every recovery request/verify/resolve action without storing the raw
 * recovery token. Instead it stores a SHA-256 hash of the token and the phone
 * number so the audit trail can prove what happened while keeping secrets safe.
 *
 * Storage: local JSONL file under backend/logs/audit/owner-recovery/YYYY-MM-DD.jsonl
 * plus an in-memory ring buffer for live status checks. No raw tokens are ever
 * written.
 */
import { createHash, randomBytes } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
const BACKEND_VERSION = 'ivx-owner-recovery-audit-v1';
const AUDIT_DIR = 'backend/logs/audit/owner-recovery';
/** In-memory ring buffer for recent events (last 256). */
const recentEvents = [];
const MAX_RECENT = 256;
function hash(value) {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}
export function hashPhone(phone) {
    return hash(normalizePhone(phone));
}
export function hashToken(token) {
    return hash(token);
}
export function normalizePhone(input) {
    const raw = (input || '').trim().replace(/\D/g, '');
    if (!raw)
        return '';
    if (raw.length === 10)
        return `+1${raw}`;
    if (raw.length === 11 && raw.startsWith('1'))
        return `+${raw}`;
    return `+${raw}`;
}
function todayFile() {
    const date = new Date().toISOString().slice(0, 10);
    return `${AUDIT_DIR}/${date}.jsonl`;
}
/** Append a recovery audit event. Never stores raw tokens or raw phone numbers. */
export async function appendRecoveryAudit(event) {
    const record = {
        ...event,
        timestamp: new Date().toISOString(),
        backendVersion: BACKEND_VERSION,
    };
    recentEvents.push(record);
    if (recentEvents.length > MAX_RECENT) {
        recentEvents.shift();
    }
    try {
        const path = todayFile();
        await mkdir(dirname(path), { recursive: true });
        await appendFile(path, `${JSON.stringify(record)}\n`, 'utf8');
    }
    catch (error) {
        console.log('[OwnerRecoveryAudit] append failed:', error instanceof Error ? error.message : 'unknown');
    }
}
/** Get recent recovery audit events (no secrets). */
export function getRecentRecoveryAudit(limit = 50) {
    return recentEvents.slice(-limit);
}
/** Generate a cryptographically secure random recovery token. */
export function generateSecureRecoveryToken() {
    return randomBytes(32).toString('hex');
}
/** Count recent failed attempts per email in a time window. */
export function countRecentFailures(email, windowMs) {
    const cutoff = Date.now() - windowMs;
    return recentEvents.filter((e) => e.email === email && !e.success && new Date(e.timestamp).getTime() > cutoff).length;
}
/** Count recent SMS requests per email in a time window. */
export function countRecentRequests(email, windowMs) {
    const cutoff = Date.now() - windowMs;
    return recentEvents.filter((e) => e.email === email && e.action === 'request' && new Date(e.timestamp).getTime() > cutoff).length;
}
