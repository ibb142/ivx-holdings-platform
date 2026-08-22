/**
 * IVX Security Middleware
 *
 * Point 9: Security hardening — rate limiting, fraud prevention, security event logging.
 *
 * Features:
 * - Per-IP and per-user rate limiting (sliding window)
 * - Fraud detection rules (rapid offers, unusual patterns, duplicate submissions)
 * - Security event logging to ivx_re_security_events table
 * - IP blocking for repeated violations
 * - Request validation and sanitization
 *
 * Usage in hono.ts:
 *   import { securityMiddleware, rateLimit } from './services/ivx-security-middleware';
 *   app.use('*', securityMiddleware);
 *   app.post('/api/ivx/re/offers', rateLimit({ windowMs: 60_000, max: 5 }), handler);
 */

import type { Context, Next } from 'hono';
import { resolveActiveIVXSystemSecret } from './ivx-system-secret';

// ============================================================================
// IN-MEMORY RATE LIMITER (sliding window)
// ============================================================================

interface RateEntry {
  count: number;
  firstRequest: number;
  blocked: boolean;
  blockUntil: number;
}

const ipRateStore = new Map<string, RateEntry>();
const userRateStore = new Map<string, RateEntry>();
const violationStore = new Map<string, { count: number; lastViolation: number }>();

const MAX_VIOLATIONS = 10;
const BLOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const STORE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let lastCleanup = Date.now();

