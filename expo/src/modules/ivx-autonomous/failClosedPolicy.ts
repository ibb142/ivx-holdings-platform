/**
 * Versioned fail-closed contract for the IVX autonomous system.
 *
 * Single source of truth for the autonomous safety policy consumed by the
 * Owner Audit screen, the telemetry readers, and mirrored inline by the
 * GitHub Actions nervous-system diagnosis JSON. Tests enforce this contract
 * structurally so no layer can silently weaken it.
 */
export const IVX_FAIL_CLOSED_POLICY = {
  /** No telemetry failure may ever be rendered as a fabricated zero. */
  falseZeroForbidden: true,
  /** Fail closed on any unverified state — UNKNOWN, never optimistic. */
  failClosed: true,
  /** Machine identities are limited to low-risk repair; high-risk stays owner-gated. */
  ownerGateHighRiskOnly: true,
  /** Bounded autonomous redo attempts. */
  maxRepairAttempts: 3,
  /** GitHub-native circuit breaker when the backend worker is unreachable. */
  githubNativeFallback: true,
} as const;

export type IVXFailClosedPolicy = typeof IVX_FAIL_CLOSED_POLICY;
