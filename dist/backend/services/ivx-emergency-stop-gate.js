/**
 * IVX Emergency-Stop Gate — runtime enforcement of the owner's emergency-stop
 * control (`ivx_agent_controls.control_name = 'emergency_stop'`).
 *
 * FINAL MANDATE Phase 1 wiring (2026-07-18): every agent task runner MUST call
 * `checkEmergencyStop()` before starting work and refuse to run when the flag
 * is active. The flag is stored in Supabase so the owner can halt all agents
 * from any surface (dashboard, SQL, chat command) without a redeploy.
 *
 * Behavior:
 *   - `active: true`  → agents must NOT start new tasks (enqueue refused,
 *     queued jobs marked blocked).
 *   - Read errors fail OPEN (agents keep working) so a transient Supabase
 *     outage cannot silently freeze production work; every failed read is
 *     logged for audit.
 *   - Results are cached for a short window to avoid hammering Supabase from
 *     hot loops.
 */
const CONTROL_TABLE = 'ivx_agent_controls';
const CONTROL_NAME = 'emergency_stop';
const CACHE_TTL_MS = 15_000;
export const IVX_EMERGENCY_STOP_GATE_MARKER = 'ivx-emergency-stop-gate-2026-07-18';
let cached = null;
let cachedAtMs = 0;
function readTrimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function getSupabaseUrl() {
    for (const name of ['EXPO_PUBLIC_SUPABASE_URL', 'SUPABASE_URL']) {
        const value = readTrimmed(process.env[name]).replace(/\/+$/, '');
        if (value)
            return value;
    }
    return '';
}
function getServiceRoleKey() {
    for (const name of ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY']) {
        const value = readTrimmed(process.env[name]);
        if (value)
            return value;
    }
    return '';
}
function nowIso() {
    return new Date().toISOString();
}
/** Test-only escape hatch so unit tests can reset the cache between cases. */
export function resetEmergencyStopCacheForTests() {
    cached = null;
    cachedAtMs = 0;
}
/**
 * Read the emergency-stop control. Cached for CACHE_TTL_MS. Fails OPEN
 * (active:false, source:'unavailable') when Supabase is unreachable or not
 * configured, and logs the failure for audit.
 */
export async function checkEmergencyStop() {
    const now = Date.now();
    if (cached && now - cachedAtMs < CACHE_TTL_MS) {
        return { ...cached, source: 'cache', checkedAt: nowIso() };
    }
    const url = getSupabaseUrl();
    const key = getServiceRoleKey();
    if (!url || !key) {
        const status = {
            active: false,
            reason: null,
            updatedBy: null,
            updatedAt: null,
            checkedAt: nowIso(),
            source: 'unavailable',
            error: 'Supabase URL or service key not configured; emergency-stop gate failed open.',
        };
        console.warn('[EmergencyStopGate] not configured — failing open');
        return status;
    }
    try {
        const query = `${url}/rest/v1/${CONTROL_TABLE}?control_name=eq.${CONTROL_NAME}&select=control_name,active,reason,updated_by,updated_at&limit=1`;
        const response = await fetch(query, {
            method: 'GET',
            headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
            signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok) {
            throw new Error(`Supabase read failed with HTTP ${response.status}`);
        }
        const rows = (await response.json());
        const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
        const status = {
            active: row ? row.active === true : false,
            reason: row ? readTrimmed(row.reason) || null : null,
            updatedBy: row ? readTrimmed(row.updated_by) || null : null,
            updatedAt: row ? readTrimmed(row.updated_at) || null : null,
            checkedAt: nowIso(),
            source: 'supabase',
            error: null,
        };
        cached = status;
        cachedAtMs = now;
        if (status.active) {
            console.warn(`[EmergencyStopGate] EMERGENCY STOP ACTIVE — reason: ${status.reason ?? 'none given'}`);
        }
        return status;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'unknown read error';
        console.error(`[EmergencyStopGate] read failed — failing open: ${message}`);
        return {
            active: false,
            reason: null,
            updatedBy: null,
            updatedAt: null,
            checkedAt: nowIso(),
            source: 'unavailable',
            error: message,
        };
    }
}
/**
 * Convenience guard: throws when the emergency stop is active. Use at task
 * enqueue/start boundaries.
 */
export async function assertEmergencyStopInactive(context) {
    const status = await checkEmergencyStop();
    if (status.active) {
        throw new Error(`EMERGENCY_STOP_ACTIVE: owner emergency stop is engaged (${status.reason ?? 'no reason recorded'}); refused: ${context}`);
    }
    return status;
}
