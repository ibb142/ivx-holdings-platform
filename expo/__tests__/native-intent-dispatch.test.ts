import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { StackActions, StackRouter } from '@react-navigation/routers';
import { redirectSystemPath } from '../app/+native-intent';
import { dispatchNativeIntent, registerNativeIntentHandler } from '../lib/native-intent-dispatch';

let unregister: (() => void) | undefined;
afterEach(() => { unregister?.(); unregister = undefined; });

describe('native external navigation', () => {
  test('cold start and an unmounted navigator retain Expo initial routing', () => {
    const calls: string[] = [];
    unregister = registerNativeIntentHandler(path => { calls.push(path); });
    expect(redirectSystemPath({ path: 'ivx-app:///property/123?tab=details#photos', initial: true }))
      .toBe('/property/123?tab=details#photos');
    expect(calls).toEqual([]);
    unregister();
    expect(redirectSystemPath({ path: 'ivx-app:///property/123', initial: false })).toBe('/property/123');
  });

  test('the installed Expo subscription consumes a warm link exactly once', async () => {
    // Use the real installed subscription; the native event source is the
    // only platform dependency mocked here. Empty return must not dispatch a
    // second NAVIGATE after the root has replaced the current destination.
    const require = createRequire(import.meta.url);
    const filename = require.resolve('expo-router/build/link/linking');
    let receive: (event: { url: string }) => Promise<void> = async () => {};
    let removed = false;
    const exports: { subscribe?: Function } = {};
    runInNewContext(readFileSync(filename, 'utf8'), {
      exports,
      require: (name: string) => {
        if (name === 'expo-linking') return {
          addEventListener: (_name: string, callback: typeof receive) => {
            receive = callback;
            return { remove: () => { removed = true; } };
          },
        };
        if (name === '../getRoutesRedirects') return { applyRedirects: (path: string) => path };
        return {};
      },
    });
    const replacements: string[] = [];
    const defaultNavigations: string[] = [];
    unregister = registerNativeIntentHandler(path => { replacements.push(path); });
    const stop = exports.subscribe!({ redirectSystemPath }, [])((path: string) => defaultNavigations.push(path));
    await receive({ url: 'ivx-app:///property/123?tab=details#photos' });
    expect(replacements).toEqual(['/property/123?tab=details#photos']);
    expect(defaultNavigations).toEqual([]);
    unregister();
    await receive({ url: 'ivx-app:///property/456' });
    expect(defaultNavigations).toEqual(['/property/456']);
    stop();
    expect(removed).toBe(true);
  });

  test('272 warm destinations do not retain 272 mounted stack entries', () => {
    const routeNames = ['home', ...Array.from({ length: 272 }, (_, i) => `route-${i}`)];
    const options = { routeNames, routeParamList: {}, routeGetIdList: {} };
    const router = StackRouter({ initialRouteName: 'home' });
    let state = router.getInitialState(options);
    state = router.getStateForAction(state, StackActions.push('route-0'), options)!;
    unregister = registerNativeIntentHandler(path => {
      state = router.getStateForAction(state, StackActions.replace(path.slice(1)), options)!;
    });
    for (let i = 1; i < 272; i++) {
      expect(redirectSystemPath({ path: `ivx-app:///route-${i}`, initial: false })).toBe('');
      expect(state.routes.map(route => route.name)).toEqual(['home', `route-${i}`]);
    }
    // Ordinary in-app pushes still preserve back navigation.
    state = router.getStateForAction(state, StackActions.push('route-0'), options)!;
    expect(state.routes.map(route => route.name)).toEqual(['home', 'route-271', 'route-0']);
  });

  test('a stale cleanup cannot remove the current navigator handler', () => {
    const stale = registerNativeIntentHandler(() => { throw new Error('stale'); });
    const calls: string[] = [];
    unregister = registerNativeIntentHandler(path => { calls.push(path); });
    stale();
    expect(dispatchNativeIntent('/property/123')).toBe(true);
    expect(calls).toEqual(['/property/123']);
  });

  test('unready navigation falls back, and unsupported external URLs stay local', () => {
    unregister = registerNativeIntentHandler(() => { throw new Error('not mounted'); });
    expect(redirectSystemPath({ path: 'ivx-app:///property/123', initial: false })).toBe('/property/123');
    expect(redirectSystemPath({ path: 'https://untrusted.invalid/private', initial: false })).toBe('/');
    expect(redirectSystemPath({ path: 'ivx-app://user:password@host/private', initial: true })).toBe('/');
  });
});
