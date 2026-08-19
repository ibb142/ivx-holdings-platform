/**
 * Regression guard for the Android black screen.
 *
 * Root cause: `app/(tabs)/(home)/` has no `index` route, so the group relied on
 * `unstable_settings.initialRouteName` to resolve to `home`. Expo Router v6
 * renamed that key to `anchor`, so the setting was silently ignored and the
 * group resolved to NO screen — rendering nothing, throwing nothing, logging
 * nothing. A black frame with no error.
 *
 * These tests fail if the anchor is ever dropped or a route group is added
 * without a resolvable entry route.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';

const APP_DIR = join(import.meta.dir, '..', 'app');

function read(relativePath: string): string {
  return readFileSync(join(APP_DIR, relativePath), 'utf8');
}

describe('expo-router v6 anchor resolution', () => {
  test('(home) layout declares an anchor so the group resolves to a screen', () => {
    const src = read('(tabs)/(home)/_layout.tsx');
    expect(src).toContain('unstable_settings');
    expect(src).toMatch(/anchor:\s*'home'/);
  });

  test('(tabs) layout declares an anchor pointing at the home group', () => {
    const src = read('(tabs)/_layout.tsx');
    expect(src).toContain('unstable_settings');
    expect(src).toMatch(/anchor:\s*'\(home\)'/);
  });

  test('the anchor target route file actually exists', () => {
    expect(existsSync(join(APP_DIR, '(tabs)', '(home)', 'home.tsx'))).toBe(true);
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
    const targets = [...src.matchAll(/router\.replace\('\/\(tabs\)\/\(home\)\/home'/g)];
    expect(targets.length).toBeGreaterThan(0);
    expect(existsSync(join(APP_DIR, '(tabs)', '(home)', 'home.tsx'))).toBe(true);
  });
});

describe('blank screen watchdog wiring', () => {
  test('watchdog is mounted inside the provider tree', () => {
    const src = read('_providers.tsx');
    expect(src).toContain('BlankScreenWatchdog');
  });

  test('home and login report a successful paint', () => {
    expect(read('(tabs)/(home)/home.tsx')).toContain('markScreenPainted');
    expect(read('login.tsx')).toContain('markScreenPainted');
  });
});
