import type { QueryKey } from '@tanstack/react-query';

export const ivxQueryKeys = {
  reels: (scope: 'all' | 'reel' = 'reel'): QueryKey => ['ivx', 'feed', scope],
  home: (): QueryKey => ['ivx', 'home-feed'],
  deal: (dealId: string): QueryKey => ['ivx', 'deal', dealId],
} as const;

export class IVXRequestError extends Error {
  readonly status: number | null;
  readonly traceId: string;
  readonly retryable: boolean;

  constructor(message: string, status: number | null = null, traceId?: string) {
    super(message);
    this.name = 'IVXRequestError';
    this.status = status;
    this.traceId = traceId ?? `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.retryable = status === null || status === 408 || status === 429 || status >= 500;
  }
}

export function normalizeIVXRequestError(error: unknown): IVXRequestError {
  if (error instanceof IVXRequestError) return error;
  if (error instanceof Error && error.name === 'AbortError') {
    return new IVXRequestError('The request was cancelled.', null);
  }
  return new IVXRequestError(error instanceof Error ? error.message : 'Something went wrong. Please try again.');
}

export function shouldRetryIVXRequest(failureCount: number, error: unknown): boolean {
  return failureCount < 2 && normalizeIVXRequestError(error).retryable;
}
