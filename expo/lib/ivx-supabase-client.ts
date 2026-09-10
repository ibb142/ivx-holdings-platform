import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { getConfiguredOwnerAdminEmail } from '@/lib/admin-access-lock';
import { getSupabaseClient, supabase } from '@/lib/supabase';
import { resolveSupabaseUrl } from '@/lib/supabase-env';
import {
  getIVXAccessControlConfig,
  IVX_OPEN_ACCESS_OWNER_TOKEN,
  IVX_OPEN_ACCESS_OWNER_USER_ID,
  IVX_OWNER_AI_API_PATH,
  resolveIVXRoleAudit,
  type IVXOwnerAuthContext,
} from '@/shared/ivx';

const IVX_OWNER_AI_LEGACY_API_PATH = IVX_OWNER_AI_API_PATH.replace(/^\/api/, '');
export const IVX_CANONICAL_API_BASE_URL = 'https://api.ivxholding.com';

type IVXOwnerAIRuntimeEnvironment = 'development' | 'production';
type IVXOwnerAIRoutingPolicy = 'production_explicit' | 'production_canonical' | 'production_blocked' | 'development_explicit' | 'development_canonical' | 'development_fallback' | 'development_unconfigured';

export type IVXOwnerAIConfigAudit = {
  currentEnvironment: IVXOwnerAIRuntimeEnvironment;
  configuredBaseUrl: string | null;
  configuredFrom: 'EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL' | 'EXPO_PUBLIC_IVX_API_BASE_URL' | null;
  devFallbackBaseUrl: string | null;
  projectApiBaseUrl: string | null;
  directApiBaseUrl: string | null;
  webPreviewBaseUrl: string | null;
  canonicalBaseUrl: string;
  activeBaseUrl: string | null;
  activeHost: string | null;
  directApiHost: string | null;
  explicitProductionPinApplied: boolean;
  activeEndpoint: string | null;
  candidateEndpoints: string[];
  healthCheckUrl: string | null;
  route53AuditUrl: string | null;
  route53UpsertUrl: string | null;
  appApiHealthCheckUrl: string | null;
  appApiRoute53AuditUrl: string | null;
  routingPolicy: IVXOwnerAIRoutingPolicy;
  selectionReason: string;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  productionReady: boolean;
  blocksRemoteRequests: boolean;
  configurationError: string | null;
  pointsToDevHost: boolean;
  workflowTrace: string[];
  mismatchWarnings: string[];
};

