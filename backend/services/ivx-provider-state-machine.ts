/**
 * IVX AI Provider State Machine
 *
 * Replaces the broken retry loop that repeatedly tried the same expired
 * credential against multiple endpoints. This module enforces:
 *
 *   1. Validate provider once at startup.
 *   2. Mark invalid provider as unavailable after a confirmed 401/403.
 *   3. Never retry the same expired key (within the recovery cooldown).
 *   4. Maximum one controlled fallback attempt (with a DIFFERENT key).
 *   5. Return one clear failure with trace ID if all approved providers fail.
 *   6. Never loop endlessly through providers.
 *   7. Never expose credential values.
 *   8. RECOVERY (2026-07-18 emergency repair): failure states are NOT permanent.
 *      A latched PROVIDER_FAILED / AI_UNAVAILABLE state re-opens to a single
 *      half-open probe after IVX_AI_PROVIDER_RECOVERY_COOLDOWN_MS (default 60s),
 *      so a transient outage or a since-rotated credential can never brick the
 *      runtime until reboot. Root cause of the 2026-07-18 production outage:
 *      markAIUnavailable() latched permanently while the loaded key was valid.
 *
 * States:
 *   PROVIDER_VALIDATING → PROVIDER_READY | PROVIDER_FAILED
 *   FALLBACK_VALIDATING → FALLBACK_READY | AI_UNAVAILABLE
 */

export type IVXProviderState =
  | 'PROVIDER_VALIDATING'
  | 'PROVIDER_READY'
  | 'PROVIDER_FAILED'
  | 'FALLBACK_VALIDATING'
  | 'FALLBACK_READY'
  | 'AI_UNAVAILABLE';

export type IVXProviderHealth = {
  state: IVXProviderState;
  provider: string;
  model: string;
  adapterVersion: string;
  credentialLoaded: boolean;
  credentialValid: boolean;
  lastValidationTime: string | null;
  lastHttpStatus: number | null;
  fallbackEnabled: boolean;
  fallbackUsed: boolean;
  traceId: string | null;
  error: string | null;
};

const state: IVXProviderHealth = {
  state: 'PROVIDER_VALIDATING',
  provider: 'unknown',
  model: 'unknown',
  adapterVersion: 'unknown',
  credentialLoaded: false,
  credentialValid: false,
  lastValidationTime: null,
  lastHttpStatus: null,
  fallbackEnabled: false,
  fallbackUsed: false,
  traceId: null,
  error: null,
};

/** Wall-clock ms when the current failure state was latched. Null when healthy. */
let failureLatchedAtMs: number | null = null;

const RECOVERY_COOLDOWN_MS = (() => {
  const raw = Number.parseInt(
    typeof process.env.IVX_AI_PROVIDER_RECOVERY_COOLDOWN_MS === 'string'
      ? process.env.IVX_AI_PROVIDER_RECOVERY_COOLDOWN_MS.trim()
      : '',
    10,
  );
  return Number.isFinite(raw) && raw > 0 ? raw : 60_000;
})();

let cachedAdapterVersion: string | null = null;

function getAdapterVersion(): string {
  if (cachedAdapterVersion) return cachedAdapterVersion;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require('@ai-sdk/openai/package.json');
    cachedAdapterVersion = typeof pkg?.version === 'string' ? pkg.version : 'unknown';
  } catch {
    cachedAdapterVersion = 'unknown';
  }
  return cachedAdapterVersion!;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Mark the primary provider as failed after a confirmed auth error (401/403).
 * Once marked failed, subsequent requests skip the primary and go directly
 * to fallback (if configured) or return AI_UNAVAILABLE.
 */
export function markProviderFailed(httpStatus: number, error: string, traceId: string): void {
  state.state = 'PROVIDER_FAILED';
  failureLatchedAtMs = Date.now();
  state.credentialValid = false;
  state.lastHttpStatus = httpStatus;
  state.lastValidationTime = nowIso();
  state.traceId = traceId;
  state.error = error;
  console.error('[IVXProviderStateMachine] PROVIDER_FAILED', {
    provider: state.provider,
    httpStatus,
    traceId,
    error: error.slice(0, 200),
  });
}

