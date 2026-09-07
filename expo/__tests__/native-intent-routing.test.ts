import { describe, expect, test } from 'bun:test';
import { redirectSystemPath } from '../app/+native-intent';

describe('native link destinations', () => {
  for (const initial of [true, false]) {
    const mode = initial ? 'cold launch' : 'running app';

    test(`opens the requested Dashboard on ${mode}`, () => {
      expect(redirectSystemPath({ path: 'ivx-app:///admin/dashboard', initial }))
        .toBe('ivx-app:///admin/dashboard');
    });

    test(`preserves Chat and its thread parameters on ${mode}`, () => {
      const path = 'ivx-app:///ivx/chat?threadId=qa-thread#latest';
      expect(redirectSystemPath({ path, initial })).toBe(path);
    });

    test(`preserves a route already normalized by Expo on ${mode}`, () => {
      expect(redirectSystemPath({ path: '/admin/dashboard', initial }))
        .toBe('/admin/dashboard');
    });

    test(`keeps root navigation usable on ${mode}`, () => {
      expect(redirectSystemPath({ path: 'ivx-app:///', initial })).toBe('ivx-app:///');
      expect(redirectSystemPath({ path: '/', initial })).toBe('/');
      expect(redirectSystemPath({ path: '', initial })).toBe('/');
      expect(redirectSystemPath({ path: '  ', initial })).toBe('/');
    });
  }
});
