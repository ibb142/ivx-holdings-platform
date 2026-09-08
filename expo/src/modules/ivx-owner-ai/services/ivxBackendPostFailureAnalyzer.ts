/**
 * BACKEND_POST_FINISHED failure classifier + frequency analyzer.
 *
 * The watchdog (`ivxAIWatchdog`) persists the last 20 per-message diagnostic
 * reports to AsyncStorage. When the assistant reply path fails, the failing
 * checkpoint is `BACKEND_POST_FINISHED` (the HTTP round-trip to
 * `/api/ivx/owner-ai`). This module turns those raw reports into the exact
 * root-cause investigation the owner asked for:
 *
 *   1. Trace every BACKEND_POST_FINISHED failure across the persisted reports.
 *   2. Classify each into one canonical cause bucket.
 *   3. Group by cause and rank the top causes by frequency, with evidence
 *      (counts, requestIds/traceIds, timestamps, status codes, sample reason).
 *
 * It is intentionally runtime-free (no React Native imports) so it can be unit
 * tested with bun and reused anywhere. It consumes a minimal structural subset
 * of `WatchdogReport`, so it never pulls in the heavy watchdog module.
 */

/**
 * The canonical cause buckets the owner requested, mapped 1:1 to the watchdog's
 * required classification set:
 *   AUTH=owner_ai_route_failure · ROUTE_MISSING=route_missing · TIMEOUT=timeout
 *   PROVIDER=provider · BACKEND_5XX=backend_exception · NETWORK=network_error
 *   PARSE=parse_error · (4xx)=status_code · UNKNOWN=other.
 * `other`/UNKNOWN is only ever used when there is NO endpoint/status/body to
 * classify from — never when an HTTP status or response body exists.
 */
export type BackendPostFailureCause =
  | 'owner_ai_route_failure' // owner-gated route auth/route rejection (401/403, fell back)
  | 'route_missing' // 404 / route not registered / no such endpoint
  | 'status_code' // non-2xx HTTP that is not auth/5xx/404 (other 4xx client errors)
  | 'timeout' // request/reliability/watchdog timeout, 408
  | 'provider' // AI provider/model failure: provider exhausted, 429 rate limit, gateway model error
  | 'network_error' // fetch failed / unreachable / aborted by caller
  | 'parse_error' // response_invalid / JSON / empty answer
  | 'backend_exception' // HTTP 5xx or service-unavailable HTML
  | 'other';

/** Minimal structural shape of a watchdog report this analyzer needs. */
export interface AnalyzableWatchdogReport {
  traceId: string;
  finalStatus: 'PENDING' | 'SUCCESS' | 'DEGRADED' | 'VISIBLE_ERROR' | 'SILENT_FAILURE' | 'BLOCKED';
  failedCheckpoint: string | null;
  failureReason: string | null;
  statusCode: number | null;
  backendResponse: string | null;
  startedAt: string;
  endedAt: string | null;
  /** Optional: when present, surfaced as the evidence request id. */
  requestId?: string | null;
}

/**
 * The seven owner-facing warning labels. Every watchdog report is classified
 * into exactly one of these so the UI shows a TRUTHFUL severity:
 *   - green  (`success`): SUCCESS_VERIFIED
 *   - yellow (`warning`): DEGRADED_RECOVERY, AUTH_REQUIRED
 *   - red    (`error`):   NETWORK_FAILED, TIMEOUT, PARSE_ERROR, TRUE_FAILURE
 *
 * The core rule (owner spec): a red BLOCKED warning is NEVER shown when a valid
 * answer was returned, a response body exists, the assistant message persisted,
 * or a fallback recovery completed successfully — those are yellow (recovered),
 * not red (real failure).
 */
