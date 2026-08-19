/**
 * Supabase env sanitizer for the auth/sign-in path.
 *
 * Root cause this fixes: in Expo Go the EXPO_PUBLIC_SUPABASE_URL and
 * EXPO_PUBLIC_SUPABASE_ANON_KEY project variables contain pasted terminal
 * text around the real values (labels, local-dev output, multiple tokens).
 * Building the Supabase client with those raw strings produces an invalid
 * base URL and an invalid `apikey` header, which breaks owner sign-in with
 * confusing network/parse errors.
 *
 * These helpers extract the real hosted Supabase URL and the real anon JWT
 * from polluted env values, and fall back to the known production project
 * constants when extraction fails. The anon key is a PUBLIC client key
 * protected by RLS — embedding the fallback is the standard Supabase pattern.
 */

export const PRODUCTION_SUPABASE_URL = 'https://kvclcdjmjghndxsngfzb.supabase.co';
export const PRODUCTION_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2Y2xjZGptamdobmR4c25nZnpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxOTQwMjcsImV4cCI6MjA4ODc3MDAyN30.OLDwa21VHQNs151AD-8k--_HigQ2d-N7yJfFn5UeNPk';

const PRODUCTION_SUPABASE_PROJECT_REF = 'kvclcdjmjghndxsngfzb';

/** Issuers used by local/demo Supabase stacks. Their anon keys are signed with a
 * public sample secret and are always rejected by the hosted project with
 * HTTP 401 "Invalid API key". */
const NON_PRODUCTION_JWT_ISSUERS = new Set(['supabase-demo']);

const HOSTED_SUPABASE_URL_PATTERN = /https:\/\/[a-z0-9-]+\.supabase\.co\b/i;
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

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

function isProductionBuild(): boolean {
  return typeof __DEV__ === 'undefined' || !__DEV__;
}

function extractSupabaseProjectRef(url: string): string | null {
  const match = url.match(/https:\/\/([a-z0-9-]+)\.supabase\.co\b/i);
  return match?.[1] ?? null;
}

function extractSupabaseJwtRef(token: string): string | null {
  const payload = decodeJwtPayload(token);
  return typeof payload?.ref === 'string' ? payload.ref : null;
}

/**
 * Decide whether an anon JWT really belongs to the production Supabase project.
 *
 * Checking only for a mismatched `ref` is not enough: the Supabase local-dev
 * demo key carries `iss: "supabase-demo"` and NO `ref` claim at all, so a
 * ref-only check accepts it and every sign-in fails with HTTP 401
 * "Invalid API key". A hosted project key always identifies its own project,
 * so a key without a matching `ref` is treated as foreign.
 */
export function isProductionSupabaseAnonKey(token: string): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload) return false;

  const issuer = typeof payload.iss === 'string' ? payload.iss : '';
  if (NON_PRODUCTION_JWT_ISSUERS.has(issuer)) return false;

  if (payload.role !== 'anon') return false;

  if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) return false;

  return payload.ref === PRODUCTION_SUPABASE_PROJECT_REF;
}

/**
 * Extract a usable Supabase URL from a possibly polluted env value.
 * Preference order:
 *   1. A hosted `https://<ref>.supabase.co` URL found anywhere in the string.
 *   2. The whole trimmed value when it is a single valid http(s) URL.
 *   3. null (caller applies its fallback).
 */
export function extractSupabaseUrl(raw: string | undefined | null): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;

  const hosted = value.match(HOSTED_SUPABASE_URL_PATTERN);
  if (hosted?.[0]) {
    return hosted[0].replace(/\/$/, '');
  }

  if (!/\s/.test(value)) {
    try {
      const parsed = new URL(value);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        return value.replace(/\/$/, '');
      }
    } catch {
      // fall through
    }
  }
  return null;
}

/**
 * Extract a usable Supabase anon JWT from a possibly polluted env value.
 * Prefers a JWT whose payload declares role "anon"; otherwise the first
 * JWT-shaped token found. Returns null when no JWT is present.
 */
export function extractSupabaseAnonKey(raw: string | undefined | null): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;

  const matches = value.match(JWT_PATTERN) ?? [];
  if (matches.length === 0) return null;

  for (const candidate of matches) {
    const payload = decodeJwtPayload(candidate);
    if (payload && payload.role === 'anon') {
      return candidate;
    }
  }
  return matches[0] ?? null;
}

/** Sanitized Supabase URL with production fallback — always a valid URL. */
export function resolveSupabaseUrl(): string {
  const envUrl = extractSupabaseUrl(process.env.EXPO_PUBLIC_SUPABASE_URL);
  const envRef = envUrl ? extractSupabaseProjectRef(envUrl) : null;
  // A hosted Supabase URL pointing to a different project is never safe to use,
  // even in __DEV__ / Expo Go, because it sends real owner credentials to the
  // wrong auth backend and causes the "Invalid API key" failure. Local/self-hosted
  // URLs are still honored when they match the expected shape.
  if (envUrl && envRef && envRef !== PRODUCTION_SUPABASE_PROJECT_REF) {
    console.warn(
      '[SupabaseEnv] Ignoring EXPO_PUBLIC_SUPABASE_URL because it points to a different project:',
      envUrl,
      'Expected ref:',
      PRODUCTION_SUPABASE_PROJECT_REF,
    );
    return PRODUCTION_SUPABASE_URL;
  }
  if (envUrl) {
    return envUrl;
  }
  return PRODUCTION_SUPABASE_URL;
}

/** Sanitized Supabase anon key with production fallback — always a valid JWT shape. */
export function resolveSupabaseAnonKey(): string {
  const envKey = extractSupabaseAnonKey(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
  if (!envKey) {
    return PRODUCTION_SUPABASE_ANON_KEY;
  }

  // Any anon key that does not positively identify the production project is
  // unsafe to use, even in __DEV__ / Expo Go: it mismatches the resolved
  // Supabase URL and produces the "Invalid API key" auth error on sign-in.
  if (!isProductionSupabaseAnonKey(envKey)) {
    console.warn(
      '[SupabaseEnv] Ignoring EXPO_PUBLIC_SUPABASE_ANON_KEY because it does not belong to the production project. Found ref:',
      extractSupabaseJwtRef(envKey) ?? 'none',
      'Expected ref:',
      PRODUCTION_SUPABASE_PROJECT_REF,
    );
    return PRODUCTION_SUPABASE_ANON_KEY;
  }

  return envKey;
}

/** True when either env value was polluted/unusable and a fallback or extraction was applied. */
export function getSupabaseEnvSanitizationReport(): {
  urlRaw: boolean;
  urlSanitized: boolean;
  keyRaw: boolean;
  keySanitized: boolean;
} {
  const rawUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim();
  const rawKey = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();
  return {
    urlRaw: !!rawUrl,
    urlSanitized: rawUrl !== resolveSupabaseUrl(),
    keyRaw: !!rawKey,
    keySanitized: rawKey !== resolveSupabaseAnonKey(),
  };
}
