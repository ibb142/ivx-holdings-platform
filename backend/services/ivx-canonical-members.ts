/**
 * IVX Canonical Members Sync
 *
 * One canonical member row in public.members for every landing registration,
 * regardless of which capture path it arrived through:
 *   - /api/members/register            (landing free-member signup → auth.users + profiles)
 *   - /api/ivx/leads/capture           (waitlist / zone capture / funnel mirror → durable lead store)
 *   - waitlist table inserts           (expo app + legacy landing waitlist)
 *   - member-investor durable store    (onboarding fanout records)
 *   - fallback member store            (Supabase email-rate-limit fallback)
 *
 * Dedupe order: auth_user_id → landing_submission_id → email (lower) → phone digits.
 * Reads/writes via Supabase REST with the service-role key. Never fabricates data.
 */

const DEPLOYMENT_MARKER = 'ivx-canonical-members-v1';

export interface CanonicalMemberInput {
  fullName?: string;
  email?: string;
  phone?: string;
  memberType?: string;
  source?: string;
  sourceDetail?: string;
  verificationStatus?: string;
  smsVerified?: boolean;
  emailVerified?: boolean;
  investorInterest?: string;
  preferredZipcode?: string;
  budgetRange?: string;
  authUserId?: string;
  landingSubmissionId?: string;
  pictureUrl?: string;
  createdAt?: string;
  // --- Canonical identity model fields (ITEM 1) ---
  enterpriseId?: string;
  countryCode?: string;
  primaryRole?: string;
  secondaryRoles?: string[];
  registrationType?: 'individual' | 'enterprise';
  registrationStatus?: 'pending' | 'completed' | 'failed';
  emailVerifiedAt?: string;
  phoneVerifiedAt?: string;
  identityStatus?: 'active' | 'suspended' | 'pending_verification';
  kycStatus?: 'not_started' | 'pending' | 'in_review' | 'approved' | 'rejected';
  amlStatus?: 'not_started' | 'pending' | 'in_review' | 'approved' | 'rejected';
  ownerReviewStatus?: 'not_started' | 'pending' | 'approved' | 'rejected';
  sourceChannel?: string;
  dataOrigin?: string;
  termsVersion?: string;
  privacyVersion?: string;
  termsAcceptedAt?: string;
  auditTraceId?: string;
}

export interface CanonicalMemberRow {
  member_id: string;
  full_name: string;
  email: string;
  phone: string;
  member_type: string;
  source: string;
  source_detail: string;
  verification_status: string;
  sms_verified: boolean;
  email_verified: boolean;
  investor_interest: string;
  preferred_zipcode: string;
  budget_range: string;
  picture_url: string;
  auth_user_id: string | null;
  landing_submission_id: string | null;
  created_at: string;
  updated_at: string;
  // --- Canonical identity model fields (ITEM 1) ---
  normalized_email: string | null;
  enterprise_id: string | null;
  normalized_phone: string | null;
  country_code: string | null;
  primary_role: string | null;
  secondary_roles: string[] | null;
  registration_type: string | null;
  registration_status: string | null;
  email_verified_at: string | null;
  phone_verified_at: string | null;
  identity_status: string | null;
  kyc_status: string | null;
  aml_status: string | null;
  owner_review_status: string | null;
  source_channel: string | null;
  data_origin: string | null;
  terms_version: string | null;
  privacy_version: string | null;
  terms_accepted_at: string | null;
  audit_trace_id: string | null;
}

export interface BackfillResult {
  ok: boolean;
  totalSourceRecords: number;
  alreadySynced: number;
  newlySynced: number;
  duplicatesSkipped: number;
  failed: number;
  failures: { source: string; identifier: string; error: string }[];
  perSource: Record<string, number>;
  membersBefore: number;
  membersAfter: number;
  deploymentMarker: string;
}

function getSupabaseUrl(): string {
  return (process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
}

function getServiceKey(): string {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
    ''
  );
}

export function isCanonicalMembersConfigured(): boolean {
  return Boolean(getSupabaseUrl() && getServiceKey());
}

