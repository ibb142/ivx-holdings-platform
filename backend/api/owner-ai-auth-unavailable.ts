export function isOwnerAuthUnavailable(error: unknown): error is Error {
  if (!(error instanceof Error)) return false;
  if (error.name === 'IVXAuthServiceUnavailableError') return true;
  return error.name === 'IVXOwnerApprovalError'
    && (error as Error & { status?: number }).status === 503
    && error.cause instanceof Error
    && error.cause.name === 'IVXAuthServiceUnavailableError';
}

/** An unavailable identity provider must not become a successful AI reply. */
export function ownerAIAuthUnavailableResponse(
  error: unknown,
  json: (payload: Record<string, unknown>, status: number) => Response = (payload, status) => Response.json(payload, { status }),
): Response | null {
  if (!isOwnerAuthUnavailable(error)) return null;
  const response = json({
    error: error.message,
    code: 'AUTH_SERVICE_UNAVAILABLE',
    retryable: true,
  }, 503);
  response.headers.set('Retry-After', '5');
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
