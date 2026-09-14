/** Presentation of observed results only; this module never retries execution. */
export interface OwnerRecoveryOutcome {
  ok: boolean;
  taskId: string | null;
  status: string | null;
  answer: string | null;
  error: string | null;
  httpStatus?: number | null;
  errorCode?: string | null;
  source?: string | null;
}

export function describeOwnerRecovery(result: OwnerRecoveryOutcome): string {
  if (result.ok && result.answer?.trim()) return result.answer;
  const original = result.source === 'original_owner_chat_request' || result.taskId?.startsWith('owner-request:');
  const failed = ['FAILED', 'DEAD_LETTER', 'CANCELED', 'CANCELLED'].includes(result.status ?? '');
  const heading = failed
    ? (original ? 'Your original request ended with an error.' : `Task ended in ${result.status}.`)
    : 'The result of your request is not confirmed yet.';
  return [
    heading,
    ...(result.error ? [`Reason: ${result.error}`] : []),
    ...(result.httpStatus ? [`HTTP: ${result.httpStatus}`] : []),
    ...(result.errorCode ? [`Code: ${result.errorCode}`] : []),
    ...(result.taskId ? [`Reference: ${result.taskId}`] : []),
    failed
      ? 'No automatic repair or new execution was started.'
      : 'The same request can be checked again. Its outcome must be confirmed before repeating the action.',
  ].join('\n');
}

export function ownerConnectionStatus(reachable: boolean | null): string {
  if (reachable === false) return 'AI connection unavailable. Check the request result above.';
  if (reachable === null) return 'AI connection not yet verified.';
  return 'Assistant ready.';
}

export function ownerFailureNextStep(status: number | null, stage: string | null): string {
  if (status === 401 || status === 403) return 'Open Auth Diagnostics to refresh your owner session.';
  if (status !== null && status >= 500) return 'The service could not complete this request. Checking its original result.';
  if (stage === 'auth') return 'Open Auth Diagnostics to check your owner session.';
  if (stage === 'network' || status === null) return 'The connection was interrupted. Checking the original result before any retry.';
  return 'Review the request error before retrying.';
}