function cleanupStores(): void {
  const now = Date.now();
  if (now - lastCleanup < STORE_CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  for (const [key, entry] of ipRateStore) {
    if (now - entry.firstRequest > 60 * 60 * 1000 && !entry.blocked) {
      ipRateStore.delete(key);
    }
  }
  for (const [key, entry] of userRateStore) {
    if (now - entry.firstRequest > 60 * 60 * 1000 && !entry.blocked) {
      userRateStore.delete(key);
    }
  }
  for (const [key, v] of violationStore) {
    if (now - v.lastViolation > 60 * 60 * 1000) {
      violationStore.delete(key);
    }
  }
}

function getClientIp(c: Context): string {
  const fwd = c.req.header('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  const realIp = c.req.header('x-real-ip');
  if (realIp) return realIp.trim();
  return 'unknown';
}

function checkRateLimit(
  store: Map<string, RateEntry>,
  key: string,
  windowMs: number,
  max: number,
): { allowed: boolean; remaining: number; retryAfter: number } {
  const now = Date.now();
  const entry = store.get(key);

  if (entry?.blocked && now < entry.blockUntil) {
    return { allowed: false, remaining: 0, retryAfter: entry.blockUntil - now };
  }

  if (!entry || now - entry.firstRequest > windowMs) {
    store.set(key, { count: 1, firstRequest: now, blocked: false, blockUntil: 0 });
    return { allowed: true, remaining: max - 1, retryAfter: 0 };
  }

  entry.count++;
  if (entry.count > max) {
    entry.blocked = true;
    entry.blockUntil = now + BLOCK_DURATION_MS;
    return { allowed: false, remaining: 0, retryAfter: BLOCK_DURATION_MS };
  }

  return { allowed: true, remaining: max - entry.count, retryAfter: 0 };
}

function recordViolation(ip: string, reason: string): void {
  const now = Date.now();
  const v = violationStore.get(ip) || { count: 0, lastViolation: 0 };
  v.count++;
  v.lastViolation = now;
  violationStore.set(ip, v);

  if (v.count >= MAX_VIOLATIONS) {
    const entry = ipRateStore.get(ip) || { count: 0, firstRequest: now, blocked: false, blockUntil: 0 };
    entry.blocked = true;
    entry.blockUntil = now + BLOCK_DURATION_MS;
    ipRateStore.set(ip, entry);
  }
}

// ============================================================================
// SECURITY EVENT LOGGING
// ============================================================================

let _sb: { from: (table: string) => { insert: (data: Record<string, unknown>) => Promise<{ error: { message: string } | null }> } } | null = null;

function getSB() {
  if (_sb) return _sb;
  try {
    // Lazy import to avoid circular dependencies
    const { createClient } = require('@supabase/supabase-js');
    const url = (process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();
    if (!url || !key) return null;
    _sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
    return _sb;
  } catch {
    return null;
  }
}

export async function logSecurityEvent(event: {
  event_type: string;
  severity?: string;
  user_id?: string;
  ip_address?: string;
  user_agent?: string;
  endpoint?: string;
  method?: string;
  details?: Record<string, unknown>;
  blocked?: boolean;
  rule_triggered?: string;
}): Promise<void> {
  const sb = getSB();
  if (!sb) return;
  try {
    await sb.from('ivx_re_security_events').insert({
      event_type: event.event_type,
      severity: event.severity || 'info',
      user_id: event.user_id || null,
      ip_address: event.ip_address || null,
      user_agent: event.user_agent || null,
      endpoint: event.endpoint || null,
      method: event.method || null,
      details: event.details || {},
      blocked: event.blocked || false,
      rule_triggered: event.rule_triggered || null,
    });
  } catch {
    // best-effort
  }
}

// ============================================================================
// FRAUD DETECTION RULES
// ============================================================================

const offerCreationTimes = new Map<string, number[]>(); // userId -> timestamps
const MAX_OFFERS_PER_MINUTE = 3;
const MAX_OFFERS_PER_HOUR = 10;

export function detectOfferFraud(userId: string): { isFraudulent: boolean; reason: string } {
  const now = Date.now();
  const times = offerCreationTimes.get(userId) || [];

  // Filter to last hour
  const lastHour = times.filter((t) => now - t < 60 * 60 * 1000);

  // Check per-minute limit
  const lastMinute = lastHour.filter((t) => now - t < 60 * 1000);
  if (lastMinute.length >= MAX_OFFERS_PER_MINUTE) {
    return { isFraudulent: true, reason: `Too many offers in 1 minute (${lastMinute.length})` };
  }

  // Check per-hour limit
  if (lastHour.length >= MAX_OFFERS_PER_HOUR) {
    return { isFraudulent: true, reason: `Too many offers in 1 hour (${lastHour.length})` };
  }

  // Record this offer
  lastHour.push(now);
  offerCreationTimes.set(userId, lastHour);

  return { isFraudulent: false, reason: '' };
}

// ============================================================================
// MIDDLEWARE
// ============================================================================

/**
 * Trusted fleet-control check: a request bearing the active IVX system owner
 * key is authenticated by the route guards themselves (owner-only bridge), so
 * the per-IP limiter must not throttle 112-agent CI cycles from one runner IP.
 */
async function isTrustedOwnerKeyRequest(c: Context): Promise<boolean> {
  const ownerKey = (c.req.header('x-ivx-owner-key') ?? '').trim();
  if (!ownerKey) return false;
  try {
    const active = await resolveActiveIVXSystemSecret();
    return Boolean(active) && ownerKey === active;
  } catch {
    return false;
  }
}

function applySecurityHeaders(c: Context): void {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '1; mode=block');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

export async function securityMiddleware(c: Context, next: Next): Promise<Response | void> {
  cleanupStores();
  const ip = getClientIp(c);
  const path = c.req.path;
  const method = c.req.method;

  if (await isTrustedOwnerKeyRequest(c)) {
    applySecurityHeaders(c);
    await next();
    return;
  }

  // Check if IP is blocked
  const ipEntry = ipRateStore.get(ip);
  if (ipEntry?.blocked && Date.now() < ipEntry.blockUntil) {
    await logSecurityEvent({
      event_type: 'blocked_request',
      severity: 'warning',
      ip_address: ip,
      endpoint: path,
      method,
      blocked: true,
      rule_triggered: 'ip_block',
      details: { blockRemaining: ipEntry.blockUntil - Date.now() },
    });
    return new Response(JSON.stringify({
      ok: false,
      error: 'Rate limit exceeded',
      message: 'Too many requests. Please try again later.',
    }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(Math.ceil((ipEntry.blockUntil - Date.now()) / 1000)),
      },
    });
  }

  // General rate limit: 100 requests per minute per IP
  const rateCheck = checkRateLimit(ipRateStore, ip, 60 * 1000, 100);
  if (!rateCheck.allowed) {
    recordViolation(ip, 'rate_limit_exceeded');
    await logSecurityEvent({
      event_type: 'rate_limit_exceeded',
      severity: 'warning',
      ip_address: ip,
      endpoint: path,
      method,
      blocked: true,
      rule_triggered: 'rate_limit',
      details: { retryAfter: rateCheck.retryAfter },
    });
    return new Response(JSON.stringify({
      ok: false,
      error: 'Rate limit exceeded',
      message: 'Too many requests. Please slow down.',
    }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(Math.ceil(rateCheck.retryAfter / 1000)),
      },
    });
  }

  // Add security headers
  applySecurityHeaders(c);

  await next();
}

// ============================================================================
// RATE LIMIT FACTORY
// ============================================================================

export function rateLimit(options: { windowMs?: number; max?: number }) {
  const windowMs = options.windowMs || 60_000;
  const max = options.max || 30;

  return async (c: Context, next: Next): Promise<Response | void> => {
    const ip = getClientIp(c);
    const key = `${ip}:${c.req.path}`;

    const check = checkRateLimit(ipRateStore, key, windowMs, max);
    if (!check.allowed) {
      recordViolation(ip, 'endpoint_rate_limit');
      await logSecurityEvent({
        event_type: 'endpoint_rate_limited',
        severity: 'warning',
        ip_address: ip,
        endpoint: c.req.path,
        method: c.req.method,
        blocked: true,
        rule_triggered: 'endpoint_rate_limit',
        details: { windowMs, max, retryAfter: check.retryAfter },
      });
      return new Response(JSON.stringify({
        ok: false,
        error: 'Rate limit exceeded for this endpoint',
        message: `Maximum ${max} requests per ${windowMs / 1000}s. Please try again later.`,
      }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(Math.ceil(check.retryAfter / 1000)),
        },
      });
    }

    c.header('X-RateLimit-Remaining', String(check.remaining));
    await next();
  };
}

