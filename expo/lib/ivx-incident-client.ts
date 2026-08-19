/**
 * IVX Incident Client — frontend runtime failure capture.
 *
 * Installs a global JS error handler, an unhandled-rejection handler, and
 * a `fetch` wrapper that records non-2xx responses and network errors to
 * the backend incident ingest at POST /api/ivx/incidents.
 *
 * No secrets, no tokens, no message bodies are sent — bodies are previewed
 * and sanitized on the backend before storage.
 */

import { Platform } from 'react-native';

type IngestSource = 'frontend' | 'auth' | 'timeout' | 'provider' | 'render' | 'silent_failure';

type IngestPayload = {
  traceId?: string | null;
  userId?: string | null;
  conversationId?: string | null;
  source?: IngestSource;
  checkpoint?: string | null;
  fileLine?: string | null;
  message: string;
  stack?: string | null;
  requestBodyPreview?: string | null;
  responseStatus?: number | null;
  buildId?: string | null;
  severity?: 'info' | 'warning' | 'error' | 'critical';
};

const RECENT_DEDUPE: Map<string, number> = new Map();
const DEDUPE_WINDOW_MS = 10_000;
const SEND_TIMEOUT_MS = 4_000;
let installed = false;
let baseUrl: string | null = null;
let installedTraceId: string | null = null;

function resolveBaseUrl(): string | null {
  if (baseUrl) return baseUrl;
  const candidates = [
    process.env.EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL,
    process.env.EXPO_PUBLIC_IVX_API_BASE_URL,
    process.env.EXPO_PUBLIC_API_BASE_URL,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      baseUrl = candidate.trim().replace(/\/+$/, '');
      return baseUrl;
    }
  }
  return null;
}

function shouldDrop(key: string): boolean {
  const now = Date.now();
  for (const [k, t] of RECENT_DEDUPE) {
    if (now - t > DEDUPE_WINDOW_MS) RECENT_DEDUPE.delete(k);
  }
  const last = RECENT_DEDUPE.get(key);
  if (last && now - last < DEDUPE_WINDOW_MS) return true;
  RECENT_DEDUPE.set(key, now);
  return false;
}

type RepairJobStageLabel =
  | 'issue_detected'
  | 'repair_started'
  | 'patch_applied'
  | 'validation_passed'
  | 'rollback_required'
  | 'awaiting_approval'
  | 'completed';

type RepairJobBubble = {
  jobId: string;
  incidentId: string;
  message: string;
  stageLabel?: RepairJobStageLabel;
};
const REPAIR_JOB_LISTENERS = new Set<(bubble: RepairJobBubble) => void>();

/** Subscribe to repair-job bubbles (issue detected → repair started → patch applied → validation passed). */
export function subscribeIVXRepairJobBubble(listener: (bubble: RepairJobBubble) => void): () => void {
  REPAIR_JOB_LISTENERS.add(listener);
  return () => REPAIR_JOB_LISTENERS.delete(listener);
}

function emitRepairBubble(bubble: RepairJobBubble): void {
  for (const l of REPAIR_JOB_LISTENERS) {
    try { l(bubble); } catch { /* ignore */ }
  }
}

function stageToBubble(stage: string | null | undefined): { label: RepairJobStageLabel; message: string } | null {
  switch (stage) {
    case 'queued':
    case 'diagnosing':
      return { label: 'repair_started', message: 'Issue detected → repair started…' };
    case 'auto_applied':
      return { label: 'patch_applied', message: 'Issue detected → repair started → patch applied…' };
    case 'completed':
      return { label: 'validation_passed', message: 'Issue detected → repair started → patch applied → validation passed.' };
    case 'rollback_required':
      return { label: 'rollback_required', message: 'Issue detected → repair started → validation failed → rollback required.' };
    case 'awaiting_approval':
      return { label: 'awaiting_approval', message: 'Issue detected → repair prepared → awaiting owner approval.' };
    default:
      return null;
  }
}

async function pollRepairJobProgress(url: string, jobId: string, incidentId: string): Promise<void> {
  const seen = new Set<string>();
  for (let attempt = 0; attempt < 12; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 1500 : 3500));
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
      const res = await reporterFetch(`${url}/api/ivx/repair-jobs/${jobId}`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const data = (await res.json().catch(() => null)) as { ok?: boolean; job?: { stage?: string } } | null;
      const stage = data?.job?.stage;
      const mapped = stageToBubble(stage ?? null);
      if (mapped && !seen.has(mapped.label)) {
        seen.add(mapped.label);
        emitRepairBubble({ jobId, incidentId, message: mapped.message, stageLabel: mapped.label });
      }
      if (stage === 'completed' || stage === 'rollback_required' || stage === 'awaiting_approval' || stage === 'failed') {
        return;
      }
    } catch {
      // best-effort
    }
  }
}

