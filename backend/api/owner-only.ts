import {
  IVX_OPEN_ACCESS_OWNER_TOKEN,
  getIVXOwnerEmailAllowlist,
  readIVXTrimmedString,
  resolveIVXAuthenticatedRequest,
  type IVXAuthenticatedRequestContext,
} from '../../expo/shared/ivx';

export type IVXOwnerRequestContext = IVXAuthenticatedRequestContext;

export type IVXOwnerMutationApprovalProof = {
  ownerSessionDetected: boolean;
  bearerAccepted: boolean;
  ownerVerified: boolean;
  ownerEmailMatched: boolean;
  ownerEmailMasked: string | null;
  userId: string | null;
  role: string | null;
  guardMode: IVXAuthenticatedRequestContext['guardMode'] | null;
  allowlistConfigured: boolean;
  action: string;
  blocker: string | null;
  secretValuesReturned: false;
};

export type IVXOwnerMutationApprovalEvaluation = {
  approved: boolean;
  status: number;
  proof: IVXOwnerMutationApprovalProof;
  blocker: string | null;
};

export class IVXOwnerApprovalError extends Error {
  readonly status: number;
  readonly proof: IVXOwnerMutationApprovalProof;

  constructor(message: string, status: number, proof: IVXOwnerMutationApprovalProof) {
    super(message);
    this.name = 'IVXOwnerApprovalError';
    this.status = status;
    this.proof = proof;
  }
}

const OWNER_ONLY_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': 'https://ivxholding.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
} as const;

/**
 * Hard ceiling on a single owner-AI JSON response body. The upstream proxy/host
 * truncates very large bodies mid-stream, which produces an invalid-JSON reply
 * the client "cannot read" (the "temporary backend formatting issue" the owner
 * saw). We keep responses safely under that ceiling.
 */
const OWNER_ONLY_MAX_RESPONSE_BYTES = 900_000;

/**
 * Serialize an owner response to JSON that the client can ALWAYS parse.
 *
 * Guarantees, in order:
 *   1. JSON.stringify never throws (circular refs / BigInt / bad getters fall
 *      back to a minimal canonical envelope instead of a 500 / empty body).
 *   2. The body never exceeds OWNER_ONLY_MAX_RESPONSE_BYTES — when it would,
 *      heavy diagnostic-only fields are dropped and the visible `answer` is
 *      safely truncated, preserving the canonical contract
 *      (requestId/conversationId/answer/model/status).
 */
function serializeOwnerOnlyPayload(payload: Record<string, unknown>): string {
  let body: string;
  try {
    body = JSON.stringify(payload);
  } catch (error) {
    return JSON.stringify(buildMinimalOwnerEnvelope(payload, error));
  }

  if (body.length <= OWNER_ONLY_MAX_RESPONSE_BYTES) {
    return body;
  }

  // Oversized: strip diagnostic-only fields that are never required to render a
  // reply, then re-serialize. `answer` is preserved (truncated if needed).
  const slim: Record<string, unknown> = { ...payload };
  for (const heavyField of ['toolOutputs', 'toolOutput', 'toolInput', 'runtimeV2', 'routerDebug', 'diagnostics', 'providerError']) {
    delete slim[heavyField];
  }
  if (typeof slim.answer === 'string' && slim.answer.length > 40_000) {
    slim.answer = `${slim.answer.slice(0, 40_000)}\n\n…[truncated for transport — full result preserved server-side]`;
  }
  slim.responseTruncated = true;

  try {
    const slimBody = JSON.stringify(slim);
    if (slimBody.length <= OWNER_ONLY_MAX_RESPONSE_BYTES) {
      return slimBody;
    }
  } catch {
    // fall through to minimal envelope
  }
  return JSON.stringify(buildMinimalOwnerEnvelope(payload, null));
}

function buildMinimalOwnerEnvelope(payload: Record<string, unknown>, error: unknown): Record<string, unknown> {
  const reason = error instanceof Error ? error.message : null;
  const answer = typeof payload.answer === 'string' && payload.answer.trim()
    ? payload.answer.slice(0, 20_000)
    : 'The IVX Owner AI completed, but its full response was too large or could not be serialized. The result was preserved server-side — please resend.';
  return {
    requestId: typeof payload.requestId === 'string' ? payload.requestId : `ivx-${Date.now()}`,
    conversationId: typeof payload.conversationId === 'string' ? payload.conversationId : 'ivx-owner-ai',
    answer,
    model: typeof payload.model === 'string' ? payload.model : 'ivx_owner_ai_safe_envelope',
    status: payload.status === 'error' ? 'error' : 'ok',
    source: 'local_app_brain',
    responseTruncated: true,
    serializationFallback: reason ? `serialize_failed: ${reason}`.slice(0, 240) : 'serialize_size_guard',
  };
}