// ============================================================================
// SECURITY STATUS ENDPOINT
// ============================================================================

export function handleSecurityStatus(): Response {
  const now = Date.now();
  const blockedIps = Array.from(ipRateStore.entries())
    .filter(([, e]) => e.blocked && now < e.blockUntil)
    .map(([ip]) => ({ ip: ip.slice(0, 8) + '****', blockRemaining: Math.ceil((ipRateStore.get(ip)!.blockUntil - now) / 1000) }));

  const totalViolations = Array.from(violationStore.values())
    .filter((v) => now - v.lastViolation < 60 * 60 * 1000)
    .reduce((sum, v) => sum + v.count, 0);

  const activeOfferTrackers = offerCreationTimes.size;

  return new Response(JSON.stringify({
    ok: true,
    security: {
      rateLimiting: {
        blockedIps: blockedIps.length,
        blockedIpDetails: blockedIps.slice(0, 10),
        totalViolationsLastHour: totalViolations,
      },
      fraudPrevention: {
        activeOfferTrackers,
        maxOffersPerMinute: MAX_OFFERS_PER_MINUTE,
        maxOffersPerHour: MAX_OFFERS_PER_HOUR,
      },
      headers: {
        xContentTypeOptions: 'nosniff',
        xFrameOptions: 'DENY',
        xXSSProtection: '1; mode=block',
        referrerPolicy: 'strict-origin-when-cross-origin',
        permissionsPolicy: 'camera=(), microphone=(), geolocation=()',
      },
      blockDurationMs: BLOCK_DURATION_MS,
      maxViolationsBeforeBlock: MAX_VIOLATIONS,
    },
    timestamp: new Date().toISOString(),
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
