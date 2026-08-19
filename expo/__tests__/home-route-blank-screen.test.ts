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
 *  2. The blank-screen watchdog armed on a process-wide "has anything ever
 *     painted" flag. The login screen reports a paint, so the flag was already
 *     false by the time the owner signed in — every post-login navigation was
 *     invisible to the watchdog.
 *
 * v1.10.24 adds the inverse defect, recorded on device: the watchdog FIRED on a
 * fully rendered Home. It compared a paint timestamp against an entry timestamp,
 * but Expo Router keeps tab screens MOUNTED, so Home reports its paint once and
 * never again while the watchdog re-armed its entry stamp on every pathname
 * change. The overlay printed the contradiction itself — `Route: /home` above
 * `Last painted: /home`. Paint is now liveness (mounted + painted), not freshness.
 *
 * These tests fail the build if any of these regressions return.
 */
import { describe, expect, it, beforeEach } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import {
  markScreenPainted,
  markScreenUnmounted,
  hasRouteFailedToPaint,
  isRoutePainted,
  isRouteInstrumented,
  getRoutePaintedAt,
  resetPaintTracking,
} from '../lib/screen-paint-watchdog';

const APP_DIR = join(import.meta.dir, '..', 'app');
const TABS_DIR = join(APP_DIR, '(tabs)');

function read(relativePath: string): string {
  return readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');
}

