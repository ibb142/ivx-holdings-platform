/**
 * IVX owner-only status & verification endpoints.
 *
 * Three owner-gated reads that report the TRUTH from whatever runtime they run
 * in (production Render has the real secrets; the build sandbox does not). All
 * three read `process.env` directly, so the answer is authoritative for the
 * environment that serves the request.
 *
 *   GET /api/ivx/verify/env-status   — credential presence + masked last-4
 *   GET /api/ivx/autonomous/status   — scheduler + per-engine run state
 *   GET /api/ivx/persistence/verify  — live durable-store round-trip proof
 *
 * HARD SECRET RULE: never returns a full secret value. For owner-authenticated
 * callers it returns at most the last 4 characters of a present value so the
 * owner can confirm WHICH key is wired without exposing it.
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { buildCredentialReadiness } from '../services/ivx-credential-readiness';
import {
  isDurableStoreConfigured,
  readDurableJson,
  writeDurableJson,
} from '../services/ivx-durable-store';
import {
  getSchedulerState,
  runDueJobs,
  runScheduledJob,
  SCHEDULED_JOB_KINDS,
  type ScheduledJobKind,
} from '../services/ivx-autonomous-scheduler';
import { summarizeAutonomousExecution } from '../services/ivx-autonomous-execution';

export const ownerStatusOptions = (): Response => ownerOnlyOptions();

async function requireOwner(request: Request): Promise<{ ok: true } | { ok: false; response: Response }> {
  try {
    const owner = await assertIVXOwnerOnly(request);
    if (!owner.userId) {
      return { ok: false, response: ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401) };
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'IVX owner authentication required.';
    const status = message.toLowerCase().includes('missing bearer') ? 401 : 403;
    return { ok: false, response: ownerOnlyJson({ ok: false, error: message }, status) };
  }
}

/** Present/missing + masked last-4, never the full value. */
function maskedLast4(value: string | undefined): string | null {
  const v = (value ?? '').trim();
  if (v.length === 0) return null;
  return v.length <= 4 ? '••••' : `••••${v.slice(-4)}`;
}

type EnvVarReport = {
  name: string;
  status: 'PRESENT' | 'MISSING';
  last4: string | null;
  feature: string;
  /** Whether the production runtime can read this value (true when present here). */
  productionAccessible: boolean;
  /** Other names the runtime also accepts for the same purpose. */
  aliases: string[];
};

/** The credentials the owner asked to audit, each mapped to the feature it unlocks. */
const ENV_AUDIT: { name: string; feature: string; aliases?: string[] }[] = [
  { name: 'IVX_OWNER_TOKEN', feature: 'Owner-gated route auth / CI owner automation' },
  { name: 'RENDER_API_KEY', feature: 'Direct deploy + one-call rollback control' },
  { name: 'RENDER_SERVICE_ID', feature: 'Render service the deploy API targets' },
  { name: 'DATABASE_URL', feature: 'Postgres connection (CRM / pipeline persistence)', aliases: ['POSTGRES_URL', 'SUPABASE_DB_URL'] },
  { name: 'SUPABASE_URL', feature: 'Supabase REST endpoint for durable persistence', aliases: ['EXPO_PUBLIC_SUPABASE_URL'] },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', feature: 'Server-side Supabase reads/writes + storage' },
  { name: 'OPENAI_API_KEY', feature: 'AI reasoning (Owner AI, public chat, synthesis)', aliases: ['IVX_AI_GATEWAY_KEY'] },
  { name: 'RESEND_API_KEY', feature: 'Outbound email (capital outreach delivery)', aliases: ['SENDGRID_API_KEY', 'SMTP_URL', 'SMTP_HOST'] },
  { name: 'IVX_OWNER_REGISTRATION_EMAILS', feature: 'Owner allowlist that promotes a session to owner' },
  { name: 'GITHUB_TOKEN', feature: 'Code commit/push + rollback tag' },
];

function resolveEnvVar(spec: { name: string; feature: string; aliases?: string[] }): EnvVarReport {
  const env = process.env;
  const candidates = [spec.name, ...(spec.aliases ?? [])];
  const hit = candidates.find((n) => (env[n] ?? '').trim().length > 0);
  const value = hit ? env[hit] : undefined;
  const present = Boolean(value && value.trim().length > 0);
  return {
    name: spec.name,
    status: present ? 'PRESENT' : 'MISSING',
    last4: present ? maskedLast4(value) : null,
    feature: spec.feature,
    productionAccessible: present,
    aliases: spec.aliases ?? [],
  };
}

/** GET /api/ivx/verify/env-status — owner-only credential presence audit. */
export async function handleEnvStatusRequest(request: Request): Promise<Response> {
  const auth = await requireOwner(request);
  if (!auth.ok) return auth.response;

  const variables = ENV_AUDIT.map(resolveEnvVar);
  const present = variables.filter((v) => v.status === 'PRESENT').length;
  const readiness = buildCredentialReadiness();

  // CANARY-AUTONOMOUS-VERIFY-2026-08-10
  return ownerOnlyJson({
    ok: true,
    generatedAt: new Date().toISOString(),
    runtime: process.env.RENDER_SERVICE_ID ? 'render-production' : 'non-render-runtime',
    summary: { total: variables.length, present, missing: variables.length - present },
    variables,
    autonomyLevel: readiness.autonomyLevel,
    deployment: readiness.deployment,
    secretValuesReturned: false,
  });
}

