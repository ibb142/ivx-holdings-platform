import {
  IVX_OPEN_ACCESS_OWNER_TOKEN,
  getIVXOwnerEmailAllowlist,
  readIVXTrimmedString,
  extractIVXBearerToken,
  resolveIVXAuthenticatedRequest,
  type IVXAuthenticatedRequestContext,
} from '../../expo/shared/ivx';
import { timingSafeEqual } from 'node:crypto';
import { verifyIVXOutageOwnerSession } from '../services/ivx-outage-owner-session';
import { resolveActiveIVXSystemSecret } from '../services/ivx-system-secret';
import { verifyIVXGitHubActionsOIDCRequest } from '../services/ivx-github-actions-oidc';

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
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-IVX-JSON-Contract': 'strict-v1',
  'Access-Control-Allow-Origin': 'https://ivxholding.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-IVX-System-Key, X-IVX-GitHub-OIDC',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
} as const;

const OWNER_ONLY_MAX_RESPONSE_BYTES = 900_000;

function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function serializeOwnerOnlyPayload(payload: Record<string, unknown>): string {
  let body: string;
  try {
    body = JSON.stringify(payload);
  } catch (error) {
    return JSON.stringify(buildMinimalOwnerEnvelope(payload, error));
  }

  if (utf8ByteLength(body) <= OWNER_ONLY_MAX_RESPONSE_BYTES) return body;

  const slim: Record<string, unknown> = { ...payload };
  for (const heavyField of ['toolOutputs', 'toolOutput', 'toolInput', 'runtimeV2', 'routerDebug', 'diagnostics', 'providerError']) {
    delete slim[heavyField];
  }
  if (typeof slim.answer === 'string' && utf8ByteLength(slim.answer) > 40_000) {
    let end = Math.min(slim.answer.length, 40_000);
    while (end > 0 && utf8ByteLength(slim.answer.slice(0, end)) > 40_000) end -= 256;
    slim.answer = `${slim.answer.slice(0, Math.max(0, end))}\n\n…[truncated for transport — full result preserved server-side]`;
  }
  slim.responseTruncated = true;

  try {
    const slimBody = JSON.stringify(slim);
    if (utf8ByteLength(slimBody) <= OWNER_ONLY_MAX_RESPONSE_BYTES) return slimBody;
  } catch {
    // fall through
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
  const body = serializeOwnerOnlyPayload(payload);
  return new Response(body, {
    status,
    headers: { ...OWNER_ONLY_HEADERS, 'Content-Length': String(utf8ByteLength(body)) },
  });
}

export function ownerOnlyOptions(): Response {
  return new Response(null, { status: 204, headers: OWNER_ONLY_HEADERS });
}

export async function assertIVXOwnerOnly(request: Request): Promise<IVXOwnerRequestContext> {
  if (await checkIVXMachineIdentity(request)) return makeSystemOwnerRequestContext();
  const outageSession = verifyIVXOutageOwnerSession(extractIVXBearerToken(request));
  if (outageSession) return makeOutageOwnerRequestContext(outageSession);
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

export function evaluateIVXRegisteredOwnerBearerContext(
  context: IVXAuthenticatedRequestContext,
  action: string,
  ownerRegistrationEmailsValue: unknown = process.env.IVX_OWNER_REGISTRATION_EMAILS,
): IVXOwnerMutationApprovalEvaluation {
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
    return { approved: false, status: 403, blocker, proof: makeOwnerMutationApprovalProof({ context, action, bearerAccepted, ownerVerified: false, ownerEmailMatched: false, allowlistConfigured, blocker }) };
  }
  if (!bearerAccepted) {
    const blocker = 'A real Supabase owner bearer token is required; local/test owner tokens are not accepted for senior-developer mutations.';
    return { approved: false, status: 401, blocker, proof: makeOwnerMutationApprovalProof({ context, action, bearerAccepted: false, ownerVerified: false, ownerEmailMatched, allowlistConfigured, blocker }) };
  }
  if (!ownerEmailMatched) {
    const blocker = 'Authenticated owner email is not listed in IVX_OWNER_REGISTRATION_EMAILS.';
    return { approved: false, status: 403, blocker, proof: makeOwnerMutationApprovalProof({ context, action, bearerAccepted, ownerVerified: false, ownerEmailMatched: false, allowlistConfigured, blocker }) };
  }

  return { approved: true, status: 200, blocker: null, proof: makeOwnerMutationApprovalProof({ context, action, bearerAccepted, ownerVerified, ownerEmailMatched, allowlistConfigured, blocker: null }) };
}

function makeOutageOwnerRequestContext(session: { token: string; userId: string; email: string }): IVXOwnerRequestContext {
  return { userId: session.userId, email: session.email, role: 'owner', accessToken: session.token, guardMode: 'strict' } as unknown as IVXOwnerRequestContext;
}

function makeSystemOwnerRequestContext(): IVXOwnerRequestContext {
  return { userId: 'ivx-ai-system', email: 'system@ivx.ai', role: 'system', accessToken: 'system', guardMode: 'system_bypass' } as unknown as IVXOwnerRequestContext;
}

const IVX_AI_SYSTEM_SECRET_ENV = () => (process.env.IVX_AI_SYSTEM_SECRET ?? '').trim();

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}

async function checkIVXAISystemKey(request: Request): Promise<boolean> {
  const systemKey = request.headers.get('X-IVX-System-Key')?.trim() ?? '';
  const activeSecret = await resolveActiveIVXSystemSecret();
  if (!activeSecret) return IVX_AI_SYSTEM_SECRET_ENV().length > 0 && constantTimeEquals(systemKey, IVX_AI_SYSTEM_SECRET_ENV());
  return constantTimeEquals(systemKey, activeSecret);
}

async function checkIVXMachineIdentity(request: Request): Promise<boolean> {
  if (await verifyIVXGitHubActionsOIDCRequest(request)) return true;
  return checkIVXAISystemKey(request);
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
  if (await checkIVXMachineIdentity(request)) {
    return { context: makeSystemOwnerRequestContext(), approval: makeSystemMutationApprovalProof(action) };
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
  if (!evaluation.approved) throw new IVXOwnerApprovalError(evaluation.blocker ?? 'Owner approval failed.', evaluation.status, evaluation.proof);
  return { context, approval: evaluation.proof };
}
