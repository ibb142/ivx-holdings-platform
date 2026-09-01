import { describe, expect, test, mock, beforeEach } from 'bun:test';
import {
  STEPS,
  VISIBLE_STEPS,
  ROLE_OPTIONS,
  COMPANY_TYPES,
  COMPANY_TYPE_LABELS,
  INDUSTRIES,
  BUSINESS_CATEGORIES,
  createInitialState,
  createEmptyFormValues,
  validateEmail,
  validatePhone,
  validatePassword,
  validateWebsite,
  validateZip,
  validateStep,
  validateStep1,
  validateStep2,
  validateStep3,
  isStepValid,
  getUserFriendlyError,
  generateIdempotencyKey,
  DRAFT_STORAGE_KEY,
  DRAFT_EXPIRY_MS,
  formValuesToDraft,
  draftToFormValues,
  isDraftExpired,
  saveDraft,
  loadDraft,
  clearDraft,
  executeFullEnterpriseRegistration,
  registerIndividualMember,
  registerEnterpriseEntity,
  EnterpriseRegistrationFormValues,
  DraftStorageAdapter,
} from '../lib/enterprise-registration-shared';

// ─── Mock fetch ────────────────────────────────────────────────────────────

let mockFetch: any;

function makeMockResponse(data: any) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

beforeEach(() => {
  mockFetch = mock(async (url: string, opts?: any) => {
    const body = opts?.body ? JSON.parse(opts.body) : {};
    // Individual member registration
    if (url.includes('/api/members/register')) {
      if (body.email === 'duplicate@ivxholding.com') {
        return makeMockResponse({ ok: false, code: 'INVALID_EMAIL', message: 'Email already registered.' });
      }
      return makeMockResponse({
        ok: true,
        stage: 'COMPLETED',
        authUserId: 'mock-auth-user-id-123',
        email: body.email,
        traceId: 'mock-trace-individual-123',
        registrationRequestId: body.registrationRequestId,
      });
    }
    // Enterprise registration
    if (url.includes('/api/ivx/enterprise-registration/register')) {
      if (body.legalName === 'Duplicate Enterprise LLC') {
        return makeMockResponse({
          ok: false,
          duplicate: true,
          errorCode: 'DUPLICATE_LEGAL_NAME',
          error: 'An enterprise with this legal name already exists.',
          traceId: 'mock-trace-ent-123',
        });
      }
      return makeMockResponse({
        ok: true,
        enterpriseId: 'mock-enterprise-id-456',
        membershipId: 'mock-membership-id-789',
        traceId: 'mock-trace-ent-123',
        deploymentMarker: 'ivx-enterprise-registration-v1',
      });
    }
    return makeMockResponse({ ok: false, error: 'Unknown endpoint' });
  });
  global.fetch = mockFetch as any;
});

// ─── Constants ─────────────────────────────────────────────────────────────

describe('Enterprise Registration Shared — Constants', () => {
  test('STEPS contains all 5 steps', () => {
    expect(STEPS).toEqual(['account', 'role', 'enterprise', 'review', 'confirmation']);
  });

  test('VISIBLE_STEPS contains 3 visible steps', () => {
    expect(VISIBLE_STEPS).toEqual(['account', 'role', 'enterprise']);
    expect(VISIBLE_STEPS.length).toBe(3);
  });

  test('ROLE_OPTIONS has 8 roles', () => {
    expect(ROLE_OPTIONS.length).toBe(8);
    const ids = ROLE_OPTIONS.map(r => r.id);
    expect(ids).toContain('enterprise');
    expect(ids).toContain('investor');
    expect(ids).toContain('buyer');
    expect(ids).toContain('jv_partner');
    expect(ids).toContain('tokenized_interest');
    expect(ids).toContain('broker_agent');
    expect(ids).toContain('lender');
    expect(ids).toContain('vendor_contractor');
  });

  test('COMPANY_TYPES has 8 types with labels', () => {
    expect(COMPANY_TYPES.length).toBe(8);
    expect(COMPANY_TYPE_LABELS.llc).toBe('LLC');
    expect(COMPANY_TYPE_LABELS.c_corp).toBe('C Corporation');
  });

  test('INDUSTRIES includes Real Estate', () => {
    expect(INDUSTRIES).toContain('Real Estate');
  });

  test('BUSINESS_CATEGORIES includes Investment', () => {
    expect(BUSINESS_CATEGORIES).toContain('Investment');
  });

  test('DRAFT_EXPIRY_MS is 24 hours', () => {
    expect(DRAFT_EXPIRY_MS).toBe(24 * 60 * 60 * 1000);
  });
});

