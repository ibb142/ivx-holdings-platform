/** Bound session lookup, response headers and JSON parsing with one deadline. */
export function readLiveTelemetry<T>(read: (signal: AbortSignal) => Promise<T>, controller: AbortController, timeoutMs = 40_000): Promise<T> {
  let onAbort: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error('Telemetry request timed out or was interrupted. Retrying…'));
    if (controller.signal.aborted) onAbort();
    else controller.signal.addEventListener('abort', onAbort, { once: true });
  });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return Promise.race([cancelled, Promise.resolve().then(() => read(controller.signal))])
    .finally(() => { clearTimeout(timer); controller.signal.removeEventListener('abort', onAbort); });
}
