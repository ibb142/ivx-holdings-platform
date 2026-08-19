/**
 * Regression guard for the Android black screen.
 *
 * Root cause (v1.10.21): `app/(tabs)/(home)/` had no `index` route, so the group
 * relied on `unstable_settings.initialRouteName` to resolve to `home`. Expo
 * Router v6 renamed that key to `anchor`, so the setting was silently ignored
 * and the group resolved to NO screen — rendering nothing, throwing nothing,
 * logging nothing. A black frame with no error.
 *
 * Follow-up root cause (v1.10.23): declaring `anchor` was still not enough. A
 * route group carries no path segment, so `(tabs)/(home)` could never hold an
 * `index.tsx` — it would collide with `app/index.tsx` on `/`. That made the home
 * tab the only tab whose entry screen had to be resolved from a string, and when
 * that resolution produced nothing the result was again a silent dark frame. The
 * group was removed: the home tab now points at the leaf screen `(tabs)/home.tsx`,
 * which has nothing to resolve and cannot fail this way.
 *
 * These tests fail if the group is reintroduced or any tab route becomes
 * unresolvable.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';

const APP_DIR = join(import.meta.dir, '..', 'app');

function read(relativePath: string): string {
  return readFileSync(join(APP_DIR, relativePath), 'utf8');
}

describe('expo-router v6 anchor resolution', () => {
  test('the home tab is a leaf screen, not a nested route group', () => {
    expect(existsSync(join(APP_DIR, '(tabs)', '(home)'))).toBe(false);
    expect(existsSync(join(APP_DIR, '(tabs)', 'home.tsx'))).toBe(true);
  });

  test('(tabs) layout anchors at the leaf home screen', () => {
    const src = read('(tabs)/_layout.tsx');
    expect(src).toContain('unstable_settings');
    expect(src).toMatch(/anchor:\s*'home'/);
    expect(src).not.toMatch(/anchor:\s*'\(home\)'/);
  });

  test('the anchor target route file actually exists', () => {
    const src = read('(tabs)/_layout.tsx');
    const anchor = /anchor:\s*'([^']+)'/.exec(src)?.[1];
    expect(anchor).toBeDefined();
    expect(existsSync(join(APP_DIR, '(tabs)', `${anchor}.tsx`))).toBe(true);
  });

  test('every route group under (tabs) resolves via an index route or an anchor', () => {
    const tabsDir = join(APP_DIR, '(tabs)');
    const groups = readdirSync(tabsDir).filter((entry) => {
      const full = join(tabsDir, entry);
      return statSync(full).isDirectory();
    });

    const unresolvable: string[] = [];
    for (const group of groups) {
      const dir = join(tabsDir, group);
      const hasIndex =
        existsSync(join(dir, 'index.tsx')) || existsSync(join(dir, 'index.ts'));
      const layoutPath = join(dir, '_layout.tsx');
      const hasAnchor =
        existsSync(layoutPath) && /anchor:\s*'[^']+'/.test(readFileSync(layoutPath, 'utf8'));
      if (!hasIndex && !hasAnchor) unresolvable.push(group);
    }

    expect(unresolvable).toEqual([]);
  });
});

describe('post-login navigation target', () => {
  test('login navigates to a route file that exists', () => {
    const src = read('login.tsx');
    const targets = [...src.matchAll(/'\/\(tabs\)\/home'/g)];
    expect(targets.length).toBeGreaterThan(0);
    expect(existsSync(join(APP_DIR, '(tabs)', 'home.tsx'))).toBe(true);
  });

  test('no navigation target still points at the deleted (home) group', () => {
    const src = read('login.tsx');
    expect(src).not.toContain('(tabs)/(home)');
  });
});

describe('blank screen watchdog removal', () => {
  /**
   * The watchdog mounted a full-screen OPAQUE #0A0A0F overlay at zIndex 9999
   * directly above the whole app. It never caught a real defect, it twice
   * accused working screens, and its recovery button navigated into a route
   * that rendered nothing. A diagnostic that can paint the entire screen
   * near-black is not a safety net — it is another way to get a black screen.
   */
  test('the watchdog is no longer mounted above the app', () => {
    const src = read('_providers.tsx');
    expect(src).not.toContain('<BlankScreenWatchdog');
    expect(src).not.toContain("from '@/components/BlankScreenWatchdog'");
  });

  test('no full-screen opaque overlay is mounted above the router', () => {
    const src = read('_providers.tsx');
    expect(src).not.toContain('absoluteFillObject');
    expect(src).not.toContain('zIndex: 9999');
  });

  test('home and login report a successful paint', () => {
    expect(read('(tabs)/home.tsx')).toContain('markScreenPainted');
    expect(read('login.tsx')).toContain('markScreenPainted');
  });
});