// ─── Initial state ─────────────────────────────────────────────────────────

describe('Enterprise Registration Shared — Initial State', () => {
  test('createInitialState returns correct defaults', () => {
    const state = createInitialState();
    expect(state.currentStep).toBe('account');
    expect(state.submissionStatus).toBe('idle');
    expect(state.serverError).toBe('');
    expect(state.enterpriseId).toBe('');
    expect(state.memberId).toBe('');
    expect(state.authUserId).toBe('');
    expect(state.traceId).toBe('');
    expect(state.validationErrors).toEqual({});
    expect(state.idempotencyKey).toMatch(/^ivx-ent-reg-/);
  });

  test('createEmptyFormValues returns all empty fields', () => {
    const vals = createEmptyFormValues();
    expect(vals.firstName).toBe('');
    expect(vals.lastName).toBe('');
    expect(vals.email).toBe('');
    expect(vals.password).toBe('');
    expect(vals.primaryRole).toBe('');
    expect(vals.legalName).toBe('');
    expect(vals.acceptTerms).toBe(false);
    expect(vals.acceptPrivacy).toBe(false);
    expect(vals.country).toBe('United States');
  });
});

// ─── Validation ────────────────────────────────────────────────────────────

describe('Enterprise Registration Shared — Validation', () => {
  test('validateEmail accepts valid emails', () => {
    expect(validateEmail('test@ivxholding.com')).toBe(true);
    expect(validateEmail('user.name@domain.co.uk')).toBe(true);
  });

  test('validateEmail rejects invalid emails', () => {
    expect(validateEmail('notanemail')).toBe(false);
    expect(validateEmail('missing@domain')).toBe(false);
    expect(validateEmail('')).toBe(false);
  });

  test('validatePhone accepts valid phones', () => {
    expect(validatePhone('+1 555 123 4567')).toBe(true);
    expect(validatePhone('(555) 123-4567')).toBe(true);
  });

  test('validatePhone rejects invalid phones', () => {
    expect(validatePhone('123')).toBe(false);
    expect(validatePhone('')).toBe(false);
  });

  test('validatePassword enforces enterprise policy', () => {
    expect(validatePassword('Short1!').valid).toBe(false);
    expect(validatePassword('shortpassword').valid).toBe(false);
    expect(validatePassword('alllowercase123').valid).toBe(false);
    expect(validatePassword('NO NUMBERS HERE').valid).toBe(false);
    expect(validatePassword('ValidPass123').valid).toBe(true);
    expect(validatePassword('A1').valid).toBe(false); // too short
  });

  test('validateWebsite accepts valid URLs', () => {
    expect(validateWebsite('https://example.com')).toBe(true);
    expect(validateWebsite('example.com')).toBe(true);
    expect(validateWebsite('')).toBe(true); // optional
  });

  test('validateWebsite rejects invalid URLs', () => {
    expect(validateWebsite('not a url')).toBe(false);
    expect(validateWebsite('://no-protocol')).toBe(false);
  });

  test('validateZip accepts valid codes', () => {
    expect(validateZip('10001')).toBe(true);
    expect(validateZip('M5H 2N2')).toBe(true);
    expect(validateZip('SW1A 1AA')).toBe(true);
  });

  test('validateZip rejects invalid codes', () => {
    expect(validateZip('12')).toBe(false);
    expect(validateZip('')).toBe(false);
  });
});

// ─── Step validation ───────────────────────────────────────────────────────

