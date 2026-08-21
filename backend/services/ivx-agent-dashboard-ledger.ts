/**
 * Durable read-model for the Autonomous Operations Dashboard.
 * Reads the same Supabase persistence used by the 112-agent real-execution runtime,
 * so owner visibility survives app closure, process restarts, and redeploys.
 */
import {
  activeStoreMode,
  fetchAgentStates,
  resolveSupabaseBinding,
  type AgentStateRow,
  type ExecutionRow,
} from './ivx-agent-persistence';

export const IVX_AGENT_DASHBOARD_LEDGER_MARKER = 'ivx-agent-dashboard-ledger-2026-08-18';

export type AgentDashboardLedger = {
  ok: boolean;
  mode: string;
  states: AgentStateRow[];
  executions: ExecutionRow[];
  error: string | null;
};

type JobDoc = {
  id: string;
  type: string;
  status: string;
  payload: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

async function restGet<T>(path: string, timeoutMs = 15000): Promise<{ ok: boolean; status: number; data: T | null; error: string | null }> {
  const binding = resolveSupabaseBinding();
  if (binding.missing.length) {
    return { ok: false, status: 0, data: null, error: `Supabase missing ${binding.missing.join(', ')}` };
  }
  try {
    const response = await fetch(`${binding.url}/rest/v1/${path}`, {
      headers: {
        apikey: binding.key,
        Authorization: `Bearer ${binding.key}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let data: T | null = null;
    try { data = text ? JSON.parse(text) as T : null; } catch { data = null; }
    return {
      ok: response.ok,
      status: response.status,
      data: response.ok ? data : null,
      error: response.ok ? null : `HTTP ${response.status}: ${text.slice(0, 240)}`,
    };
  } catch (error) {
    return { ok: false, status: 0, data: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function normalizeExecution(value: unknown): ExecutionRow | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Partial<ExecutionRow>;
  if (typeof row.agent_id !== 'string' || typeof row.task_id !== 'string') return null;
  return {
    task_id: row.task_id,
    run_id: typeof row.run_id === 'string' ? row.run_id : 'unknown',
    agent_id: row.agent_id,
    agent_number: Number(row.agent_number ?? 0),
    workflow: typeof row.workflow === 'string' ? row.workflow : 'unknown',
    task_type: typeof row.task_type === 'string' ? row.task_type : 'unknown',
    final_status: row.final_status ?? 'pending',
    real_tool_used: Boolean(row.real_tool_used),
    tools_used: Array.isArray(row.tools_used) ? row.tools_used.map(String) : [],
    tool_result_id: typeof row.tool_result_id === 'string' ? row.tool_result_id : null,
    source_reference: typeof row.source_reference === 'string' ? row.source_reference : null,
    verified_output: Boolean(row.verified_output),
    evidence: row.evidence && typeof row.evidence === 'object' ? row.evidence as Record<string, unknown> : null,
    evidence_sha256: typeof row.evidence_sha256 === 'string' ? row.evidence_sha256 : null,
    output: row.output && typeof row.output === 'object' ? row.output as Record<string, unknown> : null,
    cost_usage: row.cost_usage && typeof row.cost_usage === 'object' ? row.cost_usage as Record<string, unknown> : { usd: 0 },
    error: typeof row.error === 'string' ? row.error : null,
    retry_count: Number(row.retry_count ?? 0),
    duration_ms: Number(row.duration_ms ?? 0),
    dedup_key: typeof row.dedup_key === 'string' ? row.dedup_key : null,
    simulated: Boolean(row.simulated),
    started_at: typeof row.started_at === 'string' ? row.started_at : null,
    finished_at: typeof row.finished_at === 'string' ? row.finished_at : null,
  };
}

async function fetchDedicatedExecutions(limit: number): Promise<{ ok: boolean; rows: ExecutionRow[]; error: string | null }> {
  const result = await restGet<ExecutionRow[]>(`ivx_agent_executions?select=*&order=started_at.desc.nullslast&limit=${limit}`);
  return { ok: result.ok, rows: (result.data ?? []).map(normalizeExecution).filter((r): r is ExecutionRow => Boolean(r)), error: result.error };
}

async function fetchFallbackExecutions(limit: number): Promise<{ ok: boolean; rows: ExecutionRow[]; error: string | null }> {
  const result = await restGet<JobDoc[]>(`ivx_agent_jobs?type=eq.ivx_rec_execution&select=id,type,status,payload,created_at,updated_at&order=created_at.desc&limit=${limit}`);
  const rows = (result.data ?? [])
    .map((doc) => normalizeExecution(doc.payload))
    .filter((r): r is ExecutionRow => Boolean(r));
  return { ok: result.ok, rows, error: result.error };
}

export async function readAgentDashboardLedger(limit = 500): Promise<AgentDashboardLedger> {
  const safeLimit = Math.max(112, Math.min(2000, Math.floor(limit)));
  const stateResult = await fetchAgentStates();
  let mode = activeStoreMode();
  let execResult = mode === 'dedicated'
    ? await fetchDedicatedExecutions(safeLimit)
    : mode === 'jobs_fallback'
      ? await fetchFallbackExecutions(safeLimit)
      : { ok: false, rows: [] as ExecutionRow[], error: `Unsupported store mode ${mode}` };

  // If the cached mode was not yet established, probe both read paths without
  // fabricating success. The first real successful source becomes the dashboard source.
  if (!execResult.ok && mode !== 'dedicated') {
    const dedicated = await fetchDedicatedExecutions(safeLimit);
    if (dedicated.ok) {
      mode = 'dedicated';
      execResult = dedicated;
    }
  }
  if (!execResult.ok && mode !== 'jobs_fallback') {
    const fallback = await fetchFallbackExecutions(safeLimit);
    if (fallback.ok) {
      mode = 'jobs_fallback';
      execResult = fallback;
    }
  }

  const errors = [stateResult.ok ? null : stateResult.error, execResult.ok ? null : execResult.error].filter(Boolean);
  return {
    ok: stateResult.ok && execResult.ok,
    mode,
    states: stateResult.data ?? [],
    executions: execResult.rows,
    error: errors.length ? errors.join(' | ') : null,
  };
}
