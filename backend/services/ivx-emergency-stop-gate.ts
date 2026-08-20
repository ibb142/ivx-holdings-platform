/**
 * IVX Emergency-Stop Gate — runtime enforcement of the owner's emergency-stop
 * control (`ivx_agent_controls.control_name = 'emergency_stop'`).
 *
 * Owner control hierarchy:
 *   - active=true: no new agent task may start.
 *   - read/monitoring callers may tolerate a transient control-store outage.
 *   - MUTATION callers must FAIL CLOSED when the stop state cannot be verified.
 *
 * This split keeps IVX observable during an outage while ensuring patch, commit,
 * push, merge, migration, deploy, rollback and other state-changing autonomous
 * operations never continue when IVX cannot prove the owner has not stopped them.
 */

const CONTROL_TABLE = 'ivx_agent_controls';
const CONTROL_NAME = 'emergency_stop';
const CACHE_TTL_MS = 15_000;

export const IVX_EMERGENCY_STOP_GATE_MARKER = 'ivx-emergency-stop-gate-2026-08-20-owner-mutation-fail-closed';

export type EmergencyStopStatus = {
  active: boolean;
  reason: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  checkedAt: string;
  source: 'supabase' | 'cache' | 'unavailable';
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

export function resetEmergencyStopCacheForTests(): void {
  cached = null;
  cachedAtMs = 0;
}

/**
 * Read the owner stop flag. This low-level read remains observation-friendly:
 * callers decide whether an unavailable control store is acceptable. Mutation
 * callers MUST use `assertAutonomousMutationAllowed` below.
 */
export async function checkEmergencyStop(): Promise<EmergencyStopStatus> {
  const now = Date.now();
  if (cached && now - cachedAtMs < CACHE_TTL_MS) {
    return { ...cached, source: 'cache', checkedAt: nowIso() };
  }

  const url = getSupabaseUrl();
  const key = getServiceRoleKey();
  if (!url || !key) {
    const status: EmergencyStopStatus = {
      active: false,
      reason: null,
      updatedBy: null,
      updatedAt: null,
      checkedAt: nowIso(),
      source: 'unavailable',
      error: 'Supabase URL or service key not configured; emergency-stop state is unverified.',
    };
    console.warn('[EmergencyStopGate] not configured — stop state unavailable');
    return status;
  }

  try {
    const query = `${url}/rest/v1/${CONTROL_TABLE}?control_name=eq.${CONTROL_NAME}&select=control_name,active,reason,updated_by,updated_at&limit=1`;
    const response = await fetch(query, {
      method: 'GET',
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Supabase read failed with HTTP ${response.status}`);

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
    console.error(`[EmergencyStopGate] read failed — stop state unavailable: ${message}`);
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
 * General task-start guard. Preserves existing behavior for non-mutating work:
 * an explicitly active stop blocks; unavailable state does not automatically
 * freeze read-only monitoring/analysis.
 */
export async function assertEmergencyStopInactive(context: string): Promise<EmergencyStopStatus> {
  const status = await checkEmergencyStop();
  if (status.active) {
    throw new Error(
      `EMERGENCY_STOP_ACTIVE: owner emergency stop is engaged (${status.reason ?? 'no reason recorded'}); refused: ${context}`,
    );
  }
  return status;
}

/**
 * Mandatory guard for autonomous mutations. FAIL CLOSED when the owner stop
 * control cannot be verified. Use before patch/commit/push/merge/migration/
 * deploy/rollback or any equivalent state-changing action.
 */
export async function assertAutonomousMutationAllowed(context: string): Promise<EmergencyStopStatus> {
  const status = await checkEmergencyStop();
  if (status.active) {
    throw new Error(
      `EMERGENCY_STOP_ACTIVE: owner emergency stop is engaged (${status.reason ?? 'no reason recorded'}); mutation refused: ${context}`,
    );
  }
  if (status.source === 'unavailable') {
    throw new Error(
      `EMERGENCY_STOP_UNVERIFIED: owner stop state could not be verified; autonomous mutation fails closed: ${context}`,
    );
  }
  return status;
}