describe('Enterprise Registration Shared — Step Validation', () => {
  test('validateStep1 catches missing required fields', () => {
    const vals = createEmptyFormValues();
    const errors = validateStep1(vals);
    expect(errors.firstName).toBeDefined();
    expect(errors.lastName).toBeDefined();
    expect(errors.email).toBeDefined();
    expect(errors.phone).toBeDefined();
    expect(errors.password).toBeDefined();
    expect(errors.dateOfBirth).toBeDefined();
    expect(errors.gender).toBeDefined();
    expect(errors.zipCode).toBeDefined();
    expect(errors.acceptTerms).toBeDefined();
    expect(errors.acceptPrivacy).toBeDefined();
  });

  test('validateStep1 passes with all valid fields', () => {
    const vals: EnterpriseRegistrationFormValues = {
      ...createEmptyFormValues(),
      firstName: 'John',
      lastName: 'Smith',
      email: 'john@ivxholding.com',
      phone: '+1 555 123 4567',
      password: 'ValidPass123',
      dateOfBirth: '01/15/1990',
      gender: 'male',
      zipCode: '10001',
      acceptTerms: true,
      acceptPrivacy: true,
    };
    const errors = validateStep1(vals);
    expect(Object.keys(errors).length).toBe(0);
  });

  test('validateStep2 catches missing role', () => {
    const vals = createEmptyFormValues();
    const errors = validateStep2(vals);
    expect(errors.primaryRole).toBeDefined();
  });

  test('validateStep2 passes with role selected', () => {
    const vals = { ...createEmptyFormValues(), primaryRole: 'enterprise' };
    const errors = validateStep2(vals);
    expect(Object.keys(errors).length).toBe(0);
  });

  test('validateStep3 catches missing enterprise fields', () => {
    const vals = createEmptyFormValues();
    const errors = validateStep3(vals);
    expect(errors.legalName).toBeDefined();
    expect(errors.displayName).toBeDefined();
    expect(errors.companyType).toBeDefined();
    expect(errors.industry).toBeDefined();
    expect(errors.address).toBeDefined();
    expect(errors.city).toBeDefined();
    expect(errors.state).toBeDefined();
    expect(errors.postalCode).toBeDefined();
    expect(errors.authorizedRepresentative).toBeDefined();
    expect(errors.representativeTitle).toBeDefined();
    expect(errors.teamSize).toBeDefined();
    expect(errors.businessCategory).toBeDefined();
  });

  test('validateStep3 passes with all valid enterprise fields', () => {
    const vals: EnterpriseRegistrationFormValues = {
      ...createEmptyFormValues(),
      legalName: 'Acme Holdings LLC',
      displayName: 'Acme Holdings',
      companyType: 'llc',
      industry: 'Real Estate',
      website: 'https://acme.com',
      address: '123 Main St',
      city: 'New York',
      state: 'NY',
      postalCode: '10001',
      authorizedRepresentative: 'John Smith',
      representativeTitle: 'CEO',
      teamSize: '10',
      businessCategory: 'Investment',
    };
    const errors = validateStep3(vals);
    expect(Object.keys(errors).length).toBe(0);
  });

  test('isStepValid returns true for valid step', () => {
    const vals: EnterpriseRegistrationFormValues = {
      ...createEmptyFormValues(),
      primaryRole: 'enterprise',
    };
    expect(isStepValid('role', vals)).toBe(true);
  });

  test('isStepValid returns false for invalid step', () => {
    const vals = createEmptyFormValues();
    expect(isStepValid('account', vals)).toBe(false);
  });
});

// ─── Error messages ────────────────────────────────────────────────────────

describe('Enterprise Registration Shared — Error Messages', () => {
  test('getUserFriendlyError maps known codes', () => {
    expect(getUserFriendlyError('DUPLICATE_LEGAL_NAME', '')).toContain('legal name already exists');
    expect(getUserFriendlyError('DUPLICATE_DOMAIN', '')).toContain('website domain already exists');
    expect(getUserFriendlyError('INVALID_EMAIL', '')).toContain('already registered');
    expect(getUserFriendlyError('WEAK_PASSWORD', '')).toContain('Password does not meet');
  });

  test('getUserFriendlyError falls back to provided message', () => {
    expect(getUserFriendlyError('UNKNOWN_CODE', 'Custom fallback')).toBe('Custom fallback');
  });

  test('getUserFriendlyError has default fallback', () => {
    expect(getUserFriendlyError('', '')).toContain('An error occurred');
  });
});

// ─── Idempotency ───────────────────────────────────────────────────────────

describe('Enterprise Registration Shared — Idempotency', () => {
  test('generateIdempotencyKey produces unique keys', () => {
    const key1 = generateIdempotencyKey();
    const key2 = generateIdempotencyKey();
    expect(key1).toMatch(/^ivx-ent-reg-/);
    expect(key2).toMatch(/^ivx-ent-reg-/);
    expect(key1).not.toBe(key2);
  });
});

// ─── Draft storage ─────────────────────────────────────────────────────────

