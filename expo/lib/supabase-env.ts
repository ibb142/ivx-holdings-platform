/**
 * Supabase env sanitizer for the auth/sign-in path.
 * Supports modern sb_publishable_ keys and legacy anon JWT keys.
 *
 * IMPORTANT FOR MOBILE OWNER SIGN-IN:
 * The current login preflight validates a JWT-shaped anon key before sending
 * credentials. Supabase still reports the production legacy anon key as active,
 * so this resolver intentionally returns that active JWT to the mobile client
 * until the login preflight is migrated to accept sb_publishable_ directly.
 * Backend owner authorization may use either key format.
 */

export const PRODUCTION_SUPABASE_URL = 'https://kvclcdjmjghndxsngfzb.supabase.co';
export const PRODUCTION_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2Y2xjZGptamdobmR4c25nZnpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxOTQwMjcsImV4cCI6MjA4ODc3MDAyN30.OLDwa21VHQNs151AD-8k--_HigQ2d-N7yJfFn5UeNPk';
export const PRODUCTION_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_HD3Xvq5bCQNJLFk1ROH9mQ_Wdb9xdDZ';

const PRODUCTION_SUPABASE_PROJECT_REF = 'kvclcdjmjghndxsngfzb';
const HOSTED_SUPABASE_URL_PATTERN = /https:\/\/[a-z0-9-]+\.supabase\.co\b/i;
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const PUBLISHABLE_KEY_PATTERN = /sb_publishable_[A-Za-z0-9_-]+/g;

declare const __DEV__: boolean | undefined;

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payloadSegment = token.split('.')[1] ?? '';
    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const decoded: string = typeof atob === 'function'
      ? atob(padded)
      : Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractSupabaseProjectRef(url: string): string | null {
  const match = url.match(/https:\/\/([a-z0-9-]+)\.supabase\.co\b/i);
  return match?.[1] ?? null;
}

function extractSupabaseJwtRef(token: string): string | null {
  const payload = decodeJwtPayload(token);
  return typeof payload?.ref === 'string' ? payload.ref : null;
}

export function extractSupabaseUrl(raw: string | undefined | null): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  const hosted = value.match(HOSTED_SUPABASE_URL_PATTERN);
  if (hosted?.[0]) return hosted[0].replace(/\/$/, '');
  if (!/\s/.test(value)) {
    try {
      const parsed = new URL(value);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return value.replace(/\/$/, '');
    } catch {}
  }
  return null;
}

/** Extract either a modern publishable key or a legacy anon JWT. */
export function extractSupabaseAnonKey(raw: string | undefined | null): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;

  const publishable = value.match(PUBLISHABLE_KEY_PATTERN)?.[0];
  if (publishable) return publishable;

  const matches = value.match(JWT_PATTERN) ?? [];
  for (const candidate of matches) {
    const payload = decodeJwtPayload(candidate);
    if (payload && payload.role === 'anon') return candidate;
  }
  return matches[0] ?? null;
}

export function resolveSupabaseUrl(): string {
  const envUrl = extractSupabaseUrl(process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL);
  const envRef = envUrl ? extractSupabaseProjectRef(envUrl) : null;
  if (envUrl && envRef && envRef !== PRODUCTION_SUPABASE_PROJECT_REF) {
    console.warn('[SupabaseEnv] Ignoring Supabase URL from wrong project:', envRef);
    return PRODUCTION_SUPABASE_URL;
  }
  return envUrl || PRODUCTION_SUPABASE_URL;
}

/**
 * Resolve the mobile client auth key.
 *
 * A valid legacy anon JWT for this production project is preferred because the
 * current owner-login preflight explicitly validates JWT shape. If the runtime
 * only supplies an sb_publishable_ key, use the known-active production anon
 * JWT instead of failing preflight with a false "invalid API key" condition.
 */
export function resolveSupabaseAnonKey(): string {
  const legacyRaw =
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    '';
  const legacyCandidate = extractSupabaseAnonKey(legacyRaw);
  if (legacyCandidate?.startsWith('eyJ')) {
    const ref = extractSupabaseJwtRef(legacyCandidate);
    if (!ref || ref === PRODUCTION_SUPABASE_PROJECT_REF) {
      return legacyCandidate;
    }
    console.warn('[SupabaseEnv] Ignoring legacy anon key from wrong project:', ref);
  }

  // A publishable key may be present and is valid for Supabase, but the current
  // mobile login preflight is JWT-only. Return the active production anon JWT
  // so owner sign-in remains operational while preserving the publishable key
  // for backend/auth paths that already support it.
  const publishableRaw =
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    '';
  const publishableCandidate = extractSupabaseAnonKey(publishableRaw);
  if (publishableCandidate?.startsWith('sb_publishable_')) {
    return PRODUCTION_SUPABASE_ANON_KEY;
  }

  return PRODUCTION_SUPABASE_ANON_KEY;
}

export function getSupabaseEnvSanitizationReport(): {
  urlRaw: boolean;
  urlSanitized: boolean;
  keyRaw: boolean;
  keySanitized: boolean;
} {
  const rawUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '').trim();
  const rawKey = (
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    ''
  ).trim();
  return {
    urlRaw: !!rawUrl,
    urlSanitized: rawUrl !== resolveSupabaseUrl(),
    keyRaw: !!rawKey,
    keySanitized: rawKey !== resolveSupabaseAnonKey(),
  };
}
