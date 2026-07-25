/**
 * IVX OWNER AUTH GUARDIAN — permanent autonomous worker (W2/AUTH-GUARDIAN).
 *
 * Mission: own the authentication system permanently.
 *   - Live production probes on every read (health, Supabase auth, protected
 *     route guard, login route) — no cached "green" states.
 *   - Full authentication architecture map: every component traced to route,
 *     source file and function.
 *   - Automatic incident open/close persisted in the durable store.
 *   - Owner SMS alerts via the EXISTING AWS SNS transport
 *     (backend/services/ivx-sns-sms.ts) — runtime-verified, MessageId stored,
 *     every send logged to the owner audit ledger. No secrets in messages.
 *
 * Routes (registered in backend/hono-extended.ts):
 *   GET  /api/ivx/autonomous/auth-guardian        — owner-only guardian state
 *   POST /api/ivx/autonomous/auth-guardian/alert  — owner-only SMS alert send
 *
 * Marker: ivx-owner-auth-guardian-2026-07-17
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { sendSnsSms, normalizePhoneToE164 } from '../services/ivx-sns-sms';
import { readDurableJson, writeDurableJson } from '../services/ivx-durable-store';

const GUARDIAN_MARKER = 'ivx-owner-auth-guardian-2026-07-17';
const GUARDIAN_STATE_FILE = 'logs/audit/owner-auth-guardian/state.json';
const SELF_BASE_URL = 'https://api.ivxholding.com';
/** Owner phone from the standing mandate; env var overrides. */
const OWNER_ALERT_PHONE_FALLBACK = '+15616443503';
const PROBE_TIMEOUT_MS = 8000;
const MAX_INCIDENTS = 50;
const MAX_ALERT_LOG = 50;

export type ProbeResult = {
  id: string;
  name: string;
  target: string;
  ok: boolean;
  httpStatus: number | null;
  latencyMs: number;
  detail: string;
  checkedAt: string;
};

export type GuardianIncident = {
  incidentId: string;
  probeId: string;
  openedAt: string;
  closedAt: string | null;
  status: 'OPEN' | 'CLOSED';
  detail: string;
};

export type AlertLogEntry = {
  alertId: string;
  severity: string;
  area: string;
  problem: string;
  smsStatus: string;
  messageId: string | null;
  httpStatus: number | null;
  toMasked: string;
  sentAt: string;
  test: boolean;
};

export type GuardianState = {
  incidents: GuardianIncident[];
  alerts: AlertLogEntry[];
  incidentCounter: number;
  alertCounter: number;
  lastRunAt: string | null;
  totalRuns: number;
};

export const GUARDIAN_STATE_FILE_PATH = GUARDIAN_STATE_FILE;

export const EMPTY_GUARDIAN_STATE: GuardianState = {
  incidents: [],
  alerts: [],
  incidentCounter: 0,
  alertCounter: 0,
  lastRunAt: null,
  totalRuns: 0,
};
const EMPTY_STATE = EMPTY_GUARDIAN_STATE;

