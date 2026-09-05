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
 *   - Read errors are reported as `source: unavailable`; execution guards fail
 *     CLOSED so a control-plane outage can never bypass an owner stop.
 *   - Results are cached for a short window to avoid hammering Supabase from
 *     hot loops.
 */

const CONTROL_TABLE = 'ivx_agent_controls';
const CONTROL_NAME = 'emergency_stop';
const CACHE_TTL_MS = 15_000;

export const IVX_EMERGENCY_STOP_GATE_MARKER = 'ivx-emergency-stop-gate-2026-09-05-v2-fail-closed';

export type EmergencyStopStatus = {
  /** True when the owner has engaged the emergency stop. */
  active: boolean;
  /** Owner-provided reason recorded on the control row, when present. */
  reason: string | null;
  /** Who last updated the control row. */
  updatedBy: string | null;
  /** When the control row was last updated. */
  updatedAt: string | null;
  /** When this status was read. */
  checkedAt: string;
  /** Where the answer came from. `unavailable` = read failed and execution must fail closed. */
  source: 'supabase' | 'cache' | 'unavailable';
  /** Read error detail when source === 'unavailable'. Never contains secrets. */
  error: string | null;
};

type ControlRow = {
  control_name?: unknown;
  active?: unknown;
  reason?: unknown;
  updated_by?: unknown;
  updated_at?: unknown;
};

let cached: EmergencyStopStatus | null = null;
let cachedAtMs = 0;

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function getSupabaseUrl(): string {
  for (const name of ['EXPO_PUBLIC_SUPABASE_URL', 'SUPABASE_URL']) {
    const value = readTrimmed(process.env[name]).replace(/\/+$/, '');
    if (value) return value;
  }
  return '';
}

function getServiceRoleKey(): string {
  for (const name of ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY']) {
    const value = readTrimmed(process.env[name]);
    if (value) return value;
  }
  return '';
}

function nowIso(): string {
  return new Date().toISOString();
}

function unavailableStatus(error: string): EmergencyStopStatus {
  return {
    active: false,
    reason: null,
    updatedBy: null,
    updatedAt: null,
    checkedAt: nowIso(),
    source: 'unavailable',
    error,
  };
}

/** Test-only escape hatch so unit tests can reset the cache between cases. */
export function resetEmergencyStopCacheForTests(): void {
  cached = null;
  cachedAtMs = 0;
}

/**
 * Read the emergency-stop control. Cached for CACHE_TTL_MS. A failed read does
 * not fabricate `active:true`; it returns `source:'unavailable'`. Task/start
 * boundaries MUST use `assertEmergencyStopInactive`, which fails closed for
 * unavailable state.
 */
export async function checkEmergencyStop(): Promise<EmergencyStopStatus> {
  const now = Date.now();
  if (cached && now - cachedAtMs < CACHE_TTL_MS) {
    return { ...cached, source: 'cache', checkedAt: nowIso() };
  }

  const url = getSupabaseUrl();
  const key = getServiceRoleKey();
  if (!url || !key) {
    const status = unavailableStatus('Supabase URL or service key not configured; emergency-stop state cannot be verified.');
    console.warn('[EmergencyStopGate] not configured — execution guards will fail closed');
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
    const rows = (await response.json()) as ControlRow[];
    const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    const status: EmergencyStopStatus = {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown read error';
    console.error(`[EmergencyStopGate] read failed — execution guards will fail closed: ${message}`);
    return unavailableStatus(message);
  }
}

/**
 * Convenience guard: throws when the emergency stop is active OR when the
 * owner control state cannot be verified. Use at task enqueue/start boundaries.
 */
export async function assertEmergencyStopInactive(context: string): Promise<EmergencyStopStatus> {
  const status = await checkEmergencyStop();
  if (status.source === 'unavailable') {
    throw new Error(
      `EMERGENCY_STOP_UNAVAILABLE: owner emergency-stop state could not be verified; refused: ${context}`,
    );
  }
  if (status.active) {
    throw new Error(
      `EMERGENCY_STOP_ACTIVE: owner emergency stop is engaged (${status.reason ?? 'no reason recorded'}); refused: ${context}`,
    );
  }
  return status;
}