describe('Enterprise Registration Shared — Draft Storage', () => {
  let mockStorage: DraftStorageAdapter;
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    mockStorage = {
      getItem: async (key: string) => store[key] || null,
      setItem: async (key: string, value: string) => { store[key] = value; },
      removeItem: async (key: string) => { delete store[key]; },
    };
  });

  test('saveDraft and loadDraft round-trip preserves values (except password)', async () => {
    const vals: EnterpriseRegistrationFormValues = {
      ...createEmptyFormValues(),
      firstName: 'John',
      lastName: 'Smith',
      email: 'john@ivxholding.com',
      password: 'SecretPass123',
      primaryRole: 'enterprise',
      legalName: 'Acme LLC',
    };
    await saveDraft(mockStorage, vals, 'account', 'test-key-123');
    const loaded = await loadDraft(mockStorage);
    expect(loaded).not.toBeNull();
    expect(loaded!.idempotencyKey).toBe('test-key-123');
    expect(loaded!.currentStep).toBe('account');
    expect(loaded!.formValues.firstName).toBe('John');
    expect(loaded!.formValues.legalName).toBe('Acme LLC');
    // Password should be stored as flag only, not the actual value
    expect(loaded!.formValues.passwordEntered).toBe(true);
    expect((loaded!.formValues as any).password).toBeUndefined();
  });

  test('draftToFormValues does not restore password', () => {
    const draft = formValuesToDraft(
      { ...createEmptyFormValues(), password: 'MyPass123', firstName: 'John' },
      'account',
      'key'
    );
    const restored = draftToFormValues(draft);
    expect(restored.firstName).toBe('John');
    expect(restored.password).toBe(''); // Password never restored
  });

  test('isDraftExpired returns true for old drafts', () => {
    const oldDate = new Date(Date.now() - DRAFT_EXPIRY_MS - 1000).toISOString();
    const draft = formValuesToDraft(createEmptyFormValues(), 'account', 'key');
    draft.draftUpdatedAt = oldDate;
    expect(isDraftExpired(draft)).toBe(true);
  });

  test('isDraftExpired returns false for recent drafts', () => {
    const draft = formValuesToDraft(createEmptyFormValues(), 'account', 'key');
    expect(isDraftExpired(draft)).toBe(false);
  });

  test('loadDraft returns null for expired drafts and removes them', async () => {
    const oldDate = new Date(Date.now() - DRAFT_EXPIRY_MS - 1000).toISOString();
    const draft = formValuesToDraft(createEmptyFormValues(), 'account', 'key');
    draft.draftUpdatedAt = oldDate;
    store[DRAFT_STORAGE_KEY] = JSON.stringify(draft);
    const loaded = await loadDraft(mockStorage);
    expect(loaded).toBeNull();
    expect(store[DRAFT_STORAGE_KEY]).toBeUndefined();
  });

  test('clearDraft removes the draft', async () => {
    store[DRAFT_STORAGE_KEY] = '{"test":1}';
    await clearDraft(mockStorage);
    expect(store[DRAFT_STORAGE_KEY]).toBeUndefined();
  });

  test('loadDraft returns null when no draft exists', async () => {
    const loaded = await loadDraft(mockStorage);
    expect(loaded).toBeNull();
  });

  test('loadDraft returns null for corrupt JSON', async () => {
    store[DRAFT_STORAGE_KEY] = 'not valid json{{{';
    const loaded = await loadDraft(mockStorage);
    expect(loaded).toBeNull();
  });
});

// ─── Full submission flow ──────────────────────────────────────────────────

