/**
 * Guard tests for the Home black screen (v1.10.23).
 *
 * Two defects made a blank Home screen both POSSIBLE and UNDETECTABLE:
 *
 *  1. The home tab pointed at a nested route group, `(tabs)/(home)`. A group
 *     contributes no path segment, so that group could never contain an
 *     `index.tsx` — it would collide with `app/index.tsx` on `/`. The group's
 *     entry screen therefore had to be resolved purely from an `anchor` string,
 *     and when that resolution produced nothing there was no screen to render
 *     and no error to throw: a silent dark frame.
 *
 *  2. The blank-screen watchdog armed on `hasNeverPainted()`, a process-wide
 *     flag. The login screen reports a paint, so the flag was already false by
 *     the time the owner signed in — every post-login navigation was invisible
 *     to the watchdog.
 *
 * These tests fail the build if either regression returns.
 */
import { describe, expect, it, beforeEach } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import {
  markScreenPainted,
  hasRouteFailedToPaint,
  isRouteInstrumented,
  getRoutePaintedAt,
  resetPaintTracking,
} from '../lib/screen-paint-watchdog';

const APP_DIR = join(import.meta.dir, '..', 'app');
const TABS_DIR = join(APP_DIR, '(tabs)');

function read(relativePath: string): string {
  return readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');
}

describe('Defect 1 — home tab must resolve to a leaf screen, not a group anchor', () => {
  it('the nested (home) route group no longer exists', () => {
    expect(existsSync(join(TABS_DIR, '(home)'))).toBe(false);
  });

  it('home is a real leaf screen file', () => {
    expect(existsSync(join(TABS_DIR, 'home.tsx'))).toBe(true);
  });

  it('the tabs layout registers the leaf screen name "home"', () => {
    const layout = read('app/(tabs)/_layout.tsx');
    expect(layout).toContain('name="home"');
    expect(layout).not.toContain('name="(home)"');
  });

  it('the tabs anchor points at the leaf screen, not a group', () => {
    const layout = read('app/(tabs)/_layout.tsx');
    expect(layout).toContain("anchor: 'home'");
    expect(layout).not.toContain("anchor: '(home)'");
  });

  it('no route reference points at the deleted group path', () => {
    const offenders: string[] = [];
    // Strip line comments so the explanatory note describing the old path in
    // (tabs)/_layout.tsx is not mistaken for a live route reference.
    const stripComments = (source: string): string =>
      source
        .split('\n')
        .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
        .join('\n');
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) {
          if (stripComments(readFileSync(full, 'utf8')).includes('(tabs)/(home)')) offenders.push(full);
        }
      }
    };
    walk(APP_DIR);
    expect(offenders).toEqual([]);
  });

  /**
   * The structural invariant behind defect 1: every directory under app/ that
   * has a `_layout.tsx` must also contain a screen file that can serve as its
   * entry. A layout with no sibling screen renders its container background and
   * nothing else — the exact silent black frame that was recorded on device.
   */
  it('every layout directory contains at least one screen file', () => {
    const emptyLayouts: string[] = [];
    const walk = (dir: string): void => {
      const entries = readdirSync(dir, { withFileTypes: true });
      const hasLayout = entries.some((e) => e.isFile() && e.name === '_layout.tsx');
      if (hasLayout) {
        const screens = entries.filter(
          (e) => e.isFile() && e.name.endsWith('.tsx') && !e.name.startsWith('_') && !e.name.startsWith('+'),
        );
        const subRoutes = entries.filter((e) => e.isDirectory());
        if (screens.length === 0 && subRoutes.length === 0) emptyLayouts.push(dir);
      }
      for (const entry of entries) {
        if (entry.isDirectory()) walk(join(dir, entry.name));
      }
    };
    walk(APP_DIR);
    expect(emptyLayouts).toEqual([]);
  });
});

describe('Defect 2 — the watchdog must detect a blank screen AFTER login', () => {
  beforeEach(() => {
    resetPaintTracking();
  });

  it('home reports the router pathname, not the file path', () => {
    const home = read('app/(tabs)/home.tsx');
    expect(home).toContain("markScreenPainted('/home')");
    expect(home).not.toContain("markScreenPainted('(tabs)/home')");
  });

  it('the watchdog no longer arms on the process-wide hasNeverPainted flag', () => {
    const watchdog = read('components/BlankScreenWatchdog.tsx');
    // Ignore the explanatory header comment; assert on the executable source only.
    const code = watchdog.slice(watchdog.indexOf('import React'));
    expect(code).not.toContain('hasNeverPainted');
    expect(code).toContain('hasRouteFailedToPaint(pathname, enteredAt)');
  });

  /** THE REGRESSION: login painted, so home could never be judged blank. */
  it('a blank home is detected even though login already painted', () => {
    markScreenPainted('/login');
    const enteredHomeAt = Date.now();
    expect(hasRouteFailedToPaint('/home', enteredHomeAt)).toBe(true);
  });

  it('a home that paints after entry is not flagged', () => {
    const enteredHomeAt = Date.now() - 10;
    markScreenPainted('/home');
    expect(hasRouteFailedToPaint('/home', enteredHomeAt)).toBe(false);
  });

  it('a stale paint from a PREVIOUS visit does not mask a blank re-entry', () => {
    markScreenPainted('/home');
    const reEnteredAt = Date.now() + 1000;
    expect(hasRouteFailedToPaint('/home', reEnteredAt)).toBe(true);
  });

  it('uninstrumented routes are never accused of being blank', () => {
    expect(isRouteInstrumented('/market')).toBe(false);
    expect(hasRouteFailedToPaint('/market', Date.now())).toBe(false);
  });

  it('home and login are instrumented', () => {
    expect(isRouteInstrumented('/home')).toBe(true);
    expect(isRouteInstrumented('/login')).toBe(true);
  });

  it('trailing slashes and missing leading slashes normalise to one route', () => {
    markScreenPainted('home');
    expect(getRoutePaintedAt('/home')).not.toBeNull();
    expect(getRoutePaintedAt('/home/')).not.toBeNull();
  });

  it('paint tracking is per route, not a single global flag', () => {
    markScreenPainted('/login');
    expect(getRoutePaintedAt('/login')).not.toBeNull();
    expect(getRoutePaintedAt('/home')).toBeNull();
  });
});
