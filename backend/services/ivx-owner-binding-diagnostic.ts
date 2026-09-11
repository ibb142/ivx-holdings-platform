const OWNER_BINDING_KEYS = [
  'OWNER_NEW_PASSWORD', 'IVX_OWNER_PASSWORD', 'IVX_OWNER_EMAIL',
  'EXPO_PUBLIC_SUPABASE_URL', 'SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY',
  'JWT_SECRET', 'APP_SECRET', 'IVX_OWNER_VARIABLES_ENCRYPTION_KEY',
] as const;

/** Owner-only comparison of the persisted service configuration and this
 * process. Values and fingerprints never leave the backend.
 */
export function ownerRuntimeBindingDrift(body: unknown, runtime: Record<string, string | undefined> = process.env) {
  const values = new Map<string, string>();
  if (Array.isArray(body)) for (const raw of body) {
    const wrapper = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const entry = wrapper.envVar && typeof wrapper.envVar === 'object'
      ? wrapper.envVar as Record<string, unknown> : wrapper;
    if (typeof entry.key === 'string' && typeof entry.value === 'string') values.set(entry.key, entry.value);
  }
  return Object.fromEntries(OWNER_BINDING_KEYS.map(key => {
    const configured = values.get(key);
    const active = runtime[key];
    return [key, {
      present: Boolean(configured), length: configured?.length ?? 0,
      runtimePresent: Boolean(active), runtimeLength: active?.length ?? 0,
      matchesRuntime: configured && active ? configured === active : null,
    }];
  }));
}