function exists(relativePath: string): boolean {
  return existsSync(join(import.meta.dir, '..', relativePath));
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

  it('the overlay that could paint the whole screen black is gone', () => {
    expect(exists('components/BlankScreenWatchdog.tsx')).toBe(false);
    expect(read('app/_providers.tsx')).not.toContain('BlankScreenWatchdog');
  });

  /** THE REGRESSION: login painted, so home could never be judged blank. */
  it('a blank home is detected even though login already painted', () => {
    markScreenPainted('/login');
    expect(hasRouteFailedToPaint('/home')).toBe(true);
  });

  it('a home that paints is not flagged', () => {
    markScreenPainted('/home');
    expect(hasRouteFailedToPaint('/home')).toBe(false);
  });

  it('a blank re-entry is caught because the previous visit deregistered', () => {
    markScreenPainted('/home');
    markScreenUnmounted('/home');
    expect(hasRouteFailedToPaint('/home')).toBe(true);
  });

  it('uninstrumented routes are never accused of being blank', () => {
    expect(isRouteInstrumented('/market')).toBe(false);
    expect(hasRouteFailedToPaint('/market')).toBe(false);
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

/**
 * v1.10.24 — the watchdog fired on a WORKING Home screen.
 *
 * Recorded on device: the overlay rendered `Route: /home` directly above
 * `Last painted: /home`, covering a Home screen whose content was visible in the
 * frames immediately before and after. A false "Screen failed to load" over
 * working UI is a worse defect than the blank screen it guards against.
 */
describe('Defect 3 — the watchdog must never accuse a screen that painted', () => {
  beforeEach(() => {
    resetPaintTracking();
  });

  /**
   * THE REGRESSION, exactly as recorded.
   *
   * Expo Router keeps tab screens mounted, so Home's `useEffect(..., [])` fires
   * once. Time then passes — the user reads the screen, switches tabs, returns.
   * The old check compared that one old paint against a fresh entry stamp and
   * declared the visible screen blank.
   */
  it('a mounted home that painted long ago is never flagged, however long ago', () => {
    markScreenPainted('/home');
    expect(hasRouteFailedToPaint('/home')).toBe(false);
    expect(isRoutePainted('/home')).toBe(true);
  });

  /** The self-contradiction the overlay printed must be unrepresentable. */
  it('a route reported as last-painted can never simultaneously be accused', () => {
    markScreenPainted('/home');
    const accused = hasRouteFailedToPaint('/home');
    const isLastPainted = isRoutePainted('/home');
    expect(accused && isLastPainted).toBe(false);
  });

  it('the blank check does not depend on any entry timestamp', () => {
    const src = read('lib/screen-paint-watchdog.ts');
    const code = src.slice(src.indexOf('let lastPaintedScreen'));
    expect(code).toContain('export function hasRouteFailedToPaint(route: string)');
    expect(code).not.toContain('enteredAt');
  });

  it('screens deregister their paint on unmount so liveness stays honest', () => {
    expect(read('app/(tabs)/home.tsx')).toContain("markScreenUnmounted('/home')");
    expect(read('app/login.tsx')).toContain("markScreenUnmounted('/login')");
  });

  it('login reports the router pathname so its route key matches', () => {
    const login = read('app/login.tsx');
    expect(login).toContain("markScreenPainted('/login')");
    expect(login).not.toContain("markScreenPainted('login')");
  });

  /**
   * Both of these defects were properties of the overlay itself. Deleting the
   * overlay removes the entire class of failure — there is no accused route, no
   * recovery navigation and no dismissal state left to get wrong.
   */
  it('no component can accuse a route or navigate a recovery bounce', () => {
    expect(exists('components/BlankScreenWatchdog.tsx')).toBe(false);
  });
});

/**
 * Defect 4 (v1.10.25) — THE BLACK SCREEN ITSELF.
 *
 * Route `/` was listed in INSTRUMENTED_ROUTES, so the watchdog was allowed to
 * judge it, but NO screen in the app ever called `markScreenPainted('/')` —
 * only `/home` and `/login` reported. `/` could therefore never satisfy the
 * paint check: landing on it for 8 seconds ALWAYS produced an accusation, by
 * construction.
 *
 * Worse, `app/index.tsx` returned a bare `<Redirect />` on every branch, and
 * `<Redirect />` renders null. Route `/` painted ZERO pixels until the router
 * committed the destination — and if it never committed, that empty container
 * stayed forever, silently. The recording measured 14 seconds of #0A0A0F.
 *
 * And v1.10.24's recovery button navigated the user directly onto `/`.
 */
describe('Defect 4: the root route was an unpaintable empty container', () => {
  /**
   * THE INVARIANT THAT WOULD HAVE CAUGHT THIS BEFORE IT SHIPPED.
   * Every route the watchdog may judge must have a screen that reports a paint
   * for that exact key, otherwise the accusation is guaranteed and false.
   */
  it('every instrumented route has a screen that reports a paint for it', () => {
    const watchdog = read('lib/screen-paint-watchdog.ts');
    const declared = watchdog.match(/INSTRUMENTED_ROUTES = new Set<string>\(\[([^\]]+)\]/);
    expect(declared).not.toBeNull();

    const routes = (declared as RegExpMatchArray)[1]
      .split(',')
      .map((r) => r.trim().replace(/^'|'$/g, ''))
      .filter((r) => r.length > 0);
    expect(routes.length).toBeGreaterThan(0);

    // Strip comments first. Scanning raw text let a DOC COMMENT that merely
    // mentioned a call satisfy the invariant — a false pass that would have let
    // this exact defect through a second time.
    const stripComments = (src: string): string =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    const screenSources = ['app/index.tsx', 'app/(tabs)/home.tsx', 'app/login.tsx']
      .map((f) => stripComments(read(f)))
      .join('\n');

    for (const route of routes) {
      expect({ route, reported: screenSources.includes(`markScreenPainted('${route}')`) })
        .toEqual({ route, reported: true });
      expect({ route, released: screenSources.includes(`markScreenUnmounted('${route}')`) })
        .toEqual({ route, released: true });
    }
  });

  it('the root route renders visible content on EVERY branch, never a bare redirect', () => {
    const index = read('app/index.tsx');
    // A bare `return <Redirect .../>` paints nothing. It must not exist.
    expect(index).not.toMatch(/return\s+<Redirect/);
    expect(index).toContain('testID="index-route"');
  });

  it('the root route reports and releases its paint', () => {
    const index = read('app/index.tsx');
    expect(index).toContain("markScreenPainted('/')");
    expect(index).toContain("markScreenUnmounted('/')");
  });

  it('the root route still paints even with the watchdog gone', () => {
    // The overlay is deleted, but `/` must still render real content on every
    // branch — that was a genuine defect independent of the watchdog.
    expect(isRouteInstrumented('/')).toBe(true);
    expect(read('app/index.tsx')).toContain("markScreenPainted('/')");
  });

  it('runtime: the root route is not accused once it reports its paint', () => {
    resetPaintTracking();
    expect(isRouteInstrumented('/')).toBe(true);
    // Before paint (screen not yet mounted) it is correctly judged blank.
    expect(hasRouteFailedToPaint('/')).toBe(true);
    // After the screen mounts and paints, it must never be accused.
    markScreenPainted('/');
    expect(hasRouteFailedToPaint('/')).toBe(false);
    // And it is released on unmount so a genuinely blank re-entry is caught.
    markScreenUnmounted('/');
    expect(hasRouteFailedToPaint('/')).toBe(true);
  });

  it('recovery from Home lands on a route that paints, breaking the loop', () => {
    resetPaintTracking();
    markScreenPainted('/home');
    markScreenUnmounted('/home'); // Home unmounts as recovery navigates away
    markScreenPainted('/'); // root route paints immediately on mount
    expect(hasRouteFailedToPaint('/')).toBe(false);
  });
});
