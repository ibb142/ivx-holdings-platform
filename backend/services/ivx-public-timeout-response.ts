/** A deadline is unavailable evidence, never an empty catalog or a saved update. */
export function publicReadTimeout(resource: 'deals' | 'properties' | 'videos' | 'comments' | 'channels' | 'stories' | 'sessions'): Response {
  return Response.json({
    error: 'This content is temporarily unavailable. Please retry.',
    code: 'PUBLIC_READ_TIMEOUT', resource, retryable: true,
  }, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '2' } });
}

export function publicMutationTimeout(): Response {
  // The operation can commit after the HTTP deadline. Replaying a toggle or
  // share would contradict its first result, so the caller must reconcile first.
  return Response.json({
    error: 'Could not confirm the update. Refresh to check its status before trying again.',
    code: 'ENGAGEMENT_OUTCOME_UNKNOWN', outcome: 'unknown', retryable: false,
  }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
}
