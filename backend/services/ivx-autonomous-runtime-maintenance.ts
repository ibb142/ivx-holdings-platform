/**
 * IVX Autonomous Runtime Maintenance
 *
 * Repairs two durability gaps discovered by the live 112-agent audit:
 * 1. ivx_agent_states counters can restart from process-local zero even though
 *    ivx_agent_executions contains the complete durable history.
 * 2. The in-process Senior Developer Worker stores its proof in the durable
 *    document ledger, while operational SQL dashboards inspect ivx_agent_jobs.
 *
 * This service reconciles counters from the immutable execution history and
 * mirrors secret-safe Senior Developer proof summaries into ivx_agent_jobs.
 * It never changes source code, auth, money, permissions, or production deploys.
 */
import { createHash } from 'node:crypto';
import {
  listSeniorDeveloperJobs,
  listSeniorDeveloperProofLedger,
} from './ivx-senior-developer-worker';

export const IVX_AUTONOMOUS_RUNTIME_MAINTENANCE_MARKER =
  'ivx-autonomous-runtime-maintenance-2026-08-23';

const INTERVAL_MS = 5 * 60 * 1000;
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function supabaseUrl(): string {
  return readTrimmed(process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL).replace(/\/+$/, '');
}

function serviceRoleKey(): string {
  return readTrimmed(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);
}

function configured(): boolean {
  return Boolean(supabaseUrl() && serviceRoleKey());
}

function headers(prefer?: string): Record<string, string> {
  const key = serviceRoleKey();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

function telemetryId(jobId: string): string {
  return `ivx-senior-${createHash('sha256').update(jobId).digest('hex').slice(0, 32)}`;
}

async function reconcileAgentStateCounters(): Promise<{ ok: boolean; error: string | null }> {
  if (!configured()) return { ok: false, error: 'supabase_not_configured' };
  const sql = `
    update public.ivx_agent_states as s
    set
      total_runs = greatest(coalesce(s.total_runs, 0), x.total_runs),
      successful_runs = greatest(coalesce(s.successful_runs, 0), x.successful_runs),
      failed_runs = greatest(coalesce(s.failed_runs, 0), x.failed_runs),
      last_successful_run = case
        when x.last_successful_run is not null and (s.last_successful_run is null or x.last_successful_run > s.last_successful_run)
          then x.last_successful_run else s.last_successful_run end,
      last_failed_run = case
        when x.last_failed_run is not null and (s.last_failed_run is null or x.last_failed_run > s.last_failed_run)
          then x.last_failed_run else s.last_failed_run end,
      updated_at = now()
    from (
      select
        agent_id,
        count(*)::int as total_runs,
        count(*) filter (where final_status = 'completed')::int as successful_runs,
        count(*) filter (where final_status = 'failed')::int as failed_runs,
        max(finished_at) filter (where final_status = 'completed') as last_successful_run,
        max(finished_at) filter (where final_status = 'failed') as last_failed_run
      from public.ivx_agent_executions
      where simulated = false
      group by agent_id
    ) as x
    where s.agent_id = x.agent_id;
  `;
  try {
    const res = await fetch(`${supabaseUrl()}/rest/v1/rpc/ivx_exec_sql`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ sql_text: sql }),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) return { ok: false, error: `counter_reconcile_http_${res.status}:${text.slice(0, 120)}` };
    if (text) {
      try {
        const payload = JSON.parse(text) as { ok?: boolean; error?: string };
        if (payload.ok === false) return { ok: false, error: String(payload.error ?? 'counter_reconcile_rpc_failed').slice(0, 160) };
      } catch {
        // Non-JSON successful RPC response is acceptable.
      }
    }
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message.slice(0, 160) : 'counter_reconcile_failed' };
  }
}

