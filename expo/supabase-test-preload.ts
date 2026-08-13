import { mock } from 'bun:test';

const noop = {
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

const client = new Proxy(noop, {
  get(_target, prop) {
    const override = (globalThis as Record<string, unknown>).__IVX_TEST_SUPABASE__;
    const target = override && typeof override === 'object' ? override as object : noop;
    const value = Reflect.get(target, prop);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

mock.module('@/lib/supabase', () => ({
  supabase: client,
  getSupabaseClient: () => client,
  ensureSupabaseClient: () => client,
  forceProductionSupabaseClient: () => client,
  isSupabaseConfigured: () => true,
  isSelfHostedSupabase: () => false,
  getSupabaseConfigAudit: () => ({ urlConfigured: true, keyConfigured: true, usingFallback: false, host: 'test.supabase.co', initError: null }),
  SUPABASE_NOT_CONFIGURED_MESSAGE: 'Supabase test mock configured',
  SUPABASE_USING_PRODUCTION_FALLBACK: false,
  SUPABASE_CONFIG_SOURCE: 'env',
  SUPABASE_HOST_HINT: 'test.supabase.co',
  PRODUCTION_SUPABASE_HOST_HINT: 'test.supabase.co',
  PRODUCTION_SUPABASE_PROJECT_REF: 'test',
}));