function readTrimmedEnv(name: string): string {
  // Expo embeds only static process.env.EXPO_PUBLIC_* property references.
  // Keep server-only credentials on the dynamic, non-inlined path below.
  if (name === 'EXPO_PUBLIC_IVX_API_BASE_URL') return (process.env.EXPO_PUBLIC_IVX_API_BASE_URL ?? '').trim();
  if (name === 'EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL') return (process.env.EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL ?? '').trim();
  if (name === 'EXPO_PUBLIC_API_BASE_URL') return (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').trim();
  if (name === 'EXPO_PUBLIC_SUPABASE_URL') return (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim();
  return (process.env[name] ?? '').trim();
}

function getRuntimeEnvironment(): IVXOwnerAIRuntimeEnvironment {
  return typeof __DEV__ !== 'undefined' && __DEV__ ? 'development' : 'production';
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/$/, '');
}

function safeExtractHostname(value: string | null): string | null {
  const normalizedValue = normalizeBaseUrl(value ?? '');
  if (!normalizedValue) {
    return null;
  }

  try {
    return new URL(normalizedValue).hostname || null;
  } catch {
    return normalizedValue.replace(/^https?:\/\//i, '').split('/')[0]?.trim() || null;
  }
}

function buildAbsoluteUrl(baseUrl: string | null, path: string): string | null {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl ?? '');
  if (!normalizedBaseUrl) {
    return null;
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBaseUrl}${normalizedPath}`;
}

function pushUniqueString(values: string[], value: string): void {
  const normalizedValue = value.trim();
  if (!normalizedValue || values.includes(normalizedValue)) {
    return;
  }

  values.push(normalizedValue);
}

function buildOwnerAIUrls(baseUrl: string): [string, string] {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  return [
    `${normalizedBaseUrl}${IVX_OWNER_AI_API_PATH}`,
    `${normalizedBaseUrl}${IVX_OWNER_AI_LEGACY_API_PATH}`,
  ];
}

function getDefaultProjectApiBaseUrl(): string {
  // Rork dev fallback URL removed — IVX uses canonical production URL only
  return '';
}

function getConfiguredProjectApiBaseUrl(): string {
  return normalizeBaseUrl(readTrimmedEnv('EXPO_PUBLIC_IVX_API_BASE_URL'));
}

function getConfiguredDirectApiBaseUrl(): string {
  return normalizeBaseUrl(readTrimmedEnv('EXPO_PUBLIC_API_BASE_URL'));
}

function getConfiguredOwnerAIBaseUrl(): {
  configuredBaseUrl: string | null;
  configuredFrom: IVXOwnerAIConfigAudit['configuredFrom'];
} {
  const ownerAIBaseUrl = normalizeBaseUrl(readTrimmedEnv('EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL'));
  if (ownerAIBaseUrl) {
    return {
      configuredBaseUrl: ownerAIBaseUrl,
      configuredFrom: 'EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL',
    };
  }

  const projectApiBaseUrl = getConfiguredProjectApiBaseUrl();
  if (projectApiBaseUrl) {
    return {
      configuredBaseUrl: projectApiBaseUrl,
      configuredFrom: 'EXPO_PUBLIC_IVX_API_BASE_URL',
    };
  }

  return {
    configuredBaseUrl: null,
    configuredFrom: null,
  };
}

function getWebPreviewBaseUrl(): string {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return '';
  }

  const origin = typeof window.location?.origin === 'string' ? window.location.origin : '';
  return normalizeBaseUrl(origin);
}

function isDevLikeBaseUrl(baseUrl: string): boolean {
  const normalized = normalizeBaseUrl(baseUrl).toLowerCase();
  if (!normalized) {
    return false;
  }

  return normalized.includes('localhost')
    || normalized.includes('127.0.0.1')
    || normalized.includes('192.168.')
    || normalized.includes('10.')
    || normalized.includes('172.16.');
}

function pushUniqueUrl(urls: string[], value: string): void {
  const normalizedValue = value.trim();
  if (!normalizedValue || urls.includes(normalizedValue)) {
    return;
  }

  urls.push(normalizedValue);
}

export function getIVXSupabaseClient(): SupabaseClient {
  return getSupabaseClient();
}

export function getIVXOwnerAIConfigAudit(): IVXOwnerAIConfigAudit {
  const currentEnvironment = getRuntimeEnvironment();
  const configuredOwnerAIBaseUrl = getConfiguredOwnerAIBaseUrl();
  const envConfiguredBaseUrl = configuredOwnerAIBaseUrl.configuredBaseUrl ?? '';
  const explicitProductionPinApplied = !!envConfiguredBaseUrl;
  const configuredBaseUrl = configuredOwnerAIBaseUrl.configuredBaseUrl;
  const configuredFrom = configuredOwnerAIBaseUrl.configuredFrom;
  const devFallbackBaseUrl = normalizeBaseUrl(getDefaultProjectApiBaseUrl());
  const projectApiBaseUrl = getConfiguredProjectApiBaseUrl();
  const directApiBaseUrl = getConfiguredDirectApiBaseUrl();
  const webPreviewBaseUrl = getWebPreviewBaseUrl();
  const candidateEndpoints: string[] = [];
  const workflowTrace: string[] = [];
  const mismatchWarnings: string[] = [];

  let activeBaseUrl: string | null = null;
  let routingPolicy: IVXOwnerAIRoutingPolicy = 'development_unconfigured';
  let selectionReason = 'Owner AI routing is not configured yet.';
  let fallbackUsed = false;
  let fallbackReason: string | null = null;
  let configurationError: string | null = null;
  let blocksRemoteRequests = false;

  if (currentEnvironment === 'production') {
    if (envConfiguredBaseUrl && !isDevLikeBaseUrl(envConfiguredBaseUrl)) {
      routingPolicy = 'production_explicit';
      activeBaseUrl = envConfiguredBaseUrl;
      selectionReason = 'Production Owner AI routing is explicitly pinned by EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL.';
    } else {
      routingPolicy = 'production_canonical';
      activeBaseUrl = IVX_CANONICAL_API_BASE_URL;
      selectionReason = envConfiguredBaseUrl
        ? `Production Owner AI routing pinned to the canonical IVX API host because the configured override (${envConfiguredBaseUrl}) looks like a development host.`
        : 'Production Owner AI routing pinned to the canonical IVX API host (https://api.ivxholding.com).';
    }
  } else if (envConfiguredBaseUrl && !isDevLikeBaseUrl(envConfiguredBaseUrl)) {
    // Owner AI is hard-pinned to a non-dev host. Honor the explicit override.
    routingPolicy = 'development_explicit';
    activeBaseUrl = envConfiguredBaseUrl;
    selectionReason = envConfiguredBaseUrl === IVX_CANONICAL_API_BASE_URL
      ? 'Development build is explicitly pinned to the canonical IVX API host.'
      : `Development build is explicitly pinned by ${configuredFrom ?? 'environment configuration'}.`;
  } else {
    // Owner AI must always reach the production backend (api.ivxholding.com)
    // because the AI provider gateway, key, and rate-limit account only live
    // there. Dev hosts (web preview origin / LAN IPs) cannot
    // serve POST /api/ivx/owner-ai, so we never fall back to them.
    routingPolicy = 'development_canonical';
    activeBaseUrl = IVX_CANONICAL_API_BASE_URL;
    fallbackUsed = !!envConfiguredBaseUrl;
    fallbackReason = envConfiguredBaseUrl
      ? `Ignoring dev-like Owner AI override (${envConfiguredBaseUrl}); Owner AI is pinned to the canonical IVX API host.`
      : 'Owner AI is pinned to the canonical IVX API host in development; dev hosts cannot serve the Owner AI route.';
    selectionReason = 'Development build is hard-pinned to the canonical IVX API host (https://api.ivxholding.com) for Owner AI routing.';
  }

  if (activeBaseUrl) {
    for (const candidateUrl of buildOwnerAIUrls(activeBaseUrl)) {
      pushUniqueUrl(candidateEndpoints, candidateUrl);
    }
  }

  // Owner AI never tries dev-like alternates. The only acceptable fallback
  // candidate is the canonical IVX API host (which is usually already the
  // active base URL).
  if (IVX_CANONICAL_API_BASE_URL !== activeBaseUrl) {
    for (const candidateUrl of buildOwnerAIUrls(IVX_CANONICAL_API_BASE_URL)) {
      pushUniqueUrl(candidateEndpoints, candidateUrl);
    }
  }

  const activeEndpoint = candidateEndpoints[0] ?? null;
  const activeHost = safeExtractHostname(activeBaseUrl);
  const directApiHost = safeExtractHostname(directApiBaseUrl || null);
  const healthCheckUrl = buildAbsoluteUrl(activeBaseUrl, '/health');
  const route53AuditUrl = buildAbsoluteUrl(activeBaseUrl, '/api/aws/route53/audit');
  const route53UpsertUrl = buildAbsoluteUrl(activeBaseUrl, '/api/aws/route53/upsert');
  const appApiHealthCheckUrl = buildAbsoluteUrl(directApiBaseUrl || null, '/health');
  const appApiRoute53AuditUrl = buildAbsoluteUrl(directApiBaseUrl || null, '/api/aws/route53/audit');
  const pointsToDevHost = activeBaseUrl ? isDevLikeBaseUrl(activeBaseUrl) : false;
  const productionReady = currentEnvironment === 'production'
    ? !!envConfiguredBaseUrl && !blocksRemoteRequests && !pointsToDevHost
    : true;

  pushUniqueString(
    workflowTrace,
    `Owner AI explicit base: ${configuredBaseUrl ?? 'not set'}${configuredFrom ? ` (${configuredFrom})` : ''}`,
  );
  pushUniqueString(
    workflowTrace,
    `IVX API base: ${projectApiBaseUrl || 'not set'}${projectApiBaseUrl ? ' (EXPO_PUBLIC_IVX_API_BASE_URL)' : ''}`,
  );
  pushUniqueString(
    workflowTrace,
    `App-wide API base: ${directApiBaseUrl || 'not set'}${directApiBaseUrl ? ' (EXPO_PUBLIC_API_BASE_URL, not consumed by Owner AI routing)' : ''}`,
  );
  pushUniqueString(
    workflowTrace,
    `Web preview origin: ${webPreviewBaseUrl || 'not set'}`,
  );
  pushUniqueString(
    workflowTrace,
    `Project fallback base: ${devFallbackBaseUrl || 'not set'}${devFallbackBaseUrl ? ' (derived from EXPO_PUBLIC_PROJECT_ID)' : ''}`,
  );
  pushUniqueString(
    workflowTrace,
    `Fallback reason: ${fallbackReason ?? 'none'}`,
  );
  pushUniqueString(
    workflowTrace,
    `Selected Owner AI base: ${activeBaseUrl ?? 'blocked'} via ${selectionReason}`,
  );
  pushUniqueString(
    workflowTrace,
    `Selected Owner AI endpoint: ${activeEndpoint ?? 'unconfigured'}`,
  );
  pushUniqueString(
    workflowTrace,
    `Owner AI health URL: ${healthCheckUrl ?? 'unconfigured'}`,
  );
  pushUniqueString(
    workflowTrace,
    `Owner Route53 audit URL: ${route53AuditUrl ?? 'unconfigured'}`,
  );

  if (directApiBaseUrl && !configuredBaseUrl && currentEnvironment === 'production') {
    pushUniqueString(
      mismatchWarnings,
      `EXPO_PUBLIC_API_BASE_URL points to ${directApiBaseUrl}, but production Owner AI routing does not read that variable unless EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL is also set.`,
    );
  }

  if (directApiBaseUrl && activeBaseUrl && normalizeBaseUrl(directApiBaseUrl) !== normalizeBaseUrl(activeBaseUrl)) {
    pushUniqueString(
      mismatchWarnings,
      `App-wide API traffic points to ${directApiBaseUrl}, while Owner AI resolves through ${activeBaseUrl}. This split host path can hide the real failing backend.`,
    );
  }

  if (currentEnvironment === 'production' && directApiBaseUrl && isDevLikeBaseUrl(directApiBaseUrl)) {
    pushUniqueString(
      mismatchWarnings,
      `EXPO_PUBLIC_API_BASE_URL still points to a development-like host in production: ${directApiBaseUrl}.`,
    );
  }

  if (currentEnvironment === 'production' && !configuredBaseUrl && directApiBaseUrl) {
    pushUniqueString(
      mismatchWarnings,
      'Production Owner AI routing stays pinned to the canonical IVX API host unless EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL or EXPO_PUBLIC_IVX_API_BASE_URL is set explicitly.',
    );
  }

  if (route53AuditUrl && appApiRoute53AuditUrl && route53AuditUrl !== appApiRoute53AuditUrl) {
    pushUniqueString(
      mismatchWarnings,
      `Route53 diagnostics differ by host: owner path ${route53AuditUrl} vs app API path ${appApiRoute53AuditUrl}.`,
    );
  }

  const audit: IVXOwnerAIConfigAudit = {
    currentEnvironment,
    configuredBaseUrl,
    configuredFrom,
    devFallbackBaseUrl: devFallbackBaseUrl || null,
    projectApiBaseUrl: projectApiBaseUrl || null,
    directApiBaseUrl: directApiBaseUrl || null,
    webPreviewBaseUrl: webPreviewBaseUrl || null,
    canonicalBaseUrl: IVX_CANONICAL_API_BASE_URL,
    activeBaseUrl,
    activeHost,
    directApiHost,
    activeEndpoint,
    explicitProductionPinApplied,
    candidateEndpoints,
    healthCheckUrl,
    route53AuditUrl,
    route53UpsertUrl,
    appApiHealthCheckUrl,
    appApiRoute53AuditUrl,
    routingPolicy,
    selectionReason,
    fallbackUsed,
    fallbackReason,
    productionReady,
    blocksRemoteRequests,
    configurationError,
    pointsToDevHost,
    workflowTrace,
    mismatchWarnings,
  };

  console.log('[IVXSupabaseClient] Owner AI config audit:', audit);

  return audit;
}

export function getIVXOwnerAICandidateEndpoints(): string[] {
  return getIVXOwnerAIConfigAudit().candidateEndpoints;
}

export function getIVXOwnerAIResolvedEndpoint(): string | null {
  return getIVXOwnerAIConfigAudit().activeEndpoint;
}

export function getIVXOwnerAIEndpoint(): string {
  const audit = getIVXOwnerAIConfigAudit();
  if (audit.activeEndpoint) {
    return audit.activeEndpoint;
  }

  throw new Error(audit.configurationError ?? 'Owner AI endpoint is not configured for this environment.');
}

type IVXAccessTokenOptions = {
  forceRefresh?: boolean;
};

/**
 * True when a JWT's `exp` claim is in the past (with a small clock-skew guard).
 * Used to ensure we never hand a guaranteed-to-be-rejected token to the
 * owner-gated route, which would surface as owner_route_auth_401.
 */
function isAccessTokenExpired(token: string): boolean {
  const decoded = decodeJwtPayload(token);
  const exp = decoded && typeof decoded.exp === 'number' ? decoded.exp : null;
  if (exp === null) {
    return false;
  }
  const CLOCK_SKEW_SECONDS = 5;
  return exp - CLOCK_SKEW_SECONDS <= Date.now() / 1000;
}

async function refreshIVXSessionToken(reason: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.refreshSession();
    const refreshedToken = data.session?.access_token ?? null;
    if (refreshedToken) {
      console.log('[IVXSupabaseClient] Access token refreshed:', { reason });
      return refreshedToken;
    }
    if (error) {
      console.log('[IVXSupabaseClient] Access token refresh failed:', { reason, message: error.message });
    }
  } catch (error) {
    console.log('[IVXSupabaseClient] Access token refresh threw:', { reason, message: error instanceof Error ? error.message : 'unknown' });
  }
  return null;
}

export type IVXAuthStatusSnapshot = {
  tokenPresent: boolean;
  tokenLength: number;
  expiresInSeconds: number | null;
  issuer: string | null;
  matchesFrontendSupabase: boolean | null;
  ownerBypassEnabled: boolean;
  securityMode: string;
  platform: string;
};

function decodeJwtPayload(token: string): { iss?: unknown; exp?: unknown } | null {
  const segments = token.split('.');
  if (segments.length !== 3) return null;
  try {
    const payloadSegment = segments[1] ?? '';
    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const decoded = typeof atob === 'function'
      ? atob(padded)
      : Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(decoded) as { iss?: unknown; exp?: unknown };
  } catch {
    return null;
  }
}

/**
 * Live auth state snapshot for the IVX watchdog HUD.
 * Reads supabase.auth.getSession() and decodes only iss/exp (no token leak).
 */
export async function getIVXAuthStatusSnapshot(): Promise<IVXAuthStatusSnapshot> {
  const accessConfig = getIVXAccessControlConfig();
  const sessionResult = await supabase.auth.getSession();
  const session = sessionResult.data.session;
  const accessToken = session?.access_token ?? null;
  const tokenPresent = Boolean(accessToken);
  const tokenLength = accessToken ? accessToken.length : 0;
  let issuer: string | null = null;
  let expiresInSeconds: number | null = null;
  let matchesFrontendSupabase: boolean | null = null;
  if (accessToken) {
    const decoded = decodeJwtPayload(accessToken);
    if (decoded) {
      issuer = typeof decoded.iss === 'string' ? decoded.iss : null;
      const exp = typeof decoded.exp === 'number' ? decoded.exp : null;
      expiresInSeconds = exp !== null ? Math.round(exp - Date.now() / 1000) : null;
      const frontendSupabaseUrl = resolveSupabaseUrl();
      matchesFrontendSupabase = issuer && frontendSupabaseUrl
        ? issuer.replace(/\/+$/, '').startsWith(frontendSupabaseUrl.replace(/\/+$/, ''))
        : null;
    }
  }
  return {
    tokenPresent,
    tokenLength,
    expiresInSeconds,
    issuer,
    matchesFrontendSupabase,
    ownerBypassEnabled: accessConfig.ownerBypassEnabled,
    securityMode: accessConfig.securityMode,
    platform: Platform.OS,
  };
}

export async function getIVXAccessToken(options: IVXAccessTokenOptions = {}): Promise<string | null> {
  const accessConfig = getIVXAccessControlConfig();
  let sessionResult = await supabase.auth.getSession();
  let session = sessionResult.data.session;

  // OWNER AUTO-LOGIN BLOCK: restoreOwnerResilientSession() removed.
  // The owner must never have their session auto-restored from SecureStore.
  // If the live Supabase session is missing, the caller must prompt for
  // manual sign-in. This applies only to the owner account.

  const accessToken = session?.access_token ?? null;
  const expiresAtMs = session?.expires_at ? session.expires_at * 1000 : 0;
  const isExpiringSoon = expiresAtMs > 0 && expiresAtMs - Date.now() < 120_000;

  if ((options.forceRefresh || isExpiringSoon) && session?.refresh_token) {
    const refreshedToken = await refreshIVXSessionToken(options.forceRefresh ? 'forced_retry_after_auth_rejection' : 'token_expiring_soon');
    if (refreshedToken) {
      return refreshedToken;
    }
  }

  if (accessToken) {
    // Never hand back a token that is already expired: sending it to the
    // owner-gated route is guaranteed to produce owner_route_auth_401, which
    // previously surfaced as a confusing auth failure instead of a clean
    // re-authentication prompt. If a forced refresh could not replace an
    // expired token, return null so the preflight surfaces OWNER_SESSION_REQUIRED.
    const tokenIsExpired = isAccessTokenExpired(accessToken);
    if (tokenIsExpired) {
      console.log('[IVXSupabaseClient] Access token resolved', {
        tokenPresent: false,
        reason: 'stale_token_expired_after_failed_refresh',
        securityMode: accessConfig.securityMode,
      });
      if (accessConfig.ownerBypassEnabled) {
        return IVX_OPEN_ACCESS_OWNER_TOKEN;
      }
      return null;
    }
    console.log('[IVXSupabaseClient] Access token resolved', {
      tokenPresent: true,
      securityMode: accessConfig.securityMode,
      ownerBypassEnabled: accessConfig.ownerBypassEnabled,
      expiringSoon: isExpiringSoon,
    });
    return accessToken;
  }

  const recoveredToken = await refreshIVXSessionToken('missing_session_recovery');
  if (recoveredToken) {
    console.log('[IVXSupabaseClient] Access token resolved', {
      tokenPresent: true,
      source: 'refresh_recovery',
    });
    return recoveredToken;
  }

  if (accessConfig.ownerBypassEnabled) {
    console.log('[IVXSupabaseClient] Access token resolved', {
      tokenPresent: true,
      source: 'open_access_fallback',
    });
    return IVX_OPEN_ACCESS_OWNER_TOKEN;
  }

  console.log('[IVXSupabaseClient] Access token resolved', {
    tokenPresent: false,
    securityMode: accessConfig.securityMode,
    openAccessEnabled: accessConfig.openAccessEnabled,
    devTestModeEnabled: accessConfig.devTestModeEnabled,
  });
  return null;
}

export async function getIVXOwnerAuthContext(): Promise<IVXOwnerAuthContext> {
  const accessConfig = getIVXAccessControlConfig();
  const sessionResult = await supabase.auth.getSession();
  const session = sessionResult.data.session;
  const user = session?.user ?? null;
  const accessToken = session?.access_token ?? null;

  if (!user || !accessToken) {
    if (accessConfig.ownerBypassEnabled) {
      const ownerEmail = getConfiguredOwnerAdminEmail() ?? 'owner@ivx.dev';
      console.log('[IVXSupabaseClient] Missing owner session in explicit test/open-access mode, using owner bypass context:', {
        email: ownerEmail,
        securityMode: accessConfig.securityMode,
      });
      return {
        userId: IVX_OPEN_ACCESS_OWNER_USER_ID,
        email: ownerEmail,
        role: 'owner',
        accessToken: IVX_OPEN_ACCESS_OWNER_TOKEN,
      };
    }

    console.log('[IVXSupabaseClient] Missing owner session', {
      securityMode: accessConfig.securityMode,
    });
    throw new Error('IVX client auth guard failed: no hydrated Supabase session is available yet.');
  }

  const profileResult = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  const roleAudit = resolveIVXRoleAudit(user, profileResult.data as Record<string, unknown> | null | undefined, profileResult.error?.message ?? null);

  console.log('[IVXSupabaseClient] Role resolution result:', {
    userId: user.id,
    email: user.email ?? null,
    securityMode: accessConfig.securityMode,
    roleAudit,
  });

  if (roleAudit.normalizedRole === 'investor') {
    if (accessConfig.ownerBypassEnabled) {
      console.log('[IVXSupabaseClient] Non-privileged session promoted by explicit test/open-access bypass:', {
        userId: user.id,
        email: user.email ?? null,
        roleAudit,
      });
      return {
        userId: user.id,
        email: user.email ?? getConfiguredOwnerAdminEmail() ?? 'owner@ivx.dev',
        role: 'owner',
        accessToken,
      };
    }

    console.log('[IVXSupabaseClient] Blocked non-privileged session:', {
      userId: user.id,
      email: user.email ?? null,
      roleAudit,
    });
    throw new Error('IVX client role guard failed: privileged IVX access is required.');
  }

  const ownerContext: IVXOwnerAuthContext = {
    userId: user.id,
    email: user.email ?? null,
    role: roleAudit.normalizedRole,
    accessToken,
  };

  console.log('[IVXSupabaseClient] Owner auth context ready:', {
    userId: ownerContext.userId,
    email: ownerContext.email,
    role: ownerContext.role,
    securityMode: accessConfig.securityMode,
    rawRole: roleAudit.rawRole,
  });

  return ownerContext;
}

export function createIVXServerSupabaseClient(): SupabaseClient {
  const supabaseUrl = readTrimmedEnv('EXPO_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = readTrimmedEnv('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Server-side Supabase environment variables are missing.');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
