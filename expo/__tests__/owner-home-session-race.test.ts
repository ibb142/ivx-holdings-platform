import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dir, '..');
const auth = readFileSync(join(ROOT, 'lib/auth-context.tsx'), 'utf8');

describe('Owner Home session race regression', () => {
  it('serializes startup sign-out before the login UI is unlocked', () => {
    expect(auth).toContain('IVX_STARTUP_SIGNOUT_SERIALIZED_V1');
    expect(auth).toContain("await withTimeout(\n          () => supabase.auth.signOut({ scope: 'local' })");
    expect(auth).toContain("router unlocked after startup signOut");
    expect(auth).not.toContain('router unlocked before signOut');
  });

  it('does not let the hard unlock beat startup cleanup', () => {
    expect(auth).toContain('AUTH_BOOTSTRAP_TIMEOUT_MS + 1000');
  });

  it('uses the direct Supabase owner password path before backend fallback', () => {
    expect(auth).toContain('IVX_OWNER_SUPABASE_DIRECT_PASSWORD_V1');
    const direct = auth.indexOf('IVX_OWNER_SUPABASE_DIRECT_PASSWORD_V1');
    const backendLoop = auth.indexOf('const apiBaseUrls = getOwnerRegistrationApiBaseUrls();', direct);
    expect(direct).toBeGreaterThan(-1);
    expect(backendLoop).toBeGreaterThan(direct);
    expect(auth.slice(direct, backendLoop)).toContain('signInWithEmailPassword(freshClient, normalizedEmail, password)');
  });

  it('does not block Home on owner role/profile maintenance', () => {
    expect(auth).toContain('IVX_OWNER_POST_LOGIN_FAST_PATH_V1');
    expect(auth).toContain('IVX_OWNER_REPAIR_BACKGROUND_V1');
    expect(auth).not.toContain('await repairOwnerRegistrationAfterLogin(session).catch');
  });
});