function headers(prefer?: string): Record<string, string> {
  const key = getServiceKey();
  const h: Record<string, string> = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
  if (prefer) h.Prefer = prefer;
  return h;
}

async function rest<T>(pathName: string, init: RequestInit = {}, prefer?: string): Promise<T> {
  const response = await fetch(`${getSupabaseUrl()}/rest/v1${pathName}`, {
    ...init,
    headers: { ...headers(prefer), ...(init.headers ?? {}) },
  });
  const text = await response.text();
  let payload: unknown = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object'
        ? String((payload as Record<string, unknown>).message ?? (payload as Record<string, unknown>).error ?? `HTTP ${response.status}`)
        : `HTTP ${response.status}`;
    throw new Error(`Supabase members REST ${response.status}: ${message}`);
  }
  return payload as T;
}

function normEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normPhoneDigits(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\D/g, '') : '';
}

function nowIso(): string {
  return new Date().toISOString();
}

const VALID_MEMBER_TYPES = new Set([
  'member', 'investor', 'buyer', 'realtor', 'influencer', 'jv_partner',
  'seller', 'builder', 'developer', 'lender', 'land_owner', 'broker', 'owner',
  'jv_deals', 'tokenized',
]);

function normalizeMemberType(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (VALID_MEMBER_TYPES.has(raw)) return raw === 'broker' ? 'realtor' : raw === 'developer' ? 'builder' : raw;
  return 'member';
}

async function findExisting(input: CanonicalMemberInput): Promise<CanonicalMemberRow | null> {
  const authUserId = (input.authUserId || '').trim();
  if (authUserId) {
    const rows = await rest<CanonicalMemberRow[]>(`/members?auth_user_id=eq.${encodeURIComponent(authUserId)}&limit=1`);
    if (rows.length > 0) return rows[0];
  }
  const landingSubmissionId = (input.landingSubmissionId || '').trim();
  if (landingSubmissionId) {
    const rows = await rest<CanonicalMemberRow[]>(`/members?landing_submission_id=eq.${encodeURIComponent(landingSubmissionId)}&limit=1`);
    if (rows.length > 0) return rows[0];
  }
  const email = normEmail(input.email);
  if (email) {
    const rows = await rest<CanonicalMemberRow[]>(`/members?email=ilike.${encodeURIComponent(email)}&limit=1`);
    if (rows.length > 0) return rows[0];
  }
  const phoneDigits = normPhoneDigits(input.phone);
  if (phoneDigits.length >= 10) {
    const rows = await rest<CanonicalMemberRow[]>(`/members?phone=like.*${encodeURIComponent(phoneDigits.slice(-10))}&limit=1`);
    if (rows.length > 0) return rows[0];
  }
  return null;
}

/**
 * Insert or merge one canonical member. Returns the row plus whether it was
 * created, updated, or skipped (existing row already had all incoming data).
 */
