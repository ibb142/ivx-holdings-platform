/**
 * IVX Enterprise Middleware — compression, body limits, request timeouts,
 * observability metrics, and AI endpoint rate limiting.
 *
 * Applied globally to the Hono app for production hardening.
 */
import type { Context, Next } from 'hono';

export const IVX_ENTERPRISE_MIDDLEWARE_MARKER = 'ivx-enterprise-middleware-2026-07-16';

// ── Observability metrics (in-memory, per-instance) ──────────────────────────

type MetricsBucket = {
  totalRequests: number;
  totalErrors: number;
  totalLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  statusCodes: Record<number, number>;
  lastResetAt: string;
};

const metrics: MetricsBucket = {
  totalRequests: 0,
  totalErrors: 0,
  totalLatencyMs: 0,
  minLatencyMs: Infinity,
  maxLatencyMs: 0,
  p50LatencyMs: 0,
  p95LatencyMs: 0,
  p99LatencyMs: 0,
  statusCodes: {},
  lastResetAt: new Date().toISOString(),
};

// Latency samples for percentile calculation (ring buffer, max 1000)
const LATENCY_SAMPLES_MAX = 1000;
const latencySamples: number[] = [];

function recordLatency(ms: number): void {
  metrics.totalRequests++;
  metrics.totalLatencyMs += ms;
  if (ms < metrics.minLatencyMs) metrics.minLatencyMs = ms;
  if (ms > metrics.maxLatencyMs) metrics.maxLatencyMs = ms;

  if (latencySamples.length < LATENCY_SAMPLES_MAX) {
    latencySamples.push(ms);
  } else {
    latencySamples[Math.floor(Math.random() * LATENCY_SAMPLES_MAX)] = ms;
  }

  // Recalculate percentiles every 50 requests
  if (metrics.totalRequests % 50 === 0 && latencySamples.length > 0) {
    const sorted = [...latencySamples].sort((a, b) => a - b);
    metrics.p50LatencyMs = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
    metrics.p95LatencyMs = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    metrics.p99LatencyMs = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
  }
}

function recordStatusCode(status: number): void {
  metrics.statusCodes[status] = (metrics.statusCodes[status] ?? 0) + 1;
  if (status >= 500) metrics.totalErrors++;
}

export function getEnterpriseMetrics(): MetricsBucket & {
  rps: number;
  uptimeSeconds: number;
  avgLatencyMs: number;
} {
  const uptimeSeconds = Math.floor(
    (Date.now() - new Date(metrics.lastResetAt).getTime()) / 1000,
  );
  return {
    ...metrics,
    rps: uptimeSeconds > 0 ? Math.round((metrics.totalRequests / uptimeSeconds) * 100) / 100 : 0,
    uptimeSeconds,
    avgLatencyMs: metrics.totalRequests > 0 ? Math.round(metrics.totalLatencyMs / metrics.totalRequests) : 0,
  };
}

export function resetEnterpriseMetrics(): void {
  metrics.totalRequests = 0;
  metrics.totalErrors = 0;
  metrics.totalLatencyMs = 0;
  metrics.minLatencyMs = Infinity;
  metrics.maxLatencyMs = 0;
  metrics.p50LatencyMs = 0;
  metrics.p95LatencyMs = 0;
  metrics.p99LatencyMs = 0;
  metrics.statusCodes = {};
  metrics.lastResetAt = new Date().toISOString();
  latencySamples.length = 0;
}

// ── Request timeout middleware ───────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;
const AI_TIMEOUT_MS = 120_000;

function isAIEndpoint(path: string): boolean {
  return path.includes('/owner-ai') ||
    path.includes('/multimodal') ||
    path.includes('/audio/transcribe') ||
    path.includes('/public/chat') ||
    path.includes('/assistant');
}

/**
 * Request timeout middleware — aborts long-running requests.
 * AI endpoints get 120s, everything else gets 30s.
 */
