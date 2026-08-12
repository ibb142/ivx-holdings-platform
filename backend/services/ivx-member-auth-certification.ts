import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { orchestrateRegistration } from './ivx-registration-orchestrator';
import { calculateFinancialSummary, determineTier } from './ivx-member-classification';
import { isDurableStoreConfigured, readDurableJson, writeDurableJson } from './ivx-durable-store';

export const IVX_MEMBER_AUTH_CERT_MARKER = 'ivx-member-auth-cert-v1-2026-08-12';
const STATE_KEY = 'logs/audit/member-auth-certification/latest.json';
const INTERVAL_MS = 6 * 60 * 60 * 1000;

type Check = { ok: boolean; detail: string };
export type MemberAuthCertification = {
  marker: string;
  startedAt: string;
  completedAt: string;
  commit: string | null;
  checks: {
    runtimeConfig: Check;
    ownerLogin: Check;
    memberRegistration: Check;
    memberLogin: Check;
    memberPersistence: Check;
    regularClassification: Check;
    vipClassification: Check;
    cleanup: Check;
  };
  certified: boolean;
  secretValuesReturned: false;
};

let inFlight: Promise<MemberAuthCertification> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function env(...names: string[]): string {
  for (const name of names) {
    const value = (process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

function adminClient() {
  const url = env('SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_URL');
  const service = env('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY');
  return createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Retry transient Supabase 5xx/timeout errors with exponential backoff. */
async function retryTransient<T>(fn: () => Promise<T>, maxAttempts = 4, baseMs = 3000): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const msg = error instanceof Error ? error.message : String(error);
      const isTransient = /5\d\d|522|timeout|timed out|ECONNREFUSED|fetch failed|HTTP 000/i.test(msg);
      if (!isTransient || attempt === maxAttempts) throw error;
      const delay = baseMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 800);
      console.warn(`[MemberAuthCert] Retry ${attempt}/${maxAttempts} after ${delay}ms: ${msg.slice(0, 140)}`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('retry exhausted');
}

async function passwordGrant(email: string, password: string): Promise<{ ok: boolean; status: number }> {
  const url = env('SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_URL').replace(/\/+$/, '');
  const anon = env('SUPABASE_ANON_KEY', 'EXPO_PUBLIC_SUPABASE_ANON_KEY');
  if (!url || !anon || !email || !password) return { ok: false, status: 0 };
  try {
    return await retryTransient(async () => {
      const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(20_000),
      });
      // 5xx = Supabase/Cloudflare transient — throw to trigger retry
      if (response.status >= 500) {
        throw new Error(`Supabase auth returned HTTP ${response.status}`);
      }
      return { ok: response.ok, status: response.status };
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'password grant failed';
    return { ok: false, status: 0, detail: msg.slice(0, 200) } as { ok: boolean; status: number; detail?: string };
  }
}

async function cleanupSynthetic(authUserId: string | null, memberId: string | null): Promise<Check> {
  if (!authUserId) return { ok: true, detail: 'No synthetic auth user created.' };
  const sb = adminClient();
  const errors: string[] = [];
  const del = async (table: string, column: string, value: string | null) => {
    if (!value) return;
    try {
      const { error } = await sb.from(table).delete().eq(column, value);
      if (error) errors.push(`${table}:${error.message}`);
    } catch (error) {
      errors.push(`${table}:${error instanceof Error ? error.message : 'delete failed'}`);
    }
  };
  await del('classification_audit', 'member_id', memberId);
  await del('member_financial_summary', 'member_id', memberId);
  await del('investor_profiles', 'member_id', memberId);
  await del('transactions', 'member_id', memberId);
  await del('landing_investments', 'investor_id', authUserId);
  await del('investors', 'user_id', authUserId);
  await del('buyers', 'id', authUserId);
  for (const table of ['jv_partners', 'brokers', 'agents', 'land_owners', 'tokenized_investors']) {
    await del(table, 'auth_user_id', authUserId);
  }
  await del('members', 'auth_user_id', authUserId);
  try {
    const { error } = await sb.auth.admin.deleteUser(authUserId);
    if (error) errors.push(`auth:${error.message}`);
  } catch (error) {
    errors.push(`auth:${error instanceof Error ? error.message : 'delete failed'}`);
  }
  return { ok: errors.length === 0, detail: errors.length === 0 ? 'Synthetic registration removed.' : errors.join('; ').slice(0, 500) };
}

export async function runMemberAuthCertification(): Promise<MemberAuthCertification> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const startedAt = new Date().toISOString();
    const commit = env('RENDER_GIT_COMMIT', 'GIT_COMMIT_SHA', 'SOURCE_VERSION') || null;
    const checks: MemberAuthCertification['checks'] = {
      runtimeConfig: { ok: false, detail: 'Not run' }, ownerLogin: { ok: false, detail: 'Not run' },
      memberRegistration: { ok: false, detail: 'Not run' }, memberLogin: { ok: false, detail: 'Not run' },
      memberPersistence: { ok: false, detail: 'Not run' }, regularClassification: { ok: false, detail: 'Not run' },
      vipClassification: { ok: false, detail: 'Not run' }, cleanup: { ok: false, detail: 'Not run' },
    };
    const supabaseUrl = env('SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_URL');
    const service = env('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY');
    const anon = env('SUPABASE_ANON_KEY', 'EXPO_PUBLIC_SUPABASE_ANON_KEY');
    const ownerEmail = env('IVX_OWNER_EMAIL').toLowerCase();
    const ownerPassword = env('IVX_OWNER_PASSWORD');
    checks.runtimeConfig = {
      ok: Boolean(supabaseUrl && service && anon && ownerEmail && ownerPassword),
      detail: `supabase=${Boolean(supabaseUrl)} serviceRole=${Boolean(service)} anon=${Boolean(anon)} ownerCredentials=${Boolean(ownerEmail && ownerPassword)}`,
    };

    let authUserId: string | null = null;
    let memberId: string | null = null;
    try {
      // Pre-flight: verify Supabase is reachable before running 8 checks.
      // If Supabase is down (522/timeout), fail fast with a clear message instead of 8 cascading failures.
      const preFlightUrl = supabaseUrl.replace(/\/+$/, '');
      try {
        const pfResponse = await retryTransient(async () => {
          const res = await fetch(`${preFlightUrl}/auth/v1/health`, {
            headers: { apikey: anon },
            signal: AbortSignal.timeout(15_000),
          });
          if (res.status >= 500) throw new Error(`Supabase auth health HTTP ${res.status}`);
          return res;
        }, 3, 5000);
        if (!pfResponse.ok) {
          throw new Error(`Supabase pre-flight check failed: HTTP ${pfResponse.status}`);
        }
        console.log('[MemberAuthCert] Pre-flight: Supabase reachable');
      } catch (pfError) {
        const msg = pfError instanceof Error ? pfError.message : 'pre-flight failed';
        console.warn('[MemberAuthCert] Pre-flight FAILED, proceeding anyway:', msg.slice(0, 120));
      }

      const owner = await passwordGrant(ownerEmail, ownerPassword);
      const ownerDetail = 'detail' in owner ? (owner as { detail?: string }).detail : '';
      checks.ownerLogin = { ok: owner.ok, detail: ownerDetail ? `HTTP ${owner.status} — ${ownerDetail}` : `Supabase password grant HTTP ${owner.status}` };

      const qaId = randomUUID();
      const email = `ivx.qa.${Date.now()}.${qaId.slice(0, 8)}@ivxholding.com`;
      const password = `IvxQA!${qaId}Aa9`;
      const registration = await retryTransient(async () => orchestrateRegistration({
        registrationRequestId: `cert-${qaId}`,
        email,
        password,
        firstName: 'IVX',
        lastName: 'Certification',
        phone: '+15555550199',
        country: 'United States',
        zipCode: '33101',
        roles: ['investor'],
        acceptTerms: true,
      }), 3, 4000);
      checks.memberRegistration = { ok: registration.ok && registration.stage === 'COMPLETED', detail: registration.ok ? `${registration.stage} trace=${registration.traceId}` : `${registration.code} stage=${registration.stage}` };
      if (registration.ok) authUserId = registration.authUserId;

      const login = await passwordGrant(email, password);
      const loginDetail = 'detail' in login ? (login as { detail?: string }).detail : '';
      checks.memberLogin = { ok: login.ok, detail: loginDetail ? `HTTP ${login.status} — ${loginDetail}` : `Synthetic member password grant HTTP ${login.status}` };

      if (authUserId) {
        const sb = adminClient();
        const { data: member, error } = await retryTransient(async () =>
          sb.from('members').select('member_id,registration_status,email').eq('auth_user_id', authUserId!).maybeSingle(),
        3, 3000);
        memberId = member?.member_id || null;
        checks.memberPersistence = { ok: Boolean(memberId && !error), detail: memberId ? `Canonical member persisted; registration_status=${member?.registration_status || 'unknown'}` : `Member row missing${error ? `: ${error.message}` : ''}` };
      }

      const baseMember = {
        member_id: 'runtime-cert', auth_user_id: authUserId, email, email_verified: true, email_verified_at: startedAt,
        sms_verified: true, phone_verified_at: startedAt, member_tier: null, investor_status: null,
        kyc_status: 'approved', identity_status: 'active', registration_status: 'completed',
      } as const;
      const profile = { member_id: 'runtime-cert', kyc_status: 'approved', tax_status: 'completed', compliance_status: 'approved', investor_agreement_at: startedAt, approved_at: startedAt, restricted_at: null };
      const regularSummary = calculateFinancialSummary('runtime-cert', []);
      const regular = determineTier(baseMember, profile, regularSummary);
      checks.regularClassification = { ok: regular.tier === 'REGULAR', detail: `Runtime engine tier=${regular.tier}` };
      const vipSummary = calculateFinancialSummary('runtime-cert', [{ id: 'runtime-cert-txn', member_id: 'runtime-cert', amount: 50_000_000, status: 'completed', refunded_amount: 0, settled_at: startedAt, is_test: false, external_reference: 'runtime-cert', source: 'certification' }]);
      const vip = determineTier(baseMember, profile, vipSummary);
      checks.vipClassification = { ok: vip.tier === 'VIP' && vip.investorStatus === 'ACTIVE', detail: `Runtime engine tier=${vip.tier} qualifying=${vipSummary.qualifying_invested_capital}` };
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'certification exception';
      for (const check of Object.values(checks)) if (check.detail === 'Not run') check.detail = detail.slice(0, 500);
    } finally {
      checks.cleanup = await cleanupSynthetic(authUserId, memberId);
    }

    const certified = Object.values(checks).every((check) => check.ok);
    const result: MemberAuthCertification = { marker: IVX_MEMBER_AUTH_CERT_MARKER, startedAt, completedAt: new Date().toISOString(), commit, checks, certified, secretValuesReturned: false };
    // Persist to durable store — non-fatal if Supabase is unavailable.
    // The certification result is still returned to the caller even if persistence fails.
    if (isDurableStoreConfigured()) {
      try { await writeDurableJson(STATE_KEY, result); }
      catch (persistError) {
        console.warn('[MemberAuthCert] Durable store write failed (non-fatal):', persistError instanceof Error ? persistError.message.slice(0, 120) : persistError);
      }
    }
    return result;
  })();
  try { return await inFlight; } finally { inFlight = null; }
}

export async function getLatestMemberAuthCertification(): Promise<MemberAuthCertification | null> {
  if (!isDurableStoreConfigured()) return null;
  try {
    return await readDurableJson<MemberAuthCertification | null>(STATE_KEY, null);
  } catch (error) {
    console.warn('[MemberAuthCert] Durable store read failed:', error instanceof Error ? error.message.slice(0, 120) : error);
    return null;
  }
}

export function startMemberAuthCertificationScheduler(): void {
  if (timer) return;
  const boot = setTimeout(() => { void runMemberAuthCertification().catch((error) => console.error('[MemberAuthCert] boot failed', error instanceof Error ? error.message : error)); }, 45_000);
  boot.unref?.();
  timer = setInterval(() => { void runMemberAuthCertification().catch((error) => console.error('[MemberAuthCert] interval failed', error instanceof Error ? error.message : error)); }, INTERVAL_MS);
  timer.unref?.();
}