export async function upsertCanonicalMember(
  input: CanonicalMemberInput
): Promise<{ ok: boolean; action: 'created' | 'updated' | 'skipped'; member?: CanonicalMemberRow; error?: string }> {
  if (!isCanonicalMembersConfigured()) {
    return { ok: false, action: 'skipped', error: 'Supabase credentials missing' };
  }
  const email = normEmail(input.email);
  const phone = (input.phone || '').trim();
  if (!email && normPhoneDigits(phone).length < 10 && !(input.authUserId || '').trim()) {
    return { ok: false, action: 'skipped', error: 'No dedupe identity (email/phone/auth user id)' };
  }

  try {
    const existing = await findExisting(input);
    const createdAt = input.createdAt && !Number.isNaN(new Date(input.createdAt).getTime())
      ? new Date(input.createdAt).toISOString()
      : nowIso();

    if (!existing) {
      const inserted = await rest<CanonicalMemberRow[]>(
        '/members',
        {
          method: 'POST',
          body: JSON.stringify({
            full_name: (input.fullName || '').trim(),
            email,
            phone,
            normalized_email: email || null,
            normalized_phone: normPhoneDigits(phone) || null,
            member_type: normalizeMemberType(input.memberType),
            source: (input.source || 'landing_page').trim() || 'landing_page',
            source_detail: (input.sourceDetail || '').trim(),
            verification_status: (input.verificationStatus || 'unverified').trim() || 'unverified',
            sms_verified: Boolean(input.smsVerified),
            email_verified: Boolean(input.emailVerified),
            investor_interest: (input.investorInterest || '').trim(),
            preferred_zipcode: (input.preferredZipcode || '').trim(),
            budget_range: (input.budgetRange || '').trim(),
            picture_url: (input.pictureUrl || '').trim(),
            auth_user_id: (input.authUserId || '').trim() || null,
            landing_submission_id: (input.landingSubmissionId || '').trim() || null,
            // --- Canonical identity model fields (ITEM 1) ---
            enterprise_id: (input.enterpriseId || '').trim() || null,
            country_code: (input.countryCode || '').trim() || null,
            primary_role: (input.primaryRole || '').trim() || null,
            secondary_roles: JSON.stringify(input.secondaryRoles || []),
            registration_type: input.registrationType || 'individual',
            registration_status: input.registrationStatus || 'completed',
            email_verified_at: input.emailVerifiedAt || (input.emailVerified ? createdAt : null),
            phone_verified_at: input.phoneVerifiedAt || (input.smsVerified ? createdAt : null),
            identity_status: input.identityStatus || 'active',
            kyc_status: input.kycStatus || 'not_started',
            aml_status: input.amlStatus || 'not_started',
            owner_review_status: input.ownerReviewStatus || 'not_started',
            source_channel: (input.sourceChannel || input.source || 'landing_page').trim() || 'landing_page',
            data_origin: (input.dataOrigin || 'landing_page').trim() || 'landing_page',
            terms_version: (input.termsVersion || '').trim() || null,
            privacy_version: (input.privacyVersion || '').trim() || null,
            terms_accepted_at: input.termsAcceptedAt || null,
            audit_trace_id: (input.auditTraceId || '').trim() || null,
            created_at: createdAt,
            updated_at: nowIso(),
          }),
        },
        'return=representation'
      );
      return { ok: true, action: 'created', member: inserted[0] };
    }

    // Merge: only fill blanks / upgrade flags; never blank out real data.
    const patch: Record<string, unknown> = {};
    if (!existing.full_name && (input.fullName || '').trim()) patch.full_name = (input.fullName || '').trim();
    if (!existing.email && email) patch.email = email;
    if (!existing.phone && phone) patch.phone = phone;
    if (existing.member_type === 'member' && normalizeMemberType(input.memberType) !== 'member') {
      patch.member_type = normalizeMemberType(input.memberType);
    }
    if (!existing.source_detail && (input.sourceDetail || '').trim()) patch.source_detail = (input.sourceDetail || '').trim();
    if (!existing.investor_interest && (input.investorInterest || '').trim()) patch.investor_interest = (input.investorInterest || '').trim();
    if (!existing.preferred_zipcode && (input.preferredZipcode || '').trim()) patch.preferred_zipcode = (input.preferredZipcode || '').trim();
    if (!existing.budget_range && (input.budgetRange || '').trim()) patch.budget_range = (input.budgetRange || '').trim();
    if (!existing.picture_url && (input.pictureUrl || '').trim()) patch.picture_url = (input.pictureUrl || '').trim();
    if (!existing.auth_user_id && (input.authUserId || '').trim()) patch.auth_user_id = (input.authUserId || '').trim();
    if (!existing.landing_submission_id && (input.landingSubmissionId || '').trim()) patch.landing_submission_id = (input.landingSubmissionId || '').trim();
    if (input.smsVerified === true && !existing.sms_verified) patch.sms_verified = true;
    if (input.emailVerified === true && !existing.email_verified) patch.email_verified = true;
    if (input.verificationStatus && input.verificationStatus !== 'unverified' && existing.verification_status === 'unverified') {
      patch.verification_status = input.verificationStatus;
    }
    // --- Canonical identity model merges (ITEM 1) ---
    if (!existing.normalized_email && email) patch.normalized_email = email;
    if (!existing.normalized_phone && normPhoneDigits(phone)) patch.normalized_phone = normPhoneDigits(phone);
    if (!existing.enterprise_id && (input.enterpriseId || '').trim()) patch.enterprise_id = (input.enterpriseId || '').trim();
    if (!existing.country_code && (input.countryCode || '').trim()) patch.country_code = (input.countryCode || '').trim();
    if (!existing.primary_role && (input.primaryRole || '').trim()) patch.primary_role = (input.primaryRole || '').trim();
    if (input.secondaryRoles && input.secondaryRoles.length > 0 && (!existing.secondary_roles || (Array.isArray(existing.secondary_roles) && existing.secondary_roles.length === 0))) {
      patch.secondary_roles = JSON.stringify(input.secondaryRoles);
    }
    if (input.registrationType && existing.registration_type !== input.registrationType) {
      patch.registration_type = input.registrationType;
    }
    if (input.registrationStatus && existing.registration_status !== input.registrationStatus && input.registrationStatus === 'completed') {
      patch.registration_status = input.registrationStatus;
    }
    if (input.emailVerifiedAt && !existing.email_verified_at) patch.email_verified_at = input.emailVerifiedAt;
    if (input.phoneVerifiedAt && !existing.phone_verified_at) patch.phone_verified_at = input.phoneVerifiedAt;
    if (input.identityStatus && existing.identity_status !== input.identityStatus && input.identityStatus === 'active') {
      patch.identity_status = input.identityStatus;
    }
    if (input.kycStatus && existing.kyc_status === 'not_started' && input.kycStatus !== 'not_started') {
      patch.kyc_status = input.kycStatus;
    }
    if (input.amlStatus && existing.aml_status === 'not_started' && input.amlStatus !== 'not_started') {
      patch.aml_status = input.amlStatus;
    }
    if (input.ownerReviewStatus && existing.owner_review_status === 'not_started' && input.ownerReviewStatus !== 'not_started') {
      patch.owner_review_status = input.ownerReviewStatus;
    }
    if (!existing.source_channel && (input.sourceChannel || input.source || '').trim()) {
      patch.source_channel = (input.sourceChannel || input.source || '').trim();
    }
    if (!existing.data_origin && (input.dataOrigin || '').trim()) patch.data_origin = (input.dataOrigin || '').trim();
    if (!existing.terms_version && (input.termsVersion || '').trim()) patch.terms_version = (input.termsVersion || '').trim();
    if (!existing.privacy_version && (input.privacyVersion || '').trim()) patch.privacy_version = (input.privacyVersion || '').trim();
    if (!existing.terms_accepted_at && input.termsAcceptedAt) patch.terms_accepted_at = input.termsAcceptedAt;
    if (!existing.audit_trace_id && (input.auditTraceId || '').trim()) patch.audit_trace_id = (input.auditTraceId || '').trim();
    const existingCreated = new Date(existing.created_at).getTime();
    if (new Date(createdAt).getTime() < existingCreated) patch.created_at = createdAt;

    if (Object.keys(patch).length === 0) {
      return { ok: true, action: 'skipped', member: existing };
    }
    patch.updated_at = nowIso();
    const updated = await rest<CanonicalMemberRow[]>(
      `/members?member_id=eq.${encodeURIComponent(existing.member_id)}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
      'return=representation'
    );
    return { ok: true, action: 'updated', member: updated[0] ?? existing };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error('[CanonicalMembers] Upsert failed:', message);
    return { ok: false, action: 'skipped', error: message };
  }
}

/** Mark verification flags on the canonical row for an auth user or email. */
export async function markCanonicalMemberVerified(
  identity: { authUserId?: string; email?: string },
  flags: { smsVerified?: boolean; emailVerified?: boolean }
): Promise<void> {
  if (!isCanonicalMembersConfigured()) return;
  try {
    const existing = await findExisting({ authUserId: identity.authUserId, email: identity.email });
    if (!existing) return;
    const patch: Record<string, unknown> = { updated_at: nowIso() };
    if (flags.smsVerified) patch.sms_verified = true;
    if (flags.emailVerified) patch.email_verified = true;
    const smsOk = flags.smsVerified || existing.sms_verified;
    const emailOk = flags.emailVerified || existing.email_verified;
    patch.verification_status = smsOk && emailOk ? 'verified' : (smsOk || emailOk ? 'partially_verified' : existing.verification_status);
    await rest(`/members?member_id=eq.${encodeURIComponent(existing.member_id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }, 'return=minimal');
  } catch (error) {
    console.error('[CanonicalMembers] Verify flag update failed:', error instanceof Error ? error.message : error);
  }
}

export interface ListMembersOptions {
  search?: string;
  memberType?: string;
  verified?: 'verified' | 'unverified' | 'sms_verified' | 'all';
  limit?: number;
}

export async function listCanonicalMembers(options: ListMembersOptions = {}): Promise<CanonicalMemberRow[]> {
  if (!isCanonicalMembersConfigured()) return [];
  const limit = Math.min(Math.max(options.limit ?? 1000, 1), 2000);
  let query = `/members?select=*&order=created_at.desc&limit=${limit}`;
  const type = normalizeMemberType(options.memberType);
  if (options.memberType && options.memberType !== 'all') query += `&member_type=eq.${encodeURIComponent(type)}`;
  if (options.verified === 'verified') query += `&verification_status=eq.verified`;
  if (options.verified === 'unverified') query += `&verification_status=eq.unverified`;
  if (options.verified === 'sms_verified') query += `&sms_verified=is.true`;
  const search = (options.search || '').trim();
  if (search) {
    const term = encodeURIComponent(`%${search}%`);
    query += `&or=(full_name.ilike.${term},email.ilike.${term},phone.ilike.${term})`;
  }
  try {
    return await rest<CanonicalMemberRow[]>(query);
  } catch (error) {
    console.error('[CanonicalMembers] List failed:', error instanceof Error ? error.message : error);
    return [];
  }
}

export async function countCanonicalMembers(): Promise<number> {
  if (!isCanonicalMembersConfigured()) return 0;
  try {
    const response = await fetch(`${getSupabaseUrl()}/rest/v1/members?select=member_id`, {
      method: 'HEAD',
      headers: { ...headers('count=exact'), Range: '0-0' },
    });
    const range = response.headers.get('content-range') || '';
    const total = range.split('/')[1];
    return total && total !== '*' ? Number(total) : 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Backfill
// ---------------------------------------------------------------------------

interface SourceRecord {
  source: string;
  identifier: string;
  input: CanonicalMemberInput;
}

async function collectAuthUsers(records: SourceRecord[]): Promise<void> {
  const response = await fetch(`${getSupabaseUrl()}/auth/v1/admin/users?per_page=200`, { headers: headers() });
  if (!response.ok) throw new Error(`auth admin users HTTP ${response.status}`);
  const payload = (await response.json()) as { users?: Record<string, unknown>[] } | Record<string, unknown>[];
  const users = Array.isArray(payload) ? payload : payload.users ?? [];
  for (const user of users) {
    const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
    const appMeta = (user.app_metadata ?? {}) as Record<string, unknown>;
    const email = normEmail(user.email);
    const fullName = [meta.first_name, meta.last_name].map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean).join(' ');
    const roleInterests = Array.isArray(meta.role_interests) ? meta.role_interests.map(String) : [];
    records.push({
      source: 'auth.users',
      identifier: email || String(user.id),
      input: {
        fullName,
        email,
        phone: typeof meta.phone === 'string' ? meta.phone : (typeof user.phone === 'string' ? user.phone : ''),
        memberType: typeof appMeta.role === 'string' && appMeta.role === 'owner' ? 'owner' : (roleInterests[0] || 'member'),
        source: 'landing_page',
        sourceDetail: 'auth.users backfill',
        emailVerified: Boolean(user.email_confirmed_at),
        smsVerified: Boolean(user.phone_confirmed_at),
        verificationStatus: user.email_confirmed_at ? 'partially_verified' : 'unverified',
        investorInterest: roleInterests.join(', '),
        preferredZipcode: typeof meta.zip_code === 'string' ? meta.zip_code : '',
        authUserId: String(user.id),
        createdAt: typeof user.created_at === 'string' ? user.created_at : undefined,
      },
    });
  }
}

async function collectProfiles(records: SourceRecord[]): Promise<void> {
  const rows = await rest<Record<string, unknown>[]>('/profiles?select=*&limit=1000');
  for (const row of rows) {
    const email = normEmail(row.email);
    records.push({
      source: 'profiles',
      identifier: email || String(row.id),
      input: {
        fullName: [row.first_name, row.last_name].map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean).join(' '),
        email,
        phone: typeof row.phone === 'string' ? row.phone : '',
        memberType: typeof row.role === 'string' ? row.role : 'member',
        source: 'landing_page',
        sourceDetail: 'profiles backfill',
        authUserId: typeof row.id === 'string' && /^[0-9a-f-]{36}$/i.test(row.id) ? row.id : undefined,
        createdAt: typeof row.created_at === 'string' ? row.created_at : undefined,
      },
    });
  }
}

async function collectWaitlist(records: SourceRecord[]): Promise<void> {
  const rows = await rest<Record<string, unknown>[]>('/waitlist?select=*&order=created_at.asc&limit=2000');
  for (const row of rows) {
    const email = normEmail(row.email);
    if (!email) continue;
    records.push({
      source: 'waitlist',
      identifier: email,
      input: {
        fullName: typeof row.name === 'string' ? row.name.trim() : '',
        email,
        memberType: 'member',
        source: 'landing_page',
        sourceDetail: `waitlist${typeof row.source === 'string' && row.source ? `:${row.source}` : ''}`,
        landingSubmissionId: typeof row.id === 'string' ? `waitlist-${row.id}` : undefined,
        createdAt: typeof row.created_at === 'string' ? row.created_at : undefined,
      },
    });
  }
}

async function collectCapturedLeads(records: SourceRecord[]): Promise<void> {
  const { listLeads } = await import('./ivx-lead-capture-store');
  const leads = await listLeads();
  for (const lead of leads) {
    const email = normEmail(lead.email);
    const phoneDigits = normPhoneDigits(lead.phone);
    if (!email && phoneDigits.length < 10) continue;
    records.push({
      source: 'lead_capture',
      identifier: email || lead.phone,
      input: {
        fullName: lead.name,
        email,
        phone: lead.phone,
        memberType: lead.role,
        source: 'landing_page',
        sourceDetail: `lead_capture:${lead.id}${lead.sourceDetail ? ` (${lead.sourceDetail})` : ''}`,
        investorInterest: lead.dealInterest || '',
        budgetRange: lead.budgetRange || '',
        preferredZipcode: lead.preferredMarket || '',
        landingSubmissionId: lead.id,
        createdAt: lead.createdAt,
      },
    });
  }
}

async function collectMemberInvestorStore(records: SourceRecord[]): Promise<void> {
  const { readDurableJson, isDurableStoreConfigured } = await import('./ivx-durable-store');
  if (!isDurableStoreConfigured()) return;
  const path = await import('node:path');
  const file = path.join(process.cwd(), 'logs', 'audit', 'member-investor', 'members.json');
  const members = await readDurableJson<Record<string, unknown>[]>(file, []);
  for (const member of members) {
    const email = normEmail(member.email);
    if (!email) continue;
    const roles = Array.isArray(member.roles) ? member.roles.map(String) : [];
    records.push({
      source: 'member_investor_store',
      identifier: email,
      input: {
        fullName: [member.firstName, member.lastName].map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean).join(' '),
        email,
        phone: typeof member.phone === 'string' ? member.phone : '',
        memberType: roles[0] || 'member',
        source: 'landing_page',
        sourceDetail: 'member_investor_store backfill',
        investorInterest: roles.join(', '),
        preferredZipcode: typeof member.zipCode === 'string' ? member.zipCode : '',
        authUserId: typeof member.userId === 'string' && /^[0-9a-f-]{36}$/i.test(member.userId) ? member.userId : undefined,
        createdAt: typeof member.createdAt === 'string' ? member.createdAt : undefined,
      },
    });
  }
}