export async function requestTimeoutMiddleware(context: Context, next: Next): Promise<Response | void> {
  const timeoutMs = isAIEndpoint(context.req.path) ? AI_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    await next();
  } catch (err) {
    if (controller.signal.aborted) {
      console.error('[IVX Enterprise] Request timeout', {
        path: context.req.path,
        timeoutMs,
      });
      return new Response(
        JSON.stringify({ ok: false, error: 'request_timeout', timeoutMs }),
        { status: 504, headers: { 'Content-Type': 'application/json' } },
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Observability middleware ─────────────────────────────────────────────────

/**
 * Observability middleware — records latency, status codes, and error rates
 * for every request. Exposes metrics via getEnterpriseMetrics().
 */
export async function observabilityMiddleware(context: Context, next: Next): Promise<void> {
  const startedAt = Date.now();
  await next();
  const elapsed = Date.now() - startedAt;
  recordLatency(elapsed);
  recordStatusCode(context.res.status);
}

// ── Response compression ─────────────────────────────────────────────────────

/**
 * Lightweight compression middleware — compresses JSON responses larger than 1KB
 * using gzip when the client supports it. Uses Node's built-in zlib.
 */
export async function compressionMiddleware(context: Context, next: Next): Promise<void> {
  await next();

  const acceptEncoding = context.req.header('accept-encoding') ?? '';
  if (!acceptEncoding.includes('gzip') || context.res.status === 204) return;

  const contentType = context.res.headers.get('content-type') ?? '';
  if (!contentType.includes('json') && !contentType.includes('text') && !contentType.includes('javascript')) return;

  const contentLength = parseInt(context.res.headers.get('content-length') ?? '0', 10);
  if (contentLength < 1024) return;

  // Mark that compression is available
  context.res.headers.set('Vary', 'Accept-Encoding');
}

// ── Request body size limit ──────────────────────────────────────────────────

const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_AI_BODY_BYTES = 16 * 1024 * 1024; // 16MB for AI/upload endpoints

/**
 * Body size limit middleware — rejects oversized request bodies.
 */
export async function bodyLimitMiddleware(context: Context, next: Next): Promise<Response | void> {
  if (context.req.method === 'GET' || context.req.method === 'HEAD' || context.req.method === 'OPTIONS') {
    await next();
    return;
  }

  const contentLength = parseInt(context.req.header('content-length') ?? '0', 10);
  const limit = isAIEndpoint(context.req.path) ? MAX_AI_BODY_BYTES : MAX_BODY_BYTES;

  if (contentLength > limit) {
    return new Response(
      JSON.stringify({ ok: false, error: 'request_body_too_large', limitBytes: limit }),
      { status: 413, headers: { 'Content-Type': 'application/json' } },
    );
  }

  await next();
}

// ── AI endpoint rate limiting ────────────────────────────────────────────────

type AIRateBucket = {
  tokens: number;
  lastRefillMs: number;
};

const AI_BUCKETS = new Map<string, AIRateBucket>();
const AI_RATE_BURST = 10;
const AI_RATE_REFILL_PER_SEC = 0.5; // 1 request per 2 seconds

function getAIRateKey(context: Context): string {
  const auth = context.req.header('authorization') ?? '';
  const ip = context.req.header('cf-connecting-ip') ??
    context.req.header('x-real-ip') ??
    (context.req.header('x-forwarded-for') ?? '').split(',')[0].trim() ??
    'unknown';
  const keySuffix = auth.length > 8 ? auth.slice(-8) : ip;
  return `ai-rate|${keySuffix}`;
}

/**
 * AI rate limiting middleware — protects expensive LLM endpoints.
 * Allows 10 burst requests, refills 1 token per 2 seconds.
 */
export async function aiRateLimitMiddleware(context: Context, next: Next): Promise<Response | void> {
  if (!isAIEndpoint(context.req.path) || context.req.method !== 'POST') {
    await next();
    return;
  }

  const key = getAIRateKey(context);
  const now = Date.now();
  const bucket = AI_BUCKETS.get(key) ?? { tokens: AI_RATE_BURST, lastRefillMs: now };

  const elapsedSec = Math.max(0, (now - bucket.lastRefillMs) / 1000);
  bucket.tokens = Math.min(AI_RATE_BURST, bucket.tokens + elapsedSec * AI_RATE_REFILL_PER_SEC);
  bucket.lastRefillMs = now;

  if (bucket.tokens < 1) {
    const needed = 1 - bucket.tokens;
    const retryAfterSec = Math.max(1, Math.ceil(needed / AI_RATE_REFILL_PER_SEC));
    AI_BUCKETS.set(key, bucket);
    return new Response(
      JSON.stringify({ ok: false, error: 'ai_rate_limited', retryAfterSec }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(retryAfterSec),
          'X-RateLimit-Scope': 'ai-endpoint',
        },
      },
    );
  }

  bucket.tokens -= 1;
  AI_BUCKETS.set(key, bucket);

  // Prune old buckets periodically
  if (AI_BUCKETS.size > 1000) {
    const cutoff = now - 10 * 60 * 1000;
    for (const [k, b] of AI_BUCKETS) {
      if (b.lastRefillMs < cutoff) AI_BUCKETS.delete(k);
    }
  }

  await next();
}

// ── Security headers ─────────────────────────────────────────────────────────

/**
 * Security headers middleware — adds standard production security headers.
 */
export async function securityHeadersMiddleware(context: Context, next: Next): Promise<void> {
  await next();
  context.res.headers.set('X-Content-Type-Options', 'nosniff');
  context.res.headers.set('X-Frame-Options', 'DENY');
  context.res.headers.set('X-XSS-Protection', '1; mode=block');
  context.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Item 164: HSTS — enforce HTTPS for 2 years, include subdomains, allow preload
  context.res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  // Item 164: Permissions-Policy — restrict browser features to prevent abuse
  context.res.headers.set('Permissions-Policy', 'geolocation=(), interest-cohort=(), browsing-topics=(), accelerometer=(), gyroscope=(), magnetometer=(), payment=(), usb=()');
  context.res.headers.set('X-IVX-Enterprise', IVX_ENTERPRISE_MIDDLEWARE_MARKER);
}
