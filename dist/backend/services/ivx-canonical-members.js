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
function getSupabaseUrl() {
    return (process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
}
function getServiceKey() {
    return (process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.SUPABASE_SERVICE_KEY ||
        process.env.SUPABASE_ANON_KEY ||
        process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
        '');
}
export function isCanonicalMembersConfigured() {
    return Boolean(getSupabaseUrl() && getServiceKey());
}
function headers(prefer) {
    const key = getServiceKey();
    const h = {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
    };
    if (prefer)
        h.Prefer = prefer;
    return h;
}
async function rest(pathName, init = {}, prefer) {
    const response = await fetch(`${getSupabaseUrl()}/rest/v1${pathName}`, {
        ...init,
        headers: { ...headers(prefer), ...(init.headers ?? {}) },
    });
    const text = await response.text();
    let payload = null;
    try {
        payload = text ? JSON.parse(text) : null;
    }
    catch {
        payload = text;
    }
    if (!response.ok) {
        const message = payload && typeof payload === 'object'
            ? String(payload.message ?? payload.error ?? `HTTP ${response.status}`)
            : `HTTP ${response.status}`;
        throw new Error(`Supabase members REST ${response.status}: ${message}`);
    }
    return payload;
}
function normEmail(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}
function normPhoneDigits(value) {
    return typeof value === 'string' ? value.replace(/\D/g, '') : '';
}
function nowIso() {
    return new Date().toISOString();
}
const VALID_MEMBER_TYPES = new Set([
    'member', 'investor', 'buyer', 'realtor', 'influencer', 'jv_partner',
    'seller', 'builder', 'developer', 'lender', 'land_owner', 'broker', 'owner',
    'jv_deals', 'tokenized',
]);
function normalizeMemberType(value) {
    const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (VALID_MEMBER_TYPES.has(raw))
        return raw === 'broker' ? 'realtor' : raw === 'developer' ? 'builder' : raw;
    return 'member';
}
async function findExisting(input) {
    const authUserId = (input.authUserId || '').trim();
    if (authUserId) {
        const rows = await rest(`/members?auth_user_id=eq.${encodeURIComponent(authUserId)}&limit=1`);
        if (rows.length > 0)
            return rows[0];
    }
    const landingSubmissionId = (input.landingSubmissionId || '').trim();
    if (landingSubmissionId) {
        const rows = await rest(`/members?landing_submission_id=eq.${encodeURIComponent(landingSubmissionId)}&limit=1`);
        if (rows.length > 0)
            return rows[0];
    }
    const email = normEmail(input.email);
    if (email) {
        const rows = await rest(`/members?email=ilike.${encodeURIComponent(email)}&limit=1`);
        if (rows.length > 0)
            return rows[0];
    }
    const phoneDigits = normPhoneDigits(input.phone);
    if (phoneDigits.length >= 10) {
        const rows = await rest(`/members?phone=like.*${encodeURIComponent(phoneDigits.slice(-10))}&limit=1`);
        if (rows.length > 0)
            return rows[0];
    }
    return null;
}
/**
 * Insert or merge one canonical member. Returns the row plus whether it was
 * created, updated, or skipped (existing row already had all incoming data).
 */
export async function upsertCanonicalMember(input) {
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
            const inserted = await rest('/members', {
                method: 'POST',
                body: JSON.stringify({
                    full_name: (input.fullName || '').trim(),
                    email,
                    phone,
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
                    created_at: createdAt,
                    updated_at: nowIso(),
                }),
            }, 'return=representation');
            return { ok: true, action: 'created', member: inserted[0] };
        }
        // Merge: only fill blanks / upgrade flags; never blank out real data.
        const patch = {};
        if (!existing.full_name && (input.fullName || '').trim())
            patch.full_name = (input.fullName || '').trim();
        if (!existing.email && email)
            patch.email = email;
        if (!existing.phone && phone)
            patch.phone = phone;
        if (existing.member_type === 'member' && normalizeMemberType(input.memberType) !== 'member') {
            patch.member_type = normalizeMemberType(input.memberType);
        }
        if (!existing.source_detail && (input.sourceDetail || '').trim())
            patch.source_detail = (input.sourceDetail || '').trim();
        if (!existing.investor_interest && (input.investorInterest || '').trim())
            patch.investor_interest = (input.investorInterest || '').trim();
        if (!existing.preferred_zipcode && (input.preferredZipcode || '').trim())
            patch.preferred_zipcode = (input.preferredZipcode || '').trim();
        if (!existing.budget_range && (input.budgetRange || '').trim())
            patch.budget_range = (input.budgetRange || '').trim();
        if (!existing.picture_url && (input.pictureUrl || '').trim())
            patch.picture_url = (input.pictureUrl || '').trim();
        if (!existing.auth_user_id && (input.authUserId || '').trim())
            patch.auth_user_id = (input.authUserId || '').trim();
        if (!existing.landing_submission_id && (input.landingSubmissionId || '').trim())
            patch.landing_submission_id = (input.landingSubmissionId || '').trim();
        if (input.smsVerified === true && !existing.sms_verified)
            patch.sms_verified = true;
        if (input.emailVerified === true && !existing.email_verified)
            patch.email_verified = true;
        if (input.verificationStatus && input.verificationStatus !== 'unverified' && existing.verification_status === 'unverified') {
            patch.verification_status = input.verificationStatus;
        }
        const existingCreated = new Date(existing.created_at).getTime();
        if (new Date(createdAt).getTime() < existingCreated)
            patch.created_at = createdAt;
        if (Object.keys(patch).length === 0) {
            return { ok: true, action: 'skipped', member: existing };
        }
        patch.updated_at = nowIso();
        const updated = await rest(`/members?member_id=eq.${encodeURIComponent(existing.member_id)}`, { method: 'PATCH', body: JSON.stringify(patch) }, 'return=representation');
        return { ok: true, action: 'updated', member: updated[0] ?? existing };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        console.error('[CanonicalMembers] Upsert failed:', message);
        return { ok: false, action: 'skipped', error: message };
    }
}
/** Mark verification flags on the canonical row for an auth user or email. */
export async function markCanonicalMemberVerified(identity, flags) {
    if (!isCanonicalMembersConfigured())
        return;
    try {
        const existing = await findExisting({ authUserId: identity.authUserId, email: identity.email });
        if (!existing)
            return;
        const patch = { updated_at: nowIso() };
        if (flags.smsVerified)
            patch.sms_verified = true;
        if (flags.emailVerified)
            patch.email_verified = true;
        const smsOk = flags.smsVerified || existing.sms_verified;
        const emailOk = flags.emailVerified || existing.email_verified;
        patch.verification_status = smsOk && emailOk ? 'verified' : (smsOk || emailOk ? 'partially_verified' : existing.verification_status);
        await rest(`/members?member_id=eq.${encodeURIComponent(existing.member_id)}`, {
            method: 'PATCH',
            body: JSON.stringify(patch),
        }, 'return=minimal');
    }
    catch (error) {
        console.error('[CanonicalMembers] Verify flag update failed:', error instanceof Error ? error.message : error);
    }
}
export async function listCanonicalMembers(options = {}) {
    if (!isCanonicalMembersConfigured())
        return [];
    const limit = Math.min(Math.max(options.limit ?? 1000, 1), 2000);
    let query = `/members?select=*&order=created_at.desc&limit=${limit}`;
    const type = normalizeMemberType(options.memberType);
    if (options.memberType && options.memberType !== 'all')
        query += `&member_type=eq.${encodeURIComponent(type)}`;
    if (options.verified === 'verified')
        query += `&verification_status=eq.verified`;
    if (options.verified === 'unverified')
        query += `&verification_status=eq.unverified`;
    if (options.verified === 'sms_verified')
        query += `&sms_verified=is.true`;
    const search = (options.search || '').trim();
    if (search) {
        const term = encodeURIComponent(`%${search}%`);
        query += `&or=(full_name.ilike.${term},email.ilike.${term},phone.ilike.${term})`;
    }
    try {
        return await rest(query);
    }
    catch (error) {
        console.error('[CanonicalMembers] List failed:', error instanceof Error ? error.message : error);
        return [];
    }
}
export async function countCanonicalMembers() {
    if (!isCanonicalMembersConfigured())
        return 0;
    try {
        const response = await fetch(`${getSupabaseUrl()}/rest/v1/members?select=member_id`, {
            method: 'HEAD',
            headers: { ...headers('count=exact'), Range: '0-0' },
        });
        const range = response.headers.get('content-range') || '';
        const total = range.split('/')[1];
        return total && total !== '*' ? Number(total) : 0;
    }
    catch {
        return 0;
    }
}
async function collectAuthUsers(records) {
    const response = await fetch(`${getSupabaseUrl()}/auth/v1/admin/users?per_page=200`, { headers: headers() });
    if (!response.ok)
        throw new Error(`auth admin users HTTP ${response.status}`);
    const payload = (await response.json());
    const users = Array.isArray(payload) ? payload : payload.users ?? [];
    for (const user of users) {
        const meta = (user.user_metadata ?? {});
        const appMeta = (user.app_metadata ?? {});
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
async function collectProfiles(records) {
    const rows = await rest('/profiles?select=*&limit=1000');
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
async function collectWaitlist(records) {
    const rows = await rest('/waitlist?select=*&order=created_at.asc&limit=2000');
    for (const row of rows) {
        const email = normEmail(row.email);
        if (!email)
            continue;
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
async function collectCapturedLeads(records) {
    const { listLeads } = await import('./ivx-lead-capture-store');
    const leads = await listLeads();
    for (const lead of leads) {
        const email = normEmail(lead.email);
        const phoneDigits = normPhoneDigits(lead.phone);
        if (!email && phoneDigits.length < 10)
            continue;
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
async function collectMemberInvestorStore(records) {
    const { readDurableJson, isDurableStoreConfigured } = await import('./ivx-durable-store');
    if (!isDurableStoreConfigured())
        return;
    const path = await import('node:path');
    const file = path.join(process.cwd(), 'logs', 'audit', 'member-investor', 'members.json');
    const members = await readDurableJson(file, []);
    for (const member of members) {
        const email = normEmail(member.email);
        if (!email)
            continue;
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
async function collectFallbackMembers(records) {
    const { readDurableJson, isDurableStoreConfigured } = await import('./ivx-durable-store');
    if (!isDurableStoreConfigured())
        return;
    const path = await import('node:path');
    const file = path.join(process.cwd(), 'logs', 'audit', 'member-database', 'fallback-members.json');
    const store = await readDurableJson(file, {});
    for (const member of Object.values(store)) {
        const email = normEmail(member.email);
        if (!email)
            continue;
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
export async function backfillCanonicalMembers() {
    const failures = [];
    const perSource = {};
    const records = [];
    if (!isCanonicalMembersConfigured()) {
        return {
            ok: false, totalSourceRecords: 0, alreadySynced: 0, newlySynced: 0,
            duplicatesSkipped: 0, failed: 1,
            failures: [{ source: 'config', identifier: '-', error: 'Supabase credentials missing' }],
            perSource, membersBefore: 0, membersAfter: 0, deploymentMarker: DEPLOYMENT_MARKER,
        };
    }
    const membersBefore = await countCanonicalMembers();
    const collectors = [
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
        }
        catch (error) {
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
        if (result.action === 'created')
            newlySynced += 1;
        else if (result.action === 'updated')
            alreadySynced += 1;
        else
            duplicatesSkipped += 1;
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
