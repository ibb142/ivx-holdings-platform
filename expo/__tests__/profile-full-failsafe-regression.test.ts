import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(import.meta.dir, '../app/(tabs)/profile.tsx'), 'utf8');

const requiredRoutes = [
  '/personal-info', '/kyc-verification', '/tax-info', '/wallet',
  '/analytics-report', '/sms-reports', '/investor-prospectus', '/statements',
  '/tax-documents', '/contract-generator', '/language', '/notification-settings',
  '/security-settings', '/vip-tiers', '/gift-shares', '/auto-reinvest',
  '/copy-investing', '/viral-growth', '/referrals', '/agent-apply', '/broker-apply',
  '/business-card', '/agent-hub', '/knowledge-base', '/app-guide', '/app-demo',
  '/(tabs)/chat', '/legal', '/ai-automation-report', '/api-list', '/admin',
  '/company-info', '/admin/ivx-developer-workspace',
];

describe('Profile full fail-safe regression', () => {
  test('always paints a deterministic visible Profile surface', () => {
    expect(source).toContain('IVX_PROFILE_FULL_FAILSAFE_MARKER');
    expect(source).toContain('testID="profile-root"');
    expect(source).toContain('testID="profile-title"');
    expect(source).toContain("backgroundColor: '#08090D'");
  });

  test('keeps remote and realtime side effects out of the critical Profile mount', () => {
    expect(source).not.toContain('useRealtimeTable');
    expect(source).not.toContain("from '@/lib/supabase'");
    expect(source).not.toContain('getMyClassification');
    expect(source).not.toContain('useQuery(');
    expect(source).not.toContain('IVXImage');
  });

  test('preserves every original Profile module route', () => {
    for (const route of requiredRoutes) {
      expect(source).toContain(route);
    }
  });

  test('preserves owner and sign-out controls', () => {
    expect(source).toContain('owner-login-button');
    expect(source).toContain('profile-sign-out');
    expect(source).toContain('void logout()');
  });
});
