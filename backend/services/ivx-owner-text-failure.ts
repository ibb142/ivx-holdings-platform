const BUDGET_FAILURES = {
  'durable admission unavailable': { httpStatus: 503, code: 'IVX_AI_BUDGET_ADMISSION_UNAVAILABLE',
    message: 'The AI budget reservation could not be confirmed. The model request was not sent.' },
  'admission unconfirmed': { httpStatus: 503, code: 'IVX_AI_BUDGET_ADMISSION_UNAVAILABLE',
    message: 'The AI budget reservation could not be confirmed. The model request was not sent.' },
  'global_capacity_exceeded': { httpStatus: 429, code: 'IVX_AI_BUDGET_CAPACITY_EXCEEDED',
    message: 'All shared AI request slots are occupied. The model request was not sent.' },
  'global_daily_budget_exceeded': { httpStatus: 402, code: 'IVX_AI_BUDGET_POLICY_DENIED',
    message: 'The shared AI budget cannot admit this request. The model request was not sent.' },
  'budget_not_activated': { httpStatus: 402, code: 'IVX_AI_BUDGET_POLICY_DENIED',
    message: 'The shared AI budget policy does not allow this request. The model request was not sent.' },
} as const;
type BudgetReason = keyof typeof BUDGET_FAILURES;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Read only known local admission reasons, including receipts from the old route.
 * Never return raw SDK bodies, connection strings or router diagnostics to users.
 */
export function readOwnerBudgetFailureReason(value: unknown, depth = 0): BudgetReason | null {
  if (depth > 3) return null;
  if (typeof value === 'string') {
    for (const reason of Object.keys(BUDGET_FAILURES) as BudgetReason[]) {
      const message = `Global AI budget: ${reason}`;
      if (value === message || value.endsWith(`Error: ${message}`)) return reason;
    }
    return null;
  }
  const record = object(value);
  const direct = readOwnerBudgetFailureReason(record.message, depth + 1);
  if (direct) return direct;
  const cause = readOwnerBudgetFailureReason(record.cause, depth + 1);
  if (cause) return cause;
  let body: unknown = record.responseBody;
  if (typeof body === 'string' && body.length <= 100_000) {
    try { body = JSON.parse(body); } catch { return null; }
  }
  const error = object(object(body).error);
  return error.code === 'IVX_GLOBAL_AI_BUDGET_BLOCKED'
    ? readOwnerBudgetFailureReason(error.message, depth + 1) : null;
}

export function ownerTextFailure(error: unknown): {
  httpStatus: number; code: string; error: string; answer: string;
  providerRequestState: 'not_started' | 'unknown';
} {
  const reason = readOwnerBudgetFailureReason(error);
  if (reason) {
    const failure = BUDGET_FAILURES[reason];
    return { httpStatus: failure.httpStatus, code: failure.code,
      error: `Global AI budget: ${reason}`, answer: failure.message, providerRequestState: 'not_started' };
  }
  return { httpStatus: 503, code: 'OWNER_TEXT_REPLY_FAILED',
    error: 'The text reply could not be completed and saved.',
    answer: 'The text reply could not be completed and saved. A model response may have been generated. Recover this request before submitting it again.',
    providerRequestState: 'unknown' };
}
