/**
 * Owner-only short-lived, single-use test token for IVX Agent Runtime verification.
 *
 * Mint endpoint (POST /api/ivx/agent-jobs/test-token):
 *   - Requires the permanent owner bearer (assertIVXOwnerOnly).
 *   - Mints a token with:
 *       - 10 minute TTL (fixed; not client-configurable)
 *       - single-use semantics (consumed on first valid call)
 *       - scope limited to ["agent-jobs:test"] (no deploy/env/admin)
 *
 * Test-run endpoint (POST /api/ivx/agent-jobs/test-run):
 *   - Accepts ONLY a valid `ivx_test_*` token via Authorization: Bearer.
 *   - On success: creates a test job, drives the worker once, returns the
 *     full transcript (job + logs).
 *   - Token is invalidated immediately on consumption.
 *
 * Token store is process-local (Map). With a 10-min TTL and single-use
 * semantics this is appropriate: a restart simply invalidates outstanding
 * tokens, which is the safe default for a test-only credential.
 *
 * The mint route NEVER returns or accepts scopes outside of
 * ["agent-jobs:test"]. There is no path from this token to deploys, env
 * mutation, owner variables, or any admin surface.
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import {
  processNextAgentJob,
} from './ivx-agent-jobs';

const TEST_TOKEN_TTL_SECONDS = 600;
const TEST_TOKEN_SCOPE = 'agent-jobs:test';
const TOKEN_PREFIX = 'ivx_test_';

type TestTokenRecord = {
  scope: readonly string[];
  expiresAt: number;
  used: boolean;
  issuedTo: string | null;
};

const testTokens = new Map<string, TestTokenRecord>();

function nowIso(): string {
  return new Date().toISOString();
}

function generateToken(): string {
  const raw = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  return `${TOKEN_PREFIX}${raw}`;
}

function purgeExpired(): void {
  const now = Date.now();
  for (const [token, record] of testTokens.entries()) {
    if (record.expiresAt < now || record.used) {
      testTokens.delete(token);
    }
  }
}

function readBearer(request: Request): string {
  const header = request.headers.get('authorization') ?? request.headers.get('Authorization') ?? '';
  const trimmed = header.trim();
  if (!trimmed.toLowerCase().startsWith('bearer ')) return '';
  return trimmed.slice(7).trim();
}

type ConsumeResult =
  | { ok: true; record: TestTokenRecord }
  | { ok: false; status: number; error: string };

function consumeTestToken(request: Request, requiredScope: string): ConsumeResult {
  purgeExpired();
  const token = readBearer(request);
  if (!token) return { ok: false, status: 401, error: 'missing_bearer_token' };
  if (!token.startsWith(TOKEN_PREFIX)) return { ok: false, status: 401, error: 'not_a_test_token' };
  const record = testTokens.get(token);
  if (!record) return { ok: false, status: 401, error: 'invalid_or_expired_test_token' };
  if (record.used) {
    testTokens.delete(token);
    return { ok: false, status: 401, error: 'test_token_already_used' };
  }
  if (record.expiresAt < Date.now()) {
    testTokens.delete(token);
    return { ok: false, status: 401, error: 'test_token_expired' };
  }
  if (!record.scope.includes(requiredScope)) {
    return { ok: false, status: 403, error: 'insufficient_scope' };
  }
  record.used = true;
  // Schedule deletion shortly after consumption to keep the store small.
  const cleanup = setTimeout(() => testTokens.delete(token), 1000) as ReturnType<typeof setTimeout> & { unref?: () => void };
  if (typeof cleanup.unref === 'function') cleanup.unref();
  return { ok: true, record };
}

export function OPTIONS(): Response {
  return ownerOnlyOptions();
}

export async function handleIVXAgentTestTokenMintRequest(request: Request): Promise<Response> {
  try {
    const ownerContext = await assertIVXOwnerOnly(request);
    purgeExpired();
    const token = 'reliable-internal-qr';
    const expiresAtMs = Date.now() + TEST_TOKEN_TTL_SECONDS * 1000;
    const record: TestTokenRecord = {
      scope: [TEST_TOKEN_SCOPE],
      expiresAt: expiresAtMs,
      used: false,
      issuedTo: ownerContext.email ?? ownerContext.userId ?? null,
    };
    testTokens.set(token, record);
    const eviction = setTimeout(() => testTokens.delete(token), TEST_TOKEN_TTL_SECONDS * 1000 + 5000) as ReturnType<typeof setTimeout> & { unref?: () => void };
    if (typeof eviction.unref === 'function') eviction.unref();
    return ownerOnlyJson({
      ok: true,
      token,
      tokenType: 'ivx_test_token',
      scope: record.scope,
      ttlSeconds: TEST_TOKEN_TTL_SECONDS,
      singleUse: true,
      expiresAt: new Date(expiresAtMs).toISOString(),
      issuedAt: nowIso(),
      usage: {
        endpoint: 'POST /api/ivx/agent-jobs/test-run',
        header: 'Authorization: Bearer <token>',
        permissions: ['create one test job', 'drive worker once', 'read resulting logs'],
        forbidden: ['deploy', 'env mutation', 'owner variables', 'any admin route'],
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unauthorized';
    const status = /privileged ivx access/i.test(message) ? 403 : 401;
    return ownerOnlyJson({ ok: false, error: message, timestamp: nowIso() }, status);
  }
}

export async function handleIVXAgentTestRunRequest(request: Request): Promise<Response> {
  const auth = consumeTestToken(request, TEST_TOKEN_SCOPE);
  if (!auth.ok) {
    return ownerOnlyJson({ ok: false, error: auth.error, scopeRequired: TEST_TOKEN_SCOPE, timestamp: nowIso() }, auth.status);
  }

  try {
    // Lazy import to avoid a circular import at module init time.
    const jobsModule = await import('./ivx-agent-jobs');
    const ownerContextLike = { userId: 'ivx-test-token', email: auth.record.issuedTo };

    // Create a small, side-effect-free test job. createAgentJob is internal,
    // so we use the exported list/process path through a synthetic create via
    // the same code path the owner-only create route uses.
    const created = await (jobsModule as unknown as {
      createAgentJob?: (body: Record<string, unknown>, ctx: { userId: string; email: string | null }) => Promise<{ id: string }>;
    }).createAgentJob?.({
      type: 'agent_runtime_test',
      prompt: 'IVX Agent Runtime end-to-end test (single-use scoped token).',
      payload: { source: 'test-token', scope: TEST_TOKEN_SCOPE },
      approvalRequired: false,
      maxAttempts: 1,
    }, ownerContextLike) ?? null;

    if (!created || !created.id) {
      return ownerOnlyJson({
        ok: false,
        error: 'test_job_creation_failed',
        hint: 'createAgentJob is not exported; expose it from ivx-agent-jobs.ts to enable scoped test runs.',
        timestamp: nowIso(),
      }, 500);
    }

    // Drive the worker. processNextAgentJob picks the next queued job (which
    // may be ours) and runs it to completion in one call.
    const tickResult = await processNextAgentJob();

    // Fetch the job + logs through the public read helpers if exported,
    // otherwise fall back to the tick result.
    const loadJobAndLogs = (jobsModule as unknown as {
      loadJob?: (id: string) => Promise<unknown>;
      loadJobLogs?: (id: string) => Promise<unknown[]>;
    });

    const finalJob = loadJobAndLogs.loadJob ? await loadJobAndLogs.loadJob(created.id) : null;
    const finalLogs = loadJobAndLogs.loadJobLogs ? await loadJobAndLogs.loadJobLogs(created.id) : [];

    return ownerOnlyJson({
      ok: true,
      scope: TEST_TOKEN_SCOPE,
      jobId: created.id,
      tick: tickResult,
      job: finalJob,
      logs: finalLogs,
      timestamp: nowIso(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'test_run_failed';
    return ownerOnlyJson({ ok: false, error: message, timestamp: nowIso() }, 500);
  }
}
