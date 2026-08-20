/**
 * Preload for backend `bun test` runs (loaded via the root bunfig.toml).
 *
 * A handful of backend tests reach into shared modules under `expo/` (for
 * example `expo/lib/auth-rate-limiter` and `expo/shared/ivx`). Those import
 * chains can pull in `react-native`, whose entrypoint is written in Flow:
 *
 *   import typeof * as ReactNativePublicAPI from './index.js.flow';
 *
 * bun cannot parse that, so it surfaced as an "Unhandled error between tests"
 * that failed the whole backend run while every individual file passed in
 * isolation. The backend never executes React Native code — it only needs the
 * module to resolve — so a light stub keeps the shared modules importable.
 *
 * This mirrors the equivalent stub in `expo/test-preload.ts`.
 */
const { mock } = require('bun:test');

// expo-modules-core and react-native reference __DEV__ as a bare global.
if (typeof (globalThis as Record<string, unknown>).__DEV__ === 'undefined') {
  (globalThis as Record<string, unknown>).__DEV__ = false;
}

// expo-modules-core's sources use TS/Flow-only syntax that bun cannot parse in
// this context (e.g. `typeof ExpoGlobal.EventEmitter<T>`), and its internal
// files reference __DEV__ directly. Mocking the top-level entry is not enough,
// so the internal subpaths are stubbed too — same approach as expo/test-preload.ts.
const expoModulesCoreStub = {
  CodedError: class CodedError extends Error {},
  NativeModule: class NativeModule {},
  requireNativeModule: () => ({}),
  requireOptionalNativeModule: () => null,
  Platform: {
    OS: 'ios',
    Version: '17.0',
    select: (o: Record<string, unknown>) => (o.ios ?? o.default) as unknown,
  },
  EventEmitter: class {
    addListener() {
      return { remove: () => {} };
    }
    removeAllListeners() {}
  },
  SharedObject: class {},
  SharedRef: class {},
};

for (const specifier of [
  'expo-modules-core',
  'expo-modules-core/src/index',
  'expo-modules-core/src/EventEmitter',
  'expo-modules-core/src/Platform',
  'expo-modules-core/src/environment/browser',
  'expo-modules-core/src/sweet/setUpJsLogger.fx',
]) {
  try {
    mock.module(specifier, () => expoModulesCoreStub);
  } catch {
    // Already mocked.
  }
}

try {
  mock.module('react-native', () => ({
    Platform: {
      OS: 'ios',
      Version: '17.0',
      select: (obj: Record<string, unknown>) => (obj.ios ?? obj.default) as unknown,
    },
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
      flatten: (styles: Record<string, unknown>) => styles,
    },
    Linking: {
      canOpenURL: async () => true,
      openURL: async () => {},
      getInitialURL: async () => null,
    },
    AppState: {
      addEventListener: () => ({ remove: () => {} }),
      currentState: 'active',
    },
    NativeModules: {},
    TurboModuleRegistry: { get: () => ({}) },
    NativeEventEmitter: class {
      addListener() {
        return { remove: () => {} };
      }
      removeAllListeners() {}
    },
  }));
} catch {
  // Already mocked by a test file that registered its own stub first.
}
