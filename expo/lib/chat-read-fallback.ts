export type ChatReadResult<T> = {
  value: T;
  // The primary reader may itself use a cache; neither source proves remote delivery.
  source: 'primary' | 'fallback';
  fallbackCode: 'CLIENT_GATEWAY_TIMEOUT' | 'CLIENT_GATEWAY_UNAVAILABLE' | null;
};

function isTransientReadFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const failure = error as { status?: unknown; statusCode?: unknown; code?: unknown; name?: unknown; message?: unknown };
  const status = Number(failure.status ?? failure.statusCode);
  const message = typeof failure.message === 'string' ? failure.message : '';
  const code = typeof failure.code === 'string' ? failure.code : '';
  // A rejected identity must remain rejected even if its message mentions a timeout.
  if ([401, 403].includes(status) || /\b(?:401|403|OWNER_AUTH_FAILED|OWNER_SESSION_REQUIRED)\b/.test(`${code} ${message}`)) return false;
  if (Number.isFinite(status) && status > 0) return [408, 502, 503, 504].includes(status);
  return failure.code === 'CLIENT_GATEWAY_TIMEOUT'
    || failure.name === 'AbortError' || failure.name === 'TimeoutError'
    || /\b(?:502|503|504)\b|gateway timeout|timed out|network request failed|failed to fetch/i.test(message);
}

/** Read-only UI recovery. Never use this helper to resend a command or claim a remote receipt. */
export async function resolveChatRead<T>(
  operation: Promise<T>,
  fallback: () => Promise<T>,
  timeoutMs = 8_000,
): Promise<ChatReadResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let recovery: Promise<ChatReadResult<T>> | undefined;
  const recover = (fallbackCode: NonNullable<ChatReadResult<T>['fallbackCode']>) => {
    recovery ??= Promise.resolve().then(fallback).then(value => ({ value, source: 'fallback' as const, fallbackCode }));
    return recovery;
  };
  try {
    return await Promise.race([
      operation.then<ChatReadResult<T>>(value => ({ value, source: 'primary', fallbackCode: null }))
        .catch(error => {
          if (!isTransientReadFailure(error)) throw error;
          return recover('CLIENT_GATEWAY_UNAVAILABLE');
        }),
      new Promise<ChatReadResult<T>>((resolve, reject) => {
        timer = setTimeout(() => {
          // Forward both outcomes: a failed local read must not leave this promise pending.
          recover('CLIENT_GATEWAY_TIMEOUT').then(resolve, reject);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
