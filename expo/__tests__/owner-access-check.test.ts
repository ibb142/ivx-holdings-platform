import { beforeAll, describe, expect, mock, test } from 'bun:test';

// Mock @supabase/supabase-js before any imports that reference it
mock.module('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: null }, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }) }),
  }),
}));

// Force strict (non-open-access) mode and a configured owner email BEFORE the
// modules under test are imported, since the owner email is captured at module
// load time. This mirrors a real production build where login is required.
process.env.EXPO_PUBLIC_IVX_OPEN_ACCESS_MODE = 'false';
process.env.IVX_OPEN_ACCESS_MODE = 'false';
process.env.EXPO_PUBLIC_IVX_TEST_MODE = 'false';
process.env.IVX_TEST_MODE = 'false';
process.env.EXPO_PUBLIC_OWNER_EMAIL = 'owner@ivx.holdings';

type OwnerStatusModule = typeof import('@/lib/owner-access-check');

let resolveOwnerStatus: OwnerStatusModule['resolveOwnerStatus'];
let checkOwnerAccess: OwnerStatusModule['checkOwnerAccess'];

beforeAll(async () => {
  const mod = await import('@/lib/owner-access-check');
  resolveOwnerStatus = mod.resolveOwnerStatus;
  checkOwnerAccess = mod.checkOwnerAccess;
});

const ownerUser = { id: 'u-owner', email: 'owner@ivx.holdings' };
const ownerProfile = { role: 'owner' as const };
const investorUser = { id: 'u-investor', email: 'someone@example.com' };
const investorProfile = { role: 'investor' as const };

describe('resolveOwnerStatus', () => {
  test('owner stays granted after reload (session + owner profile restored)', () => {
    const status = resolveOwnerStatus({ authLoaded: true, user: ownerUser, profile: ownerProfile });
    expect(status.ownerAccessGranted).toBe(true);
    expect(status.failureReason).toBeNull();
    expect(status.sessionPresent).toBe(true);
    expect(status.ownerRoleFromProfile).toBe(true);
  });

  test('owner controls are NOT denied while auth is still hydrating', () => {
    // No reason should surface before hydration completes, so the UI shows a
    // loading state rather than hiding owner controls with a denial.
    const status = resolveOwnerStatus({ authLoaded: false, user: null, profile: null });
    expect(status.authLoaded).toBe(false);
    expect(status.ownerAccessGranted).toBe(false);
    expect(status.failureReason).toBeNull();
  });

  test('owner email match grants access after token refresh even with no profile role', () => {
    // Simulates role temporarily missing right after a token refresh: the
    // configured owner email alone keeps owner access.
    const status = resolveOwnerStatus({ authLoaded: true, user: ownerUser, profile: null });
    expect(status.ownerEmailConfigured).toBe(true);
    expect(status.ownerEmailMatch).toBe(true);
    expect(status.ownerAccessGranted).toBe(true);
  });

  test('owner email match is case/space insensitive', () => {
    const status = resolveOwnerStatus({
      authLoaded: true,
      user: { id: 'u', email: '  Owner@IVX.Holdings  ' },
      profile: null,
    });
    expect(status.ownerEmailMatch).toBe(true);
    expect(status.ownerAccessGranted).toBe(true);
  });

  test('non-owner cannot see owner controls and gets a clear reason', () => {
    const status = resolveOwnerStatus({ authLoaded: true, user: investorUser, profile: investorProfile });
    expect(status.ownerAccessGranted).toBe(false);
    expect(status.failureReason).toBe('This account is not the configured owner email and has no owner role.');
  });

  test('logged out (after logout clears session) reports not logged in', () => {
    const status = resolveOwnerStatus({ authLoaded: true, user: null, profile: null });
    expect(status.sessionPresent).toBe(false);
    expect(status.ownerAccessGranted).toBe(false);
    expect(status.failureReason).toBe('Not logged in. Open Owner Login to continue.');
  });

  test('debug-safe status object exposes only booleans + reason (no secrets)', () => {
    const status = resolveOwnerStatus({ authLoaded: true, user: ownerUser, profile: ownerProfile });
    expect(Object.keys(status).sort()).toEqual([
      'authLoaded',
      'failureReason',
      'ownerAccessGranted',
      'ownerEmailConfigured',
      'ownerEmailMatch',
      'ownerRoleFromProfile',
      'sessionPresent',
      'userEmailPresent',
    ]);
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain('owner@ivx.holdings');
  });
});

describe('checkOwnerAccess derives from the same source of truth', () => {
  test('owner allowed, non-owner denied with reason', () => {
    expect(checkOwnerAccess(ownerUser, ownerProfile).allowed).toBe(true);
    const denied = checkOwnerAccess(investorUser, investorProfile);
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBeTruthy();
  });

  test('owner flag on profile (no role) still grants access', () => {
    expect(checkOwnerAccess(investorUser, { ownerAccess: true }).allowed).toBe(true);
    expect(checkOwnerAccess(investorUser, { isOwner: true }).allowed).toBe(true);
  });
});