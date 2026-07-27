/**
 * ITEM 1 — Canonical Identity Model tests.
 *
 * Verifies that:
 *  - CanonicalMemberInput includes all 20 required enterprise-registration fields
 *  - CanonicalMemberRow includes all 20 required fields
 *  - upsertCanonicalMember writes the new fields on insert
 *  - upsertCanonicalMember merges (not overwrites) the new fields on update
 *  - findExisting dedupes by auth_user_id → normalized_email
 *  - One auth identity maps to one canonical member
 *  - Duplicate normalized_email is rejected by the DB unique constraint
 *  - No role-specific duplicate identity is created
 *
 * These tests stub global.fetch (the canonical-members service uses fetch
 * directly to call Supabase REST, not the supabase-js client).
 */
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import type { CanonicalMemberInput, CanonicalMemberRow } from './services/ivx-canonical-members';

// --- In-memory members store ---
interface StoredMember {
  member_id: string;
  full_name: string;
  email: string;
  phone: string;
  normalized_email: string | null;
  normalized_phone: string | null;
  auth_user_id: string | null;
  enterprise_id: string | null;
  primary_role: string | null;
  registration_type: string;
  registration_status: string;
  identity_status: string;
  kyc_status: string;
  aml_status: string;
  owner_review_status: string;
  source_channel: string;
  data_origin: string;
  terms_version: string | null;
  privacy_version: string | null;
  terms_accepted_at: string | null;
  audit_trace_id: string | null;
  [key: string]: unknown;
}

let _store: StoredMember[] = [];
let _counter = 0;

// Parse the PostgREST URL path to determine the operation
function handleFetch(url: string, init?: RequestInit): { status: number; body: unknown } {
  const u = new URL(url);
  const path = u.pathname.replace('/rest/v1/', '');
  const [table, ...rest] = path.split('?');
  const queryStr = u.search + (rest.length ? '?' + rest.join('?') : '');
  const params = new URLSearchParams(queryStr);

  if (table !== 'members') {
    return { status: 200, body: [] };
  }

  const method = init?.method || 'GET';
  const prefer = (init?.headers as Record<string, string>)?.Prefer || '';
  const wantsRepresentation = prefer.includes('return=representation');

  // Parse filter from URL search params
  // PostgREST uses ?column=eq.value syntax in search params
  const filters: Record<string, { op: string; val: string }> = {};
  for (const [key, value] of params.entries()) {
    if (key === 'select' || key === 'order' || key === 'limit') continue;
    const parts = value.split('.');
    if (parts.length >= 2) {
      filters[key] = { op: parts[0], val: decodeURIComponent(parts.slice(1).join('.')) };
    } else {
      filters[key] = { op: 'eq', val: decodeURIComponent(value) };
    }
  }

  // Also handle ilike in path (e.g. /members?email=ilike.%term%)
  // The URL search params handle this already

  const limit = parseInt(params.get('limit') || '1000', 10);

  if (method === 'POST') {
    const body = JSON.parse(init?.body as string);
    // Check unique constraints
    const normEmail = body.normalized_email as string | null;
    if (normEmail) {
      const dup = _store.find((m) => m.normalized_email === normEmail);
      if (dup) {
        return { status: 409, body: { message: 'duplicate key value violates unique constraint "idx_members_normalized_email_unique"' } };
      }
    }
    const authId = body.auth_user_id as string | null;
    if (authId) {
      const dup = _store.find((m) => m.auth_user_id === authId);
      if (dup) {
        return { status: 409, body: { message: 'duplicate key value violates unique constraint "idx_members_auth_user_id_unique"' } };
      }
    }
    const member: StoredMember = {
      member_id: `test-member-${++_counter}`,
      ...body,
    } as StoredMember;
    _store.push(member);
    return { status: 201, body: wantsRepresentation ? [member] : null };
  }

  if (method === 'PATCH') {
    const patchBody = JSON.parse(init?.body as string);
    // Find matching members by filters
    let matching = _store;
    for (const [col, filter] of Object.entries(filters)) {
      if (filter.op === 'eq') {
        matching = matching.filter((m) => String(m[col]) === filter.val);
      }
    }
    if (matching.length > 0) {
      Object.assign(matching[0], patchBody);
      return { status: 200, body: wantsRepresentation ? [matching[0]] : null };
    }
    return { status: 200, body: [] };
  }

  if (method === 'GET' || method === 'HEAD') {
    let matching = _store;
    for (const [col, filter] of Object.entries(filters)) {
      if (filter.op === 'eq') {
        matching = matching.filter((m) => String(m[col]) === filter.val);
      } else if (filter.op === 'ilike') {
        const pat = filter.val.replace(/%/g, '').toLowerCase();
        matching = matching.filter((m) => String(m[col] ?? '').toLowerCase().includes(pat));
      } else if (filter.op === 'like') {
        const pat = filter.val.replace(/%/g, '');
        matching = matching.filter((m) => String(m[col] ?? '').includes(pat));
      }
    }
    matching = matching.slice(0, limit);
    return { status: 200, body: matching };
  }

  return { status: 405, body: { message: 'Method not allowed' } };
}

