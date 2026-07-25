import { describe, it, expect } from 'bun:test';
import { handleIVXOwnerAccessRepairRequest } from './api/ivx-owner-registration';

const MISMATCHED_URL = 'https://biikwnqdhsdzyxecekht.supabase.co';
const ALLOWED_EMAIL = 'owner-mismatch-test@ivx.example.com';
const TEST_PASSWORD = 'Regression-Fixture-Passw0rd-1';

// A fake JWT whose payload claims service_role for the REAL production project.
// The guard only decodes the payload; it does not verify the signature, so a
// dummy signature is fine for this regression test. The important part is that
// the key's ref (kvclcdjmjghndxsngfzb) does not match the env URL's ref
// (biikwnqdhsdzyxecekht), which is exactly the scenario that caused the
// owner login failure.
const FAKE_PRODUCTION_SERVICE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2Y2xjZGptamdobmR4c25nZnpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzE5NDAyNywiZXhwIjoyMDg4NzcwMDI3fQ.' +
  'dummy-signature';

const FAKE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2Y2xjZGptamdobmR4c25nZnpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxOTQwMjcsImV4cCI6MjA4ODc3MDAyN30.' +
  'dummy-signature';

function buildRequest(body: Record<string, unknown>): Request {
  return new Request('https://api.ivxholding.com/api/ivx/owner-access-repair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Owner access repair — Supabase URL/service-role key mismatch guard', () => {
  it('returns 503 with a clear project mismatch error instead of touching the wrong project', async () => {
    const prevUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
    const prevServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const prevAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    const prevAllowlist = process.env.IVX_OWNER_REGISTRATION_EMAILS;

    try {
      process.env.EXPO_PUBLIC_SUPABASE_URL = MISMATCHED_URL;
      process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_PRODUCTION_SERVICE_KEY;
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = FAKE_ANON_KEY;
      process.env.IVX_OWNER_REGISTRATION_EMAILS = ALLOWED_EMAIL;

      const response = await handleIVXOwnerAccessRepairRequest(
        buildRequest({ email: ALLOWED_EMAIL, newPassword: TEST_PASSWORD }),
      );

      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.ok).toBe(false);
      expect(body.message).toContain('project mismatch');
      expect(body.message).toContain('biikwnqdhsdzyxecekht');
      expect(body.message).toContain('kvclcdjmjghndxsngfzb');
      expect(body.message).toContain('project mismatch');
      expect(body.secretValuesReturned).toBe(false);
    } finally {
      process.env.EXPO_PUBLIC_SUPABASE_URL = prevUrl;
      process.env.SUPABASE_SERVICE_ROLE_KEY = prevServiceKey;
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = prevAnonKey;
      process.env.IVX_OWNER_REGISTRATION_EMAILS = prevAllowlist;
    }
  });
});