export function ownerOnlyJson(payload: Record<string, unknown>, status: number = 200): Response {
  return new Response(serializeOwnerOnlyPayload(payload), {
    status,
    headers: OWNER_ONLY_HEADERS,
  });
}

export function ownerOnlyOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: OWNER_ONLY_HEADERS,
  });
}

export async function assertIVXOwnerOnly(request: Request): Promise<IVXOwnerRequestContext> {
  if (checkIVXAISystemKey(request)) {
    return makeSystemOwnerRequestContext();
  }
  return await resolveIVXAuthenticatedRequest(request, '[IVXOwnerOnly]');
}

function normalizeOwnerEmail(value: unknown): string {
  return readIVXTrimmedString(value).toLowerCase();
}

function parseOwnerEmailAllowlist(value: unknown = process.env.IVX_OWNER_REGISTRATION_EMAILS): string[] {
  return Array.from(new Set(readIVXTrimmedString(value)
    .split(',')
    .map((email) => normalizeOwnerEmail(email))
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))));
}

function maskOwnerEmail(email: string | null): string | null {
  if (!email) return null;
  const [local = '', domain = ''] = email.split('@');
  if (!local || !domain) return '***';
  const visibleLocal = local.length <= 2 ? `${local.slice(0, 1)}*` : `${local.slice(0, 2)}***${local.slice(-1)}`;
  return `${visibleLocal}@${domain}`;
}

function makeOwnerMutationApprovalProof(input: {
  context: IVXAuthenticatedRequestContext | null;
  action: string;
  bearerAccepted: boolean;
  ownerVerified: boolean;
  ownerEmailMatched: boolean;
  allowlistConfigured: boolean;
  blocker: string | null;
}): IVXOwnerMutationApprovalProof {
  const email = normalizeOwnerEmail(input.context?.email ?? null) || null;
  return {
    ownerSessionDetected: Boolean(input.context?.userId && email),
    bearerAccepted: input.bearerAccepted,
    ownerVerified: input.ownerVerified,
    ownerEmailMatched: input.ownerEmailMatched,
    ownerEmailMasked: maskOwnerEmail(email),
    userId: input.context?.userId ?? null,
    role: input.context?.role ?? null,
    guardMode: input.context?.guardMode ?? null,
    allowlistConfigured: input.allowlistConfigured,
    action: input.action,
    blocker: input.blocker,
    secretValuesReturned: false,
  };
}

/**
 * Requires a real Supabase owner bearer and an email from IVX_OWNER_REGISTRATION_EMAILS.
 * This intentionally rejects the local/test open-access token for production mutations.
 */