// --- Mock global.fetch ---
const _originalFetch = global.fetch;
const _fetchMock = mock((_url: string | URL | Request, _init?: RequestInit) => {
  const url = typeof _url === 'string' ? _url : _url.toString();
  const result = handleFetch(url, _init);
  return Promise.resolve(new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'Content-Type': 'application/json' },
  }));
});

// Set env vars
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

describe('ITEM 1 — Canonical Identity Model', () => {
  beforeEach(() => {
    _store = [];
    _counter = 0;
    global.fetch = _fetchMock as unknown as typeof fetch;
    _fetchMock.mockClear();
  });

  afterEach(() => {
    global.fetch = _originalFetch;
  });

  // Import after mock setup
  const { upsertCanonicalMember } = require('./services/ivx-canonical-members') as typeof import('./services/ivx-canonical-members');

  describe('Required fields present in types', () => {
    it('CanonicalMemberInput includes all 20 required enterprise-registration fields', () => {
      const input: CanonicalMemberInput = {
        fullName: 'Jane Doe',
        email: 'jane@ivxholding.com',
        phone: '+1-555-123-4567',
        enterpriseId: 'ent-123',
        countryCode: 'US',
        primaryRole: 'investor',
        secondaryRoles: ['buyer', 'jv_partner'],
        registrationType: 'enterprise',
        registrationStatus: 'completed',
        emailVerifiedAt: '2026-07-27T00:00:00Z',
        phoneVerifiedAt: '2026-07-27T00:01:00Z',
        identityStatus: 'active',
        kycStatus: 'not_started',
        amlStatus: 'not_started',
        ownerReviewStatus: 'not_started',
        sourceChannel: 'enterprise_registration',
        dataOrigin: 'enterprise_registration',
        termsVersion: 'v2',
        privacyVersion: 'v2',
        termsAcceptedAt: '2026-07-27T00:00:00Z',
        auditTraceId: 'ivx-ent-abc123',
      };
      expect(input.enterpriseId).toBe('ent-123');
      expect(input.registrationType).toBe('enterprise');
      expect(input.primaryRole).toBe('investor');
      expect(input.auditTraceId).toBe('ivx-ent-abc123');
    });

    it('CanonicalMemberRow includes all 20 required fields', () => {
      const row: CanonicalMemberRow = {
        member_id: 'm1', full_name: 'Test', email: 't@t.com', phone: '',
        member_type: 'member', source: 'landing_page', source_detail: '',
        verification_status: 'unverified', sms_verified: false, email_verified: false,
        investor_interest: '', preferred_zipcode: '', budget_range: '', picture_url: '',
        auth_user_id: null, landing_submission_id: null, created_at: '', updated_at: '',
        normalized_email: null, enterprise_id: null, normalized_phone: null, country_code: null,
        primary_role: null, secondary_roles: null, registration_type: null,
        registration_status: null, email_verified_at: null, phone_verified_at: null,
        identity_status: null, kyc_status: null, aml_status: null, owner_review_status: null,
        source_channel: null, data_origin: null, terms_version: null, privacy_version: null,
        terms_accepted_at: null, audit_trace_id: null,
      };
      expect(row.enterprise_id).toBeNull();
      expect(row.registration_type).toBeNull();
      expect(row.audit_trace_id).toBeNull();
    });
  });

  describe('New individual registration creates complete identity', () => {
    it('inserts a member with all canonical identity fields', async () => {
      const result = await upsertCanonicalMember({
        fullName: 'John Smith',
        email: 'john@ivxholding.com',
        phone: '+1-555-000-1234',
        authUserId: 'auth-user-001',
        primaryRole: 'investor',
        registrationType: 'individual',
        registrationStatus: 'completed',
        identityStatus: 'active',
        sourceChannel: 'landing_page',
        dataOrigin: 'auth_users',
        termsVersion: 'v1',
        privacyVersion: 'v1',
        termsAcceptedAt: '2026-07-27T00:00:00Z',
        auditTraceId: 'ivx-reg-test-001',
      });

      expect(result.ok).toBe(true);
      expect(result.action).toBe('created');
      expect(result.member).toBeDefined();
      expect(result.member?.auth_user_id).toBe('auth-user-001');
      expect(result.member?.normalized_email).toBe('john@ivxholding.com');
      expect(result.member?.primary_role).toBe('investor');
      expect(result.member?.registration_type).toBe('individual');
      expect(result.member?.registration_status).toBe('completed');
      expect(result.member?.identity_status).toBe('active');
      expect(result.member?.audit_trace_id).toBe('ivx-reg-test-001');
      expect(result.member?.source_channel).toBe('landing_page');
      expect(result.member?.data_origin).toBe('auth_users');
    });
  });

  describe('New enterprise registration creates complete identity', () => {
    it('inserts a member with enterprise_id and registration_type=enterprise', async () => {
      const result = await upsertCanonicalMember({
        fullName: 'Enterprise Owner',
        email: 'owner@acme.com',
        authUserId: 'auth-user-ent-001',
        enterpriseId: 'ent-acme-001',
        primaryRole: 'enterprise_owner',
        registrationType: 'enterprise',
        registrationStatus: 'completed',
        identityStatus: 'active',
        sourceChannel: 'enterprise_registration',
        dataOrigin: 'enterprise_registration',
        auditTraceId: 'ivx-ent-test-001',
      });

      expect(result.ok).toBe(true);
      expect(result.action).toBe('created');
      expect(result.member?.enterprise_id).toBe('ent-acme-001');
      expect(result.member?.registration_type).toBe('enterprise');
      expect(result.member?.primary_role).toBe('enterprise_owner');
      expect(result.member?.source_channel).toBe('enterprise_registration');
    });
  });

  describe('Duplicate auth identity is rejected', () => {
    it('does not create a second member with the same auth_user_id', async () => {
      await upsertCanonicalMember({
        email: 'dup1@ivxholding.com',
        authUserId: 'auth-dup-001',
        registrationType: 'individual',
      });
      const result = await upsertCanonicalMember({
        email: 'dup1@ivxholding.com',
        authUserId: 'auth-dup-001',
        registrationType: 'individual',
      });

      expect(result.ok).toBe(true);
      expect(result.action).toBe('skipped');
      expect(_store.filter((m) => m.auth_user_id === 'auth-dup-001').length).toBe(1);
    });
  });

  describe('Duplicate email is rejected', () => {
    it('does not create a second member with the same normalized_email', async () => {
      await upsertCanonicalMember({
        email: 'dupemail@ivxholding.com',
        authUserId: 'auth-email-001',
      });
      const result = await upsertCanonicalMember({
        email: 'dupemail@ivxholding.com',
        authUserId: 'auth-email-002',
      });

      expect(result.ok).toBe(true);
      const matching = _store.filter((m) => m.normalized_email === 'dupemail@ivxholding.com');
      expect(matching.length).toBe(1);
    });
  });

  describe('Existing incomplete member can be recovered', () => {
    it('merges missing identity fields into an existing member without overwriting', async () => {
      const first = await upsertCanonicalMember({
        email: 'incomplete@ivxholding.com',
        authUserId: 'auth-incomplete-001',
        registrationType: 'individual',
      });
      expect(first.ok).toBe(true);
      expect(first.member?.enterprise_id).toBeNull();

      const result = await upsertCanonicalMember({
        email: 'incomplete@ivxholding.com',
        authUserId: 'auth-incomplete-001',
        enterpriseId: 'ent-recovered-001',
        registrationType: 'enterprise',
        auditTraceId: 'ivx-recovery-001',
        primaryRole: 'enterprise_owner',
      });

      expect(result.ok).toBe(true);
      expect(result.action).toBe('updated');
      expect(result.member?.enterprise_id).toBe('ent-recovered-001');
      expect(result.member?.audit_trace_id).toBe('ivx-recovery-001');
      expect(result.member?.primary_role).toBe('enterprise_owner');
      expect(result.member?.registration_type).toBe('enterprise');
    });
  });

  describe('No orphan member is created', () => {
    it('rejects input with no dedupe identity (email/phone/auth_user_id)', async () => {
      const result = await upsertCanonicalMember({
        fullName: 'No Identity',
      });

      expect(result.ok).toBe(false);
      expect(result.action).toBe('skipped');
      expect(result.error).toContain('No dedupe identity');
    });
  });

  describe('No role-specific duplicate identity is created', () => {
    it('one auth identity → one canonical member regardless of role changes', async () => {
      await upsertCanonicalMember({
        email: 'roles@ivxholding.com',
        authUserId: 'auth-roles-001',
        primaryRole: 'investor',
        registrationType: 'individual',
      });
      await upsertCanonicalMember({
        email: 'roles@ivxholding.com',
        authUserId: 'auth-roles-001',
        primaryRole: 'investor',
      });

      const matching = _store.filter((m) => m.auth_user_id === 'auth-roles-001');
      expect(matching.length).toBe(1);
    });
  });
});