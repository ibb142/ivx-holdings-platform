/** Password grants share the live Auth gate's bounded 15-second budget. */
export function getSupabaseFetchTimeoutMs(url: string, selfHosted: boolean): number {
  const parsed = new URL(url);
  if (parsed.pathname.endsWith('/auth/v1/token') && parsed.searchParams.get('grant_type') === 'password') {
    return 15000;
  }
  if (parsed.pathname.includes('/auth/v1/token') || parsed.pathname.includes('/auth/v1/user')) {
    return 8000;
  }
  return selfHosted ? 20000 : 15000;
}
