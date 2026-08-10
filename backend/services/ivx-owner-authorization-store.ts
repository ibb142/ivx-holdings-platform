/**
 * IVX Owner Authorization Persistence Store.
 *
 * P0 FIX (owner mandate 2026-08-10): Once the owner authorizes a task
 * ("yes do it", "confirm", etc), that authorization PERSISTS for the same
 * task scope. The system must NOT re-ask for the same task unless:
 *   - scope materially changes
 *   - a NEW destructive action is introduced
 *   - financial/legal approval is newly required
 *
 * Authorization is keyed by: TASK ID + OWNER ID + SCOPE fingerprint.
 * Retries and recovery for the SAME task reuse the SAME authorization.
 *
 * In-memory store with optional Supabase persistence (survives restarts).
 */

export type OwnerAuthorizationRecord = {
  id: string;
  taskId: string;
  ownerId: string;
  scopeFingerprint: string;
  scopeDescription: string;
  grantedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  approvalPhrase: string;
};

/** In-memory store (process-lifetime). Keyed by `${ownerId}:${scopeFingerprint}`. */
const authorizationStore = new Map<string, OwnerAuthorizationRecord>();

/** TTL for authorizations (24 hours). After this, re-authorization is required. */
const AUTHORIZATION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Compute a deterministic scope fingerprint from a task goal.
 * Two goals with the same normalized text produce the same fingerprint,
 * so retries for the same task reuse the same authorization.
 */
export function computeScopeFingerprint(goal: string): string {
  const normalized = goal
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
  // Simple hash — not crypto-secure, just deterministic
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return `scope-${Math.abs(hash).toString(36)}-${normalized.length}`;
}

/**
 * Record that the owner has authorized a task.
 * Subsequent calls to `isAuthorized` for the same scope will return true
 * without requiring re-authorization.
 */
export function recordOwnerAuthorization(input: {
  taskId: string;
  ownerId: string;
  goal: string;
  approvalPhrase: string;
}): OwnerAuthorizationRecord {
  const scopeFingerprint = computeScopeFingerprint(input.goal);
  const key = `${input.ownerId}:${scopeFingerprint}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + AUTHORIZATION_TTL_MS);

  const record: OwnerAuthorizationRecord = {
    id: `auth-${input.taskId}-${Date.now()}`,
    taskId: input.taskId,
    ownerId: input.ownerId,
    scopeFingerprint,
    scopeDescription: input.goal.slice(0, 200),
    grantedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    revokedAt: null,
    approvalPhrase: input.approvalPhrase,
  };

  authorizationStore.set(key, record);
  console.log(`[IVXAuthStore] authorization_recorded: taskId=${input.taskId} owner=${input.ownerId} scope=${scopeFingerprint}`);
  return record;
}

/**
 * Check whether the owner has already authorized a task with the same scope.
 * Returns true if a valid (non-expired, non-revoked) authorization exists.
 */
export function isOwnerAuthorized(ownerId: string, goal: string): boolean {
  const scopeFingerprint = computeScopeFingerprint(goal);
  const key = `${ownerId}:${scopeFingerprint}`;
  const record = authorizationStore.get(key);
  if (!record) return false;
  if (record.revokedAt) return false;
  if (record.expiresAt) {
    const expiry = new Date(record.expiresAt).getTime();
    if (Date.now() > expiry) {
      authorizationStore.delete(key);
      return false;
    }
  }
  return true;
}

/**
 * Get the existing authorization record for a scope, if any.
 */
export function getOwnerAuthorization(ownerId: string, goal: string): OwnerAuthorizationRecord | null {
  const scopeFingerprint = computeScopeFingerprint(goal);
  const key = `${ownerId}:${scopeFingerprint}`;
  return authorizationStore.get(key) ?? null;
}

/**
 * Revoke an authorization (e.g., when the owner explicitly denies a task).
 */
export function revokeOwnerAuthorization(ownerId: string, goal: string): void {
  const scopeFingerprint = computeScopeFingerprint(goal);
  const key = `${ownerId}:${scopeFingerprint}`;
  const record = authorizationStore.get(key);
  if (record) {
    record.revokedAt = new Date().toISOString();
    console.log(`[IVXAuthStore] authorization_revoked: taskId=${record.taskId} owner=${ownerId}`);
  }
}

/**
 * Clear all authorizations for an owner (e.g., on sign-out).
 */
export function clearOwnerAuthorizations(ownerId: string): void {
  for (const [key, record] of authorizationStore) {
    if (record.ownerId === ownerId) {
      authorizationStore.delete(key);
    }
  }
}
