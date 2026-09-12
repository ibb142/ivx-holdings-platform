const OWNER_BINDING_KEYS = [
  'OWNER_NEW_PASSWORD', 'IVX_OWNER_PASSWORD', 'IVX_OWNER_PASSWORD_BASE64', 'IVX_OWNER_EMAIL',
  'EXPO_PUBLIC_SUPABASE_URL', 'SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY',
  'JWT_SECRET', 'APP_SECRET', 'IVX_OWNER_VARIABLES_ENCRYPTION_KEY',
] as const;

type BindingResponse = { ok: boolean; status: number; body: unknown };

/** Read only the fixed diagnostic keys. Render's list endpoint defaults to
 * twenty rows, so a missing first-page key is not proof of absent config.
 */
export async function readOwnerRuntimeBindings(read: (key: string) => Promise<BindingResponse>): Promise<BindingResponse> {
  let responses: Array<{ key: string; response: BindingResponse }>;
  try {
    responses = await Promise.all(OWNER_BINDING_KEYS.map(async key => ({ key, response: await read(key) })));
  } catch {
    return { ok: false, status: 0, body: [] };
  }
  const body: Array<{ key: string; value: string }> = [];
  for (const { key, response } of responses) {
    if (response.status === 404) continue;
    if (!response.ok || response.status !== 200) return { ok: false, status: response.status, body: [] };
    const wrapper = response.body && typeof response.body === 'object' ? response.body as Record<string, unknown> : {};
    const entry = wrapper.envVar && typeof wrapper.envVar === 'object' ? wrapper.envVar as Record<string, unknown> : wrapper;
    if (typeof entry.value !== 'string' || (entry.key !== undefined && entry.key !== key)) {
      return { ok: false, status: 502, body: [] };
    }
    body.push({ key, value: entry.value });
  }
  return { ok: true, status: 200, body };
}

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
      matchesTrimmedConfiguration: configured && active ? configured.trim() === active : null,
    }];
  }));
}
