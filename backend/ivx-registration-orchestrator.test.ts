/**
 * IVX Registration Reliability Phase 2 — backend tests.
 *
 * Covers the normalized error contract, idempotency, partial-failure recovery,
 * and the health endpoint. These tests stub `@supabase/supabase-js` and the
 * underlying `registerMember` pipeline so they run without a live Supabase
 * connection or the supabase-js package installed locally.
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import type { RegistrationRequestInput } from './services/ivx-registration-orchestrator';

// --- In-memory durable store shared between the mock and the test assertions ---
const _store: Record<string, unknown> = {};

// --- Stub @supabase/supabase-js BEFORE any import that transitively needs it ---
mock.module('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      admin: { createUser: async () => ({ data: { user: { id: 'stub' } }, error: null }) },
      signUp: async () => ({ data: { user: { id: 'stub' }, session: null }, error: null }),
      signInWithPassword: async () => ({ data: { user: { id: 'stub' }, session: { access_token: 'stub' } }, error: null }),
    },
    from: () => ({
      upsert: async () => ({ error: null }),
      insert: async () => ({ error: null }),
      select: () => ({ eq: async () => ({ single: async () => ({ data: null, error: null }) }), data: [], error: null }),
    }),
  }),
}));

// --- Stub the durable store so persistence is in-memory + reversible ---
// (Bun's require() returns a frozen module object, so we mock the whole module.)
mock.module('./services/ivx-durable-store', () => ({
  isDurableStoreConfigured: () => true,
  readDurableJson: async <T>(file: string, fallback: T): Promise<T> => ((_store[file] as T) ?? fallback),
  writeDurableJson: async (file: string, value: unknown): Promise<void> => { _store[file] = value; },
  durableKeyForFile: (f: string) => f,
  appendDurableEvent: async () => {},
  readDurableEvents: async () => [],
}));

// --- Stub the member-database module (avoids pulling the real supabase client) ---
let _registerStub: ((input: unknown) => Promise<unknown>) | null = null;
mock.module('./services/ivx-member-database', () => ({
  registerMember: async (input: unknown) => _registerStub ? _registerStub(input) : {
    success: true, userId: 'stub-user-id', email: (input as any)?.email, message: 'ok',
    requiresVerification: false, deploymentMarker: 'test',
  },
  getMemberProfile: async () => null,
  updateMemberKYCStatus: async () => true,
  updateMemberLastLogin: async () => true,
  loginMember: async () => ({ success: false, message: 'stub', requiresVerification: false, deploymentMarker: 'test' }),
  requestMemberPasswordReset: async () => ({ success: false, message: 'stub', deploymentMarker: 'test' }),
  resetMemberPasswordWithToken: async () => ({ success: false, message: 'stub', deploymentMarker: 'test' }),
  updateMemberProfile: async () => ({ success: false, message: 'stub', deploymentMarker: 'test' }),
}));

// --- Stub the onboarding + canonical member modules (non-fatal fanout) ---
mock.module('./services/ivx-member-investor-system', () => ({
  onboardNewMember: async () => {},
  VALID_ROLE_INTERESTS: new Set(['investor', 'member']),
}));
mock.module('./services/ivx-canonical-members', () => ({
  upsertCanonicalMember: async () => {},
  markCanonicalMemberVerified: async () => {},
}));

// Now import the orchestrator (it will pull all the stubbed dependencies).
const {
  orchestrateRegistration,
  checkRegistrationHealth,
  getRegistrationStatus,
} = require('./services/ivx-registration-orchestrator') as typeof import('./services/ivx-registration-orchestrator');

// Helper to swap the registerMember stub per-test.
function stubRegister(result: { success: boolean; message: string; userId?: string; email?: string; requiresVerification: boolean; deploymentMarker: string }) {
  _registerStub = async () => result;
}
function stubRegisterFn(fn: () => Promise<{ success: boolean; message: string; userId?: string; email?: string; requiresVerification: boolean; deploymentMarker: string }>) {
  _registerStub = async () => fn();
}

beforeEach(() => {
  for (const k of Object.keys(_store)) delete _store[k];
  _registerStub = null;
});

function validInput(overrides: Partial<RegistrationRequestInput> = {}): RegistrationRequestInput {
  return {
    email: 'test-' + Math.random().toString(36).substring(2, 8) + '@example.com',
    password: 'Sup3rSecurePassphrase!',
    firstName: 'Test',
    lastName: 'User',
    phone: '555-555-5555',
    country: 'US',
    zipCode: '10001',
    roles: ['investor'],
    acceptTerms: true,
    dateOfBirth: '1990-01-01',
    gender: 'prefer_not_to_say',
    ...overrides,
  };
}

describe('ivx-registration-orchestrator — normalized error contract', () => {
  it('rejects missing first name with INVALID_EMAIL code + traceId + stage', async () => {
    const result = await orchestrateRegistration(validInput({ firstName: '' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_EMAIL');
      expect(result.stage).toBe('VALIDATING');
      expect(result.traceId).toMatch(/^ivx-reg-/);
      expect(result.retryable).toBe(false);
      expect(result.registrationRequestId).toBeTruthy();
    }
  });

  it('rejects weak password (<12 chars) with WEAK_PASSWORD code', async () => {
    const result = await orchestrateRegistration(validInput({ password: 'Short1!' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('WEAK_PASSWORD');
      expect(result.stage).toBe('VALIDATING');
      expect(result.message).toContain('12 characters');
    }
  });

  it('rejects unaccepted terms with a non-retryable VALIDATING error', async () => {
    const result = await orchestrateRegistration(validInput({ acceptTerms: false }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe('VALIDATING');
      expect(result.retryable).toBe(false);
    }
  });

  it('accepts a 12+ character passphrase without character-class requirements', async () => {
    stubRegister({
      success: true,
      userId: 'test-user-id-1',
      email: 'passphrase@example.com',
      message: 'ok',
      requiresVerification: true,
      deploymentMarker: 'test',
    });
    const result = await orchestrateRegistration(
      validInput({ email: 'passphrase@example.com', password: 'all-lowercase-passphrase-no-symbols-but-long-enough' })
    );
    expect(result.ok).toBe(true);
  });
});

describe('ivx-registration-orchestrator — idempotency', () => {
  it('returns a normalized success contract with a registrationRequestId + traceId', async () => {
    stubRegister({
      success: true,
      userId: 'test-user-id-2',
      email: 'idem@example.com',
      message: 'ok',
      requiresVerification: false,
      deploymentMarker: 'test',
    });
    const requestId = '11111111-1111-4111-8111-111111111111';
    const result = await orchestrateRegistration(validInput({ registrationRequestId: requestId }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.registrationRequestId).toBe(requestId);
      expect(result.traceId).toMatch(/^ivx-reg-/);
      expect(result.authUserId).toBe('test-user-id-2');
      expect(result.requiresVerification).toBe(false);
    }
  });

  it('duplicate submission for a completed request returns the same success without re-calling registerMember', async () => {
    let callCount = 0;
    stubRegisterFn(async () => {
      callCount++;
      return {
        success: true, userId: 'test-user-id-3', email: 'dup@example.com', message: 'ok',
        requiresVerification: false, deploymentMarker: 'test',
      };
    });
    const requestId = '22222222-2222-4222-8222-222222222222';
    const input = validInput({ registrationRequestId: requestId, email: 'dup@example.com' });
    const first = await orchestrateRegistration(input);
    expect(first.ok).toBe(true);
    const firstCallCount = callCount;
    // Second call with the same ID — should return cached result without re-registering.
    const second = await orchestrateRegistration(input);
    expect(second.ok).toBe(true);
    expect(callCount).toBe(firstCallCount);
    if (second.ok && first.ok) {
      expect(second.registrationRequestId).toBe(first.registrationRequestId);
    }
  });
});

describe('ivx-registration-orchestrator — partial-failure recovery', () => {
  it('maps "already registered" to EMAIL_EXISTS (non-retryable)', async () => {
    stubRegister({
      success: false,
      message: 'User already registered',
      requiresVerification: false,
      deploymentMarker: 'test',
    });
    const result = await orchestrateRegistration(validInput());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('EMAIL_EXISTS');
      expect(result.retryable).toBe(false);
    }
  });

  it('maps rate-limit to RATE_LIMITED (non-retryable)', async () => {
    stubRegister({
      success: false,
      message: 'Rate limit exceeded',
      requiresVerification: false,
      deploymentMarker: 'test',
    });
    const result = await orchestrateRegistration(validInput());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('RATE_LIMITED');
      expect(result.retryable).toBe(false);
    }
  });

  it('maps generic network error to NETWORK_ERROR (retryable, bounded attempts)', async () => {
    let attempts = 0;
    stubRegisterFn(async () => {
      attempts++;
      return {
        success: false, message: 'fetch failed: network error',
        requiresVerification: false, deploymentMarker: 'test',
      };
    });
    const result = await orchestrateRegistration(validInput());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('NETWORK_ERROR');
      expect(result.retryable).toBe(true);
    }
    // Bounded to 3 attempts (with backoff delays of 0/1s/3s).
    expect(attempts).toBe(3);
  });
});

describe('ivx-registration-orchestrator — resume / status', () => {
  it('getRegistrationStatus returns the persisted stage for a known request', async () => {
    stubRegister({
      success: true,
      userId: 'test-user-id-4',
      email: 'resume@example.com',
      message: 'ok',
      requiresVerification: true,
      deploymentMarker: 'test',
    });
    const requestId = '33333333-3333-4333-8333-333333333333';
    await orchestrateRegistration(validInput({ registrationRequestId: requestId }));
    const status = await getRegistrationStatus(requestId);
    expect(status.found).toBe(true);
    expect(status.state?.stage).toBe('COMPLETED');
    expect(status.state?.finalStatus).toBe('completed');
  });

  it('getRegistrationStatus returns found=false for an unknown request', async () => {
    const status = await getRegistrationStatus('does-not-exist');
    expect(status.found).toBe(false);
    expect(status.state).toBeUndefined();
  });

  it('persisted state never includes the password', async () => {
    stubRegister({
      success: true,
      userId: 'test-user-id-5',
      email: 'secret@example.com',
      message: 'ok',
      requiresVerification: true,
      deploymentMarker: 'test',
    });
    const requestId = '44444444-4444-4444-8444-444444444444';
    const password = 'TopSecretPassphrase123!';
    await orchestrateRegistration(
      validInput({ registrationRequestId: requestId, email: 'secret@example.com', password })
    );
    const persisted = JSON.stringify(_store);
    expect(persisted).not.toContain(password);
    expect(persisted).not.toContain('password');
  });
});

describe('ivx-registration-orchestrator — health endpoint', () => {
  it('checkRegistrationHealth returns a status + checks object without secrets', async () => {
    const health = await checkRegistrationHealth();
    expect(['healthy', 'degraded', 'unhealthy']).toContain(health.status);
    expect(health.checks).toBeTypeOf('object');
    expect(health.checks.registrationServiceOnline).toBe(true);
    // No secrets in the body.
    const body = JSON.stringify(health);
    expect(body).not.toContain('SERVICE_ROLE');
    expect(body).not.toContain('service_role');
  });
});