describe('Enterprise Registration Shared — Full Submission Flow', () => {
  test('executeFullEnterpriseRegistration succeeds with valid data', async () => {
    const vals: EnterpriseRegistrationFormValues = {
      ...createEmptyFormValues(),
      firstName: 'John',
      lastName: 'Smith',
      email: 'john@ivxholding.com',
      phone: '+1 555 123 4567',
      password: 'ValidPass123',
      dateOfBirth: '01/15/1990',
      gender: 'male',
      zipCode: '10001',
      acceptTerms: true,
      acceptPrivacy: true,
      primaryRole: 'enterprise',
      legalName: 'Acme Holdings LLC',
      displayName: 'Acme Holdings',
      companyType: 'llc',
      industry: 'Real Estate',
      website: 'https://acme.com',
      address: '123 Main St',
      city: 'New York',
      state: 'NY',
      postalCode: '10001',
      authorizedRepresentative: 'John Smith',
      representativeTitle: 'CEO',
      teamSize: '10',
      businessCategory: 'Investment',
    };
    const result = await executeFullEnterpriseRegistration({
      formValues: vals,
      idempotencyKey: 'test-idempotency-key',
    });
    expect(result.ok).toBe(true);
    expect(result.authUserId).toBe('mock-auth-user-id-123');
    expect(result.enterpriseId).toBe('mock-enterprise-id-456');
    expect(result.membershipId).toBe('mock-membership-id-789');
    expect(result.traceId).toBe('mock-trace-ent-123');
    expect(result.stage).toBe('COMPLETED');
  });

  test('executeFullEnterpriseRegistration fails on duplicate email', async () => {
    const vals: EnterpriseRegistrationFormValues = {
      ...createEmptyFormValues(),
      firstName: 'John',
      lastName: 'Smith',
      email: 'duplicate@ivxholding.com',
      phone: '+1 555 123 4567',
      password: 'ValidPass123',
      dateOfBirth: '01/15/1990',
      gender: 'male',
      zipCode: '10001',
      acceptTerms: true,
      acceptPrivacy: true,
      primaryRole: 'enterprise',
      legalName: 'New Enterprise LLC',
      displayName: 'New Enterprise',
      companyType: 'llc',
      industry: 'Real Estate',
      website: '',
      address: '123 Main St',
      city: 'New York',
      state: 'NY',
      postalCode: '10001',
      authorizedRepresentative: 'John Smith',
      representativeTitle: 'CEO',
      teamSize: '10',
      businessCategory: 'Investment',
    };
    const result = await executeFullEnterpriseRegistration({
      formValues: vals,
      idempotencyKey: 'test-dup-email-key',
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('INVALID_EMAIL');
    expect(result.error).toContain('already registered');
  });

  test('executeFullEnterpriseRegistration fails on duplicate enterprise name', async () => {
    const vals: EnterpriseRegistrationFormValues = {
      ...createEmptyFormValues(),
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@ivxholding.com',
      phone: '+1 555 987 6543',
      password: 'ValidPass123',
      dateOfBirth: '02/20/1985',
      gender: 'female',
      zipCode: '90210',
      acceptTerms: true,
      acceptPrivacy: true,
      primaryRole: 'enterprise',
      legalName: 'Duplicate Enterprise LLC',
      displayName: 'Duplicate Enterprise',
      companyType: 'llc',
      industry: 'Real Estate',
      website: 'https://dup.com',
      address: '456 Oak Ave',
      city: 'LA',
      state: 'CA',
      postalCode: '90210',
      authorizedRepresentative: 'Jane Doe',
      representativeTitle: 'CFO',
      teamSize: '5',
      businessCategory: 'Investment',
    };
    const result = await executeFullEnterpriseRegistration({
      formValues: vals,
      idempotencyKey: 'test-dup-ent-key',
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('DUPLICATE_LEGAL_NAME');
    expect(result.authUserId).toBe('mock-auth-user-id-123'); // individual succeeded
    expect(result.error).toContain('legal name already exists');
  });

  test('registerIndividualMember calls correct endpoint', async () => {
    await registerIndividualMember({
      email: 'test@ivxholding.com',
      password: 'ValidPass123',
      firstName: 'Test',
      lastName: 'User',
      dateOfBirth: '01/01/1990',
      gender: 'male',
      phone: '+1 555 123 4567',
      country: 'United States',
      zipCode: '10001',
      roles: ['enterprise'],
      acceptTerms: true,
      registrationRequestId: 'test-req-id',
    });
    expect(mockFetch).toHaveBeenCalled();
    const callUrl = mockFetch.mock.calls[0][0] as string;
    expect(callUrl).toContain('/api/members/register');
  });

  test('registerEnterpriseEntity calls correct endpoint', async () => {
    await registerEnterpriseEntity({
      ownerAuthUserId: 'test-auth-id',
      legalName: 'Test LLC',
      displayName: 'Test',
      companyType: 'llc',
      industry: 'Real Estate',
      website: 'https://test.com',
      address: '123 Test St',
      authorizedRepresentative: 'Test Person',
      representativeJobTitle: 'CEO',
      teamSize: 5,
      businessCategory: 'Investment',
      sourceChannel: 'enterprise_registration_ui',
    });
    const callUrl = mockFetch.mock.calls[mockFetch.mock.calls.length - 1][0] as string;
    expect(callUrl).toContain('/api/ivx/enterprise-registration/register');
  });
});