async function syncSeniorDeveloperTelemetry(): Promise<{ ok: boolean; mirrored: number; error: string | null }> {
  if (!configured()) return { ok: false, mirrored: 0, error: 'supabase_not_configured' };
  try {
    const [ledger, jobs] = await Promise.all([
      listSeniorDeveloperProofLedger(200),
      listSeniorDeveloperJobs(200),
    ]);
    const byId = new Map(jobs.map((job) => [job.jobId, job]));
    const now = new Date().toISOString();
    const rows = ledger.map((proof) => {
      const job = byId.get(proof.jobId);
      const state = proof.finalStatus === 'FAILED' || proof.finalStatus === 'BLOCKED' ? 'failed' : 'completed';
      return {
        id: telemetryId(proof.jobId),
        type: 'ivx_senior_dev_activity',
        status: state,
        prompt: proof.goal.slice(0, 1000),
        payload: {
          marker: IVX_AUTONOMOUS_RUNTIME_MAINTENANCE_MARKER,
          jobId: proof.jobId,
          actor: job?.input.actor ?? 'UNKNOWN',
          agentId: job?.input.agentId ?? null,
          agentNumber: job?.input.agentNumber ?? null,
          agentName: job?.input.agentName ?? null,
          sourceChatMessageId: job?.input.sourceChatMessageId ?? null,
          executionMode: job?.input.executionMode ?? null,
          finalStatus: proof.finalStatus,
          changedFiles: proof.changedFiles,
          filesInspected: proof.filesInspected ?? [],
          testsRun: proof.testsRun,
          testsPassed: proof.testsPassed,
          typecheckRun: proof.typecheckRun,
          typecheckPassed: proof.typecheckPassed,
          commitSha: proof.commitSha,
          branch: proof.branch,
          prNumber: proof.prNumber,
          prUrl: proof.prUrl,
          prMerged: proof.prMerged,
          ciChecksGreen: proof.ciChecksGreen ?? null,
          deployRequested: proof.deployRequested,
          deployId: proof.deployId,
          liveCommit: proof.liveCommit,
          commitMatch: proof.commitMatch,
          healthOk: proof.healthOk,
          evidenceFingerprint: proof.evidenceFingerprint ?? null,
          durable: proof.durable,
          generatedAt: proof.generatedAt,
        },
        result: {
          ok: proof.ok,
          endToEndProductionComplete: proof.endToEndProductionComplete,
          finalStatus: proof.finalStatus,
          error: proof.error,
        },
        error: proof.error,
        approval_required: false,
        attempts: job?.attempts ?? 0,
        max_attempts: 1,
        agent_name: job?.input.agentName ?? 'IVX-SENIOR-DEV-01',
        current_step: proof.finalStatus,
        progress: proof.finalStatus === 'COMPLETE' ? 100 : 0,
        created_by: job?.input.actor ?? 'SYSTEM',
        created_by_email: 'system@ivx.ai',
        completed_at: proof.generatedAt,
        updated_at: now,
      };
    });
    if (rows.length === 0) return { ok: true, mirrored: 0, error: null };
    const res = await fetch(`${supabaseUrl()}/rest/v1/ivx_agent_jobs?on_conflict=id`, {
      method: 'POST',
      headers: headers('resolution=merge-duplicates,return=minimal'),
      body: JSON.stringify(rows),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) return { ok: false, mirrored: 0, error: `telemetry_upsert_http_${res.status}:${text.slice(0, 120)}` };
    return { ok: true, mirrored: rows.length, error: null };
  } catch (error) {
    return { ok: false, mirrored: 0, error: error instanceof Error ? error.message.slice(0, 160) : 'telemetry_sync_failed' };
  }
}

export async function runAutonomousRuntimeMaintenance(): Promise<{
  ok: boolean;
  counters: { ok: boolean; error: string | null };
  telemetry: { ok: boolean; mirrored: number; error: string | null };
}> {
  if (running) {
    return {
      ok: false,
      counters: { ok: false, error: 'maintenance_already_running' },
      telemetry: { ok: false, mirrored: 0, error: 'maintenance_already_running' },
    };
  }
  running = true;
  try {
    const [counters, telemetry] = await Promise.all([
      reconcileAgentStateCounters(),
      syncSeniorDeveloperTelemetry(),
    ]);
    const ok = counters.ok && telemetry.ok;
    console.log('[IVX Autonomous Maintenance]', {
      ok,
      counterReconcile: counters.ok,
      seniorTelemetry: telemetry.ok,
      mirrored: telemetry.mirrored,
      counterError: counters.error,
      telemetryError: telemetry.error,
    });
    return { ok, counters, telemetry };
  } finally {
    running = false;
  }
}

export function startAutonomousRuntimeMaintenance(): { started: boolean } {
  if (timer) return { started: false };
  void runAutonomousRuntimeMaintenance();
  timer = setInterval(() => { void runAutonomousRuntimeMaintenance(); }, INTERVAL_MS);
  timer.unref?.();
  return { started: true };
}

export function stopAutonomousRuntimeMaintenance(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
