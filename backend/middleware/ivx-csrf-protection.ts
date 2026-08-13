/**
 * IVX CSRF Protection Middleware (item 165)
 *
 * Validates Origin and Referer headers on state-changing requests
 * (POST, PUT, DELETE, PATCH) to prevent Cross-Site Request Forgery.
 *
 * Bearer-token API clients (mobile app, server-to-server) are exempt.
 * Browser form submissions must originate from an allowed origin.
 */

import type { Context, Next } from 'hono';

const ALLOWED_ORIGINS = [
  'https://ivxholding.com',
  'https://www.ivxholding.com',
  'http://localhost:8081',
  'http://localhost:3000',
  'http://localhost:19006',
];

export async function csrfProtectionMiddleware(
  context: Context,
  next: Next,
): Promise<Response | void> {
  // Only check state-changing methods
  if (
    context.req.method === 'GET' ||
    context.req.method === 'HEAD' ||
    context.req.method === 'OPTIONS'
  ) {
    await next();
    return;
  }

  // Allow Bearer token auth (API clients, mobile app)
  const auth = context.req.header('authorization') ?? '';
  if (auth.startsWith('Bearer ')) {
    await next();
    return;
  }

  // Check Origin header for browser form submissions
  const origin = context.req.header('origin') ?? '';
  const referer = context.req.header('referer') ?? '';

  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      console.warn('[IVXCSRF] Blocked: origin not allowed', {
        origin: origin.slice(0, 50),
        path: context.req.path,
      });
      return new Response(
        JSON.stringify({ ok: false, error: 'origin_not_allowed' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (!origin && referer && !ALLOWED_ORIGINS.some((o) => referer.startsWith(o))) {
      console.warn('[IVXCSRF] Blocked: referer not allowed', {
        referer: referer.slice(0, 50),
        path: context.req.path,
      });
      return new Response(
        JSON.stringify({ ok: false, error: 'referer_not_allowed' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }
    // If neither origin nor referer is present, allow (some clients don't send them)
    // but log for monitoring
    if (!origin && !referer) {
      console.warn('[IVXCSRF] No origin/referer on state-changing request', {
        path: context.req.path,
        method: context.req.method,
      });
    }
  }

  await next();
}

export const IVX_CSRF_PROTECTION_MARKER = 'ivx-csrf-protection-2026-08-13';