/** GET /api/ivx/autonomous/status — owner-only scheduler + engine state. */
export async function handleAutonomousStatusRequest(request: Request): Promise<Response> {
  const auth = await requireOwner(request);
  if (!auth.ok) return auth.response;

  try {
    const state = await getSchedulerState();
    const engines = SCHEDULED_JOB_KINDS.map((kind: ScheduledJobKind) => {
      const job = state.jobs[kind];
      return {
        kind,
        registered: true,
        lastRunAt: job.lastRunAt,
        nextDueAt: job.nextDueAt,
        lastStatus: job.lastStatus,
        runCount: job.runCount,
        failureCount: job.failureCount,
        successCount: Math.max(0, job.runCount - job.failureCount),
        lastSummary: job.lastSummary,
        lastDurationMs: job.lastDurationMs,
      };
    });

    const records = await summarizeAutonomousExecution().catch(() => null);

    return ownerOnlyJson({
      ok: true,
      generatedAt: new Date().toISOString(),
      schedulerEnabled: state.enabled,
      startedAt: state.startedAt,
      updatedAt: state.updatedAt,
      durableStoreConfigured: isDurableStoreConfigured(),
      engines,
      records,
    });
  } catch (error) {
    return ownerOnlyJson(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to read scheduler state.' },
      500,
    );
  }
}

/**
 * POST /api/ivx/autonomous/run — owner-only on-demand trigger.
 *
 * Runs the autonomous engines NOW and returns real per-engine results plus the
 * CRM record counts before/after, so the owner can prove execution without
 * waiting for the daily tick. Body (optional): { kind?: ScheduledJobKind } to
 * run a single engine; omit to run every job that is currently due.
 */
export async function handleAutonomousRunRequest(request: Request): Promise<Response> {
  const auth = await requireOwner(request);
  if (!auth.ok) return auth.response;

  let requestedKind: ScheduledJobKind | undefined;
  try {
    const body = (await request.json().catch(() => null)) as { kind?: string } | null;
    if (body && typeof body.kind === 'string') {
      const match = SCHEDULED_JOB_KINDS.find((k) => k === body.kind);
      if (!match) {
        return ownerOnlyJson(
          { ok: false, error: `Unknown engine kind '${body.kind}'.`, validKinds: SCHEDULED_JOB_KINDS },
          400,
        );
      }
      requestedKind = match;
    }
  } catch {
    // No/invalid body — default to running all due jobs.
  }

  try {
    const startedAt = new Date().toISOString();
    const before = await summarizeAutonomousExecution().catch(() => null);
    const results = requestedKind
      ? [await runScheduledJob(requestedKind)]
      : await runDueJobs();
    const after = await summarizeAutonomousExecution().catch(() => null);

    return ownerOnlyJson({
      ok: true,
      trigger: 'owner-on-demand',
      startedAt,
      finishedAt: new Date().toISOString(),
      ranKinds: results.map((r) => r.kind),
      results: results.map((r) => ({
        kind: r.kind,
        ok: r.ok,
        durationMs: r.durationMs,
        summary: r.summary,
        error: r.error ?? null,
      })),
      crmBefore: before?.crm ?? null,
      crmAfter: after?.crm ?? null,
      outreachAfter: after?.outreach ?? null,
      ideasAfter: after?.ideas ?? null,
    });
  } catch (error) {
    return ownerOnlyJson(
      { ok: false, error: error instanceof Error ? error.message : 'Autonomous run failed.' },
      500,
    );
  }
}

/** GET /api/ivx/persistence/verify — owner-only live durable-store round-trip. */
export async function handlePersistenceVerifyRequest(request: Request): Promise<Response> {
  const auth = await requireOwner(request);
  if (!auth.ok) return auth.response;

  const configured = isDurableStoreConfigured();
  const probeKey = 'persistence-verify/probe.json';
  const token = `verify-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  if (!configured) {
    return ownerOnlyJson({
      ok: true,
      verified: false,
      backend: 'filesystem-only',
      reason: 'Supabase durable store not configured (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required). Writes persist to local filesystem only and do not survive a fresh container with no mounted volume.',
      roundTrip: null,
      generatedAt: new Date().toISOString(),
    });
  }

  try {
    const startedAt = Date.now();
    await writeDurableJson(probeKey, { token, writtenAt: new Date().toISOString() });
    const readBack = await readDurableJson<{ token?: string }>(probeKey, {});
    const verified = readBack.token === token;
    return ownerOnlyJson({
      ok: true,
      verified,
      backend: 'supabase-durable',
      roundTrip: {
        wroteToken: token,
        readToken: readBack.token ?? null,
        match: verified,
        latencyMs: Date.now() - startedAt,
      },
      reason: verified ? null : 'Round-trip token mismatch — write/read did not reconcile.',
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return ownerOnlyJson(
      { ok: false, verified: false, error: error instanceof Error ? error.message : 'Persistence round-trip failed.' },
      500,
    );
  }
}
