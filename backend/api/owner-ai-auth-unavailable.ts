/** An unavailable identity provider must not become a successful AI reply. */
export function ownerAIAuthUnavailableResponse(
  error: unknown,
  json: (payload: Record<string, unknown>, status: number) => Response = (payload, status) => Response.json(payload, { status }),
): Response | null {
  if (!(error instanceof Error) || error.name !== 'IVXAuthServiceUnavailableError') return null;
  const response = json({
    error: error.message,
    code: 'AUTH_SERVICE_UNAVAILABLE',
    retryable: true,
  }, 503);
  response.headers.set('Retry-After', '5');
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