export function evaluateIVXRegisteredOwnerBearerContext(
  context: IVXAuthenticatedRequestContext,
  action: string,
  ownerRegistrationEmailsValue: unknown = process.env.IVX_OWNER_REGISTRATION_EMAILS,
): IVXOwnerMutationApprovalEvaluation {
  // Merge the env-sourced allowlist with the hardcoded baseline owner emails
  // (IVX_BASELINE_OWNER_EMAILS) so a valid Supabase owner session is always
  // recognized even when IVX_OWNER_REGISTRATION_EMAILS is missing or empty on
  // the live Render runtime.
  const envAllowlist = parseOwnerEmailAllowlist(ownerRegistrationEmailsValue);
  const baselineAllowlist = getIVXOwnerEmailAllowlist();
  const allowlist = Array.from(new Set([...envAllowlist, ...baselineAllowlist]));
  const allowlistConfigured = allowlist.length > 0;
  const email = normalizeOwnerEmail(context.email);
  const tokenLooksLikeSupabaseJwt = context.accessToken.split('.').length === 3;
  const isExplicitDevToken = context.accessToken === IVX_OPEN_ACCESS_OWNER_TOKEN;
  const bearerAccepted = tokenLooksLikeSupabaseJwt && !isExplicitDevToken;
  const ownerEmailMatched = allowlistConfigured && allowlist.includes(email);
  const ownerVerified = bearerAccepted && ownerEmailMatched;

  if (!allowlistConfigured) {
    const blocker = 'IVX_OWNER_REGISTRATION_EMAILS is not configured in the backend runtime.';
    return {
      approved: false,
      status: 403,
      blocker,
      proof: makeOwnerMutationApprovalProof({ context, action, bearerAccepted, ownerVerified: false, ownerEmailMatched: false, allowlistConfigured, blocker }),
    };
  }

  if (!bearerAccepted) {
    const blocker = 'A real Supabase owner bearer token is required; local/test owner tokens are not accepted for senior-developer mutations.';
    return {
      approved: false,
      status: 401,
      blocker,
      proof: makeOwnerMutationApprovalProof({ context, action, bearerAccepted: false, ownerVerified: false, ownerEmailMatched, allowlistConfigured, blocker }),
    };
  }

  if (!ownerEmailMatched) {
    const blocker = 'Authenticated owner email is not listed in IVX_OWNER_REGISTRATION_EMAILS.';
    return {
      approved: false,
      status: 403,
      blocker,
      proof: makeOwnerMutationApprovalProof({ context, action, bearerAccepted, ownerVerified: false, ownerEmailMatched: false, allowlistConfigured, blocker }),
    };
  }

  return {
    approved: true,
    status: 200,
    blocker: null,
    proof: makeOwnerMutationApprovalProof({ context, action, bearerAccepted, ownerVerified, ownerEmailMatched, allowlistConfigured, blocker: null }),
  };
}

/**
 * Synthetic owner context for the trusted X-IVX-System-Key bypass path. This
 * identity is internal (no Supabase-authenticated user), so it intentionally has
 * no real `client`/`roleAudit`; callers on the system path never touch those.
 */
function makeSystemOwnerRequestContext(): IVXOwnerRequestContext {
  return {
    userId: 'ivx-ai-system',
    email: 'system@ivx.ai',
    role: 'system',
    accessToken: 'system',
    guardMode: 'system_bypass',
  } as unknown as IVXOwnerRequestContext;
}

const IVX_AI_SYSTEM_SECRET = process.env.IVX_AI_SYSTEM_SECRET?.trim() ?? '';

function checkIVXAISystemKey(request: Request): boolean {
  const systemKey = request.headers.get('X-IVX-System-Key')?.trim() ?? '';
  return IVX_AI_SYSTEM_SECRET.length > 0 && systemKey === IVX_AI_SYSTEM_SECRET;
}

function makeSystemMutationApprovalProof(action: string): IVXOwnerMutationApprovalProof {
  return {
    ownerSessionDetected: true,
    bearerAccepted: true,
    ownerVerified: true,
    ownerEmailMatched: true,
    ownerEmailMasked: 'system@ivx.ai',
    userId: 'ivx-ai-system',
    role: 'system',
    guardMode: 'system_bypass',
    allowlistConfigured: true,
    action,
    blocker: null,
    secretValuesReturned: false,
  };
}

export async function assertIVXRegisteredOwnerBearer(
  request: Request,
  action: string,
): Promise<{ context: IVXOwnerRequestContext; approval: IVXOwnerMutationApprovalProof }> {
  if (checkIVXAISystemKey(request)) {
    return {
      context: makeSystemOwnerRequestContext(),
      approval: makeSystemMutationApprovalProof(action),
    };
  }

  let context: IVXOwnerRequestContext;
  try {
    context = await resolveIVXAuthenticatedRequest(request, '[IVXOwnerMutation]');
  } catch (error) {
    const blocker = error instanceof Error ? error.message : 'Owner bearer verification failed.';
    throw new IVXOwnerApprovalError(blocker, blocker.toLowerCase().includes('missing bearer') ? 401 : 403, makeOwnerMutationApprovalProof({
      context: null,
      action,
      bearerAccepted: false,
      ownerVerified: false,
      ownerEmailMatched: false,
      allowlistConfigured: parseOwnerEmailAllowlist().length > 0,
      blocker,
    }));
  }

  const evaluation = evaluateIVXRegisteredOwnerBearerContext(context, action);
  if (!evaluation.approved) {
    throw new IVXOwnerApprovalError(evaluation.blocker ?? 'Owner approval failed.', evaluation.status, evaluation.proof);
  }

  return {
    context,
    approval: evaluation.proof,
  };
}
