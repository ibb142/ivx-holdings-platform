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
export const PRODUCTION_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2Y2xjZGptamdobmR4c25nZnpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxOTQwMjcsImV4cCI6MjA4ODc3MDAyN30.OLDwa21VHQNs151AD-8k--_HigQ2d-N7yJfFn5UeNPk';
const PRODUCTION_SUPABASE_PROJECT_REF = 'kvclcdjmjghndxsngfzb';
const HOSTED_SUPABASE_URL_PATTERN = /https:\/\/[a-z0-9-]+\.supabase\.co\b/i;
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
function decodeJwtPayload(token) {
    try {
        const payloadSegment = token.split('.')[1] ?? '';
        const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
        const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
        const decoded = typeof atob === 'function'
            ? atob(padded)
            : Buffer.from(padded, 'base64').toString('utf8');
        return JSON.parse(decoded);
    }
    catch {
        return null;
    }
}
function isProductionBuild() {
    return typeof __DEV__ === 'undefined' || !__DEV__;
}
function extractSupabaseProjectRef(url) {
    const match = url.match(/https:\/\/([a-z0-9-]+)\.supabase\.co\b/i);
    return match?.[1] ?? null;
}
function extractSupabaseJwtRef(token) {
    const payload = decodeJwtPayload(token);
    return typeof payload?.ref === 'string' ? payload.ref : null;
}
/**
 * Extract a usable Supabase URL from a possibly polluted env value.
 * Preference order:
 *   1. A hosted `https://<ref>.supabase.co` URL found anywhere in the string.
 *   2. The whole trimmed value when it is a single valid http(s) URL.
 *   3. null (caller applies its fallback).
 */
export function extractSupabaseUrl(raw) {
    const value = (raw ?? '').trim();
    if (!value)
        return null;
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
        }
        catch {
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
export function extractSupabaseAnonKey(raw) {
    const value = (raw ?? '').trim();
    if (!value)
        return null;
    const matches = value.match(JWT_PATTERN) ?? [];
    if (matches.length === 0)
        return null;
    for (const candidate of matches) {
        const payload = decodeJwtPayload(candidate);
        if (payload && payload.role === 'anon') {
            return candidate;
        }
    }
    return matches[0] ?? null;
}
/** Sanitized Supabase URL with production fallback — always a valid URL. */
export function resolveSupabaseUrl() {
    const envUrl = extractSupabaseUrl(process.env.EXPO_PUBLIC_SUPABASE_URL);
    const envRef = envUrl ? extractSupabaseProjectRef(envUrl) : null;
    // A hosted Supabase URL pointing to a different project is never safe to use,
    // even in __DEV__ / Expo Go, because it sends real owner credentials to the
    // wrong auth backend and causes the "Invalid API key" failure. Local/self-hosted
    // URLs are still honored when they match the expected shape.
    if (envUrl && envRef && envRef !== PRODUCTION_SUPABASE_PROJECT_REF) {
        console.warn('[SupabaseEnv] Ignoring EXPO_PUBLIC_SUPABASE_URL because it points to a different project:', envUrl, 'Expected ref:', PRODUCTION_SUPABASE_PROJECT_REF);
        return PRODUCTION_SUPABASE_URL;
    }
    if (envUrl) {
        return envUrl;
    }
    return PRODUCTION_SUPABASE_URL;
}
/** Sanitized Supabase anon key with production fallback — always a valid JWT shape. */
export function resolveSupabaseAnonKey() {
    const envKey = extractSupabaseAnonKey(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
    const envRef = envKey ? extractSupabaseJwtRef(envKey) : null;
    // An anon key belonging to a different hosted project is never safe to use,
    // even in __DEV__ / Expo Go, because it mismatches the resolved Supabase URL
    // and produces the "Invalid API key" auth error.
    if (envKey && envRef && envRef !== PRODUCTION_SUPABASE_PROJECT_REF) {
        console.warn('[SupabaseEnv] Ignoring EXPO_PUBLIC_SUPABASE_ANON_KEY because it belongs to a different project:', envRef, 'Expected ref:', PRODUCTION_SUPABASE_PROJECT_REF);
        return PRODUCTION_SUPABASE_ANON_KEY;
    }
    if (envKey) {
        return envKey;
    }
    return PRODUCTION_SUPABASE_ANON_KEY;
}
/** True when either env value was polluted/unusable and a fallback or extraction was applied. */
export function getSupabaseEnvSanitizationReport() {
    const rawUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim();
    const rawKey = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();
    return {
        urlRaw: !!rawUrl,
        urlSanitized: rawUrl !== resolveSupabaseUrl(),
        keyRaw: !!rawKey,
        keySanitized: rawKey !== resolveSupabaseAnonKey(),
    };
}
