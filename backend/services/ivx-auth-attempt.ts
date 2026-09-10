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