/** Static authentication architecture map — component → route/file/function. */
const AUTH_MAP: { component: string; platform: string; route: string; sourceFile: string; functionRef: string }[] = [
  { component: 'Password Login', platform: 'Android/iOS/Web', route: 'POST {SUPABASE}/auth/v1/token?grant_type=password', sourceFile: 'expo/lib/ivx-supabase-client.ts', functionRef: 'getIVXSupabaseClient().auth.signInWithPassword' },
  { component: 'Owner Passwordless Login', platform: 'API', route: 'POST /api/ivx/owner-passwordless-login', sourceFile: 'backend/hono.ts', functionRef: 'owner-passwordless-login handler (magiclink token_hash verify)' },
  { component: 'Sessions / JWT', platform: 'All', route: 'Supabase GoTrue JWT (HS256, exp ~15m)', sourceFile: 'expo/lib/ivx-supabase-client.ts', functionRef: 'getIVXAccessToken' },
  { component: 'Refresh Tokens', platform: 'All', route: 'POST {SUPABASE}/auth/v1/token?grant_type=refresh_token', sourceFile: 'expo/lib/ivx-supabase-client.ts', functionRef: 'supabase.auth autoRefreshToken' },
  { component: 'Logout / Session Revocation', platform: 'All', route: 'POST {SUPABASE}/auth/v1/logout', sourceFile: 'expo/lib/ivx-supabase-client.ts', functionRef: 'supabase.auth.signOut' },
  { component: 'Password Reset (email)', platform: 'All', route: 'POST {SUPABASE}/auth/v1/recover', sourceFile: 'expo/app/owner-access.tsx', functionRef: 'resetPasswordForEmail' },
  { component: 'SMS Owner Recovery', platform: 'API', route: 'POST /api/ivx/owner-recovery/request|verify', sourceFile: 'backend/api/ivx-owner-recovery-sms.ts', functionRef: 'handleOwnerRecoveryRequestRequest / handleOwnerRecoveryVerifyRequest' },
  { component: 'Owner Role Guard', platform: 'API', route: 'all /api/ivx/* owner routes', sourceFile: 'backend/api/owner-only.ts', functionRef: 'assertIVXOwnerOnly' },
  { component: 'Protected Routes (ledger)', platform: 'API', route: 'GET /api/ivx/autonomous/ledger', sourceFile: 'backend/api/ivx-autonomous-job-ledger.ts', functionRef: 'handleAutonomousJobLedgerGet' },
  { component: 'Dashboard Access', platform: 'Expo owner app', route: '/autonomous-dashboard', sourceFile: 'expo/app/autonomous-dashboard.tsx', functionRef: 'AutonomousDashboardScreen (owner bearer)' },
  { component: 'Secure Storage', platform: 'Android/iOS', route: 'AsyncStorage-backed Supabase session', sourceFile: 'expo/lib/ivx-supabase-client.ts', functionRef: 'createClient storage adapter' },
  { component: 'Environment Config', platform: 'Backend', route: 'Render env (SUPABASE_SERVICE_ROLE_KEY, AWS_*)', sourceFile: 'backend/api/ivx-owner-recovery-sms.ts', functionRef: 'getServiceRoleKey / isSnsSmsConfigured' },
];

function nowIso(): string {
  return new Date().toISOString();
}

function readEnv(name: string): string {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

export function resolveAlertPhone(): string {
  return normalizePhoneToE164(readEnv('IVX_OWNER_RECOVERY_PHONE') || OWNER_ALERT_PHONE_FALLBACK);
}

export function maskPhone(phone: string): string {
  return phone.length >= 6 ? `${phone.slice(0, 2)}***${phone.slice(-4)}` : '***';
}

async function timedFetch(url: string, init?: RequestInit): Promise<{ status: number | null; latencyMs: number; error: string | null }> {
  const startedAt = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const response = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timer);
    return { status: response.status, latencyMs: Date.now() - startedAt, error: null };
  } catch (error) {
    return { status: null, latencyMs: Date.now() - startedAt, error: error instanceof Error ? error.message : 'fetch failed' };
  }
}