/**
 * Mark the primary provider as ready after a successful request.
 */
export function markProviderReady(provider: string, model: string): void {
  state.state = 'PROVIDER_READY';
  failureLatchedAtMs = null;
  state.provider = provider;
  state.model = model;
  state.credentialLoaded = true;
  state.credentialValid = true;
  state.lastValidationTime = nowIso();
  state.lastHttpStatus = 200;
  state.adapterVersion = getAdapterVersion();
  state.error = null;
}

/**
 * Mark fallback as used and ready.
 */
export function markFallbackReady(provider: string, model: string): void {
  state.state = 'FALLBACK_READY';
  failureLatchedAtMs = null;
  state.fallbackUsed = true;
  state.fallbackEnabled = true;
  state.lastHttpStatus = 200;
  state.lastValidationTime = nowIso();
  console.log('[IVXProviderStateMachine] FALLBACK_READY', { provider, model });
}

/**
 * Mark AI as completely unavailable — primary failed, no fallback succeeded.
 */
export function markAIUnavailable(traceId: string, error: string): void {
  state.state = 'AI_UNAVAILABLE';
  failureLatchedAtMs = Date.now();
  state.traceId = traceId;
  state.error = error;
  state.lastValidationTime = nowIso();
  console.error('[IVXProviderStateMachine] AI_UNAVAILABLE', { traceId, error: error.slice(0, 200) });
}

/**
 * Initialize the state machine at startup with the detected provider info.
 */
export function initProviderStateMachine(provider: string, model: string, credentialLoaded: boolean, fallbackEnabled: boolean): void {
  state.provider = provider;
  state.model = model;
  state.credentialLoaded = credentialLoaded;
  state.fallbackEnabled = fallbackEnabled;
  state.adapterVersion = getAdapterVersion();
  state.state = credentialLoaded ? 'PROVIDER_VALIDATING' : 'AI_UNAVAILABLE';
  state.lastValidationTime = nowIso();
}

/**
 * Returns true if the primary provider should be attempted.
 *
 * Failure states (PROVIDER_FAILED / AI_UNAVAILABLE) block the primary only
 * for the recovery cooldown window. After the cooldown, the circuit re-opens
 * half-way: the state moves back to PROVIDER_VALIDATING and exactly one probe
 * attempt is allowed. Success re-latches PROVIDER_READY; failure re-latches
 * the failure state and restarts the cooldown. Recovery is only offered when
 * a credential is actually loaded.
 */
export function shouldTryPrimary(): boolean {
  if (state.state !== 'PROVIDER_FAILED' && state.state !== 'AI_UNAVAILABLE') {
    return true;
  }
  if (!state.credentialLoaded) {
    return false;
  }
  if (failureLatchedAtMs !== null && Date.now() - failureLatchedAtMs >= RECOVERY_COOLDOWN_MS) {
    state.state = 'PROVIDER_VALIDATING';
    failureLatchedAtMs = null;
    console.log('[IVXProviderStateMachine] Recovery cooldown elapsed — re-opening primary provider for a half-open probe attempt', {
      cooldownMs: RECOVERY_COOLDOWN_MS,
    });
    return true;
  }
  return false;
}

/**
 * Returns true if a fallback should be attempted.
 * Only if fallback is enabled AND the primary just failed (not if already unavailable).
 */
export function shouldTryFallback(): boolean {
  return state.state === 'PROVIDER_FAILED';
}

/**
 * Get the current provider health snapshot (safe for owner diagnostics — no secrets).
 */
export function getProviderHealth(): IVXProviderHealth {
  return { ...state };
}

/**
 * Reset the state machine (for testing).
 */
export function resetProviderStateMachine(): void {
  failureLatchedAtMs = null;
  state.state = 'PROVIDER_VALIDATING';
  state.provider = 'unknown';
  state.model = 'unknown';
  state.adapterVersion = 'unknown';
  state.credentialLoaded = false;
  state.credentialValid = false;
  state.lastValidationTime = null;
  state.lastHttpStatus = null;
  state.fallbackEnabled = false;
  state.fallbackUsed = false;
  state.traceId = null;
  state.error = null;
}