import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const profilePath = resolve(import.meta.dir, '../app/(tabs)/profile.tsx');
const source = readFileSync(profilePath, 'utf8');

describe('Profile black-screen regression', () => {
  test('keeps a deterministic visible root surface', () => {
    expect(source).toContain('IVX_PROFILE_FAILSAFE_MARKER');
    expect(source).toContain('testID="profile-root"');
    expect(source).toContain("backgroundColor: '#0A0A0F'");
    expect(source).toContain('Profile');
  });

  test('does not mount optional realtime/network dependencies in the critical tab shell', () => {
    expect(source).not.toContain('useRealtimeTable');
    expect(source).not.toContain("from '@/lib/supabase'");
    expect(source).not.toContain('getMyClassification');
    expect(source).not.toContain('useQuery({');
  });

  test('preserves critical account navigation', () => {
    expect(source).toContain("router.push('/personal-info'");
    expect(source).toContain("router.push('/wallet'");
    expect(source).toContain("router.push('/security-settings'");
    expect(source).toContain("router.push('/admin/ivx-developer-workspace'");
    expect(source).toContain('profile-sign-out');
  });
});
