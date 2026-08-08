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
// Without this, the real @/lib/supabase module throws on import in CI,
// causing any test that transitively imports it (e.g. ivxChat.ts) to get
// an empty module object with undefined exports.
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

// Mock @/lib/supabase globally. This is the definitive fix for the
// ivx-chat.test.ts mock leakage: Bun's mock.module is first-come-first-served,
// so a test file that loads @/lib/supabase before ivx-chat.test.ts caches
// the real module (or a different mock), causing ivxChat.ts exports to be
// undefined. By mocking it in the preload, we ensure the mock is registered
// first and every test file's own mock.module('@/lib/supabase') call is a
// no-op (already registered).
try {
  mock.module('@/lib/supabase', () => ({
    supabase: {
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
    },
  }));
} catch (e) {
  // Already mocked or bun:test not available
}