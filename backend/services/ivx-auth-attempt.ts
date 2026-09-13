/** Bound both the caller's wait and the underlying authentication transport. */
export async function runAbortableAuthAttempt<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const error = new Error(timeoutMessage);
        // Keep the timeout classification even if the SDK translates aborts.
        reject(error);
        controller.abort(error);
      }, timeoutMs);
    });
    return await Promise.race([operation(controller.signal), deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// Preserve the deployed fast-path deadline when using the shared lookup helper.
export const MEMBER_FALLBACK_LOOKUP_BUDGET_MS = 800;

/** A failed credential-store read is unknown, never proof of a wrong password. */
export async function readBoundedMemberFallback(
  verify: (signal: AbortSignal) => Promise<string | null>,
  timeoutMs = MEMBER_FALLBACK_LOOKUP_BUDGET_MS,
): Promise<{ available: boolean; userId: string | null }> {
  try {
    const userId = await runAbortableAuthAttempt(verify, timeoutMs, 'ivx:fallback-lookup-timeout');
    return { available: true, userId };
  } catch {
    return { available: false, userId: null };
  }
}