/** Run the live production authentication probes. Never throws. */
export async function runAuthProbes(): Promise<ProbeResult[]> {
  const supabaseUrl = readEnv('EXPO_PUBLIC_SUPABASE_URL') || readEnv('SUPABASE_URL');
  const checkedAt = nowIso();

  const [health, supabaseAuth, ledgerGuard, loginRoute] = await Promise.all([
    timedFetch(`${SELF_BASE_URL}/health`),
    supabaseUrl
      ? timedFetch(`${supabaseUrl.replace(/\/+$/, '')}/auth/v1/health`, { headers: { apikey: readEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY') } })
      : Promise.resolve({ status: null, latencyMs: 0, error: 'SUPABASE_URL not configured' }),
    timedFetch(`${SELF_BASE_URL}/api/ivx/autonomous/ledger`),
    timedFetch(`${SELF_BASE_URL}/api/ivx/owner-passwordless-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }),
  ]);

  return [
    {
      id: 'api_health',
      name: 'Production API health',
      target: `${SELF_BASE_URL}/health`,
      ok: health.status === 200,
      httpStatus: health.status,
      latencyMs: health.latencyMs,
      detail: health.error ?? (health.status === 200 ? 'healthy' : `unexpected HTTP ${health.status}`),
      checkedAt,
    },
    {
      id: 'supabase_auth',
      name: 'Supabase auth service',
      target: supabaseUrl ? `${supabaseUrl.replace(/\/+$/, '')}/auth/v1/health` : 'unconfigured',
      ok: supabaseAuth.status === 200,
      httpStatus: supabaseAuth.status,
      latencyMs: supabaseAuth.latencyMs,
      detail: supabaseAuth.error ?? (supabaseAuth.status === 200 ? 'GoTrue healthy' : `unexpected HTTP ${supabaseAuth.status}`),
      checkedAt,
    },
    {
      id: 'protected_route_guard',
      name: 'Protected route rejects anonymous',
      target: 'GET /api/ivx/autonomous/ledger (no token)',
      ok: ledgerGuard.status === 401 || ledgerGuard.status === 403,
      httpStatus: ledgerGuard.status,
      latencyMs: ledgerGuard.latencyMs,
      detail: ledgerGuard.error ?? (ledgerGuard.status === 401 || ledgerGuard.status === 403
        ? `guard active (HTTP ${ledgerGuard.status})`
        : `SECURITY: expected 401/403, got HTTP ${ledgerGuard.status}`),
      checkedAt,
    },
    {
      id: 'owner_login_route',
      name: 'Owner login route reachable',
      target: 'POST /api/ivx/owner-passwordless-login (empty body)',
      ok: loginRoute.status !== null && loginRoute.status >= 400 && loginRoute.status < 500,
      httpStatus: loginRoute.status,
      latencyMs: loginRoute.latencyMs,
      detail: loginRoute.error ?? (loginRoute.status !== null && loginRoute.status >= 400 && loginRoute.status < 500
        ? `route live, rejects invalid input (HTTP ${loginRoute.status})`
        : `unexpected HTTP ${loginRoute.status}`),
      checkedAt,
    },
  ];
}

/** Reconcile probe results against open incidents (auto open/close). Returns incidents newly opened this run. */
export function reconcileIncidents(state: GuardianState, probes: ProbeResult[]): GuardianIncident[] {
  const newlyOpened: GuardianIncident[] = [];
  const at = nowIso();
  for (const probe of probes) {
    const open = state.incidents.find((i) => i.probeId === probe.id && i.status === 'OPEN');
    if (!probe.ok && !open) {
      state.incidentCounter += 1;
      const incident: GuardianIncident = {
        incidentId: `INC-${String(state.incidentCounter).padStart(4, '0')}`,
        probeId: probe.id,
        openedAt: at,
        closedAt: null,
        status: 'OPEN',
        detail: `${probe.name}: ${probe.detail}`,
      };
      state.incidents.unshift(incident);
      newlyOpened.push(incident);
    } else if (probe.ok && open) {
      open.status = 'CLOSED';
      open.closedAt = at;
      open.detail = `${open.detail} — recovered: ${probe.detail}`;
    }
  }
  state.incidents = state.incidents.slice(0, MAX_INCIDENTS);
  return newlyOpened;
}

/** SMS provider runtime verification — booleans only, no secret values. */
export function smsProviderStatus(): Record<string, unknown> {
  const awsCredentials = Boolean(readEnv('AWS_ACCESS_KEY_ID') && readEnv('AWS_SECRET_ACCESS_KEY'));
  const phone = resolveAlertPhone();
  return {
    provider: 'aws_sns',
    transportFile: 'backend/services/ivx-sns-sms.ts',
    awsCredentialsConfigured: awsCredentials,
    awsRegion: readEnv('AWS_REGION') || 'us-east-1',
    ownerPhoneResolved: Boolean(phone),
    ownerPhoneMasked: phone ? maskPhone(phone) : null,
    phoneSource: readEnv('IVX_OWNER_RECOVERY_PHONE') ? 'IVX_OWNER_RECOVERY_PHONE env' : 'mandate fallback',
    ready: awsCredentials && Boolean(phone),
    secretValuesReturned: false,
  };
}

export function ownerAuthGuardianOptions(): Response {
  return ownerOnlyOptions();
}

/** GET /api/ivx/autonomous/auth-guardian — owner-only guardian state. */
export async function handleOwnerAuthGuardianGet(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
  } catch (error) {
    return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'owner authentication required' }, 401);
  }
  try {
    const state = await readDurableJson<GuardianState>(GUARDIAN_STATE_FILE, EMPTY_STATE);
    const probes = await runAuthProbes();
    reconcileIncidents(state, probes);
    state.lastRunAt = nowIso();
    state.totalRuns += 1;
    await writeDurableJson(GUARDIAN_STATE_FILE, state);

    const openIncidents = state.incidents.filter((i) => i.status === 'OPEN');
    return ownerOnlyJson({
      ok: true,
      marker: GUARDIAN_MARKER,
      guardian: 'IVX OWNER AUTH GUARDIAN',
      generatedAt: state.lastRunAt,
      totalRuns: state.totalRuns,
      overall: openIncidents.length === 0 && probes.every((p) => p.ok) ? 'HEALTHY' : 'DEGRADED',
      probes,
      openIncidents,
      recentIncidents: state.incidents.slice(0, 10),
      authMap: AUTH_MAP,
      smsProvider: smsProviderStatus(),
      recentAlerts: state.alerts.slice(0, 10),
    });
  } catch (error) {
    return ownerOnlyJson({ ok: false, marker: GUARDIAN_MARKER, error: error instanceof Error ? error.message : 'guardian run failed' }, 500);
  }
}

/**
 * POST /api/ivx/autonomous/auth-guardian/alert — owner-only SMS alert.
 * Body: { severity, incident, area, problem, ownerAction, status, test? }
 * Sends the mandated IVX ALERT format via AWS SNS; logs MessageId. Never
 * includes passwords, tokens, secrets or recovery links.
 */
export async function handleOwnerAuthGuardianAlert(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
  } catch (error) {
    return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'owner authentication required' }, 401);
  }
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const field = (key: string, fallback: string): string => {
      const value = body[key];
      return typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : fallback;
    };
    const isTest = body.test === true;
    const severity = field('severity', isTest ? 'TEST' : 'INFO');
    const incident = field('incident', 'N/A');
    const area = field('area', 'Platform');
    const problem = field('problem', isTest ? 'SMS delivery verification' : 'Unspecified');
    const ownerAction = field('ownerAction', isTest ? 'None — test message' : 'Review dashboard');
    const alertStatus = field('status', 'OPEN');

    const message = [
      'IVX ALERT',
      `Severity: ${severity}`,
      `Incident: ${incident}`,
      `Area: ${area}`,
      `Problem: ${problem}`,
      `Owner Action: ${ownerAction}`,
      'Dashboard URL: https://ivxholding.com',
      `Status: ${alertStatus}`,
    ].join('\n');

    const to = resolveAlertPhone();
    const result = await sendSnsSms({ to, message, senderId: 'IVXOwner' });

    const state = await readDurableJson<GuardianState>(GUARDIAN_STATE_FILE, EMPTY_STATE);
    state.alertCounter += 1;
    const entry: AlertLogEntry = {
      alertId: `ALERT-${String(state.alertCounter).padStart(4, '0')}`,
      severity,
      area,
      problem,
      smsStatus: result.status,
      messageId: result.messageId ?? null,
      httpStatus: result.httpStatus ?? null,
      toMasked: maskPhone(to),
      sentAt: result.sentAt,
      test: isTest,
    };
    state.alerts.unshift(entry);
    state.alerts = state.alerts.slice(0, MAX_ALERT_LOG);
    await writeDurableJson(GUARDIAN_STATE_FILE, state);

    if (!result.ok) {
      return ownerOnlyJson({
        ok: false,
        marker: GUARDIAN_MARKER,
        alert: entry,
        provider: 'aws_sns',
        variableChecked: result.missingEnvNames.length > 0 ? result.missingEnvNames : ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION'],
        httpStatus: result.httpStatus ?? null,
        errorCode: result.status,
        safeError: (result.error ?? 'SNS send failed').slice(0, 300),
        requiredCorrection: result.status === 'missing_config'
          ? 'Set the missing AWS env vars on Render (values never printed).'
          : 'Check AWS SNS SMS sandbox/spend limits for the account and region.',
      }, 502);
    }
    return ownerOnlyJson({ ok: true, marker: GUARDIAN_MARKER, alert: entry, messageId: result.messageId, deliveryAccepted: true });
  } catch (error) {
    return ownerOnlyJson({ ok: false, marker: GUARDIAN_MARKER, error: error instanceof Error ? error.message : 'alert send failed' }, 500);
  }
}