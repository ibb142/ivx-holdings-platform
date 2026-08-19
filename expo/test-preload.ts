// Preload module mocks for bun test — runs before all test files
// This ensures react-native and @supabase/supabase-js are mocked globally
// for test files that transitively import them without their own mocks.

// Define __DEV__ global for expo-modules-core compatibility
if (typeof (globalThis as Record<string, unknown>).__DEV__ === 'undefined') {
  (globalThis as Record<string, unknown>).__DEV__ = false;
}

// Only mock if not already mocked by the test file itself
const { mock } = require('bun:test');

// Mock expo-modules-core and its internal subpaths so __DEV__ is never
// referenced as a bare global (it doesn't exist in bun test context).
// mock.module('expo-modules-core') only intercepts the top-level entry;
// internal files like ./environment/browser and ./Platform reference __DEV__
// directly and must be mocked separately to prevent ReferenceError.
const _emcMock = {
  CodedError: class CodedError extends Error {},
  NativeModule: class NativeModule {},
  requireNativeModule: () => ({}),
  requireOptionalNativeModule: () => null,
  Platform: { OS: 'ios', Version: '17.0', select: (o: Record<string, unknown>) => (o.ios ?? o.default) as unknown },
  EventEmitter: class { addListener() { return { remove: () => {} }; } },
  SharedObject: class {},
  SharedRef: class {},
};
for (const p of [
  'expo-modules-core',
  'expo-modules-core/src/environment/browser',
  'expo-modules-core/src/Platform',
  'expo-modules-core/src/sweet/setUpJsLogger.fx',
  'expo-modules-core/src/index',
]) {
  try {
    mock.module(p, () => _emcMock);
  } catch (_) {
    // Already mocked
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
    // Text/TextInput/View are referenced by identity (===) by lib/text-node-guard,
    // so they must be stable, named components in the mock.
    Text: Object.assign(function Text() { return null; }, { displayName: 'Text' }),
    TextInput: Object.assign(function TextInput() { return null; }, { displayName: 'TextInput' }),
    View: Object.assign(function View() { return null; }, { displayName: 'View' }),
    TurboModuleRegistry: { get: () => ({}) },
    NativeModules: {},
    NativeEventEmitter: class { addListener() { return { remove: () => {} }; } removeAllListeners() {} },
  }));
} catch (e) {
  // Already mocked or bun:test not available
}

try {
  mock.module('@supabase/supabase-js', () => ({
    createClient: () => ({
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        signInWithPassword: async () => ({ data: {}, error: null }),
        signOut: async () => ({ error: null }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({ single: async () => ({ data: null, error: null }) }),
          order: () => ({ limit: () => ({ data: [], error: null }) }),
        }),
        insert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }),
      }),
    }),
  }));
} catch (e) {
  // Already mocked or bun:test not available
}

// Mock expo-secure-store so @/lib/supabase can load without a native module.
try {
  mock.module('expo-secure-store', () => ({
    getItem: async () => null,
    setItem: async () => {},
    deleteItem: async () => {},
  }));
} catch (e) {
  // Already mocked or bun:test not available
}

// Mock @react-native-async-storage/async-storage globally so modules that
// import it at the top level can load without a native module.
try {
  mock.module('@react-native-async-storage/async-storage', () => ({
    default: {
      getItem: async () => null,
      setItem: async () => {},
      removeItem: async () => {},
      clear: async () => {},
    },
  }));
} catch (e) {
  // Already mocked or bun:test not available
}

// NOTE: @/lib/supabase is intentionally mocked only by supabase-test-preload.ts.
// bunfig.toml loads that dedicated preload first. Registering a second mock here
// creates an export race and can hide named exports such as getSupabaseClient.