export type WarningClassification =
  | 'SUCCESS_VERIFIED'
  | 'IN_PROGRESS'
  | 'DEGRADED_RECOVERY'
  | 'AUTH_REQUIRED'
  | 'NETWORK_FAILED'
  | 'TIMEOUT'
  | 'PARSE_ERROR'
  | 'TRUE_FAILURE';

/**
 * `info` is a NON-failure, NON-degraded neutral state used ONLY for a request
 * that is still in flight (`PENDING`). A working request must never be painted
 * as "degraded — recovered" (which implies a privileged route failed and a
 * fallback answered). It gets its own neutral severity so the banner can show a
 * truthful "WORKING…" state instead of blank DEGRADED fields.
 */
export type WarningSeverity = 'success' | 'info' | 'warning' | 'error';

export interface ClassifiedWarning {
  classification: WarningClassification;
  severity: WarningSeverity;
  /** Human-readable label for the badge/banner. */
  label: string;
  /** True only for `error` severity — the red BLOCKED banner should fire. */
  isRealFailure: boolean;
}

export const WARNING_CLASSIFICATION_LABEL: Record<WarningClassification, string> = {
  SUCCESS_VERIFIED: 'Verified success',
  IN_PROGRESS: 'Working — in progress',
  DEGRADED_RECOVERY: 'Degraded — recovered',
  AUTH_REQUIRED: 'Auth/session needs repair',
  NETWORK_FAILED: 'Network failed',
  TIMEOUT: 'Timed out',
  PARSE_ERROR: 'Invalid response',
  TRUE_FAILURE: 'Real failure',
};

const WARNING_SEVERITY: Record<WarningClassification, WarningSeverity> = {
  SUCCESS_VERIFIED: 'success',
  IN_PROGRESS: 'info',
  DEGRADED_RECOVERY: 'warning',
  AUTH_REQUIRED: 'warning',
  NETWORK_FAILED: 'error',
  TIMEOUT: 'error',
  PARSE_ERROR: 'error',
  TRUE_FAILURE: 'error',
};

/**
 * Classify a single watchdog report into one of the seven owner-facing warning
 * labels + its severity. This is the single source of truth for the panel
 * colors:
 *   - SUCCESS  → green SUCCESS_VERIFIED.
 *   - DEGRADED → yellow DEGRADED_RECOVERY (recovered via fallback / privileged
 *     route bypassed but a real answer was delivered). NEVER red.
 *   - real failure states (BLOCKED / SILENT_FAILURE / VISIBLE_ERROR) → mapped
 *     by cause: owner-route/auth → yellow AUTH_REQUIRED (recoverable by
 *     re-authenticating); network/timeout/parse → red; everything else → red
 *     TRUE_FAILURE.
 *
 * It is intentionally runtime-free so the panel + tests share one classifier.
 */
export function classifyWatchdogWarning(report: AnalyzableWatchdogReport): ClassifiedWarning {
  const build = (classification: WarningClassification): ClassifiedWarning => {
    const severity = WARNING_SEVERITY[classification];
    return {
      classification,
      severity,
      label: WARNING_CLASSIFICATION_LABEL[classification],
      isRealFailure: severity === 'error',
    };
  };

  if (report.finalStatus === 'SUCCESS') {
    return build('SUCCESS_VERIFIED');
  }
  // A response existed and the request recovered via fallback — never red.
  if (report.finalStatus === 'DEGRADED') {
    return build('DEGRADED_RECOVERY');
  }
  // PENDING (still in-flight) is NOT degraded and NOT a failure. It is an active
  // request still working between checkpoints. Painting it DEGRADED_RECOVERY was
  // the root cause of the "IVX AI DEGRADED — DEGRADED_RECOVERY" banner showing
  // blank fields (failedCheckpoint: —, statusCode: —) while the composer was
  // still "Sending message…": nothing had failed or recovered yet. It now gets a
  // neutral, truthful IN_PROGRESS state instead of a misleading degraded label.
  if (report.finalStatus === 'PENDING') {
    return build('IN_PROGRESS');
  }

  // Remaining: BLOCKED / SILENT_FAILURE / VISIBLE_ERROR — a genuine non-recovered
  // failure. Map the cause to the precise label.
  const cause = classifyBackendPostFailureReason({
    statusCode: report.statusCode,
    reason: report.failureReason,
    backendResponse: report.backendResponse,
  });
  switch (cause) {
    case 'owner_ai_route_failure':
      // Auth/session rejection that did NOT recover — recoverable by re-auth, so
      // it is surfaced as a yellow "needs repair" warning, not a red crash.
      return build('AUTH_REQUIRED');
    case 'timeout':
      return build('TIMEOUT');
    case 'network_error':
      return build('NETWORK_FAILED');
    case 'parse_error':
      return build('PARSE_ERROR');
    default:
      return build('TRUE_FAILURE');
  }
}

