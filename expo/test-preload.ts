// Preload module mocks for bun test — runs before all test files
// This ensures react-native and @supabase/supabase-js are mocked globally
// for test files that transitively import them without their own mocks.

// Only mock if not already mocked by the test file itself
const { mock } = require('bun:test');

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

// Mock @/lib/supabase with a Proxy that delegates to a global override.
//
// Bun's mock.module is first-come-first-served. Prior test files (e.g.
// canonical-query.test.ts) transitively load @/lib/supabase through modules
// like @/lib/canonical-query, caching the real module before ivx-chat.test.ts
// can register its own mock. This causes ivxChat.ts to get the wrong supabase
// object and all exports to be undefined in CI.
//
// The fix: mock @/lib/supabase in the preload with a Proxy that delegates to
// globalThis.__IVX_TEST_SUPABASE__. Test files that need a specific supabase
// mock (like ivx-chat.test.ts) set globalThis.__IVX_TEST_SUPABASE__ to their
// mock object before importing modules that use supabase.
const _noopSupabase = {
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    signInWithPassword: async () => ({ data: {}, error: null }),
    signOut: async () => ({ error: null }),
  },
  from: () => ({
    select: () => ({
      eq: () => ({ single: async () => ({ data: null, error: null }) }),
      order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
    }),
    insert: () => ({ select: () => Promise.resolve({ data: null, error: null }) }),
    upsert: () => Promise.resolve({ data: null, error: null }),
  }),
  storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
  channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
  removeChannel: () => Promise.resolve('ok'),
};

try {
  mock.module('@/lib/supabase', () => ({
    supabase: new Proxy(_noopSupabase, {
      get(_target, prop) {
        const override = (globalThis as Record<string, unknown>).__IVX_TEST_SUPABASE__;
        const target = override ?? _noopSupabase;
        const value = Reflect.get(target as object, prop);
        return typeof value === 'function' ? (value as Function).bind(target) : value;
      },
    }),
  }));
} catch (e) {
  // Already mocked or bun:test not available
}