async function collectFallbackMembers(records: SourceRecord[]): Promise<void> {
  const { readDurableJson, isDurableStoreConfigured } = await import('./ivx-durable-store');
  if (!isDurableStoreConfigured()) return;
  const path = await import('node:path');
  const file = path.join(process.cwd(), 'logs', 'audit', 'member-database', 'fallback-members.json');
  const store = await readDurableJson<Record<string, Record<string, unknown>>>(file, {});
  for (const member of Object.values(store)) {
    const email = normEmail(member.email);
    if (!email) continue;
    records.push({
      source: 'fallback_member_store',
      identifier: email,
      input: {
        fullName: [member.firstName, member.lastName].map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean).join(' '),
        email,
        phone: typeof member.phone === 'string' ? member.phone : '',
        memberType: 'member',
        source: 'landing_page',
        sourceDetail: 'fallback_member_store backfill',
        emailVerified: Boolean(member.emailVerified),
        smsVerified: Boolean(member.phoneVerified),
        preferredZipcode: typeof member.zipCode === 'string' ? member.zipCode : '',
        createdAt: typeof member.createdAt === 'string' ? member.createdAt : undefined,
      },
    });
  }
}

/** Backfill every known landing registration into public.members (idempotent). */
export async function backfillCanonicalMembers(): Promise<BackfillResult> {
  const failures: BackfillResult['failures'] = [];
  const perSource: Record<string, number> = {};
  const records: SourceRecord[] = [];

  if (!isCanonicalMembersConfigured()) {
    return {
      ok: false, totalSourceRecords: 0, alreadySynced: 0, newlySynced: 0,
      duplicatesSkipped: 0, failed: 1,
      failures: [{ source: 'config', identifier: '-', error: 'Supabase credentials missing' }],
      perSource, membersBefore: 0, membersAfter: 0, deploymentMarker: DEPLOYMENT_MARKER,
    };
  }

  const membersBefore = await countCanonicalMembers();

  const collectors: [string, (r: SourceRecord[]) => Promise<void>][] = [
    ['auth.users', collectAuthUsers],
    ['profiles', collectProfiles],
    ['waitlist', collectWaitlist],
    ['lead_capture', collectCapturedLeads],
    ['member_investor_store', collectMemberInvestorStore],
    ['fallback_member_store', collectFallbackMembers],
  ];
  for (const [name, collect] of collectors) {
    try {
      const before = records.length;
      await collect(records);
      perSource[name] = records.length - before;
    } catch (error) {
      perSource[name] = 0;
      failures.push({ source: name, identifier: '-', error: error instanceof Error ? error.message : 'collect failed' });
    }
  }

  let newlySynced = 0;
  let alreadySynced = 0;
  let duplicatesSkipped = 0;
  let failed = 0;

  for (const record of records) {
    const result = await upsertCanonicalMember(record.input);
    if (!result.ok) {
      failed += 1;
      failures.push({ source: record.source, identifier: record.identifier, error: result.error || 'upsert failed' });
      continue;
    }
    if (result.action === 'created') newlySynced += 1;
    else if (result.action === 'updated') alreadySynced += 1;
    else duplicatesSkipped += 1;
  }

  const membersAfter = await countCanonicalMembers();
  return {
    ok: failed === 0,
    totalSourceRecords: records.length,
    alreadySynced,
    newlySynced,
    duplicatesSkipped,
    failed,
    failures,
    perSource,
    membersBefore,
    membersAfter,
    deploymentMarker: DEPLOYMENT_MARKER,
  };
}