export interface ClassifiedBackendPostFailure {
  traceId: string;
  cause: BackendPostFailureCause;
  statusCode: number | null;
  reason: string;
  /** ISO timestamp of when the failure was recorded (endedAt || startedAt). */
  at: string;
  requestId: string | null;
}

export interface BackendPostFailureCauseGroup {
  cause: BackendPostFailureCause;
  count: number;
  /** Distinct status codes observed for this cause (sorted asc). */
  statusCodes: number[];
  /** Trace ids (newest-first) — the durable evidence handle for each failure. */
  traceIds: string[];
  /** Request ids when known (newest-first, blanks dropped). */
  requestIds: string[];
  firstAt: string;
  lastAt: string;
  /** A representative failure reason for this cause. */
  sampleReason: string;
}

export interface BackendPostFailureAnalysis {
  /** Total reports scanned (any status). */
  totalReports: number;
  /** Total BACKEND_POST_FINISHED failures found. */
  totalFailures: number;
  /** Grouped by cause, ranked by frequency (desc). */
  groups: BackendPostFailureCauseGroup[];
  /** The top 5 causes by frequency. */
  top5: BackendPostFailureCauseGroup[];
  generatedAt: string;
}

const BACKEND_POST_CHECKPOINT = 'BACKEND_POST_FINISHED';

/** Human-readable label per cause (for UI + reports). */
export const BACKEND_POST_FAILURE_CAUSE_LABEL: Record<BackendPostFailureCause, string> = {
  owner_ai_route_failure: 'Auth — owner-AI route failure (401/403 → fallback)',
  route_missing: 'Route missing (404 / endpoint not registered)',
  status_code: 'HTTP status code (4xx client error)',
  timeout: 'Timeout (request / reliability budget / watchdog)',
  provider: 'Provider failure (AI provider / model / 429 rate limit)',
  network_error: 'Network error (unreachable / fetch failed / aborted)',
  parse_error: 'Parse error (invalid / empty response body)',
  backend_exception: 'Backend exception (5xx / service unavailable)',
  other: 'Unknown (no endpoint / status / body to classify)',
};

