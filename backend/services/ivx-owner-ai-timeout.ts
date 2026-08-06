/**
 * IVX Owner AI request timeout helper.
 *
 * Races a promise against a timeout budget. If the timeout wins, the supplied
 * fallback factory is called. This is intentionally decoupled from the
 * ivx-owner-ai route so it can be unit-tested without pulling in the entire
 * owner-auth / database / AI pipeline.
 */

type OwnerAITimeoutResult<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'timeout' };

export function withOwnerAIRequestTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => T,
): Promise<T> {
  return Promise.race<OwnerAITimeoutResult<T>>([
    promise.then((value): OwnerAITimeoutResult<T> => ({ kind: 'ok', value })),
    new Promise<OwnerAITimeoutResult<T>>((resolve) => {
      setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
    }),
  ]).then((out): T => (out.kind === 'timeout' ? onTimeout() : out.value));
}
