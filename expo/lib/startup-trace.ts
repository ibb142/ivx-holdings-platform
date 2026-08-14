/**
 * Startup trace utility for IVX Holdings.
 *
 * Generates a unique trace ID per app launch and records checkpoints with
 * elapsed milliseconds so we can identify exactly where startup stops.
 *
 * The required startup trace must reach APP_INTERACTIVE for a successful launch.
 */

const START_TIME_MS = Date.now();
const TRACE_ID = `${START_TIME_MS.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export type StartupCheckpoint =
  | 'APP_NATIVE_STARTED'
  | 'JS_BUNDLE_STARTED'
  | 'ROOT_COMPONENT_MOUNTED'
  | 'APP_MOUNTED'
  | 'ROOT_LAYOUT_RENDERED'
  | 'ERROR_BOUNDARY_MOUNTED'
  | 'PROVIDERS_STARTED'
  | 'EXTRA_PROVIDERS_LOADED'
  | 'PROVIDERS_COMPLETED'
  | 'PROVIDERS_MOUNTED'
  | 'SPLASH_HIDE_STARTED'
  | 'SPLASH_HIDE_COMPLETED'
  | 'AUTH_INITIALIZATION_STARTED'
  | 'AUTH_INITIALIZATION_COMPLETED'
  | 'AUTH_INITIALIZATION_FAILED'
  | 'AUTH_INIT_STARTED'
  | 'AUTH_INIT_COMPLETED'
  | 'AUTH_INIT_FAILED'
  | 'AUTH_HARD_UNLOCK'
  | 'ROUTER_READY'
  | 'INITIAL_ROUTE_SELECTED'
  | 'INITIAL_ROUTE_RENDERED'
  | 'APP_INTERACTIVE';

const recorded = new Set<StartupCheckpoint>();

function elapsedMs(): number {
  return Date.now() - START_TIME_MS;
}

function prefix(): string {
  return `[IVX-STARTUP ${TRACE_ID} +${elapsedMs()}ms]`;
}

/** Record a startup checkpoint. Duplicate checkpoints are ignored. */
export function logStartup(checkpoint: StartupCheckpoint, detail?: string): void {
  if (recorded.has(checkpoint)) {
    return;
  }
  recorded.add(checkpoint);
  const msg = detail ? `${checkpoint} | ${detail}` : checkpoint;
  console.log(prefix(), msg);
}

/** Record a startup error checkpoint with sanitized detail. */
export function logStartupError(checkpoint: StartupCheckpoint, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error ?? 'unknown');
  // Redact any token-looking strings before logging.
  const sanitized = detail
    .replace(/eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g, '[REDACTED_JWT]')
    .replace(/[0-9a-f]{32,}/g, '[REDACTED_HEX]')
    .slice(0, 200);
  console.warn(prefix(), `${checkpoint} | ${sanitized}`);
}

/** Get the current trace ID and elapsed time for diagnostics. */
export function getStartupTraceInfo(): { traceId: string; elapsedMs: number; checkpoints: StartupCheckpoint[] } {
  return { traceId: TRACE_ID, elapsedMs: elapsedMs(), checkpoints: Array.from(recorded) };
}

/** True if all required checkpoints have been recorded. */
export function isStartupComplete(): boolean {
  return recorded.has('APP_INTERACTIVE');
}

/** Get the trace ID for inclusion in error reports. */
export function getStartupTraceId(): string {
  return TRACE_ID;
}
