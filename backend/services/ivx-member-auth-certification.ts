import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { orchestrateRegistration } from './ivx-registration-orchestrator';
import { calculateFinancialSummary, determineTier } from './ivx-member-classification';
import { isDurableStoreConfigured, readDurableJson, writeDurableJson } from './ivx-durable-store';
import { getIVXOwnerVariableRuntimeValue } from '../api/ivx-owner-variables';
import { getIVXOwnerEmailAllowlist } from '../../expo/shared/ivx/access-control';

export const IVX_MEMBER_AUTH_CERT_MARKER = 'ivx-member-auth-cert-v4-render-runtime-safe-2026-08-14';
const STATE_KEY = 'logs/audit/member-auth-certification/latest.json';
const INTERVAL_MS = 6 * 60 * 60 * 1000;
const AUTH_TIMEOUT_MS = 10_000;

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

function canonicalSupabaseUrl(): string {
  return (env('EXPO_PUBLIC_SUPABASE_URL', 'SUPABASE_URL')).replace(/\/+$/, '');
}

function canonicalAnonKey(): string {
  return env('EXPO_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY');
}

function ownerEmailFromRuntime(): string {
  const configured = env('IVX_OWNER_EMAIL').toLowerCase();
  if (configured) return configured;
  return (getIVXOwnerEmailAllowlist()[0] || '').toLowerCase();
}

async function ownerPasswordFromRuntime(): Promise<string> {
  try {
    const stored = String(await getIVXOwnerVariableRuntimeValue('OWNER_NEW_PASSWORD', { preferStored: true }) || '').trim();
    if (stored) return stored;
  } catch (error) {
    console.warn('[MemberAuthCert] durable OWNER_NEW_PASSWORD lookup failed:', error instanceof Error ? error.message.slice(0, 140) : 'unknown');
  }
  return env('IVX_OWNER_PASSWORD', 'OWNER_NEW_PASSWORD');
}

function adminClient() {
  const url = canonicalSupabaseUrl();
  const service = env('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY');
  return createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: ((input: RequestInfo | URL, init: RequestInit = {}) =>
        fetch(input, {
          ...init,
          signal: init.signal ?? AbortSignal.timeout(AUTH_TIMEOUT_MS),
        })) as typeof fetch,
    },
  });
}

async function retryTransient<T>(fn: () => Promise<T>, maxAttempts = 3, baseMs = 1000): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const msg = error instanceof Error ? error.message : String(error);
      const isTransient = /5\d\d|522|timeout|timed out|aborted|ECONNREFUSED|fetch failed|HTTP 000/i.test(msg);
      if (!isTransient || attempt === maxAttempts) throw error;
      const delay = baseMs * Math.pow(2, attempt - 1);
      console.warn(`[MemberAuthCert] Retry ${attempt}/${maxAttempts} after ${delay}ms: ${msg.slice(0, 140)}`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('retry exhausted');
}

async function passwordGrant(email: string, password: string): Promise<{ ok: boolean; status: number; detail?: string }> {
  const url = canonicalSupabaseUrl();
  const anon = canonicalAnonKey();
  if (!url || !anon || !email || !password) return { ok: false, status: 0, detail: 'missing canonical auth binding' };
  try {
    return await retryTransient(async () => {
      const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
      });
      if (response.status >= 500) throw new Error(`Supabase auth returned HTTP ${response.status}`);
      const detail = response.ok ? undefined : (await response.text().catch(() => '')).slice(0, 180);
      return { ok: response.ok, status: response.status, detail };
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'password grant failed';
    return { ok: false, status: 0, detail: msg.slice(0, 200) };
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
  for (const table of ['jv_partners', 'brokers', 'agents', 'land_owners', 'tokenized_investors']) await del(table, 'auth_user_id', authUserId);
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
    const supabaseUrl = canonicalSupabaseUrl();
    const service = env('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY');
    const anon = canonicalAnonKey();
    const ownerEmail = ownerEmailFromRuntime();
    const ownerPassword = await ownerPasswordFromRuntime();
    checks.runtimeConfig = {
      ok: Boolean(supabaseUrl && service && anon && ownerEmail && ownerPassword),
      detail: `canonicalSupabase=${Boolean(supabaseUrl)} serviceRole=${Boolean(service)} canonicalAnon=${Boolean(anon)} ownerEmail=${Boolean(ownerEmail)} ownerPasswordBinding=${Boolean(ownerPassword)}`,
    };

    let authUserId: string | null = null;
    let memberId: string | null = null;
    try {
      if (!checks.runtimeConfig.ok) throw new Error(`Runtime auth binding incomplete: ${checks.runtimeConfig.detail}`);

      const pfResponse = await retryTransient(async () => {
        const res = await fetch(`${supabaseUrl}/auth/v1/health`, {
          headers: { apikey: anon },
          signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
        });
        if (res.status >= 500) throw new Error(`Supabase auth health HTTP ${res.status}`);
        return res;
      }, 2, 750);
      if (!pfResponse.ok) throw new Error(`Supabase pre-flight check failed: HTTP ${pfResponse.status}`);

      const owner = await passwordGrant(ownerEmail, ownerPassword);
      checks.ownerLogin = { ok: owner.ok, detail: owner.detail ? `HTTP ${owner.status} — ${owner.detail}` : `Supabase password grant HTTP ${owner.status}` };

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
      }), 2, 1000);
      checks.memberRegistration = { ok: registration.ok && registration.stage === 'COMPLETED', detail: registration.ok ? `${registration.stage} trace=${registration.traceId}` : `${registration.code} stage=${registration.stage}` };
      if (registration.ok) authUserId = registration.authUserId;

      const login = await passwordGrant(email, password);
      checks.memberLogin = { ok: login.ok, detail: login.detail ? `HTTP ${login.status} — ${login.detail}` : `Synthetic member password grant HTTP ${login.status}` };

      if (authUserId) {
        const sb = adminClient();
        const { data: member, error } = await retryTransient(async () => sb.from('members').select('member_id,registration_status,email').eq('auth_user_id', authUserId!).maybeSingle(), 2, 750);
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
    if (isDurableStoreConfigured()) {
      try { await writeDurableJson(STATE_KEY, result); }
      catch (persistError) { console.warn('[MemberAuthCert] Durable store write failed (non-fatal):', persistError instanceof Error ? persistError.message.slice(0, 120) : persistError); }
    }
    return result;
  })();
  try { return await inFlight; } finally { inFlight = null; }
}

export async function getLatestMemberAuthCertification(): Promise<MemberAuthCertification | null> {
  if (!isDurableStoreConfigured()) return null;
  try { return await readDurableJson<MemberAuthCertification | null>(STATE_KEY, null); }
  catch (error) { console.warn('[MemberAuthCert] Durable store read failed:', error instanceof Error ? error.message.slice(0, 120) : error); return null; }
}

export function startMemberAuthCertificationScheduler(): void {
  if (timer) return;
  const boot = setTimeout(() => { void runMemberAuthCertification().catch((error) => console.error('[MemberAuthCert] boot failed', error instanceof Error ? error.message : error)); }, 20_000);
  boot.unref?.();
  timer = setInterval(() => { void runMemberAuthCertification().catch((error) => console.error('[MemberAuthCert] interval failed', error instanceof Error ? error.message : error)); }, INTERVAL_MS);
  timer.unref?.();
}
