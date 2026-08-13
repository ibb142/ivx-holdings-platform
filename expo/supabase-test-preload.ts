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

type Override = Record<PropertyKey, unknown>;
let latestOverride: Override | null = null;
let latestDataOverride: Override | null = null;

Object.defineProperty(globalThis, '__IVX_TEST_SUPABASE__', {
  configurable: true,
  get() {
    return latestOverride;
  },
  set(value: unknown) {
    const next = value && typeof value === 'object' ? value as Override : null;
    latestOverride = next;
    if (next && typeof next.from === 'function' && next.storage) {
      latestDataOverride = next;
    }
  },
});

const dataProperties = new Set<PropertyKey>(['from', 'storage', 'channel', 'removeChannel']);
const client = new Proxy(noop, {
  get(_target, prop) {
    const target = (dataProperties.has(prop) ? latestDataOverride : latestOverride)
      ?? latestOverride
      ?? latestDataOverride
      ?? noop;
    const value = Reflect.get(target as object, prop);
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
