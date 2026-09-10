import { describe, expect, test } from 'bun:test';
import { redirectSystemPath } from '../app/+native-intent';

describe('native link destinations', () => {
  for (const initial of [true, false]) {
    const mode = initial ? 'cold launch' : 'running app';

    test(`opens the requested Dashboard on ${mode}`, () => {
      expect(redirectSystemPath({ path: 'ivx-app:///admin/dashboard', initial }))
        .toBe('/admin/dashboard');
    });

    test(`preserves Chat and its thread parameters on ${mode}`, () => {
      const path = 'ivx-app:///ivx/chat?threadId=qa-thread#latest';
      expect(redirectSystemPath({ path, initial })).toBe('/ivx/chat?threadId=qa-thread#latest');
    });

    test(`preserves a route already normalized by Expo on ${mode}`, () => {
      expect(redirectSystemPath({ path: '/admin/dashboard', initial }))
        .toBe('/admin/dashboard');
    });

    test(`normalizes root navigation for the tab shell on ${mode}`, () => {
      expect(redirectSystemPath({ path: 'ivx-app:///', initial })).toBe('/');
      expect(redirectSystemPath({ path: '/', initial })).toBe('/');
      expect(redirectSystemPath({ path: '', initial })).toBe('/');
      expect(redirectSystemPath({ path: '  ', initial })).toBe('/');
    });
  }
});