function lower(value: string | null | undefined): string {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

/**
 * Pure classifier — maps one watchdog report's failure evidence to a single
 * canonical cause bucket. Order matters: more specific signals win first.
 */
export function classifyBackendPostFailureReason(input: {
  statusCode: number | null;
  reason: string | null;
  backendResponse: string | null;
}): BackendPostFailureCause {
  const status = input.statusCode;
  const reason = lower(input.reason);
  const body = lower(input.backendResponse);
  const haystack = `${reason} ${body}`;

  // 1. A dependency timeout is not proof that the owner's JWT is invalid.
  //    Check it before the broad auth markers so a Supabase getUser timeout stays
  //    retryable and is reported truthfully.
  if (status === 408 || /timed out|timeout|total timeout|no progress past/.test(haystack)) {
    return 'timeout';
  }

  // 2. Owner-gated route auth rejection / fallback — the dominant documented
  //    cause (BLOCK 13/21/30). Detect by status OR the route-failure markers
  //    the request service stamps onto the reason.
  if (
    status === 401
    || status === 403
    || /owner_route_auth|owner_session|owner_token_missing|fell back|fallback|privileged (owner )?session|auth guard|auth_missing|invalid or expired supabase session/.test(haystack)
  ) {
    return 'owner_ai_route_failure';
  }

  // 3. Route missing — 404 / endpoint not registered / no such route. Must win
  //    before the generic 4xx status bucket so a missing route is never lumped
  //    into ambiguous "status code".
  if (status === 404 || /route_missing|not found|no such route|route not registered|cannot (?:post|get) \//.test(haystack)) {
    return 'route_missing';
  }

  // 4. Backend exception — 5xx, or the service-unavailable HTML classification
  //    (Render cold start / edge cache miss returns an HTML error page).
  if (
    (typeof status === 'number' && status >= 500)
    || /service_unavailable_html|service temporarily unavailable|service unavailable|bad gateway|gateway timeout|html response|<!doctype|<html/.test(haystack)
  ) {
    return 'backend_exception';
  }

  // 5. Provider failure — AI provider/model error or 429 rate limit. The model
  //    layer (OpenAI / AI gateway) is a distinct cause from a 5xx backend crash.
  if (
    status === 429
    || /provider_exhausted|provider failed|all providers|provider error|ai gateway|model (?:error|failed|unavailable)|openai|rate limit|too many requests|quota/.test(haystack)
  ) {
    return 'provider';
  }

  // 6. Network error — fetch-level failure / unreachable / caller abort.
  if (
    /network request failed|failed to fetch|load failed|network unreachable|unreachable|aborted by caller|abort/.test(haystack)
  ) {
    return 'network_error';
  }

  // 7. Parse error — invalid contract / JSON / empty answer.
  if (
    /response_invalid|parse|json|unexpected token|empty answer|malformed|invalid response|could not normalize/.test(haystack)
  ) {
    return 'parse_error';
  }

  // 8. Any other non-2xx status with a known code → status_code bucket (4xx).
  if (typeof status === 'number' && (status < 200 || status >= 300)) {
    return 'status_code';
  }

  // 9. UNKNOWN only when there is genuinely nothing to classify from. If an HTTP
  //    status OR a response body exists, it is a real (if unusual) status-level
  //    failure — never the ambiguous "other / unclassified" bucket.
  if (typeof status === 'number' || body.trim().length > 0) {
    return 'status_code';
  }

  return 'other';
}

/**
 * Banner field resolution — guarantees the in-app watchdog banner NEVER shows a
 * bare "—" for a field that should carry a truthful value. The owner spec:
 * "Never show — unless field is truly not applicable" and "If unknown, show
 * UNKNOWN_WITH_REASON". These pure resolvers convert every displayed field into
 * one of: a real value, an explicit `n/a (… reason)` when the field is genuinely
 * not applicable for the failure cause (e.g. a timeout has no HTTP status), or
 * `UNKNOWN_WITH_REASON (…)`.
 */
export interface WatchdogRecoveryFieldSource {
  recoveredViaFallback: boolean;
  degradedRoute: string | null;
  recoveredRoute: string | null;
  statusCode: number | null;
  classification: string | null;
  reason: string | null;
}

/** Richer report shape the banner resolvers read (superset of the analyzer subset). */
export interface BannerReportInput extends AnalyzableWatchdogReport {
  fileLine?: string | null;
  fixHint?: string | null;
  lastSuccessfulCheckpoint?: string | null;
  recovery?: WatchdogRecoveryFieldSource | null;
}

const UNKNOWN_RECOVERED = 'UNKNOWN_WITH_REASON (recovered — privileged route degraded)';

function nonBlank(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/** An honest "not applicable" string for a missing HTTP status/body, by cause. */
function naForCause(cause: BackendPostFailureCause): string {
  switch (cause) {
    case 'timeout':
      return 'n/a (timeout — no HTTP response received)';
    case 'network_error':
      return 'n/a (network failure — request never reached the server)';
    case 'parse_error':
      return 'n/a (invalid/empty response body)';
    default:
      return 'UNKNOWN_WITH_REASON (no HTTP status recorded)';
  }
}

function deriveFixHint(cause: BackendPostFailureCause): string {
  switch (cause) {
    case 'owner_ai_route_failure':
      return 'Re-authenticate the owner session (IVX → Auth Diagnostics).';
    case 'timeout':
      return 'Backend slow / cold start — retry; the reliability wrapper will re-attempt.';
    case 'network_error':
      return 'Check connectivity; the request never reached the server.';
    case 'parse_error':
      return 'Backend returned an invalid/empty body — inspect the provider output.';
    case 'backend_exception':
      return 'Backend 5xx — check the service logs / health.';
    case 'route_missing':
      return 'Route not registered — verify the deployed commit exposes it.';
    default:
      return 'Inspect the failing checkpoint owner file:line.';
  }
}

function splitCheckpointOwner(fileLine: string | null): { filePath: string; functionName: string } {
  if (!fileLine) {
    return { filePath: 'expo/app/ivx/chat.tsx', functionName: 'assistantReplyMutation' };
  }
  const colon = fileLine.indexOf(':');
  if (colon === -1) {
    return { filePath: fileLine, functionName: 'n/a (no function recorded)' };
  }
  return {
    filePath: nonBlank(fileLine.slice(0, colon)) ?? fileLine,
    functionName: nonBlank(fileLine.slice(colon + 1)) ?? 'n/a (no function recorded)',
  };
}

export type DegradedRecoveryFields = {
  recoveredViaFallback: string;
  degradedRoute: string;
  recoveredRoute: string;
  statusCode: string;
  classification: string;
  reason: string;
  lastSuccessful: string;
};

/**
 * Resolve the DEGRADED_RECOVERY (yellow) banner fields. Every field returns a
 * real value or `UNKNOWN_WITH_REASON (…)` — never a bare "—".
 */
export function resolveDegradedRecoveryFields(report: BannerReportInput): DegradedRecoveryFields {
  const recovery = report.recovery ?? null;
  const statusValue = recovery?.statusCode ?? report.statusCode ?? null;
  return {
    recoveredViaFallback: String(recovery?.recoveredViaFallback ?? true),
    degradedRoute: nonBlank(recovery?.degradedRoute) ?? '/api/ivx/owner-ai',
    recoveredRoute: nonBlank(recovery?.recoveredRoute) ?? '/public/chat',
    statusCode: statusValue !== null && statusValue !== undefined ? String(statusValue) : UNKNOWN_RECOVERED,
    classification: nonBlank(recovery?.classification) ?? UNKNOWN_RECOVERED,
    reason: nonBlank(recovery?.reason) ?? nonBlank(report.failureReason) ?? UNKNOWN_RECOVERED,
    lastSuccessful: nonBlank(report.lastSuccessfulCheckpoint) ?? 'BACKEND_POST_STARTED',
  };
}

export type FailureBannerFields = {
  checkpoint: string;
  filePath: string;
  functionName: string;
  reason: string;
  nextFix: string;
  statusCode: string;
  backendResponse: string;
  lastSuccessful: string;
};

/**
 * Resolve the red/failure banner fields. A genuinely-not-applicable HTTP field
 * (timeout/network/parse have no status or body) returns an explicit
 * `n/a (… reason)`; everything else returns a real value or `UNKNOWN_WITH_REASON`.
 * No field is ever a bare "—".
 */
export function resolveFailureBannerFields(report: BannerReportInput): FailureBannerFields {
  const cause = classifyBackendPostFailureReason({
    statusCode: report.statusCode,
    reason: report.failureReason,
    backendResponse: report.backendResponse,
  });
  const owner = splitCheckpointOwner(report.fileLine ?? null);
  return {
    checkpoint: nonBlank(report.failedCheckpoint) ?? 'BACKEND_POST_FINISHED',
    filePath: owner.filePath,
    functionName: owner.functionName,
    reason: nonBlank(report.failureReason) ?? `UNKNOWN_WITH_REASON (no failure reason recorded for ${cause})`,
    nextFix: nonBlank(report.fixHint) ?? deriveFixHint(cause),
    statusCode: report.statusCode !== null && report.statusCode !== undefined ? String(report.statusCode) : naForCause(cause),
    backendResponse: nonBlank(report.backendResponse) ?? naForCause(cause),
    lastSuccessful: nonBlank(report.lastSuccessfulCheckpoint) ?? 'SEND_TAP',
  };
}

/** Returns true when a report represents a BACKEND_POST_FINISHED failure. */
export function isBackendPostFailure(report: AnalyzableWatchdogReport): boolean {
  return report.failedCheckpoint === BACKEND_POST_CHECKPOINT && report.finalStatus !== 'SUCCESS';
}

/** Classify a single watchdog report (assumes it is a BACKEND_POST failure). */
export function classifyBackendPostFailure(report: AnalyzableWatchdogReport): ClassifiedBackendPostFailure {
  const cause = classifyBackendPostFailureReason({
    statusCode: report.statusCode,
    reason: report.failureReason,
    backendResponse: report.backendResponse,
  });
  return {
    traceId: report.traceId,
    cause,
    statusCode: report.statusCode,
    reason: report.failureReason ?? '(no reason recorded)',
    at: report.endedAt ?? report.startedAt,
    requestId: report.requestId ?? null,
  };
}

function safeTime(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Trace + group + rank every BACKEND_POST_FINISHED failure in the supplied
 * reports. Returns the full grouping plus the top-5 causes by frequency.
 */
export function analyzeBackendPostFailures(
  reports: AnalyzableWatchdogReport[],
  now: () => string = () => new Date().toISOString(),
): BackendPostFailureAnalysis {
  const failures = reports.filter(isBackendPostFailure).map(classifyBackendPostFailure);

  const byCause = new Map<BackendPostFailureCause, ClassifiedBackendPostFailure[]>();
  for (const failure of failures) {
    const bucket = byCause.get(failure.cause) ?? [];
    bucket.push(failure);
    byCause.set(failure.cause, bucket);
  }

  const groups: BackendPostFailureCauseGroup[] = Array.from(byCause.entries()).map(([cause, items]) => {
    const sorted = items.slice().sort((a, b) => safeTime(b.at) - safeTime(a.at));
    const statusCodes = Array.from(
      new Set(sorted.map((f) => f.statusCode).filter((s): s is number => typeof s === 'number')),
    ).sort((a, b) => a - b);
    const requestIds = Array.from(
      new Set(sorted.map((f) => f.requestId).filter((r): r is string => typeof r === 'string' && r.length > 0)),
    );
    const times = sorted.map((f) => f.at).filter((t) => t.length > 0).sort((a, b) => safeTime(a) - safeTime(b));
    return {
      cause,
      count: sorted.length,
      statusCodes,
      traceIds: sorted.map((f) => f.traceId),
      requestIds,
      firstAt: times[0] ?? '',
      lastAt: times[times.length - 1] ?? '',
      sampleReason: sorted[0]?.reason ?? '',
    };
  });

  // Rank by frequency desc, then most-recent failure first as a tiebreaker.
  groups.sort((a, b) => (b.count - a.count) || (safeTime(b.lastAt) - safeTime(a.lastAt)));

  return {
    totalReports: reports.length,
    totalFailures: failures.length,
    groups,
    top5: groups.slice(0, 5),
    generatedAt: now(),
  };
}
