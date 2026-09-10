export class ProbeHttpError extends Error {
  constructor(readonly status: number, path: string) { super(`HTTP ${status} at ${path}`); }
}

/** One read attempt; the caller owns the bounded recovery loop and health probes. */
export async function readRecoveringSharedObservation<T>(read: () => Promise<T>): Promise<T | null> {
  try { return await read(); }
  catch (error) {
    if ((error instanceof ProbeHttpError && (error.status === 429 || error.status >= 500))
      || (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name))) return null;
    // Authentication, malformed evidence, wrong SHA and stale observations must fail.
    throw error;
  }
}
