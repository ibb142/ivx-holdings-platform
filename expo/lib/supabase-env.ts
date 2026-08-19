/**
 * Supabase env sanitizer for the auth/sign-in path.
 * Supports both modern sb_publishable_ keys and legacy anon JWT keys.
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
 * Resolve the low-privilege client API key.
 * Preference: modern publishable env -> legacy anon env -> known active publishable key.
 */
export function resolveSupabaseAnonKey(): string {
  const raw =
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY;
  const envKey = extractSupabaseAnonKey(raw);
  if (envKey?.startsWith('sb_publishable_')) return envKey;

  const envRef = envKey ? extractSupabaseJwtRef(envKey) : null;
  if (envKey && envRef && envRef !== PRODUCTION_SUPABASE_PROJECT_REF) {
    console.warn('[SupabaseEnv] Ignoring legacy anon key from wrong project:', envRef);
    return PRODUCTION_SUPABASE_PUBLISHABLE_KEY;
  }
  return envKey || PRODUCTION_SUPABASE_PUBLISHABLE_KEY;
}

export function getSupabaseEnvSanitizationReport(): {
  urlRaw: boolean;
  urlSanitized: boolean;
  keyRaw: boolean;
  keySanitized: boolean;
} {
  const rawUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '').trim();
  const rawKey = (
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    ''
  ).trim();
  return {
    urlRaw: !!rawUrl,
    urlSanitized: rawUrl !== resolveSupabaseUrl(),
    keyRaw: !!rawKey,
    keySanitized: rawKey !== resolveSupabaseAnonKey(),
  };
}
