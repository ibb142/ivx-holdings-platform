import { expect, test } from 'bun:test';
import { redirectSystemPath } from '../../expo/app/+native-intent';

test('owner dashboard and fleet links preserve their destination on warm and cold launch', () => {
  for (const initial of [true, false]) {
    for (const path of ['ivx-app:///admin/dashboard', 'ivx-app://admin/dashboard', '/admin/dashboard']) {
      expect(redirectSystemPath({ path, initial })).toBe('/admin/dashboard');
    }
    expect(redirectSystemPath({ path: 'ivx-app:///ivx/autonomous-ops?range=24h', initial })).toBe('/ivx/autonomous-ops?range=24h');
    expect(redirectSystemPath({ path: 'https://chat.ivxholding.com/ivx/autonomous-ops', initial })).toBe('/ivx/autonomous-ops');
  }
});
test('invalid and unrelated external URLs return safely to the shell', () => {
  for (const path of ['invalid', '//untrusted.example', 'javascript:alert(1)', 'https://untrusted.example/admin', 'ivx-app://user:pass@admin/dashboard']) {
    expect(redirectSystemPath({ path, initial: false })).toBe('/');
  }
});