async function startRepairJob(url: string, incidentId: string): Promise<void> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    const res = await reporterFetch(`${url}/api/ivx/repair-jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ incidentId }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return;
    const data = (await res.json().catch(() => null)) as { ok?: boolean; job?: { id?: string }; bubble?: string } | null;
    const jobId = data?.job?.id;
    if (data?.ok && typeof jobId === 'string') {
      emitRepairBubble({
        jobId,
        incidentId,
        message: data.bubble ?? 'Issue detected → repair started…',
        stageLabel: 'repair_started',
      });
      void pollRepairJobProgress(url, jobId, incidentId);
    }
  } catch {
    // best-effort
  }
}

/**
 * The reporter must NEVER use the instrumented global fetch.
 *
 * installFetchWrapper() replaces globalThis.fetch and reports any 401/403/5xx
 * response as an incident. The reporter itself posts over fetch, so using the
 * global one makes it observe its own traffic: a failing incidents endpoint
 * reports its own failure, which posts again, and so on. Holding the original
 * unwrapped fetch keeps reporting strictly one-way.
 */
let uninstrumentedFetch: typeof globalThis.fetch | null = null;

function reporterFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const impl = uninstrumentedFetch ?? globalThis.fetch;
  return impl(input as RequestInfo, init);
}

/** Reporter endpoints are never themselves instrumented. */
function isReporterUrl(url: string): boolean {
  return url.includes('/api/ivx/incidents') || url.includes('/api/ivx/repair-jobs');
}

async function postIncident(payload: IngestPayload): Promise<void> {
  const url = resolveBaseUrl();
  if (!url) return;
  const dedupeKey = `${payload.source ?? 'frontend'}:${payload.message}:${payload.responseStatus ?? ''}`;
  if (shouldDrop(dedupeKey)) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await reporterFetch(`${url}/api/ivx/incidents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        traceId: payload.traceId ?? installedTraceId,
        buildId: payload.buildId ?? 'ivx-holdings',
      }),
      signal: controller.signal,
    });
    // For silent failures, immediately enqueue an async repair job and emit
    // a "Repair job started" bubble so chat surfaces can render it.
    if (payload.source === 'silent_failure' && res.ok) {
      const data = (await res.json().catch(() => null)) as { ok?: boolean; incident?: { id?: string } } | null;
      const incidentId = data?.incident?.id;
      if (data?.ok && typeof incidentId === 'string') {
        void startRepairJob(url, incidentId);
      }
    }
  } catch {
    // never throw from the reporter
  } finally {
    clearTimeout(timeout);
  }
}

function previewBody(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  try {
    if (typeof input === 'string') return input.slice(0, 1024);
    if (typeof input === 'object') return JSON.stringify(input).slice(0, 1024);
    return String(input).slice(0, 1024);
  } catch {
    return null;
  }
}

function installFetchWrapper(): void {
  if (typeof globalThis.fetch !== 'function') return;
  const original = globalThis.fetch.bind(globalThis);
  uninstrumentedFetch = original;
  const ivxIncidentFetch = async function ivxIncidentFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    // Never observe the reporter's own traffic.
    if (isReporterUrl(url)) {
      return original(input as RequestInfo, init);
    }
    try {
      const response = await original(input as RequestInfo, init);
      if (!response.ok && response.status >= 500) {
        void postIncident({
          source: 'frontend',
          severity: 'error',
          message: `Fetch ${method} ${url} failed with status ${response.status}`,
          responseStatus: response.status,
          requestBodyPreview: previewBody(init?.body ?? null),
          checkpoint: 'fetch.response.non-2xx',
        });
      } else if (response.status === 401 || response.status === 403) {
        void postIncident({
          source: 'auth',
          severity: 'warning',
          message: `Auth rejected ${method} ${url}: ${response.status}`,
          responseStatus: response.status,
          checkpoint: 'fetch.response.auth',
        });
      }
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isAbort = error instanceof Error && error.name === 'AbortError';
      void postIncident({
        source: isAbort ? 'timeout' : 'frontend',
        severity: 'error',
        message: `Fetch ${method} ${url} threw: ${message}`,
        stack: error instanceof Error ? error.stack ?? null : null,
        requestBodyPreview: previewBody(init?.body ?? null),
        checkpoint: isAbort ? 'fetch.aborted' : 'fetch.threw',
      });
      throw error;
    }
  };
  // Cast through `unknown` so this works regardless of whether the active
  // lib types model `fetch.preconnect`; the wrapper preserves runtime behavior.
  globalThis.fetch = ivxIncidentFetch as unknown as typeof globalThis.fetch;
}

