export type BoundedHealthProbe<T> = {
  ok: boolean;
  status: number;
  latencyMs: number;
  value?: T;
  missingRelation?: boolean;
  error?: string;
};

/** One GET, with one deadline covering headers and body; no response payload in errors. */
export async function boundedHealthProbe<T>(url: string, headers: Record<string, string>,
  valid: (body: unknown) => body is T, timeoutMs = 5_000): Promise<BoundedHealthProbe<T>> {
  const started = Date.now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, { method: 'GET', headers, redirect: 'error', signal: controller.signal });
        const body: unknown = await response.json();
        const result = { ok: response.ok && valid(body), status: response.status, latencyMs: Date.now() - started };
        if (result.ok) return { ...result, value: body as T };
        const code = body && typeof body === 'object' && 'code' in body ? body.code : null;
        return { ...result, missingRelation: response.status === 404 && (code === 'PGRST205' || code === '42P01'),
          error: response.ok ? 'Invalid dependency response' : `Dependency HTTP ${response.status}` };
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('dependency_deadline')); }, timeoutMs);
      }),
    ]);
  } catch {
    return { ok: false, status: 0, latencyMs: Date.now() - started,
      error: controller.signal.aborted ? 'Dependency probe timed out' : 'Dependency response unavailable' };
  } finally { if (timer) clearTimeout(timer); }
}
