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