function installGlobalErrorHandler(): void {
  const errorUtils = (globalThis as unknown as { ErrorUtils?: { setGlobalHandler?: (cb: (error: Error, isFatal?: boolean) => void) => void; getGlobalHandler?: () => (error: Error, isFatal?: boolean) => void } }).ErrorUtils;
  if (errorUtils?.setGlobalHandler) {
    const prev = errorUtils.getGlobalHandler?.();
    errorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
      void postIncident({
        source: 'frontend',
        severity: isFatal ? 'critical' : 'error',
        message: error?.message ?? 'unknown frontend error',
        stack: error?.stack ?? null,
        checkpoint: 'ErrorUtils.globalHandler',
      });
      if (prev) prev(error, isFatal);
    });
  }
  if (typeof globalThis.addEventListener === 'function') {
    try {
      globalThis.addEventListener('unhandledrejection', (event: Event) => {
        const ev = event as unknown as { reason?: unknown };
        const reason = ev.reason;
        const message = reason instanceof Error ? reason.message : (typeof reason === 'string' ? reason : 'unhandled promise rejection');
        const stack = reason instanceof Error ? reason.stack ?? null : null;
        void postIncident({
          source: 'frontend',
          severity: 'error',
          message,
          stack,
          checkpoint: 'window.unhandledrejection',
        });
      });
    } catch {
      // ignore environments without addEventListener
    }
  }
}

/**
 * Installs error capture once. Safe to call multiple times.
 */
export function installIVXIncidentCapture(traceId?: string | null): void {
  if (installed) return;
  installed = true;
  installedTraceId = traceId ?? null;
  try {
    installFetchWrapper();
    installGlobalErrorHandler();
    console.log('[IVXIncidentClient] installed', { platform: Platform.OS, baseUrl: resolveBaseUrl() });
  } catch (error) {
    console.log('[IVXIncidentClient] install failed', { message: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Manually report an incident from app code (e.g. catch blocks).
 */
export function reportIVXIncident(payload: IngestPayload): void {
  void postIncident(payload);
}

/**
 * Report a watchdog-detected silent failure (request started but downstream
 * checkpoint never reached). Auto-ingested with source=`silent_failure` so the
 * backend repair brain auto-diagnoses without owner action.
 */
export function reportIVXSilentFailure(input: {
  traceId?: string | null;
  conversationId?: string | null;
  failedCheckpoint: string | null;
  lastSuccessfulCheckpoint: string | null;
  fileLine: string | null;
  failureReason: string | null;
  userText: string | null;
}): void {
  const message = `SILENT_FAILURE at ${input.failedCheckpoint ?? 'unknown'} (last passed: ${input.lastSuccessfulCheckpoint ?? 'none'})`;
  void postIncident({
    source: 'silent_failure',
    severity: 'error',
    traceId: input.traceId ?? null,
    conversationId: input.conversationId ?? null,
    checkpoint: input.failedCheckpoint,
    fileLine: input.fileLine,
    message,
    stack: input.failureReason,
    requestBodyPreview: input.userText ? input.userText.slice(0, 200) : null,
  });
}

/**
 * Subscribes to the watchdog and auto-reports any SILENT_FAILURE or BLOCKED
 * report as an incident. Safe to call multiple times (no-op after first).
 */
let watchdogBridgeInstalled = false;
const REPORTED_TRACE_IDS = new Set<string>();
export function installIVXWatchdogIncidentBridge(
  subscribe: (listener: (snapshot: { finalized: { traceId: string; conversationId: string | null; userText: string; finalStatus: string; failedCheckpoint: string | null; lastSuccessfulCheckpoint: string | null; fileLine: string | null; failureReason: string | null }[] }) => void) => () => void,
): () => void {
  if (watchdogBridgeInstalled) return () => {};
  watchdogBridgeInstalled = true;
  return subscribe((snapshot) => {
    const latest = snapshot.finalized?.[0];
    if (!latest) return;
    if (REPORTED_TRACE_IDS.has(latest.traceId)) return;
    if (latest.finalStatus !== 'SILENT_FAILURE' && latest.finalStatus !== 'BLOCKED') return;
    REPORTED_TRACE_IDS.add(latest.traceId);
    if (REPORTED_TRACE_IDS.size > 200) {
      const first = REPORTED_TRACE_IDS.values().next().value;
      if (first) REPORTED_TRACE_IDS.delete(first);
    }
    reportIVXSilentFailure({
      traceId: latest.traceId,
      conversationId: latest.conversationId,
      failedCheckpoint: latest.failedCheckpoint,
      lastSuccessfulCheckpoint: latest.lastSuccessfulCheckpoint,
      fileLine: latest.fileLine,
      failureReason: latest.failureReason,
      userText: latest.userText,
    });
  });
}
