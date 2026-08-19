/**
 * Guard tests for THE Home black screen — the latched auth error (v1.10.26).
 *
 * The defect, in one sentence: `authInitError` was set when the startup timeout
 * fired and was then NEVER cleared, because resolving auth only reset
 * `loadingTimedOut`.
 *
 * Why that painted Home black and stayed black:
 *
 *   1. The `if (authInitError)` branch in `app/(tabs)/_layout.tsx` returns BEFORE
 *      <Tabs> is rendered. While it is truthy, the entire tab tree — Home
 *      included — does not exist.
 *   2. Nothing threw. No error boundary fired, no crash was logged, no error
 *      screen reported it. A single slow launch silently replaced the whole app
 *      for the rest of the session.
 *   3. Auth succeeding did not bring Home back. Navigating did not bring Home
 *      back. Only killing the process did.
 *
 * The fix is one line — `setAuthInitError(null)` in the `!isLoading` branch —
 * which is exactly the kind of line a refactor deletes without noticing, since
 * removing it breaks nothing that any other test asserts. These tests exist so
 * that deletion fails the build.
 *
 * They are deliberately BEHAVIOURAL (a state machine mirroring the effect) plus
 * STRUCTURAL (the source must keep the clearing line). The behavioural half
 * proves the recovery is real; the structural half proves the real component,
 * not just this file's copy of the logic, still does it.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const EXPO_DIR = join(import.meta.dir, '..');
const TABS_DIR = join(EXPO_DIR, 'app', '(tabs)');

function readTabs(file: string): string {
  return readFileSync(join(TABS_DIR, file), 'utf8');
}

const layoutSource: string = readTabs('_layout.tsx');

/** Screen the tabs layout actually renders, given its state. */
type RenderedScreen = 'skeleton' | 'error' | 'tabs';

interface TabsState {
  isLoading: boolean;
  loadingTimedOut: boolean;
  authInitError: string | null;
}

/**
 * Mirrors the `useEffect([isLoading])` in the tabs layout. The `!isLoading`
 * branch MUST clear both pieces of state; clearing only `loadingTimedOut` is
 * precisely the shipped defect.
 */
function onAuthLoadingChanged(state: TabsState, isLoading: boolean): TabsState {
  if (!isLoading) {
    return { isLoading: false, loadingTimedOut: false, authInitError: null };
  }
  return { ...state, isLoading: true };
}

/** Mirrors the startup timeout callback. */
function onStartupTimeoutFired(state: TabsState): TabsState {
  return {
    ...state,
    loadingTimedOut: true,
    authInitError: 'IVX startup took too long. Tap below to open Owner Login.',
  };
}

/** Mirrors the render-time branch order of the layout component. */
function renderedScreen(state: TabsState): RenderedScreen {
  const effectiveLoading = state.isLoading && !state.loadingTimedOut;
  if (effectiveLoading) return 'skeleton';
  if (state.authInitError) return 'error';
  return 'tabs';
}

const coldLaunch: TabsState = {
  isLoading: true,
  loadingTimedOut: false,
  authInitError: null,
};

describe('THE regression — a fired startup timeout must not latch Home off', () => {
  it('a healthy launch renders the tab tree', () => {
    expect(renderedScreen(onAuthLoadingChanged(coldLaunch, false))).toBe('tabs');
  });

  it('a slow launch shows the recoverable error screen, never a blank frame', () => {
    expect(renderedScreen(onStartupTimeoutFired(coldLaunch))).toBe('error');
  });

  it('auth resolving AFTER the timeout fired restores Home', () => {
    const timedOut = onStartupTimeoutFired(coldLaunch);
    expect(renderedScreen(timedOut)).toBe('error');

    const resolved = onAuthLoadingChanged(timedOut, false);

    // The shipped bug: `authInitError` survived here, so this stayed 'error'
    // forever and Home never came back for the rest of the session.
    expect(resolved.authInitError).toBeNull();
    expect(renderedScreen(resolved)).toBe('tabs');
  });

  it('recovery is not one-shot — a slow launch on every cycle still recovers', () => {
    let state: TabsState = coldLaunch;
    for (let cycle = 0; cycle < 5; cycle += 1) {
      state = onStartupTimeoutFired(state);
      expect(renderedScreen(state)).toBe('error');
      state = onAuthLoadingChanged(state, false);
      expect(renderedScreen(state)).toBe('tabs');
      state = { ...state, isLoading: true };
    }
  });

  it('clearing only loadingTimedOut — the exact shipped defect — is caught here', () => {
    const buggyResolve = (state: TabsState): TabsState => ({
      ...state,
      isLoading: false,
      loadingTimedOut: false,
    });

    const latched = buggyResolve(onStartupTimeoutFired(coldLaunch));
    expect(renderedScreen(latched)).toBe('error');
    expect(renderedScreen(latched)).not.toBe('tabs');
  });
});

describe('The real component must keep the one line that clears the error', () => {
  it('the !isLoading branch clears authInitError, not just loadingTimedOut', () => {
    const start = layoutSource.indexOf('if (!isLoading) {');
    expect(start).toBeGreaterThan(-1);

    const branch = layoutSource.slice(start, layoutSource.indexOf('return;', start));
    expect(branch).toContain('setLoadingTimedOut(false)');
    expect(branch).toContain('setAuthInitError(null)');
  });

  it('the error branch renders a real action and never returns null', () => {
    const start = layoutSource.indexOf('if (authInitError) {');
    expect(start).toBeGreaterThan(-1);

    const branch = layoutSource.slice(start, layoutSource.indexOf('logStartup(', start));
    expect(branch).not.toContain('return null');
    expect(branch).toContain('setAuthInitError(null)');
    expect(branch).toContain("router.replace('/login')");
  });

  it('the startup timeout is not aggressive enough to fire on a healthy launch', () => {
    const match = layoutSource.match(/TABS_LOADING_TIMEOUT_MS\s*=\s*(\d+)/);
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(8000);
  });
});

describe('No tab screen may render itself away', () => {
  const screens: string[] = readdirSync(TABS_DIR).filter(
    (f) => f.endsWith('.tsx') && f !== '_layout.tsx',
  );

  it('finds the tab screens', () => {
    expect(screens.length).toBeGreaterThan(0);
  });

  /**
   * A screen-level `return null` is an unreportable black frame: the tab bar
   * stays, the content area paints nothing and nothing throws. Section
   * sub-components declared ABOVE the default export may legitimately return
   * null to hide themselves, so only the exported screen body is policed.
   */
  it('no screen component returns null from its own body', () => {
    const offenders: string[] = [];

    for (const file of screens) {
      const source = readTabs(file);
      const lines = source.split('\n');
      const defaultExportLine = lines.findIndex((l) => l.startsWith('export default function'));
      if (defaultExportLine === -1) continue;

      lines.slice(defaultExportLine).forEach((line, i) => {
        if (/^ {2}(if \(.*\) )?return null;/.test(line)) {
          offenders.push(`${file}:${defaultExportLine + i + 1}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });

  it('every tab screen actually exports a component', () => {
    for (const file of screens) {
      expect(readTabs(file)).toContain('export default function');
    }
  });
});
